import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const record = (overrides = {}) => ({
  tweetId: "1",
  handle: "someone",
  displayName: "Someone",
  text: "",
  capturedAt: "2026-08-07T00:00:00.000Z",
  surface: "home",
  media: [],
  permalink: "https://x.com/someone/status/1",
  ...overrides
});

test("saved-post search finds records in the languages the panel is translated into", async () => {
  const { LocalSearchIndex } = await importSourceModule("src/features/library/local-search.ts");

  const index = new LocalSearchIndex();
  index.rebuild([
    record({ tweetId: "1", text: "今日は東京で写真を撮りました" }),
    record({ tweetId: "2", text: "오늘 서울에서 사진을 찍었습니다" }),
    record({ tweetId: "3", text: "التقطت صورة في القاهرة اليوم" }),
    record({ tweetId: "4", text: "Сегодня я сделал фотографию" }),
    record({ tweetId: "5", text: "Took a photo in London today" })
  ]);

  const ids = (query) => index.search(query).map((hit) => hit.record.tweetId);

  assert.deepEqual(ids("東京"), ["1"], "Japanese must be searchable");
  assert.deepEqual(ids("서울"), ["2"], "Korean must be searchable");
  assert.deepEqual(ids("القاهرة"), ["3"], "Arabic must be searchable");
  assert.deepEqual(ids("фотографию"), ["4"], "Cyrillic must be searchable");
  assert.deepEqual(ids("London"), ["5"], "Latin must still work");
});

test("Korean matching survives a decomposed query (NFC, never NFD)", async () => {
  const { LocalSearchIndex } = await importSourceModule("src/features/library/local-search.ts");

  const index = new LocalSearchIndex();
  index.rebuild([record({ tweetId: "k", text: "서울".normalize("NFC") })]);

  // Hangul decomposes into Jamo, which are letters rather than marks -- an NFD pipeline would
  // index the syllables and fail to match a composed query, or the reverse.
  assert.equal(index.search("서울".normalize("NFD")).length, 1);
  assert.equal(index.search("서울".normalize("NFC")).length, 1);
});

test("the semantic index is bounded and reports what it dropped", async () => {
  const { SemanticIndex, SEMANTIC_INDEX_LIMIT } = await importSourceModule(
    "src/features/integrations/semantic-search.ts"
  );

  const stored = new Map();
  const storage = {
    async get(key, fallback) {
      return stored.has(key) ? stored.get(key) : fallback;
    },
    async set(key, value) {
      stored.set(key, JSON.parse(JSON.stringify(value)));
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ embedding: [0.123456789, -0.987654321, 0.5] }] })
  });

  try {
    const index = new SemanticIndex(storage);
    const overshoot = 5;
    const records = Array.from({ length: SEMANTIC_INDEX_LIMIT + overshoot }, (_, i) =>
      record({ tweetId: String(i), text: `post number ${i}` })
    );
    const result = await index.embedAndIndex(
      { enabled: true, endpoint: "https://embed.test", apiKey: "k", model: "m", autoIndex: false },
      records
    );

    assert.equal(result.dropped, overshoot, "the overflow count must be reported, not hidden");
    assert.equal(index.size(), SEMANTIC_INDEX_LIMIT, "the index must stay bounded");

    // Rounded vectors: full float precision is ~3x the bytes for no retrieval benefit.
    const persisted = stored.get("aviary.semanticIndex.v1");
    assert.deepEqual(persisted.entries[0].vector, [0.12346, -0.98765, 0.5]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic embeddings require finite, non-empty, dimension-consistent vectors", async () => {
  const { SemanticIndex, cosineSimilarity } = await importSourceModule(
    "src/features/integrations/semantic-search.ts"
  );
  const storage = {
    async get(_key, fallback) {
      return fallback;
    },
    async set() {}
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ embedding: [0.1, "not-a-number", 0.3] }] })
  });
  try {
    const index = new SemanticIndex(storage);
    const result = await index.embedAndIndex(
      { enabled: true, endpoint: "https://embed.test", apiKey: "k", model: "m", autoIndex: false },
      [record({ tweetId: "bad-vector", text: "should be rejected" })]
    );
    assert.equal(result.errors, 1);
    assert.equal(index.size(), 0);
    assert.equal(cosineSimilarity([1, Number.NaN], [1, 0]), 0);
    assert.equal(cosineSimilarity([1, 0], [1]), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("semantic query refusal happens before any provider request", async () => {
  const { SemanticIndex } = await importSourceModule(
    "src/features/integrations/semantic-search.ts"
  );
  const storage = {
    async get(_key, _fallback) {
      return {
        model: "m",
        entries: [{
          id: "1:stored",
          tweetId: "1",
          handle: "alice",
          text: "stored locally",
          vector: [1, 0],
          embeddedAt: "2026-08-21T00:00:00.000Z"
        }]
      };
    },
    async set() {}
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("provider request must not run");
  };
  try {
    const index = new SemanticIndex(storage);
    const hits = await index.search(
      { enabled: true, endpoint: "https://embed.test", apiKey: "k", model: "m", autoIndex: false },
      "stored",
      10,
      { allowProviderRequest: false }
    );
    assert.deepEqual(hits, []);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exports never carry a blob: URL that only meant something in the capturing tab", async () => {
  const { renderForExternalTarget } = await importSourceModule(
    "src/features/export/external-targets.ts"
  );
  const { formatExport } = await importSourceModule("src/features/export/formatters.ts");

  const withBlob = [
    record({ media: [{ kind: "video", url: "", type: "video/mp4", width: 1280, height: 720 }] })
  ];
  const decode = (artifact) => new TextDecoder().decode(artifact.data);

  for (const format of ["json", "csv", "markdown", "html"]) {
    assert.ok(!decode(formatExport(format, withBlob)).includes("blob:"), `${format} leaked a blob URL`);
  }
  for (const target of ["obsidian", "notion", "raw-json"]) {
    const rendered = renderForExternalTarget(target, withBlob);
    assert.ok(!decode(rendered.artifact).includes("blob:"), `${target} leaked a blob URL`);
  }
});

test("a display name with YAML metacharacters cannot break or extend the frontmatter", async () => {
  const { renderForExternalTarget } = await importSourceModule(
    "src/features/export/external-targets.ts"
  );

  const hostile = record({
    displayName: 'Someone: "quoted"\ninjected_key: gotcha',
    handle: "someone"
  });
  const markdown = new TextDecoder().decode(
    renderForExternalTarget("obsidian", [hostile]).artifact.data
  );

  const frontmatter = markdown.slice(markdown.indexOf("---"), markdown.indexOf("---", 3));
  assert.ok(
    !/^injected_key:/m.test(frontmatter),
    "a newline in a scraped name must not add a frontmatter key"
  );
  assert.match(frontmatter, /display_name: "Someone: \\"quoted\\" injected_key: gotcha"/);
});
