import type { StorageGateway } from "./storage";

/**
 * Coordination for the stores two X tabs share.
 *
 * Every whole-state store in Aviary loads once into memory and persists a full snapshot. That is
 * fine in one tab and silently lossy in two: a hide in tab A and a hide in tab B each write the
 * snapshot they happened to load, so whichever writes second erases the other. The same shape
 * costs more in the integration usage ledger, where "read the counter, add to it, write it back"
 * across two tabs lets one day's byte budget be spent twice.
 *
 * Web Locks is the answer the platform already ships -- Chrome 69 / Firefox 96 / Safari 15.4, no
 * dependency, and scoped per origin so two `x.com` tabs genuinely share one. What it does not do
 * is merge; a lock only makes "read, change, write" atomic. So the pattern here is always
 * read-modify-write *inside* the lock, with the store folding its own change into whatever it
 * finds on disk rather than overwriting with what it loaded at boot.
 */

type LockManagerLike = {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
};

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

function lockManager(): LockManagerLike | undefined {
  const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks;
  return typeof locks?.request === "function" ? locks : undefined;
}

/** True when this browser can coordinate across tabs rather than only within this one. */
export function crossTabLocksAvailable(): boolean {
  return lockManager() !== undefined;
}

/**
 * Runs `run` while holding `name`, exclusively, across every tab in this origin.
 *
 * The lock is released whether `run` resolves or rejects; a store whose write fails must not
 * leave every other tab blocked on it.
 */
export async function withStorageLock<T>(name: string, run: () => Promise<T>): Promise<T> {
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

async function runUnderBrowserLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  if (!locks) {
    return run();
  }
  let result!: T;
  let failure: unknown;
  let failed = false;
  await locks.request(`aviary.${name}`, async () => {
    try {
      result = await run();
    } catch (error) {
      failed = true;
      failure = error;
    }
  });
  if (failed) {
    throw failure;
  }
  return result;
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
  mutate: (stored: T) => T | Promise<T>
): Promise<T> {
  return withStorageLock(key, async () => {
    const stored = await storage.get<T>(key, fallback);
    const next = await mutate(stored);
    await storage.set(key, next);
    return next;
  });
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
  await withStorageLock(key, async () => {
    await storage.set(key, value);
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
