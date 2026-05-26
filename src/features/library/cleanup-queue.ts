import type { StorageGateway } from "../../platform/storage";
import type { CleanupCandidate } from "./cleanup-preview";

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

const EMPTY: CleanupQueueState = { items: [], destructiveExecuted: false };

export class CleanupQueue {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #state: CleanupQueueState = EMPTY;
  #loaded = false;

  constructor(storage: StorageGateway, limit = CLEANUP_QUEUE_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(50, limit);
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<CleanupQueueState>(CLEANUP_QUEUE_KEY, EMPTY);
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
        id: `item-${Date.now()}-${this.#state.items.length}-${added}`,
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
    this.#state = { items: [], destructiveExecuted: this.#state.destructiveExecuted };
    this.#loaded = true;
    await this.#persist();
  }

  /**
   * Aviary does not delete account data in v1.0.0. This flag exists to record
   * the deliberate refusal so future versions can flip it behind an explicit
   * destructive-action toggle. The current implementation always reports false.
   */
  destructiveAllowed(): boolean {
    return false;
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
    typeof candidate.bucket === "string"
  );
}
