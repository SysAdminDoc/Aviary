import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("network operations abort and settle when an endpoint stalls", async () => {
  const { NetworkTimeoutError, withNetworkTimeout } = await importBundledModule(
    "src/platform/network.ts"
  );
  let signal;
  const started = Date.now();
  await assert.rejects(
    () =>
      withNetworkTimeout(
        (requestSignal) => {
          signal = requestSignal;
          return new Promise((_, reject) => {
            requestSignal.addEventListener("abort", () => reject(requestSignal.reason));
          });
        },
        15
      ),
    (error) => error instanceof NetworkTimeoutError && error.timeoutMs === 15
  );
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - started < 500, "a stalled operation must not hold the caller");
});

test("settings carry an integrations envelope with defaults disabled and URL validation", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );

  for (const key of ["aria2", "bluesky", "mastodon", "ai", "semanticSearch"]) {
    assert.equal(DEFAULT_SETTINGS.integrations[key].enabled, false, `${key} should default disabled`);
  }
  assert.equal(DEFAULT_SETTINGS.integrations.bluesky.service, "https://bsky.social");
  assert.equal(DEFAULT_SETTINGS.integrations.mastodon.visibility, "public");
  assert.equal(DEFAULT_SETTINGS.integrations.ai.provider, "anthropic");

  const normalized = normalizeSettings({
    integrations: {
      aria2: { enabled: true, endpoint: "http://aria2.local:6800", secret: "s3cret", minBytes: 1024 },
      bluesky: {
        enabled: true,
        service: "https://bsky.social/",
        handle: "@you.bsky.social",
        appPassword: "abcd-1234-efgh-5678"
      },
      mastodon: { enabled: true, instance: "https://mastodon.social", token: "abc", visibility: "private" },
      ai: { enabled: true, provider: "openai", endpoint: "http://localhost:11434/v1/chat/completions", apiKey: "key", model: "llama3" },
      semanticSearch: {
        enabled: true,
        endpoint: "https://api.openai.com/v1/embeddings",
        apiKey: "k",
        model: "text-embedding-3-small"
      }
    }
  });

  assert.equal(normalized.integrations.aria2.endpoint, "http://aria2.local:6800");
  assert.equal(normalized.integrations.aria2.minBytes, 1_000_000, "minBytes is clamped to >= 1_000_000");
  assert.equal(normalized.integrations.bluesky.handle, "you.bsky.social");
  // trailing slash trimmed
  assert.equal(normalized.integrations.bluesky.service, "https://bsky.social");
  assert.equal(normalized.integrations.mastodon.visibility, "private");
  assert.equal(normalized.integrations.ai.provider, "openai");

  const rejected = normalizeSettings({
    integrations: {
      ai: { endpoint: "javascript:alert(1)", apiKey: "k", model: "m", enabled: true, provider: "bogus" }
    }
  });
  assert.equal(rejected.integrations.ai.endpoint, "", "non-http URL rejected");
  assert.equal(rejected.integrations.ai.provider, "anthropic", "unknown provider falls back");
});

test("shouldHandoffToAria2 requires enabled + endpoint + threshold", async () => {
  const { shouldHandoffToAria2 } = await importBundledModule("src/features/integrations/aria2.ts");
  const base = { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 };
  assert.equal(shouldHandoffToAria2(base, 5_000_000), false);
  assert.equal(shouldHandoffToAria2({ ...base, enabled: true, endpoint: "http://x" }, 500_000), false);
  assert.equal(shouldHandoffToAria2({ ...base, enabled: true, endpoint: "http://x" }, 5_000_000), true);
  assert.equal(
    shouldHandoffToAria2({ ...base, enabled: true, endpoint: "http://x" }, null),
    true,
    "null size means defer to aria2 since size is unknown"
  );
});

test("addUriToAria2 issues a JSON-RPC call with token prefix when secret is set", async () => {
  const { addUriToAria2 } = await importBundledModule("src/features/integrations/aria2.ts");
  let observed;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    observed = { url, init };
    return new Response(JSON.stringify({ result: "gid-123" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await addUriToAria2(
      { endpoint: "http://localhost:6800", secret: "s3cret" },
      { url: "https://example.com/a.jpg", filename: "a.jpg" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.gid, "gid-123");
    const body = JSON.parse(observed.init.body);
    assert.equal(body.method, "aria2.addUri");
    assert.equal(body.params[0], "token:s3cret");
    assert.deepEqual(body.params[1], ["https://example.com/a.jpg"]);
    assert.deepEqual(body.params[2], { out: "a.jpg" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("crosspost reports configured-but-disabled gracefully and forwards bluesky session calls", async () => {
  const { crosspost } = await importBundledModule("src/features/integrations/crosspost.ts");

  const disabled = await crosspost(
    {
      aria2: { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 },
      bluesky: { enabled: false, service: "https://bsky.social", handle: "x", appPassword: "y" },
      mastodon: { enabled: true, instance: "", token: "", visibility: "public" },
      ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
      semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "" }
    },
    { text: "hello", target: "bluesky" }
  );
  assert.equal(disabled.ok, false);
  assert.ok(disabled.error?.includes("disabled"));

  const originalFetch = globalThis.fetch;
  let sequence = 0;
  globalThis.fetch = async (_url) => {
    sequence += 1;
    if (sequence === 1) {
      return new Response(JSON.stringify({ accessJwt: "jwt", did: "did:plc:1234" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({ uri: "at://did:plc:1234/app.bsky.feed.post/abcd1234", cid: "cid-abcd" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    const result = await crosspost(
      {
        aria2: { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 },
        bluesky: {
          enabled: true,
          service: "https://bsky.social",
          handle: "you.bsky.social",
          appPassword: "abc"
        },
        mastodon: { enabled: false, instance: "", token: "", visibility: "public" },
        ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
        semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "" }
      },
      { text: "hello", target: "bluesky" }
    );
    assert.equal(result.ok, true);
    assert.match(result.url, /https:\/\/bsky\.app\/profile\/you\.bsky\.social\/post\/abcd1234/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runAiPrompt routes to Anthropic Messages and OpenAI Chat endpoints", async () => {
  const { runAiPrompt } = await importBundledModule("src/features/integrations/ai-provider.ts");
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, init) => {
    observed = { url, init };
    if (typeof url === "string" && url.includes("anthropic")) {
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "answer" }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "openai answer" } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    const anthropic = await runAiPrompt(
      { enabled: true, provider: "anthropic", endpoint: "", apiKey: "k", model: "claude" },
      { prompt: "hi" }
    );
    assert.equal(anthropic.ok, true);
    assert.equal(anthropic.text, "answer");
    assert.equal(observed.init.headers["x-api-key"], "k");

    const openai = await runAiPrompt(
      {
        enabled: true,
        provider: "openai",
        endpoint: "http://localhost:11434/v1/chat/completions",
        apiKey: "key",
        model: "llama"
      },
      { prompt: "hello", systemPrompt: "system" }
    );
    assert.equal(openai.ok, true);
    assert.equal(openai.text, "openai answer");
    const body = JSON.parse(observed.init.body);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, "system");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const offline = await runAiPrompt(
    { enabled: false, provider: "anthropic", endpoint: "", apiKey: "k", model: "claude" },
    { prompt: "hi" }
  );
  assert.equal(offline.ok, false);
});

test("SemanticIndex stores embeddings and ranks via cosine similarity", async () => {
  const { SemanticIndex, cosineSimilarity } = await importBundledModule(
    "src/features/integrations/semantic-search.ts"
  );

  const store = new Map();
  const storage = makeStorage(store);
  const index = new SemanticIndex(storage);
  await index.load();

  const originalFetch = globalThis.fetch;
  let cursor = 0;
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0.9, 0.1, 0],
    [1, 0, 0] // for the query
  ];
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [{ embedding: vectors[cursor++] }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  try {
    const config = {
      enabled: true,
      endpoint: "https://api.openai.com/v1/embeddings",
      apiKey: "k",
      model: "text-embedding-3-small"
    };
    await index.embedAndIndex(config, [
      { tweetId: "1", handle: "alpha", displayName: null, text: "apples and oranges", capturedAt: "x", surface: "home", media: [], permalink: null },
      { tweetId: "2", handle: "beta", displayName: null, text: "Go versus Rust", capturedAt: "x", surface: "home", media: [], permalink: null },
      { tweetId: "3", handle: "gamma", displayName: null, text: "apple variety", capturedAt: "x", surface: "home", media: [], permalink: null }
    ]);
    assert.equal(index.size(), 3);

    const hits = await index.search(config, "apple fruit");
    assert.ok(hits.length >= 2);
    assert.equal(hits[0].entry.tweetId, "1", "first should be exact-cosine match");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

function makeStorage(map) {
  return {
    async get(key, fallback) {
      return map.has(key) ? map.get(key) : fallback;
    },
    async set(key, value) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      map.delete(key);
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v13-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
