import type { ExportRecord } from "./types.ts";

const MAX_NODES = 30_000;
const MAX_RECORDS = 2_000;
const MAX_TEXT = 20_000;

/**
 * Extracts the post identity fields X already sent in a GraphQL response. This is a parser only:
 * it never follows a permalink, resolves a missing parent, or originates a request.
 */
export function parseCapturedThreadRecords(
  body: string,
  operationName: string,
  capturedAt: string,
  url = ""
): ExportRecord[] {
  void url;
  if (!body.trim()) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return [];
  }

  const fallbackCapturedAt = normalizeTimestamp(capturedAt) ?? new Date().toISOString();
  const found = new Map<string, ExportRecord>();
  let visited = 0;

  const visit = (value: unknown, inheritedCreatedAt: string | null): void => {
    if (visited >= MAX_NODES || value === null || typeof value !== "object") return;
    visited += 1;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inheritedCreatedAt);
      return;
    }
    const record = value as Record<string, unknown>;
    const createdAt = findCreatedAt(record) ?? inheritedCreatedAt;
    const candidate = readTweet(record, fallbackCapturedAt, createdAt, operationName);
    if (candidate?.tweetId) {
      const previous = found.get(candidate.tweetId);
      if (!previous || recordRichness(candidate) > recordRichness(previous)) {
        found.set(candidate.tweetId, candidate);
      }
    }
    for (const child of Object.values(record)) {
      if (child !== null && typeof child === "object") visit(child, createdAt);
    }
  };

  visit(payload, null);
  return [...found.values()]
    .sort((left, right) => timestampValue(left.createdAt ?? left.capturedAt) - timestampValue(right.createdAt ?? right.capturedAt))
    .slice(0, MAX_RECORDS);
}

function readTweet(
  value: Record<string, unknown>,
  capturedAt: string,
  inheritedCreatedAt: string | null,
  operationName: string
): ExportRecord | null {
  const legacy = asRecord(value.legacy);
  const tweetId = cleanId(value.rest_id) ?? cleanId(legacy?.id_str) ?? cleanId(value.id_str);
  const text = cleanText(legacy?.full_text) ?? cleanText(legacy?.text) ?? cleanText(value.text) ?? "";
  if (!tweetId || !looksLikeTweet(value, legacy)) return null;

  const user = findUser(value, legacy);
  const userLegacy = asRecord(user?.legacy);
  const handle = cleanHandle(
    user?.screen_name ?? user?.screenName ?? user?.username ?? userLegacy?.screen_name ?? userLegacy?.screenName ?? value.screen_name ?? value.username
  );
  const displayName = cleanText(user?.name ?? user?.displayName ?? userLegacy?.name ?? userLegacy?.displayName);
  const authorId = cleanId(
    user?.rest_id ?? user?.id_str ?? user?.id ?? legacy?.user_id_str ?? value.author_id ?? value.authorId
  );
  const conversationId = cleanId(
    legacy?.conversation_id_str ?? legacy?.conversationId ?? value.conversation_id_str ?? value.conversationId
  );
  const parentId = cleanId(
    legacy?.in_reply_to_status_id_str ?? legacy?.inReplyToId ?? value.in_reply_to_status_id_str ?? value.inReplyToId ?? value.in_reply_to_id
  );
  const createdAt = normalizeTimestamp(
    legacy?.created_at ?? legacy?.createdAt ?? value.created_at ?? value.createdAt
  ) ?? inheritedCreatedAt;
  const permalink = handle
    ? `https://x.com/${handle}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;

  return {
    tweetId,
    handle,
    displayName,
    text,
    capturedAt,
    surface: `graphql:${safeOperation(operationName)}`,
    media: [],
    permalink,
    ...(conversationId ? { conversationId, rootId: conversationId } : {}),
    ...(parentId ? { parentId } : {}),
    ...(authorId ? { authorId } : {}),
    ...(createdAt ? { createdAt } : {})
  };
}

function looksLikeTweet(value: Record<string, unknown>, legacy: Record<string, unknown> | null): boolean {
  if (legacy && (
    typeof legacy.full_text === "string" ||
    typeof legacy.text === "string" ||
    typeof legacy.conversation_id_str === "string" ||
    typeof legacy.in_reply_to_status_id_str === "string"
  )) return true;
  if (typeof value.full_text === "string" || typeof value.conversation_id_str === "string") return true;
  if (value.note_tweet || value.tweet_results) return true;
  if (value.core && !legacy) return true;
  return typeof value.in_reply_to_status_id_str === "string";
}

function findUser(value: Record<string, unknown>, legacy: Record<string, unknown> | null): Record<string, unknown> | null {
  const core = asRecord(value.core);
  const userResults = asRecord(core?.user_results);
  const result = asRecord(userResults?.result);
  const resultLegacy = asRecord(result?.legacy);
  return result ?? asRecord(legacy?.user) ?? asRecord(value.user) ?? resultLegacy;
}

function findCreatedAt(value: Record<string, unknown>): string | null {
  const legacy = asRecord(value.legacy);
  return normalizeTimestamp(
    legacy?.created_at ?? legacy?.createdAt ?? value.created_at ?? value.createdAt
  );
}

function recordRichness(record: ExportRecord): number {
  return [
    record.text,
    record.handle,
    record.displayName,
    record.conversationId,
    record.parentId,
    record.authorId,
    record.createdAt
  ].filter(Boolean).length;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(cleaned) ? cleaned : null;
}

function cleanHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(cleaned) ? cleaned : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, MAX_TEXT);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function timestampValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeOperation(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
