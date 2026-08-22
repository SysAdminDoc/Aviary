import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("SnapshotStore records, diffs, and clears", async () => {
  const { SnapshotStore, diffSnapshots } = await importSourceModule(
    "src/features/library/snapshots.ts"
  );
  const store = new Map();
  const storage = makeStorage(store);
  const snapshots = new SnapshotStore(storage, 8);
  await snapshots.load();

  await snapshots.record({ kind: "followers", handle: "self", source: "dom", accounts: ["alpha", "beta", "gamma"] });
  await snapshots.record({ kind: "followers", handle: "self", source: "dom", accounts: ["beta", "gamma", "delta"] });

  const diff = snapshots.diffLatest("followers", "self");
  assert.ok(diff);
  assert.deepEqual(diff.added, ["delta"]);
  assert.deepEqual(diff.removed, ["alpha"]);
  assert.equal(diff.unchanged, 2);

  await snapshots.clear();
  assert.equal(snapshots.size(), 0);

  const direct = diffSnapshots(
    { kind: "followers", handle: "x", capturedAt: "2026-05-19T12:00:00Z", source: "dom", accounts: ["a", "b"] },
    { kind: "followers", handle: "x", capturedAt: "2026-05-19T13:00:00Z", source: "dom", accounts: ["b", "c"] }
  );
  assert.deepEqual(direct.added, ["c"]);
  assert.deepEqual(direct.removed, ["a"]);
});

test("readStoreZip round-trips entries produced by buildStoreZip", async () => {
  const { buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
  const { readStoreZip } = await importSourceModule("src/features/export/zip-reader.ts");
  const encoder = new TextEncoder();
  const archive = buildStoreZip([
    { filename: "tweets.js", data: encoder.encode('window.YTD.tweets.part0 = [{"tweet":{"id_str":"1","full_text":"hello"}}]') },
    { filename: "data/like.js", data: encoder.encode('window.YTD.like.part0 = [{"like":{"tweetId":"42","fullText":"liked"}}]') },
    { filename: "manifest.txt", data: encoder.encode("ignored") }
  ]);

  const entries = readStoreZip(archive);
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(entry.crcOk, true, `${entry.filename} should pass CRC`);
  }
});

test("importOfficialArchive parses tweets.js + like.js into ExportRecords", async () => {
  const { buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
  const { importOfficialArchive } = await importSourceModule(
    "src/features/library/archive-import.ts"
  );
  const encoder = new TextEncoder();
  const archive = buildStoreZip([
    {
      filename: "data/tweets.js",
      data: encoder.encode(
        'window.YTD.tweets.part0 = [{"tweet":{"id_str":"100","full_text":"hello world","created_at":"Mon May 19 12:00:00 +0000 2026","user":{"screen_name":"author"},"entities":{"user_mentions":[{"screen_name":"alpha"}]}}}]'
      )
    },
    {
      filename: "data/like.js",
      data: encoder.encode('window.YTD.like.part0 = [{"like":{"tweetId":"200","fullText":"loved it"}}]')
    },
    { filename: "data/manifest.js", data: encoder.encode("ignored") }
  ]);

  const result = await importOfficialArchive(archive, "archive");
  assert.deepEqual(result.errors, []);
  assert.equal(result.records.length, 2);
  const tweet = result.records.find((r) => r.tweetId === "100");
  assert.equal(tweet?.text, "hello world");
  assert.equal(tweet?.handle, "author", "the expanded tweet user is the author, not the first mention");
  const like = result.records.find((r) => r.tweetId === "200");
  assert.equal(like?.text, "loved it");
  assert.ok(like.surface.includes("likes"));
});

test("previewCleanup classifies records into buckets and respects whitelist", async () => {
  const { previewCleanup } = await importSourceModule(
    "src/features/library/cleanup-preview.ts"
  );
  const records = [
    {
      tweetId: "1",
      handle: "alpha",
      displayName: null,
      text: "original",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    },
    {
      tweetId: "2",
      handle: "beta",
      displayName: null,
      text: "RT @alpha cool",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    },
    {
      tweetId: "3",
      handle: "carol",
      displayName: null,
      text: "loved",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "archive.likes",
      media: [],
      permalink: null
    }
  ];

  const preview = previewCleanup(records, { whitelistHandles: ["alpha"] });
  assert.equal(preview.candidates.length, 3);
  assert.equal(preview.byBucket.tweets, 1);
  assert.equal(preview.byBucket.retweets, 1);
  assert.equal(preview.byBucket.likes, 1);
  assert.ok(preview.candidates.find((c) => c.handle === "alpha")?.protected);
});

test("LocalSearchIndex tokenizes and ranks hits", async () => {
  const { LocalSearchIndex } = await importSourceModule(
    "src/features/library/local-search.ts"
  );
  const index = new LocalSearchIndex();
  index.rebuild([
    {
      tweetId: "1",
      handle: "alpha",
      displayName: null,
      text: "RustLang ships new release",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    },
    {
      tweetId: "2",
      handle: "beta",
      displayName: null,
      text: "Go vs Rust benchmarks",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    }
  ]);

  const hits = index.search("rust");
  // "RustLang" tokenizes as one token, so only the second record matches "rust".
  assert.equal(hits.length, 1);
  assert.equal(hits[0].record.tweetId, "2");
  const single = index.search("benchmarks");
  assert.equal(single.length, 1);
  assert.equal(single[0].record.tweetId, "2");
  const phrase = index.search("rust benchmarks");
  assert.equal(phrase.length, 1);
  assert.equal(phrase[0].record.tweetId, "2");
});

test("buildMarkdownReport produces section headers and audit lines", async () => {
  const { buildMarkdownReport } = await importSourceModule(
    "src/features/library/reports.ts"
  );
  const markdown = buildMarkdownReport({
    audit: [
      { at: "2026-05-19T12:00:00Z", action: "media.download", detail: { kind: "photo" } }
    ],
    cleanup: {
      generatedAt: "2026-05-19T12:01:00Z",
      candidates: [
        { bucket: "tweets", tweetId: "1", handle: "alpha", text: "hi", permalink: null, reason: "x", protected: false }
      ],
      byBucket: { tweets: 1, retweets: 0, replies: 0, likes: 0, bookmarks: 0 },
      protectedCount: 0
    }
  });
  assert.match(markdown, /^# Aviary report/);
  assert.match(markdown, /## Audit log/);
  assert.match(markdown, /## Cleanup preview/);
  assert.match(markdown, /media\.download/);
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
