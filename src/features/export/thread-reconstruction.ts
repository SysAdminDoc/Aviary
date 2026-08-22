import type { ExportRecord } from "./types";

export interface ThreadParticipant {
  authorId: string | null;
  handle: string | null;
  displayName: string | null;
}

export interface ReconstructedThreadPost {
  kind: "post";
  record: ExportRecord;
  depth: number;
  parentId: string | null;
  differentAuthor: boolean;
}

export interface ReconstructedThreadGap {
  kind: "gap";
  missingId: string;
  parentId: string | null;
  depth: number;
}

export type ReconstructedThreadItem = ReconstructedThreadPost | ReconstructedThreadGap;

export interface ThreadAuthorRun {
  authorId: string | null;
  handle: string | null;
  displayName: string | null;
  start: number;
  count: number;
  postIds: string[];
}

export interface ReconstructedThread {
  id: string;
  rootId: string | null;
  kind: "thread" | "conversation";
  items: ReconstructedThreadItem[];
  records: ExportRecord[];
  gaps: ReconstructedThreadGap[];
  participants: ThreadParticipant[];
  authorRuns: ThreadAuthorRun[];
}

interface ThreadNode {
  record: ExportRecord;
  key: string;
  index: number;
  tweetId: string | null;
  conversationId: string | null;
  rootId: string | null;
  parentId: string | null;
  threadId: string | null;
  authorId: string | null;
  handle: string | null;
  displayName: string | null;
  timestamp: number;
}

/**
 * Rebuilds locally captured reply contexts without making a request for a missing parent.
 *
 * The graph is deliberately deterministic. Duplicate tweet ids are merged, shared conversation
 * roots and parent edges are unioned, then each component is emitted parent-first. Missing parents
 * become explicit gaps so a reader can see where capture coverage ends.
 */
export function reconstructThreads(records: readonly ExportRecord[]): ReconstructedThread[] {
  const nodes = dedupeNodes(records);
  if (nodes.length === 0) return [];

  const union = new UnionFind(nodes.length);
  const byTweetId = new Map<string, number>();
  const contextBuckets = new Map<string, number[]>();

  nodes.forEach((node, index) => {
    if (node.tweetId) byTweetId.set(node.tweetId, index);
    const context = node.conversationId ?? node.rootId ?? node.threadId;
    if (context) {
      const bucket = contextBuckets.get(context) ?? [];
      bucket.push(index);
      contextBuckets.set(context, bucket);
    } else if (node.handle && !node.parentId) {
      // Preserve the viewer's long-standing self-thread fallback for older records that predate
      // the GraphQL metadata fields. It is only used when there is no explicit context at all.
      const bucket = contextBuckets.get(`handle:${node.handle}`) ?? [];
      bucket.push(index);
      contextBuckets.set(`handle:${node.handle}`, bucket);
    }
  });

  for (const bucket of contextBuckets.values()) {
    for (let index = 1; index < bucket.length; index += 1) union.join(bucket[0]!, bucket[index]!);
  }
  nodes.forEach((node, index) => {
    const parent = node.parentId ? byTweetId.get(node.parentId) : undefined;
    if (parent !== undefined) union.join(index, parent);
  });

  const components = new Map<number, ThreadNode[]>();
  nodes.forEach((node, index) => {
    const root = union.find(index);
    const component = components.get(root) ?? [];
    component.push(node);
    components.set(root, component);
  });

  return [...components.values()]
    .sort(compareComponents)
    .map((component) => buildThread(component, byNodeId(component)));
}

/** Returns the records in the same parent-first order used by the thread reader and exports. */
export function reconstructExportOrder(records: readonly ExportRecord[]): ExportRecord[] {
  const threads = reconstructThreads(records);
  const ordered: ExportRecord[] = [];
  const seen = new Set<string>();
  for (const thread of threads) {
    for (const item of thread.items) {
      if (item.kind !== "post") continue;
      const key = threadRecordKey(item.record);
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(item.record);
    }
  }
  for (const record of records) {
    const key = threadRecordKey(record);
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(record);
    }
  }
  return ordered;
}

/** Stable local identity for records that may not have an X status id. */
export function threadRecordKey(record: ExportRecord): string {
  if (record.tweetId) return `tweet:${record.tweetId}`;
  return [
    "record",
    record.surface,
    record.permalink ?? "",
    record.capturedAt,
    record.text.slice(0, 160)
  ].join("|");
}

function dedupeNodes(records: readonly ExportRecord[]): ThreadNode[] {
  const nodes: ThreadNode[] = [];
  const byKey = new Map<string, number>();
  records.forEach((record, index) => {
    const key = threadRecordKey(record);
    const previous = byKey.get(key);
    if (previous !== undefined) {
      nodes[previous] = mergeNode(nodes[previous]!, record);
      return;
    }
    const node: ThreadNode = {
      record,
      key,
      index,
      tweetId: cleanId(record.tweetId),
      conversationId: cleanId(record.conversationId),
      rootId: cleanId(record.rootId),
      parentId: cleanId(record.parentId),
      threadId: cleanId(record.threadId),
      authorId: cleanId(record.authorId),
      handle: cleanHandle(record.handle),
      displayName: cleanText(record.displayName),
      timestamp: timestampOf(record.createdAt ?? record.capturedAt)
    };
    byKey.set(key, nodes.length);
    nodes.push(node);
  });
  return nodes;
}

function mergeNode(existing: ThreadNode, incoming: ExportRecord): ThreadNode {
  const merged: ExportRecord = {
    ...existing.record,
    ...incoming,
    media: incoming.media?.length > existing.record.media.length ? incoming.media : existing.record.media,
    ...(incoming.participants?.length
      ? { participants: incoming.participants }
      : existing.record.participants?.length
        ? { participants: existing.record.participants }
        : {}),
    ...(incoming.expandedUrls?.length
      ? { expandedUrls: incoming.expandedUrls }
      : existing.record.expandedUrls?.length
        ? { expandedUrls: existing.record.expandedUrls }
        : {})
  };
  return {
    ...existing,
    record: merged,
    conversationId: cleanId(merged.conversationId) ?? existing.conversationId,
    rootId: cleanId(merged.rootId) ?? existing.rootId,
    parentId: cleanId(merged.parentId) ?? existing.parentId,
    threadId: cleanId(merged.threadId) ?? existing.threadId,
    authorId: cleanId(merged.authorId) ?? existing.authorId,
    handle: cleanHandle(merged.handle) ?? existing.handle,
    displayName: cleanText(merged.displayName) ?? existing.displayName,
    timestamp: timestampOf(merged.createdAt ?? merged.capturedAt) || existing.timestamp
  };
}

function byNodeId(component: readonly ThreadNode[]): Map<string, ThreadNode> {
  const result = new Map<string, ThreadNode>();
  for (const node of component) {
    if (node.tweetId) result.set(node.tweetId, node);
  }
  return result;
}

function buildThread(component: readonly ThreadNode[], byTweetId: Map<string, ThreadNode>): ReconstructedThread {
  const orderedNodes = [...component].sort(compareNodes);
  const rootId = firstNonEmpty(orderedNodes.map((node) => node.rootId ?? node.conversationId));
  const id = rootId ?? orderedNodes[0]?.tweetId ?? `context:${orderedNodes[0]?.handle ?? orderedNodes[0]?.key}`;
  const children = new Map<string, ThreadNode[]>();
  for (const node of orderedNodes) {
    if (!node.parentId || !byTweetId.has(node.parentId)) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) list.sort(compareNodes);

  const items: ReconstructedThreadItem[] = [];
  const visited = new Set<string>();
  const emittedGaps = new Set<string>();
  const firstNode = orderedNodes.find((node) => node.tweetId === rootId);
  if (rootId && !firstNode && !orderedNodes.some((node) => node.parentId === rootId)) {
    emitGap(items, emittedGaps, rootId, null, 0);
  }

  const emit = (node: ThreadNode, depth: number): void => {
    const key = node.key;
    if (visited.has(key)) return;
    if (node.parentId && !byTweetId.has(node.parentId)) {
      emitGap(items, emittedGaps, node.parentId, null, Math.max(0, depth - 1));
    }
    visited.add(key);
    items.push({
      kind: "post",
      record: node.record,
      depth,
      parentId: node.parentId,
      differentAuthor: false
    });
    for (const child of children.get(node.tweetId ?? "") ?? []) emit(child, depth + 1);
  };

  const roots = orderedNodes.filter((node) => !node.parentId || !byTweetId.has(node.parentId));
  for (const node of roots) emit(node, node.parentId && !byTweetId.has(node.parentId) ? 1 : 0);
  for (const node of orderedNodes) {
    if (!visited.has(node.key)) emit(node, node.parentId ? 1 : 0);
  }

  const firstAuthor = items.find((item): item is ReconstructedThreadPost => item.kind === "post");
  const firstIdentity = firstAuthor ? authorIdentity(firstAuthor.record) : "";
  for (const item of items) {
    if (item.kind !== "post") continue;
    item.differentAuthor = firstIdentity !== "" && authorIdentity(item.record) !== firstIdentity;
  }
  const records = items.filter((item): item is ReconstructedThreadPost => item.kind === "post").map((item) => item.record);
  const participants = participantList(records);
  const authorRuns = collapseAuthorRuns(items);
  return {
    id,
    rootId,
    kind: participants.length > 1 ? "conversation" : "thread",
    items,
    records,
    gaps: items.filter((item): item is ReconstructedThreadGap => item.kind === "gap"),
    participants,
    authorRuns
  };
}

/** Converts consecutive same-author posts into expandable reader runs without hiding gaps. */
export function collapseAuthorRuns(items: readonly ReconstructedThreadItem[]): ThreadAuthorRun[] {
  const runs: ThreadAuthorRun[] = [];
  let current: ThreadAuthorRun | null = null;
  items.forEach((item, index) => {
    if (item.kind === "gap") {
      current = null;
      return;
    }
    const identity = authorIdentity(item.record);
    if (!current || authorIdentityFromRun(current) !== identity) {
      current = {
        authorId: cleanId(item.record.authorId),
        handle: cleanHandle(item.record.handle),
        displayName: cleanText(item.record.displayName),
        start: index,
        count: 0,
        postIds: []
      };
      runs.push(current);
    }
    current.count += 1;
    current.postIds.push(item.record.tweetId ?? threadRecordKey(item.record));
  });
  return runs;
}

function authorIdentityFromRun(run: ThreadAuthorRun): string {
  return run.authorId ?? run.handle ?? run.displayName ?? "unknown";
}

function participantList(records: readonly ExportRecord[]): ThreadParticipant[] {
  const seen = new Set<string>();
  const result: ThreadParticipant[] = [];
  for (const record of records) {
    const participant: ThreadParticipant = {
      authorId: cleanId(record.authorId),
      handle: cleanHandle(record.handle),
      displayName: cleanText(record.displayName)
    };
    const key = authorIdentity(record);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(participant);
  }
  return result;
}

function emitGap(
  items: ReconstructedThreadItem[],
  emitted: Set<string>,
  missingId: string,
  parentId: string | null,
  depth: number
): void {
  if (emitted.has(missingId)) return;
  emitted.add(missingId);
  items.push({ kind: "gap", missingId, parentId, depth });
}

function compareComponents(left: readonly ThreadNode[], right: readonly ThreadNode[]): number {
  return compareNodes(left[0]!, right[0]!);
}

function compareNodes(left: ThreadNode, right: ThreadNode): number {
  return left.timestamp - right.timestamp || left.index - right.index || left.key.localeCompare(right.key);
}

function authorIdentity(record: ExportRecord): string {
  return cleanId(record.authorId) ?? cleanHandle(record.handle) ?? cleanText(record.displayName) ?? "unknown";
}

function cleanId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned.slice(0, 128) : null;
}

function cleanHandle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned.slice(0, 64) : null;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned.slice(0, 256) : null;
}

function firstNonEmpty(values: readonly (string | null)[]): string | null {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function timestampOf(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

class UnionFind {
  readonly #parents: number[];
  readonly #ranks: number[];

  constructor(size: number) {
    this.#parents = Array.from({ length: size }, (_, index) => index);
    this.#ranks = Array.from({ length: size }, () => 0);
  }

  find(value: number): number {
    let current = value;
    while (this.#parents[current] !== current) current = this.#parents[current]!;
    while (this.#parents[value] !== value) {
      const next = this.#parents[value]!;
      this.#parents[value] = current;
      value = next;
    }
    return current;
  }

  join(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    if (this.#ranks[leftRoot]! < this.#ranks[rightRoot]!) {
      this.#parents[leftRoot] = rightRoot;
    } else if (this.#ranks[leftRoot]! > this.#ranks[rightRoot]!) {
      this.#parents[rightRoot] = leftRoot;
    } else {
      this.#parents[rightRoot] = leftRoot;
      this.#ranks[leftRoot]! += 1;
    }
  }
}
