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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-reading-markers-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { ReadingMarkerStore, READING_MARKERS_KEY, READING_MARKER_SURFACES, compareTweetIds } from ${JSON.stringify(abs("src/features/filtering/seen-posts.ts"))};`,
    "utf8"
  );
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
  if (seed !== undefined) values.set(mod.READING_MARKERS_KEY, seed);
  return {
    async get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    peek(key) {
      return values.get(key);
    }
  };
}

test("snowflake comparison keeps ids exact and markers are directional", async () => {
  assert.equal(mod.compareTweetIds("1000000000000000000", "999999999999999999"), 1);
  assert.equal(mod.compareTweetIds("123", "123"), 0);
  const store = new mod.ReadingMarkerStore(memoryStorage());
  await store.load();
  assert.equal(store.advance("home", "300", 10), true);
  assert.equal(store.advance("home", "400", 20), false, "scrolling toward newer posts cannot advance it");
  assert.equal(store.advance("home", "200", 30), true);
  assert.deepEqual(store.get("home"), { lastReadId: "200", updatedAt: 30 });
});

test("markers persist per surface and merge without carrying post content", async () => {
  const storage = memoryStorage();
  const store = new mod.ReadingMarkerStore(storage);
  await store.load();
  store.set("home", "1234567890123456789", 100);
  store.set("profile", "987654321", 101);
  store.flush();
  await store.settled();
  assert.deepEqual(storage.peek(mod.READING_MARKERS_KEY), {
    version: 1,
    markers: {
      home: { lastReadId: "1234567890123456789", updatedAt: 100 },
      profile: { lastReadId: "987654321", updatedAt: 101 }
    }
  });
  assert.deepEqual(Object.keys(storage.peek(mod.READING_MARKERS_KEY).markers), ["home", "profile"]);
});

test("malformed markers are ignored", async () => {
  const store = new mod.ReadingMarkerStore(
    memoryStorage({
      version: 1,
      markers: {
        home: { lastReadId: "not-an-id", updatedAt: 1 },
        status: { lastReadId: "123", updatedAt: "later" }
      }
    })
  );
  await store.load();
  assert.equal(store.get("home"), null);
  assert.equal(store.get("status"), null);
});
