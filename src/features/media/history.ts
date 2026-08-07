import type { StorageGateway } from "../../platform/storage";

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
    this.#index.add(key);
    this.#entries.push({ key, at: new Date().toISOString() });
    while (this.#entries.length > this.#limit) {
      const removed = this.#entries.shift();
      if (removed) {
        this.#index.delete(removed.key);
      }
    }
    await this.#persist();
    return true;
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#index.clear();
    this.#loaded = true;
    await this.#persist();
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
    const entries = Array.isArray(stored?.entries) ? stored.entries : [];
    this.#entries = entries
      .filter((entry): entry is MediaHistoryEntry =>
        typeof entry?.key === "string" && typeof entry?.at === "string"
      )
      .slice(-this.#limit);
    this.#index = new Set(this.#entries.map((entry) => entry.key));
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set<MediaHistorySnapshot>(MEDIA_HISTORY_KEY, {
        entries: this.#entries
      });
    } catch (error) {
      // Best-effort, but not silent: a full backend must be visible somewhere.
      this.#onPersistError?.(error);
    }
  }
}
