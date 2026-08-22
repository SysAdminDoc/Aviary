import type { CapturedBookmarkInput } from "./bookmarks.ts";

const MAX_NODES = 25_000;
const MAX_TEXT = 20_000;

/** X uses several names for the bookmark timeline and folder queries across web releases. */
export function isBookmarkOperation(operationName: string, url = ""): boolean {
  return /bookmark/i.test(operationName) || /bookmark/i.test(url);
}

/**
 * Reads tweet objects from a bookmark GraphQL response. This intentionally accepts only data X
 * sent to the page. It never calls X, follows media URLs, or asks the API for missing fields.
 */
export function parseCapturedBookmarks(
  body: string,
  operationName: string,
  capturedAt: string,
  url = ""
): CapturedBookmarkInput[] {
  if (!isBookmarkOperation(operationName, url) || body.length === 0) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }
  const fallback = validTimestamp(capturedAt) ?? new Date().toISOString();
  const found = new Map<string, CapturedBookmarkInput>();
  let visited = 0;

  const visit = (value: unknown, inheritedTimestamp: string | null): void => {
    if (visited >= MAX_NODES || value === null || typeof value !== "object") return;
    visited += 1;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inheritedTimestamp);
      return;
    }
    const record = value as Record<string, unknown>;
    const timestamp = findBookmarkTimestamp(record) ?? inheritedTimestamp;
    const candidate = readTweet(record, timestamp ?? fallback, operationName);
    if (candidate) {
      const previous = found.get(candidate.tweetId);
      if (
        !previous ||
        previous.capturedAt < candidate.capturedAt ||
        (previous.capturedAt === candidate.capturedAt && !previous.handle && Boolean(candidate.handle))
      ) {
        found.set(candidate.tweetId, candidate);
      }
    }
    for (const [key, child] of Object.entries(record)) {
      // Tweet text can contain large entity objects. Traversing the object is bounded above, and
      // ignoring primitive values keeps the parser focused on the response tree itself.
      if (child !== null && typeof child === "object") {
        visit(child, timestamp);
      }
      if (key === "tweet_results" && child && typeof child === "object") {
        visit((child as Record<string, unknown>).result, timestamp);
      }
    }
  };

  visit(payload, null);
  return [...found.values()].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

function readTweet(
  value: Record<string, unknown>,
  fallbackTimestamp: string,
  operationName: string
): CapturedBookmarkInput | null {
  const legacy = asRecord(value.legacy);
  const tweetId = cleanId(value.rest_id) ?? cleanId(legacy?.id_str) ?? cleanId(value.id_str);
  const text = cleanText(legacy?.full_text) ?? cleanText(legacy?.text) ?? cleanText(value.text) ?? "";
  if (!tweetId) return null;
  // User objects also have id_str. A tweet-like object has the legacy text field, or the
  // GraphQL core/tweet result shape that carries a tweet's user relationship.
  if (!legacy && !value.core && !value.tweet_results && !value.conversation_id_str) return null;
  const user = findUser(value, legacy);
  const handle = cleanHandle(user?.screen_name ?? user?.screenName);
  const capturedAt = findBookmarkTimestamp(value) ?? findBookmarkTimestamp(legacy) ?? fallbackTimestamp;
  return {
    tweetId,
    handle,
    text,
    url: `https://x.com/${handle ?? "i"}/status/${tweetId}`,
    capturedAt,
    sourceOperation: operationName
  };
}

function findUser(value: Record<string, unknown>, legacy: Record<string, unknown> | null): Record<string, unknown> | null {
  const core = asRecord(value.core);
  const userResults = asRecord(core?.user_results);
  const result = asRecord(userResults?.result);
  const coreLegacy = asRecord(result?.legacy);
  return coreLegacy ?? asRecord(legacy?.user) ?? asRecord(value.user) ?? result;
}

function findBookmarkTimestamp(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  const keys = [
    "bookmark_created_at",
    "bookmarked_at",
    "saved_at",
    "bookmarkAt",
    "savedAt"
  ];
  for (const key of keys) {
    const candidate = timestampValue(value[key]);
    if (candidate) return candidate;
  }
  return null;
}

function timestampValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? validTimestamp(date.toISOString()) : null;
  }
  return typeof value === "string" ? validTimestamp(value) : null;
}

function validTimestamp(value: string): string | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return /^[0-9]{1,64}$/.test(cleaned) ? cleaned : null;
}

function cleanHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, MAX_TEXT);
  return cleaned.length > 0 ? cleaned : null;
}
