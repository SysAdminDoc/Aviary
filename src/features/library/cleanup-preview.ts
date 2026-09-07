import type { ExportRecord } from "../export/types.ts";

export type CleanupBucket = "tweets" | "retweets" | "replies" | "likes" | "bookmarks";

export interface CleanupCandidate {
  bucket: CleanupBucket;
  tweetId: string | null;
  handle: string | null;
  text: string;
  permalink: string | null;
  reason: string;
  protected: boolean;
  /**
   * Stored bytes this record's captured media occupies, summed from the byte lengths the capture
   * recorded. Zero where nothing was byte-captured, which is most of a text library.
   */
  storedBytes: number;
}

export interface CleanupPreview {
  generatedAt: string;
  candidates: CleanupCandidate[];
  byBucket: Record<CleanupBucket, number>;
  protectedCount: number;
  /**
   * What removing the unprotected candidates would free, and which of them are the heavy ones.
   *
   * "Delete 4,812 posts" is not a decision anybody can make. "These twelve hold 1.4 GB between
   * them" is, and it is usually a much smaller deletion.
   */
  storedBytes: number;
  freeableBytes: number;
  largest: CleanupCandidate[];
}

export interface CleanupPreviewOptions {
  whitelistHandles?: readonly string[];
  protectedTweetIds?: readonly string[];
  minLikeThreshold?: number;
  bucketHint?: CleanupBucket;
  /** How many of the heaviest records to name. */
  largestCount?: number;
}

/** Stored bytes one record's captured media occupies. Reference-only media weighs nothing here. */
export function recordStoredBytes(record: ExportRecord): number {
  let total = 0;
  for (const entry of record.media ?? []) {
    if (entry.captureStatus !== "captured-bytes") continue;
    const bytes = entry.byteLength;
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) total += Math.round(bytes);
  }
  return total;
}

export function previewCleanup(
  records: readonly ExportRecord[],
  options: CleanupPreviewOptions = {}
): CleanupPreview {
  const whitelist = new Set((options.whitelistHandles ?? []).map((h) => h.toLowerCase()));
  const protectedIds = new Set(options.protectedTweetIds ?? []);
  const byBucket: Record<CleanupBucket, number> = {
    tweets: 0,
    retweets: 0,
    replies: 0,
    likes: 0,
    bookmarks: 0
  };
  let protectedCount = 0;

  const candidates: CleanupCandidate[] = [];
  for (const record of records) {
    const bucket = classify(record, options.bucketHint);
    if (!bucket) continue;

    const handle = record.handle?.toLowerCase() ?? null;
    const isProtected =
      (record.tweetId !== null && protectedIds.has(record.tweetId)) ||
      (handle !== null && whitelist.has(handle));

    if (isProtected) {
      protectedCount += 1;
    }

    byBucket[bucket] += 1;
    candidates.push({
      bucket,
      tweetId: record.tweetId,
      handle: record.handle,
      text: record.text,
      permalink: record.permalink,
      reason: explain(bucket, record, wasInferred(bucket, record, options.bucketHint)),
      protected: isProtected,
      storedBytes: recordStoredBytes(record)
    });
  }

  const storedBytes = candidates.reduce((total, entry) => total + entry.storedBytes, 0);
  // Only the unprotected ones can be freed. Counting a protected record's bytes as recoverable
  // would promise space that this preview refuses to touch.
  const freeableBytes = candidates
    .filter((entry) => !entry.protected)
    .reduce((total, entry) => total + entry.storedBytes, 0);
  const largest = [...candidates]
    .filter((entry) => entry.storedBytes > 0)
    .sort((left, right) =>
      right.storedBytes - left.storedBytes ||
      (left.tweetId ?? "").localeCompare(right.tweetId ?? ""))
    .slice(0, Math.max(0, options.largestCount ?? 10));

  return {
    storedBytes,
    freeableBytes,
    largest,
    generatedAt: new Date().toISOString(),
    candidates,
    byBucket,
    protectedCount
  };
}

/**
 * What kind of post this is, from the record rather than from how its text happens to start.
 *
 * The archive import already fills `parentId` from `in_reply_to_status_id_str`, and this ignored
 * it in favour of reading the first character of the text. A post that merely opens with a handle
 * was bucketed and explained as a reply; a real reply that opens with a word was reported as an
 * original post; a post quoting the string "RT @foo" became a repost. These counts go into the
 * downloadable report, stated as fact.
 *
 * The text heuristic is still there, because an archive from before that field existed has nothing
 * else to go on -- but a guess is now marked as a guess, and the field wins wherever it is present.
 */
function classify(record: ExportRecord, hint?: CleanupBucket): CleanupBucket | null {
  if (hint) return hint;
  if (record.surface.includes("likes")) return "likes";
  if (record.surface.includes("bookmarks")) return "bookmarks";
  if (record.parentId != null && record.parentId !== "") return "replies";
  if (record.text.startsWith("RT @") || record.text.startsWith("Reposted ")) return "retweets";
  if (record.text.startsWith("@")) return "replies";
  return "tweets";
}

/** True when the bucket came from the text rather than from a field that states it. */
function wasInferred(bucket: CleanupBucket, record: ExportRecord, hint?: CleanupBucket): boolean {
  if (hint) return false;
  if (record.surface.includes("likes") || record.surface.includes("bookmarks")) return false;
  if (bucket === "replies") return record.parentId == null || record.parentId === "";
  return bucket === "retweets";
}

function explain(bucket: CleanupBucket, record: ExportRecord, inferred = false): string {
  switch (bucket) {
    case "retweets":
      return inferred
        ? "Looks like reposted content, from how the text begins"
        : "Reposted content, author retains the original";
    case "replies":
      return inferred
        ? "Looks like a reply, from how the text begins"
        : "Reply to another account";
    case "likes":
      return "Imported from Likes archive";
    case "bookmarks":
      return "Imported from Bookmarks archive";
    case "tweets":
    default:
      return record.tweetId ? `Original post ${record.tweetId}` : "Original post";
  }
}
