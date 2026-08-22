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
  // Renamed from added/removed/unchanged. Those words claimed the difference was a follow or an
  // unfollow, which a DOM capture cannot know; these say only which capture a handle appeared in.
  assert.deepEqual(diff.onlyLater, ["delta"]);
  assert.deepEqual(diff.onlyEarlier, ["alpha"]);
  assert.equal(diff.inBoth, 2);
  assert.equal(diff.partial, true, "neither capture recorded reaching the end of the list");

  await snapshots.clear();
  assert.equal(snapshots.size(), 0);

  const direct = diffSnapshots(
    { kind: "followers", handle: "x", capturedAt: "2026-05-19T12:00:00Z", source: "dom", accounts: ["a", "b"] },
    { kind: "followers", handle: "x", capturedAt: "2026-05-19T13:00:00Z", source: "dom", accounts: ["b", "c"] }
  );
  assert.deepEqual(direct.onlyLater, ["c"]);
  assert.deepEqual(direct.onlyEarlier, ["a"]);
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

/**
 * A field that states what a post is beats a guess at how its text begins.
 *
 * The classifier read the first characters of the text and then stated the result as fact in the
 * downloadable report -- "Reply to another account". The archive import already fills `parentId`
 * from `in_reply_to_status_id_str` and the classifier ignored it, so a post that merely opened
 * with a handle was reported as a reply, and a real reply that opened with a word was reported as
 * an original post.
 */
test("cleanup preview classifies from the record, and says so when it is guessing", async () => {
  const { previewCleanup } = await importSourceModule("src/features/library/cleanup-preview.ts");

  const record = (over) => ({
    tweetId: "1",
    handle: "someone",
    displayName: "Someone",
    text: "a post",
    permalink: "https://x.com/someone/status/1",
    capturedAt: "2026-08-01T00:00:00.000Z",
    surface: "home",
    media: [],
    ...over
  });

  // A reply that does not look like one.
  const stated = previewCleanup([record({ text: "thanks, that helped", parentId: "900" })], {});
  assert.equal(stated.candidates[0].bucket, "replies");
  assert.equal(stated.candidates[0].reason, "Reply to another account");

  // A post that looks like a reply and carries nothing saying it is one.
  const guessed = previewCleanup([record({ text: "@someone else entirely" })], {});
  assert.equal(guessed.candidates[0].bucket, "replies");
  assert.match(
    guessed.candidates[0].reason,
    /Looks like a reply/,
    "a guess must be presented as a guess"
  );

  // An empty parentId is not a parent.
  const empty = previewCleanup([record({ text: "@someone else", parentId: "" })], {});
  assert.match(empty.candidates[0].reason, /Looks like a reply/);

  // And a real reply is not re-read as a repost because of how it starts.
  const repostShaped = previewCleanup([record({ text: "RT @someone: hello", parentId: "900" })], {});
  assert.equal(
    repostShaped.candidates[0].bucket,
    "replies",
    "the field states what this is; the text only suggests"
  );

  // The repost guess is still available, and still marked as one.
  const repost = previewCleanup([record({ text: "RT @someone: hello" })], {});
  assert.equal(repost.candidates[0].bucket, "retweets");
  assert.match(repost.candidates[0].reason, /Looks like reposted content/);
});
