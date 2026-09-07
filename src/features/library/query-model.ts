import type { ExportRecord } from "../export/types.ts";
import type { SemanticEntry } from "../integrations/semantic-search.ts";
import type { BookmarkRecord } from "./bookmarks.ts";
import type { SnapshotEntry } from "./snapshots.ts";
import type { ArchiveLibrarySnapshot } from "./archive-library.ts";

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
export const OFFLINE_QUERY_RESULT_LIMIT = 5_000;

export interface OfflineQueryDocument {
  id: string;
  collection: OfflineCollection;
  account: string | null;
  text: string;
  tags: string[];
  folder: string | null;
  capturedAt: string | null;
  mediaCount: number;
  phraseFields?: string[];
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
  phrases: string[];
  filters: OfflineQueryFilters;
  errors: string[];
  truncated: boolean;
}

export interface OfflineQueryHit {
  document: OfflineQueryDocument;
  score: number;
  matchedTerms: string[];
  snippet: string;
  mode: "lexical" | "semantic" | "hybrid";
}

export interface OfflineQueryOptions {
  limit?: number;
  mode?: "lexical" | "semantic" | "hybrid";
}

export interface OfflineFusionOptions {
  limit?: number;
  includeSemanticOnly?: boolean;
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
  const phrases = [] as string[];
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

  for (const match of freeText.matchAll(/"([^"]+)"/gu)) {
    const phrase = normalizePhrase(match[1] ?? "");
    if (tokenizeSearchText(phrase).length > 0 && !phrases.includes(phrase)) phrases.push(phrase);
  }
  terms.push(...tokenizeSearchText(freeText));
  if (truncated) errors.push(`query exceeds ${OFFLINE_QUERY_MAX_LENGTH} characters`);
  return {
    text: freeText.replace(/\s+/g, " ").trim(),
    terms: [...new Set(terms)],
    phrases,
    filters,
    errors,
    truncated
  };
}

export class OfflineQueryIndex {
  readonly #documents: OfflineQueryDocument[] = [];
  readonly #tokens = new Map<string, Map<string, number>>();
  readonly #tokenSequences = new Map<string, string[]>();
  readonly #phraseSequences = new Map<string, string[][]>();
  readonly #documentFrequencies = new Map<string, number>();
  #totalDocumentLength = 0;

  rebuild(documents: readonly OfflineQueryDocument[]): void {
    this.#documents.length = 0;
    this.#tokens.clear();
    this.#tokenSequences.clear();
    this.#phraseSequences.clear();
    this.#documentFrequencies.clear();
    this.#totalDocumentLength = 0;
    for (const document of documents) this.add(document);
  }

  add(document: OfflineQueryDocument): void {
    const normalized = normalizeDocument(document);
    const tokenSequence = tokenizeSearchText(searchableText(normalized));
    const frequencies = termFrequencies(tokenSequence);
    this.#documents.push(normalized);
    this.#tokens.set(normalized.id, frequencies);
    this.#tokenSequences.set(normalized.id, tokenSequence);
    this.#phraseSequences.set(
      normalized.id,
      phraseSearchFields(normalized).map((field) => tokenizeSearchText(field))
    );
    this.#totalDocumentLength += tokenSequence.length;
    for (const term of frequencies.keys()) {
      this.#documentFrequencies.set(term, (this.#documentFrequencies.get(term) ?? 0) + 1);
    }
  }

  size(): number {
    return this.#documents.length;
  }

  termCount(): number {
    return this.#documentFrequencies.size;
  }

  search(query: string | ParsedOfflineQuery, options: OfflineQueryOptions = {}): OfflineQueryHit[] {
    const parsed = typeof query === "string" ? parseOfflineQuery(query) : query;
    if (parsed.errors.length > 0) return [];
    if (parsed.terms.length === 0 && !hasOfflineQueryFilters(parsed.filters)) return [];
    const limit = Math.max(1, Math.min(OFFLINE_QUERY_RESULT_LIMIT, options.limit ?? 50));
    const hits: OfflineQueryHit[] = [];
    const averageDocumentLength = this.#documents.length > 0
      ? this.#totalDocumentLength / this.#documents.length
      : 1;

    for (const document of this.#documents) {
      if (!matchesFilters(document, parsed.filters)) continue;
      const indexed = this.#tokens.get(document.id) ?? new Map<string, number>();
      const tokenSequence = this.#tokenSequences.get(document.id) ?? [];
      const phraseSequences = this.#phraseSequences.get(document.id) ?? [];
      const matchedTerms = parsed.terms.filter((term) => indexed.has(term));
      if (parsed.terms.length > 0 && matchedTerms.length === 0) continue;
      const matchedPhrases = parsed.phrases.filter((phrase) =>
        phraseSequences.some((field) => containsTokenSequence(field, tokenizeSearchText(phrase)))
      );
      if (matchedPhrases.length !== parsed.phrases.length) continue;
      const score = bm25Score(
        indexed,
        matchedTerms,
        tokenSequence.length,
        averageDocumentLength,
        this.#documents.length,
        this.#documentFrequencies
      ) + fieldBoost(document, parsed) + matchedPhrases.length * 12;
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

/** Merge local text and embedding ranks without making either one an exclusive search mode. */
export function fuseOfflineHits(
  lexicalHits: readonly OfflineQueryHit[],
  semanticHits: readonly OfflineQueryHit[],
  options: OfflineFusionOptions = {}
): OfflineQueryHit[] {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const includeSemanticOnly = options.includeSemanticOnly ?? true;
  const fused = new Map<string, {
    lexical: OfflineQueryHit | null;
    semantic: OfflineQueryHit | null;
    lexicalRank: number | null;
    semanticRank: number | null;
  }>();

  lexicalHits.forEach((hit, index) => {
    const key = fusionIdentity(hit.document);
    const current = fused.get(key);
    fused.set(key, {
      lexical: current?.lexical ?? hit,
      semantic: current?.semantic ?? null,
      lexicalRank: current?.lexicalRank ?? index + 1,
      semanticRank: current?.semanticRank ?? null
    });
  });
  semanticHits.forEach((hit, index) => {
    const key = fusionIdentity(hit.document);
    const current = fused.get(key);
    if (!current && !includeSemanticOnly) return;
    fused.set(key, {
      lexical: current?.lexical ?? null,
      semantic: current?.semantic ?? hit,
      lexicalRank: current?.lexicalRank ?? null,
      semanticRank: current?.semanticRank ?? index + 1
    });
  });

  return [...fused.values()]
    .map((entry): OfflineQueryHit => {
      const primary = entry.lexical ?? entry.semantic!;
      const lexicalScore = entry.lexicalRank === null ? 0 : 1.4 / (20 + entry.lexicalRank);
      const semanticScore = entry.semanticRank === null ? 0 : 1 / (20 + entry.semanticRank);
      const mode = entry.lexical && entry.semantic
        ? "hybrid"
        : entry.semantic
          ? "semantic"
          : "lexical";
      return {
        document: primary.document,
        score: lexicalScore + semanticScore,
        matchedTerms: [...new Set([
          ...(entry.lexical?.matchedTerms ?? []),
          ...(entry.semantic?.matchedTerms ?? [])
        ])],
        snippet: entry.lexical?.snippet || entry.semantic?.snippet || "",
        mode
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      timestampValue(b.document.capturedAt) - timestampValue(a.document.capturedAt) ||
      a.document.id.localeCompare(b.document.id)
    )
    .slice(0, limit);
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
  const fields = [
    record.text,
    record.handle ?? "",
    record.displayName ?? "",
    record.permalink ?? "",
    record.conversationId ?? "",
    record.rootId ?? "",
    record.parentId ?? "",
    record.authorId ?? "",
    record.language ?? "",
    ...(record.participants ?? []).flatMap((participant) =>
      [participant.id, participant.handle ?? "", participant.label]
    ),
    ...(record.expandedUrls ?? []).flatMap((link) =>
      [link.shortUrl, link.destination, link.source]
    ),
    ...record.media.flatMap((media) => [media.url, media.altText ?? ""]),
    record.quote?.text ?? "",
    record.article?.title ?? ""
  ];
  return {
    id: `record:${record.tweetId ?? `${record.capturedAt}:${record.text.slice(0, 48)}`}`,
    collection,
    account: normalizeAccount(record.handle),
    text: fields.join(" "),
    tags: [],
    folder: null,
    capturedAt: record.capturedAt,
    mediaCount: record.media.length,
    phraseFields: fields,
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
    phraseFields: [bookmark.text, bookmark.handle ?? "", bookmark.url ?? "", bookmark.notes],
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
    phraseFields: [note],
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
    phraseFields: [snapshot.handle, snapshot.kind, ...snapshot.accounts],
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
    phraseFields: [entry.text],
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
      phraseFields: [
        snapshot.profile.handle ?? "",
        snapshot.profile.displayName ?? "",
        snapshot.profile.bio ?? "",
        snapshot.profile.location ?? "",
        snapshot.profile.website ?? ""
      ],
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
      phraseFields: [entry.handle ?? "", entry.displayName ?? "", entry.sourceFile],
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
      phraseFields: [entry.name ?? "", entry.description ?? "", ...entry.memberIds, ...entry.subscriberIds],
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
      phraseFields: [
        entry.tweetId ?? "",
        entry.url ?? "",
        entry.filename ?? "",
        entry.mimeType ?? "",
        entry.sourceFile
      ],
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
    mediaCount: Number.isFinite(document.mediaCount) ? Math.max(0, Math.floor(document.mediaCount)) : 0,
    ...(Array.isArray(document.phraseFields)
      ? {
          phraseFields: document.phraseFields
            .map((field) => String(field ?? "").normalize("NFC").slice(0, 100_000))
            .filter(Boolean)
            .slice(0, 128)
        }
      : {})
  };
}

function searchableText(document: OfflineQueryDocument): string {
  return [document.text, document.account ?? "", document.collection, ...document.tags, document.folder ?? ""].join(" ");
}

function phraseSearchFields(document: OfflineQueryDocument): string[] {
  return [
    ...(document.phraseFields ?? [document.text]),
    document.account ?? "",
    document.collection,
    ...document.tags,
    document.folder ?? ""
  ].filter(Boolean);
}

function fieldBoost(document: OfflineQueryDocument, query: ParsedOfflineQuery): number {
  const accountTerms = new Set(tokenizeSearchText(document.account ?? ""));
  const tagTerms = new Set(tokenizeSearchText(document.tags.join(" ")));
  const fieldScore = query.terms.reduce(
    (score, term) => score + (accountTerms.has(term) ? 4 : 0) + (tagTerms.has(term) ? 2 : 0),
    0
  );
  const exactAccount = query.terms.length === 1 && document.account === query.terms[0];
  return fieldScore + (exactAccount ? 12 : 0);
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

export function hasOfflineQueryFilters(filters: OfflineQueryFilters): boolean {
  return filters.collections.length > 0 || Boolean(filters.account || filters.tag || filters.folder) ||
    filters.from !== null || filters.to !== null || filters.hasMedia !== null;
}

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function bm25Score(
  frequencies: ReadonlyMap<string, number>,
  matchedTerms: readonly string[],
  documentLength: number,
  averageDocumentLength: number,
  documentCount: number,
  documentFrequencies: ReadonlyMap<string, number>
): number {
  const k1 = 1.2;
  const b = 0.75;
  return matchedTerms.reduce((score, term) => {
    const frequency = frequencies.get(term) ?? 0;
    const documentsWithTerm = documentFrequencies.get(term) ?? 0;
    const inverseDocumentFrequency = Math.log(
      1 + (documentCount - documentsWithTerm + 0.5) / (documentsWithTerm + 0.5)
    );
    const normalizedFrequency = frequency * (k1 + 1) /
      (frequency + k1 * (1 - b + b * documentLength / Math.max(1, averageDocumentLength)));
    return score + inverseDocumentFrequency * normalizedFrequency;
  }, 0);
}

function containsTokenSequence(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  outer: for (let start = 0; start <= tokens.length - phrase.length; start += 1) {
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[start + offset] !== phrase[offset]) continue outer;
    }
    return true;
  }
  return false;
}

function normalizePhrase(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function fusionIdentity(document: OfflineQueryDocument): string {
  if (typeof document.payload === "object" && document.payload !== null) {
    const tweetId = (document.payload as { tweetId?: unknown }).tweetId;
    if (typeof tweetId === "string" && tweetId.trim()) return `tweet:${tweetId.trim()}`;
  }
  return document.id;
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
