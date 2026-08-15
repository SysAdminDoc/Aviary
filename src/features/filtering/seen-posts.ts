import type { StorageGateway } from "../../platform/storage";

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
    this.#dirty = true;
    return true;
  }

  /** Persist pending marks. Called on a cadence rather than per post: a timeline scroll can mark dozens. */
  flush(now: number): void {
    if (!this.#dirty) {
      return;
    }
    this.#dirty = false;
    this.#prune(now);
    const payload: StoredSeenPosts = { version: 1, seen: Object.fromEntries(this.#seen) };
    this.#tail = this.#tail
      .then(() => this.#storage.set(SEEN_POSTS_KEY, payload))
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
    this.#dirty = false;
    this.#loaded = true;
    await this.#storage.set(SEEN_POSTS_KEY, { version: 1, seen: {} } satisfies StoredSeenPosts);
  }

  #prune(now: number): void {
    const cutoff = now - SEEN_POSTS_RETENTION_MS;
    for (const [id, at] of this.#seen) {
      if (at < cutoff) {
        this.#seen.delete(id);
      }
    }
    if (this.#seen.size <= SEEN_POSTS_LIMIT) {
      return;
    }
    // Oldest first: a Map preserves insertion order, and entries are inserted as they are seen.
    const excess = this.#seen.size - SEEN_POSTS_LIMIT;
    let dropped = 0;
    for (const id of this.#seen.keys()) {
      if (dropped >= excess) break;
      this.#seen.delete(id);
      dropped += 1;
    }
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
