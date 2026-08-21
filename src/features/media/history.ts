import type { StorageGateway } from "../../platform/storage";
import { mutateStored, replaceStored } from "../../platform/storage-lock";
import {
  hexadecimalHammingDistance,
  mediaIdentityHash,
  PERCEPTUAL_MATCH_DISTANCE,
  sha256Hex,
  type MediaFingerprint,
  type MediaFingerprintKind
} from "../export/assets";

export const MEDIA_HISTORY_KEY = "aviary.media.history.v1";
export const MEDIA_HISTORY_LIMIT = 1500;

export interface MediaHistoryEntry {
  identityHash: string;
  exactHash?: string;
  perceptualHash?: string;
  at: string;
}

export type MediaMatchKind = "identity" | "exact" | "perceptual";

export interface MediaHistoryMatchSummary {
  identity: number;
  exact: number;
  perceptual: number;
}

export interface MediaHistoryLastMatch {
  kind: MediaMatchKind;
  at: string;
}

export interface MediaHistorySnapshot {
  schemaVersion: 2;
  entries: MediaHistoryEntry[];
  matches: MediaHistoryMatchSummary;
  lastMatch: MediaHistoryLastMatch | null;
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
  #identityIndex = new Set<string>();
  #exactIndex = new Set<string>();
  #matches: MediaHistoryMatchSummary = emptyMatches();
  #lastMatch: MediaHistoryLastMatch | null = null;
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
    return this.#identityIndex.has(legacyIdentityHash(key));
  }

  findMatch(fingerprint: MediaFingerprint, allowPerceptual = false): MediaMatchKind | null {
    const candidate = normalizeFingerprint(fingerprint);
    if (candidate.exactHash && this.#exactIndex.has(candidate.exactHash)) {
      return "exact";
    }
    if (this.#identityIndex.has(candidate.identityHash)) {
      return "identity";
    }
    if (allowPerceptual && candidate.perceptualHash) {
      for (const entry of this.#entries) {
        if (
          entry.perceptualHash &&
          hexadecimalHammingDistance(entry.perceptualHash, candidate.perceptualHash) <=
            PERCEPTUAL_MATCH_DISTANCE
        ) {
          return "perceptual";
        }
      }
    }
    return null;
  }

  async record(fingerprintOrLegacyKey: MediaFingerprint | string): Promise<boolean> {
    await this.load();
    const fingerprint =
      typeof fingerprintOrLegacyKey === "string"
        ? { identityHash: legacyIdentityHash(fingerprintOrLegacyKey) }
        : normalizeFingerprint(fingerprintOrLegacyKey);
    if (this.findMatch(fingerprint, false)) {
      return false;
    }
    const entry: MediaHistoryEntry = { ...fingerprint, at: new Date().toISOString() };
    this.#identityIndex.add(entry.identityHash);
    if (entry.exactHash) this.#exactIndex.add(entry.exactHash);
    this.#entries.push(entry);
    while (this.#entries.length > this.#limit) {
      const removed = this.#entries.shift();
      if (removed) {
        this.#rebuildIndexes();
      }
    }
    await this.#persist({ added: [entry] });
    return true;
  }

  async noteMatch(kind: MediaMatchKind): Promise<void> {
    await this.load();
    const match = { kind, at: new Date().toISOString() } satisfies MediaHistoryLastMatch;
    this.#matches = { ...this.#matches, [kind]: this.#matches[kind] + 1 };
    this.#lastMatch = match;
    await this.#persist({ matched: match });
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#identityIndex.clear();
    this.#exactIndex.clear();
    this.#matches = emptyMatches();
    this.#lastMatch = null;
    this.#loaded = true;
    // "Clear download history" means clear it, including whatever a second tab recorded.
    try {
      await replaceStored<MediaHistorySnapshot>(this.#storage, MEDIA_HISTORY_KEY, emptySnapshot());
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }

  size(): number {
    return this.#entries.length;
  }

  snapshot(): MediaHistorySnapshot {
    return {
      schemaVersion: 2,
      entries: this.#entries.map((entry) => ({ ...entry })),
      matches: { ...this.#matches },
      lastMatch: this.#lastMatch ? { ...this.#lastMatch } : null
    };
  }

  async #hydrate(): Promise<void> {
    const stored = await this.#storage.get<MediaHistorySnapshot | LegacyMediaHistorySnapshot>(
      MEDIA_HISTORY_KEY,
      emptySnapshot()
    );
    this.#entries = readEntries(stored).slice(-this.#limit);
    this.#matches = readMatches(stored);
    this.#lastMatch = readLastMatch(stored);
    this.#rebuildIndexes();
    this.#loaded = true;
    if (!isCurrentSnapshot(stored)) {
      await this.#persist({});
    }
  }

  /**
   * Folds this tab's entries into what is stored, under a cross-tab lock.
   *
   * Overwriting cost real work: two tabs saving media each wrote their own list, so the loser's
   * dedup keys disappeared and the same files were offered again as new. `added` is what this call
   * recorded -- never the whole local list -- then the same cap the in-memory list applies.
   */
  async #persist(delta: {
    added?: MediaHistoryEntry[];
    matched?: MediaHistoryLastMatch;
  }): Promise<void> {
    try {
      const merged = await mutateStored<MediaHistorySnapshot | LegacyMediaHistorySnapshot>(
        this.#storage,
        MEDIA_HISTORY_KEY,
        emptySnapshot(),
        (stored) => {
          const entries = readEntries(stored);
          // Only this call's entry. Folding the whole local list in would undo a
          // "Clear download history" performed in another tab.
          for (const entry of delta.added ?? []) {
            mergeEntry(entries, entry);
          }
          const ordered = entries.sort((left, right) =>
            left.at < right.at ? -1 : left.at > right.at ? 1 : 0
          );
          const matches = readMatches(stored);
          if (delta.matched) {
            matches[delta.matched.kind] += 1;
          }
          const storedLastMatch = readLastMatch(stored);
          const lastMatch =
            delta.matched && (!storedLastMatch || storedLastMatch.at <= delta.matched.at)
              ? delta.matched
              : storedLastMatch;
          return {
            schemaVersion: 2,
            entries: ordered.slice(-this.#limit),
            matches,
            lastMatch
          };
        }
      );
      this.#entries = readEntries(merged);
      this.#matches = readMatches(merged);
      this.#lastMatch = readLastMatch(merged);
      this.#rebuildIndexes();
    } catch (error) {
      // Best-effort, but not silent: a full backend must be visible somewhere.
      this.#onPersistError?.(error);
    }
  }

  #rebuildIndexes(): void {
    this.#identityIndex = new Set(this.#entries.map((entry) => entry.identityHash));
    this.#exactIndex = new Set(
      this.#entries.flatMap((entry) => entry.exactHash ? [entry.exactHash] : [])
    );
  }
}

/** The stored shape is user-writable through a backup import, so every read validates it. */
function readEntries(
  stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot | undefined
): MediaHistoryEntry[] {
  const entries = Array.isArray(stored?.entries) ? stored.entries : [];
  const normalized: MediaHistoryEntry[] = [];
  for (const candidate of entries) {
    if (!candidate || typeof candidate.at !== "string") continue;
    if ("identityHash" in candidate && validHash(candidate.identityHash)) {
      const exactHash = validHash(candidate.exactHash) ? candidate.exactHash.toLowerCase() : undefined;
      const perceptualHash = validHash(candidate.perceptualHash)
        ? candidate.perceptualHash.toLowerCase()
        : undefined;
      mergeEntry(normalized, {
        identityHash: candidate.identityHash.toLowerCase(),
        ...(exactHash ? { exactHash } : {}),
        ...(perceptualHash ? { perceptualHash } : {}),
        at: candidate.at
      });
      continue;
    }
    if ("key" in candidate && typeof candidate.key === "string") {
      mergeEntry(normalized, {
        identityHash: legacyIdentityHash(candidate.key),
        at: candidate.at
      });
    }
  }
  return normalized;
}

interface LegacyMediaHistoryEntry {
  key: string;
  at: string;
}

interface LegacyMediaHistorySnapshot {
  entries: Array<MediaHistoryEntry | LegacyMediaHistoryEntry>;
  matches?: Partial<MediaHistoryMatchSummary>;
  lastMatch?: MediaHistoryLastMatch | null;
  schemaVersion?: number;
}

function emptySnapshot(): MediaHistorySnapshot {
  return { schemaVersion: 2, entries: [], matches: emptyMatches(), lastMatch: null };
}

function emptyMatches(): MediaHistoryMatchSummary {
  return { identity: 0, exact: 0, perceptual: 0 };
}

function readMatches(
  stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot | undefined
): MediaHistoryMatchSummary {
  const candidate = stored?.matches;
  return {
    identity: validCount(candidate?.identity),
    exact: validCount(candidate?.exact),
    perceptual: validCount(candidate?.perceptual)
  };
}

function readLastMatch(
  stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot | undefined
): MediaHistoryLastMatch | null {
  const candidate = stored?.lastMatch;
  return candidate && isMatchKind(candidate.kind) && typeof candidate.at === "string"
    ? { kind: candidate.kind, at: candidate.at }
    : null;
}

function mergeEntry(entries: MediaHistoryEntry[], incoming: MediaHistoryEntry): void {
  const existing = entries.find((entry) =>
    entry.identityHash === incoming.identityHash ||
    Boolean(entry.exactHash && incoming.exactHash && entry.exactHash === incoming.exactHash)
  );
  if (!existing) {
    entries.push({ ...incoming });
    return;
  }
  if (!existing.exactHash && incoming.exactHash) existing.exactHash = incoming.exactHash;
  if (!existing.perceptualHash && incoming.perceptualHash) {
    existing.perceptualHash = incoming.perceptualHash;
  }
  if (existing.at < incoming.at) existing.at = incoming.at;
}

function normalizeFingerprint(fingerprint: MediaFingerprint): MediaFingerprint {
  const identityHash = validHash(fingerprint.identityHash)
    ? fingerprint.identityHash.toLowerCase()
    : sha256Hex(new TextEncoder().encode(String(fingerprint.identityHash)));
  const exactHash = validHash(fingerprint.exactHash) ? fingerprint.exactHash.toLowerCase() : undefined;
  const perceptualHash = validHash(fingerprint.perceptualHash)
    ? fingerprint.perceptualHash.toLowerCase()
    : undefined;
  return {
    identityHash,
    ...(exactHash ? { exactHash } : {}),
    ...(perceptualHash ? { perceptualHash } : {})
  };
}

function legacyIdentityHash(key: string): string {
  const parts = key.split(":");
  const kind = parts.at(-1);
  const index = parts.at(-2);
  if (isMediaKind(kind) && /^\d+$/.test(index ?? "") && parts.length >= 4) {
    const source = parts.slice(1, -2).join(":");
    return mediaIdentityHash(kind, source, /^https?:\/\//i.test(source) ? null : source);
  }
  return sha256Hex(new TextEncoder().encode(`aviary-media-legacy:${key}`));
}

function isCurrentSnapshot(stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot): boolean {
  return stored.schemaVersion === 2 && Array.isArray(stored.entries) && stored.entries.every((entry) =>
    typeof entry === "object" && entry !== null &&
    "identityHash" in entry && validHash(entry.identityHash) && !("key" in entry)
  );
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function validCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function isMatchKind(value: unknown): value is MediaMatchKind {
  return value === "identity" || value === "exact" || value === "perceptual";
}

function isMediaKind(value: unknown): value is MediaFingerprintKind {
  return value === "photo" || value === "video" || value === "thumbnail";
}
