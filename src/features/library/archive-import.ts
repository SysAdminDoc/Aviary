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

/**
 * Which shape of X export this is.
 *
 * X's archive has changed by accretion rather than by version, so the only way to know what a file
 * set can contain is to recognise its layout. Three exist in the wild:
 *
 *   `current`    `data/tweets.js` (or `tweets-part1.js`), with the four direct-message files.
 *   `tweet-js`   `data/tweet.js`, roughly 2020 and earlier. No direct-message files at all.
 *   `grailbird`  pre-2018. `data/js/tweets/YYYY_MM.js`, one file per month, assigned to
 *                `Grailbird.data.tweets_YYYY_MM`, with `data/js/user_details.js` beside them.
 *
 * Verified against a published Grailbird archive: `data/js/tweets/2011_08.js` opens
 * `Grailbird.data.tweets_2011_08 = ` and its tweet objects carry `id_str`, `text`, `created_at`
 * and `user`, which is what the tweet mapper already reads.
 */
export type ArchiveVintage = "current" | "tweet-js" | "grailbird";

/**
 * What each vintage cannot contain, so an empty collection is reported as impossible rather than
 * as empty.
 *
 * Three separate third-party importers had the same bug open in 2026: they read an older archive,
 * found no direct messages, and told the user they had none. The archive never had a place to put
 * them.
 */
export const ARCHIVE_VINTAGE_ABSENT: Record<ArchiveVintage, readonly ArchiveCollectionName[]> = {
  current: [],
  "tweet-js": ["direct-messages"],
  grailbird: ["direct-messages", "likes", "lists", "followers", "following"]
};

/**
 * Newer beats older when the same post arrives twice.
 *
 * A current export carries fields the older shapes never had, so a re-import of a newer archive
 * supersedes what an older one wrote for the same canonical post id rather than merging into it.
 */
export function archiveVintageRank(vintage: ArchiveVintage): number {
  return vintage === "current" ? 3 : vintage === "tweet-js" ? 2 : 1;
}

/** The layout a file set is, read from the names alone. `null` means none of the three. */
export function classifyArchiveVintage(filenames: readonly string[]): ArchiveVintage | null {
  const lower = filenames.map((name) => name.toLowerCase());
  if (lower.some((name) => GRAILBIRD_TWEETS.test(name))) return "grailbird";
  if (lower.some((name) => /(?:^|\/)tweets(?:-part\d+)?\.js$/.test(name))) return "current";
  if (lower.some((name) => /(?:^|\/)tweet\.js$/.test(name))) return "tweet-js";
  return null;
}

const GRAILBIRD_TWEETS = /(?:^|\/)js\/tweets\/\d{4}_\d{2}\.js$/;

export interface ArchiveFileReport {
  filename: string;
  collection: ArchiveCollectionName;
  status: "parsed" | "malformed";
  records: number;
}

export interface ArchiveImportResult {
  /** The layout this file set was recognised as. `null` when it matched none and nothing ran. */
  vintage: ArchiveVintage | null;
  /** Collections this vintage has no place for, so "none found" is not reported as "you had none". */
  collectionsAbsent: readonly ArchiveCollectionName[];
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
    vintage: null,
    collectionsAbsent: [],
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
    return {
      vintage: null,
      collectionsAbsent: [],
      records, collections, warnings, errors, filesParsed, recognizedFiles, skippedFiles, malformedFiles, repairs
    };
  }

  // Recognise the layout before reading anything. An unrecognised file set is refused whole rather
  // than half-imported: a partial library built from a shape nobody identified is worse than no
  // import, because nothing afterwards can tell which half arrived.
  const vintage = classifyArchiveVintage(entries.map((entry) => entry.filename));
  if (vintage === null) {
    const found = entries.map((entry) => entry.filename).slice(0, 20);
    errors.push(
      "This does not look like an X archive. Expected data/tweets.js, data/tweet.js, or " +
        `data/js/tweets/YYYY_MM.js. Found: ${found.join(", ")}${entries.length > found.length ? ", …" : ""}`
    );
    return {
      vintage: null,
      collectionsAbsent: [],
      records, collections, warnings, errors, filesParsed, recognizedFiles,
      skippedFiles: entries.map((entry) => entry.filename),
      malformedFiles, repairs
    };
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
    const count = appendCollection(collections, collection, parsed, entry.filename, surface, records, vintage);
    recognizedFiles.push({ filename: entry.filename, collection, status: "parsed", records: count });
  }

  repairs = repairIndex.repair(records, collections);
  // One archive is one vintage, but a file set can still list the same post twice -- a monthly
  // Grailbird file overlapping the next, or a re-exported part. Keep one record per canonical id.
  const deduped = dedupeByCanonicalId(records);
  records.length = 0;
  records.push(...deduped);
  return {
    vintage,
    collectionsAbsent: ARCHIVE_VINTAGE_ABSENT[vintage],
    records, collections, warnings, errors, filesParsed, recognizedFiles, skippedFiles, malformedFiles, repairs
  };
}

/**
 * One record per canonical post id, keeping the one from the newer vintage.
 *
 * Exported so a library merging a second import can apply the same rule: re-importing a current
 * export over a Grailbird one has to supersede those posts, not sit beside them. A record with no
 * id cannot be matched to anything and is always kept.
 */
export function dedupeByCanonicalId(records: readonly ExportRecord[]): ExportRecord[] {
  const byId = new Map<string, ExportRecord>();
  const unmatched: ExportRecord[] = [];
  for (const record of records) {
    if (!record.tweetId) {
      unmatched.push(record);
      continue;
    }
    const existing = byId.get(record.tweetId);
    if (!existing) {
      byId.set(record.tweetId, record);
      continue;
    }
    const existingRank = existing.archiveVintage ? archiveVintageRank(existing.archiveVintage) : 0;
    const incomingRank = record.archiveVintage ? archiveVintageRank(record.archiveVintage) : 0;
    if (incomingRank > existingRank) byId.set(record.tweetId, record);
  }
  return [...byId.values(), ...unmatched];
}

function classifyArchiveFile(name: string): ArchiveCollectionName | null {
  // Grailbird splits the timeline into one file per month. `tweet_index.js` is a table of contents
  // for those files and carries no posts, so it is skipped rather than parsed as a collection.
  if (GRAILBIRD_TWEETS.test(name)) return "authored-posts";
  if (/(?:^|\/)js\/user_details\.js$/.test(name)) return "profile";
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
  records: ExportRecord[],
  vintage: ArchiveVintage
): number {
  if (collection === "authored-posts") {
    const mapped = mapTweets(parsed, surface).map((record) => ({ ...record, archiveVintage: vintage }));
    records.push(...mapped);
    return mapped.length;
  }
  if (collection === "likes") {
    const mapped = mapLikes(parsed, surface).map((record) => ({ ...record, archiveVintage: vintage }));
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
  //
  // Two older shapes, both anchored the same way. Grailbird writes
  // `Grailbird.data.tweets_2011_08 = ` at the head of each monthly file, and its side files use
  // `var user_details = {…};`. Both were verified against a published Grailbird archive rather
  // than assumed.
  const match =
    /^\s*(?:window\.)?YTD(?:\.[A-Za-z0-9_$]+)*\s*=\s*/.exec(text) ??
    /^\s*Grailbird(?:\.[A-Za-z0-9_$]+)*\s*=\s*/.exec(text) ??
    /^\s*var\s+[A-Za-z0-9_$]+\s*=\s*/.exec(text);
  const body = match ? text.slice(match[0].length) : text;
  // `var user_details = { … };` ends in a semicolon that JSON.parse will not accept.
  return body.replace(/;\s*$/, "");
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
