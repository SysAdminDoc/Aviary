import type { StorageGateway } from "../../platform/storage";
import { mutateStored, replaceStored } from "../../platform/storage-lock";
import type { ExportRecord } from "../export/types";

export const CATCH_UP_KEY = "aviary.catchUp.v1";
export const CATCH_UP_LIMIT = 4000;
export const CATCH_UP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CatchUpCategory = "original" | "replies" | "quotes" | "reposts" | "filtered";
export type CatchUpSort = "newest" | "oldest" | "density" | "author";

export interface CatchUpMetrics {
  replies: number;
  likes: number;
  reposts: number;
}

export interface CatchUpMedia {
  kind: "photo" | "video" | "thumbnail";
  url: string;
  altText?: string;
}

/**
 * A bounded, local reading copy of a post that Aviary already rendered.
 *
 * This is deliberately separate from SeenPostStore. The seen store remains an id-only privacy
 * ledger, while this companion keeps just enough of an already-rendered post to make catch-up
 * useful after the row has left X's virtualized DOM.
 */
export interface CatchUpRecord {
  tweetId: string;
  handle: string | null;
  displayName: string | null;
  text: string;
  permalink: string | null;
  articleUrl: string | null;
  capturedAt: string;
  seenAt: number;
  surface: string;
  category: CatchUpCategory;
  filterReason: string | null;
  media: CatchUpMedia[];
  metrics: CatchUpMetrics;
}

interface StoredCatchUp {
  version: 1;
  entries: CatchUpRecord[];
}

export interface CatchUpDigestOptions {
  now?: number;
  windowHours?: number;
  category?: CatchUpCategory | "all";
  author?: string | null;
  sort?: CatchUpSort;
}

export interface CatchUpLink {
  url: string;
  shared: number;
  handles: string[];
}

export interface CatchUpDigest {
  records: CatchUpRecord[];
  counts: Record<CatchUpCategory | "all", number>;
  authors: Array<{ handle: string; count: number }>;
  topLinks: CatchUpLink[];
  windowHours: number;
}

export class CatchUpStore {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #entries = new Map<string, CatchUpRecord>();
  #pending = new Map<string, CatchUpRecord>();
  #loaded = false;
  #dirty = false;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: StorageGateway, limit = CATCH_UP_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(64, Math.min(CATCH_UP_LIMIT, Math.floor(limit)));
  }

  async load(now = Date.now()): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    try {
      const raw = await this.#storage.get<unknown>(CATCH_UP_KEY, undefined);
      this.#entries = parseStored(raw, now, this.#limit);
    } catch {
      this.#entries = new Map();
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  list(): CatchUpRecord[] {
    return [...this.#entries.values()]
      .sort((left, right) => left.seenAt - right.seenAt)
      .map(cloneRecord);
  }

  upsert(record: CatchUpRecord): void {
    if (!isCatchUpRecord(record)) return;
    const current = this.#entries.get(record.tweetId);
    const next = normalizeRecord(record, current?.seenAt);
    this.#entries.set(next.tweetId, next);
    this.#pending.set(next.tweetId, next);
    this.#dirty = true;
  }

  upsertExportRecord(
    record: ExportRecord,
    seenAt: number,
    category: CatchUpCategory,
    filterReason: string | null,
    metrics: CatchUpMetrics
  ): void {
    if (!record.tweetId || !Number.isFinite(seenAt)) return;
    this.upsert({
      tweetId: record.tweetId,
      handle: record.handle,
      displayName: record.displayName,
      text: record.text,
      permalink: record.permalink,
      articleUrl: record.article?.url ?? null,
      capturedAt: new Date(seenAt).toISOString(),
      seenAt,
      surface: record.surface,
      category,
      filterReason,
      media: record.media
        .filter((media) => media.url.length > 0)
        .slice(0, 4)
        .map((media) => ({ kind: media.kind, url: media.url, ...(media.altText ? { altText: media.altText } : {}) })),
      metrics
    });
  }

  flush(now: number): void {
    if (!this.#dirty) return;
    this.#dirty = false;
    const pending = this.#pending;
    this.#pending = new Map();
    this.#tail = this.#tail
      .then(async () => {
        const merged = await mutateStored<unknown>(
          this.#storage,
          CATCH_UP_KEY,
          { version: 1, entries: [] } satisfies StoredCatchUp,
          (stored) => {
            const combined = parseStored(stored, now, this.#limit);
            for (const [id, entry] of pending) {
              const existing = combined.get(id);
              combined.set(id, normalizeRecord(entry, existing?.seenAt));
            }
            return { version: 1, entries: trimEntries(combined, now, this.#limit) } satisfies StoredCatchUp;
          }
        );
        this.#entries = parseStored(merged, now, this.#limit);
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
    this.#entries = new Map();
    this.#pending = new Map();
    this.#dirty = false;
    this.#loaded = true;
    await replaceStored(this.#storage, CATCH_UP_KEY, { version: 1, entries: [] } satisfies StoredCatchUp);
  }
}

export function buildCatchUpDigest(
  entries: readonly CatchUpRecord[],
  options: CatchUpDigestOptions = {}
): CatchUpDigest {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const windowHours = normalizeWindow(options.windowHours);
  const cutoff = now - (windowHours === 13 ? 12 : windowHours) * 60 * 60 * 1000;
  const inWindow = entries.filter((entry) =>
    windowHours === 13 ? entry.seenAt < cutoff : entry.seenAt >= cutoff && entry.seenAt <= now
  );
  const counts = emptyCounts();
  for (const entry of inWindow) {
    counts[entry.category] += 1;
    if (entry.category !== "filtered") counts.all += 1;
  }

  const category = options.category ?? "all";
  let records = inWindow.filter((entry) => {
    if (category === "all") return entry.category !== "filtered";
    return entry.category === category;
  });
  const author = normalizeHandle(options.author);
  if (author) records = records.filter((entry) => (entry.handle ?? "").toLowerCase() === author);

  const authorCounts = new Map<string, number>();
  for (const entry of records) {
    if (entry.handle) authorCounts.set(entry.handle, (authorCounts.get(entry.handle) ?? 0) + 1);
  }
  const authors = [...authorCounts.entries()]
    .map(([handle, count]) => ({ handle, count }))
    .sort((left, right) => right.count - left.count || left.handle.localeCompare(right.handle));

  const sort = options.sort ?? "newest";
  records = [...records].sort((left, right) => compareRecords(left, right, sort));
  return {
    records,
    counts,
    authors,
    topLinks: buildTopLinks(inWindow),
    windowHours
  };
}

function compareRecords(left: CatchUpRecord, right: CatchUpRecord, sort: CatchUpSort): number {
  if (sort === "oldest") return left.seenAt - right.seenAt || left.tweetId.localeCompare(right.tweetId);
  if (sort === "density") {
    const density = postDensity;
    return density(left) - density(right) || right.seenAt - left.seenAt;
  }
  if (sort === "author") {
    return (left.handle ?? "").localeCompare(right.handle ?? "") || right.seenAt - left.seenAt;
  }
  return right.seenAt - left.seenAt || left.tweetId.localeCompare(right.tweetId);
}

function postDensity(record: CatchUpRecord): number {
  return record.text.length / 140 + record.media.length * 8 + (record.articleUrl ? 8 : 0);
}

function buildTopLinks(entries: readonly CatchUpRecord[]): CatchUpLink[] {
  const links = new Map<string, CatchUpLink>();
  for (const entry of entries) {
    const url = normalizeUrl(entry.articleUrl);
    if (!url || url === entry.permalink) continue;
    const current = links.get(url) ?? { url, shared: 0, handles: [] };
    current.shared += 1;
    if (entry.handle && !current.handles.includes(entry.handle)) current.handles.push(entry.handle);
    links.set(url, current);
  }
  return [...links.values()]
    .sort((left, right) => right.shared - left.shared || left.url.localeCompare(right.url))
    .slice(0, 10);
}

function parseStored(raw: unknown, now: number, limit: number): Map<string, CatchUpRecord> {
  const entries: unknown[] = raw && typeof raw === "object" && Array.isArray((raw as Partial<StoredCatchUp>).entries)
    ? ((raw as Partial<StoredCatchUp>).entries ?? [])
    : [];
  const result = new Map<string, CatchUpRecord>();
  for (const entry of entries) {
    if (!isCatchUpRecord(entry)) continue;
    const normalized = normalizeRecord(entry);
    if (normalized.seenAt < now - CATCH_UP_RETENTION_MS) continue;
    result.set(normalized.tweetId, normalized);
  }
  return new Map(trimEntries(result, now, limit).map((entry) => [entry.tweetId, entry]));
}

function trimEntries(entries: Map<string, CatchUpRecord>, now: number, limit: number): CatchUpRecord[] {
  return [...entries.values()]
    .filter((entry) => entry.seenAt >= now - CATCH_UP_RETENTION_MS)
    .sort((left, right) => left.seenAt - right.seenAt)
    .slice(-limit)
    .map(cloneRecord);
}

function isCatchUpRecord(value: unknown): value is CatchUpRecord {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<CatchUpRecord>;
  return /^\d{1,25}$/.test(typeof entry.tweetId === "string" ? entry.tweetId : "") &&
    typeof entry.seenAt === "number" && Number.isFinite(entry.seenAt) &&
    typeof entry.text === "string" && typeof entry.surface === "string";
}

function normalizeRecord(record: CatchUpRecord, seenAtOverride?: number): CatchUpRecord {
  const seenAt = Number.isFinite(seenAtOverride) ? Number(seenAtOverride) : record.seenAt;
  return {
    tweetId: record.tweetId.trim().slice(0, 25),
    handle: normalizeHandle(record.handle),
    displayName: cleanText(record.displayName, 160),
    text: cleanText(record.text, 10_000) ?? "",
    permalink: normalizeUrl(record.permalink),
    articleUrl: normalizeUrl(record.articleUrl),
    capturedAt: new Date(seenAt).toISOString(),
    seenAt,
    surface: cleanText(record.surface, 64) ?? "unknown",
    category: isCategory(record.category) ? record.category : "original",
    filterReason: cleanText(record.filterReason, 240),
    media: Array.isArray(record.media)
      ? record.media
          .filter((media) => media && typeof media === "object" && typeof media.url === "string")
          .slice(0, 4)
          .map((media) => {
            const altText = cleanText(media.altText, 500);
            return {
              kind: isMediaKind(media.kind) ? media.kind : "photo",
              url: normalizeUrl(media.url) ?? "",
              ...(altText ? { altText } : {})
            };
          })
          .filter((media) => media.url.length > 0)
      : [],
    metrics: {
      replies: nonNegativeInteger(record.metrics?.replies),
      likes: nonNegativeInteger(record.metrics?.likes),
      reposts: nonNegativeInteger(record.metrics?.reposts)
    }
  };
}

function cloneRecord(record: CatchUpRecord): CatchUpRecord {
  return {
    ...record,
    media: record.media.map((media) => ({ ...media })),
    metrics: { ...record.metrics }
  };
}

function emptyCounts(): Record<CatchUpCategory | "all", number> {
  return { all: 0, original: 0, replies: 0, quotes: 0, reposts: 0, filtered: 0 };
}

function normalizeWindow(value: number | undefined): number {
  if (value === 13) return 13;
  if (value === 12 || value === 8 || value === 6 || value === 4 || value === 2 || value === 1) return value;
  return 1;
}

function isCategory(value: unknown): value is CatchUpCategory {
  return value === "original" || value === "replies" || value === "quotes" || value === "reposts" || value === "filtered";
}

function isMediaKind(value: unknown): value is CatchUpMedia["kind"] {
  return value === "photo" || value === "video" || value === "thumbnail";
}

function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.replace(/^@/, "").trim().slice(0, 15);
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

function cleanText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, limit);
  return text.length > 0 ? text : null;
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value, "https://x.com");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
