import { reportStorageError, type StorageGateway, type StorageStatus } from "./storage.ts";
import { withStorageLock } from "./storage-lock.ts";
import { hashStorageValue } from "./storage-value-hash.ts";
import {
  inferStorageFence,
  isStorageFenceError,
  isStorageLockFence,
  StorageFenceLostError,
  type StorageLockFence
} from "./storage-fence.ts";

export const DURABLE_STORAGE_SCHEMA_VERSION = 1;

/**
 * Keys written into the legacy store while the durable backend was unavailable. Lives in legacy
 * rather than the backend for the obvious reason: the backend is what failed.
 */
// Deliberately unversioned: `#isDurable` routes any `aviary.*.vN` key to the backend, and this
// one must stay in the legacy realm. The name says which realm it belongs to.
export const PENDING_WRITES_KEY = "aviary.durable.pending";
export const PENDING_WRITES_SCHEMA_VERSION = 2;
const PENDING_WRITES_LOCK = "durable.pending-writes";
const DURABLE_PENDING_MARKER_PREFIX = "__aviary_pending__:";

/** Base stores seed migration; legacy-key enumeration also discovers every dynamic profile key. */
export const DURABLE_STORAGE_KEYS = [
  "aviary.profiles.v1",
  "aviary.profile.active.v1",
  "aviary.profile.migration.v1",
  "aviary.settings.v1",
  "aviary.integration.usage.v1",
  "aviary.export.checkpoints.v1",
  "aviary.queryIds.v1",
  "aviary.media.history.v1",
  "aviary.media.queue.v1",
  "aviary.aria2.history.v1",
  "aviary.hiddenPosts.v1",
  "aviary.seenPosts.v1",
  "aviary.readingMarkers.v1",
  "aviary.catchUp.v1",
  "aviary.media.last-download.v1",
  "aviary.cleanupQueue.v1",
  "aviary.userNotes.v1",
  "aviary.audit.v1",
  "aviary.firstRun.v1",
  "aviary.diagnostics.v1",
  "aviary.background.diagnostics.v1",
  "aviary.adObservations.v1",
  "aviary.library.bookmarks.v1",
  "aviary.snapshots.v1",
  "aviary.library.underTheHood.v1",
  "aviary.semanticIndex.v1",
  "aviary.archive.imports.v1",
  "aviary.archive.library.v1",
  "aviary.waczSigning.v1"
] as const;

export interface DurableStorageEstimate {
  usage?: number;
  quota?: number;
  /**
   * Whether this origin's storage is exempt from eviction, or `undefined` where the browser does
   * not answer. Best-effort storage is the default everywhere, and a browser under disk pressure
   * clears it without asking, which for Aviary means the whole local library.
   */
  persisted?: boolean;
}

export interface DurableStorageMeta {
  schemaVersion: number;
  migratedKeys: string[];
  migratedAt: string | null;
}

export interface DurablePendingWrite {
  id: string;
  key: string;
  kind: "put" | "remove";
  value?: unknown;
  /** Stable receipt identity carried into the durable value or tombstone. */
  operationId?: string;
  /** Monotonic wall-clock order with the ID as a deterministic tie-breaker. */
  operationOrder?: number;
}

export interface DurableOperation {
  operationId: string;
  operationOrder: number;
}

export interface DurablePendingWriteReceipt {
  id: string;
  key: string;
  kind: "put" | "remove";
  valueHash: string | null;
}

/** Distinguishes an absent record from a committed tombstone without exposing removed values. */
export interface DurableStorageRead {
  found: boolean;
  removed: boolean;
  value?: unknown;
}

/** Small interface keeps migration logic testable without shipping an IndexedDB dependency. */
export interface DurableStorageBackend {
  get(key: string): Promise<unknown | undefined>;
  /** Optional state-aware read used to keep tombstones from falling back to stale legacy values. */
  read?(key: string): Promise<DurableStorageRead>;
  put(
    key: string,
    value: unknown,
    fence?: StorageLockFence,
    operation?: DurableOperation
  ): Promise<void>;
  remove(key: string, fence?: StorageLockFence, operation?: DurableOperation): Promise<void>;
  getMeta(): Promise<DurableStorageMeta | undefined>;
  putMany(entries: ReadonlyArray<readonly [string, unknown]>, meta: DurableStorageMeta): Promise<void>;
  stagePendingWrite(write: DurablePendingWrite, fence?: StorageLockFence): Promise<void>;
  commitPendingWrite(write: DurablePendingWrite, fence?: StorageLockFence): Promise<DurablePendingWriteReceipt>;
  estimate(): Promise<DurableStorageEstimate>;
}

export interface DurableStorageOptions {
  backend?: DurableStorageBackend | null;
  namespace?: string;
  legacyBackend?: "legacy" | "userscript-manager";
}

export const DURABLE_DATABASE_NAME = "aviary.durable.v1";
export const DURABLE_OBJECT_STORE = "values";
export const DURABLE_META_KEY = "__aviary_meta__";

export interface DurableIndexedValue {
  key: string;
  value: unknown;
  updatedAt: string;
  /** Fence metadata makes a late IndexedDB transaction reject rather than overwrite a newer owner. */
  fence?: StorageLockFence;
  /** Tombstones retain a remove's ordering without exposing a value on read. */
  removed?: boolean;
  /** Applied-operation receipt committed with the value or tombstone. */
  operationId?: string;
  operationOrder?: number;
}

interface PendingWriteLedger {
  schemaVersion: typeof PENDING_WRITES_SCHEMA_VERSION;
  entries: DurablePendingWrite[];
}

interface DurablePendingMarker {
  schemaVersion: 1;
  write: DurablePendingWrite;
  valueHash: string | null;
  fence?: StorageLockFence;
}

/**
 * Routes versioned stores to IndexedDB and leaves small unversioned preferences on the existing
 * gateway. The old value is removed only after the IndexedDB transaction has committed, so an
 * interrupted upgrade retains a recoverable legacy copy.
 */
export class DurableStorageGateway implements StorageGateway {
  readonly #legacy: StorageGateway;
  readonly #backend: DurableStorageBackend | null;
  readonly #namespace: string;
  readonly #legacyBackend: "legacy" | "userscript-manager";
  #initialized = false;
  #usable = true;
  #status: StorageStatus = {
    backend: "legacy",
    schemaVersion: 0,
    migratedKeys: 0,
    usageBytes: null,
    quotaBytes: null,
    persistence: "unknown",
    pendingWrites: 0,
    lastError: null
  };

  constructor(
    legacy: StorageGateway,
    backend: DurableStorageBackend | null,
    namespace = "aviary",
    legacyBackend: "legacy" | "userscript-manager" = "legacy"
  ) {
    this.#legacy = legacy;
    this.#backend = backend;
    this.#namespace = namespace;
    this.#legacyBackend = legacyBackend;
    if (backend) {
      this.#status.backend = "indexeddb";
    } else {
      this.#status.backend = legacyBackend;
      if (legacyBackend === "userscript-manager") {
        this.#status.schemaVersion = DURABLE_STORAGE_SCHEMA_VERSION;
      }
    }
  }

  async initialize(keys: readonly string[] = DURABLE_STORAGE_KEYS): Promise<StorageStatus> {
    if (this.#initialized) {
      return this.getStatus();
    }
    this.#initialized = true;
    if (!this.#backend) {
      return this.getStatus();
    }

    // Writes made during a previous fallback session live only in legacy, and the migration below
    // deliberately refuses to overwrite a key the backend already holds -- which is correct for a
    // first migration and exactly wrong here, because those legacy values are the *newer* ones.
    // Reconciling them first is what stops a fallback session from being silently reverted.
    try {
      await this.#reconcilePendingWrites();
      const previous = await this.#backend.getMeta();
      const migratedKeys = new Set(previous?.migratedKeys ?? []);
      const entries: Array<readonly [string, unknown]> = [];
      const discoveredKeys = this.#legacy.keys ? await this.#legacy.keys() : [];
      const scopedKeys = [...new Set([
        ...keys.map((key) => this.#scope(key)),
        ...discoveredKeys.filter((key) => this.#isDurable(key)).map((key) => this.#scope(key))
      ])];

      for (const key of scopedKeys) {
        const existing = await readDurableBackend(this.#backend, key);
        if (existing.found) {
          migratedKeys.add(key);
          continue;
        }
        const legacy = await this.#legacy.get<unknown | undefined>(key, undefined);
        if (legacy !== undefined) {
          entries.push([key, legacy]);
          migratedKeys.add(key);
        }
      }

      const meta: DurableStorageMeta = {
        schemaVersion: DURABLE_STORAGE_SCHEMA_VERSION,
        migratedKeys: [...migratedKeys].sort(),
        migratedAt: new Date().toISOString()
      };
      await this.#backend.putMany(entries, meta);

      // A committed transaction is not enough evidence to delete the only old copy. Hash every
      // value as read back through the backend first; a mismatched clone or partial implementation
      // leaves legacy untouched and retries on the next boot.
      await Promise.all(
        entries.map(([key, value]) => verifyBackendValue(this.#backend!, key, value))
      );

      for (const [key] of entries) {
        try {
          await this.#legacy.remove(key);
        } catch (error) {
          reportStorageError(key, error, "write");
        }
      }

      this.#status.schemaVersion = meta.schemaVersion;
      this.#status.migratedKeys = meta.migratedKeys.length;
      await this.refreshEstimate();
    } catch (error) {
      this.#fallback(error);
    }
    return this.getStatus();
  }

  getStatus(): StorageStatus {
    return { ...this.#status };
  }

  async refreshEstimate(): Promise<StorageStatus> {
    if (!this.#backend || !this.#usable) {
      return this.getStatus();
    }
    try {
      const estimate = await this.#backend.estimate();
      this.#status.usageBytes = finiteOrNull(estimate.usage);
      this.#status.quotaBytes = finiteOrNull(estimate.quota);
      this.#status.persistence =
        estimate.persisted === undefined ? "unknown" : estimate.persisted ? "persisted" : "best-effort";
    } catch (error) {
      reportStorageError("aviary.durable.estimate", error, "read");
    }
    return this.getStatus();
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    if (!this.#isDurable(key)) {
      return this.#legacy.get(key, fallback);
    }
    await this.#ensureInitialized();
    if (!this.#backend || !this.#usable) {
      return this.#backend
        ? this.#getFallbackValue(key, fallback)
        : this.#legacy.get(key, fallback);
    }

    const scopedKey = this.#scope(key);
    try {
      const stored = await readDurableBackend(this.#backend, scopedKey);
      if (stored.found) {
        return stored.removed ? fallback : stored.value as T;
      }
      const legacy = await this.#legacy.get<T | undefined>(key, undefined);
      if (legacy !== undefined) {
        await this.#backend.put(scopedKey, legacy, undefined, createDurableOperation());
        await verifyBackendValue(this.#backend, scopedKey, legacy);
        try {
          await this.#legacy.remove(key);
        } catch (error) {
          reportStorageError(scopedKey, error, "write");
        }
        return legacy;
      }
      return fallback;
    } catch (error) {
      this.#fallback(error);
      return this.#getFallbackValue(key, fallback);
    }
  }

  async set<T>(key: string, value: T, fence?: StorageLockFence): Promise<void> {
    const effectiveFence = fence ?? inferStorageFence(this.#scope(key));
    if (!this.#isDurable(key)) {
      await this.#legacy.set(key, value, effectiveFence);
      return;
    }
    await this.#ensureInitialized();
    const operation = createDurableOperation();
    if (!this.#backend || !this.#usable) {
      if (this.#backend) {
        await this.#markPending(key, "put", value, effectiveFence, operation);
      } else {
        await this.#legacy.set(key, value, effectiveFence);
      }
      return;
    }

    const scopedKey = this.#scope(key);
    try {
      await this.#backend.put(scopedKey, value, effectiveFence, operation);
      try {
        await this.#legacy.remove(key, effectiveFence);
      } catch (error) {
        if (effectiveFence && isStorageFenceError(error)) throw error;
        reportStorageError(scopedKey, error, "write");
        await this.#markPending(key, "put", value, effectiveFence, operation);
      }
      await this.refreshEstimate();
    } catch (error) {
      if (effectiveFence && isStorageFenceError(error)) throw error;
      this.#fallback(error);
      await this.#markPending(key, "put", value, effectiveFence, operation);
    }
  }

  async remove(key: string, fence?: StorageLockFence): Promise<void> {
    const effectiveFence = fence ?? inferStorageFence(this.#scope(key));
    if (!this.#isDurable(key)) {
      await this.#legacy.remove(key, effectiveFence);
      return;
    }
    await this.#ensureInitialized();
    const operation = createDurableOperation();
    if (!this.#backend || !this.#usable) {
      if (this.#backend) {
        await this.#markPending(key, "remove", undefined, effectiveFence, operation);
      } else {
        await this.#legacy.remove(key, effectiveFence);
      }
      return;
    }

    const scopedKey = this.#scope(key);
    try {
      await this.#backend.remove(scopedKey, effectiveFence, operation);
      try {
        await this.#legacy.remove(key, effectiveFence);
      } catch (error) {
        if (effectiveFence && isStorageFenceError(error)) throw error;
        reportStorageError(scopedKey, error, "write");
        await this.#markPending(key, "remove", undefined, effectiveFence, operation);
      }
      await this.refreshEstimate();
    } catch (error) {
      if (effectiveFence && isStorageFenceError(error)) throw error;
      this.#fallback(error);
      await this.#markPending(key, "remove", undefined, effectiveFence, operation);
    }
  }

  async #ensureInitialized(): Promise<void> {
    if (!this.#initialized) {
      await this.initialize();
    }
  }

  #isDurable(key: string): boolean {
    const scoped = this.#scope(key);
    return scoped.startsWith(`${this.#namespace}.`) && /\.v\d+$/.test(scoped);
  }

  #scope(key: string): string {
    if (this.#namespace.length === 0 || key.startsWith(`${this.#namespace}.`)) {
      return key;
    }
    return `${this.#namespace}.${key}`;
  }

  #fallback(error: unknown): void {
    this.#usable = false;
    this.#status.backend = "indexeddb-fallback";
    this.#status.lastError = error instanceof Error ? error.message : String(error);
    reportStorageError("aviary.durable", error, "write");
  }

  /**
   * Records that `key` was written (or removed) into legacy while the backend was unavailable, so
   * the next healthy boot knows legacy holds the newer value. Kept in the legacy store on purpose:
   * the backend is the thing that just failed.
   */
  async #markPending(
    key: string,
    kind: "put" | "remove",
    value?: unknown,
    _fence?: StorageLockFence,
    operation?: DurableOperation
  ): Promise<void> {
    try {
      this.#status.pendingWrites = await withStorageLock(PENDING_WRITES_LOCK, async (fence) => {
        const pending = await this.#readPendingWrites();
        addPendingWrite(pending, {
          id: createPendingWriteId(),
          key,
          kind,
          ...(kind === "put" ? { value } : {}),
          ...(operation ?? {})
        });
        await this.#writePendingWrites(pending, fence);
        return pending.size;
      }, { restoreGate: false });
    } catch (error) {
      reportStorageError(PENDING_WRITES_KEY, error, "write");
      throw error;
    }
  }

  /**
   * Folds a previous fallback session's writes back into the backend. Legacy wins here -- and only
   * here -- because a key reaches this list only by being written while the backend was down.
   */
  async #reconcilePendingWrites(): Promise<void> {
    if (!this.#backend) {
      return;
    }
    await withStorageLock(PENDING_WRITES_LOCK, async (fence) => {
      const pending = await this.#readPendingWrites();
      this.#status.pendingWrites = pending.size;
      if (pending.size === 0) return;

      for (const write of pending.values()) {
        const scopedWrite = { ...write, key: this.#scope(write.key) };
        try {
          await this.#backend!.stagePendingWrite(scopedWrite, fence);
          const receipt = await this.#backend!.commitPendingWrite(scopedWrite, fence);
          await verifyPendingWriteReceipt(scopedWrite, receipt);
        } catch (error) {
          reportStorageError(write.key, error, "write");
          throw error;
        }
      }

      // Old releases stored fallback values under their ordinary legacy keys. Do not clear the
      // journal until every stale copy is gone, or a later backend outage could expose old data.
      for (const write of pending.values()) {
        try {
          await this.#legacy.remove(write.key, fence);
        } catch (error) {
          reportStorageError(write.key, error, "write");
          throw error;
        }
      }

      try {
        await this.#writePendingWrites(new Map(), fence);
      } catch (error) {
        reportStorageError(PENDING_WRITES_KEY, error, "write");
        throw error;
      }
      this.#status.pendingWrites = 0;
    }, { restoreGate: false });
  }

  async #getFallbackValue<T>(key: string, fallback: T): Promise<T> {
    return withStorageLock(PENDING_WRITES_LOCK, async () => {
      const pending = await this.#readPendingWrites();
      const write = pending.get(key);
      if (write?.kind === "put") return write.value as T;
      if (write?.kind === "remove") return fallback;
      return this.#legacy.get(key, fallback);
    }, { restoreGate: false });
  }

  async #readPendingWrites(): Promise<Map<string, DurablePendingWrite>> {
    const stored = await this.#legacy.get<unknown>(PENDING_WRITES_KEY, []);
    const pending = new Map<string, DurablePendingWrite>();
    if (Array.isArray(stored)) {
      // v1 stored only a key array and kept each value under its legacy key. Normalize it in
      // memory so an interrupted upgrade can continue without a destructive ledger rewrite.
      for (const key of stored) {
        if (typeof key !== "string" || !this.#isDurable(key) || pending.has(key)) continue;
        const value = await this.#legacy.get<unknown | undefined>(key, undefined);
        const kind = value === undefined ? "remove" : "put";
        const fingerprint = await hashStorageValue({ key, kind, value });
        addPendingWrite(pending, {
          id: `legacy-${fingerprint}`,
          key,
          kind,
          ...(kind === "put" ? { value } : {})
        });
      }
      return pending;
    }
    if (!isPendingWriteLedger(stored)) return pending;
    for (const write of stored.entries) {
      if (this.#isDurable(write.key)) addPendingWrite(pending, write);
    }
    return pending;
  }

  async #writePendingWrites(
    pending: Map<string, DurablePendingWrite>,
    fence?: StorageLockFence
  ): Promise<void> {
    if (pending.size === 0) {
      await this.#legacy.remove(PENDING_WRITES_KEY, fence);
      return;
    }
    // The journal keeps one newest operation per key. This is the safe compaction boundary: an
    // older receipt can never be needed once a newer operation for that key is retained, while a
    // value is never dropped merely because it is old or because the journal grew.
    const compacted = new Map<string, DurablePendingWrite>();
    for (const write of pending.values()) addPendingWrite(compacted, write);
    await this.#legacy.set(PENDING_WRITES_KEY, {
      schemaVersion: PENDING_WRITES_SCHEMA_VERSION,
      entries: [...compacted.values()]
    } satisfies PendingWriteLedger, fence);
  }
}

export function createDurableStorageGateway(
  legacy: StorageGateway,
  options: DurableStorageOptions = {}
): DurableStorageGateway {
  // Safe by default. Only the extension background calls createIndexedDbStorageBackend(); page
  // and options bundles must receive an explicit remote backend or remain on their owned legacy
  // gateway. This prevents a future call site from reopening the active database on x.com.
  const backend = options.backend ?? null;
  return new DurableStorageGateway(
    legacy,
    backend,
    options.namespace ?? "aviary",
    options.legacyBackend ?? "legacy"
  );
}

export function createIndexedDbStorageBackend(
  factory: IDBFactory | undefined = globalThis.indexedDB
): DurableStorageBackend | null {
  if (!factory) {
    return null;
  }
  return new IndexedDbStorageBackend(factory);
}

export class IndexedDbStorageBackend implements DurableStorageBackend {
  readonly #database: Promise<IDBDatabase>;
  /** One eviction-exemption request per worker; see `#ensurePersisted`. */
  #persistRequested = false;

  constructor(factory: IDBFactory) {
    this.#database = openDatabase(factory);
  }

  async get(key: string): Promise<unknown | undefined> {
    const record = await this.read(key);
    return record.found && !record.removed ? record.value : undefined;
  }

  async read(key: string): Promise<DurableStorageRead> {
    const database = await this.#database;
    const record = await idbRequest<DurableIndexedValue | undefined>(
      database
        .transaction(DURABLE_OBJECT_STORE, "readonly")
        .objectStore(DURABLE_OBJECT_STORE)
        .get(key)
    );
    if (!record) {
      return { found: false, removed: false };
    }
    return record.removed
      ? { found: true, removed: true }
      : { found: true, removed: false, value: record.value };
  }

  async put(
    key: string,
    value: unknown,
    fence?: StorageLockFence,
    operation?: DurableOperation
  ): Promise<void> {
    const database = await this.#database;
    const requestedOperation = operation ?? createDurableOperation();
    await fencedIndexedDbMutation(database, key, fence, requestedOperation, (store, appliedOperation) => {
      store.put({
        key,
        value,
        updatedAt: new Date().toISOString(),
        ...(fence ? { fence } : {}),
        ...(appliedOperation ?? {})
      } satisfies DurableIndexedValue);
    });
  }

  async remove(
    key: string,
    fence?: StorageLockFence,
    operation?: DurableOperation
  ): Promise<void> {
    const database = await this.#database;
    const requestedOperation = operation ?? createDurableOperation();
    await fencedIndexedDbMutation(database, key, fence, requestedOperation, (store, appliedOperation) => {
      store.put({
        key,
        value: null,
        updatedAt: new Date().toISOString(),
        ...(fence ? { fence } : {}),
        ...(appliedOperation ?? {}),
        removed: true
      } satisfies DurableIndexedValue);
    });
  }

  async getMeta(): Promise<DurableStorageMeta | undefined> {
    const value = await this.get(DURABLE_META_KEY);
    return isDurableStorageMeta(value) ? value : undefined;
  }

  async putMany(entries: ReadonlyArray<readonly [string, unknown]>, meta: DurableStorageMeta): Promise<void> {
    const database = await this.#database;
    await idbTransaction(database, "readwrite", (store) => {
      for (const [key, value] of entries) {
        store.put({
          key,
          value,
          updatedAt: new Date().toISOString(),
          ...createDurableOperation()
        } satisfies DurableIndexedValue);
      }
      store.put({
        key: DURABLE_META_KEY,
        value: meta,
        updatedAt: new Date().toISOString(),
        ...createDurableOperation()
      } satisfies DurableIndexedValue);
    });
  }

  async stagePendingWrite(write: DurablePendingWrite, fence?: StorageLockFence): Promise<void> {
    if (!isDurablePendingWrite(write)) {
      throw new Error("Invalid durable pending write");
    }
    const durableWrite = normalizePendingWrite(write);
    const database = await this.#database;
    const marker: DurablePendingMarker = {
      schemaVersion: 1,
      write: durableWrite,
      valueHash: durableWrite.kind === "put" ? await hashStorageValue(durableWrite.value) : null,
      ...(fence ? { fence } : {})
    };
    await idbTransaction(database, "readwrite", (store) => {
      store.put({
        key: pendingMarkerKey(durableWrite.key),
        value: marker,
        updatedAt: new Date().toISOString()
      } satisfies DurableIndexedValue);
    });
  }

  async commitPendingWrite(
    write: DurablePendingWrite,
    fence?: StorageLockFence
  ): Promise<DurablePendingWriteReceipt> {
    if (!isDurablePendingWrite(write)) {
      throw new Error("Invalid durable pending write");
    }
    const valueHash = write.kind === "put" ? await hashStorageValue(write.value) : null;
    return commitPendingWriteTransaction(await this.#database, write, fence, valueHash);
  }

  async estimate(): Promise<DurableStorageEstimate> {
    // `estimate` must be invoked on `navigator.storage`, not on `navigator`. Calling it with the
    // wrong receiver throws "Illegal invocation" in every real browser, which `refreshEstimate`
    // then swallowed -- so the usage and quota figures in Trust were blank in the packaged
    // extension for as long as this line has existed, while reading as merely unavailable.
    const manager = globalThis.navigator?.storage;
    const measured = typeof manager?.estimate === "function"
      ? await manager.estimate()
      : {};
    const persisted = await this.#ensurePersisted(manager);
    return persisted === undefined ? measured : { ...measured, persisted };
  }

  /**
   * Ask for eviction exemption once, then report what the browser actually says.
   *
   * `unlimitedStorage` in the manifest is the permission half; this is the runtime half, and the
   * two are not interchangeable. The request is made once per worker because a user who declined
   * should not be asked again on every status refresh, but `persisted()` is re-read each time --
   * the answer can change without Aviary doing anything, and reporting a cached "yes" after the
   * browser revoked it would be exactly the false assurance this exists to remove.
   */
  async #ensurePersisted(manager: StorageManager | undefined): Promise<boolean | undefined> {
      try {
        if (typeof manager?.persisted === "function" && await manager.persisted()) {
          return true;
        }
        // Ask, where asking is possible. `persist()` is a Window-only API, so a service worker does
        // not have it, but the same backend runs in contexts that do and the request has to happen
        // there rather than being skipped because a later fallback would have answered anyway.
        // Once per instance: a user who declined must not be re-prompted on every status refresh.
        if (typeof manager?.persist === "function" && !this.#persistRequested) {
          this.#persistRequested = true;
          if (await manager.persist()) return true;
        }
        // Measured in a packaged MV3 extension on 2026-09-05: Chrome grants `unlimitedStorage`
        // (`permissions.contains` returns true) while `navigator.storage.persisted()` still answers
        // false and `persist()` does not exist in a service worker at all. The permission is the
        // exemption Chrome documents; the Storage Standard bit is a different mechanism it does not
        // set for extension origins. Reporting best-effort off `persisted()` alone would tell every
        // extension user their library is at risk when it is not.
        if (await holdsUnlimitedStorage()) return true;
        return typeof manager?.persisted === "function" || typeof manager?.persist === "function"
          ? false
          : undefined;
    } catch {
      // A browser that refuses to answer is "unknown", never "persisted". Storage reporting must
      // not be the thing that takes a boot down either.
      return undefined;
    }
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DURABLE_DATABASE_NAME, DURABLE_STORAGE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DURABLE_OBJECT_STORE)) {
        request.result.createObjectStore(DURABLE_OBJECT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not open"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab"));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function fencedIndexedDbMutation(
  database: IDBDatabase,
  key: string,
  fence: StorageLockFence | undefined,
  operation: DurableOperation | undefined,
  write: (store: IDBObjectStore, operation?: DurableOperation) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DURABLE_OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(DURABLE_OBJECT_STORE);
    const request = store.get(key);
    let failure: Error | undefined;
    request.onsuccess = () => {
      const current = request.result as DurableIndexedValue | undefined;
      if (fence && current?.fence && compareStoredFences(current.fence, fence) > 0) {
        failure = new StorageFenceLostError("A newer storage owner already committed this key.");
        transaction.abort();
        return;
      }
      try {
        write(store, operation ? nextDurableOperation(current, operation) : undefined);
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        transaction.abort();
      }
    };
    request.onerror = () => {
      failure = request.error ?? new Error("Fenced IndexedDB read failed");
      transaction.abort();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure ?? transaction.error ?? new Error("Fenced IndexedDB write failed"));
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Fenced IndexedDB write aborted"));
  });
}

function compareStoredFences(left: StorageLockFence, right: StorageLockFence): number {
  if (left.name !== right.name) return 0;
  return left.generation - right.generation || left.owner.localeCompare(right.owner);
}

function idbTransaction(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DURABLE_OBJECT_STORE, mode);
    const store = transaction.objectStore(DURABLE_OBJECT_STORE);
    try {
      action(store);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function isDurableStorageMeta(value: unknown): value is DurableStorageMeta {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === DURABLE_STORAGE_SCHEMA_VERSION &&
    Array.isArray(record.migratedKeys) &&
    record.migratedKeys.every((key) => typeof key === "string") &&
    (record.migratedAt === null || typeof record.migratedAt === "string")
  );
}

export function isDurablePendingWrite(value: unknown): value is DurablePendingWrite {
  if (!value || typeof value !== "object") return false;
  const write = value as Partial<DurablePendingWrite>;
  return (
    validPendingWriteId(write.id) &&
    typeof write.key === "string" &&
    write.key.length > 0 &&
    write.key.length <= 512 &&
    ((write.kind === "put" && "value" in write) || write.kind === "remove") &&
    (write.operationId === undefined || validPendingWriteId(write.operationId)) &&
    (write.operationOrder === undefined || validOperationOrder(write.operationOrder))
  );
}

export function isDurableOperation(value: unknown): value is DurableOperation {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<DurableOperation>;
  return validPendingWriteId(operation.operationId) && validOperationOrder(operation.operationOrder);
}

/**
 * Whether this build actually holds the eviction exemption, asked of the browser rather than
 * assumed from the manifest. A userscript has no `chrome.permissions`, which is the correct answer
 * there: its retention belongs to the manager and Aviary cannot measure it.
 */
async function holdsUnlimitedStorage(): Promise<boolean> {
  const permissions = globalThis.chrome?.permissions;
  if (!globalThis.chrome?.runtime?.id || typeof permissions?.contains !== "function") {
    return false;
  }
  try {
    return await permissions.contains({ permissions: ["unlimitedStorage"] });
  } catch {
    return false;
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readDurableBackend(
  backend: DurableStorageBackend,
  key: string
): Promise<DurableStorageRead> {
  if (typeof backend.read === "function") {
    return backend.read(key);
  }
  const value = await backend.get(key);
  return value === undefined
    ? { found: false, removed: false }
    : { found: true, removed: false, value };
}

async function verifyBackendValue(
  backend: DurableStorageBackend,
  key: string,
  expectedValue: unknown
): Promise<void> {
  const actualValue = await backend.get(key);
  if (actualValue === undefined) {
    throw new Error(`Durable migration did not retain ${key}`);
  }
  const [expectedHash, actualHash] = await Promise.all([
    hashStorageValue(expectedValue),
    hashStorageValue(actualValue)
  ]);
  if (expectedHash !== actualHash) {
    throw new Error(`Durable migration hash mismatch for ${key}`);
  }
}

async function verifyPendingWriteReceipt(
  write: DurablePendingWrite,
  receipt: DurablePendingWriteReceipt
): Promise<void> {
  const expectedHash = write.kind === "put" ? await hashStorageValue(write.value) : null;
  if (
    receipt.id !== write.id ||
    receipt.key !== write.key ||
    receipt.kind !== write.kind ||
    receipt.valueHash !== expectedHash
  ) {
    throw new Error(`Durable reconciliation receipt mismatch for ${write.key}`);
  }
}

function isPendingWriteLedger(value: unknown): value is PendingWriteLedger {
  if (!value || typeof value !== "object") return false;
  const ledger = value as Partial<PendingWriteLedger>;
  return (
    ledger.schemaVersion === PENDING_WRITES_SCHEMA_VERSION &&
    Array.isArray(ledger.entries) &&
    ledger.entries.every(isDurablePendingWrite)
  );
}

function validPendingWriteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function validOperationOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function createPendingWriteId(): string {
  const cryptoWithUuid = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof cryptoWithUuid?.randomUUID === "function") {
    return cryptoWithUuid.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

let durableOperationSequence = 0;
let lastDurableOperationOrder = 0;

function createDurableOperation(): DurableOperation {
  const now = Math.max(0, Math.floor(Date.now()));
  // Milliseconds provide a stable cross-restart clock. The in-process floor keeps two writes made
  // in one millisecond ordered even when the host clock does not advance. IndexedDB still bumps a
  // requested order above the current per-key receipt inside its write transaction.
  const requestedOrder = now * 1000;
  const operationOrder = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(requestedOrder, lastDurableOperationOrder + 1)
  );
  lastDurableOperationOrder = operationOrder;
  return {
    operationId: `${now.toString(36)}-${(++durableOperationSequence).toString(36)}-${
      Math.random().toString(36).slice(2)
    }`,
    operationOrder
  };
}

function createLegacyOperation(id: string): DurableOperation {
  return { operationId: id, operationOrder: 0 };
}

function normalizePendingWrite(write: DurablePendingWrite): DurablePendingWrite {
  // Entries from schema-v1/v2 may have no receipt metadata. Keep that absence visible: assigning
  // them an order-0 ID would make a legacy journal appear newer than a real order-0 receipt.
  return { ...write };
}

function addPendingWrite(
  pending: Map<string, DurablePendingWrite>,
  candidate: DurablePendingWrite
): void {
  const normalized = normalizePendingWrite(candidate);
  const existing = pending.get(normalized.key);
  if (!existing || comparePendingWrites(existing, normalized) <= 0) {
    pending.set(normalized.key, normalized);
  }
}

function comparePendingWrites(left: DurablePendingWrite, right: DurablePendingWrite): number {
  const leftOperation = operationFromWrite(left);
  const rightOperation = operationFromWrite(right);
  if (!leftOperation && !rightOperation) return left.id.localeCompare(right.id);
  if (!leftOperation) return -1;
  if (!rightOperation) return 1;
  return compareDurableOperations(leftOperation, rightOperation);
}

function operationFromRecord(record: DurableIndexedValue | undefined): DurableOperation | undefined {
  if (!record || !isDurableOperation(record)) return undefined;
  return { operationId: record.operationId, operationOrder: record.operationOrder };
}

function operationFromWrite(write: DurablePendingWrite): DurableOperation | undefined {
  if (!isDurableOperation({ operationId: write.operationId, operationOrder: write.operationOrder })) {
    return undefined;
  }
  return { operationId: write.operationId!, operationOrder: write.operationOrder! };
}

function compareDurableOperations(left: DurableOperation, right: DurableOperation): number {
  return left.operationOrder - right.operationOrder || left.operationId.localeCompare(right.operationId);
}

function nextDurableOperation(
  current: DurableIndexedValue | undefined,
  requested: DurableOperation
): DurableOperation {
  const applied = operationFromRecord(current);
  if (!applied || applied.operationId === requested.operationId) return requested;
  if (compareDurableOperations(applied, requested) < 0) return requested;
  return {
    ...requested,
    operationOrder: Math.min(Number.MAX_SAFE_INTEGER, applied.operationOrder + 1)
  };
}

function currentReceiptDominates(
  current: DurableIndexedValue | undefined,
  pending: DurablePendingWrite
): boolean {
  const applied = operationFromRecord(current);
  if (!applied) return false;
  const requested = operationFromWrite(pending);
  // A legacy operation has no ordering proof. Any durable receipt is therefore newer than it and
  // is the only safe basis for dropping a replay.
  if (!requested) return true;
  return compareDurableOperations(applied, requested) >= 0;
}

function pendingMarkerKey(key: string): string {
  return `${DURABLE_PENDING_MARKER_PREFIX}${key}`;
}

function isDurablePendingMarker(value: unknown): value is DurablePendingMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<DurablePendingMarker>;
  return (
    marker.schemaVersion === 1 &&
    isDurablePendingWrite(marker.write) &&
    (marker.valueHash === null ||
      (typeof marker.valueHash === "string" && /^[0-9a-f]{64}$/.test(marker.valueHash))) &&
    (marker.fence === undefined || isStorageLockFence(marker.fence))
  );
}

function commitPendingWriteTransaction(
  database: IDBDatabase,
  expected: DurablePendingWrite,
  fence?: StorageLockFence,
  expectedValueHash: string | null = null
): Promise<DurablePendingWriteReceipt> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DURABLE_OBJECT_STORE, "readwrite");
    const store = transaction.objectStore(DURABLE_OBJECT_STORE);
    const request = store.get(pendingMarkerKey(expected.key));
    let receipt: DurablePendingWriteReceipt | undefined;
    let failure: Error | undefined;

    request.onsuccess = () => {
      const record = request.result as DurableIndexedValue | undefined;
      const marker = record?.value;
      const validMarker = isDurablePendingMarker(marker) ? marker : undefined;
      const pending = validMarker?.write;
      if (record && !validMarker) {
        failure = new Error(`Durable reconciliation marker is corrupt for ${expected.key}`);
        transaction.abort();
        return;
      }
      if (
        pending &&
        (pending.id !== expected.id ||
          pending.key !== expected.key ||
          pending.kind !== expected.kind ||
          (fence && (!validMarker?.fence || compareStoredFences(validMarker.fence, fence) !== 0)))
      ) {
        failure = new Error(`Durable reconciliation marker mismatch for ${expected.key}`);
        transaction.abort();
        return;
      }
      const current = store.get(expected.key);
      current.onsuccess = () => {
        const currentRecord = current.result as DurableIndexedValue | undefined;
        if (fence && currentRecord?.fence && compareStoredFences(currentRecord.fence, fence) > 0) {
          failure = new StorageFenceLostError("A newer storage owner already committed this key.");
          transaction.abort();
          return;
        }

        const replay = pending ?? expected;
        if (!pending && !currentReceiptDominates(currentRecord, replay)) {
          failure = new Error(`Durable reconciliation marker missing for ${expected.key}`);
          transaction.abort();
          return;
        }

        if (currentReceiptDominates(currentRecord, replay)) {
          // The operation was already applied, or a newer operation won. Keep the durable receipt
          // and consume only this marker. Replaying the legacy value would erase that ordering.
          if (pending) store.delete(pendingMarkerKey(replay.key));
          receipt = createPendingWriteReceipt(replay, validMarker?.valueHash ?? expectedValueHash);
          return;
        }

        // Legacy journal entries have no ordering proof. They may still receive a receipt when
        // applied, but that generated order must not be used to make the old entry outrank a real
        // receipt during the pre-write dominance check above.
        const appliedOperation = operationFromWrite(replay) ?? createLegacyOperation(replay.id);
        if (replay.kind === "put") {
          store.put({
            key: replay.key,
            value: replay.value,
            updatedAt: new Date().toISOString(),
            ...(fence ? { fence } : {}),
            ...(appliedOperation ?? {})
          } satisfies DurableIndexedValue);
        } else if (fence) {
          store.put({
            key: replay.key,
            value: null,
            updatedAt: new Date().toISOString(),
            fence,
            ...(appliedOperation ?? {}),
            removed: true
          } satisfies DurableIndexedValue);
        } else {
          store.put({
            key: replay.key,
            value: null,
            updatedAt: new Date().toISOString(),
            ...(appliedOperation ?? {}),
            removed: true
          } satisfies DurableIndexedValue);
        }
        store.delete(pendingMarkerKey(replay.key));
        receipt = createPendingWriteReceipt(replay, validMarker?.valueHash ?? expectedValueHash);
      };
      current.onerror = () => {
        failure = current.error ?? new Error("Durable reconciliation value read failed");
        transaction.abort();
      };
    };
    transaction.oncomplete = () => {
      if (receipt) resolve(receipt);
      else reject(failure ?? new Error("Durable reconciliation committed without a receipt"));
    };
    transaction.onerror = () =>
      reject(failure ?? transaction.error ?? new Error("IndexedDB reconciliation failed"));
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error("IndexedDB reconciliation aborted"));
  });
}

function createPendingWriteReceipt(
  write: DurablePendingWrite,
  valueHash: string | null
): DurablePendingWriteReceipt {
  return {
    id: write.id,
    key: write.key,
    kind: write.kind,
    valueHash
  };
}
