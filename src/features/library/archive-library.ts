import type { StorageGateway } from "../../platform/storage";
import type { ArchiveCollections, ArchiveDirectMessage, ArchiveMediaReference, ArchiveAccountRef, ArchiveList } from "./archive-types";

export const ARCHIVE_LIBRARY_KEY = "aviary.archive.library.v1";

export interface ArchiveLibrarySnapshot extends ArchiveCollections {
  version: 1;
  importedJobs: string[];
  updatedAt: string | null;
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
  updatedAt: null
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

  async merge(collections: ArchiveCollections, jobId: string): Promise<void> {
    await this.load();
    const next = cloneSnapshot(this.#snapshot);
    next.profile = collections.profile ?? next.profile;
    next.account = collections.account ?? next.account;
    next.directMessages = mergeByKey(
      next.directMessages,
      collections.directMessages,
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
    await this.#storage.set(ARCHIVE_LIBRARY_KEY, next);
    this.#snapshot = next;
  }

  async clear(): Promise<void> {
    const next = cloneSnapshot(EMPTY);
    this.#loaded = true;
    await this.#storage.set(ARCHIVE_LIBRARY_KEY, next);
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
    directMessages: arrayOf(raw.directMessages).filter(isDirectMessage),
    media: arrayOf(raw.media).filter(isMediaReference),
    followers: arrayOf(raw.followers).filter(isAccountRef),
    following: arrayOf(raw.following).filter(isAccountRef),
    lists: arrayOf(raw.lists).filter(isList),
    importedJobs: arrayOf(raw.importedJobs).filter((entry): entry is string => typeof entry === "string").slice(-100),
    updatedAt: stringOrNull(raw.updatedAt)
  };
}

function mergeByKey<T>(current: T[], incoming: T[], key: (entry: T) => string): T[] {
  const result = [...current];
  const seen = new Set(current.map(key));
  for (const entry of incoming) {
    const identity = key(entry);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(entry);
  }
  return result.slice(-10_000);
}

function cloneSnapshot(snapshot: ArchiveLibrarySnapshot): ArchiveLibrarySnapshot {
  return {
    ...snapshot,
    profile: snapshot.profile ? { ...snapshot.profile } : null,
    account: snapshot.account ? { ...snapshot.account } : null,
    directMessages: snapshot.directMessages.map((entry) => ({ ...entry, recipientIds: [...entry.recipientIds], mediaUrls: [...entry.mediaUrls] })),
    media: snapshot.media.map((entry) => ({ ...entry })),
    followers: snapshot.followers.map((entry) => ({ ...entry })),
    following: snapshot.following.map((entry) => ({ ...entry })),
    lists: snapshot.lists.map((entry) => ({ ...entry, memberIds: [...entry.memberIds], subscriberIds: [...entry.subscriberIds] })),
    importedJobs: [...snapshot.importedJobs]
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

function isMediaReference(value: unknown): value is ArchiveMediaReference {
  return isRecord(value) && typeof value.sourceFile === "string";
}

function isAccountRef(value: unknown): value is ArchiveAccountRef {
  return isRecord(value) && typeof value.sourceFile === "string";
}

function isList(value: unknown): value is ArchiveList {
  return isRecord(value) && Array.isArray(value.memberIds) && Array.isArray(value.subscriberIds);
}
