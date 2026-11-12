import { storageValueBytes } from "./storage-value-hash.ts";
import type { DurableStorageBreakdown } from "./durable-storage.ts";
import {
  hasExtensionFenceTransport,
  inferStorageFence,
  isStorageLockFence,
  sendStorageFenceMutation,
  STORAGE_FENCE_OPERATION_PREFIX,
  STORAGE_FENCE_RECEIPT_SUFFIX,
  StorageFenceUnavailableError,
  type StorageLockFence
} from "./storage-fence.ts";
import {
  fenceOperationKey,
  fencedRemoveIsNoop,
  isFenceRecordKeyFor,
  resolveFencedValue,
  supersededFenceRecordKeys,
  type FenceOperationRecord,
  type FenceReceiptRecord,
  type FenceRecords
} from "./storage-fence-records.ts";

export interface StorageGateway {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T, fence?: StorageLockFence): Promise<void>;
  remove(key: string, fence?: StorageLockFence): Promise<void>;
  keys?(): Promise<string[]>;
  getStatus?(): StorageStatus;
  /**
   * Measured bytes per stored collection, or `null` where this backend cannot weigh itself.
   *
   * Optional because a userscript manager stores values behind an API with no cursor. A caller
   * that needs a total has to handle "the backend does not know", which is a different answer
   * from zero and has to read as one.
   */
  measureCollections?(): Promise<DurableStorageBreakdown | null>;
}

export interface StorageStatus {
  backend: "legacy" | "indexeddb" | "indexeddb-fallback" | "userscript-manager";
  schemaVersion: number;
  migratedKeys: number;
  usageBytes: number | null;
  quotaBytes: number | null;
  /**
   * Whether the browser has exempted this storage from eviction.
   *
   * `best-effort` is the default state everywhere and means the browser may clear the whole local
   * library under disk pressure without asking. `unknown` covers the userscript manager, whose
   * durability is the manager's business and not something Aviary can measure. Reporting a
   * measured usage figure without this said "here is how much you have stored" while leaving out
   * "and the browser may delete it".
   */
  persistence: "persisted" | "best-effort" | "unknown";
  lastError: string | null;
  /**
   * Writes made while the durable backend was unavailable, still waiting to be folded back in on
   * the next healthy boot. Non-zero means this session's changes live only in the legacy store.
   */
  pendingWrites: number;
}

type GlobalWithUserscriptStorage = typeof globalThis & {
  GM_getValue?: <T>(key: string, fallback: T) => T | Promise<T>;
  GM_setValue?: <T>(key: string, value: T) => void | Promise<void>;
  GM_deleteValue?: (key: string) => void | Promise<void>;
  GM_listValues?: () => string[] | Promise<string[]>;
};

export interface ExtensionStorageLocalLike {
  get(
    keys?: string | string[] | Record<string, unknown> | null
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  /** Chrome 130+ and Firefox 143+. Lists keys without deserializing every stored value. */
  getKeys?(): Promise<string[]>;
}

export const USERSCRIPT_MANAGER_VALUE_LIMIT_BYTES = 16 * 1024 * 1024;
let userscriptFenceOperationSequence = 0;

export interface StorageGatewayOptions {
  /** Prevents an extension or userscript entrypoint from falling through to the page origin. */
  mode?: "auto" | "extension" | "userscript";
  userscriptValueLimitBytes?: number;
}

export class UserscriptStorageCapacityError extends Error {
  readonly code = "userscript-storage-capacity";
  readonly key: string;
  readonly measuredBytes: number;
  readonly limitBytes: number;

  constructor(key: string, measuredBytes: number, limitBytes: number) {
    super(
      `The userscript manager refused ${key}: ${measuredBytes} bytes exceeds Aviary's ` +
        `${limitBytes}-byte per-value safety limit.`
    );
    this.name = "UserscriptStorageCapacityError";
    this.key = key;
    this.measuredBytes = measuredBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Notified whenever a write fails, before the error is rethrown to the caller.
 *
 * Nine call sites wrap `set()` in `try { … } catch {}` because losing a dedup entry or an index
 * must not break the action that triggered it. That is the right call individually and a bad
 * outcome collectively: a full backend became "changes stop sticking" everywhere at once, with
 * no signal. Reporting here catches every one of them — and every store added later — without
 * each having to remember to plumb a sink through its constructor.
 */
export type StorageErrorSink = (key: string, error: unknown, op: "read" | "write") => void;

let onWriteError: StorageErrorSink | undefined;

export function setStorageErrorSink(sink: StorageErrorSink | undefined): void {
  onWriteError = sink;
}

export function reportStorageError(key: string, error: unknown, op: "read" | "write"): void {
  onWriteError?.(key, error, op);
}

export function createStorageGateway(
  namespace = "aviary",
  options: StorageGatewayOptions = {}
): StorageGateway {
  const scoped = (key: string) => {
    if (namespace.length === 0 || key.startsWith(`${namespace}.`)) {
      return key;
    }
    return `${namespace}.${key}`;
  };
  const globals = globalThis as GlobalWithUserscriptStorage;
  const mode = options.mode ?? "auto";
  const managerLimit = Math.max(
    1,
    Math.floor(options.userscriptValueLimitBytes ?? USERSCRIPT_MANAGER_VALUE_LIMIT_BYTES)
  );

  if (
    mode === "userscript" &&
    (typeof globals.GM_getValue !== "function" ||
      typeof globals.GM_setValue !== "function" ||
      typeof globals.GM_deleteValue !== "function" ||
      typeof globals.GM_listValues !== "function")
  ) {
    throw new Error("The userscript manager did not expose its storage API");
  }
  if (mode === "extension" && !globalThis.chrome?.storage?.local) {
    throw new Error("Extension storage is unavailable");
  }

  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const storageKey = scoped(key);

      try {
        if (mode !== "extension" && typeof globals.GM_getValue === "function") {
          if (typeof globals.GM_listValues === "function") {
            const records = await readUserscriptFenceRecords(globals, storageKey);
            await pruneUserscriptFenceRecords(globals, records, storageKey);
            const committed = resolveFencedValue(records, storageKey, fallback);
            if (committed.found) return committed.value as T;
          }
          return await globals.GM_getValue(storageKey, fallback);
        }

        if (mode !== "userscript" && globalThis.chrome?.storage?.local) {
          const extensionStorage = globalThis.chrome.storage.local as ExtensionStorageLocalLike;
          const records = await readExtensionFenceRecords(extensionStorage, storageKey);
          const committed = resolveFencedValue(records, storageKey, fallback);
          if (committed.found) return committed.value as T;
          return records[storageKey] === undefined ? fallback : (records[storageKey] as T);
        }

        const raw = mode === "auto" ? globalThis.localStorage?.getItem(storageKey) : null;
        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
      } catch (error) {
        reportStorageError(storageKey, error, "read");
        // Returning the fallback silently means a corrupted value reads as "unset", and the
        // next save overwrites the recoverable original for good. Still non-throwing -- a bad
        // read must not take the boot down -- but no longer invisible.
        return fallback;
      }
    },

    async set<T>(key: string, value: T, fence?: StorageLockFence): Promise<void> {
      const storageKey = scoped(key);
      const effectiveFence = fence ?? inferStorageFence(storageKey);

      // Reported and rethrown: callers that deliberately swallow the error keep working, but
      // the failure is no longer invisible. A quota error here is the difference between "a
      // setting did not stick" and "the browser store is full".
      try {
        if (effectiveFence && typeof globals.GM_setValue === "function") {
          await writeUserscriptFenceOperation(globals, storageKey, value, effectiveFence, managerLimit);
          return;
        }
        if (effectiveFence && hasExtensionFenceTransport()) {
          await sendStorageFenceMutation("set", storageKey, effectiveFence, value);
          return;
        }
        if (effectiveFence) {
          throw new StorageFenceUnavailableError();
        }
        if (mode !== "extension" && typeof globals.GM_setValue === "function") {
          const measuredBytes = storageValueBytes(value);
          if (measuredBytes > managerLimit) {
            throw new UserscriptStorageCapacityError(storageKey, measuredBytes, managerLimit);
          }
          await globals.GM_setValue(storageKey, value);
          return;
        }

        if (mode !== "userscript" && globalThis.chrome?.storage?.local) {
          await globalThis.chrome.storage.local.set({ [storageKey]: value });
          return;
        }

        if (mode === "auto" && globalThis.localStorage) {
          globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
          return;
        }

        throw new Error(`No storage backend is available for ${storageKey}`);
      } catch (error) {
        reportStorageError(storageKey, error, "write");
        throw error;
      }
    },

    async remove(key: string, fence?: StorageLockFence): Promise<void> {
      const storageKey = scoped(key);
      const effectiveFence = fence ?? inferStorageFence(storageKey);

      // A delete is a write, and it was the one write this module could not see. Callers such as
      // ProfileManager.adoptLegacyIntoActive call remove() bare, so a backend failure there used
      // to propagate as an unreported rejection while the comment at the top of this file promised
      // the opposite.
      try {
        if (effectiveFence && typeof globals.GM_deleteValue === "function") {
          await writeUserscriptFenceOperation(globals, storageKey, undefined, effectiveFence, managerLimit, "remove");
          return;
        }
        if (effectiveFence && hasExtensionFenceTransport()) {
          await sendStorageFenceMutation("remove", storageKey, effectiveFence);
          return;
        }
        if (effectiveFence) {
          throw new StorageFenceUnavailableError();
        }
        if (mode !== "extension" && typeof globals.GM_deleteValue === "function") {
          await globals.GM_deleteValue(storageKey);
          return;
        }

        if (mode !== "userscript" && globalThis.chrome?.storage?.local) {
          await globalThis.chrome.storage.local.remove(storageKey);
          return;
        }

        if (mode === "auto" && globalThis.localStorage) {
          globalThis.localStorage.removeItem(storageKey);
          return;
        }

        throw new Error(`No storage backend is available for ${storageKey}`);
      } catch (error) {
        reportStorageError(storageKey, error, "write");
        throw error;
      }
    },

    async keys(): Promise<string[]> {
      const prefix = namespace.length > 0 ? `${namespace}.` : "";
      if (mode !== "extension" && typeof globals.GM_listValues === "function") {
        return (await globals.GM_listValues()).filter(
          (key) => key.startsWith(prefix) && !key.startsWith(STORAGE_FENCE_OPERATION_PREFIX)
        );
      }
      if (mode !== "userscript" && globalThis.chrome?.storage?.local) {
        return (await listExtensionKeys(globalThis.chrome.storage.local as ExtensionStorageLocalLike))
          .filter((key) => key.startsWith(prefix) && !key.startsWith(STORAGE_FENCE_OPERATION_PREFIX));
      }
      if (mode === "auto" && globalThis.localStorage) {
        const keys: string[] = [];
        for (let index = 0; index < globalThis.localStorage.length; index += 1) {
          const key = globalThis.localStorage.key(index);
          if (key?.startsWith(prefix)) keys.push(key);
        }
        return keys;
      }
      return [];
    }
  };
}

async function writeUserscriptFenceOperation(
  globals: GlobalWithUserscriptStorage,
  storageKey: string,
  value: unknown,
  fence: StorageLockFence,
  managerLimit: number,
  kind: "set" | "remove" = "set"
): Promise<void> {
  if (!isStorageLockFence(fence)) {
    throw new StorageFenceUnavailableError("The storage fence was malformed before the write.");
  }
  const records = await readUserscriptFenceRecords(globals, storageKey);
  if (kind === "remove" && fencedRemoveIsNoop(records, storageKey)) return;
  const operationId = `${Date.now().toString(36)}-${(++userscriptFenceOperationSequence).toString(36)}-${
    Math.random().toString(36).slice(2)
  }`;
  const operationKey = fenceOperationKey(storageKey, operationId);
  const operation: FenceOperationRecord = {
    version: 1,
    operationId,
    storageKey,
    kind,
    ...(kind === "set" ? { value } : {}),
    fence
  };
  const measuredBytes = storageValueBytes(operation);
  if (measuredBytes > managerLimit) {
    throw new UserscriptStorageCapacityError(storageKey, measuredBytes, managerLimit);
  }
  await globals.GM_setValue!(operationKey, operation);

  const receipt: FenceReceiptRecord = {
    version: 1,
    operationId,
    committedAt: Date.now()
  };
  await globals.GM_setValue!(`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`, receipt);

  // Keep the manager's ordinary key populated for older Aviary builds and diagnostics. Reads still
  // resolve the immutable records first, so a stale callback's late materialization cannot win. A
  // failed materialization is surfaced: the immutable receipt alone is not enough to claim that a
  // caller's write completed, and restore code must be able to enter its rollback path.
  try {
    if (kind === "set") await globals.GM_setValue!(storageKey, value);
    else await globals.GM_deleteValue!(storageKey);
  } catch (error) {
    reportStorageError(storageKey, error, "write");
    throw error;
  }

  records[operationKey] = operation;
  records[`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`] = receipt;
  if (kind === "set") records[storageKey] = value;
  else delete records[storageKey];
  await pruneUserscriptFenceRecords(globals, records, storageKey);
}

async function readUserscriptFenceRecords(
  globals: GlobalWithUserscriptStorage,
  storageKey: string
): Promise<FenceRecords> {
  const records: FenceRecords = {};
  for (const key of await globals.GM_listValues!()) {
    if (!isFenceRecordKeyFor(key, storageKey)) continue;
    records[key] = await globals.GM_getValue!<unknown>(key, undefined);
  }
  return records;
}

/**
 * Drops the records a read of `storageKey` no longer consults, including a backlog left by builds
 * that never trimmed them. A failed delete only costs space, so it is reported, not thrown.
 */
async function pruneUserscriptFenceRecords(
  globals: GlobalWithUserscriptStorage,
  records: FenceRecords,
  storageKey: string
): Promise<void> {
  if (typeof globals.GM_deleteValue !== "function") return;
  for (const key of supersededFenceRecordKeys(records, storageKey)) {
    try {
      await globals.GM_deleteValue(key);
      delete records[key];
    } catch (error) {
      reportStorageError(key, error, "write");
      return;
    }
  }
}

async function listExtensionKeys(storage: ExtensionStorageLocalLike): Promise<string[]> {
  if (typeof storage.getKeys === "function") return storage.getKeys();
  return Object.keys(await storage.get(null));
}

/**
 * The plain copy of `storageKey` plus its fence records, without reading unrelated values.
 *
 * A whole-area read per key cost about 190 ms on a profile holding 22k leftover records, and boot
 * makes dozens of these reads before the first feature runs. Browsers without `getKeys` still take
 * the whole-area path; the background compaction keeps that area small.
 */
async function readExtensionFenceRecords(
  storage: ExtensionStorageLocalLike,
  storageKey: string
): Promise<FenceRecords> {
  if (typeof storage.getKeys !== "function") return storage.get(null);
  const keys = (await storage.getKeys()).filter((key) => isFenceRecordKeyFor(key, storageKey));
  return keys.length === 0 ? {} : storage.get(keys);
}
