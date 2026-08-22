import type { StorageGateway } from "../../platform/storage.ts";
import { mutateStored, replaceStored } from "../../platform/storage-lock.ts";
import {
  emptyArchiveRepairSummary,
  type ArchiveAccountRef,
  type ArchiveCollections,
  type ArchiveDirectMessage,
  type ArchiveExpandedUrl,
  type ArchiveList,
  type ArchiveMediaReference,
  type ArchiveParticipant,
  type ArchiveRepairSummary
} from "./archive-types.ts";

export const ARCHIVE_LIBRARY_KEY = "aviary.archive.library.v1";

/** Per-collection ceiling. Past this the oldest entries are dropped, which is a real loss. */
export const ARCHIVE_COLLECTION_LIMIT = 10_000;

export interface ArchiveLibrarySnapshot extends ArchiveCollections {
  version: 1;
  importedJobs: string[];
  updatedAt: string | null;
  lastRepair: ArchiveRepairSummary;
}

const EMPTY: ArchiveLibrarySnapshot = {
  version: 1,
  profile: null,
  account: null,
  directMessages: [],
  media: [],
  followers: [],
  following: [],
  lists: [],
  importedJobs: [],
  updatedAt: null,
  lastRepair: emptyArchiveRepairSummary()
};

export class ArchiveLibraryStore {
  readonly #storage: StorageGateway;
  #snapshot: ArchiveLibrarySnapshot = cloneSnapshot(EMPTY);
  #loaded = false;

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    this.#snapshot = normalizeSnapshot(await this.#storage.get<unknown>(ARCHIVE_LIBRARY_KEY, EMPTY));
    this.#loaded = true;
  }

  snapshot(): ArchiveLibrarySnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  async merge(
    collections: ArchiveCollections,
    jobId: string,
    repairs?: ArchiveRepairSummary
  ): Promise<void> {
    await this.load();
    // Built from what is on disk at write time, not from the copy this instance loaded. Two tabs
    // importing different archives each wrote their whole snapshot back, so the second import
    // erased the first one's collections along with its record of which jobs had been imported.
    //
    // `importedJobs` is consulted, not merely appended to. Re-merging an archive already recorded
    // used to be a no-op only when the collections were small enough to fit under the cap below;
    // above it, entries that had been sliced away were appended again as though new, and the
    // retained window rotated forward by the size of the archive on every re-merge, never settling.
    this.#snapshot = await mutateStored<ArchiveLibrarySnapshot>(
      this.#storage,
      ARCHIVE_LIBRARY_KEY,
      cloneSnapshot(EMPTY),
      (stored: unknown) => this.#fold(normalizeSnapshot(stored), collections, jobId, repairs)
    );
  }

  #fold(
    base: ArchiveLibrarySnapshot,
    collections: ArchiveCollections,
    jobId: string,
    repairs?: ArchiveRepairSummary
  ): ArchiveLibrarySnapshot {
    if (base.importedJobs.includes(jobId)) {
      // Already folded in. Doing it again cannot add anything and, past the cap, actively loses.
      const unchanged = cloneSnapshot(base);
      if (repairs) unchanged.lastRepair = { ...repairs };
      return unchanged;
    }
    const next = cloneSnapshot(base);
    next.profile = collections.profile ?? next.profile;
    next.account = collections.account ?? next.account;
    next.directMessages = mergeByKey(
      next.directMessages,
      collections.directMessages.map(normalizeDirectMessage),
      (entry) => entry.id ?? `${entry.conversationId ?? ""}:${entry.createdAt ?? ""}:${entry.text}`
    );
    next.media = mergeByKey(
      next.media,
      collections.media,
      (entry) => entry.id ?? `${entry.tweetId ?? ""}:${entry.url ?? ""}:${entry.sourceFile}`
    );
    next.followers = mergeByKey(
      next.followers,
      collections.followers,
      (entry) => entry.id ?? entry.handle ?? `${entry.sourceFile}:${entry.displayName ?? ""}`
    );
    next.following = mergeByKey(
      next.following,
      collections.following,
      (entry) => entry.id ?? entry.handle ?? `${entry.sourceFile}:${entry.displayName ?? ""}`
    );
    next.lists = mergeByKey(
      next.lists,
      collections.lists,
      (entry) => entry.id ?? `${entry.name ?? ""}:${entry.description ?? ""}`
    );
    if (!next.importedJobs.includes(jobId)) {
      next.importedJobs.push(jobId);
      next.importedJobs = next.importedJobs.slice(-100);
    }
    next.updatedAt = new Date().toISOString();
    if (repairs) next.lastRepair = { ...repairs };
    return next;
  }

  async clear(): Promise<void> {
    const next = cloneSnapshot(EMPTY);
    this.#loaded = true;
    // Replaced, not merged: clearing the library means clearing it.
    await replaceStored(this.#storage, ARCHIVE_LIBRARY_KEY, next);
    this.#snapshot = next;
  }
}

function normalizeSnapshot(value: unknown): ArchiveLibrarySnapshot {
  if (!value || typeof value !== "object") return cloneSnapshot(EMPTY);
  const raw = value as Partial<ArchiveLibrarySnapshot>;
  return {
    version: 1,
    profile: isRecord(raw.profile) ? {
      handle: stringOrNull(raw.profile.handle),
      displayName: stringOrNull(raw.profile.displayName),
      bio: stringOrNull(raw.profile.bio),
      location: stringOrNull(raw.profile.location),
      website: stringOrNull(raw.profile.website),
      joinedAt: stringOrNull(raw.profile.joinedAt)
    } : null,
    account: isRecord(raw.account) ? {
      id: stringOrNull(raw.account.id),
      handle: stringOrNull(raw.account.handle),
      displayName: stringOrNull(raw.account.displayName),
      email: stringOrNull(raw.account.email)
    } : null,
    directMessages: arrayOf(raw.directMessages)
      .filter(isDirectMessage)
      .map(normalizeDirectMessage),
    media: arrayOf(raw.media).filter(isMediaReference),
    followers: arrayOf(raw.followers).filter(isAccountRef),
    following: arrayOf(raw.following).filter(isAccountRef),
    lists: arrayOf(raw.lists).filter(isList),
    importedJobs: arrayOf(raw.importedJobs).filter((entry): entry is string => typeof entry === "string").slice(-100),
    updatedAt: stringOrNull(raw.updatedAt),
    lastRepair: normalizeRepairSummary(raw.lastRepair)
  };
}

/**
 * The archive folded into what is already stored, keyed so a re-import updates rather than doubles.
 *
 * The cap is a real ceiling and it drops the oldest entries, which is a loss the caller cannot see
 * from here. What it must not do is make the store unstable: an entry dropped by the cap and then
 * offered again reads as new, gets appended, and pushes another one out. `#fold` refusing a jobId
 * it has already recorded is what keeps that from repeating on every re-merge.
 */
function mergeByKey<T>(current: T[], incoming: T[], key: (entry: T) => string): T[] {
  const result = [...current];
  const positions = new Map(result.map((entry, index) => [key(entry), index]));
  for (const entry of incoming) {
    const identity = key(entry);
    const position = positions.get(identity);
    if (position === undefined) {
      positions.set(identity, result.length);
      result.push(entry);
    } else {
      // A selected archive is newer evidence than the copy already persisted for this key.
      result[position] = entry;
    }
  }
  return result.slice(-ARCHIVE_COLLECTION_LIMIT);
}

function cloneSnapshot(snapshot: ArchiveLibrarySnapshot): ArchiveLibrarySnapshot {
  return {
    ...snapshot,
    profile: snapshot.profile ? { ...snapshot.profile } : null,
    account: snapshot.account ? { ...snapshot.account } : null,
    directMessages: snapshot.directMessages.map((entry) => ({
      ...entry,
      recipientIds: [...entry.recipientIds],
      mediaUrls: [...entry.mediaUrls],
      sender: entry.sender ? { ...entry.sender } : null,
      recipients: (entry.recipients ?? []).map((participant) => ({ ...participant })),
      ...(entry.expandedUrls
        ? { expandedUrls: entry.expandedUrls.map((link) => ({ ...link })) }
        : {})
    })),
    media: snapshot.media.map((entry) => ({ ...entry })),
    followers: snapshot.followers.map((entry) => ({ ...entry })),
    following: snapshot.following.map((entry) => ({ ...entry })),
    lists: snapshot.lists.map((entry) => ({ ...entry, memberIds: [...entry.memberIds], subscriberIds: [...entry.subscriberIds] })),
    importedJobs: [...snapshot.importedJobs],
    lastRepair: { ...snapshot.lastRepair }
  };
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectMessage(value: unknown): value is ArchiveDirectMessage {
  return isRecord(value) && typeof value.text === "string" && Array.isArray(value.recipientIds) && Array.isArray(value.mediaUrls);
}

function normalizeDirectMessage(message: ArchiveDirectMessage): ArchiveDirectMessage {
  const sender = normalizeParticipant(message.sender) ?? participantFromId(message.senderId);
  const recipients = Array.isArray(message.recipients) && message.recipients.length > 0
    ? message.recipients
        .map(normalizeParticipant)
        .filter((entry): entry is ArchiveParticipant => Boolean(entry))
    : message.recipientIds.map((id) => participantFromId(id)!).filter(Boolean);
  return {
    ...message,
    recipientIds: [...message.recipientIds],
    mediaUrls: [...message.mediaUrls],
    sender,
    recipients,
    ...(Array.isArray(message.expandedUrls)
      ? {
          expandedUrls: message.expandedUrls
            .map(normalizeExpandedUrl)
            .filter((entry): entry is ArchiveExpandedUrl => Boolean(entry))
        }
      : {})
  };
}

function participantFromId(value: unknown): ArchiveParticipant | null {
  if (typeof value !== "string" || !value) return null;
  return {
    id: value,
    handle: null,
    label: /^\d+$/.test(value) ? `Unresolved user ID ${value}` : `Unresolved participant ${value}`
  };
}

function normalizeParticipant(value: unknown): ArchiveParticipant | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    handle: stringOrNull(value.handle),
    label: typeof value.label === "string" ? value.label : `Unresolved user ID ${value.id}`
  };
}

function normalizeExpandedUrl(value: unknown): ArchiveExpandedUrl | null {
  if (
    !isRecord(value) ||
    typeof value.shortUrl !== "string" ||
    typeof value.destination !== "string" ||
    !isHttpUrl(value.destination) ||
    (value.source !== "archive" && value.source !== "local-corpus")
  ) {
    return null;
  }
  return {
    shortUrl: value.shortUrl,
    destination: value.destination,
    source: value.source
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeRepairSummary(value: unknown): ArchiveRepairSummary {
  const record = isRecord(value) ? value : {};
  return {
    archiveLinksExpanded: nonNegativeInteger(record.archiveLinksExpanded),
    corpusLinksExpanded: nonNegativeInteger(record.corpusLinksExpanded),
    participantIdsResolved: nonNegativeInteger(record.participantIdsResolved),
    participantIdsUnresolved: nonNegativeInteger(record.participantIdsUnresolved)
  };
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function isMediaReference(value: unknown): value is ArchiveMediaReference {
  return isRecord(value) && typeof value.sourceFile === "string";
}

function isAccountRef(value: unknown): value is ArchiveAccountRef {
  return isRecord(value) && typeof value.sourceFile === "string";
}

function isList(value: unknown): value is ArchiveList {
  return isRecord(value) && Array.isArray(value.memberIds) && Array.isArray(value.subscriberIds);
}
