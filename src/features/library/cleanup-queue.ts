import type { StorageGateway } from "../../platform/storage.ts";
import type { CleanupCandidate } from "./cleanup-preview.ts";

export const CLEANUP_QUEUE_KEY = "aviary.cleanupQueue.v1";
export const CLEANUP_QUEUE_LIMIT = 5000;

export type CleanupQueueStatus = "queued" | "approved" | "skipped" | "complete";

export interface CleanupQueueItem extends CleanupCandidate {
  id: string;
  enqueuedAt: string;
  status: CleanupQueueStatus;
  reviewedAt?: string;
  reviewerNote?: string;
}

interface CleanupQueueState {
  items: CleanupQueueItem[];
  destructiveExecuted: boolean;
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
      destructiveExecuted: stored?.destructiveExecuted === true
    };
    this.#loaded = true;
  }

  async enqueue(candidates: readonly CleanupCandidate[]): Promise<number> {
    await this.load();
    let added = 0;
    for (const candidate of candidates) {
      if (candidate.protected) continue;
      this.#state.items.push({
        ...candidate,
        id: `item-${Date.now()}-${(this.#sequence += 1)}`,
        enqueuedAt: new Date().toISOString(),
        status: "queued"
      });
      added += 1;
    }
    while (this.#state.items.length > this.#limit) {
      this.#state.items.shift();
    }
    await this.#persist();
    return added;
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
    await this.#persist();
  }

  async clear(): Promise<void> {
    // Loaded first: clearing before the stored state has been read would drop
    // `destructiveExecuted` back to false rather than preserving what was on disk.
    await this.load();
    this.#state = { items: [], destructiveExecuted: this.#state.destructiveExecuted };
    this.#loaded = true;
    await this.#persist();
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

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(CLEANUP_QUEUE_KEY, this.#state);
    } catch {
      // best effort
    }
  }
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
