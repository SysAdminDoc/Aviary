import { importSourceEntry, importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("durable storage migrates legacy values atomically and reports its backend", async () => {
  const {
    createDurableStorageGateway,
    DURABLE_STORAGE_SCHEMA_VERSION
  } = await importSourceModule("src/platform/durable-storage.ts");
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
  const { createDurableStorageGateway } = await importSourceModule("src/platform/durable-storage.ts");
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
  const { createDurableStorageGateway } = await importSourceModule("src/platform/durable-storage.ts");
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

  // The three registries, read as the arrays they are. Slicing each file between a name and
  // "] as const" broke on any reformat and, worse, silently produced an empty slice if either
  // marker moved -- which would report every key as missing from every registry.
  const registries = await importSourceEntry([
    "src/platform/durable-storage.ts",
    "src/platform/profile.ts",
    "src/features/core/library-backup.ts"
  ]);
  const durableList = registries.DURABLE_STORAGE_KEYS;
  const profileList = registries.PROFILE_MIGRATION_KEYS;
  const backupList = registries.LIBRARY_BACKUP_COLLECTIONS.map((entry) =>
    typeof entry === "string" ? entry : entry.key
  );
  for (const [name, list] of [
    ["DURABLE_STORAGE_KEYS", durableList],
    ["PROFILE_MIGRATION_KEYS", profileList],
    ["LIBRARY_BACKUP_COLLECTIONS", backupList]
  ]) {
    assert.ok(Array.isArray(list) && list.length > 0, `${name} is empty; the check would pass vacuously`);
  }

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
    // The gateway's own reconciliation ledger. Unversioned and legacy-resident on purpose --
    // it records which keys a fallback session wrote, so it cannot live in the backend that
    // failed, and it is consumed and deleted on the next healthy boot.
    "aviary.durable.pending": { durable: "gateway plumbing, legacy realm", profile: "gateway plumbing, legacy realm", backup: "transient reconciliation ledger" },
    // Bounded diagnostic observations (64 entries / 30 days) that regenerate as you browse.
    "aviary.adObservations.v1": { backup: "regenerable diagnostics, not user data" },
    // A one-time dismissal flag. A restored backup landing on a fresh profile should show the
    // first-run notice, so carrying the dismissal across would be the wrong behaviour.
    "aviary.firstRun.v1": { backup: "UI dismissal flag, deliberately not carried" },
    // Warnings and errors from earlier page loads; bounded, profile-scoped, and about this
    // install rather than about the user's library.
    "aviary.diagnostics.v1": { backup: "install diagnostics, not user data" },
    // The private WACZ signing key has its own explicit export. Sweeping it into a routine library
    // backup would turn a data backup into an unmarked identity credential.
    "aviary.waczSigning.v1": { backup: "private signing identity, explicitly exported only" }
  };

  const gaps = [];
  for (const [key, file] of declared) {
    const excused = exempt[key] ?? {};
    if (!excused.durable && !durableList.includes(key)) {
      gaps.push(`${key} (${file}) missing from DURABLE_STORAGE_KEYS`);
    }
    if (!excused.profile && !profileList.includes(key)) {
      gaps.push(`${key} (${file}) missing from PROFILE_MIGRATION_KEYS`);
    }
    if (!excused.backup && !backupList.includes(key)) {
      gaps.push(`${key} (${file}) missing from LIBRARY_BACKUP_COLLECTIONS`);
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

// A transient backend failure used to cost the user that whole session's work. `#fallback()` is
// sticky, so every later write went to legacy — but migration had already emptied legacy, and the
// next healthy boot prefers the backend and skips any key it already holds. The fallback session's
// writes were therefore shadowed by the pre-failure values, forever, with no error anywhere.

class FlakyBackend extends MemoryBackend {
  failing = false;

  #guard() {
    if (this.failing) {
      throw new Error("simulated IndexedDB transaction failure");
    }
  }

  async get(key) {
    this.#guard();
    return super.get(key);
  }

  async put(key, value) {
    this.#guard();
    return super.put(key, value);
  }

  async remove(key) {
    this.#guard();
    return super.remove(key);
  }

  async getMeta() {
    this.#guard();
    return super.getMeta();
  }

  async putMany(entries, meta) {
    this.#guard();
    return super.putMany(entries, meta);
  }
}

test("writes made during a backend failure survive the next healthy boot", async () => {
  const { createDurableStorageGateway, PENDING_WRITES_KEY } =
    await importSourceModule("src/platform/durable-storage.ts");

  const legacy = memoryStorage();
  const backend = new FlakyBackend();

  // Session one, healthy: the value lands in the backend.
  const first = createDurableStorageGateway(legacy, { backend });
  await first.initialize(["aviary.userNotes.v1"]);
  await first.set("aviary.userNotes.v1", { alice: "before" });
  assert.deepEqual(await first.get("aviary.userNotes.v1", null), { alice: "before" });

  // The backend starts failing mid-session; the gateway drops to legacy for the rest of it.
  backend.failing = true;
  await first.set("aviary.userNotes.v1", { alice: "written during the outage" });
  assert.equal(first.getStatus().backend, "indexeddb-fallback");
  assert.equal(first.getStatus().pendingWrites, 1, "the write must be recorded for reconciliation");
  assert.ok(
    (await legacy.get(PENDING_WRITES_KEY, [])).includes("aviary.userNotes.v1"),
    "the ledger belongs in legacy, because the backend is what failed"
  );

  // Session two, healthy again — a fresh gateway over the same stores, as a reload would build.
  backend.failing = false;
  const second = createDurableStorageGateway(legacy, { backend });
  await second.initialize(["aviary.userNotes.v1"]);

  assert.deepEqual(
    await second.get("aviary.userNotes.v1", null),
    { alice: "written during the outage" },
    "the outage write must win — it is the newer one"
  );
  assert.equal(second.getStatus().pendingWrites, 0, "the ledger must be cleared once folded in");
  assert.equal(
    await legacy.get(PENDING_WRITES_KEY, "gone"),
    "gone",
    "a consumed ledger must not linger"
  );
});

test("a removal made during a backend failure is not resurrected", async () => {
  const { createDurableStorageGateway } = await importSourceModule("src/platform/durable-storage.ts");
  const legacy = memoryStorage();
  const backend = new FlakyBackend();

  const first = createDurableStorageGateway(legacy, { backend });
  await first.initialize(["aviary.snapshots.v1"]);
  await first.set("aviary.snapshots.v1", ["kept"]);

  backend.failing = true;
  await first.remove("aviary.snapshots.v1");

  backend.failing = false;
  const second = createDurableStorageGateway(legacy, { backend });
  await second.initialize(["aviary.snapshots.v1"]);
  assert.equal(
    await second.get("aviary.snapshots.v1", "absent"),
    "absent",
    "a delete during the outage must travel too, or the stale copy comes back"
  );
});

/**
 * A corrupted pending-writes value must not take the boot down.
 *
 * `aviary.durable.pending` lives in the legacy realm, which on the localStorage fallback is shared
 * with everything else running on the page. A stored object or number sailed past the
 * `length === 0` early return and then threw `pending is not iterable` out of `initialize()` --
 * which `main.ts` awaits before its own failure guard opens, so the tab was left with no Aviary,
 * no notice, and a page bridge still patching fetch.
 */
test("a corrupted pending-writes value is discarded instead of thrown", async () => {
  const { DurableStorageGateway, PENDING_WRITES_KEY } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );

  for (const corrupt of [{ a: 1 }, 7, true, "oops", [1, 2, 3]]) {
    const legacyStore = new Map([[PENDING_WRITES_KEY, corrupt]]);
    const legacy = {
      async get(key, fallback) {
        return legacyStore.has(key) ? legacyStore.get(key) : fallback;
      },
      async set(key, value) {
        legacyStore.set(key, value);
      },
      async remove(key) {
        legacyStore.delete(key);
      }
    };
    const backendStore = new Map();
    const backend = {
      async get(key) {
        return backendStore.get(key);
      },
      async put(key, value) {
        backendStore.set(key, value);
      },
      async remove(key) {
        backendStore.delete(key);
      },
      async getMeta() {
        return undefined;
      },
      async putMany(entries, meta) {
        for (const [key, value] of entries) backendStore.set(key, value);
        backendStore.set("__aviary_meta__", meta);
      },
      async estimate() {
        return {};
      }
    };

    const gateway = new DurableStorageGateway(legacy, backend, "aviary");
    const status = await gateway.initialize(["aviary.settings.v1"]);
    assert.equal(
      status.backend,
      "indexeddb",
      `a ${typeof corrupt} pending value must not knock the backend out`
    );
    assert.equal(status.pendingWrites, 0);
  }
});
