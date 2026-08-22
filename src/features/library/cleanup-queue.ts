import type { StorageGateway } from "../../platform/storage.ts";
import { mergeKeyed, mutateStored, replaceStored } from "../../platform/storage-lock.ts";
import type { CleanupCandidate } from "./cleanup-preview.ts";

export const CLEANUP_QUEUE_KEY = "aviary.cleanupQueue.v1";
export const CLEANUP_QUEUE_LIMIT = 5000;

export type CleanupQueueStatus = "queued" | "approved" | "skipped" | "complete";

export interface CleanupQueueItem extends CleanupCandidate {
  id: string;
  enqueuedAt: string;
  /** The clear generation this item was written under. Absent on items stored before it existed. */
  generation?: number;
  status: CleanupQueueStatus;
  reviewedAt?: string;
  reviewerNote?: string;
}

interface CleanupQueueState {
  items: CleanupQueueItem[];
  destructiveExecuted: boolean;
  /**
   * How many times the queue has been cleared, so a merge can tell a new item from a stale one.
   *
   * Merging only what a call touched stops one tab erasing another's work, but it cannot by itself
   * tell "this item is new" from "this item is one the other tab was told to forget and I still
   * have in memory". Without this, reviewing an item after another tab cleared the queue put that
   * item straight back.
   *
   * A counter rather than a timestamp, because a timestamp does not survive a tie: a clear and an
   * enqueue in the same millisecond are indistinguishable, and the enqueue is the one that loses.
   * That is the same millisecond collision the item ids already carry a random suffix for.
   */
  generation?: number;
}

const CLEANUP_QUEUE_STATUSES: CleanupQueueStatus[] = ["queued", "approved", "skipped", "complete"];

/**
 * Thrown by `assertDestructiveAllowed`. Exported so a future destructive path can be tested
 * against the gate rather than against the boolean.
 */
export class DestructiveActionBlockedError extends Error {
  constructor(action: string) {
    super(`Destructive action refused: ${action}`);
    this.name = "DestructiveActionBlockedError";
  }
}

/**
 * A fresh state object per call.
 *
 * This used to be one shared module-level constant used both as the initial `#state` and as the
 * `storage.get` fallback, which put the same `items` array on every instance. Nothing mutated it
 * on the paths that exist today, so it was latent rather than live -- but the first destructive
 * path that pushed before `load()` would have written into a value shared by every future queue.
 */
function emptyState(): CleanupQueueState {
  return { items: [], destructiveExecuted: false };
}

/** True when this item was written before the clear that is on disk, so it must not come back. */
function clearedAway(item: CleanupQueueItem, generation: number): boolean {
  return (item.generation ?? 0) < generation;
}

export class CleanupQueue {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #state: CleanupQueueState = emptyState();
  #loaded = false;
  /** Monotonic within the session, so ids stay unique once the queue is trimming at its limit. */
  #sequence = 0;

  constructor(storage: StorageGateway, limit = CLEANUP_QUEUE_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(50, limit);
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<CleanupQueueState>(CLEANUP_QUEUE_KEY, emptyState());
    this.#state = {
      items: Array.isArray(stored?.items) ? stored.items.filter(isQueueItem).slice(-this.#limit) : [],
      destructiveExecuted: stored?.destructiveExecuted === true,
      generation: typeof stored?.generation === "number" ? stored.generation : 0
    };
    this.#loaded = true;
  }

  async enqueue(candidates: readonly CleanupCandidate[]): Promise<number> {
    await this.load();
    const added: CleanupQueueItem[] = [];
    for (const candidate of candidates) {
      if (candidate.protected) continue;
      const item: CleanupQueueItem = {
        ...candidate,
        id: newQueueItemId((this.#sequence += 1)),
        enqueuedAt: new Date().toISOString(),
        status: "queued"
      };
      this.#state.items.push(item);
      added.push(item);
    }
    while (this.#state.items.length > this.#limit) {
      this.#state.items.shift();
    }
    // Stamped at write time, from what is on disk. Stamping at enqueue time would use this tab's
    // idea of the generation, which is stale the moment another tab clears -- and an enqueue after
    // a clear is exactly the thing that must survive.
    await this.#persist(added, "new");
    return added.length;
  }

  list(status?: CleanupQueueStatus): CleanupQueueItem[] {
    if (!status) {
      return [...this.#state.items];
    }
    return this.#state.items.filter((item) => item.status === status);
  }

  size(): number {
    return this.#state.items.length;
  }

  async setStatus(id: string, status: CleanupQueueStatus, note?: string): Promise<void> {
    await this.load();
    const item = this.#state.items.find((entry) => entry.id === id);
    if (!item) return;
    item.status = status;
    item.reviewedAt = new Date().toISOString();
    if (note) item.reviewerNote = note;
    await this.#persist([item], "existing");
  }

  async clear(): Promise<void> {
    // Loaded first: clearing before the stored state has been read would drop
    // `destructiveExecuted` back to false rather than preserving what was on disk.
    await this.load();
    this.#state = {
      items: [],
      destructiveExecuted: this.#state.destructiveExecuted,
      generation: (this.#state.generation ?? 0) + 1
    };
    this.#loaded = true;
    // Replaced, not merged, for the same reason as the snapshot store: clearing means clearing.
    // The watermark is what stops another tab's next write putting the items back.
    await replaceStored(this.#storage, CLEANUP_QUEUE_KEY, this.#state);
  }

  /**
   * Aviary does not delete account data. Always false today; a future version would flip it
   * behind an explicit destructive-action toggle.
   */
  destructiveAllowed(): boolean {
    return false;
  }

  /**
   * The gate itself. Any code that would delete, unlike, unfollow or otherwise act on the
   * account must call this first -- it fails closed, so a destructive path added without a
   * deliberate decision throws instead of running.
   *
   * This exists because `destructiveAllowed()` alone was a recorded intention: it returned false
   * and nothing consulted it, so the guarantee held only by the accident that no destructive code
   * had been written yet.
   */
  assertDestructiveAllowed(action: string): void {
    if (!this.destructiveAllowed()) {
      throw new DestructiveActionBlockedError(action);
    }
  }

  /**
   * The items just written, folded into what is on disk.
   *
   * Items carry their own id, so a review in one tab and an enqueue in another both survive. Only
   * the items this call touched are merged: merging this tab's whole list would put back every
   * item the other tab was told to clear, and would overwrite the other tab's review of an item
   * this tab still holds in its pre-review state. `destructiveExecuted` only ever goes one way,
   * so it is or-ed rather than overwritten.
   */
  async #persist(touched: readonly CleanupQueueItem[], kind: "new" | "existing"): Promise<void> {
    try {
      this.#state = await mutateStored<CleanupQueueState>(
        this.#storage,
        CLEANUP_QUEUE_KEY,
        emptyState(),
        (stored) => {
          const generation = typeof stored?.generation === "number" ? stored.generation : 0;
          const existing = Array.isArray(stored?.items) ? stored.items.filter(isQueueItem) : [];
          const incoming =
            kind === "new"
              ? touched.map((item) => ({ ...item, generation }))
              : touched.filter((item) => !clearedAway(item, generation));
          const merged = mergeKeyed(
            existing.map((item) => [item.id, item] as [string, CleanupQueueItem]),
            incoming.map((item) => [item.id, item] as [string, CleanupQueueItem])
          );
          const items = [...merged.values()].sort(
            (a, b) => Date.parse(a.enqueuedAt) - Date.parse(b.enqueuedAt)
          );
          return {
            items: items.slice(-this.#limit),
            destructiveExecuted: stored?.destructiveExecuted === true || this.#state.destructiveExecuted,
            generation
          };
        }
      );
    } catch {
      // best effort
    }
  }
}

/**
 * Unique across tabs, not just within one.
 *
 * The sequence restarts at zero in every tab, so two tabs enqueueing in the same millisecond
 * produced the same id -- and the merge keys on id, so one of the two items silently vanished.
 * The same fix the bookmark store already carries, for the same reason.
 */
function newQueueItemId(sequence: number): string {
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `item-${Date.now()}-${sequence}-${random}`;
}

function isQueueItem(value: unknown): value is CleanupQueueItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CleanupQueueItem>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.enqueuedAt === "string" &&
    typeof candidate.status === "string" &&
    (CLEANUP_QUEUE_STATUSES as string[]).includes(candidate.status) &&
    typeof candidate.bucket === "string"
  );
}
