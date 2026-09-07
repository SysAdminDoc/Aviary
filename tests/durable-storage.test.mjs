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
  pending = new Map();
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

  async stagePendingWrite(write) {
    this.pending.set(write.key, structuredClone(write));
  }

  async commitPendingWrite(expected) {
    const write = this.pending.get(expected.key);
    if (!write || write.id !== expected.id) throw new Error("pending marker mismatch");
    if (write.kind === "put") this.values.set(write.key, structuredClone(write.value));
    else this.values.delete(write.key);
    this.pending.delete(write.key);
    return {
      id: write.id,
      key: write.key,
      kind: write.kind,
      valueHash: write.kind === "put" ? await storageValueHash(write.value) : null
    };
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
    // Records the two-phase legacy adoption receipt. It is install-wide metadata, never a profile
    // collection and never part of a user backup.
    "aviary.profile.migration.v1": { profile: "install-wide migration journal", backup: "profile plumbing, not user data" },
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

class OrderedFailureBackend extends MemoryBackend {
  failing = false;

  async put(key, value) {
    if (this.failing) {
      if (value?.version === "A") {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw new Error("simulated ordered transaction failure");
    }
    return super.put(key, value);
  }
}

/** Models the receipt fields the IndexedDB backend commits with each value or tombstone. */
class ReceiptBackend {
  values = new Map();
  pending = new Map();
  meta = undefined;

  async get(key) {
    const record = this.values.get(key);
    return record?.removed ? undefined : record?.value;
  }

  async read(key) {
    const record = this.values.get(key);
    if (!record) return { found: false, removed: false };
    return record.removed
      ? { found: true, removed: true }
      : { found: true, removed: false, value: record.value };
  }

  async put(key, value, _fence, operation) {
    this.values.set(key, {
      key,
      value: structuredClone(value),
      ...(operation ?? {}),
      removed: false
    });
  }

  async remove(key, _fence, operation) {
    this.values.set(key, {
      key,
      value: null,
      ...(operation ?? {}),
      removed: true
    });
  }

  async getMeta() {
    return this.meta;
  }

  async putMany(entries, meta) {
    for (const [key, value] of entries) {
      this.values.set(key, { key, value: structuredClone(value), removed: false });
    }
    this.meta = structuredClone(meta);
  }

  async stagePendingWrite(write) {
    this.pending.set(write.key, structuredClone(write));
  }

  async commitPendingWrite(expected) {
    const write = this.pending.get(expected.key);
    if (!write || write.id !== expected.id) throw new Error("pending marker mismatch");
    const current = this.values.get(write.key);
    const currentOrder = typeof current?.operationOrder === "number"
      ? current.operationOrder
      : -1;
    const pendingOrder = typeof write.operationOrder === "number" ? write.operationOrder : 0;
    const currentDominates = current && current.operationOrder !== undefined && (
      write.operationOrder === undefined ||
      currentOrder > pendingOrder ||
      (currentOrder === pendingOrder && current.operationId >= write.operationId)
    );
    if (!currentDominates) {
      this.values.set(write.key, {
        key: write.key,
        value: write.kind === "put" ? structuredClone(write.value) : null,
        ...(write.operationId ? { operationId: write.operationId } : {}),
        ...(write.operationOrder !== undefined ? { operationOrder: write.operationOrder } : {}),
        removed: write.kind === "remove"
      });
    }
    this.pending.delete(write.key);
    return {
      id: write.id,
      key: write.key,
      kind: write.kind,
      valueHash: write.kind === "put" ? await storageValueHash(write.value) : null
    };
  }

  async estimate() {
    return {};
  }
}

async function storageValueHash(value) {
  const { hashStorageValue } = await importSourceModule("src/platform/storage-value-hash.ts");
  return hashStorageValue(value);
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
    (await legacy.get(PENDING_WRITES_KEY, { entries: [] })).entries.some(
      (entry) => entry.key === "aviary.userNotes.v1" && entry.kind === "put"
    ),
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

test("an older fallback failure cannot replace a newer fallback operation", async () => {
  const { createDurableStorageGateway, PENDING_WRITES_KEY } =
    await importSourceModule("src/platform/durable-storage.ts");
  const key = "aviary.userNotes.v1";
  const legacy = memoryStorage();
  const backend = new OrderedFailureBackend();
  const first = createDurableStorageGateway(legacy, { backend });
  await first.initialize([key]);

  backend.failing = true;
  await Promise.all([
    first.set(key, { version: "A" }),
    first.set(key, { version: "B" })
  ]);

  const ledger = await legacy.get(PENDING_WRITES_KEY, null);
  assert.equal(ledger.entries.length, 1);
  assert.deepEqual(ledger.entries[0].value, { version: "B" });

  backend.failing = false;
  const restarted = createDurableStorageGateway(legacy, { backend });
  await restarted.initialize([key]);
  assert.deepEqual(await restarted.get(key, null), { version: "B" });
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

test("a committed fallback receipt cannot replay over a newer set or tombstone", async () => {
  const { createDurableStorageGateway, PENDING_WRITES_KEY } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );
  const cases = [
    {
      name: "newer set",
      kind: "put",
      seed: { version: "before" },
      newer: { kind: "put", value: { version: "healthy" } },
      expected: { version: "healthy" }
    },
    {
      name: "newer remove",
      kind: "remove",
      seed: { version: "before" },
      newer: { kind: "remove" },
      expected: "absent"
    }
  ];

  for (const scenario of cases) {
    const key = "aviary.userNotes.v1";
    const backend = new ReceiptBackend();
    const legacy = memoryStorage();
    const originalRemove = legacy.remove;
    let failValueCleanup = false;
    legacy.remove = async (candidate) => {
      if (candidate === key && failValueCleanup) {
        failValueCleanup = false;
        throw new Error("simulated legacy cleanup failure");
      }
      return originalRemove(candidate);
    };

    const first = createDurableStorageGateway(legacy, { backend });
    await first.initialize([key]);
    await first.set(key, scenario.seed);
    failValueCleanup = true;
    if (scenario.kind === "put") {
      // The backend commit is acknowledged, but the failed legacy cleanup leaves a replay entry.
      await first.set(key, { version: "fallback" });
    } else {
      await first.remove(key);
    }
    if (scenario.kind === "remove") {
      assert.equal(
        await first.get(key, "absent"),
        "absent",
        "a committed tombstone must not fall back to the stale legacy value"
      );
    }
    const pending = await legacy.get(PENDING_WRITES_KEY, null);
    assert.equal(pending.entries.length, 1, scenario.name);
    assert.equal(typeof pending.entries[0].operationId, "string", scenario.name);
    assert.equal(Number.isSafeInteger(pending.entries[0].operationOrder), true, scenario.name);

    if (scenario.newer.kind === "put") {
      await backend.put(
        key,
        scenario.newer.value,
        undefined,
        { operationId: "healthy-newer", operationOrder: Number.MAX_SAFE_INTEGER - 1 }
      );
    } else {
      await backend.remove(
        key,
        undefined,
        { operationId: "healthy-newer-remove", operationOrder: Number.MAX_SAFE_INTEGER }
      );
    }

    const restarted = createDurableStorageGateway(legacy, { backend });
    await restarted.initialize([key]);
    if (scenario.kind === "put") {
      assert.deepEqual(await restarted.get(key, null), scenario.expected, scenario.name);
    } else {
      assert.equal(await restarted.get(key, "absent"), scenario.expected, scenario.name);
    }
    assert.equal(await legacy.get(PENDING_WRITES_KEY, "gone"), "gone", scenario.name);
    assert.equal(backend.pending.size, 0, scenario.name);
  }
});

test("schema-v2 fallback entries remain recoverable without outranking a durable receipt", async () => {
  const { createDurableStorageGateway, PENDING_WRITES_KEY } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );
  const key = "aviary.userNotes.v1";
  const legacy = memoryStorage({
    [PENDING_WRITES_KEY]: {
      schemaVersion: 2,
      entries: [{ id: "legacy-entry", key, kind: "put", value: { version: "old" } }]
    }
  });
  const backend = new ReceiptBackend();
  await backend.put(
    key,
    { version: "new" },
    undefined,
    { operationId: "aaa", operationOrder: 0 }
  );

  const storage = createDurableStorageGateway(legacy, { backend });
  await storage.initialize([key]);
  assert.deepEqual(await storage.get(key, null), { version: "new" });
  assert.equal(await legacy.get(PENDING_WRITES_KEY, "gone"), "gone");
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

test("the storage model retains the union of simultaneous fallback writes", async () => {
  const { createDurableStorageGateway, PENDING_WRITES_KEY } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );
  const legacyState = new Map();
  const legacy = modelStorage(legacyState);
  const backend = new FlakyBackend();
  const storage = createDurableStorageGateway(legacy, { backend });
  const keys = [
    "aviary.userNotes.v1",
    "aviary.snapshots.v1",
    "aviary.hiddenPosts.v1"
  ];
  await storage.initialize(keys);
  await storage.set(keys[2], { stale: true });

  backend.failing = true;
  await Promise.all([
    storage.set(keys[0], { alice: "one" }),
    storage.set(keys[1], ["snapshot"]),
    storage.remove(keys[2])
  ]);

  const ledger = legacyState.get(PENDING_WRITES_KEY);
  assert.equal(ledger.schemaVersion, 2);
  assert.deepEqual(new Set(ledger.entries.map((entry) => entry.key)), new Set(keys));
  assert.equal(ledger.entries.find((entry) => entry.key === keys[2]).kind, "remove");

  backend.failing = false;
  const restarted = createDurableStorageGateway(legacy, { backend });
  await restarted.initialize(keys);
  assert.deepEqual(await restarted.get(keys[0], null), { alice: "one" });
  assert.deepEqual(await restarted.get(keys[1], null), ["snapshot"]);
  assert.equal(await restarted.get(keys[2], "absent"), "absent");
  assert.equal(legacyState.has(PENDING_WRITES_KEY), false);
});

test("every reconciliation await boundary converges on the latest operation after restart", async (t) => {
  const { createDurableStorageGateway, PENDING_WRITES_KEY } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );
  const crashPoints = [
    "legacy.get.pending.before",
    "legacy.get.pending.after",
    "backend.stage.before",
    "backend.stage.after",
    "backend.commit.before",
    "backend.commit.after",
    "legacy.remove.value.before",
    "legacy.remove.value.after",
    "legacy.remove.pending.before",
    "legacy.remove.pending.after"
  ];
  const key = "aviary.userNotes.v1";

  for (const latestKind of ["put", "remove"]) {
    await t.test(`latest ${latestKind}`, async (kindTest) => {
      for (const crashPoint of crashPoints) {
        await kindTest.test(crashPoint, async () => {
              const firstWrite = latestKind === "put"
                ? { id: "first-remove", key, kind: "remove" }
                : { id: "first-put", key, kind: "put", value: { version: "intermediate" } };
              const latestWrite = latestKind === "put"
                ? { id: "latest-put", key, kind: "put", value: { version: "latest" } }
                : { id: "latest-remove", key, kind: "remove" };
              const legacyState = new Map([[PENDING_WRITES_KEY, pendingLedger(firstWrite)]]);
              const backendState = {
                values: new Map([[key, { version: "before" }]]),
                pending: new Map(),
                meta: undefined
              };
              const fault = new FaultOnce(crashPoint);
              const interrupted = createDurableStorageGateway(
                modelStorage(legacyState, fault),
                { backend: new CrashableBackend(backendState, fault) }
              );

              await interrupted.initialize([key]);
              assert.equal(fault.triggered, true, `${crashPoint} was not exercised`);

              // A write that arrives after the interrupted attempt is the authority. A staged old
              // marker must not overwrite it when a fresh page and worker reconcile on restart.
              legacyState.set(PENDING_WRITES_KEY, pendingLedger(latestWrite));
              const restarted = createDurableStorageGateway(modelStorage(legacyState), {
                backend: new CrashableBackend(backendState)
              });
              const status = await restarted.initialize([key]);

              assert.equal(status.backend, "indexeddb");
              assert.equal(status.pendingWrites, 0);
              if (latestKind === "put") {
                assert.deepEqual(await restarted.get(key, null), { version: "latest" });
              } else {
                assert.equal(await restarted.get(key, "absent"), "absent");
              }
              assert.equal(backendState.pending.size, 0, "the transaction left a staged marker");
              assert.equal(legacyState.has(PENDING_WRITES_KEY), false);
        });
      }
    });
  }
});

class FaultOnce {
  triggered = false;

  constructor(target) {
    this.target = target;
  }

  hit(point) {
    if (!this.triggered && point === this.target) {
      this.triggered = true;
      throw new Error(`simulated crash at ${point}`);
    }
  }
}

class CrashableBackend {
  constructor(state, fault = undefined) {
    this.state = state;
    this.fault = fault;
  }

  async get(key) {
    return this.state.values.has(key) ? structuredClone(this.state.values.get(key)) : undefined;
  }

  async put(key, value) {
    this.state.values.set(key, structuredClone(value));
  }

  async remove(key) {
    this.state.values.delete(key);
  }

  async getMeta() {
    return this.state.meta ? structuredClone(this.state.meta) : undefined;
  }

  async putMany(entries, meta) {
    for (const [key, value] of entries) this.state.values.set(key, structuredClone(value));
    this.state.meta = structuredClone(meta);
  }

  async stagePendingWrite(write) {
    this.fault?.hit("backend.stage.before");
    this.state.pending.set(write.key, structuredClone(write));
    this.fault?.hit("backend.stage.after");
  }

  async commitPendingWrite(expected) {
    this.fault?.hit("backend.commit.before");
    const write = this.state.pending.get(expected.key);
    if (!write || write.id !== expected.id) throw new Error("pending marker mismatch");
    const nextValues = new Map(this.state.values);
    const nextPending = new Map(this.state.pending);
    if (write.kind === "put") nextValues.set(write.key, structuredClone(write.value));
    else nextValues.delete(write.key);
    nextPending.delete(write.key);
    this.state.values = nextValues;
    this.state.pending = nextPending;
    this.fault?.hit("backend.commit.after");
    return {
      id: write.id,
      key: write.key,
      kind: write.kind,
      valueHash: write.kind === "put" ? await storageValueHash(write.value) : null
    };
  }

  async estimate() {
    return {};
  }
}

function modelStorage(values, fault = undefined) {
  return {
    async get(key, fallback) {
      if (key === "aviary.durable.pending") fault?.hit("legacy.get.pending.before");
      const value = values.has(key) ? structuredClone(values.get(key)) : fallback;
      if (key === "aviary.durable.pending") fault?.hit("legacy.get.pending.after");
      return value;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      const label = key === "aviary.durable.pending" ? "pending" : "value";
      fault?.hit(`legacy.remove.${label}.before`);
      values.delete(key);
      fault?.hit(`legacy.remove.${label}.after`);
    }
  };
}

function pendingLedger(...entries) {
  return { schemaVersion: 2, entries: structuredClone(entries) };
}

/**
 * Eviction exemption, asked for once and re-read every time.
 *
 * `unlimitedStorage` in the manifest is the permission half. This is the runtime half, and the two
 * are not interchangeable: without either, the browser treats the whole local library as
 * best-effort and clears it under disk pressure without asking. The two halves of the contract
 * that matter are that the *request* happens once (a user who declined must not be re-prompted on
 * every status refresh) and that the *answer* is never cached (the browser can revoke it, and
 * reporting a stale "persisted" is the exact false assurance this exists to remove).
 */
async function withFakeStorageManager(storage, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: storage === null ? undefined : { storage }
  });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  }
}

/** Never settles: `estimate()` does not await the database, so opening one is not needed here. */
const IDLE_IDB_FACTORY = { open: () => ({}) };

test("the background asks for eviction exemption once and reports the live answer", async () => {
  const { IndexedDbStorageBackend } = await importSourceModule("src/platform/durable-storage.ts");
  let persisted = false;
  let persistCalls = 0;
  let persistedCalls = 0;
  const manager = {
    async estimate() {
      return { usage: 512, quota: 4096 };
    },
    async persisted() {
      persistedCalls += 1;
      return persisted;
    },
    async persist() {
      persistCalls += 1;
      persisted = true;
      return true;
    }
  };

  await withFakeStorageManager(manager, async () => {
    const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);

    const first = await backend.estimate();
    assert.equal(first.persisted, true, "a granted request must be reported as persisted");
    assert.deepEqual(
      { usage: first.usage, quota: first.quota },
      { usage: 512, quota: 4096 },
      "the measured figures must survive the persistence check"
    );
    assert.equal(persistCalls, 1);

    await backend.estimate();
    assert.equal(persistCalls, 1, "the request must not be repeated on every status refresh");
    assert.equal(persistedCalls, 2, "but the answer must be re-read, not cached");

    // The browser revokes it. Aviary must stop claiming the library is safe.
    persisted = false;
    const third = await backend.estimate();
    assert.equal(third.persisted, false, "a revoked exemption must be reported as best effort");
    assert.equal(persistCalls, 1, "and must still not re-prompt");
  });
});

test("an already-persisted origin is never asked again, and a refusal is not fatal", async () => {
  const { IndexedDbStorageBackend } = await importSourceModule("src/platform/durable-storage.ts");

  let persistCalls = 0;
  await withFakeStorageManager(
    {
      async estimate() {
        return {};
      },
      async persisted() {
        return true;
      },
      async persist() {
        persistCalls += 1;
        return true;
      }
    },
    async () => {
      const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);
      assert.equal((await backend.estimate()).persisted, true);
      assert.equal(persistCalls, 0, "an origin that is already exempt must not be asked");
    }
  );

  // A browser that throws is "unknown", never "persisted", and must not take the caller down.
  await withFakeStorageManager(
    {
      async estimate() {
        return { usage: 1 };
      },
      async persisted() {
        throw new Error("storage manager unavailable");
      }
    },
    async () => {
      const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);
      const result = await backend.estimate();
      assert.equal(result.persisted, undefined, "a thrown answer must read as unknown");
      assert.equal(result.usage, 1, "and must not discard the measurement beside it");
    }
  );

  // No storage manager at all is the userscript-shaped case: unknown, not a crash.
  await withFakeStorageManager(null, async () => {
    const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);
    assert.deepEqual(await backend.estimate(), {}, "a browser without the API reports nothing");
  });
});

test("the gateway turns the backend's persistence answer into a stated status", async () => {
  const { createDurableStorageGateway } = await importSourceModule("src/platform/durable-storage.ts");
  const cases = [
    [true, "persisted"],
    [false, "best-effort"],
    [undefined, "unknown"]
  ];

  for (const [persisted, expected] of cases) {
    const backend = new MemoryBackend();
    backend.estimate = async () => (persisted === undefined ? { usage: 8 } : { usage: 8, persisted });
    const storage = createDurableStorageGateway(memoryStorage({}), { backend });
    await storage.initialize([]);
    const status = await storage.refreshEstimate();
    assert.equal(status.persistence, expected, `persisted=${persisted} must report ${expected}`);
  }
});

/**
 * The measured shape of a real MV3 service worker, on 2026-09-05.
 *
 * navigator.storage.persist does not exist in a worker; it is a Window-only API. And persisted()
 * answers false even once Chrome has granted unlimitedStorage. The permission is the exemption
 * Chrome documents, while the Storage Standard bit is a separate mechanism it does not set for
 * extension origins. Reading persistence off persisted() alone would tell every extension user
 * their library is one disk-pressure event from deletion when it is not.
 */
test("a granted unlimitedStorage permission counts as persisted where persist() does not exist", async () => {
  const { IndexedDbStorageBackend } = await importSourceModule("src/platform/durable-storage.ts");
  const workerShapedManager = {
    async estimate() {
      return { usage: 28788, quota: 620956549236 };
    },
    async persisted() {
      return false;
    }
  };

  const previousChrome = globalThis.chrome;
  try {
    globalThis.chrome = {
      runtime: { id: "packaged-extension" },
      permissions: {
        async contains(request) {
          return request.permissions?.includes("unlimitedStorage") === true;
        }
      }
    };
    await withFakeStorageManager(workerShapedManager, async () => {
      const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);
      const result = await backend.estimate();
      assert.equal(result.persisted, true, "a granted exemption must not read as best effort");
      assert.equal(result.quota, 620956549236, "and the real quota must survive the check");
    });

    // Without the permission there is no exemption to report, and no persist() to ask with.
    globalThis.chrome = {
      runtime: { id: "packaged-extension" },
      permissions: {
        async contains() {
          return false;
        }
      }
    };
    await withFakeStorageManager(workerShapedManager, async () => {
      const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);
      assert.equal(
        (await backend.estimate()).persisted,
        false,
        "an unexempt worker must report best effort rather than unknown"
      );
    });
  } finally {
    if (previousChrome) globalThis.chrome = previousChrome;
    else delete globalThis.chrome;
  }
});

/**
 * The receiver bug: estimate has to be invoked on navigator.storage. Calling it with navigator
 * throws "Illegal invocation" in every real browser, and refreshEstimate swallowed that, so Trust
 * showed no usage or quota in the packaged extension at all.
 */
test("estimate is invoked on the storage manager, not on navigator", async () => {
  const { IndexedDbStorageBackend } = await importSourceModule("src/platform/durable-storage.ts");
  const manager = {
    async estimate() {
      if (this !== manager) throw new TypeError("Illegal invocation");
      return { usage: 7, quota: 9 };
    },
    async persisted() {
      return true;
    }
  };
  await withFakeStorageManager(manager, async () => {
    const backend = new IndexedDbStorageBackend(IDLE_IDB_FACTORY);
    const result = await backend.estimate();
    assert.equal(result.usage, 7, "usage was lost to an illegal invocation");
    assert.equal(result.quota, 9, "quota was lost to an illegal invocation");
  });
});
