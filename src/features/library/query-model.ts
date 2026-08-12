import type { ExportRecord } from "../export/types";
import type { SemanticEntry } from "../integrations/semantic-search";
import type { BookmarkRecord } from "./bookmarks";
import type { SnapshotEntry } from "./snapshots";
import type { ArchiveLibrarySnapshot } from "./archive-library";

/** One bounded, searchable representation for every local library surface. */
export type OfflineCollection =
  | "posts"
  | "likes"
  | "bookmarks"
  | "notes"
  | "snapshots"
  | "semantic"
  | "archive";

export const OFFLINE_QUERY_MAX_LENGTH = 512;

export interface OfflineQueryDocument {
  id: string;
  collection: OfflineCollection;
  account: string | null;
  text: string;
  tags: string[];
  folder: string | null;
  capturedAt: string | null;
  mediaCount: number;
  payload?: unknown;
}

export interface OfflineQueryFilters {
  collections: OfflineCollection[];
  account: string | null;
  tag: string | null;
  folder: string | null;
  from: number | null;
  to: number | null;
  hasMedia: boolean | null;
}

export interface ParsedOfflineQuery {
  text: string;
  terms: string[];
  filters: OfflineQueryFilters;
  errors: string[];
  truncated: boolean;
}

export interface OfflineQueryHit {
  document: OfflineQueryDocument;
  score: number;
  matchedTerms: string[];
  snippet: string;
  mode: "lexical" | "semantic";
}

export interface OfflineQueryOptions {
  limit?: number;
  mode?: "lexical" | "semantic";
}

const EMPTY_FILTERS = (): OfflineQueryFilters => ({
  collections: [],
  account: null,
  tag: null,
  folder: null,
  from: null,
  to: null,
  hasMedia: null
});

const COLLECTION_ALIASES: Record<string, OfflineCollection | undefined> = {
  post: "posts",
  posts: "posts",
  tweet: "posts",
  tweets: "posts",
  like: "likes",
  likes: "likes",
  bookmark: "bookmarks",
  bookmarks: "bookmarks",
  note: "notes",
  notes: "notes",
  snapshot: "snapshots",
  snapshots: "snapshots",
  semantic: "semantic",
  archive: "archive"
};

/** Parse documented `source:`, `account:`, `tag:`, `folder:`, date, and media filters. */
export function parseOfflineQuery(input: string): ParsedOfflineQuery {
  const raw = typeof input === "string" ? input.normalize("NFC") : "";
  const truncated = raw.length > OFFLINE_QUERY_MAX_LENGTH;
  const query = raw.slice(0, OFFLINE_QUERY_MAX_LENGTH);
  const filters = EMPTY_FILTERS();
  const errors: string[] = [];
  const terms = [] as string[];
  const filterPattern = /(^|\s)(source|type|account|tag|folder|from|to|after|before|has):("([^"]*)"|([^\s]+))/giu;
  let freeText = query;

  for (const match of query.matchAll(filterPattern)) {
    const key = match[2]!.toLowerCase();
    const value = (match[4] ?? match[5] ?? "").trim();
    freeText = freeText.replace(match[0], " ");
    if (!value) {
      errors.push(`${key} requires a value`);
      continue;
    }

    if (key === "source" || key === "type") {
      const collection = COLLECTION_ALIASES[value.toLowerCase()];
      if (!collection) {
        errors.push(`unknown collection: ${value}`);
      } else if (!filters.collections.includes(collection)) {
        filters.collections.push(collection);
      }
      continue;
    }
    if (key === "account") {
      filters.account = value.replace(/^@/, "").toLocaleLowerCase();
      continue;
    }
    if (key === "tag") {
      filters.tag = value.replace(/^#/, "").toLocaleLowerCase();
      continue;
    }
    if (key === "folder") {
      filters.folder = value.toLocaleLowerCase();
      continue;
    }
    if (key === "has") {
      if (value.toLocaleLowerCase() !== "media") {
        errors.push(`unsupported has filter: ${value}`);
      } else {
        filters.hasMedia = true;
      }
      continue;
    }

    const timestamp = parseDateFilter(value, key === "to" || key === "before");
    if (timestamp === null) {
      errors.push(`invalid date: ${value}`);
    } else if (key === "from" || key === "after") {
      filters.from = timestamp;
    } else {
      filters.to = timestamp;
    }
  }

  terms.push(...tokenizeSearchText(freeText));
  if (truncated) errors.push(`query exceeds ${OFFLINE_QUERY_MAX_LENGTH} characters`);
  return {
    text: freeText.replace(/\s+/g, " ").trim(),
    terms: [...new Set(terms)],
    filters,
    errors,
    truncated
  };
}

export class OfflineQueryIndex {
  readonly #documents: OfflineQueryDocument[] = [];
  readonly #tokens = new Map<string, Set<string>>();

  rebuild(documents: readonly OfflineQueryDocument[]): void {
    this.#documents.length = 0;
    this.#tokens.clear();
    for (const document of documents) this.add(document);
  }

  add(document: OfflineQueryDocument): void {
    const normalized = normalizeDocument(document);
    this.#documents.push(normalized);
    this.#tokens.set(normalized.id, new Set(tokenizeSearchText(searchableText(normalized))));
  }

  size(): number {
    return this.#documents.length;
  }

  termCount(): number {
    const terms = new Set<string>();
    for (const tokens of this.#tokens.values()) {
      for (const token of tokens) terms.add(token);
    }
    return terms.size;
  }

  search(query: string | ParsedOfflineQuery, options: OfflineQueryOptions = {}): OfflineQueryHit[] {
    const parsed = typeof query === "string" ? parseOfflineQuery(query) : query;
    if (parsed.errors.length > 0) return [];
    if (parsed.terms.length === 0 && !hasFilter(parsed.filters)) return [];
    const limit = Math.max(1, Math.min(100, options.limit ?? 50));
    const hits: OfflineQueryHit[] = [];

    for (const document of this.#documents) {
      if (!matchesFilters(document, parsed.filters)) continue;
      const indexed = this.#tokens.get(document.id) ?? new Set<string>();
      const matchedTerms = parsed.terms.filter((term) => indexed.has(term));
      if (parsed.terms.length > 0 && matchedTerms.length === 0) continue;
      const score = matchedTerms.length * 2 + fieldBoost(document, parsed.terms);
      hits.push({
        document,
        score,
        matchedTerms,
        snippet: snippetFor(document.text),
        mode: options.mode ?? "lexical"
      });
    }

    return hits
      .sort((a, b) =>
        b.score - a.score ||
        timestampValue(b.document.capturedAt) - timestampValue(a.document.capturedAt) ||
        a.document.id.localeCompare(b.document.id)
      )
      .slice(0, limit);
  }
}

export function tokenizeSearchText(value: string): string[] {
  const normalized = value.normalize("NFC").toLocaleLowerCase();
  const words = normalized
    .split(/[^\p{L}\p{N}_@]+/u)
    .map((token) => token.replace(/^@/, ""))
    .filter((token) => token.length > 0 && token.length <= 40);
  const tokens: string[] = [];
  for (const word of words) {
    if (UNSPACED_SCRIPT.test(word)) {
      if (word.length === 1) {
        tokens.push(word);
        continue;
      }
      for (let i = 0; i < word.length - 1; i++) tokens.push(word.slice(i, i + 2));
      continue;
    }
    if (word.length >= 2) tokens.push(word);
  }
  return tokens;
}

export function documentFromExportRecord(record: ExportRecord): OfflineQueryDocument {
  const collection: OfflineCollection = record.surface.includes("likes") ? "likes" : "posts";
  return {
    id: `record:${record.tweetId ?? `${record.capturedAt}:${record.text.slice(0, 48)}`}`,
    collection,
    account: normalizeAccount(record.handle),
    text: [
      record.text,
      record.handle ?? "",
      record.displayName ?? "",
      record.permalink ?? "",
      ...record.media.map((media) => `${media.url} ${media.altText ?? ""}`),
      record.quote?.text ?? "",
      record.article?.title ?? ""
    ].join(" "),
    tags: [],
    folder: null,
    capturedAt: record.capturedAt,
    mediaCount: record.media.length,
    payload: record
  };
}

export function documentFromBookmark(bookmark: BookmarkRecord): OfflineQueryDocument {
  return {
    id: `bookmark:${bookmark.id}`,
    collection: "bookmarks",
    account: normalizeAccount(bookmark.handle),
    text: [bookmark.text, bookmark.handle ?? "", bookmark.url ?? "", bookmark.notes].join(" "),
    tags: bookmark.tags,
    folder: bookmark.folder,
    capturedAt: bookmark.updatedAt || bookmark.capturedAt,
    // Bookmark.url is the post permalink, not a captured media asset.
    mediaCount: 0,
    payload: bookmark
  };
}

export function documentFromNote(handle: string, note: string): OfflineQueryDocument {
  return {
    id: `note:${handle}`,
    collection: "notes",
    account: normalizeAccount(handle),
    text: note,
    tags: [],
    folder: null,
    capturedAt: null,
    mediaCount: 0,
    payload: { handle, note }
  };
}

export function documentFromSnapshot(snapshot: SnapshotEntry): OfflineQueryDocument {
  return {
    id: `snapshot:${snapshot.kind}:${snapshot.handle}:${snapshot.capturedAt}`,
    collection: "snapshots",
    account: normalizeAccount(snapshot.handle),
    text: [snapshot.handle, snapshot.kind, ...snapshot.accounts].join(" "),
    tags: [snapshot.kind, snapshot.source],
    folder: null,
    capturedAt: snapshot.capturedAt,
    mediaCount: 0,
    payload: snapshot
  };
}

export function documentFromSemanticEntry(entry: SemanticEntry): OfflineQueryDocument {
  return {
    id: `semantic:${entry.id}`,
    collection: "semantic",
    account: normalizeAccount(entry.handle),
    text: entry.text,
    tags: [],
    folder: null,
    capturedAt: entry.embeddedAt,
    mediaCount: 0,
    payload: entry
  };
}

export function documentsFromArchiveLibrary(snapshot: ArchiveLibrarySnapshot): OfflineQueryDocument[] {
  const documents: OfflineQueryDocument[] = [];
  if (snapshot.profile) {
    documents.push({
      id: "archive:profile",
      collection: "archive",
      account: normalizeAccount(snapshot.profile.handle),
      text: [snapshot.profile.handle, snapshot.profile.displayName, snapshot.profile.bio, snapshot.profile.location, snapshot.profile.website].filter(Boolean).join(" "),
      tags: ["profile"],
      folder: null,
      capturedAt: snapshot.updatedAt,
      mediaCount: 0,
      payload: snapshot.profile
    });
  }
  for (const entry of [...snapshot.followers, ...snapshot.following]) {
    documents.push({
      id: `archive:account:${entry.id ?? entry.handle ?? entry.sourceFile}`,
      collection: "archive",
      account: normalizeAccount(entry.handle),
      text: [entry.handle, entry.displayName, entry.sourceFile].filter(Boolean).join(" "),
      tags: ["account"],
      folder: null,
      capturedAt: snapshot.updatedAt,
      mediaCount: 0,
      payload: entry
    });
  }
  for (const entry of snapshot.lists) {
    documents.push({
      id: `archive:list:${entry.id ?? entry.name ?? entry.description ?? "unknown"}`,
      collection: "archive",
      account: null,
      text: [entry.name, entry.description, ...entry.memberIds, ...entry.subscriberIds].filter(Boolean).join(" "),
      tags: ["list"],
      folder: null,
      capturedAt: snapshot.updatedAt,
      mediaCount: 0,
      payload: entry
    });
  }
  for (const entry of snapshot.media) {
    documents.push({
      id: `archive:media:${entry.id ?? entry.tweetId ?? entry.url ?? entry.sourceFile}`,
      collection: "archive",
      account: null,
      text: [entry.tweetId, entry.url, entry.filename, entry.mimeType, entry.sourceFile].filter(Boolean).join(" "),
      tags: ["media"],
      folder: null,
      capturedAt: snapshot.updatedAt,
      mediaCount: 1,
      payload: entry
    });
  }
  return documents;
}

function normalizeDocument(document: OfflineQueryDocument): OfflineQueryDocument {
  return {
    ...document,
    account: normalizeAccount(document.account),
    text: String(document.text ?? "").normalize("NFC").slice(0, 100_000),
    tags: document.tags.map((tag) => String(tag).trim().toLocaleLowerCase()).filter(Boolean).slice(0, 64),
    folder: document.folder ? String(document.folder).trim().toLocaleLowerCase().slice(0, 128) : null,
    mediaCount: Number.isFinite(document.mediaCount) ? Math.max(0, Math.floor(document.mediaCount)) : 0
  };
}

function searchableText(document: OfflineQueryDocument): string {
  return [document.text, document.account ?? "", document.collection, ...document.tags, document.folder ?? ""].join(" ");
}

function fieldBoost(document: OfflineQueryDocument, terms: readonly string[]): number {
  const accountTerms = new Set(tokenizeSearchText(document.account ?? ""));
  const tagTerms = new Set(tokenizeSearchText(document.tags.join(" ")));
  return terms.reduce((score, term) => score + (accountTerms.has(term) ? 2 : 0) + (tagTerms.has(term) ? 1 : 0), 0);
}

function matchesFilters(document: OfflineQueryDocument, filters: OfflineQueryFilters): boolean {
  if (filters.collections.length > 0 && !filters.collections.includes(document.collection)) return false;
  if (filters.account && document.account !== filters.account) return false;
  if (filters.tag && !document.tags.includes(filters.tag)) return false;
  if (filters.folder && document.folder !== filters.folder) return false;
  const date = timestampValue(document.capturedAt);
  if (filters.from !== null && (date === 0 || date < filters.from)) return false;
  if (filters.to !== null && (date === 0 || date > filters.to)) return false;
  if (filters.hasMedia === true && document.mediaCount < 1) return false;
  return true;
}

function hasFilter(filters: OfflineQueryFilters): boolean {
  return filters.collections.length > 0 || Boolean(filters.account || filters.tag || filters.folder) ||
    filters.from !== null || filters.to !== null || filters.hasMedia !== null;
}

function parseDateFilter(value: string, endOfDay: boolean): number | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !endOfDay) return timestamp;
  return timestamp + 86_399_999;
}

function timestampValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAccount(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim().replace(/^@/, "").toLocaleLowerCase() : "";
  return normalized || null;
}

function snippetFor(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}…` : normalized;
}

/** Han, Hiragana, Katakana and Hangul: written without spaces between words. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
