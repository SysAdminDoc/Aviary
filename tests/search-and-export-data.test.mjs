import { importSourceModule } from "./helpers/source-import.mjs";
import { allowOutbound } from "./helpers/network-policy.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

// Nothing outbound is permitted until a policy is installed, so a spec that drives an integration
// says which posture it is driving under. This file's cases assume Local-only mode is off; the
// ones that assert the refusal install the opposite policy themselves.
await allowOutbound();

const record = (overrides = {}) => ({
  tweetId: "1",
  handle: "someone",
  displayName: "Someone",
  text: "",
  capturedAt: "2026-08-07T00:00:00.000Z",
  surface: "home",
  media: [],
  permalink: "https://x.com/someone/status/1",
  audience: "public",
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

/**
 * The tag line was the one frontmatter value that skipped `yamlScalar`.
 *
 * Every other field was escaped, so the pinned guarantee about display names held while a handle
 * carrying newlines terminated the YAML block from inside the tag and turned the rest of the note
 * into real Markdown headings. `archive-import.ts` takes `user.screen_name` as an arbitrary string,
 * so this is reachable from a crafted archive rather than only from a hand-edited file.
 */
test("a hostile handle cannot break out of the Obsidian frontmatter or the clipboard heading", async () => {
  const { renderForExternalTarget } = await importSourceModule(
    "src/features/export/external-targets.ts"
  );

  const hostile = {
    tweetId: "1",
    handle: "bob\n\n## FAKE SECTION\n\nreal",
    displayName: "Bob\n# Injected",
    text: "ordinary post text",
    capturedAt: "2026-01-16T12:00:00.000Z",
    surface: "home",
    media: [],
    permalink: "https://x.com/i/web/status/1) [PHISH](https://evil.example",
    audience: "public"
  };

  const note = new TextDecoder().decode(
    renderForExternalTarget("obsidian", [hostile]).artifact.data
  );
  const frontmatterFences = note.split("\n").filter((line) => line === "---").length;
  assert.equal(frontmatterFences, 2, `the note must have exactly one frontmatter block:\n${note}`);
  const block = note.slice(note.indexOf("---") + 3, note.indexOf("---", note.indexOf("---") + 3));
  assert.doesNotMatch(block, /^##/m, "no heading may appear inside the frontmatter");
  assert.match(block, /tags: \[#aviary, #x\/bob/, "the tag keeps the readable part of the handle");

  const clipboard = renderForExternalTarget("clipboard-markdown", [hostile]).payload;
  const headings = clipboard.split("\n").filter((line) => line.startsWith("### "));
  assert.equal(headings.length, 1, `one record is one heading:\n${clipboard}`);
  // The permalink used to close its own link early and leave a second attacker-written one behind.
  const links = [...clipboard.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)];
  assert.equal(links.length, 1, `one record is one link:\n${clipboard}`);
  assert.ok(
    links[0][2].startsWith("https://x.com/"),
    `the only link must point at X, saw ${links[0][2]}`
  );
  assert.doesNotMatch(
    clipboard,
    /\]\(https:\/\/evil\.example/,
    `no second destination may survive:\n${clipboard}`
  );

  // The control: an ordinary record still renders normally.
  const clean = new TextDecoder().decode(
    renderForExternalTarget("obsidian", [
      { ...hostile, handle: "bob", displayName: "Bob", permalink: "https://x.com/bob/status/1" }
    ]).artifact.data
  );
  assert.match(clean, /tags: \[#aviary, #x\/bob\]/);
  assert.match(clean, /# Bob/);
});
