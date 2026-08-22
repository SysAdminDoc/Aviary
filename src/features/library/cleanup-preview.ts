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
}

export interface CleanupPreview {
  generatedAt: string;
  candidates: CleanupCandidate[];
  byBucket: Record<CleanupBucket, number>;
  protectedCount: number;
}

export interface CleanupPreviewOptions {
  whitelistHandles?: readonly string[];
  protectedTweetIds?: readonly string[];
  minLikeThreshold?: number;
  bucketHint?: CleanupBucket;
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
      reason: explain(bucket, record),
      protected: isProtected
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    candidates,
    byBucket,
    protectedCount
  };
}

function classify(record: ExportRecord, hint?: CleanupBucket): CleanupBucket | null {
  if (hint) return hint;
  if (record.surface.includes("likes")) return "likes";
  if (record.surface.includes("bookmarks")) return "bookmarks";
  if (record.text.startsWith("RT @") || record.text.startsWith("Reposted ")) return "retweets";
  if (record.text.startsWith("@")) return "replies";
  return "tweets";
}

function explain(bucket: CleanupBucket, record: ExportRecord): string {
  switch (bucket) {
    case "retweets":
      return "Reposted content — author retains the original";
    case "replies":
      return "Reply to another account";
    case "likes":
      return "Imported from Likes archive";
    case "bookmarks":
      return "Imported from Bookmarks archive";
    case "tweets":
    default:
      return record.tweetId ? `Original post ${record.tweetId}` : "Original post";
  }
}
