import type { StorageGateway } from "../../platform/storage.ts";
import { mutateStored, replaceStored } from "../../platform/storage-lock.ts";
import type { RouteSurface } from "../../platform/route.ts";

export const SEEN_POSTS_KEY = "aviary.seenPosts.v1";
export const SEEN_POSTS_LIMIT = 4000;
export const SEEN_POSTS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TWEET_ID = /^\d{1,25}$/;

/** Route surfaces that can carry a chronological reading position. */
export const READING_MARKER_SURFACES = [
  "home",
  "status",
  "profile",
  "search",
  "notifications",
  "messages"
] as const satisfies readonly RouteSurface[];
export type ReadingMarkerSurface = (typeof READING_MARKER_SURFACES)[number];
export const READING_MARKERS_KEY = "aviary.readingMarkers.v1";
export const READING_MARKERS_VERSION = 1 as const;

export interface ReadingMarker {
  lastReadId: string;
  updatedAt: number;
}

export interface ReadingMarkersSnapshot {
  version: typeof READING_MARKERS_VERSION;
  markers: Partial<Record<ReadingMarkerSurface, ReadingMarker>>;
}

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

  /** The first-sighted timestamp is the join key for the catch-up reading copy. */
  seenAt(id: string): number | null {
    return this.#seen.get(id) ?? null;
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

/**
 * One small, profile-scoped position per feed surface. It stores no post content. Snowflake ids
 * are compared as decimal strings so a marker never loses precision in JavaScript numbers.
 *
 * `advance` is deliberately directional: scrolling down X's newest-first timeline moves the
 * read boundary toward older (smaller) ids. Scrolling back toward newer posts cannot make a read
 * marker jump forward without an explicit button press.
 */
export class ReadingMarkerStore {
  readonly #storage: StorageGateway;
  #markers = new Map<ReadingMarkerSurface, ReadingMarker>();
  #pending = new Map<ReadingMarkerSurface, ReadingMarker>();
  #loaded = false;
  #dirty = false;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      this.#markers = parseReadingMarkers(await this.#storage.get<unknown>(READING_MARKERS_KEY, undefined));
    } catch {
      this.#markers = new Map();
    }
  }

  get(surface: ReadingMarkerSurface): ReadingMarker | null {
    const marker = this.#markers.get(surface);
    return marker ? { ...marker } : null;
  }

  /** Store a user-selected position, including an explicit mark-above action. */
  set(surface: ReadingMarkerSurface, lastReadId: string, now: number): boolean {
    if (!isReadingMarkerSurface(surface) || !TWEET_ID.test(lastReadId) || !Number.isFinite(now)) {
      return false;
    }
    const next = { lastReadId, updatedAt: Math.max(0, Math.floor(now)) } satisfies ReadingMarker;
    const current = this.#markers.get(surface);
    if (current?.lastReadId === next.lastReadId) {
      return false;
    }
    this.#markers.set(surface, next);
    this.#pending.set(surface, next);
    this.#dirty = true;
    return true;
  }

  /** Move the boundary toward older posts when one leaves the viewport upward. */
  advance(surface: ReadingMarkerSurface, lastReadId: string, now: number): boolean {
    const current = this.#markers.get(surface);
    if (current && compareTweetIds(lastReadId, current.lastReadId) >= 0) {
      return false;
    }
    return this.set(surface, lastReadId, now);
  }

  snapshot(): ReadingMarkersSnapshot {
    return {
      version: READING_MARKERS_VERSION,
      markers: Object.fromEntries(
        [...this.#markers.entries()].map(([surface, marker]) => [surface, { ...marker }])
      ) as Partial<Record<ReadingMarkerSurface, ReadingMarker>>
    };
  }

  async clear(surface?: ReadingMarkerSurface): Promise<void> {
    if (surface === undefined) {
      this.#markers.clear();
      this.#pending.clear();
      this.#dirty = false;
      this.#loaded = true;
      await this.#tail;
      await replaceStored(this.#storage, READING_MARKERS_KEY, {
        version: READING_MARKERS_VERSION,
        markers: {}
      } satisfies ReadingMarkersSnapshot);
      return;
    }
    if (!isReadingMarkerSurface(surface)) return;
    this.#markers.delete(surface);
    this.#pending.delete(surface);
    this.#dirty = this.#pending.size > 0;
    await this.#tail;
    const merged = await mutateStored<unknown>(this.#storage, READING_MARKERS_KEY, {
      version: READING_MARKERS_VERSION,
      markers: {}
    }, (stored) => {
      const next = parseReadingMarkers(stored);
      next.delete(surface);
      return snapshotFromMap(next);
    });
    this.#markers = parseReadingMarkers(merged);
  }

  flush(): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    const pending = this.#pending;
    this.#pending = new Map();
    this.#tail = this.#tail
      .then(async () => {
        const merged = await mutateStored<unknown>(
          this.#storage,
          READING_MARKERS_KEY,
          { version: READING_MARKERS_VERSION, markers: {} } satisfies ReadingMarkersSnapshot,
          (stored) => {
            const next = parseReadingMarkers(stored);
            for (const [surface, marker] of pending) {
              const current = next.get(surface);
              if (!current || marker.updatedAt >= current.updatedAt) {
                next.set(surface, marker);
              }
            }
            return snapshotFromMap(next);
          }
        );
        this.#markers = parseReadingMarkers(merged);
        for (const [surface, marker] of this.#pending) {
          this.#markers.set(surface, marker);
        }
      })
      .then(
        () => undefined,
        () => undefined
      );
  }

  async settled(): Promise<void> {
    await this.#tail;
  }
}

export function isReadingMarkerSurface(value: unknown): value is ReadingMarkerSurface {
  return (READING_MARKER_SURFACES as readonly string[]).includes(String(value));
}

/** Positive when `left` is a newer X snowflake than `right`. */
export function compareTweetIds(left: string, right: string): number {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  return left === right ? 0 : left > right ? 1 : -1;
}

function snapshotFromMap(markers: Map<ReadingMarkerSurface, ReadingMarker>): ReadingMarkersSnapshot {
  return {
    version: READING_MARKERS_VERSION,
    markers: Object.fromEntries(markers.entries()) as Partial<Record<ReadingMarkerSurface, ReadingMarker>>
  };
}

function parseReadingMarkers(raw: unknown): Map<ReadingMarkerSurface, ReadingMarker> {
  const result = new Map<ReadingMarkerSurface, ReadingMarker>();
  if (!raw || typeof raw !== "object") return result;
  const markers = (raw as Partial<ReadingMarkersSnapshot>).markers;
  if (!markers || typeof markers !== "object") return result;
  for (const [surface, value] of Object.entries(markers)) {
    if (!isReadingMarkerSurface(surface) || !value || typeof value !== "object") continue;
    const candidate = value as Partial<ReadingMarker>;
    if (
      typeof candidate.lastReadId !== "string" ||
      !TWEET_ID.test(candidate.lastReadId) ||
      typeof candidate.updatedAt !== "number" ||
      !Number.isFinite(candidate.updatedAt) ||
      candidate.updatedAt < 0
    ) {
      continue;
    }
    result.set(surface, {
      lastReadId: candidate.lastReadId,
      updatedAt: Math.floor(candidate.updatedAt)
    });
  }
  return result;
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
