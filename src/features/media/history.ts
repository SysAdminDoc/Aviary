import type { StorageGateway } from "../../platform/storage";
import { mutateStored, replaceStored } from "../../platform/storage-lock";

export const MEDIA_HISTORY_KEY = "aviary.media.history.v1";
export const MEDIA_HISTORY_LIMIT = 1500;

export interface MediaHistoryEntry {
  key: string;
  at: string;
}

export interface MediaHistorySnapshot {
  entries: MediaHistoryEntry[];
}

/**
 * Called when a write to the storage backend fails. Persistence here is best-effort by design,
 * but swallowing the error entirely turns a full quota into "changes silently stop sticking",
 * which is indistinguishable from a bug. Reporting it lets the caller surface the state.
 */
export type PersistErrorSink = (error: unknown) => void;

export class MediaHistory {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  readonly #onPersistError: PersistErrorSink | undefined;
  #entries: MediaHistoryEntry[] = [];
  #index = new Set<string>();
  #loaded = false;
  #loading: Promise<void> | undefined;

  constructor(
    storage: StorageGateway,
    limit = MEDIA_HISTORY_LIMIT,
    onPersistError?: PersistErrorSink
  ) {
    this.#storage = storage;
    this.#limit = Math.max(50, limit);
    this.#onPersistError = onPersistError;
  }

  async load(): Promise<void> {
    if (this.#loaded) {
      return;
    }
    if (!this.#loading) {
      this.#loading = this.#hydrate();
    }
    await this.#loading;
  }

  has(key: string): boolean {
    return this.#index.has(key);
  }

  async record(key: string): Promise<boolean> {
    await this.load();
    if (this.#index.has(key)) {
      return false;
    }
    const entry: MediaHistoryEntry = { key, at: new Date().toISOString() };
    this.#index.add(key);
    this.#entries.push(entry);
    while (this.#entries.length > this.#limit) {
      const removed = this.#entries.shift();
      if (removed) {
        this.#index.delete(removed.key);
      }
    }
    await this.#persist([entry]);
    return true;
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#index.clear();
    this.#loaded = true;
    // "Clear download history" means clear it, including whatever a second tab recorded.
    try {
      await replaceStored<MediaHistorySnapshot>(this.#storage, MEDIA_HISTORY_KEY, { entries: [] });
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }

  size(): number {
    return this.#entries.length;
  }

  snapshot(): MediaHistorySnapshot {
    return { entries: [...this.#entries] };
  }

  async #hydrate(): Promise<void> {
    const fallback: MediaHistorySnapshot = { entries: [] };
    const stored = await this.#storage.get<MediaHistorySnapshot>(MEDIA_HISTORY_KEY, fallback);
    this.#entries = readEntries(stored).slice(-this.#limit);
    this.#index = new Set(this.#entries.map((entry) => entry.key));
    this.#loaded = true;
  }

  /**
   * Folds this tab's entries into what is stored, under a cross-tab lock.
   *
   * Overwriting cost real work: two tabs saving media each wrote their own list, so the loser's
   * dedup keys disappeared and the same files were offered again as new. `added` is what this call
   * recorded -- never the whole local list -- then the same cap the in-memory list applies.
   */
  async #persist(added: MediaHistoryEntry[]): Promise<void> {
    try {
      const merged = await mutateStored<MediaHistorySnapshot>(
        this.#storage,
        MEDIA_HISTORY_KEY,
        { entries: [] },
        (stored) => {
          const byKey = new Map<string, MediaHistoryEntry>();
          for (const entry of readEntries(stored)) {
            byKey.set(entry.key, entry);
          }
          // Only this call's entry. Folding the whole local list in would undo a
          // "Clear download history" performed in another tab.
          for (const entry of added) {
            const existing = byKey.get(entry.key);
            if (!existing || existing.at < entry.at) {
              byKey.set(entry.key, entry);
            }
          }
          const ordered = [...byKey.values()].sort((left, right) =>
            left.at < right.at ? -1 : left.at > right.at ? 1 : 0
          );
          return { entries: ordered.slice(-this.#limit) };
        }
      );
      this.#entries = readEntries(merged);
      this.#index = new Set(this.#entries.map((entry) => entry.key));
    } catch (error) {
      // Best-effort, but not silent: a full backend must be visible somewhere.
      this.#onPersistError?.(error);
    }
  }
}

/** The stored shape is user-writable through a backup import, so every read validates it. */
function readEntries(stored: MediaHistorySnapshot | undefined): MediaHistoryEntry[] {
  const entries = Array.isArray(stored?.entries) ? stored.entries : [];
  return entries.filter(
    (entry): entry is MediaHistoryEntry =>
      typeof entry?.key === "string" && typeof entry?.at === "string"
  );
}
