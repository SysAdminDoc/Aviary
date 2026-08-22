import type { StorageGateway } from "../../platform/storage.ts";
import { mergeKeyed, mutateStored, replaceStored } from "../../platform/storage-lock.ts";

export const SNAPSHOTS_KEY = "aviary.snapshots.v1";
export const SNAPSHOT_LIMIT = 24;

export type SnapshotKind = "followers" | "following";

/**
 * How much of the list the capture actually saw.
 *
 * A DOM capture reads the rows the browser has rendered, and X renders a follower list a screenful
 * at a time. Without this, two captures of the same list at different scroll depths were compared
 * as though both were complete, and the difference was reported as follows and unfollows.
 */
export interface SnapshotCoverage {
  /** Distinct account rows that had been rendered when the capture ran. */
  rows: number;
  /** True only when the list had visibly finished loading -- no further rows were coming. */
  reachedEnd: boolean;
}

/** Past this many pixels from the bottom, more rows are still plausibly below the fold. */
const END_OF_LIST_SLACK = 400;

export interface SnapshotEntry {
  kind: SnapshotKind;
  handle: string;
  capturedAt: string;
  source: "dom" | "archive";
  accounts: string[];
  /**
   * Absent on entries captured before coverage was recorded, which is why every consumer has to
   * treat "no coverage" as "unknown" rather than as "complete".
   */
  coverage?: SnapshotCoverage;
}

/**
 * Whether the visible list had finished loading, measured from the document it was read out of.
 *
 * Two signals, both necessary. X keeps a progressbar in the tree while more rows are on the way,
 * and a reader who has not scrolled to the bottom has not seen the rows below the fold even if
 * nothing is loading at that instant. A short list that fits on one screen satisfies both and is
 * correctly reported as complete.
 */
export function measureListCoverage(doc: Document, rows: number): SnapshotCoverage {
  const loading = doc.querySelector('[role="progressbar"]') !== null;
  const scroller = doc.scrollingElement ?? doc.documentElement;
  const remaining = scroller
    ? scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight)
    : Number.POSITIVE_INFINITY;
  return { rows, reachedEnd: !loading && remaining <= END_OF_LIST_SLACK };
}

export interface SnapshotsStore {
  entries: SnapshotEntry[];
}

/**
 * What two captures of the same list have in common and what they do not.
 *
 * Deliberately not called "added" and "removed". Those words claim the difference was caused by
 * somebody following or unfollowing, and a DOM capture cannot support that claim unless both
 * captures reached the end of the list. Capture a followers list after scrolling to 400 rows,
 * capture it again next week after scrolling to 150, and the honest statement is that 250 accounts
 * appear in the earlier capture and not the later one -- not that 250 people unfollowed.
 */
export interface SnapshotDiff {
  earlierAt: string;
  laterAt: string;
  /** Present in the later capture and not the earlier one. */
  onlyLater: string[];
  /** Present in the earlier capture and not the later one. */
  onlyEarlier: string[];
  /** Present in both. */
  inBoth: number;
  /**
   * True when at least one capture did not reach the end of its list, so a difference cannot be
   * attributed to a follow or an unfollow. Also true when either capture predates coverage
   * recording, because "unknown" is not "complete".
   */
  partial: boolean;
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
    await this.#persist([stored]);
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
    // Replaced, not merged. Clearing is an explicit "drop all of this", and folding it into
    // another tab's copy would bring straight back what the reader just asked to be rid of.
    await replaceStored(this.#storage, SNAPSHOTS_KEY, this.#state);
  }

  size(): number {
    return this.#state.entries.length;
  }

  /**
   * The captures just taken, folded into whatever is on disk.
   *
   * Two tabs each capturing used to race: both loaded the list at boot, both wrote the whole list
   * back, and whichever wrote second erased the other's capture. Only `added` is merged, not this
   * tab's whole in-memory list -- merging the list would put back every capture the other tab was
   * told to clear, which is the same defect pointed the other way.
   */
  async #persist(added: readonly SnapshotEntry[]): Promise<void> {
    try {
      this.#state = await mutateStored<SnapshotsStore>(
        this.#storage,
        SNAPSHOTS_KEY,
        EMPTY,
        (stored) => {
          const existing = Array.isArray(stored?.entries) ? stored.entries.filter(isSnapshotEntry) : [];
          const merged = mergeKeyed(
            existing.map((entry) => [snapshotKey(entry), entry] as [string, SnapshotEntry]),
            added.map((entry) => [snapshotKey(entry), entry] as [string, SnapshotEntry])
          );
          const entries = [...merged.values()].sort(
            (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt)
          );
          return { entries: entries.slice(-this.#limit) };
        }
      );
    } catch {
      // best effort
    }
  }
}

export function diffSnapshots(earlier: SnapshotEntry, later: SnapshotEntry): SnapshotDiff {
  const earlierSet = new Set(earlier.accounts);
  const laterSet = new Set(later.accounts);
  const onlyLater: string[] = [];
  const onlyEarlier: string[] = [];
  let inBoth = 0;
  for (const handle of laterSet) {
    if (earlierSet.has(handle)) {
      inBoth += 1;
    } else {
      onlyLater.push(handle);
    }
  }
  for (const handle of earlierSet) {
    if (!laterSet.has(handle)) {
      onlyEarlier.push(handle);
    }
  }
  onlyLater.sort();
  onlyEarlier.sort();
  // An archive export is the whole list by construction; a DOM capture is only the whole list when
  // it says so. Anything else -- including an entry stored before coverage existed -- is unknown,
  // and unknown has to read as partial or the report goes back to naming people who did nothing.
  const complete = (entry: SnapshotEntry): boolean =>
    entry.source === "archive" || entry.coverage?.reachedEnd === true;
  return {
    earlierAt: earlier.capturedAt,
    laterAt: later.capturedAt,
    onlyLater,
    onlyEarlier,
    inBoth,
    partial: !complete(earlier) || !complete(later)
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

/** What makes one capture distinct from another: the same list, taken at a different moment. */
function snapshotKey(entry: SnapshotEntry): string {
  return `${entry.kind}|${entry.handle}|${entry.capturedAt}`;
}

function isSnapshotEntry(value: unknown): value is SnapshotEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SnapshotEntry>;
  return (
    (candidate.coverage === undefined ||
      (typeof candidate.coverage === "object" &&
        candidate.coverage !== null &&
        typeof candidate.coverage.rows === "number" &&
        typeof candidate.coverage.reachedEnd === "boolean")) &&
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
