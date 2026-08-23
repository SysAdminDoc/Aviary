import { reportStorageError, type StorageGateway, type StorageStatus } from "./storage.ts";
import { withStorageLock } from "./storage-lock.ts";
import { hashStorageValue } from "./storage-value-hash.ts";

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

/** Every current versioned store is migrated before the first feature reads it. */
export const DURABLE_STORAGE_KEYS = [
  "aviary.profiles.v1",
  "aviary.profile.active.v1",
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
}

export interface DurablePendingWriteReceipt {
  id: string;
  key: string;
  kind: "put" | "remove";
  valueHash: string | null;
}

/** Small interface keeps migration logic testable without shipping an IndexedDB dependency. */
export interface DurableStorageBackend {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  getMeta(): Promise<DurableStorageMeta | undefined>;
  putMany(entries: ReadonlyArray<readonly [string, unknown]>, meta: DurableStorageMeta): Promise<void>;
  stagePendingWrite(write: DurablePendingWrite): Promise<void>;
  commitPendingWrite(write: DurablePendingWrite): Promise<DurablePendingWriteReceipt>;
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
}

interface PendingWriteLedger {
  schemaVersion: typeof PENDING_WRITES_SCHEMA_VERSION;
  entries: DurablePendingWrite[];
}

interface DurablePendingMarker {
  schemaVersion: 1;
  write: DurablePendingWrite;
  valueHash: string | null;
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
      const scopedKeys = [...new Set(keys.map((key) => this.#scope(key)))];

      for (const key of scopedKeys) {
        const existing = await this.#backend.get(key);
        if (existing !== undefined) {
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
      const stored = await this.#backend.get(scopedKey);
      if (stored !== undefined) {
        return stored as T;
      }
      const legacy = await this.#legacy.get<T | undefined>(key, undefined);
      if (legacy !== undefined) {
        await this.#backend.put(scopedKey, legacy);
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

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.#isDurable(key)) {
      await this.#legacy.set(key, value);
      return;
    }
    await this.#ensureInitialized();
    if (!this.#backend || !this.#usable) {
      if (this.#backend) {
        await this.#markPending(key, "put", value);
      } else {
        await this.#legacy.set(key, value);
      }
      return;
    }

    const scopedKey = this.#scope(key);
    try {
      await this.#backend.put(scopedKey, value);
      try {
        await this.#legacy.remove(key);
      } catch (error) {
        reportStorageError(scopedKey, error, "write");
      }
      await this.refreshEstimate();
    } catch (error) {
      this.#fallback(error);
      await this.#markPending(key, "put", value);
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.#isDurable(key)) {
      await this.#legacy.remove(key);
      return;
    }
    await this.#ensureInitialized();
    if (!this.#backend || !this.#usable) {
      if (this.#backend) {
        await this.#markPending(key, "remove");
      } else {
        await this.#legacy.remove(key);
      }
      return;
    }

    const scopedKey = this.#scope(key);
    try {
      await this.#backend.remove(scopedKey);
      await this.#legacy.remove(key);
      await this.refreshEstimate();
    } catch (error) {
      this.#fallback(error);
      await this.#markPending(key, "remove");
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
  async #markPending(key: string, kind: "put" | "remove", value?: unknown): Promise<void> {
    try {
      this.#status.pendingWrites = await withStorageLock(PENDING_WRITES_LOCK, async () => {
        const pending = await this.#readPendingWrites();
        pending.set(key, {
          id: createPendingWriteId(),
          key,
          kind,
          ...(kind === "put" ? { value } : {})
        });
        await this.#writePendingWrites(pending);
        return pending.size;
      });
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
    await withStorageLock(PENDING_WRITES_LOCK, async () => {
      const pending = await this.#readPendingWrites();
      this.#status.pendingWrites = pending.size;
      if (pending.size === 0) return;

      for (const write of pending.values()) {
        const scopedWrite = { ...write, key: this.#scope(write.key) };
        try {
          await this.#backend!.stagePendingWrite(scopedWrite);
          const receipt = await this.#backend!.commitPendingWrite(scopedWrite);
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
          await this.#legacy.remove(write.key);
        } catch (error) {
          reportStorageError(write.key, error, "write");
          throw error;
        }
      }

      try {
        await this.#writePendingWrites(new Map());
      } catch (error) {
        reportStorageError(PENDING_WRITES_KEY, error, "write");
        throw error;
      }
      this.#status.pendingWrites = 0;
    });
  }

  async #getFallbackValue<T>(key: string, fallback: T): Promise<T> {
    return withStorageLock(PENDING_WRITES_LOCK, async () => {
      const pending = await this.#readPendingWrites();
      const write = pending.get(key);
      if (write?.kind === "put") return write.value as T;
      if (write?.kind === "remove") return fallback;
      return this.#legacy.get(key, fallback);
    });
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
        pending.set(key, {
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
      if (this.#isDurable(write.key)) pending.set(write.key, write);
    }
    return pending;
  }

  async #writePendingWrites(pending: Map<string, DurablePendingWrite>): Promise<void> {
    if (pending.size === 0) {
      await this.#legacy.remove(PENDING_WRITES_KEY);
      return;
    }
    await this.#legacy.set(PENDING_WRITES_KEY, {
      schemaVersion: PENDING_WRITES_SCHEMA_VERSION,
      entries: [...pending.values()]
    } satisfies PendingWriteLedger);
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

  constructor(factory: IDBFactory) {
    this.#database = openDatabase(factory);
  }

  async get(key: string): Promise<unknown | undefined> {
    const database = await this.#database;
    const record = await idbRequest<DurableIndexedValue | undefined>(
      database
        .transaction(DURABLE_OBJECT_STORE, "readonly")
        .objectStore(DURABLE_OBJECT_STORE)
        .get(key)
    );
    return record?.value;
  }

  async put(key: string, value: unknown): Promise<void> {
    const database = await this.#database;
    await idbTransaction(database, "readwrite", (store) => {
      store.put({ key, value, updatedAt: new Date().toISOString() } satisfies DurableIndexedValue);
    });
  }

  async remove(key: string): Promise<void> {
    const database = await this.#database;
    await idbTransaction(database, "readwrite", (store) => {
      store.delete(key);
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
        store.put({ key, value, updatedAt: new Date().toISOString() } satisfies DurableIndexedValue);
      }
      store.put({
        key: DURABLE_META_KEY,
        value: meta,
        updatedAt: new Date().toISOString()
      } satisfies DurableIndexedValue);
    });
  }

  async stagePendingWrite(write: DurablePendingWrite): Promise<void> {
    if (!isDurablePendingWrite(write)) {
      throw new Error("Invalid durable pending write");
    }
    const database = await this.#database;
    const marker: DurablePendingMarker = {
      schemaVersion: 1,
      write,
      valueHash: write.kind === "put" ? await hashStorageValue(write.value) : null
    };
    await idbTransaction(database, "readwrite", (store) => {
      store.put({
        key: pendingMarkerKey(write.key),
        value: marker,
        updatedAt: new Date().toISOString()
      } satisfies DurableIndexedValue);
    });
  }

  async commitPendingWrite(write: DurablePendingWrite): Promise<DurablePendingWriteReceipt> {
    if (!isDurablePendingWrite(write)) {
      throw new Error("Invalid durable pending write");
    }
    return commitPendingWriteTransaction(await this.#database, write);
  }

  async estimate(): Promise<DurableStorageEstimate> {
    const estimate = globalThis.navigator?.storage?.estimate;
    return estimate ? estimate.call(globalThis.navigator) : {};
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
    ((write.kind === "put" && "value" in write) || write.kind === "remove")
  );
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function createPendingWriteId(): string {
  const cryptoWithUuid = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof cryptoWithUuid?.randomUUID === "function") {
    return cryptoWithUuid.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
      (typeof marker.valueHash === "string" && /^[0-9a-f]{64}$/.test(marker.valueHash)))
  );
}

function commitPendingWriteTransaction(
  database: IDBDatabase,
  expected: DurablePendingWrite
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
      if (
        !isDurablePendingMarker(marker) ||
        marker.write.id !== expected.id ||
        marker.write.key !== expected.key ||
        marker.write.kind !== expected.kind
      ) {
        failure = new Error(`Durable reconciliation marker mismatch for ${expected.key}`);
        transaction.abort();
        return;
      }
      if (marker.write.kind === "put") {
        store.put({
          key: marker.write.key,
          value: marker.write.value,
          updatedAt: new Date().toISOString()
        } satisfies DurableIndexedValue);
      } else {
        store.delete(marker.write.key);
      }
      store.delete(pendingMarkerKey(marker.write.key));
      receipt = {
        id: marker.write.id,
        key: marker.write.key,
        kind: marker.write.kind,
        valueHash: marker.valueHash
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
