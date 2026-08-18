import type { StorageGateway } from "../../platform/storage";
import { mutateStored, replaceStored } from "../../platform/storage-lock";

export const SEEN_POSTS_KEY = "aviary.seenPosts.v1";
export const SEEN_POSTS_LIMIT = 4000;
export const SEEN_POSTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TWEET_ID = /^\d{1,25}$/;

interface StoredSeenPosts {
  version: 1;
  /** Post id -> epoch milliseconds first seen. Ids only; no text, handle, or URL. */
  seen: Record<string, number>;
}

/**
 * Which posts have already scrolled past, so a second pass through the timeline can fade them.
 *
 * Deliberately the narrowest store in the project: a numeric post id and a timestamp. No text, no
 * handle, no URL — knowing that id 123 was on screen reveals nothing that reading the timeline did
 * not already show, and it keeps this feature outside every retention question the export and
 * capture stores have to answer.
 */
export class SeenPostStore {
  readonly #storage: StorageGateway;
  #seen = new Map<string, number>();
  #loaded = false;
  #tail: Promise<void> = Promise.resolve();
  #dirty = false;
  /**
   * Sightings made since the last flush.
   *
   * The merge folds these into what is stored rather than the whole in-memory map, so a "forget
   * what I have seen" in another tab is not undone by this tab's next flush.
   */
  #pending = new Map<string, number>();

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) {
      return;
    }
    this.#loaded = true;
    try {
      this.#seen = parse(await this.#storage.get<unknown>(SEEN_POSTS_KEY, undefined));
    } catch {
      this.#seen = new Map();
    }
  }

  has(id: string): boolean {
    return this.#seen.has(id);
  }

  get size(): number {
    return this.#seen.size;
  }

  /**
   * Record a post as seen. Returns true when this is the first time, so callers can tell a
   * first sighting from a revisit without a second lookup.
   */
  mark(id: string, now: number): boolean {
    if (!TWEET_ID.test(id) || this.#seen.has(id)) {
      return false;
    }
    this.#seen.set(id, now);
    this.#pending.set(id, now);
    this.#dirty = true;
    return true;
  }

  /**
   * Persist pending marks. Called on a cadence rather than per post: a timeline scroll can mark
   * dozens.
   *
   * Merged rather than overwritten: two tabs scrolling two timelines each held their own map, so
   * whichever flushed second erased the other's sightings -- and the seen store's whole job is to
   * know what has already gone past. The union is taken under a cross-tab lock and the retention
   * rules are re-applied to the merged map, so the cap still holds.
   */
  flush(now: number): void {
    if (!this.#dirty) {
      return;
    }
    this.#dirty = false;
    this.#prune(now);
    const pending = this.#pending;
    this.#pending = new Map();
    this.#tail = this.#tail
      .then(async () => {
        const merged = await mutateStored<unknown>(
          this.#storage,
          SEEN_POSTS_KEY,
          undefined,
          (stored) => {
            const combined = parse(stored);
            for (const [id, at] of pending) {
              // This tab's timestamp wins only when it is the later sighting.
              const existing = combined.get(id);
              if (existing === undefined || existing < at) {
                combined.set(id, at);
              }
            }
            return { version: 1, seen: Object.fromEntries(prune(combined, now)) } satisfies StoredSeenPosts;
          }
        );
        this.#seen = parse(merged);
      })
      .then(
        () => undefined,
        () => undefined
      );
  }

  async settled(): Promise<void> {
    await this.#tail;
  }

  async clear(): Promise<void> {
    this.#seen = new Map();
    this.#pending = new Map();
    this.#dirty = false;
    this.#loaded = true;
    // A replace, not a merge: forgetting what has been seen must not be undone by another tab.
    await replaceStored(this.#storage, SEEN_POSTS_KEY, {
      version: 1,
      seen: {}
    } satisfies StoredSeenPosts);
  }

  #prune(now: number): void {
    this.#seen = prune(this.#seen, now);
  }
}

function parse(raw: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!raw || typeof raw !== "object") {
    return result;
  }
  const seen = (raw as Partial<StoredSeenPosts>).seen;
  if (!seen || typeof seen !== "object") {
    return result;
  }
  const cutoff = Date.now() - SEEN_POSTS_RETENTION_MS;
  for (const [id, at] of Object.entries(seen)) {
    if (!TWEET_ID.test(id) || typeof at !== "number" || !Number.isFinite(at) || at < cutoff) {
      continue;
    }
    result.set(id, at);
  }
  return result;
}

/**
 * Retention, applied to any map -- this tab's, or the union of this tab's and another's.
 *
 * Shared because the merge has to re-apply exactly the rules the in-memory store applies, or the
 * cap would hold in one tab and not across two.
 */
function prune(seen: Map<string, number>, now: number): Map<string, number> {
  const cutoff = now - SEEN_POSTS_RETENTION_MS;
  const kept = new Map<string, number>();
  for (const [id, at] of seen) {
    if (at >= cutoff) {
      kept.set(id, at);
    }
  }
  if (kept.size <= SEEN_POSTS_LIMIT) {
    return kept;
  }
  // Oldest first: a Map preserves insertion order, and entries are inserted as they are seen.
  const excess = kept.size - SEEN_POSTS_LIMIT;
  let dropped = 0;
  for (const id of [...kept.keys()]) {
    if (dropped >= excess) break;
    kept.delete(id);
    dropped += 1;
  }
  return kept;
}
