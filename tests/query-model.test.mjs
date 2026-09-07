import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("offline query model searches every local collection with Unicode and filters", async () => {
  const { OfflineQueryIndex, documentFromBookmark, documentFromNote, documentFromSnapshot, parseOfflineQuery } =
    await importSourceModule("src/features/library/query-model.ts");
  const index = new OfflineQueryIndex();
  index.rebuild([
    {
      id: "post-1",
      collection: "posts",
      account: "alice",
      text: "今日は東京で写真を撮りました",
      tags: [],
      folder: null,
      capturedAt: "2026-08-01T00:00:00Z",
      mediaCount: 1
    },
    {
      id: "like-1",
      collection: "likes",
      account: "bob",
      text: "Rust benchmarks",
      tags: [],
      folder: null,
      capturedAt: "2026-08-03T00:00:00Z",
      mediaCount: 0
    },
    documentFromBookmark({
      id: "bm-1",
      tweetId: "42",
      handle: "carol",
      text: "Reading list",
      url: "https://x.com/carol/status/42",
      tags: ["reading"],
      folder: "later",
      remindAt: null,
      notes: "Review this",
      capturedAt: "2026-08-04T00:00:00Z",
      updatedAt: "2026-08-05T00:00:00Z"
    }),
    documentFromNote("dave", "Follow up about the archive"),
    documentFromSnapshot({
      kind: "followers",
      handle: "alice",
      capturedAt: "2026-08-06T00:00:00Z",
      source: "dom",
      accounts: ["bob", "carol"]
    })
  ]);

  assert.equal(index.search("東京")[0]?.document.id, "post-1");
  assert.equal(index.search("source:bookmarks tag:reading")[0]?.document.collection, "bookmarks");
  assert.deepEqual(index.search("has:media").map((hit) => hit.document.id), ["post-1"]);
  assert.deepEqual(index.search("source:likes from:2026-08-02").map((hit) => hit.document.id), ["like-1"]);
  assert.equal(index.search("folder:later review")[0]?.document.id, "bookmark:bm-1");
  assert.equal(index.search("source:notes archive")[0]?.document.id, "note:dave");
  assert.deepEqual(index.search("source:not-a-collection"), []);

  const malformed = parseOfflineQuery(`${"x".repeat(600)} source:posts`);
  assert.equal(malformed.truncated, true);
  assert.ok(malformed.errors.some((error) => error.includes("512")));
  assert.deepEqual(index.search(`${"x".repeat(600)} source:posts`), []);
});

test("lexical ranking puts exact handles and quoted phrases first", async () => {
  const { OfflineQueryIndex, parseOfflineQuery } = await importSourceModule(
    "src/features/library/query-model.ts"
  );
  const index = new OfflineQueryIndex();
  index.rebuild([
    {
      id: "exact-handle",
      collection: "posts",
      account: "rare_handle",
      text: "A short update",
      tags: [],
      folder: null,
      capturedAt: "2026-08-01T00:00:00Z",
      mediaCount: 0
    },
    {
      id: "handle-mentioned-often",
      collection: "posts",
      account: "someone_else",
      text: "rare_handle rare_handle rare_handle wrote a long thread",
      tags: [],
      folder: null,
      capturedAt: "2026-08-02T00:00:00Z",
      mediaCount: 0
    },
    {
      id: "exact-phrase",
      collection: "posts",
      account: "video_archiver",
      text: "How to get the best quality video from a local archive",
      tags: [],
      folder: null,
      capturedAt: "2026-07-01T00:00:00Z",
      mediaCount: 1
    },
    {
      id: "scattered-phrase-terms",
      collection: "posts",
      account: "newer",
      text: "Best video tools compare quality settings. Video quality matters.",
      tags: [],
      folder: null,
      capturedAt: "2026-08-03T00:00:00Z",
      mediaCount: 1
    }
  ]);

  assert.equal(index.search("@rare_handle")[0]?.document.id, "exact-handle");
  assert.equal(index.search('"best quality video"')[0]?.document.id, "exact-phrase");
  assert.deepEqual(parseOfflineQuery('"best quality video"').phrases, ["best quality video"]);
});

test("offline query batches can return more than the interactive 100-result window", async () => {
  const { OfflineQueryIndex } = await importSourceModule(
    "src/features/library/query-model.ts"
  );
  const index = new OfflineQueryIndex();
  index.rebuild(Array.from({ length: 150 }, (_, id) => ({
    id: `record:${id}`,
    collection: "posts",
    account: "alice",
    text: `captured media common ${id}`,
    tags: [],
    folder: null,
    capturedAt: "2026-08-21T12:00:00.000Z",
    mediaCount: 1
  })));

  assert.equal(index.search("common", { limit: 150 }).length, 150);
});

test("quoted phrases cannot span unrelated indexed fields", async () => {
  const { OfflineQueryIndex } = await importSourceModule(
    "src/features/library/query-model.ts"
  );
  const index = new OfflineQueryIndex();
  index.rebuild([{
    id: "field-boundary",
    collection: "posts",
    account: "alice",
    text: "hello",
    tags: ["reading list"],
    folder: "later review",
    capturedAt: "2026-08-01T00:00:00Z",
    mediaCount: 0
  }]);

  assert.deepEqual(index.search('"hello alice"'), []);
  assert.equal(index.search('"reading list"')[0]?.document.id, "field-boundary");
  assert.equal(index.search('"later review"')[0]?.document.id, "field-boundary");
});

test("lexical and semantic results are fused and report both contributing signals", async () => {
  const { documentFromSemanticEntry, fuseOfflineHits } = await importSourceModule(
    "src/features/library/query-model.ts"
  );
  const lexicalDocument = {
    id: "record:42",
    collection: "posts",
    account: "alice",
    text: "Local archive workflow",
    tags: [],
    folder: null,
    capturedAt: "2026-08-01T00:00:00Z",
    mediaCount: 0,
    payload: { tweetId: "42" }
  };
  const lexicalOnly = {
    id: "record:7",
    collection: "posts",
    account: "bob",
    text: "Archive notes",
    tags: [],
    folder: null,
    capturedAt: "2026-08-02T00:00:00Z",
    mediaCount: 0,
    payload: { tweetId: "7" }
  };
  const semanticShared = documentFromSemanticEntry({
    id: "42:Local archive workflow",
    tweetId: "42",
    handle: "alice",
    text: "Local archive workflow",
    vector: [1, 0],
    embeddedAt: "2026-08-01T00:00:00Z"
  });
  const semanticOnly = documentFromSemanticEntry({
    id: "99:Research collection",
    tweetId: "99",
    handle: "carol",
    text: "Research collection",
    vector: [0, 1],
    embeddedAt: "2026-08-03T00:00:00Z"
  });

  const fused = fuseOfflineHits(
    [
      { document: lexicalDocument, score: 4, matchedTerms: ["archive"], snippet: lexicalDocument.text, mode: "lexical" },
      { document: lexicalOnly, score: 2, matchedTerms: ["archive"], snippet: lexicalOnly.text, mode: "lexical" }
    ],
    [
      { document: semanticShared, score: 0.98, matchedTerms: [], snippet: semanticShared.text, mode: "semantic" },
      { document: semanticOnly, score: 0.9, matchedTerms: [], snippet: semanticOnly.text, mode: "semantic" }
    ],
    { limit: 10 }
  );

  assert.equal(fused.find((hit) => hit.document.id === "record:42")?.mode, "hybrid");
  assert.equal(fused.find((hit) => hit.document.id === "record:7")?.mode, "lexical");
  assert.equal(fused.find((hit) => hit.document.id === semanticOnly.id)?.mode, "semantic");
  assert.equal(fused.filter((hit) => hit.document.account === "alice").length, 1, "shared posts must deduplicate");
});

test("Intl.Segmenter finds words in unspaced scripts and the deterministic fallback stays searchable", async () => {
  const {
    OfflineQueryIndex,
    OFFLINE_QUERY_INDEX_VERSION,
    setSearchTokenizerTestSeams,
    tokenizeSearchText
  } = await importSourceModule("src/features/library/query-model.ts");
  const samples = [
    ["วันนี้อากาศดี", "อากาศ"],
    ["ສະບາຍດີໂລກ", "ໂລກ"],
    ["សួស្តីពិភពលោក", "ពិភពលោក"],
    ["မြန်မာစာကောင်း", "စာ"]
  ];

  for (const [text, word] of samples) {
    assert.ok(tokenizeSearchText(text).includes(word), `native segmentation missed ${word}`);
  }

  setSearchTokenizerTestSeams(null);
  try {
    const fallback = new OfflineQueryIndex();
    fallback.rebuild(samples.map(([text], index) => ({
      id: `fallback-${index}`,
      collection: "posts",
      account: "reader",
      text,
      tags: [],
      folder: null,
      capturedAt: "2026-09-07T00:00:00Z",
      mediaCount: 0
    })));
    for (const [, word] of samples) {
      assert.ok(fallback.search(word).length > 0, `fallback segmentation missed ${word}`);
    }
  } finally {
    setSearchTokenizerTestSeams();
  }

  const documents = samples.slice(0, 2).map(([text], index) => ({
    id: `resume-${index}`,
    collection: "posts",
    account: "reader",
    text,
    tags: [],
    folder: null,
    capturedAt: "2026-09-07T00:00:00Z",
    mediaCount: 0
  }));
  const index = new OfflineQueryIndex();
  assert.equal(index.version, OFFLINE_QUERY_INDEX_VERSION);
  let checks = 0;
  let state = index.rebuildResumable(documents, {
    batchSize: 2,
    shouldContinue: () => checks++ < 1
  });
  assert.deepEqual(state, { version: OFFLINE_QUERY_INDEX_VERSION, nextDocument: 1, complete: false });
  state = index.rebuildResumable(documents, { state, batchSize: 2 });
  assert.deepEqual(state, { version: OFFLINE_QUERY_INDEX_VERSION, nextDocument: 2, complete: true });
  assert.equal(index.search("อากาศ")[0]?.document.id, "resume-0");

  const stale = index.rebuildResumable(documents, {
    state: { version: OFFLINE_QUERY_INDEX_VERSION - 1, nextDocument: documents.length, complete: true },
    batchSize: 1
  });
  assert.equal(stale.nextDocument, 1, "an old tokenizer version must rebuild from the first document");
  assert.equal(stale.complete, false);
});
