import type { StorageGateway } from "./storage.ts";
import {
  hasExtensionFenceTransport,
  sendStorageFenceControl,
  withStorageFenceContext,
  type StorageLockFence
} from "./storage-fence.ts";
import {
  sendStorageLockRegister,
  STORAGE_LOCK_REGISTER_MESSAGE
} from "./storage-lock-register.ts";

/**
 * Coordination for the stores two X tabs share.
 *
 * Every whole-state store in Aviary loads once into memory and persists a full snapshot. That is
 * fine in one tab and silently lossy in two: a hide in tab A and a hide in tab B each write the
 * snapshot they happened to load, so whichever writes second erases the other. The same shape
 * costs more in the integration usage ledger, where "read the counter, add to it, write it back"
 * across two tabs lets one day's byte budget be spent twice.
 *
 * Extension and userscript storage spans every matched X origin, while Web Locks does not. The
 * shared-storage register below implements a Lamport-style queue with one register per contender,
 * so x.com, twitter.com, and pro.x.com all coordinate through the same extension or manager-owned
 * authority. Web Locks remains the fallback for unprivileged browser and test contexts.
 */

type LockManagerLike = {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
  request(
    name: string,
    options: { mode: "shared" | "exclusive" },
    callback: () => Promise<unknown>
  ): Promise<unknown>;
};

type StorageGateMode = "shared" | "exclusive";

interface StorageGateRequest {
  mode: StorageGateMode;
  run: (fence?: StorageLockFence) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface SharedLockRegisterStore {
  kind: "extension" | "userscript";
  entries(prefix: string): Promise<Array<[string, unknown]>>;
  write(prefix: string, key: string, value: SharedLockContender): Promise<void>;
  remove(prefix: string, key: string): Promise<void>;
}

interface SharedLockContender {
  version: 1;
  owner: string;
  phase: "choosing" | "waiting";
  ticket: number;
  mode: StorageGateMode;
  expiresAt: number;
}

/**
 * In-process serialization, per lock name.
 *
 * Two reasons it exists even where Web Locks does. A host without `navigator.locks` -- an old
 * userscript sandbox, a test harness -- still gets same-tab atomicity, which is where the
 * overwhelming majority of concurrent writes come from: one tab, two features saving at once.
 * And it keeps the ordering deterministic, so a test can drive two writers without depending on
 * how a browser schedules lock grants.
 */
const chains = new Map<string, Promise<unknown>>();
const storageGateQueue: StorageGateRequest[] = [];
let storageGateReaders = 0;
let storageGateWriter = false;
let lockOwnerSequence = 0;

const SHARED_LOCK_PREFIX = "aviary.lock.v1";

/**
 * How long a contender's register entry stays authoritative without a renewal.
 *
 * A tab that is killed mid-transaction leaves its entry behind, so the lease is what stops one
 * crashed tab from wedging every other tab's writes forever. Long enough that an ordinary slow
 * transaction (a library restore over a large store) never loses its own lock, short enough that
 * a user who force-quit a tab is not staring at a dead panel. Exported so a test can pin it:
 * shortening the lease silently makes takeover racy, and lengthening it silently makes a crash
 * look like a hang.
 */
export const SHARED_LOCK_LEASE_MS = 30_000;
/** Renewal cadence. Must stay well under a third of the lease so one missed tick is survivable. */
export const SHARED_LOCK_RENEW_MS = 8_000;
/** How often a waiting contender re-reads the register. Bounds handoff latency. */
export const SHARED_LOCK_POLL_MS = 12;

function lockManager(): LockManagerLike | undefined {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  return typeof locks?.request === "function" ? locks : undefined;
}

/**
 * Runs `run` while holding `name`, exclusively, across every tab in this origin.
 *
 * The lock is released whether `run` resolves or rejects; a store whose write fails must not
 * leave every other tab blocked on it.
 */
export async function withStorageLock<T>(
  name: string,
  run: (fence?: StorageLockFence) => Promise<T>,
  options: { restoreGate?: boolean } = {}
): Promise<T> {
  if (options.restoreGate === false) return withNamedStorageLock(name, run);
  return withStorageRestoreGate("shared", () => withNamedStorageLock(name, run));
}

/** Holds the restore gate exclusively across preflight snapshot, restore, and rollback. */
export async function withExclusiveStorageGate<T>(
  run: (fence?: StorageLockFence) => Promise<T>
): Promise<T> {
  return withStorageRestoreGate("exclusive", run);
}

async function withNamedStorageLock<T>(
  name: string,
  run: (fence?: StorageLockFence) => Promise<T>
): Promise<T> {
  const previous = chains.get(name) ?? Promise.resolve();
  const attempt = previous.then(
    () => runUnderBrowserLock(name, run),
    // A failure ahead of us released its lock; it is not a reason to refuse this write.
    () => runUnderBrowserLock(name, run)
  );
  const settled = attempt.then(
    () => undefined,
    () => undefined
  );
  chains.set(name, settled);
  void settled.then(() => {
    // Nothing queued behind us, so the entry can go: otherwise this map grows one key per store
    // and never shrinks.
    if (chains.get(name) === settled) {
      chains.delete(name);
    }
  });
  return attempt;
}

function withStorageRestoreGate<T>(
  mode: StorageGateMode,
  run: (fence?: StorageLockFence) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    storageGateQueue.push({
      mode,
      run,
      resolve: (value) => resolve(value as T),
      reject
    });
    drainStorageGate();
  });
}

function drainStorageGate(): void {
  if (storageGateWriter || storageGateQueue.length === 0) return;
  if (storageGateReaders > 0 && storageGateQueue[0]?.mode === "exclusive") return;

  if (storageGateQueue[0]?.mode === "exclusive") {
    const request = storageGateQueue.shift()!;
    storageGateWriter = true;
    runStorageGateRequest(request);
    return;
  }

  while (storageGateQueue[0]?.mode === "shared" && !storageGateWriter) {
    const request = storageGateQueue.shift()!;
    storageGateReaders += 1;
    runStorageGateRequest(request);
  }
}

function runStorageGateRequest(request: StorageGateRequest): void {
  void runUnderSharedStorageLock(
    "aviary.library.restore",
    request.mode,
    request.run,
    "aviary.library.restore",
    request.mode === "exclusive"
  ).then(
    request.resolve,
    request.reject
  ).finally(() => {
    if (request.mode === "exclusive") storageGateWriter = false;
    else storageGateReaders -= 1;
    drainStorageGate();
  });
}

async function runUnderBrowserLock<T>(
  name: string,
  run: (fence?: StorageLockFence) => Promise<T>
): Promise<T> {
  return runUnderSharedStorageLock(`aviary.${name}`, "exclusive", run, name, false);
}

async function runUnderSharedStorageLock<T>(
  name: string,
  mode: StorageGateMode,
  run: (fence?: StorageLockFence) => Promise<T>,
  contextKey = name,
  exclusiveContext = false
): Promise<T> {
  const registerStore = sharedLockRegisterStore();
  if (registerStore) {
    return runUnderRegisterLock(
      registerStore,
      name,
      mode,
      (fence) => withStorageFenceContext(fence, contextKey, exclusiveContext, () => run(fence))
    );
  }
  const locks = lockManager();
  if (!locks) {
    return run(undefined);
  }
  let result!: T;
  let failure: unknown;
  let failed = false;
  const callback = async () => {
    try {
      result = await run(undefined);
    } catch (error) {
      failed = true;
      failure = error;
    }
  };
  if (mode === "shared") await locks.request(name, { mode }, callback);
  else await locks.request(name, callback);
  if (failed) {
    throw failure;
  }
  return result;
}

async function runUnderRegisterLock<T>(
  store: SharedLockRegisterStore,
  name: string,
  mode: StorageGateMode,
  run: (fence?: StorageLockFence) => Promise<T>
): Promise<T> {
  const encodedName = encodeURIComponent(name);
  if (encodedName.length > 320) throw new Error("The storage lock name is too long");
  const prefix = `${SHARED_LOCK_PREFIX}.${encodedName}`;
  const owner = nextLockOwner();
  const key = `${prefix}.${owner}`;
  let contender: SharedLockContender = {
    version: 1,
    owner,
    phase: "choosing",
    ticket: 0,
    mode,
    expiresAt: Date.now() + SHARED_LOCK_LEASE_MS
  };
  await store.write(prefix, key, contender);

  try {
    const initial = await readLockContenders(store, prefix, owner);
    contender = {
      ...contender,
      phase: "waiting",
      ticket: Math.max(0, ...initial.map((entry) => entry.ticket)) + 1,
      expiresAt: Date.now() + SHARED_LOCK_LEASE_MS
    };
    await store.write(prefix, key, contender);

    while (!(await lockCanEnter(store, prefix, contender))) {
      await waitForLockPoll();
      contender = await renewLockContender(store, key, contender);
    }

    const localFence: StorageLockFence = {
      version: 1,
      name,
      owner,
      generation: contender.ticket,
      expiresAt: contender.expiresAt
    };
    // The restore register has a shared mode for ordinary per-store writes. Those contenders may
    // overlap by design, while the extension background fence is exclusive by name. Do not make
    // every shared writer fight over one `aviary.library.restore` fence. The nested named lock
    // acquires the per-store fence that protects its actual mutation; the exclusive restore gate
    // still receives one fence covering the whole multi-key transaction.
    const needsFence = mode === "exclusive" || store.kind === "userscript";
    const remoteFence = needsFence ? await sendStorageFenceControl("acquire", localFence) : undefined;
    let fence = needsFence
      ? remoteFence ?? (store.kind === "userscript" ? localFence : undefined)
      : undefined;
    if (needsFence && !fence && hasExtensionFenceTransport()) {
      throw new Error("The extension background did not return a storage fence");
    }

    let renewal = Promise.resolve();
    let renewalFailure: unknown;
    const renew = () => {
      renewal = renewal.then(async () => {
        try {
          contender = await renewLockContender(store, key, contender);
          if (fence) {
            const renewed = {
              ...fence,
              expiresAt: contender.expiresAt
            } satisfies StorageLockFence;
            const remoteRenewed = await sendStorageFenceControl("renew", renewed);
            fence = remoteRenewed ?? (store.kind === "userscript" ? renewed : undefined);
            if (!fence && hasExtensionFenceTransport()) {
              throw new Error("The extension background did not renew the storage fence");
            }
          }
        } catch (error) {
          renewalFailure = error;
        }
      });
    };
    const timer = globalThis.setInterval(renew, SHARED_LOCK_RENEW_MS);
    try {
      const result = await run(fence);
      await renewal;
      if (renewalFailure) throw renewalFailure;
      return result;
    } finally {
      globalThis.clearInterval(timer);
      await renewal;
      try {
        if (fence) await sendStorageFenceControl("release", fence);
      } catch {
        // The register entry is still removed below. A background that disappeared during release
        // will forget this authority on expiry, and a fresh owner can safely acquire a generation.
      }
    }
  } finally {
    await store.remove(prefix, key);
  }
}

async function lockCanEnter(
  store: SharedLockRegisterStore,
  prefix: string,
  contender: SharedLockContender
): Promise<boolean> {
  const peers = await readLockContenders(store, prefix, contender.owner);
  if (peers.some((peer) => peer.phase === "choosing")) return false;
  return !peers.some((peer) => {
    if (peer.phase !== "waiting") return false;
    if (contender.mode === "shared" && peer.mode === "shared") return false;
    return compareLockContenders(peer, contender) < 0;
  });
}

async function readLockContenders(
  store: SharedLockRegisterStore,
  prefix: string,
  owner: string
): Promise<SharedLockContender[]> {
  const now = Date.now();
  const contenders: SharedLockContender[] = [];
  for (const [key, value] of await store.entries(prefix)) {
    if (!isSharedLockContender(value) || value.expiresAt <= now) {
      await store.remove(prefix, key);
      continue;
    }
    if (value.owner !== owner) contenders.push(value);
  }
  return contenders;
}

async function renewLockContender(
  store: SharedLockRegisterStore,
  key: string,
  contender: SharedLockContender
): Promise<SharedLockContender> {
  if (contender.expiresAt - Date.now() > SHARED_LOCK_RENEW_MS * 2) return contender;
  const renewed = { ...contender, expiresAt: Date.now() + SHARED_LOCK_LEASE_MS };
  await store.write(prefixFromRegisterKey(key), key, renewed);
  return renewed;
}

function compareLockContenders(left: SharedLockContender, right: SharedLockContender): number {
  return left.ticket - right.ticket || left.owner.localeCompare(right.owner);
}

function isSharedLockContender(value: unknown): value is SharedLockContender {
  if (!value || typeof value !== "object") return false;
  const contender = value as Partial<SharedLockContender>;
  return (
    contender.version === 1 &&
    typeof contender.owner === "string" &&
    contender.owner.length > 0 &&
    (contender.phase === "choosing" || contender.phase === "waiting") &&
    typeof contender.ticket === "number" &&
    Number.isSafeInteger(contender.ticket) &&
    contender.ticket >= 0 &&
    (contender.mode === "shared" || contender.mode === "exclusive") &&
    typeof contender.expiresAt === "number" &&
    Number.isFinite(contender.expiresAt)
  );
}

function nextLockOwner(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    ?? Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${(++lockOwnerSequence).toString(36)}-${random}`;
}

function waitForLockPoll(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, SHARED_LOCK_POLL_MS);
  });
}

function sharedLockRegisterStore(): SharedLockRegisterStore | undefined {
  const runtime = globalThis.chrome?.runtime;
  const extensionStorage = runtime?.id && typeof runtime.getManifest === "function"
    ? runtime.sendMessage
    : undefined;
  if (typeof extensionStorage === "function") {
    return {
      kind: "extension",
      async entries(prefix) {
        const response = await sendStorageLockRegister({
          type: STORAGE_LOCK_REGISTER_MESSAGE,
          version: 1,
          operation: "entries",
          prefix
        });
        return response.entries ?? [];
      },
      async write(prefix, key, value) {
        await sendStorageLockRegister({
          type: STORAGE_LOCK_REGISTER_MESSAGE,
          version: 1,
          operation: "write",
          prefix,
          key,
          value
        });
      },
      async remove(prefix, key) {
        await sendStorageLockRegister({
          type: STORAGE_LOCK_REGISTER_MESSAGE,
          version: 1,
          operation: "remove",
          prefix,
          key
        });
      }
    };
  }

  if (
    typeof globalThis.GM_listValues === "function" &&
    typeof globalThis.GM_getValue === "function" &&
    typeof globalThis.GM_setValue === "function" &&
    typeof globalThis.GM_deleteValue === "function"
  ) {
    return {
      kind: "userscript",
      async entries(prefix) {
        const raw = await ensureUserscriptRoster(prefix);
        return readUserscriptRoster(prefix, raw);
      },
      async write(prefix, key, value) {
        await updateUserscriptRoster(prefix, key, value);
      },
      async remove(prefix, key) {
        await updateUserscriptRoster(prefix, key, undefined, true);
      }
    };
  }
  return undefined;
}

function prefixFromRegisterKey(key: string): string {
  const separator = key.lastIndexOf(".");
  return separator > 0 ? key.slice(0, separator) : key;
}

const USERSCRIPT_ROSTER_VERSION = 1;
const migratedUserscriptRosterPrefixes = new Set<string>();

function lockRosterKey(prefix: string): string {
  return `${SHARED_LOCK_PREFIX}.roster.${encodeURIComponent(prefix)}`;
}

function readUserscriptRoster(prefix: string, raw: unknown): Array<[string, unknown]> {
  if (!raw || typeof raw !== "object") return [];
  const value = raw as { version?: unknown; prefix?: unknown; entries?: unknown };
  if (value.version !== USERSCRIPT_ROSTER_VERSION || value.prefix !== prefix || !Array.isArray(value.entries)) {
    return [];
  }
  return value.entries.filter(
    (entry): entry is [string, unknown] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      entry[0].startsWith(`${prefix}.`)
  );
}

async function migrateUserscriptRoster(prefix: string): Promise<void> {
  if (typeof globalThis.GM_listValues !== "function") return;
  const keys = (await globalThis.GM_listValues()).filter((key) => key.startsWith(`${prefix}.`));
  const entries = await Promise.all(keys.map(async (key) => [
    key,
    await globalThis.GM_getValue!(key, undefined)
  ] as [string, unknown]));
  await globalThis.GM_setValue!(lockRosterKey(prefix), {
    version: USERSCRIPT_ROSTER_VERSION,
    prefix,
    entries
  });
  migratedUserscriptRosterPrefixes.add(prefix);
}

async function ensureUserscriptRoster(prefix: string): Promise<unknown> {
  const key = lockRosterKey(prefix);
  const current = await globalThis.GM_getValue!(key, undefined);
  if (current !== undefined) return current;
  if (migratedUserscriptRosterPrefixes.has(prefix)) return undefined;
  await migrateUserscriptRoster(prefix);
  return globalThis.GM_getValue!(key, undefined);
}

async function updateUserscriptRoster(
  prefix: string,
  key: string,
  value: unknown,
  remove = false
): Promise<void> {
  const rosterKey = lockRosterKey(prefix);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const raw = await ensureUserscriptRoster(prefix);
    const entries = new Map(readUserscriptRoster(prefix, raw));
    if (remove) entries.delete(key);
    else entries.set(key, value);
    if (entries.size === 0) {
      await globalThis.GM_deleteValue!(rosterKey);
      migratedUserscriptRosterPrefixes.add(prefix);
      return;
    }
    await globalThis.GM_setValue!(rosterKey, {
      version: USERSCRIPT_ROSTER_VERSION,
      prefix,
      entries: [...entries.entries()]
    });
    const confirmed = new Map(readUserscriptRoster(prefix, await globalThis.GM_getValue!(rosterKey, undefined)));
    if (remove ? !confirmed.has(key) : valuesEqual(confirmed.get(key), value)) return;
  }
  throw new Error("The userscript lock roster did not settle");
}

function valuesEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

/**
 * Read, change, write -- atomically against every other tab.
 *
 * `mutate` receives what is *actually stored right now*, not what this tab loaded at boot, and
 * returns the value to write. Returning the merged value lets the caller adopt it as its new local
 * state, which is what keeps a second tab's entries from disappearing again on the next save.
 */
export async function mutateStored<T>(
  storage: StorageGateway,
  key: string,
  fallback: T,
  mutate: (stored: T) => T | Promise<T>,
  options: { restoreGate?: boolean } = {}
): Promise<T> {
  return withStorageLock(key, async (fence) => {
    const stored = await storage.get<T>(key, fallback);
    const next = await mutate(stored);
    await storage.set(key, next, fence);
    return next;
  }, options);
}

/**
 * Replaces a stored value outright, still under the lock.
 *
 * For the operations that genuinely mean "whatever else is there, forget it" -- clearing a
 * history, restoring a backup. Merging those would resurrect exactly what the user asked to
 * remove.
 */
export async function replaceStored<T>(
  storage: StorageGateway,
  key: string,
  value: T
): Promise<void> {
  await withStorageLock(key, async (fence) => {
    await storage.set(key, value, fence);
  });
}

/**
 * Folds a keyed collection into what another tab has already written.
 *
 * The generic half of merge-on-write. `added` wins over a stored entry with the same key --
 * this tab's version is the newer one, because it was written after this tab read -- and `removed`
 * is applied last so an unhide is not undone by another tab's stale copy of the entry.
 */
export function mergeKeyed<T>(
  stored: Iterable<[string, T]>,
  added: Iterable<[string, T]>,
  removed: Iterable<string> = []
): Map<string, T> {
  const merged = new Map(stored);
  for (const [key, value] of added) {
    merged.set(key, value);
  }
  for (const key of removed) {
    merged.delete(key);
  }
  return merged;
}
