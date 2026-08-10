import { reportStorageError, type StorageGateway, type StorageStatus } from "./storage";

export const DURABLE_STORAGE_SCHEMA_VERSION = 1;

/** Every current versioned store is migrated before the first feature reads it. */
export const DURABLE_STORAGE_KEYS = [
  "aviary.profiles.v1",
  "aviary.profile.active.v1",
  "aviary.settings.v1",
  "aviary.export.checkpoints.v1",
  "aviary.queryIds.v1",
  "aviary.media.history.v1",
  "aviary.media.queue.v1",
  "aviary.aria2.history.v1",
  "aviary.hiddenPosts.v1",
  "aviary.media.last-download.v1",
  "aviary.cleanupQueue.v1",
  "aviary.userNotes.v1",
  "aviary.audit.v1",
  "aviary.library.bookmarks.v1",
  "aviary.snapshots.v1",
  "aviary.semanticIndex.v1",
  "aviary.archive.imports.v1"
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

/** Small interface keeps migration logic testable without shipping an IndexedDB dependency. */
export interface DurableStorageBackend {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  getMeta(): Promise<DurableStorageMeta | undefined>;
  putMany(entries: ReadonlyArray<readonly [string, unknown]>, meta: DurableStorageMeta): Promise<void>;
  estimate(): Promise<DurableStorageEstimate>;
}

export interface DurableStorageOptions {
  backend?: DurableStorageBackend | null;
  namespace?: string;
}

const DATABASE_NAME = "aviary.durable.v1";
const OBJECT_STORE = "values";
const META_KEY = "__aviary_meta__";

interface IndexedValue {
  key: string;
  value: unknown;
  updatedAt: string;
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
  #initialized = false;
  #usable = true;
  #status: StorageStatus = {
    backend: "legacy",
    schemaVersion: 0,
    migratedKeys: 0,
    usageBytes: null,
    quotaBytes: null,
    lastError: null
  };

  constructor(legacy: StorageGateway, backend: DurableStorageBackend | null, namespace = "aviary") {
    this.#legacy = legacy;
    this.#backend = backend;
    this.#namespace = namespace;
    if (backend) {
      this.#status.backend = "indexeddb";
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

    try {
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
      return this.#legacy.get(key, fallback);
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
      return this.#legacy.get(key, fallback);
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.#isDurable(key)) {
      await this.#legacy.set(key, value);
      return;
    }
    await this.#ensureInitialized();
    if (!this.#backend || !this.#usable) {
      await this.#legacy.set(key, value);
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
      await this.#legacy.set(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.#isDurable(key)) {
      await this.#legacy.remove(key);
      return;
    }
    await this.#ensureInitialized();
    if (!this.#backend || !this.#usable) {
      await this.#legacy.remove(key);
      return;
    }

    const scopedKey = this.#scope(key);
    try {
      await this.#backend.remove(scopedKey);
      await this.#legacy.remove(key);
      await this.refreshEstimate();
    } catch (error) {
      this.#fallback(error);
      await this.#legacy.remove(key);
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
}

export function createDurableStorageGateway(
  legacy: StorageGateway,
  options: DurableStorageOptions = {}
): DurableStorageGateway {
  const backend = options.backend === undefined ? createIndexedDbBackend() : options.backend;
  return new DurableStorageGateway(legacy, backend, options.namespace ?? "aviary");
}

function createIndexedDbBackend(): DurableStorageBackend | null {
  if (!globalThis.indexedDB) {
    return null;
  }
  return new IndexedDbStorageBackend(globalThis.indexedDB);
}

class IndexedDbStorageBackend implements DurableStorageBackend {
  readonly #database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory) {
    this.#database = openDatabase(factory);
  }

  async get(key: string): Promise<unknown | undefined> {
    const database = await this.#database;
    const record = await idbRequest<IndexedValue | undefined>(database.transaction(OBJECT_STORE, "readonly").objectStore(OBJECT_STORE).get(key));
    return record?.value;
  }

  async put(key: string, value: unknown): Promise<void> {
    const database = await this.#database;
    await idbTransaction(database, "readwrite", (store) => {
      store.put({ key, value, updatedAt: new Date().toISOString() } satisfies IndexedValue);
    });
  }

  async remove(key: string): Promise<void> {
    const database = await this.#database;
    await idbTransaction(database, "readwrite", (store) => {
      store.delete(key);
    });
  }

  async getMeta(): Promise<DurableStorageMeta | undefined> {
    const value = await this.get(META_KEY);
    return isMeta(value) ? value : undefined;
  }

  async putMany(entries: ReadonlyArray<readonly [string, unknown]>, meta: DurableStorageMeta): Promise<void> {
    const database = await this.#database;
    await idbTransaction(database, "readwrite", (store) => {
      for (const [key, value] of entries) {
        store.put({ key, value, updatedAt: new Date().toISOString() } satisfies IndexedValue);
      }
      store.put({ key: META_KEY, value: meta, updatedAt: new Date().toISOString() } satisfies IndexedValue);
    });
  }

  async estimate(): Promise<DurableStorageEstimate> {
    const estimate = globalThis.navigator?.storage?.estimate;
    return estimate ? estimate.call(globalThis.navigator) : {};
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DURABLE_STORAGE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE, { keyPath: "key" });
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
    const transaction = database.transaction(OBJECT_STORE, mode);
    const store = transaction.objectStore(OBJECT_STORE);
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

function isMeta(value: unknown): value is DurableStorageMeta {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === DURABLE_STORAGE_SCHEMA_VERSION &&
    Array.isArray(record.migratedKeys) &&
    record.migratedKeys.every((key) => typeof key === "string") &&
    (record.migratedAt === null || typeof record.migratedAt === "string")
  );
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
