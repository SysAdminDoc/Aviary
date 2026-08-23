import { storageValueBytes } from "./storage-value-hash.ts";

export interface StorageGateway {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  getStatus?(): StorageStatus;
}

export interface StorageStatus {
  backend: "legacy" | "indexeddb" | "indexeddb-fallback" | "userscript-manager";
  schemaVersion: number;
  migratedKeys: number;
  usageBytes: number | null;
  quotaBytes: number | null;
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
};

export const USERSCRIPT_MANAGER_VALUE_LIMIT_BYTES = 16 * 1024 * 1024;

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
      typeof globals.GM_deleteValue !== "function")
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
          return await globals.GM_getValue(storageKey, fallback);
        }

        if (mode !== "userscript" && globalThis.chrome?.storage?.local) {
          const result = await globalThis.chrome.storage.local.get(storageKey);
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

    async set<T>(key: string, value: T): Promise<void> {
      const storageKey = scoped(key);

      // Reported and rethrown: callers that deliberately swallow the error keep working, but
      // the failure is no longer invisible. A quota error here is the difference between "a
      // setting did not stick" and "the browser store is full".
      try {
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

    async remove(key: string): Promise<void> {
      const storageKey = scoped(key);

      // A delete is a write, and it was the one write this module could not see. Callers such as
      // ProfileManager.adoptLegacyIntoActive call remove() bare, so a backend failure there used
      // to propagate as an unreported rejection while the comment at the top of this file promised
      // the opposite.
      try {
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
    }
  };
}
