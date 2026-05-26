export interface StorageGateway {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

type GlobalWithUserscriptStorage = typeof globalThis & {
  GM_getValue?: <T>(key: string, fallback: T) => T | Promise<T>;
  GM_setValue?: <T>(key: string, value: T) => void | Promise<void>;
  GM_deleteValue?: (key: string) => void | Promise<void>;
};

export function createStorageGateway(namespace = "aviary"): StorageGateway {
  const scoped = (key: string) => {
    if (namespace.length === 0 || key.startsWith(`${namespace}.`)) {
      return key;
    }
    return `${namespace}.${key}`;
  };
  const globals = globalThis as GlobalWithUserscriptStorage;

  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const storageKey = scoped(key);

      try {
        if (typeof globals.GM_getValue === "function") {
          return await globals.GM_getValue(storageKey, fallback);
        }

        if (globalThis.chrome?.storage?.local) {
          const result = await globalThis.chrome.storage.local.get(storageKey);
          return result[storageKey] === undefined ? fallback : (result[storageKey] as T);
        }

        const raw = globalThis.localStorage?.getItem(storageKey);
        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      const storageKey = scoped(key);

      if (typeof globals.GM_setValue === "function") {
        await globals.GM_setValue(storageKey, value);
        return;
      }

      if (globalThis.chrome?.storage?.local) {
        await globalThis.chrome.storage.local.set({ [storageKey]: value });
        return;
      }

      if (globalThis.localStorage) {
        globalThis.localStorage.setItem(storageKey, JSON.stringify(value));
        return;
      }

      throw new Error(`No storage backend is available for ${storageKey}`);
    },

    async remove(key: string): Promise<void> {
      const storageKey = scoped(key);

      if (typeof globals.GM_deleteValue === "function") {
        await globals.GM_deleteValue(storageKey);
        return;
      }

      if (globalThis.chrome?.storage?.local) {
        await globalThis.chrome.storage.local.remove(storageKey);
        return;
      }

      if (globalThis.localStorage) {
        globalThis.localStorage.removeItem(storageKey);
        return;
      }

      throw new Error(`No storage backend is available for ${storageKey}`);
    }
  };
}
