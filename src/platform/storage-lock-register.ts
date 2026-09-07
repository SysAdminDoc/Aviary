/**
 * The small protocol used by extension pages to ask the background-owned lock register for one
 * lock's roster. A page must never enumerate the whole extension storage area to find contenders:
 * settings, queues, archives, and credentials live beside the register.
 */

export const STORAGE_LOCK_REGISTER_MESSAGE = "AVIARY_STORAGE_LOCK_REGISTER";
const STORAGE_LOCK_REGISTER_VERSION = 1;
const STORAGE_LOCK_ROSTER_PREFIX = "aviary.lock.v1.roster.";
const MAX_PREFIX_LENGTH = 512;
const MAX_KEY_LENGTH = 768;

export type StorageLockRegisterOperation = "entries" | "write" | "remove";

export interface StorageLockRegisterRequest {
  type: typeof STORAGE_LOCK_REGISTER_MESSAGE;
  version: typeof STORAGE_LOCK_REGISTER_VERSION;
  operation: StorageLockRegisterOperation;
  prefix: string;
  key?: string;
  value?: unknown;
}

export interface StorageLockRegisterResponse {
  ok: boolean;
  entries?: Array<[string, unknown]>;
  error?: string;
}

interface StorageLockRoster {
  version: typeof STORAGE_LOCK_REGISTER_VERSION;
  prefix: string;
  entries: Array<[string, unknown]>;
}

interface LockRegisterStorage {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export function isStorageLockRegisterRequest(value: unknown): value is StorageLockRegisterRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<StorageLockRegisterRequest>;
  if (
    request.type !== STORAGE_LOCK_REGISTER_MESSAGE ||
    request.version !== STORAGE_LOCK_REGISTER_VERSION ||
    (request.operation !== "entries" && request.operation !== "write" && request.operation !== "remove") ||
    typeof request.prefix !== "string" ||
    request.prefix.length === 0 ||
    request.prefix.length > MAX_PREFIX_LENGTH
  ) {
    return false;
  }
  if (request.operation === "entries") return true;
  return (
    typeof request.key === "string" &&
    request.key.length > 0 &&
    request.key.length <= MAX_KEY_LENGTH &&
    request.key.startsWith(`${request.prefix}.`) &&
    (request.operation === "remove" || "value" in request)
  );
}

/**
 * Background-owned roster authority.
 *
 * Each lock has one persisted roster key. Updates for that prefix are serialized in the worker,
 * so two pages cannot overwrite one another's contender while the page polling path reads one
 * known key. The roster survives a worker restart; the worker does not need a second discovery
 * scan to rebuild it.
 */
export class StorageLockRegisterAuthority {
  readonly #storage: LockRegisterStorage | undefined;
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(storage?: LockRegisterStorage) {
    this.#storage = storage ?? (globalThis.chrome?.storage?.local as LockRegisterStorage | undefined);
  }

  async handle(
    request: StorageLockRegisterRequest,
    storage: LockRegisterStorage | undefined = this.#storage
  ): Promise<StorageLockRegisterResponse> {
    if (!isStorageLockRegisterRequest(request)) {
      return { ok: false, error: "The lock register request was malformed." };
    }
    if (!storage) return { ok: false, error: "The lock register storage is unavailable." };
    try {
      return await this.#serialize(request.prefix, async () => {
        const roster = await readRoster(storage, request.prefix);
        if (request.operation === "entries") {
          return { ok: true, entries: roster.entries.map(([key, value]) => [key, value]) };
        }

        const next = new Map(roster.entries);
        if (request.operation === "remove") next.delete(request.key!);
        else next.set(request.key!, request.value);
        await writeRoster(storage, request.prefix, next);
        return { ok: true };
      });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async #serialize<T>(prefix: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(prefix) ?? Promise.resolve();
    const attempt = previous.then(action, action);
    const settled = attempt.then(() => undefined, () => undefined);
    this.#chains.set(prefix, settled);
    void settled.then(() => {
      if (this.#chains.get(prefix) === settled) this.#chains.delete(prefix);
    });
    return attempt;
  }
}

/** Sends one roster operation to the extension background authority. */
export async function sendStorageLockRegister(
  request: StorageLockRegisterRequest
): Promise<StorageLockRegisterResponse> {
  const runtime = globalThis.chrome?.runtime as {
    sendMessage?: (message: unknown, callback?: (response: unknown) => void) => unknown;
    lastError?: { message?: string };
  } | undefined;
  if (typeof runtime?.sendMessage !== "function") {
    throw new Error("The extension lock register authority is unavailable.");
  }

  const response = await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown, error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    try {
      const pending = runtime.sendMessage!(request, (value) => {
        const error = runtime.lastError?.message;
        finish(value, error ? new Error(`Storage lock register message failed: ${error}`) : undefined);
      });
      if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
        (pending as PromiseLike<unknown>).then(
          (value) => finish(value),
          (error) => finish(undefined, error)
        );
      }
    } catch (error) {
      finish(undefined, error);
    }
  });

  if (!response || typeof response !== "object" || (response as { ok?: unknown }).ok !== true) {
    const message = response && typeof response === "object" && typeof (response as { error?: unknown }).error === "string"
      ? (response as { error: string }).error
      : "The extension lock register rejected the request.";
    throw new Error(message);
  }
  return response as StorageLockRegisterResponse;
}

function rosterKey(prefix: string): string {
  return `${STORAGE_LOCK_ROSTER_PREFIX}${encodeURIComponent(prefix)}`;
}

async function readRoster(storage: LockRegisterStorage, prefix: string): Promise<StorageLockRoster> {
  const key = rosterKey(prefix);
  const raw = (await storage.get(key))[key];
  if (!raw || typeof raw !== "object") return { version: 1, prefix, entries: [] };
  const value = raw as Partial<StorageLockRoster>;
  if (value.version !== STORAGE_LOCK_REGISTER_VERSION || value.prefix !== prefix || !Array.isArray(value.entries)) {
    return { version: 1, prefix, entries: [] };
  }
  const entries = value.entries.filter(
    (entry): entry is [string, unknown] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      entry[0].startsWith(`${prefix}.`)
  );
  return { version: 1, prefix, entries };
}

async function writeRoster(
  storage: LockRegisterStorage,
  prefix: string,
  entries: Map<string, unknown>
): Promise<void> {
  const key = rosterKey(prefix);
  if (entries.size === 0) {
    await storage.remove(key);
    return;
  }
  await storage.set({
    [key]: {
      version: STORAGE_LOCK_REGISTER_VERSION,
      prefix,
      entries: [...entries.entries()]
    } satisfies StorageLockRoster
  });
}
