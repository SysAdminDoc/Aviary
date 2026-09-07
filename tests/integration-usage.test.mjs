import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("integration usage counters enforce request and daily budgets without storing prompts", async () => {
  const {
    IntegrationUsageLedger,
    buildAiDisclosure,
    defaultAiBudget,
    defaultEmbeddingBudget
  } = await importSourceModule("src/features/integrations/usage.ts");
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

test("a budget of zero blocks every request instead of disabling the budget", async () => {
  const { IntegrationUsageLedger, buildAiDisclosure, defaultAiBudget, defaultEmbeddingBudget } =
    await importSourceModule("src/features/integrations/usage.ts");

  const zeroDaily = { enabled: true, provider: "openai", endpoint: "https://provider.test/chat", apiKey: "k", model: "m", maxRequestBytes: 32000, dailyRequestBytes: 0 };
  const zeroRequest = { ...zeroDaily, maxRequestBytes: 0, dailyRequestBytes: 100000 };

  // The guards used to read `limit > 0 && over`, so zero turned the check off entirely -- a user
  // capping spend at zero got unlimited spend. Zero has to fail closed on a spending control.
  const dailyLedger = new IntegrationUsageLedger(storageFrom(new Map()));
  await dailyLedger.load();
  const daily = await dailyLedger.reserveAi(1, defaultAiBudget(zeroDaily));
  assert.equal(daily.allowed, false);
  assert.match(daily.reason, /daily budget is zero/);
  assert.deepEqual(dailyLedger.snapshot().ai, { requests: 0, bytes: 0 }, "a blocked request must not be counted");

  const requestLedger = new IntegrationUsageLedger(storageFrom(new Map()));
  await requestLedger.load();
  const perRequest = await requestLedger.reserveAi(1, defaultAiBudget(zeroRequest));
  assert.equal(perRequest.allowed, false);
  assert.match(perRequest.reason, /per-request budget is zero/);

  // Embeddings share the ledger, so they share the semantics.
  const zeroEmbedding = { enabled: true, endpoint: "https://provider.test/embed", apiKey: "k", model: "m", maxRecordBytes: 0, dailyRecordBytes: 100000 };
  const embeddingLedger = new IntegrationUsageLedger(storageFrom(new Map()));
  await embeddingLedger.load();
  const embedding = await embeddingLedger.reserveEmbedding(1, 1, defaultEmbeddingBudget(zeroEmbedding));
  assert.equal(embedding.allowed, false);

  // The disclosure a user reads before approving has to agree with what the ledger will do.
  const disclosure = buildAiDisclosure(zeroDaily, { prompt: "hi" }, { ai: { requests: 0, bytes: 0 }, embedding: { requests: 0, bytes: 0 } }, true);
  assert.equal(disclosure.budgetAllowed, false);
  assert.match(disclosure.budgetReason, /zero/);
});

test("AI provider stops before fetch when a configured budget is exceeded", async () => {
  const { IntegrationUsageLedger } = await importSourceModule("src/features/integrations/usage.ts");
  const { runAiPrompt } = await importSourceModule("src/features/integrations/ai-provider.ts");
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

test("OpenAI-compatible providers negotiate the completion limit and remember it per endpoint", async () => {
  const { IntegrationUsageLedger } = await importSourceModule("src/features/integrations/usage.ts");
  const { runAiPrompt } = await importSourceModule("src/features/integrations/ai-provider.ts");
  const store = new Map();
  const ledger = new IntegrationUsageLedger(storageFrom(store));
  const originalFetch = globalThis.fetch;
  const bodies = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    bodies.push(JSON.parse(init.body));
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: "unsupported parameter: max_completion_tokens" } }), { status: 400 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  try {
    const config = {
      enabled: true,
      provider: "openai-compatible",
      endpoint: "https://negotiation.test/v1/chat/completions",
      apiKey: "secret",
      model: "reasoning-model",
      maxRequestBytes: 1000,
      dailyRequestBytes: 1000
    };
    const first = await runAiPrompt(config, { prompt: "short" }, { usage: ledger });
    assert.equal(first.ok, true);
    assert.equal(calls, 2);
    assert.equal("max_completion_tokens" in bodies[0], true);
    assert.equal("max_tokens" in bodies[0], false);
    assert.equal(bodies[1].max_tokens, 1024);
    assert.equal(ledger.snapshot().ai.requests, 1);

    const remembered = await runAiPrompt(config, { prompt: "again" });
    assert.equal(remembered.ok, true);
    assert.equal(calls, 3);
    assert.equal("max_tokens" in bodies[2], true);
    assert.equal("max_completion_tokens" in bodies[2], false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unsupported completion-limit pair reports the provider reason", async () => {
  const { runAiPrompt } = await importSourceModule("src/features/integrations/ai-provider.ts");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const parameter = calls === 1 ? "max_completion_tokens" : "max_tokens";
    return new Response(JSON.stringify({ error: { message: `unsupported parameter: ${parameter}` } }), { status: 400 });
  };
  try {
    const result = await runAiPrompt(
      { enabled: true, provider: "openai-compatible", endpoint: "https://neither.test/v1/chat/completions", apiKey: "secret", model: "local" },
      { prompt: "short" }
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /neither max_completion_tokens nor max_tokens is supported/);
    assert.match(result.error, /unsupported parameter: max_tokens/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic auto-index stops at the record budget and does not send later records", async () => {
  const { IntegrationUsageLedger } = await importSourceModule("src/features/integrations/usage.ts");
  const { SemanticIndex } = await importSourceModule("src/features/integrations/semantic-search.ts");
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
