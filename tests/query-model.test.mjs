import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("offline query model searches every local collection with Unicode and filters", async () => {
  const { OfflineQueryIndex, documentFromBookmark, documentFromNote, documentFromSnapshot, parseOfflineQuery } =
    await importBundledModule("src/features/library/query-model.ts");
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
  const { OfflineQueryIndex, parseOfflineQuery } = await importBundledModule(
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

test("lexical and semantic results are fused and report both contributing signals", async () => {
  const { documentFromSemanticEntry, fuseOfflineHits } = await importBundledModule(
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

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-query-model-"));
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
    return await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
