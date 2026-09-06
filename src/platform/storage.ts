import { storageValueBytes } from "./storage-value-hash.ts";
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

export interface StorageGateway {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T, fence?: StorageLockFence): Promise<void>;
  remove(key: string, fence?: StorageLockFence): Promise<void>;
  keys?(): Promise<string[]>;
  getStatus?(): StorageStatus;
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
}

export const USERSCRIPT_MANAGER_VALUE_LIMIT_BYTES = 16 * 1024 * 1024;
let userscriptFenceOperationSequence = 0;

interface UserscriptFenceOperation {
  version: 1;
  operationId: string;
  storageKey: string;
  kind: "set" | "remove";
  value?: unknown;
  fence: StorageLockFence;
}

interface UserscriptFenceReceipt {
  version: 1;
  operationId: string;
  committedAt: number;
}

interface CommittedUserscriptOperation {
  operationKey: string;
  operation: UserscriptFenceOperation;
  receipt: UserscriptFenceReceipt;
}

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
            const committed = await readCommittedUserscriptOperation(globals, storageKey, fallback);
            if (committed.found) return committed.value as T;
          }
          return await globals.GM_getValue(storageKey, fallback);
        }

        if (mode !== "userscript" && globalThis.chrome?.storage?.local) {
          const extensionStorage = globalThis.chrome.storage.local as ExtensionStorageLocalLike;
          const committed = await readCommittedExtensionOperation(extensionStorage, storageKey, fallback);
          if (committed.found) return committed.value as T;
          const result = await extensionStorage.get(storageKey);
          return result[storageKey] === undefined ? fallback : (result[storageKey] as T);
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
        return Object.keys(await globalThis.chrome.storage.local.get(null))
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
  const operationId = `${Date.now().toString(36)}-${(++userscriptFenceOperationSequence).toString(36)}-${
    Math.random().toString(36).slice(2)
  }`;
  const operationKey = `${STORAGE_FENCE_OPERATION_PREFIX}${encodeURIComponent(storageKey)}.${
    encodeURIComponent(operationId)
  }`;
  const operation: UserscriptFenceOperation = {
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

  const receipt: UserscriptFenceReceipt = {
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
}

async function readCommittedUserscriptOperation(
  globals: GlobalWithUserscriptStorage,
  storageKey: string,
  fallback: unknown
): Promise<{ found: boolean; value: unknown }> {
  const keys = await globals.GM_listValues!();
  const prefix = `${STORAGE_FENCE_OPERATION_PREFIX}${encodeURIComponent(storageKey)}.`;
  const rawPresent = keys.includes(storageKey);
  const rawValue = rawPresent ? await globals.GM_getValue!<unknown>(storageKey, undefined) : undefined;
  let best: CommittedUserscriptOperation | undefined;
  const allOperations: CommittedUserscriptOperation[] = [];
  for (const operationKey of keys.filter(
    (key) =>
      key.startsWith(prefix) &&
      !key.endsWith(STORAGE_FENCE_RECEIPT_SUFFIX) &&
      !key.endsWith(".materialized")
  )) {
    const operation = await globals.GM_getValue!<unknown>(operationKey, undefined);
    const receipt = await globals.GM_getValue!<unknown>(
      `${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`,
      undefined
    );
    if (!isUserscriptFenceOperation(operation, storageKey) || !isUserscriptFenceReceipt(receipt)) {
      continue;
    }
    const candidate = { operationKey, operation, receipt } satisfies CommittedUserscriptOperation;
    allOperations.push(candidate);
    if (
      receipt.operationId !== operation.operationId ||
      receipt.committedAt > operation.fence.expiresAt
    ) {
      continue;
    }
    if (!best || compareUserscriptOperations(best, candidate) < 0) best = candidate;
  }
  if (!best) return { found: false, value: fallback };

  // A plain manager write is still supported for migration and older releases. Trust it only when
  // no fenced operation can explain the materialized bytes. A delayed owner can leave a stale copy
  // behind, but its receipt is past its expiry and therefore cannot masquerade as a newer direct
  // write. When no plain value exists, the committed immutable record is the materialized value.
  if (
    rawPresent &&
    !allOperations.some(
      (candidate) => candidate.operation.kind === "set" && storageValuesEqual(rawValue, candidate.operation.value)
    )
  ) {
    return { found: true, value: rawValue };
  }
  return {
    found: true,
    value: best.operation.kind === "remove" ? fallback : best.operation.value
  };
}

async function readCommittedExtensionOperation(
  storage: ExtensionStorageLocalLike,
  storageKey: string,
  fallback: unknown
): Promise<{ found: boolean; value: unknown }> {
  const values = await storage.get(null);
  const keys = Object.keys(values);
  const prefix = `${STORAGE_FENCE_OPERATION_PREFIX}${encodeURIComponent(storageKey)}.`;
  const rawPresent = Object.prototype.hasOwnProperty.call(values, storageKey);
  const rawValue = rawPresent ? values[storageKey] : undefined;
  let best: CommittedUserscriptOperation | undefined;
  const allOperations: CommittedUserscriptOperation[] = [];

  for (const operationKey of keys.filter(
    (key) =>
      key.startsWith(prefix) &&
      !key.endsWith(STORAGE_FENCE_RECEIPT_SUFFIX) &&
      !key.endsWith(".materialized")
  )) {
    const operation = values[operationKey];
    const receipt = values[`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`];
    if (!isUserscriptFenceOperation(operation, storageKey) || !isUserscriptFenceReceipt(receipt)) {
      continue;
    }
    const candidate = { operationKey, operation, receipt } satisfies CommittedUserscriptOperation;
    allOperations.push(candidate);
    if (
      receipt.operationId !== operation.operationId ||
      receipt.committedAt > operation.fence.expiresAt
    ) {
      continue;
    }
    if (!best || compareUserscriptOperations(best, candidate) < 0) best = candidate;
  }
  if (!best) return { found: false, value: fallback };
  if (
    rawPresent &&
    !allOperations.some(
      (candidate) => candidate.operation.kind === "set" && storageValuesEqual(rawValue, candidate.operation.value)
    )
  ) {
    return { found: true, value: rawValue };
  }
  return {
    found: true,
    value: best.operation.kind === "remove" ? fallback : best.operation.value
  };
}

function isUserscriptFenceOperation(
  value: unknown,
  storageKey: string
): value is UserscriptFenceOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operation = value as Partial<UserscriptFenceOperation>;
  return (
    operation.version === 1 &&
    typeof operation.operationId === "string" &&
    operation.operationId.length > 0 &&
    operation.storageKey === storageKey &&
    (operation.kind === "set" || operation.kind === "remove") &&
    isStorageLockFence(operation.fence)
  );
}

function isUserscriptFenceReceipt(value: unknown): value is UserscriptFenceReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<UserscriptFenceReceipt>;
  return (
    receipt.version === 1 &&
    typeof receipt.operationId === "string" &&
    receipt.operationId.length > 0 &&
    typeof receipt.committedAt === "number" &&
    Number.isFinite(receipt.committedAt)
  );
}

function storageValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => storageValuesEqual(value, right[index]))
    );
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && storageValuesEqual(leftRecord[key], rightRecord[key])
      )
    );
  }
  return false;
}

function compareUserscriptOperations(
  left: CommittedUserscriptOperation,
  right: CommittedUserscriptOperation
): number {
  if (left.operation.fence.name === right.operation.fence.name) {
    const generation = left.operation.fence.generation - right.operation.fence.generation;
    if (generation !== 0) return generation;
  }
  return (
    left.receipt.committedAt - right.receipt.committedAt ||
    left.operation.fence.owner.localeCompare(right.operation.fence.owner) ||
    left.operationKey.localeCompare(right.operationKey)
  );
}
