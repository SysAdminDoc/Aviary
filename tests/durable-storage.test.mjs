import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("durable storage migrates legacy values atomically and reports its backend", async () => {
  const {
    createDurableStorageGateway,
    DURABLE_STORAGE_SCHEMA_VERSION
  } = await importBundledModule("src/platform/durable-storage.ts");
  const legacy = memoryStorage({ "aviary.library.bookmarks.v1": { entries: [{ id: "b1" }] } });
  const backend = new MemoryBackend();
  const storage = createDurableStorageGateway(legacy, { backend });

  const status = await storage.initialize(["aviary.library.bookmarks.v1"]);

  assert.equal(status.backend, "indexeddb");
  assert.equal(status.schemaVersion, DURABLE_STORAGE_SCHEMA_VERSION);
  assert.equal(status.migratedKeys, 1);
  assert.deepEqual(backend.values.get("aviary.library.bookmarks.v1"), { entries: [{ id: "b1" }] });
  assert.equal(legacy.values.has("aviary.library.bookmarks.v1"), false);
  assert.deepEqual(
    await storage.get("aviary.library.bookmarks.v1", { entries: [] }),
    { entries: [{ id: "b1" }] }
  );
  assert.equal(backend.meta.schemaVersion, DURABLE_STORAGE_SCHEMA_VERSION);
});

test("durable storage keeps small unversioned values on the legacy gateway", async () => {
  const { createDurableStorageGateway } = await importBundledModule("src/platform/durable-storage.ts");
  const legacy = memoryStorage();
  const backend = new MemoryBackend();
  const storage = createDurableStorageGateway(legacy, { backend });

  await storage.set("aviary.retention.maxJobs", 4);
  await storage.set("aviary.queryIds.v1", { queries: { Home: "q1" } });

  assert.equal(legacy.values.get("aviary.retention.maxJobs"), 4);
  assert.equal(backend.values.get("aviary.queryIds.v1").queries.Home, "q1");
  await storage.remove("aviary.queryIds.v1");
  assert.equal(backend.values.has("aviary.queryIds.v1"), false);
});

test("durable storage falls back cleanly when IndexedDB is unavailable", async () => {
  const { createDurableStorageGateway } = await importBundledModule("src/platform/durable-storage.ts");
  const legacy = memoryStorage();
  const storage = createDurableStorageGateway(legacy, { backend: null });

  await storage.initialize();
  await storage.set("aviary.library.bookmarks.v1", { entries: [{ id: "legacy" }] });

  assert.equal(storage.getStatus().backend, "legacy");
  assert.deepEqual(
    await storage.get("aviary.library.bookmarks.v1", { entries: [] }),
    { entries: [{ id: "legacy" }] }
  );
});

class MemoryBackend {
  values = new Map();
  meta = undefined;

  async get(key) {
    return this.values.get(key);
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }

  async remove(key) {
    this.values.delete(key);
  }

  async getMeta() {
    return this.meta;
  }

  async putMany(entries, meta) {
    for (const [key, value] of entries) {
      this.values.set(key, structuredClone(value));
    }
    this.meta = structuredClone(meta);
  }

  async estimate() {
    return { usage: this.values.size * 100, quota: 10_000 };
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-durable-"));
  const outfile = path.join(temp, "module.mjs");

  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
