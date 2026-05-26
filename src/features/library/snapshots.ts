import type { StorageGateway } from "../../platform/storage";

export const SNAPSHOTS_KEY = "aviary.snapshots.v1";
export const SNAPSHOT_LIMIT = 24;

export type SnapshotKind = "followers" | "following";

export interface SnapshotEntry {
  kind: SnapshotKind;
  handle: string;
  capturedAt: string;
  source: "dom" | "archive";
  accounts: string[];
}

export interface SnapshotsStore {
  entries: SnapshotEntry[];
}

export interface SnapshotDiff {
  earlierAt: string;
  laterAt: string;
  added: string[];
  removed: string[];
  unchanged: number;
}

const EMPTY: SnapshotsStore = { entries: [] };

export class SnapshotStore {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #state: SnapshotsStore = EMPTY;
  #loaded = false;

  constructor(storage: StorageGateway, limit = SNAPSHOT_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(4, limit);
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    const stored = await this.#storage.get<SnapshotsStore>(SNAPSHOTS_KEY, EMPTY);
    const entries = Array.isArray(stored?.entries) ? stored.entries : [];
    this.#state = { entries: entries.filter(isSnapshotEntry).slice(-this.#limit) };
    this.#loaded = true;
  }

  async record(entry: Omit<SnapshotEntry, "capturedAt">): Promise<SnapshotEntry> {
    await this.load();
    const stored: SnapshotEntry = {
      ...entry,
      capturedAt: new Date().toISOString(),
      accounts: Array.from(new Set(entry.accounts.map(normalizeHandle).filter((value): value is string => value !== null))).sort()
    };
    this.#state.entries.push(stored);
    while (this.#state.entries.length > this.#limit) {
      this.#state.entries.shift();
    }
    await this.#persist();
    return stored;
  }

  list(kind?: SnapshotKind, handle?: string): SnapshotEntry[] {
    const scoped = this.#state.entries.filter((entry) => {
      if (kind && entry.kind !== kind) return false;
      if (handle && entry.handle !== handle.toLowerCase()) return false;
      return true;
    });
    return [...scoped];
  }

  diffLatest(kind: SnapshotKind, handle: string): SnapshotDiff | null {
    const scoped = this.list(kind, handle);
    if (scoped.length < 2) return null;
    const earlier = scoped[scoped.length - 2]!;
    const later = scoped[scoped.length - 1]!;
    return diffSnapshots(earlier, later);
  }

  async clear(): Promise<void> {
    this.#state = { entries: [] };
    this.#loaded = true;
    await this.#persist();
  }

  size(): number {
    return this.#state.entries.length;
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(SNAPSHOTS_KEY, this.#state);
    } catch {
      // best effort
    }
  }
}

export function diffSnapshots(earlier: SnapshotEntry, later: SnapshotEntry): SnapshotDiff {
  const earlierSet = new Set(earlier.accounts);
  const laterSet = new Set(later.accounts);
  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  for (const handle of laterSet) {
    if (earlierSet.has(handle)) {
      unchanged += 1;
    } else {
      added.push(handle);
    }
  }
  for (const handle of earlierSet) {
    if (!laterSet.has(handle)) {
      removed.push(handle);
    }
  }
  added.sort();
  removed.sort();
  return {
    earlierAt: earlier.capturedAt,
    laterAt: later.capturedAt,
    added,
    removed,
    unchanged
  };
}

export function collectAccountsFromDom(root: ParentNode): string[] {
  const cells = root.querySelectorAll<HTMLElement>('[data-testid="UserCell"]');
  const handles = new Set<string>();
  for (const cell of Array.from(cells)) {
    const link = cell.querySelector<HTMLAnchorElement>('a[href^="/"]');
    const href = link?.getAttribute("href") ?? "";
    const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
    const candidate = match?.[1];
    if (candidate) {
      const normalized = normalizeHandle(candidate);
      if (normalized) handles.add(normalized);
    }
  }
  return Array.from(handles).sort();
}

function isSnapshotEntry(value: unknown): value is SnapshotEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SnapshotEntry>;
  return (
    (candidate.kind === "followers" || candidate.kind === "following") &&
    typeof candidate.handle === "string" &&
    typeof candidate.capturedAt === "string" &&
    Array.isArray(candidate.accounts) &&
    candidate.accounts.every((entry) => typeof entry === "string")
  );
}

function normalizeHandle(value: string): string | null {
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}
