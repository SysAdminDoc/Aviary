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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-seen-posts-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(entry, `export * from ${JSON.stringify(abs("src/features/filtering/seen-posts.ts"))};`, "utf8");
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

function memoryStorage(seed = undefined) {
  const values = new Map();
  if (seed !== undefined) values.set(mod.SEEN_POSTS_KEY, seed);
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

test("a post is remembered on first sight and reported as seen after that", async () => {
  const store = new mod.SeenPostStore(memoryStorage());
  await store.load();
  const now = Date.now();

  assert.equal(store.has("1234567890"), false);
  assert.equal(store.mark("1234567890", now), true, "first mark is a new sighting");
  assert.equal(store.has("1234567890"), true);
  assert.equal(store.mark("1234567890", now), false, "a repeat mark is not a new sighting");
});

test("only post-id-shaped values are accepted", async () => {
  const store = new mod.SeenPostStore(memoryStorage());
  await store.load();
  const now = Date.now();
  for (const bad of ["", "abc", "12a34", "../etc", "12345678901234567890123456"]) {
    assert.equal(store.mark(bad, now), false, `${bad} must be rejected`);
  }
  assert.equal(store.size, 0);
});

test("nothing but ids and timestamps reaches storage", async () => {
  const storage = memoryStorage();
  const store = new mod.SeenPostStore(storage);
  await store.load();
  const now = Date.now();
  store.mark("1111111111", now);
  store.flush(now);
  await store.settled();

  const payload = storage.peek(mod.SEEN_POSTS_KEY);
  assert.deepEqual(Object.keys(payload), ["version", "seen"]);
  assert.deepEqual(Object.keys(payload.seen), ["1111111111"]);
  assert.equal(typeof payload.seen["1111111111"], "number");
});

test("the store is bounded and drops the oldest ids first", async () => {
  const storage = memoryStorage();
  const store = new mod.SeenPostStore(storage);
  await store.load();
  const now = Date.now();
  const total = mod.SEEN_POSTS_LIMIT + 50;
  for (let i = 0; i < total; i++) {
    store.mark(String(1_000_000_000 + i), now);
  }
  store.flush(now);
  await store.settled();

  assert.equal(store.size, mod.SEEN_POSTS_LIMIT);
  assert.equal(store.has(String(1_000_000_000)), false, "the oldest id must be evicted");
  assert.equal(store.has(String(1_000_000_000 + total - 1)), true, "the newest id must survive");
});

test("entries older than the retention window are dropped on load", async () => {
  const fresh = Date.now();
  const stale = fresh - mod.SEEN_POSTS_RETENTION_MS - 60_000;
  const store = new mod.SeenPostStore(
    memoryStorage({ version: 1, seen: { "2222222222": stale, "3333333333": fresh } })
  );
  await store.load();
  assert.equal(store.has("2222222222"), false);
  assert.equal(store.has("3333333333"), true);
});

test("a malformed payload degrades to empty rather than throwing", async () => {
  for (const seed of [null, 7, "nope", { seen: "no" }, { version: 1, seen: { bad: "x" } }]) {
    const store = new mod.SeenPostStore(memoryStorage(seed));
    await store.load();
    assert.equal(store.size, 0);
  }
});

test("a failing backend cannot break the caller", async () => {
  const store = new mod.SeenPostStore({
    async get() {
      throw new Error("down");
    },
    async set() {
      throw new Error("down");
    }
  });
  await store.load();
  const now = Date.now();
  store.mark("4444444444", now);
  store.flush(now);
  await store.settled();
  assert.equal(store.has("4444444444"), true, "the in-memory view stays usable");
});

test("clearing forgets everything", async () => {
  const storage = memoryStorage();
  const store = new mod.SeenPostStore(storage);
  await store.load();
  store.mark("5555555555", Date.now());
  await store.clear();
  assert.equal(store.size, 0);
  assert.deepEqual(storage.peek(mod.SEEN_POSTS_KEY), { version: 1, seen: {} });
});
