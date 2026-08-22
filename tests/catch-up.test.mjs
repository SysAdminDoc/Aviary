import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let mod;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-catch-up-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(entry, `export * from ${JSON.stringify(abs("src/features/filtering/catch-up.ts"))};`, "utf8");
  const outfile = path.join(temp, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  mod = await import(pathToFileURL(outfile).href);
});

after(async () => {
  await rm(temp, { recursive: true, force: true });
});

function storage(seed) {
  const values = new Map(seed ? [[mod.CATCH_UP_KEY, seed]] : []);
  return {
    async get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
    peek(key) {
      return values.get(key);
    }
  };
}

function record(id, seenAt, overrides = {}) {
  return {
    tweetId: id,
    handle: overrides.handle ?? "alice",
    displayName: "Alice",
    text: overrides.text ?? "a short post",
    permalink: `https://x.com/alice/status/${id}`,
    articleUrl: overrides.articleUrl ?? null,
    capturedAt: new Date(seenAt).toISOString(),
    seenAt,
    surface: "home",
    category: overrides.category ?? "original",
    filterReason: overrides.filterReason ?? null,
    media: overrides.media ?? [],
    metrics: overrides.metrics ?? { replies: 0, likes: 0, reposts: 0 }
  };
}

test("catch-up digest uses local records, window boundaries, categories, and author counts", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const entries = [
    record("1001", now - 20 * 60 * 1000, { handle: "alice", articleUrl: "https://example.com/story" }),
    record("1002", now - 30 * 60 * 1000, { handle: "bob", category: "filtered", filterReason: "Hidden by your keyword: crypto" }),
    record("1003", now - 3 * 60 * 60 * 1000, { handle: "alice", category: "replies", text: "a much longer reply with enough words to make density higher" }),
    record("1004", now - 20 * 24 * 60 * 60 * 1000, { handle: "carol", category: "quotes" }),
    record("1005", now - 14 * 60 * 60 * 1000, { handle: "dave", category: "original" })
  ];

  const digest = mod.buildCatchUpDigest(entries, { now, windowHours: 1 });
  assert.deepEqual(digest.records.map((entry) => entry.tweetId), ["1001"]);
  assert.deepEqual(digest.counts, { all: 1, original: 1, replies: 0, quotes: 0, reposts: 0, filtered: 1 });
  assert.deepEqual(digest.authors, [{ handle: "alice", count: 1 }]);

  const filtered = mod.buildCatchUpDigest(entries, { now, windowHours: 1, category: "filtered" });
  assert.deepEqual(filtered.records.map((entry) => entry.tweetId), ["1002"]);
  assert.equal(filtered.records[0].filterReason, "Hidden by your keyword: crypto");

  const older = mod.buildCatchUpDigest(entries, { now, windowHours: 13, category: "all", sort: "oldest" });
  assert.deepEqual(older.records.map((entry) => entry.tweetId), ["1004", "1005"]);
});

test("catch-up store preserves first-seen time while refreshing rendered content", async () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const target = storage();
  const store = new mod.CatchUpStore(target);
  await store.load(now);
  store.upsert(record("2001", now - 5 * 60 * 1000, { text: "first render" }));
  store.flush(now);
  await store.settled();

  store.upsert(record("2001", now, { text: "updated render", category: "replies" }));
  store.flush(now);
  await store.settled();

  const saved = store.list()[0];
  assert.equal(saved.text, "updated render");
  assert.equal(saved.category, "replies");
  assert.equal(saved.seenAt, now - 5 * 60 * 1000);
  assert.equal(target.peek(mod.CATCH_UP_KEY).entries.length, 1);
});

test("catch-up store drops stale entries on load and keeps the transport bounded", async () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const stale = record("3001", now - mod.CATCH_UP_RETENTION_MS - 1);
  const fresh = record("3002", now - 1_000);
  const store = new mod.CatchUpStore(storage({ version: 1, entries: [stale, fresh] }));
  await store.load(now);
  assert.deepEqual(store.list().map((entry) => entry.tweetId), ["3002"]);

  const bounded = new mod.CatchUpStore(storage(), 64);
  await bounded.load(now);
  for (let index = 0; index < 80; index += 1) {
    bounded.upsert(record(String(4_000 + index), now - (80 - index) * 1_000));
  }
  bounded.flush(now);
  await bounded.settled();
  assert.equal(bounded.size, 64);
  assert.equal(bounded.list()[0].tweetId, "4016");
});
