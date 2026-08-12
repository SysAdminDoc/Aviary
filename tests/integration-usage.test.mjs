import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("integration usage counters enforce request and daily budgets without storing prompts", async () => {
  const {
    IntegrationUsageLedger,
    buildAiDisclosure,
    defaultAiBudget,
    defaultEmbeddingBudget
  } = await importBundledModule("src/features/integrations/usage.ts");
  const store = new Map();
  const ledger = new IntegrationUsageLedger(storageFrom(store));
  await ledger.load();
  const ai = { enabled: true, provider: "openai", endpoint: "https://provider.test/chat", apiKey: "secret", model: "model", maxRequestBytes: 20, dailyRequestBytes: 25 };
  const first = await ledger.reserveAi(18, defaultAiBudget(ai));
  assert.equal(first.allowed, true);
  const tooLarge = await ledger.reserveAi(21, defaultAiBudget(ai));
  assert.equal(tooLarge.allowed, false);
  const daily = await ledger.reserveAi(8, defaultAiBudget(ai));
  assert.equal(daily.allowed, false);

  const snapshot = ledger.snapshot();
  assert.deepEqual(snapshot.ai, { requests: 1, bytes: 18 });
  const storedText = JSON.stringify([...store.values()]);
  assert.equal(storedText.includes("secret"), false);
  assert.equal(storedText.includes("prompt"), false);

  const disclosure = buildAiDisclosure(
    ai,
    { prompt: "hello world", systemPrompt: "Be concise" },
    snapshot,
    true
  );
  assert.equal(disclosure.networkAllowed, true);
  assert.ok(disclosure.characterCount > 0);
  assert.ok(disclosure.estimatedTokens > 0);
  assert.ok(disclosure.requestBytes > 0);
  assert.equal(disclosure.budgetAllowed, false);
  assert.equal(defaultEmbeddingBudget({ endpoint: "", apiKey: "", model: "", enabled: false, autoIndex: false }).maxRequestBytes, 20_000);

  await ledger.clear();
  assert.equal(ledger.snapshot().ai.bytes, 0);
});

test("AI provider stops before fetch when a configured budget is exceeded", async () => {
  const { IntegrationUsageLedger } = await importBundledModule("src/features/integrations/usage.ts");
  const { runAiPrompt } = await importBundledModule("src/features/integrations/ai-provider.ts");
  const store = new Map();
  const ledger = new IntegrationUsageLedger(storageFrom(store));
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  try {
    const blocked = await runAiPrompt(
      { enabled: true, provider: "openai", endpoint: "https://provider.test", apiKey: "secret", model: "model", maxRequestBytes: 10, dailyRequestBytes: 100 },
      { prompt: "this is much longer than ten bytes" },
      { usage: ledger }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, "budget");
    assert.equal(calls, 0);

    const allowed = await runAiPrompt(
      { enabled: true, provider: "openai", endpoint: "https://provider.test", apiKey: "secret", model: "model", maxRequestBytes: 1000, dailyRequestBytes: 1000 },
      { prompt: "short" },
      { usage: ledger }
    );
    assert.equal(allowed.ok, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic auto-index stops at the record budget and does not send later records", async () => {
  const { IntegrationUsageLedger } = await importBundledModule("src/features/integrations/usage.ts");
  const { SemanticIndex } = await importBundledModule("src/features/integrations/semantic-search.ts");
  const store = new Map();
  const ledger = new IntegrationUsageLedger(storageFrom(store));
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), { status: 200 });
  };
  try {
    const index = new SemanticIndex(storageFrom(store), ledger);
    const result = await index.embedAndIndex(
      { enabled: true, endpoint: "https://embed.test", apiKey: "secret", model: "embed", autoIndex: true, maxRecordBytes: 5, dailyRecordBytes: 6 },
      [record("one", "12345"), record("two", "67890")]
    );
    assert.equal(result.added, 1);
    assert.equal(result.blocked, 1);
    assert.equal(calls, 1);
    assert.equal(ledger.snapshot().embedding.bytes, 5);
    assert.equal(JSON.stringify([...store.values()]).includes("secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function record(tweetId, text) {
  return {
    tweetId,
    handle: "reader",
    displayName: null,
    text,
    capturedAt: "2026-08-12T00:00:00Z",
    surface: "home",
    media: [],
    permalink: null
  };
}

function storageFrom(store) {
  return {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-integration-usage-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
