import { canInflate, readZip, readZipSource, type ZipByteSource } from "../export/zip-reader.ts";
import type { ExportRecord } from "../export/types.ts";
import {
  emptyArchiveCollections,
  emptyArchiveRepairSummary,
  type ArchiveAccount,
  type ArchiveAccountRef,
  type ArchiveCollections,
  type ArchiveDirectMessage,
  type ArchiveList,
  type ArchiveMediaReference,
  type ArchiveProfile,
  type ArchiveRepairSummary
} from "./archive-types.ts";
import {
  ArchiveRepairIndex,
  buildArchiveParticipant,
  buildMentionParticipant
} from "./archive-repair.ts";
import { normalizePostLanguage } from "../export/language.ts";

export type ArchiveCollectionName =
  | "authored-posts"
  | "likes"
  | "direct-messages"
  | "media"
  | "followers"
  | "following"
  | "lists"
  | "profile"
  | "account";

export interface ArchiveFileReport {
  filename: string;
  collection: ArchiveCollectionName;
  status: "parsed" | "malformed";
  records: number;
}

export interface ArchiveImportResult {
  records: ExportRecord[];
  collections: ArchiveCollections;
  warnings: string[];
  errors: string[];
  filesParsed: string[];
  recognizedFiles: ArchiveFileReport[];
  skippedFiles: string[];
  malformedFiles: string[];
  repairs: ArchiveRepairSummary;
}

const TEXT_DECODER = new TextDecoder();
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export async function importOfficialArchive(
  buffer: Uint8Array,
  surface = "archive",
  localCorpus: readonly ExportRecord[] = []
): Promise<ArchiveImportResult> {
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) {
    return archiveImportError("Archive exceeds the 256 MiB input limit.");
  }
  try {
    return importArchiveEntries(await readZip(buffer), surface, localCorpus);
  } catch (error) {
    return archiveImportError((error as Error).message);
  }
}

/** Import a staged archive through bounded random reads rather than a whole-file byte array. */
export async function importOfficialArchiveFromSource(
  source: ZipByteSource,
  surface = "archive",
  localCorpus: readonly ExportRecord[] = [],
  options: { shouldContinue?: () => boolean | Promise<boolean> } = {}
): Promise<ArchiveImportResult> {
  if (source.size > MAX_ARCHIVE_BYTES) {
    return archiveImportError("Archive exceeds the 256 MiB input limit.");
  }
  try {
    return importArchiveEntries(
      await readZipSource(source, options.shouldContinue ? { shouldContinue: options.shouldContinue } : {}),
      surface,
      localCorpus,
      options.shouldContinue
    );
  } catch (error) {
    return archiveImportError((error as Error).message);
  }
}

function archiveImportError(message: string): ArchiveImportResult {
  return {
    records: [],
    collections: emptyArchiveCollections(),
    warnings: [],
    errors: [message],
    filesParsed: [],
    recognizedFiles: [],
    skippedFiles: [],
    malformedFiles: [],
    repairs: emptyArchiveRepairSummary()
  };
}

async function importArchiveEntries(
  entries: Awaited<ReturnType<typeof readZip>>,
  surface: string,
  localCorpus: readonly ExportRecord[],
  shouldContinue?: () => boolean | Promise<boolean>
): Promise<ArchiveImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const filesParsed: string[] = [];
  const records: ExportRecord[] = [];
  const collections = emptyArchiveCollections();
  const recognizedFiles: ArchiveFileReport[] = [];
  const skippedFiles: string[] = [];
  const malformedFiles: string[] = [];
  const repairIndex = new ArchiveRepairIndex(localCorpus);
  let repairs = emptyArchiveRepairSummary();
  if (entries.length === 0) {
    errors.push(
      canInflate()
        ? "Archive contained no readable entries."
        : "This browser cannot decompress archives (DecompressionStream is unavailable)."
    );
    return { records, collections, warnings, errors, filesParsed, recognizedFiles, skippedFiles, malformedFiles, repairs };
  }

  for (const entry of entries) {
    if (shouldContinue && !(await shouldContinue())) break;
    const lower = entry.filename.toLowerCase();
    const collection = classifyArchiveFile(lower);
    if (!collection) {
      skippedFiles.push(entry.filename);
      continue;
    }
    if (!entry.crcOk) {
      warnings.push(`${entry.filename}: CRC32 mismatch, proceeding best effort.`);
    }
    const text = safeDecode(entry.data, errors, entry.filename);
    if (!text) continue;
    filesParsed.push(entry.filename);
    const payload = stripPrefix(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      warnings.push(`${entry.filename}: JSON parse failed (${(error as Error).message})`);
      malformedFiles.push(entry.filename);
      recognizedFiles.push({ filename: entry.filename, collection, status: "malformed", records: 0 });
      continue;
    }
    repairIndex.ingestArchivePayload(parsed);
    const count = appendCollection(collections, collection, parsed, entry.filename, surface, records);
    recognizedFiles.push({ filename: entry.filename, collection, status: "parsed", records: count });
  }

  repairs = repairIndex.repair(records, collections);
  return { records, collections, warnings, errors, filesParsed, recognizedFiles, skippedFiles, malformedFiles, repairs };
}

function classifyArchiveFile(name: string): ArchiveCollectionName | null {
  if (/(?:^|\/)tweets(?:-part\d+)?\.js$/.test(name) || /(?:^|\/)tweet\.js$/.test(name)) return "authored-posts";
  if (/(?:^|\/)(?:like|likes|liked-tweets)\.js$/.test(name)) return "likes";
  if (/(?:^|\/)(?:direct-messages|direct_messages|dm|dms)\.js$/.test(name)) return "direct-messages";
  if (/(?:^|\/)media(?:\/|\.js$)/.test(name)) return "media";
  if (/(?:^|\/)followers?\.js$/.test(name)) return "followers";
  if (/(?:^|\/)following\.js$/.test(name)) return "following";
  if (/(?:^|\/)lists?\.js$/.test(name)) return "lists";
  if (/(?:^|\/)profile\.js$/.test(name)) return "profile";
  if (/(?:^|\/)account\.js$/.test(name)) return "account";
  return null;
}

function appendCollection(
  collections: ArchiveCollections,
  collection: ArchiveCollectionName,
  parsed: unknown,
  filename: string,
  surface: string,
  records: ExportRecord[]
): number {
  if (collection === "authored-posts") {
    const mapped = mapTweets(parsed, surface);
    records.push(...mapped);
    return mapped.length;
  }
  if (collection === "likes") {
    const mapped = mapLikes(parsed, surface);
    records.push(...mapped);
    return mapped.length;
  }
  if (collection === "direct-messages") {
    const mapped = mapDirectMessages(parsed);
    collections.directMessages.push(...mapped);
    return mapped.length;
  }
  if (collection === "media") {
    const mapped = mapMediaReferences(parsed, filename);
    collections.media.push(...mapped);
    return mapped.length;
  }
  if (collection === "followers" || collection === "following") {
    const mapped = mapAccountRefs(parsed, filename);
    collections[collection].push(...mapped);
    return mapped.length;
  }
  if (collection === "lists") {
    const mapped = mapLists(parsed);
    collections.lists.push(...mapped);
    return mapped.length;
  }
  if (collection === "profile") {
    const mapped = mapProfile(parsed);
    if (mapped) collections.profile = mapped;
    return mapped ? 1 : 0;
  }
  const mapped = mapAccount(parsed);
  if (mapped) collections.account = mapped;
  return mapped ? 1 : 0;
}

function mapDirectMessages(parsed: unknown): ArchiveDirectMessage[] {
  const out: ArchiveDirectMessage[] = [];
  for (const entry of arrayEntries(parsed)) {
    const root = unwrapRecord(entry, ["dmConversation", "conversation"]);
    const conversationId = stringField(root, "conversationId", "id");
    const messages = Array.isArray(root.messages) ? root.messages : [root];
    for (const candidate of messages) {
      const message = unwrapRecord(candidate, ["messageCreate", "message"]);
      const text = stringField(message, "text", "full_text") ?? "";
      const id = stringField(message, "id", "id_str");
      if (!id && text.length === 0) continue;
      const senderId = stringField(message, "senderId", "sender_id");
      const recipientIds = [
        ...stringArrayField(message, "recipientIds", "recipient_ids"),
        ...[stringField(message, "recipientId", "recipient_id") ?? ""].filter(Boolean)
      ].slice(0, 1000);
      out.push({
        id,
        conversationId,
        senderId,
        recipientIds,
        text,
        createdAt: stringField(message, "createdAt", "created_at"),
        mediaUrls: stringArrayField(message, "mediaUrls", "media_urls")
          .filter(isHttpUrl),
        sender: senderId ? buildArchiveParticipant(senderId) : null,
        recipients: recipientIds.map((recipientId) => buildArchiveParticipant(recipientId))
      });
    }
  }
  return out;
}

function mapMediaReferences(parsed: unknown, sourceFile: string): ArchiveMediaReference[] {
  const out: ArchiveMediaReference[] = [];
  for (const entry of arrayEntries(parsed)) {
    const media = unwrapRecord(entry, ["media", "mediaEntity", "uploadMedia"]);
    const url = stringField(media, "url", "mediaUrl", "media_url");
    const urls = stringArrayField(media, "urls", "mediaUrls", "media_urls");
    const candidates = [url, ...urls].filter((candidate): candidate is string => Boolean(candidate));
    if (candidates.length === 0 && !stringField(media, "id", "id_str")) continue;
    out.push({
      id: stringField(media, "id", "id_str", "mediaId"),
      tweetId: stringField(media, "tweetId", "tweet_id", "statusId"),
      url: candidates.find(isHttpUrl) ?? null,
      filename: stringField(media, "filename", "name"),
      mimeType: stringField(media, "mimeType", "mime_type", "type"),
      sourceFile
    });
  }
  return out;
}

function mapAccountRefs(parsed: unknown, sourceFile: string): ArchiveAccountRef[] {
  const out: ArchiveAccountRef[] = [];
  for (const entry of arrayEntries(parsed)) {
    const account = unwrapRecord(entry, ["account", "user", "follower", "following"]);
    const id = stringField(account, "accountId", "account_id", "id", "id_str");
    const handle = stringField(account, "userLink", "screen_name", "username", "handle")
      ?.replace(/^https?:\/\/(?:x|twitter)\.com\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0] ?? null;
    const displayName = stringField(account, "displayName", "name", "full_name");
    if (!id && !handle && !displayName) continue;
    out.push({ id, handle, displayName, sourceFile });
  }
  return out;
}

function mapLists(parsed: unknown): ArchiveList[] {
  const out: ArchiveList[] = [];
  for (const entry of arrayEntries(parsed)) {
    const list = unwrapRecord(entry, ["list", "lists-list"]);
    if (!stringField(list, "id", "id_str", "listId") && !stringField(list, "name")) continue;
    out.push({
      id: stringField(list, "id", "id_str", "listId"),
      name: stringField(list, "name", "fullName"),
      description: stringField(list, "description"),
      memberIds: stringArrayField(list, "memberIds", "member_ids"),
      subscriberIds: stringArrayField(list, "subscriberIds", "subscriber_ids")
    });
  }
  return out;
}

function mapProfile(parsed: unknown): ArchiveProfile | null {
  const profile = unwrapRecord(arrayEntries(parsed)[0], ["profile", "user"]);
  if (Object.keys(profile).length === 0) return null;
  return {
    handle: stringField(profile, "screenName", "screen_name", "username", "handle"),
    displayName: stringField(profile, "displayName", "name", "full_name"),
    bio: stringField(profile, "bio", "description"),
    location: stringField(profile, "location"),
    website: stringField(profile, "website", "url"),
    joinedAt: stringField(profile, "createdAt", "created_at")
  };
}

function mapAccount(parsed: unknown): ArchiveAccount | null {
  const account = unwrapRecord(arrayEntries(parsed)[0], ["account", "user"]);
  if (Object.keys(account).length === 0) return null;
  return {
    id: stringField(account, "accountId", "account_id", "id", "id_str"),
    handle: stringField(account, "screenName", "screen_name", "username", "handle"),
    displayName: stringField(account, "displayName", "name", "full_name"),
    email: stringField(account, "email", "emailAddress")
  };
}

function arrayEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    for (const candidate of Object.values(value)) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [value];
  }
  return [];
}

function unwrapRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  for (const key of keys) {
    if (isRecord(value[key])) return value[key];
  }
  return value;
}

function stringArrayField(record: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    return value
      .flatMap((entry) => {
        if (typeof entry === "string") return [entry];
        if (isRecord(entry)) return [stringField(entry, "id", "id_str", "url") ?? ""];
        return [];
      })
      .filter((entry) => entry.length > 0)
      .slice(0, 1000);
  }
  return [];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function safeDecode(data: Uint8Array, errors: string[], filename: string): string | null {
  try {
    return TEXT_DECODER.decode(data);
  } catch (error) {
    errors.push(`${filename}: decode failed (${(error as Error).message})`);
    return null;
  }
}

function stripPrefix(text: string): string {
  // X archives prefix entries with `window.YTD.tweets.partN = ` to make the file a valid JS
  // expression. Anchored to that shape on purpose: `^[^=]*=` consumed everything up to the first
  // `=` anywhere in the file, so an un-prefixed pure-JSON export containing base64 padding or a
  // query string had its opening destroyed and was then reported as malformed.
  const match = /^\s*(?:window\.)?YTD(?:\.[A-Za-z0-9_$]+)*\s*=\s*/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

function mapTweets(parsed: unknown, surface: string): ExportRecord[] {
  if (!Array.isArray(parsed)) return [];
  const now = new Date().toISOString();
  const out: ExportRecord[] = [];
  for (const entry of parsed) {
    const tweet = isRecord(entry) && isRecord(entry.tweet) ? entry.tweet : entry;
    if (!isRecord(tweet)) continue;
    const id = stringField(tweet, "id_str", "id");
    const text = stringField(tweet, "full_text", "text") ?? "";
    const createdAt = stringField(tweet, "created_at") ?? now;
    const record: ExportRecord = {
      tweetId: id,
      handle: stringFromAuthor(tweet) ?? null,
      displayName: null,
      text,
      // The import time, not the post's. `capturedAt` is what warc.ts writes into WARC-Date and
      // what wacz.ts derives the CDXJ timestamp from, and those describe when the record was
      // captured -- so putting X's `created_at` here made a signed archive assert a capture instant
      // that never happened. types.ts states the split; `createdAt` below carries the authored time.
      capturedAt: now,
      surface,
      media: [],
      permalink: id ? `https://x.com/i/web/status/${id}` : null,
      language: normalizePostLanguage(stringField(tweet, "lang", "language")),
      audience: "unknown"
    };
    const conversationId = stringField(tweet, "conversation_id_str", "conversationId");
    const parentId = stringField(tweet, "in_reply_to_status_id_str", "inReplyToId", "in_reply_to_id");
    const authorId = stringField(tweet, "user_id_str", "user_id", "author_id", "authorId");
    if (conversationId) {
      record.conversationId = conversationId;
      record.rootId = conversationId;
    }
    if (parentId) record.parentId = parentId;
    if (authorId) record.authorId = authorId;
    // Normalized so every consumer sees one format. X's archive writes "Tue Jan 16 12:00:00 +0000
    // 2026", which is not a valid HTML datetime and mixed formats in the exported columns.
    const authoredAt = new Date(createdAt);
    if (!Number.isNaN(authoredAt.getTime())) record.createdAt = authoredAt.toISOString();
    const participants = mentionParticipants(tweet);
    if (participants.length > 0) record.participants = participants;
    out.push(record);
  }
  return out;
}

function mapLikes(parsed: unknown, surface: string): ExportRecord[] {
  if (!Array.isArray(parsed)) return [];
  const out: ExportRecord[] = [];
  for (const entry of parsed) {
    const like = isRecord(entry) && isRecord(entry.like) ? entry.like : entry;
    if (!isRecord(like)) continue;
    const id = stringField(like, "tweetId", "id");
    const text = stringField(like, "fullText", "text") ?? "";
    const record: ExportRecord = {
      tweetId: id,
      handle: null,
      displayName: null,
      text,
      capturedAt: new Date().toISOString(),
      surface: `${surface}.likes`,
      media: [],
      permalink: id ? `https://x.com/i/web/status/${id}` : null,
      language: normalizePostLanguage(stringField(like, "lang", "language")),
      audience: "unknown"
    };
    const participants = mentionParticipants(like);
    if (participants.length > 0) record.participants = participants;
    out.push(record);
  }
  return out;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function stringFromAuthor(tweet: Record<string, unknown>): string | null {
  const user = tweet.user;
  if (isRecord(user)) {
    const author = stringField(user, "screen_name", "username", "handle");
    if (author) {
      return author;
    }
  }
  return null;
}

function mentionParticipants(tweet: Record<string, unknown>): NonNullable<ExportRecord["participants"]> {
  const entities = isRecord(tweet.entities) ? tweet.entities : null;
  const mentions = Array.isArray(entities?.user_mentions) ? entities.user_mentions : [];
  const participants = new Map<string, NonNullable<ExportRecord["participants"]>[number]>();
  for (const candidate of mentions) {
    if (!isRecord(candidate)) continue;
    const id = stringField(candidate, "id_str", "id", "user_id", "userId");
    if (!id) continue;
    participants.set(
      id,
      buildMentionParticipant(
        id,
        stringField(candidate, "screen_name", "screenName", "username", "handle")
      )
    );
  }
  return [...participants.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
