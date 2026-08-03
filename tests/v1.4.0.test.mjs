import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("tellActiveAria2 parses RPC results and removeAria2Download issues aria2.remove", async () => {
  const { tellActiveAria2, removeAria2Download } = await importBundledModule(
    "src/features/integrations/aria2.ts"
  );

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.method === "aria2.tellActive") {
      return new Response(
        JSON.stringify({
          result: [
            {
              gid: "abc",
              status: "active",
              totalLength: "100",
              completedLength: "40",
              files: [{ path: "/tmp/foo.mp4" }]
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (body.method === "aria2.remove") {
      return new Response(JSON.stringify({ result: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("{}", { status: 200 });
  };

  try {
    const active = await tellActiveAria2({ endpoint: "http://aria.local", secret: "" });
    assert.equal(active.length, 1);
    assert.equal(active[0].gid, "abc");
    assert.equal(active[0].totalLength, 100);
    assert.equal(active[0].completedLength, 40);
    assert.equal(active[0].files[0].path, "/tmp/foo.mp4");

    const cancel = await removeAria2Download({ endpoint: "http://aria.local", secret: "s3cret" }, "abc");
    assert.equal(cancel.ok, true);
    assert.equal(cancel.gid, "abc");
    // Last call should have prefixed with `token:s3cret`.
    const lastBody = calls[calls.length - 1];
    assert.equal(lastBody.params[0], "token:s3cret");
    assert.equal(lastBody.params[1], "abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("splitForThread chunks on blank lines and drops empty segments", async () => {
  const { splitForThread } = await importBundledModule(
    "src/features/integrations/crosspost.ts"
  );
  assert.deepEqual(splitForThread("first\n\nsecond\n\nthird"), ["first", "second", "third"]);
  assert.deepEqual(splitForThread("solo"), ["solo"]);
  assert.deepEqual(splitForThread(""), []);
  assert.deepEqual(splitForThread("a\n\n\nb"), ["a", "b"]);
});

test("crosspost asThread posts every segment for Bluesky with reply refs", async () => {
  const { crosspost } = await importBundledModule(
    "src/features/integrations/crosspost.ts"
  );
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (typeof url === "string" && url.includes("createSession")) {
      return new Response(JSON.stringify({ accessJwt: "jwt", did: "did:plc:1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({ uri: `at://did:plc:1/app.bsky.feed.post/post${calls.length}`, cid: `cid${calls.length}` }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    const integrations = {
      aria2: { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 },
      bluesky: {
        enabled: true,
        service: "https://bsky.social",
        handle: "you.bsky.social",
        appPassword: "abc"
      },
      mastodon: { enabled: false, instance: "", token: "", visibility: "public" },
      ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
      semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false }
    };
    const result = await crosspost(integrations, {
      text: "one\n\ntwo\n\nthree",
      target: "bluesky",
      asThread: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.posts, 3);
    // 1 session + 3 createRecord calls.
    assert.equal(calls.length, 4);
    const replyPayload = calls[3].body.record.reply;
    assert.ok(replyPayload, "third post should carry reply ref");
    assert.equal(replyPayload.root.uri, "at://did:plc:1/app.bsky.feed.post/post2");
  } finally {
    globalThis.fetch = original;
  }
});

test("crosspost asThread chains in_reply_to_id for Mastodon", async () => {
  const { crosspost } = await importBundledModule(
    "src/features/integrations/crosspost.ts"
  );
  const original = globalThis.fetch;
  const calls = [];
  let nextId = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    nextId += 1;
    return new Response(
      JSON.stringify({ id: `s${nextId}`, url: `https://mastodon.social/@you/s${nextId}` }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  try {
    const integrations = {
      aria2: { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 },
      bluesky: { enabled: false, service: "", handle: "", appPassword: "" },
      mastodon: {
        enabled: true,
        instance: "https://mastodon.social",
        token: "tok",
        visibility: "unlisted"
      },
      ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
      semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false }
    };
    const result = await crosspost(integrations, {
      text: "a\n\nb\n\nc",
      target: "mastodon",
      asThread: true
    });
    assert.equal(result.ok, true);
    assert.equal(result.posts, 3);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].body.in_reply_to_id, undefined);
    assert.equal(calls[1].body.in_reply_to_id, "s1");
    assert.equal(calls[2].body.in_reply_to_id, "s2");
    assert.equal(result.url, "https://mastodon.social/@you/s1");
  } finally {
    globalThis.fetch = original;
  }
});

test("crosspost uploads the last image to Bluesky and embeds it on the first post", async () => {
  const { crosspost } = await importBundledModule("src/features/integrations/crosspost.ts");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof url === "string" && url.includes("source.jpg")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      });
    }
    if (typeof url === "string" && url.includes("uploadBlob")) {
      assert.equal(init.headers.authorization, "Bearer jwt");
      assert.ok(init.body instanceof Blob);
      return new Response(JSON.stringify({ blob: { $type: "blob", ref: { $link: "cid-image" }, mimeType: "image/jpeg", size: 3 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (typeof url === "string" && url.includes("createSession")) {
      return new Response(JSON.stringify({ accessJwt: "jwt", did: "did:plc:1" }), { status: 200 });
    }
    return new Response(JSON.stringify({ uri: "at://did:plc:1/app.bsky.feed.post/post1", cid: "cid1" }), { status: 200 });
  };

  try {
    const result = await crosspost(
      {
        aria2: { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 },
        bluesky: { enabled: true, service: "https://bsky.social", handle: "you.bsky.social", appPassword: "abc" },
        mastodon: { enabled: false, instance: "", token: "", visibility: "public" },
        ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
        semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false },
        crosspost: { attachLastDownload: true }
      },
      {
        text: "With an image",
        target: "bluesky",
        attachment: { url: "https://cdn.test/source.jpg", filename: "source.jpg", kind: "photo" }
      }
    );
    assert.equal(result.ok, true);
    const recordCall = calls.find((entry) => typeof entry.url === "string" && entry.url.includes("createRecord"));
    const record = JSON.parse(recordCall.init.body).record;
    assert.equal(record.embed.$type, "app.bsky.embed.images");
    assert.equal(record.embed.images[0].image.ref.$link, "cid-image");
  } finally {
    globalThis.fetch = original;
  }
});

test("crosspost uploads the last media to Mastodon and attaches it to the first status", async () => {
  const { crosspost } = await importBundledModule("src/features/integrations/crosspost.ts");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (typeof url === "string" && url.includes("source.png")) {
      return new Response(new Uint8Array([4, 5]), {
        status: 200,
        headers: { "content-type": "image/png" }
      });
    }
    if (typeof url === "string" && url.endsWith("/api/v1/media")) {
      assert.equal(init.headers.authorization, "Bearer token");
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get("file").name, "source.png");
      return new Response(JSON.stringify({ id: "media-1" }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    assert.deepEqual(body.media_ids, ["media-1"]);
    return new Response(JSON.stringify({ id: "status-1", url: "https://mastodon.social/@you/1" }), { status: 200 });
  };

  try {
    const result = await crosspost(
      {
        aria2: { enabled: false, endpoint: "", secret: "", minBytes: 1_000_000 },
        bluesky: { enabled: false, service: "", handle: "", appPassword: "" },
        mastodon: { enabled: true, instance: "https://mastodon.social", token: "token", visibility: "public" },
        ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
        semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false },
        crosspost: { attachLastDownload: true }
      },
      {
        text: "With an image",
        target: "mastodon",
        attachment: { url: "https://cdn.test/source.png", filename: "source.png", kind: "photo" }
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.url, "https://mastodon.social/@you/1");
  } finally {
    globalThis.fetch = original;
  }
});

test("recentIntegrationErrors surfaces failed audit entries newest-first", async () => {
  const { recentIntegrationErrors } = await importBundledModule(
    "src/features/core/integration-errors.ts"
  );
  const entries = [
    { at: "2026-05-19T10:00:00Z", action: "media.download", detail: { ok: true } },
    {
      at: "2026-05-19T10:05:00Z",
      action: "media.download.failed",
      detail: { kind: "video", error: "HTTP 404" }
    },
    {
      at: "2026-05-19T10:06:00Z",
      action: "export.start",
      detail: { kind: "crosspost", target: "bluesky", ok: false, error: "Bluesky HTTP 401" }
    },
    {
      at: "2026-05-19T10:07:00Z",
      action: "export.complete",
      detail: { kind: "crosspost", target: "mastodon", ok: true }
    }
  ];
  const errors = recentIntegrationErrors(entries);
  assert.equal(errors.length, 2);
  // Most recent first.
  assert.equal(errors[0].at, "2026-05-19T10:06:00Z");
  assert.equal(errors[0].kind, "crosspost:bluesky");
  assert.match(errors[0].message, /HTTP 401/);
  assert.equal(errors[1].kind, "video");
  assert.match(errors[1].message, /HTTP 404/);
});

test("semanticSearch settings carry the new autoIndex flag", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );
  assert.equal(DEFAULT_SETTINGS.integrations.semanticSearch.autoIndex, false);
  const enabled = normalizeSettings({
    integrations: { semanticSearch: { autoIndex: true, endpoint: "https://example.com" } }
  });
  assert.equal(enabled.integrations.semanticSearch.autoIndex, true);
});

test("crosspost attachment preference defaults off and normalizes safely", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );
  assert.equal(DEFAULT_SETTINGS.integrations.crosspost.attachLastDownload, false);
  assert.equal(normalizeSettings({ integrations: { crosspost: { attachLastDownload: true } } }).integrations.crosspost.attachLastDownload, true);
  assert.equal(normalizeSettings({ integrations: { crosspost: { attachLastDownload: "yes" } } }).integrations.crosspost.attachLastDownload, false);
});

test("export-feature triggers autoIndexExport when integration is enabled", async () => {
  const source = await readFile(
    path.join(root, "src/features/export/export-feature.ts"),
    "utf8"
  );
  assert.match(source, /autoIndex/);
  assert.match(source, /autoIndexExport/);
});

test("smoke spec scaffold ships with explicit setup instructions", async () => {
  const source = await readFile(
    path.join(root, "tests/smoke/aviary.smoke.mjs"),
    "utf8"
  );
  assert.match(source, /npm install --save-dev playwright/);
  assert.match(source, /launchPersistentContext/);
  assert.match(source, /Integrations/);
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.smoke, "node tests/smoke/aviary.smoke.mjs");
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v14-"));
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
