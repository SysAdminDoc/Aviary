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
export const MEDIA_HISTORY_RESERVATION_TTL_MS = 10 * 60 * 1000;
const MEDIA_HISTORY_RESERVATION_LIMIT = 128;

export interface MediaHistoryEntry {
  identityHash: string;
  exactHash?: string;
  perceptualHash?: string;
  at: string;
}

export interface MediaHistoryReservation extends MediaFingerprint {
  token: string;
  at: string;
  expiresAt: number;
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
  schemaVersion: 3;
  entries: MediaHistoryEntry[];
  reservations: MediaHistoryReservation[];
  matches: MediaHistoryMatchSummary;
  lastMatch: MediaHistoryLastMatch | null;
}

export interface MediaHistoryReservationResult {
  match: MediaMatchKind | null;
  token: string | null;
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
  #reservations: MediaHistoryReservation[] = [];
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
    return this.findMatch({ identityHash: legacyIdentityHash(key) }, false) !== null;
  }

  findMatch(fingerprint: MediaFingerprint, allowPerceptual = false): MediaMatchKind | null {
    const candidate = normalizeFingerprint(fingerprint);
    return findFingerprintMatch(
      this.#entries,
      activeReservations(this.#reservations),
      candidate,
      allowPerceptual
    );
  }

  /** Completed history only. In-flight claims must not paint a media item as already saved. */
  wasDownloaded(fingerprint: MediaFingerprint, allowPerceptual = false): boolean {
    const candidate = normalizeFingerprint(fingerprint);
    return findFingerprintMatch(this.#entries, [], candidate, allowPerceptual) !== null;
  }

  async record(fingerprintOrLegacyKey: MediaFingerprint | string): Promise<boolean> {
    await this.load();
    const fingerprint =
      typeof fingerprintOrLegacyKey === "string"
        ? { identityHash: legacyIdentityHash(fingerprintOrLegacyKey) }
        : normalizeFingerprint(fingerprintOrLegacyKey);
    const entry: MediaHistoryEntry = { ...fingerprint, at: new Date().toISOString() };
    return (await this.#persist({ added: [entry] })) > 0;
  }

  /** Atomically claims a fingerprint so two tabs cannot start the same transfer. */
  async reserve(
    fingerprint: MediaFingerprint,
    allowPerceptual = false
  ): Promise<MediaHistoryReservationResult> {
    await this.load();
    const candidate = normalizeFingerprint(fingerprint);
    const now = Date.now();
    const reservation: MediaHistoryReservation = {
      ...candidate,
      token: reservationToken(candidate, now),
      at: new Date(now).toISOString(),
      expiresAt: now + MEDIA_HISTORY_RESERVATION_TTL_MS
    };
    let result: MediaHistoryReservationResult = { match: null, token: reservation.token };
    try {
      const merged = await mutateStored<MediaHistorySnapshot | LegacyMediaHistorySnapshot>(
        this.#storage,
        MEDIA_HISTORY_KEY,
        emptySnapshot(),
        (stored) => {
          const entries = readEntries(stored);
          const reservations = readReservations(stored, now);
          const match = findFingerprintMatch(entries, reservations, candidate, allowPerceptual);
          if (match) {
            result = { match, token: null };
          } else {
            reservations.push(reservation);
          }
          return snapshotFrom(stored, entries, reservations, this.#limit);
        }
      );
      this.#adopt(merged);
      return result;
    } catch (error) {
      this.#onPersistError?.(error);
      const match = this.findMatch(candidate, allowPerceptual);
      if (match) return { match, token: null };
      this.#reservations.push(reservation);
      this.#reservations = activeReservations(this.#reservations).slice(-MEDIA_HISTORY_RESERVATION_LIMIT);
      return result;
    }
  }

  /** Turns a successful in-flight claim into durable completed history. */
  async commit(token: string, fingerprint: MediaFingerprint): Promise<boolean> {
    await this.load();
    if (!validToken(token)) return false;
    const candidate = normalizeFingerprint(fingerprint);
    const entry: MediaHistoryEntry = { ...candidate, at: new Date().toISOString() };
    let added = false;
    try {
      const merged = await mutateStored<MediaHistorySnapshot | LegacyMediaHistorySnapshot>(
        this.#storage,
        MEDIA_HISTORY_KEY,
        emptySnapshot(),
        (stored) => {
          const entries = readEntries(stored);
          const reservations = readReservations(stored).filter((item) => item.token !== token);
          if (!findFingerprintMatch(entries, [], candidate, false)) {
            mergeEntry(entries, entry);
            added = true;
          }
          return snapshotFrom(stored, entries, reservations, this.#limit);
        }
      );
      this.#adopt(merged);
      return added;
    } catch (error) {
      this.#onPersistError?.(error);
      this.#reservations = this.#reservations.filter((item) => item.token !== token);
      if (!findFingerprintMatch(this.#entries, [], candidate, false)) {
        mergeEntry(this.#entries, entry);
        return true;
      }
      return false;
    }
  }

  /** Releases a failed transfer claim so a retry can start immediately. */
  async release(token: string): Promise<void> {
    await this.load();
    if (!validToken(token)) return;
    try {
      const merged = await mutateStored<MediaHistorySnapshot | LegacyMediaHistorySnapshot>(
        this.#storage,
        MEDIA_HISTORY_KEY,
        emptySnapshot(),
        (stored) => snapshotFrom(
          stored,
          readEntries(stored),
          readReservations(stored).filter((item) => item.token !== token),
          this.#limit
        )
      );
      this.#adopt(merged);
    } catch (error) {
      this.#onPersistError?.(error);
      this.#reservations = this.#reservations.filter((item) => item.token !== token);
    }
  }

  async noteMatch(kind: MediaMatchKind): Promise<void> {
    await this.load();
    const match = { kind, at: new Date().toISOString() } satisfies MediaHistoryLastMatch;
    await this.#persist({ matched: match });
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#reservations = [];
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
      schemaVersion: 3,
      entries: this.#entries.map((entry) => ({ ...entry })),
      reservations: activeReservations(this.#reservations).map((entry) => ({ ...entry })),
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
    this.#reservations = readReservations(stored);
    this.#matches = readMatches(stored);
    this.#lastMatch = readLastMatch(stored);
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
  }): Promise<number> {
    let added = 0;
    try {
      const merged = await mutateStored<MediaHistorySnapshot | LegacyMediaHistorySnapshot>(
        this.#storage,
        MEDIA_HISTORY_KEY,
        emptySnapshot(),
        (stored) => {
          const entries = readEntries(stored);
          const reservations = readReservations(stored);
          // Only this call's entry. Folding the whole local list in would undo a
          // "Clear download history" performed in another tab.
          for (const entry of delta.added ?? []) {
            if (findFingerprintMatch(entries, reservations, entry, false)) continue;
            mergeEntry(entries, entry);
            added += 1;
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
            schemaVersion: 3,
            entries: ordered.slice(-this.#limit),
            reservations: reservations.slice(-MEDIA_HISTORY_RESERVATION_LIMIT),
            matches,
            lastMatch
          };
        }
      );
      this.#adopt(merged);
    } catch (error) {
      // Best-effort, but not silent: a full backend must be visible somewhere.
      this.#onPersistError?.(error);
    }
    return added;
  }

  #adopt(snapshot: MediaHistorySnapshot | LegacyMediaHistorySnapshot): void {
    this.#entries = readEntries(snapshot).slice(-this.#limit);
    this.#reservations = readReservations(snapshot);
    this.#matches = readMatches(snapshot);
    this.#lastMatch = readLastMatch(snapshot);
  }
}

/** The stored shape is user-writable through a backup import, so every read validates it. */
function readEntries(
  stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot | undefined
): MediaHistoryEntry[] {
  const entries = Array.isArray(stored?.entries) ? stored.entries : [];
  const normalized: MediaHistoryEntry[] = [];
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.at !== "string") continue;
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
  reservations?: unknown;
  matches?: Partial<MediaHistoryMatchSummary>;
  lastMatch?: MediaHistoryLastMatch | null;
  schemaVersion?: number;
}

function emptySnapshot(): MediaHistorySnapshot {
  return {
    schemaVersion: 3,
    entries: [],
    reservations: [],
    matches: emptyMatches(),
    lastMatch: null
  };
}

function readReservations(
  stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot | undefined,
  now = Date.now()
): MediaHistoryReservation[] {
  const candidates = Array.isArray(stored?.reservations) ? stored.reservations : [];
  const reservations: MediaHistoryReservation[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const value = candidate as Partial<MediaHistoryReservation>;
    if (
      !validToken(value.token) ||
      !validHash(value.identityHash) ||
      typeof value.at !== "string" ||
      typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now
    ) {
      continue;
    }
    reservations.push({
      token: value.token,
      identityHash: value.identityHash.toLowerCase(),
      ...(validHash(value.exactHash) ? { exactHash: value.exactHash.toLowerCase() } : {}),
      ...(validHash(value.perceptualHash)
        ? { perceptualHash: value.perceptualHash.toLowerCase() }
        : {}),
      at: value.at,
      expiresAt: Math.trunc(value.expiresAt)
    });
  }
  return reservations.slice(-MEDIA_HISTORY_RESERVATION_LIMIT);
}

function activeReservations(
  reservations: readonly MediaHistoryReservation[],
  now = Date.now()
): MediaHistoryReservation[] {
  return reservations.filter((entry) => entry.expiresAt > now);
}

function snapshotFrom(
  stored: MediaHistorySnapshot | LegacyMediaHistorySnapshot,
  entries: MediaHistoryEntry[],
  reservations: MediaHistoryReservation[],
  limit: number
): MediaHistorySnapshot {
  return {
    schemaVersion: 3,
    entries: entries
      .sort((left, right) => left.at < right.at ? -1 : left.at > right.at ? 1 : 0)
      .slice(-limit),
    reservations: activeReservations(reservations).slice(-MEDIA_HISTORY_RESERVATION_LIMIT),
    matches: readMatches(stored),
    lastMatch: readLastMatch(stored)
  };
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
  const now = Date.now();
  return stored.schemaVersion === 3 &&
    Array.isArray(stored.entries) &&
    Array.isArray(stored.reservations) &&
    stored.entries.every((entry) =>
      typeof entry === "object" && entry !== null &&
      "identityHash" in entry && validHash(entry.identityHash) && !("key" in entry)
    ) &&
    stored.reservations.every((entry) => isActiveStoredReservation(entry, now));
}

function isActiveStoredReservation(value: unknown, now: number): boolean {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MediaHistoryReservation>;
  return validToken(entry.token) &&
    validHash(entry.identityHash) &&
    (entry.exactHash === undefined || validHash(entry.exactHash)) &&
    (entry.perceptualHash === undefined || validHash(entry.perceptualHash)) &&
    typeof entry.at === "string" &&
    typeof entry.expiresAt === "number" &&
    Number.isFinite(entry.expiresAt) &&
    entry.expiresAt > now;
}

function findFingerprintMatch(
  entries: readonly MediaFingerprint[],
  reservations: readonly MediaFingerprint[],
  fingerprint: MediaFingerprint,
  allowPerceptual: boolean
): MediaMatchKind | null {
  const candidates = [...entries, ...reservations];
  if (fingerprint.exactHash && candidates.some((entry) => entry.exactHash === fingerprint.exactHash)) {
    return "exact";
  }
  if (candidates.some((entry) => entry.identityHash === fingerprint.identityHash)) {
    return "identity";
  }
  if (allowPerceptual && fingerprint.perceptualHash) {
    for (const entry of candidates) {
      if (
        entry.perceptualHash &&
        hexadecimalHammingDistance(entry.perceptualHash, fingerprint.perceptualHash) <=
          PERCEPTUAL_MATCH_DISTANCE
      ) {
        return "perceptual";
      }
    }
  }
  return null;
}

let reservationSequence = 0;

function reservationToken(fingerprint: MediaFingerprint, now: number): string {
  reservationSequence += 1;
  return sha256Hex(new TextEncoder().encode(
    `${fingerprint.exactHash ?? fingerprint.identityHash}:${now}:${reservationSequence}:${Math.random()}`
  ));
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
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
