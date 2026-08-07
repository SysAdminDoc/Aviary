import type { StorageGateway } from "../../platform/storage";

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
    const entries = Array.isArray(stored?.entries) ? stored.entries : [];
    this.#state = {
      entries: entries.filter(isBookmark).slice(-this.#limit).map(normalizeBookmark)
    };
    this.#loaded = true;
  }

  async upsert(input: BookmarkInput): Promise<BookmarkRecord> {
    await this.load();
    const now = new Date().toISOString();
    const tweetId = input.tweetId ?? null;
    const existing = tweetId
      ? this.#state.entries.find((entry) => entry.tweetId === tweetId)
      : undefined;

    if (existing) {
      Object.assign(existing, {
        handle: input.handle ?? existing.handle,
        text: input.text ?? existing.text,
        url: input.url ?? existing.url,
        tags: dedupeTags(input.tags ?? existing.tags),
        folder: input.folder ?? existing.folder,
        remindAt: input.remindAt ?? existing.remindAt,
        notes: input.notes ?? existing.notes,
        updatedAt: now
      });
      await this.#persist();
      return existing;
    }

    const entry: BookmarkRecord = {
      id: `bm-${Date.now()}-${(this.#sequence += 1)}`,
      tweetId,
      handle: input.handle ?? null,
      text: input.text ?? "",
      url: input.url ?? null,
      tags: dedupeTags(input.tags ?? []),
      folder: input.folder ?? null,
      remindAt: input.remindAt ?? null,
      notes: input.notes ?? "",
      capturedAt: now,
      updatedAt: now
    };

    this.#state.entries.push(entry);
    while (this.#state.entries.length > this.#limit) {
      this.#state.entries.shift();
    }
    await this.#persist();
    return entry;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    this.#state.entries = this.#state.entries.filter((entry) => entry.id !== id);
    await this.#persist();
  }

  list(filter?: { tag?: string; folder?: string }): BookmarkRecord[] {
    return this.#state.entries.filter((entry) => {
      if (filter?.tag && !entry.tags.includes(filter.tag.toLowerCase())) return false;
      if (filter?.folder !== undefined && entry.folder !== filter.folder) return false;
      return true;
    });
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
    });
  }

  async clear(): Promise<void> {
    this.#state = { entries: [] };
    this.#loaded = true;
    await this.#persist();
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(BOOKMARKS_KEY, this.#state);
    } catch {
      // best effort
    }
  }
}

function dedupeTags(input: readonly string[]): string[] {
  const set = new Set<string>();
  for (const tag of input) {
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
  return typeof candidate.id === "string" && typeof candidate.capturedAt === "string";
}

function normalizeBookmark(entry: BookmarkRecord): BookmarkRecord {
  return {
    ...entry,
    tags: dedupeTags(entry.tags ?? []),
    notes: entry.notes ?? ""
  };
}
