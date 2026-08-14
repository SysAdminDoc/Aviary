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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-diagnostics-"));
  const entry = path.join(temp, "entry.ts");
  // One bundle: the store and Diagnostics must share module state, not two esbuild copies.
  await writeFile(
    entry,
    `export { Diagnostics } from ${JSON.stringify(abs("src/platform/diagnostics.ts"))};
export * from ${JSON.stringify(abs("src/platform/diagnostics-store.ts"))};`,
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
  if (seed !== undefined) {
    values.set(mod.DIAGNOSTICS_KEY, seed);
  }
  return {
    writes: 0,
    async get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      this.writes += 1;
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
    peek(key) {
      return values.get(key);
    }
  };
}

test("only warnings and errors persist; info would evict the failures beside it", async () => {
  const storage = memoryStorage();
  const store = new mod.DiagnosticsStore(storage);
  await store.load();
  const diagnostics = new mod.Diagnostics();
  diagnostics.setSink((event) => store.record(event));

  diagnostics.info("Aviary booted");
  diagnostics.warn("Extension ad rule failed to sync", { error: "unknown" });
  diagnostics.error("Aviary boot failed", { name: "TypeError", message: "boom" });
  await store.flush();

  const saved = store.snapshot();
  assert.equal(saved.length, 2);
  assert.deepEqual(
    saved.map((entry) => entry.level),
    ["warn", "error"]
  );
  assert.equal(saved[1].reason, "boom");
});

test("detail values never reach storage, only their key names", async () => {
  const storage = memoryStorage();
  const store = new mod.DiagnosticsStore(storage);
  await store.load();

  store.record({
    level: "error",
    at: new Date().toISOString(),
    message: "Storage write failed to save aviary.hiddenPosts.v1",
    details: {
      handle: "@someone",
      url: "https://x.com/someone/status/123",
      postText: "a private post body"
    }
  });
  await store.flush();

  const persisted = JSON.stringify(storage.peek(mod.DIAGNOSTICS_KEY));
  for (const secret of ["@someone", "status/123", "a private post body"]) {
    assert.ok(!persisted.includes(secret), `persisted diagnostics leaked ${secret}`);
  }
  assert.deepEqual(store.snapshot()[0].detailKeys, ["handle", "url", "postText"]);
});

test("a reason string is truncated rather than stored whole", async () => {
  const storage = memoryStorage();
  const store = new mod.DiagnosticsStore(storage);
  await store.load();
  store.record({
    level: "error",
    at: new Date().toISOString(),
    message: "x".repeat(500),
    details: { message: "y".repeat(500) }
  });
  await store.flush();
  const [entry] = store.snapshot();
  assert.equal(entry.message.length, 200);
  assert.equal(entry.reason.length, 200);
});

test("the ring is bounded and keeps the newest entries", async () => {
  const storage = memoryStorage();
  const store = new mod.DiagnosticsStore(storage);
  await store.load();
  for (let i = 0; i < mod.DIAGNOSTICS_LIMIT + 25; i++) {
    store.record({ level: "warn", at: new Date().toISOString(), message: `warning ${i}` });
  }
  await store.flush();
  const saved = store.snapshot();
  assert.equal(saved.length, mod.DIAGNOSTICS_LIMIT);
  assert.equal(saved.at(-1).message, `warning ${mod.DIAGNOSTICS_LIMIT + 24}`);
});

test("stored warnings survive a reload and expired ones are dropped", async () => {
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - mod.DIAGNOSTICS_RETENTION_MS - 60_000).toISOString();
  const storage = memoryStorage({
    version: 1,
    events: [
      { at: stale, level: "error", message: "old failure", detailKeys: [] },
      { at: fresh, level: "warn", message: "recent warning", detailKeys: [] }
    ]
  });
  const store = new mod.DiagnosticsStore(storage);
  const loaded = await store.load();
  assert.deepEqual(
    loaded.map((entry) => entry.message),
    ["recent warning"]
  );
});

test("a malformed payload degrades to empty rather than throwing", async () => {
  for (const seed of [null, 42, "nonsense", { version: 1 }, { events: "no" }, { events: [null, 7] }]) {
    const store = new mod.DiagnosticsStore(memoryStorage(seed));
    assert.deepEqual(await store.load(), []);
  }
});

test("a failing storage backend cannot break the code being diagnosed", async () => {
  const store = new mod.DiagnosticsStore({
    async get() {
      throw new Error("backend down");
    },
    async set() {
      throw new Error("backend down");
    }
  });
  assert.deepEqual(await store.load(), []);
  const diagnostics = new mod.Diagnostics();
  diagnostics.setSink((event) => store.record(event));
  // Neither the sink nor the queued write may surface to the caller.
  diagnostics.error("Aviary boot failed", { message: "boom" });
  await store.flush();
  assert.equal(store.snapshot().length, 1);
});

test("clearing forgets everything and writes the empty ring", async () => {
  const storage = memoryStorage();
  const store = new mod.DiagnosticsStore(storage);
  await store.load();
  store.record({ level: "warn", at: new Date().toISOString(), message: "warning" });
  await store.flush();
  await store.clear();
  assert.deepEqual(store.snapshot(), []);
  assert.deepEqual(storage.peek(mod.DIAGNOSTICS_KEY), { version: 1, events: [] });
});
