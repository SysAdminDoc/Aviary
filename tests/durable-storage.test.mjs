import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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

// `aviary.seenPosts.v1` shipped in v1.23.0 and was in none of the three registries below, so it was
// skipped by eager migration, legacy profile adoption, and the library backup — Backup claimed
// completeness over a store it did not carry. Enumerating the declared keys is the only check that
// notices the next one, because nothing else connects a `new Store(KEY)` to the registries.

test("every durable store key declared in src is registered everywhere it must be", async () => {
  const files = await collectSourceFiles(path.join(root, "src"));
  const declared = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    // The shape a store declares itself with: `export const SOMETHING_KEY = "aviary.x.v1";`
    for (const match of source.matchAll(/export const (\w*KEYS?)\s*=\s*"(aviary\.[\w.-]+)"/g)) {
      declared.set(match[2], path.relative(root, file).replaceAll("\\", "/"));
    }
  }
  assert.ok(declared.size >= 15, `expected the store keys, found ${declared.size}`);

  const durable = await readFile(path.join(root, "src/platform/durable-storage.ts"), "utf8");
  const profile = await readFile(path.join(root, "src/platform/profile.ts"), "utf8");
  const backup = await readFile(path.join(root, "src/features/core/library-backup.ts"), "utf8");

  const durableList = durable.slice(
    durable.indexOf("DURABLE_STORAGE_KEYS"),
    durable.indexOf("] as const", durable.indexOf("DURABLE_STORAGE_KEYS"))
  );
  const profileList = profile.slice(
    profile.indexOf("PROFILE_MIGRATION_KEYS"),
    profile.indexOf("] as const", profile.indexOf("PROFILE_MIGRATION_KEYS"))
  );
  const backupList = backup.slice(
    backup.indexOf("LIBRARY_BACKUP_COLLECTIONS"),
    backup.indexOf("] as const", backup.indexOf("LIBRARY_BACKUP_COLLECTIONS"))
  );

  // Not every key belongs in every registry. These are the deliberate exclusions, each naming the
  // reason it is excluded from that specific registry — anything else missing is the seen-posts
  // bug happening again. Adding a key here is a decision; forgetting one is the defect.
  const exempt = {
    // The registry of profiles cannot itself be profile-scoped, and it is what migration reads.
    "aviary.profiles.v1": { durable: "is the profile registry", profile: "is the profile registry", backup: "profile plumbing, not user data" },
    "aviary.profile.active.v1": { durable: "is profile selection", profile: "is profile selection", backup: "profile plumbing, not user data" },
    // Lives in the extension service worker's chrome.storage, not the page StorageGateway, and is
    // derived from settings — it mirrors whether one DNR rule is installed.
    "aviary.runtime.adLoggerRule.v1": { durable: "extension realm, not the page gateway", profile: "extension realm, not the page gateway", backup: "derived runtime state, rebuilt from settings" },
    // Bounded diagnostic observations (64 entries / 30 days) that regenerate as you browse.
    "aviary.adObservations.v1": { backup: "regenerable diagnostics, not user data" },
    // A one-time dismissal flag. A restored backup landing on a fresh profile should show the
    // first-run notice, so carrying the dismissal across would be the wrong behaviour.
    "aviary.firstRun.v1": { backup: "UI dismissal flag, deliberately not carried" },
    // Warnings and errors from earlier page loads; bounded, profile-scoped, and about this
    // install rather than about the user's library.
    "aviary.diagnostics.v1": { backup: "install diagnostics, not user data" }
  };

  const gaps = [];
  for (const [key, file] of declared) {
    const excused = exempt[key] ?? {};
    if (!excused.durable && !durableList.includes(`"${key}"`)) {
      gaps.push(`${key} (${file}) missing from DURABLE_STORAGE_KEYS`);
    }
    if (!excused.profile && !profileList.includes(`"${key}"`)) {
      gaps.push(`${key} (${file}) missing from PROFILE_MIGRATION_KEYS`);
    }
    // The backup list refers to keys by their imported constant, so match on the constant's name.
    const constant = [...(await readFile(path.join(root, file), "utf8")).matchAll(
      /export const (\w*KEYS?)\s*=\s*"(aviary\.[\w.-]+)"/g
    )].find((entry) => entry[2] === key)?.[1];
    if (!excused.backup && constant && !backupList.includes(`${constant},`) && !backupList.includes(`${constant} `)) {
      gaps.push(`${key} (${constant}) missing from LIBRARY_BACKUP_COLLECTIONS`);
    }
  }
  assert.deepEqual(gaps, [], `durable stores are not registered everywhere:\n  ${gaps.join("\n  ")}`);
});

async function collectSourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectSourceFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}
