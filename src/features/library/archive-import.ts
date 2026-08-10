import { canInflate, readZip } from "../export/zip-reader";
import type { ExportRecord } from "../export/types";

export interface ArchiveImportResult {
  records: ExportRecord[];
  warnings: string[];
  errors: string[];
  filesParsed: string[];
}

const TEXT_DECODER = new TextDecoder();
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export async function importOfficialArchive(
  buffer: Uint8Array,
  surface = "archive"
): Promise<ArchiveImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const filesParsed: string[] = [];
  const records: ExportRecord[] = [];
  if (buffer.byteLength > MAX_ARCHIVE_BYTES) {
    errors.push("Archive exceeds the 256 MiB input limit.");
    return { records, warnings, errors, filesParsed };
  }
  let entries;
  try {
    entries = await readZip(buffer);
  } catch (error) {
    errors.push((error as Error).message);
    return { records, warnings, errors, filesParsed };
  }
  if (entries.length === 0) {
    errors.push(
      canInflate()
        ? "Archive contained no readable entries."
        : "This browser cannot decompress archives (DecompressionStream is unavailable)."
    );
    return { records, warnings, errors, filesParsed };
  }

  for (const entry of entries) {
    const lower = entry.filename.toLowerCase();
    if (!isInterestingFile(lower)) {
      continue;
    }
    if (!entry.crcOk) {
      warnings.push(`${entry.filename}: CRC32 mismatch — proceeding best effort.`);
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
      continue;
    }
    if (lower.includes("tweets.js") || lower.includes("tweets-part") || lower.endsWith("/tweet.js")) {
      records.push(...mapTweets(parsed, surface));
    } else if (lower.includes("like.js")) {
      records.push(...mapLikes(parsed, surface));
    }
  }

  return { records, warnings, errors, filesParsed };
}

function isInterestingFile(name: string): boolean {
  return (
    name.endsWith("tweets.js") ||
    name.endsWith("tweet.js") ||
    name.includes("tweets-part") ||
    name.endsWith("like.js")
  );
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
  // X archives prefix entries with `window.YTD.tweets.partN = ` to make the file a valid JS expression.
  const match = /^[^=]*=\s*/.exec(text);
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
      handle: stringFromEntities(tweet) ?? null,
      displayName: null,
      text,
      capturedAt: createdAt,
      surface,
      media: [],
      permalink: id ? `https://x.com/i/web/status/${id}` : null
    };
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
      permalink: id ? `https://x.com/i/web/status/${id}` : null
    };
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

function stringFromEntities(tweet: Record<string, unknown>): string | null {
  const entities = tweet.entities;
  if (!isRecord(entities)) return null;
  const userMentions = entities.user_mentions;
  if (!Array.isArray(userMentions) || userMentions.length === 0) return null;
  const first = userMentions[0];
  if (!isRecord(first)) return null;
  return stringField(first, "screen_name");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
