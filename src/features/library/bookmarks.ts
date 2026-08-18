import type { StorageGateway } from "../../platform/storage";
import { mutateStored, replaceStored } from "../../platform/storage-lock";

export const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
export const BOOKMARKS_LIMIT = 5000;

export interface BookmarkRecord {
  id: string;
  tweetId: string | null;
  handle: string | null;
  text: string;
  url: string | null;
  tags: string[];
  folder: string | null;
  remindAt: string | null;
  notes: string;
  capturedAt: string;
  updatedAt: string;
}

interface BookmarksState {
  entries: BookmarkRecord[];
}

/** A fresh object per call -- one shared constant would hand every store the same array. */
function emptyState(): BookmarksState {
  return { entries: [] };
}

export interface BookmarkInput {
  tweetId?: string | null;
  handle?: string | null;
  text?: string;
  url?: string | null;
  tags?: string[];
  folder?: string | null;
  remindAt?: string | null;
  notes?: string;
}

export class BookmarkStore {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #state: BookmarksState = emptyState();
  #loaded = false;
  /**
   * Monotonic within the session. The id used to end in `entries.length`, which is pinned to the
   * limit once the store is trimming -- so two bookmarks saved in the same millisecond got the
   * same id, and `remove()` filters by id, which would have deleted both.
   */
  #sequence = 0;

  constructor(storage: StorageGateway, limit = BOOKMARKS_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(64, limit);
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<BookmarksState>(BOOKMARKS_KEY, emptyState());
    this.#state = { entries: readBookmarks(stored).slice(-this.#limit) };
    this.#loaded = true;
  }

  async upsert(input: BookmarkInput): Promise<BookmarkRecord> {
    await this.load();
    const now = new Date().toISOString();
    const tweetId = normalizeId(input.tweetId);
    const existing = tweetId
      ? this.#state.entries.find((entry) => entry.tweetId === tweetId)
      : undefined;

    if (existing) {
      applyInput(existing, input);
      existing.updatedAt = now;
      await this.#persist({ added: [existing], removed: [] });
      return existing;
    }

    const entry: BookmarkRecord = {
      id: newBookmarkId(this.#sequence += 1),
      tweetId,
      handle: normalizeHandle(input.handle),
      text: normalizeText(input.text),
      url: normalizeUrl(input.url),
      tags: dedupeTags(input.tags ?? []),
      folder: normalizeFolder(input.folder),
      remindAt: normalizeReminder(input.remindAt),
      notes: normalizeNotes(input.notes),
      capturedAt: now,
      updatedAt: now
    };

    this.#state.entries.push(entry);
    while (this.#state.entries.length > this.#limit) {
      this.#state.entries.shift();
    }
    await this.#persist({ added: [entry], removed: [] });
    return entry;
  }

  async update(id: string, input: BookmarkInput): Promise<BookmarkRecord | null> {
    await this.load();
    const entry = this.#state.entries.find((candidate) => candidate.id === id);
    if (!entry) {
      return null;
    }
    applyInput(entry, input);
    entry.updatedAt = new Date().toISOString();
    await this.#persist({ added: [entry], removed: [] });
    return entry;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    this.#state.entries = this.#state.entries.filter((entry) => entry.id !== id);
    // Named explicitly, or the merge would find it still present in another tab's copy and put
    // the bookmark the user just deleted straight back.
    await this.#persist({ added: [], removed: [id] });
  }

  list(filter?: { tag?: string; folder?: string }): BookmarkRecord[] {
    return this.#state.entries.filter((entry) => {
      if (filter?.tag && !entry.tags.includes(filter.tag.toLowerCase())) return false;
      if (filter?.folder !== undefined && entry.folder !== filter.folder) return false;
      return true;
    }).map(cloneBookmark);
  }

  get(id: string): BookmarkRecord | null {
    const entry = this.#state.entries.find((candidate) => candidate.id === id);
    return entry ? cloneBookmark(entry) : null;
  }

  findByTweetId(tweetId: string): BookmarkRecord | null {
    const entry = this.#state.entries.find((candidate) => candidate.tweetId === tweetId);
    return entry ? cloneBookmark(entry) : null;
  }

  size(): number {
    return this.#state.entries.length;
  }

  tags(): string[] {
    const set = new Set<string>();
    for (const entry of this.#state.entries) {
      for (const tag of entry.tags) set.add(tag);
    }
    return [...set].sort();
  }

  folders(): string[] {
    const set = new Set<string>();
    for (const entry of this.#state.entries) {
      if (entry.folder) set.add(entry.folder);
    }
    return [...set].sort();
  }

  dueReminders(at: Date = new Date()): BookmarkRecord[] {
    return this.#state.entries.filter((entry) => {
      if (!entry.remindAt) return false;
      return Date.parse(entry.remindAt) <= at.getTime();
    }).map(cloneBookmark);
  }

  async clear(): Promise<void> {
    this.#state = { entries: [] };
    this.#loaded = true;
    try {
      // A replace: emptying the library means emptying it, not re-merging another tab's copy.
      await replaceStored(this.#storage, BOOKMARKS_KEY, this.#state);
    } catch {
      // best effort
    }
  }

  /**
   * Folds this tab's library into what is stored, under a cross-tab lock.
   *
   * Bookmarks are the most expensive thing here to lose: saving a post in one tab and a post in
   * another used to keep only whichever wrote second. `delta` is what this call changed -- never
   * the whole in-memory list, which would put back a bookmark another tab deleted while this one
   * still held its stale copy.
   */
  async #persist(delta: { added: BookmarkRecord[]; removed: string[] }): Promise<void> {
    try {
      const merged = await mutateStored<BookmarksState>(
        this.#storage,
        BOOKMARKS_KEY,
        { entries: [] },
        (stored) => {
          const byId = new Map<string, BookmarkRecord>();
          for (const entry of readBookmarks(stored)) {
            byId.set(entry.id, entry);
          }
          // Only what *this call* changed. Folding the whole local list in would resurrect a
          // bookmark another tab deleted while this one still held it in memory.
          for (const entry of delta.added) {
            const existing = byId.get(entry.id);
            if (!existing || existing.updatedAt <= entry.updatedAt) {
              byId.set(entry.id, entry);
            }
          }
          for (const id of delta.removed) {
            byId.delete(id);
          }
          const ordered = [...byId.values()].sort((left, right) =>
            left.capturedAt < right.capturedAt ? -1 : left.capturedAt > right.capturedAt ? 1 : 0
          );
          return { entries: ordered.slice(-this.#limit) };
        }
      );
      this.#state = { entries: readBookmarks(merged) };
    } catch {
      // best effort
    }
  }
}

function dedupeTags(input: readonly string[]): string[] {
  const set = new Set<string>();
  for (const tag of input) {
    if (typeof tag !== "string") continue;
    const cleaned = tag.replace(/^#/, "").trim().toLowerCase().slice(0, 32);
    if (/^[a-z0-9_-]{1,32}$/.test(cleaned)) {
      set.add(cleaned);
    }
  }
  return [...set].sort();
}

function isBookmark(value: unknown): value is BookmarkRecord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BookmarkRecord>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.capturedAt === "string" &&
    Number.isFinite(Date.parse(candidate.capturedAt))
  );
}

function normalizeBookmark(entry: BookmarkRecord): BookmarkRecord {
  const capturedAt = normalizeTimestamp(entry.capturedAt)!;
  return {
    id: entry.id.trim().slice(0, 96),
    tweetId: normalizeId(entry.tweetId),
    handle: normalizeHandle(entry.handle),
    text: normalizeText(entry.text),
    url: normalizeUrl(entry.url),
    tags: dedupeTags(Array.isArray(entry.tags) ? entry.tags : []),
    folder: normalizeFolder(entry.folder),
    remindAt: normalizeReminder(entry.remindAt),
    notes: normalizeNotes(entry.notes),
    capturedAt,
    // Older or partially written records may not have updatedAt. Sorting/search must remain safe
    // and the capture timestamp is the least surprising repair value.
    updatedAt: normalizeTimestamp(entry.updatedAt) ?? capturedAt
  };
}

function applyInput(entry: BookmarkRecord, input: BookmarkInput): void {
  if ("tweetId" in input) entry.tweetId = normalizeId(input.tweetId);
  if ("handle" in input) entry.handle = normalizeHandle(input.handle);
  if ("text" in input) entry.text = normalizeText(input.text);
  if ("url" in input) entry.url = normalizeUrl(input.url);
  if ("tags" in input) entry.tags = dedupeTags(input.tags ?? []);
  if ("folder" in input) entry.folder = normalizeFolder(input.folder);
  if ("remindAt" in input) entry.remindAt = normalizeReminder(input.remindAt);
  if ("notes" in input) entry.notes = normalizeNotes(input.notes);
}

function normalizeId(value: string | null | undefined): string | null {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned.length > 0 ? cleaned.slice(0, 64) : null;
}

function normalizeHandle(value: string | null | undefined): string | null {
  const cleaned = typeof value === "string" ? value.replace(/^@/, "").trim().toLowerCase() : "";
  return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

function normalizeText(value: string | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 20_000) : "";
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value, "https://x.com");
    return /^https?:$/i.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeFolder(value: string | null | undefined): string | null {
  const cleaned = typeof value === "string" ? value.trim().slice(0, 64) : "";
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeReminder(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeNotes(value: string | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 1000) : "";
}

function cloneBookmark(entry: BookmarkRecord): BookmarkRecord {
  return { ...entry, tags: [...entry.tags] };
}

/** The stored shape is user-writable through a backup import, so every read validates it. */
function readBookmarks(stored: BookmarksState | undefined): BookmarkRecord[] {
  const entries = Array.isArray(stored?.entries) ? stored.entries : [];
  return entries.filter(isBookmark).map(normalizeBookmark);
}

/**
 * A bookmark id that is unique across tabs, not just within one.
 *
 * It used to be `Date.now()` plus a counter that starts at zero in every instance, so two tabs
 * saving in the same millisecond produced the same id -- and the cross-tab merge, which keys on
 * id, then kept one of the two bookmarks. The random suffix is for uniqueness only; nothing here
 * depends on it being unpredictable.
 */
function newBookmarkId(sequence: number): string {
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `bm-${Date.now()}-${sequence}-${random}`;
}
