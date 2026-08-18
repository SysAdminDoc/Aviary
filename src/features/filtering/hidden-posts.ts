import type { StorageGateway } from "../../platform/storage";
import { mergeKeyed, mutateStored, replaceStored } from "../../platform/storage-lock";
import type { PersistErrorSink } from "../media/history";

export const HIDDEN_POSTS_KEY = "aviary.hiddenPosts.v1";

/** Snippet kept per entry so the Control Center list is readable without a network call. */
const TEXT_SNIPPET_LENGTH = 80;
const UNDO_STACK_LIMIT = 20;
/** Unicode control category — kept as a property escape so the source stays pure ASCII. */
const CONTROL_CHARS = /\p{Cc}/gu;

export interface HiddenPostEntry {
  key: string;
  hiddenAt: string;
  handle: string | null;
  tweetId: string | null;
  text: string;
}

export interface HiddenPostsSnapshot {
  entries: HiddenPostEntry[];
  updatedAt: string | null;
}

export interface PostIdentity {
  tweetId: string | null;
  handle: string | null;
  text: string;
}

interface StoreState {
  entries: Map<string, HiddenPostEntry>;
  undoStack: string[];
  updatedAt: string | null;
  version: number;
}

/**
 * Stable per-post identity. Status ids are preferred; promoted posts and other
 * article shapes without a /status/ link fall back to a handle + text signature
 * so the same unit re-appearing after a refresh still resolves to one key.
 */
export function derivePostKey(identity: PostIdentity): string | null {
  const tweetId = normalizeTweetId(identity.tweetId);
  if (tweetId) {
    return `id:${tweetId}`;
  }

  const handle = normalizeHandle(identity.handle);
  const text = collapseWhitespace(identity.text);
  if (!handle || text.length === 0) {
    return null;
  }

  return `sig:${handle}:${hashText(text)}`;
}

/** Deterministic 32-bit FNV-1a, rendered base36 — short keys, no crypto dependency. */
export function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}${value.length.toString(36)}`;
}

/**
 * Handles are read from profile links, which are root-relative on live X but
 * absolute in saved captures. Both shapes must resolve or posts without a status
 * id (promoted units) lose their only fallback identity.
 */
export function handleFromHref(href: string | null): string | null {
  if (typeof href !== "string") {
    return null;
  }
  const withoutOrigin = href.replace(
    /^https?:\/\/(?:www\.|mobile\.|pro\.)?(?:x|twitter)\.com/i,
    ""
  );
  const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(withoutOrigin);
  return match?.[1] ? normalizeHandle(match[1]) : null;
}

export function normalizeHiddenPosts(input: unknown, maxEntries: number): HiddenPostsSnapshot {
  const record = isRecord(input) ? input : {};
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const byKey = new Map<string, HiddenPostEntry>();

  for (const raw of rawEntries) {
    const entry = normalizeEntry(raw);
    if (!entry) {
      continue;
    }
    const previous = byKey.get(entry.key);
    if (!previous || previous.hiddenAt <= entry.hiddenAt) {
      byKey.set(entry.key, entry);
    }
  }

  const entries = [...byKey.values()].sort((left, right) =>
    left.hiddenAt < right.hiddenAt ? -1 : left.hiddenAt > right.hiddenAt ? 1 : 0
  );

  const limit = Number.isFinite(maxEntries) ? Math.max(1, Math.trunc(maxEntries)) : 5000;
  const trimmed = entries.length > limit ? entries.slice(entries.length - limit) : entries;

  return {
    entries: trimmed,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null
  };
}

export class HiddenPostStore {
  readonly #storage: StorageGateway;
  readonly #onPersistError: PersistErrorSink | undefined;
  #entries = new Map<string, HiddenPostEntry>();
  #undoStack: string[] = [];
  #updatedAt: string | null = null;
  #version = 0;
  #loaded = false;

  constructor(storage: StorageGateway, onPersistError?: PersistErrorSink) {
    this.#storage = storage;
    this.#onPersistError = onPersistError;
  }

  async load(maxEntries: number): Promise<void> {
    const stored = await this.#storage.get<unknown>(HIDDEN_POSTS_KEY, null);
    const snapshot = normalizeHiddenPosts(stored, maxEntries);
    this.#entries = new Map(snapshot.entries.map((entry) => [entry.key, entry]));
    this.#updatedAt = snapshot.updatedAt;
    this.#undoStack = [];
    this.#loaded = true;
    this.#version += 1;
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  /** Bumped on every mutation so DOM passes know a re-evaluation is required. */
  version(): number {
    return this.#version;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  size(): number {
    return this.#entries.size;
  }

  updatedAt(): string | null {
    return this.#updatedAt;
  }

  /** Newest first — the Control Center and undo affordances read the head. */
  list(): HiddenPostEntry[] {
    return [...this.#entries.values()].sort((left, right) =>
      left.hiddenAt < right.hiddenAt ? 1 : left.hiddenAt > right.hiddenAt ? -1 : 0
    );
  }

  undoDepth(): number {
    return this.#undoStack.length;
  }

  async hide(identity: PostIdentity & { key?: string }, maxEntries: number): Promise<HiddenPostEntry | null> {
    const key = identity.key ?? derivePostKey(identity);
    if (!key || this.#entries.has(key)) {
      return null;
    }

    const before = this.#snapshot();

    const entry: HiddenPostEntry = {
      key,
      hiddenAt: new Date().toISOString(),
      handle: normalizeHandle(identity.handle),
      tweetId: normalizeTweetId(identity.tweetId),
      text: snippet(identity.text)
    };

    this.#entries.set(key, entry);
    this.#undoStack.push(key);
    if (this.#undoStack.length > UNDO_STACK_LIMIT) {
      this.#undoStack.shift();
    }
    this.#evict(maxEntries);
    this.#version += 1;
    await this.#persist(before, { added: [entry], removed: [], maxEntries });
    return entry;
  }

  async unhide(key: string): Promise<HiddenPostEntry | null> {
    const entry = this.#entries.get(key);
    if (!entry) {
      return null;
    }
    const before = this.#snapshot();
    this.#entries.delete(key);
    this.#undoStack = this.#undoStack.filter((candidate) => candidate !== key);
    this.#version += 1;
    await this.#persist(before, { added: [], removed: [key] });
    return entry;
  }

  /** Pops the most recent hide from this session; falls back to the newest stored entry. */
  async undoLast(): Promise<HiddenPostEntry | null> {
    while (this.#undoStack.length > 0) {
      const key = this.#undoStack.pop();
      if (key && this.#entries.has(key)) {
        return await this.unhide(key);
      }
    }
    const newest = this.list()[0];
    return newest ? await this.unhide(newest.key) : null;
  }

  async clear(): Promise<number> {
    const removed = this.#entries.size;
    const before = this.#snapshot();
    this.#entries.clear();
    this.#undoStack = [];
    this.#version += 1;
    // Deliberately a replace, not a merge: "clear" means whatever another tab has is gone too.
    // Merging here would resurrect exactly what the user asked to remove.
    await this.#persist(before, null);
    return removed;
  }

  /** Takes on the merged result, so this tab now sees what every tab wrote. */
  #adopt(merged: unknown): void {
    const snapshot = normalizeHiddenPosts(merged, Number.MAX_SAFE_INTEGER);
    this.#entries = new Map(snapshot.entries.map((entry) => [entry.key, entry]));
    this.#updatedAt = snapshot.updatedAt;
    // Undo is per-tab by nature -- it is "what I just did here" -- so keep only the keys that
    // survived the merge rather than adopting another tab's history as this tab's undo stack.
    this.#undoStack = this.#undoStack.filter((key) => this.#entries.has(key));
    this.#version += 1;
  }

  #evict(maxEntries: number): void {
    const limit = Math.max(1, Math.trunc(maxEntries));
    if (this.#entries.size <= limit) {
      return;
    }
    const ordered = [...this.#entries.values()].sort((left, right) =>
      left.hiddenAt < right.hiddenAt ? -1 : left.hiddenAt > right.hiddenAt ? 1 : 0
    );
    for (const entry of ordered.slice(0, this.#entries.size - limit)) {
      this.#entries.delete(entry.key);
    }
  }

  #snapshot(): StoreState {
    return {
      entries: new Map(this.#entries),
      undoStack: [...this.#undoStack],
      updatedAt: this.#updatedAt,
      version: this.#version
    };
  }

  #restore(snapshot: StoreState): void {
    this.#entries = new Map(snapshot.entries);
    this.#undoStack = [...snapshot.undoStack];
    this.#updatedAt = snapshot.updatedAt;
    this.#version = snapshot.version;
  }

  /**
   * Writes this tab's change into what is stored right now, not over it.
   *
   * The store holds its whole state in memory and used to persist that snapshot wholesale, so a
   * hide in one tab and a hide in another kept only whichever wrote second. `delta` is what *this*
   * call changed; it is folded into the stored entries under a cross-tab lock, and the result
   * becomes this tab's state so the other tab's entries do not vanish on the next save either.
   *
   * `delta === null` means replace: only `clear()` uses it, and it means what it says.
   */
  async #persist(
    before: StoreState,
    delta: { added: HiddenPostEntry[]; removed: string[]; maxEntries?: number } | null
  ): Promise<void> {
    this.#updatedAt = new Date().toISOString();
    const snapshot: HiddenPostsSnapshot = {
      entries: [...this.#entries.values()],
      updatedAt: this.#updatedAt
    };
    try {
      if (delta === null) {
        await replaceStored(this.#storage, HIDDEN_POSTS_KEY, snapshot);
      } else {
        const merged = await mutateStored<unknown>(
          this.#storage,
          HIDDEN_POSTS_KEY,
          null,
          (stored) => {
            const current = normalizeHiddenPosts(stored, Number.MAX_SAFE_INTEGER);
            const entries = mergeKeyed(
              current.entries.map((entry) => [entry.key, entry] as [string, HiddenPostEntry]),
              delta.added.map((entry) => [entry.key, entry] as [string, HiddenPostEntry]),
              delta.removed
            );
            return {
              entries: capOldestFirst([...entries.values()], delta.maxEntries),
              updatedAt: this.#updatedAt
            } satisfies HiddenPostsSnapshot;
          }
        );
        this.#adopt(merged);
      }
    } catch (error) {
      this.#restore(before);
      // A mutation that did not persist must not be presented as a successful hide/unhide/clear.
      try {
        this.#onPersistError?.(error);
      } catch {
        // Diagnostics must not mask the original persistence failure.
      }
      throw error;
    }
  }
}

/** Same retention rule the in-memory store applies, over a merged list. */
function capOldestFirst(entries: HiddenPostEntry[], maxEntries?: number): HiddenPostEntry[] {
  if (maxEntries === undefined) {
    return entries;
  }
  const limit = Math.max(1, Math.trunc(maxEntries));
  if (entries.length <= limit) {
    return entries;
  }
  const ordered = [...entries].sort((left, right) =>
    left.hiddenAt < right.hiddenAt ? -1 : left.hiddenAt > right.hiddenAt ? 1 : 0
  );
  return ordered.slice(ordered.length - limit);
}

function normalizeEntry(input: unknown): HiddenPostEntry | null {
  if (!isRecord(input)) {
    return null;
  }
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!/^(id:\d{1,25}|sig:[a-z0-9_]{1,15}:[a-z0-9]{1,20})$/.test(key)) {
    return null;
  }
  const hiddenAt =
    typeof input.hiddenAt === "string" && !Number.isNaN(Date.parse(input.hiddenAt))
      ? input.hiddenAt
      : new Date(0).toISOString();

  return {
    key,
    hiddenAt,
    handle: typeof input.handle === "string" ? normalizeHandle(input.handle) : null,
    tweetId: typeof input.tweetId === "string" ? normalizeTweetId(input.tweetId) : null,
    text: typeof input.text === "string" ? snippet(input.text) : ""
  };
}

function snippet(value: string): string {
  return collapseWhitespace(value).slice(0, TEXT_SNIPPET_LENGTH);
}

function collapseWhitespace(value: string): string {
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

function normalizeHandle(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

function normalizeTweetId(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.trim();
  return /^\d{1,25}$/.test(cleaned) ? cleaned : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
