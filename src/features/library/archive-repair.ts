import type {
  ExportExpandedUrl,
  ExportParticipant,
  ExportRecord
} from "../export/types";
import {
  collectKnownShortLinks,
  replaceKnownTcoLinks,
  tcoLinkKey,
  type LinkKnowledgeSource,
  type ResolvedShortLink
} from "./link-unshorten";
import {
  emptyArchiveRepairSummary,
  type ArchiveCollections,
  type ArchiveParticipant,
  type ArchiveRepairSummary
} from "./archive-types";

const MAX_IDENTITY_NODES = 100_000;
const MAX_IDENTITIES = 25_000;
const MAX_LOCAL_CORPUS_RECORDS = 500;
const MAX_LOCAL_CORPUS_BYTES = 50_000_000;

interface KnownDestination {
  destination: string;
  source: LinkKnowledgeSource;
}

/**
 * Builds repair knowledge from files the user selected and responses Aviary already captured.
 * It has no network dependency and silently ignores malformed or truncated corpus bodies.
 */
export class ArchiveRepairIndex {
  readonly #links = new Map<string, KnownDestination>();
  readonly #handles = new Map<string, string>();

  constructor(localCorpus: readonly ExportRecord[] = []) {
    let corpusBytes = 0;
    for (const record of localCorpus.slice(-MAX_LOCAL_CORPUS_RECORDS).reverse()) {
      this.#ingestValue(record, "local-corpus");
      if (!record.surface.startsWith("graphql:")) continue;
      const recordBytes = new TextEncoder().encode(record.text).byteLength;
      if (corpusBytes + recordBytes > MAX_LOCAL_CORPUS_BYTES) continue;
      corpusBytes += recordBytes;
      try {
        this.#ingestValue(JSON.parse(record.text), "local-corpus");
      } catch {
        // A bounded capture can end mid-JSON. It contributes no facts instead of failing import.
      }
    }
  }

  ingestArchivePayload(payload: unknown): void {
    this.#ingestValue(payload, "archive");
  }

  repair(records: ExportRecord[], collections: ArchiveCollections): ArchiveRepairSummary {
    const summary = emptyArchiveRepairSummary();
    const resolvedParticipantIds = new Set<string>();
    const unresolvedParticipantIds = new Set<string>();
    const archiveOwner = normalizeHandle(collections.account?.handle ?? collections.profile?.handle);

    for (const record of records) {
      if (!record.handle && archiveOwner && !record.surface.includes(".likes")) {
        record.handle = archiveOwner;
      }
      const text = this.#expand(record.text, summary);
      record.text = text.text;
      if (text.resolved.length > 0) record.expandedUrls = toExportLinks(text.resolved);
      if (record.quote) {
        record.quote.text = this.#expand(record.quote.text, summary).text;
      }
      if (record.article?.url) {
        record.article.url = this.#expand(record.article.url, summary).text;
      }
      if (record.participants) {
        record.participants = record.participants.map((participant) => ({
          ...this.#resolveParticipant(
            participant.id,
            participant.handle,
            resolvedParticipantIds,
            unresolvedParticipantIds
          ),
          role: participant.role
        }));
      }
    }

    for (const message of collections.directMessages) {
      const text = this.#expand(message.text, summary);
      message.text = text.text;
      if (text.resolved.length > 0) message.expandedUrls = toExportLinks(text.resolved);
      message.mediaUrls = message.mediaUrls.map((url) => this.#expand(url, summary).text);
      message.sender = message.senderId
        ? this.#resolveParticipant(
            message.senderId,
            message.sender?.handle ?? null,
            resolvedParticipantIds,
            unresolvedParticipantIds
          )
        : null;
      message.recipients = message.recipientIds.map((id, index) =>
        this.#resolveParticipant(
          id,
          message.recipients?.[index]?.handle ?? null,
          resolvedParticipantIds,
          unresolvedParticipantIds
        )
      );
    }

    if (collections.profile?.website) {
      collections.profile.website = this.#expand(collections.profile.website, summary).text;
    }
    summary.participantIdsResolved = resolvedParticipantIds.size;
    summary.participantIdsUnresolved = unresolvedParticipantIds.size;
    return summary;
  }

  #ingestValue(value: unknown, source: LinkKnowledgeSource): void {
    for (const link of collectKnownShortLinks(value)) {
      const key = tcoLinkKey(link.shortUrl);
      if (!key) continue;
      const existing = this.#links.get(key);
      if (!existing || source === "archive") {
        this.#links.set(key, { destination: link.destination, source });
      }
    }
    for (const identity of collectKnownAccountIdentities(value)) {
      if (!this.#handles.has(identity.id) || source === "archive") {
        this.#handles.set(identity.id, identity.handle);
      }
    }
  }

  #expand(
    text: string,
    summary: ArchiveRepairSummary
  ): { text: string; resolved: ResolvedShortLink[] } {
    const result = replaceKnownTcoLinks(text, (shortUrl) => {
      const key = tcoLinkKey(shortUrl);
      return key ? this.#links.get(key) ?? null : null;
    });
    for (const link of result.resolved) {
      if (link.source === "archive") summary.archiveLinksExpanded += 1;
      else summary.corpusLinksExpanded += 1;
    }
    return result;
  }

  #resolveParticipant(
    id: string,
    handleHint: string | null,
    resolvedIds: Set<string>,
    unresolvedIds: Set<string>
  ): ArchiveParticipant {
    const handle = normalizeHandle(handleHint) ?? this.#handles.get(id) ?? null;
    if (/^\d+$/.test(id)) {
      if (handle) {
        resolvedIds.add(id);
        unresolvedIds.delete(id);
      } else if (!resolvedIds.has(id)) {
        unresolvedIds.add(id);
      }
    }
    return buildArchiveParticipant(id, handle);
  }
}

export function buildArchiveParticipant(id: string, handle: string | null = null): ArchiveParticipant {
  const normalizedHandle = normalizeHandle(handle);
  return {
    id,
    handle: normalizedHandle,
    label: normalizedHandle
      ? `@${normalizedHandle} (user ID ${id})`
      : /^\d+$/.test(id)
        ? `Unresolved user ID ${id}`
        : `Unresolved participant ${id}`
  };
}

export function buildMentionParticipant(id: string, handle: string | null): ExportParticipant {
  return { ...buildArchiveParticipant(id, handle), role: "mention" };
}

function collectKnownAccountIdentities(root: unknown): Array<{ id: string; handle: string }> {
  const found = new Map<string, string>();
  const pending: unknown[] = [root];
  const visited = new Set<object>();
  let inspected = 0;

  while (pending.length > 0 && inspected < MAX_IDENTITY_NODES && found.size < MAX_IDENTITIES) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    inspected += 1;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    const id = firstString(
      record,
      "rest_id",
      "id_str",
      "user_id_str",
      "userId",
      "user_id",
      "accountId",
      "account_id"
    );
    const legacy = isRecord(record.legacy) ? record.legacy : null;
    const handle = normalizeHandle(
      firstString(record, "screen_name", "screenName", "username", "handle", "userLink") ??
      (legacy ? firstString(legacy, "screen_name", "screenName", "username", "handle") : null)
    );
    if (id && /^\d+$/.test(id) && handle) found.set(id, handle);
    pending.push(...Object.values(record));
  }
  return [...found].map(([id, handle]) => ({ id, handle }));
}

function toExportLinks(links: readonly ResolvedShortLink[]): ExportExpandedUrl[] {
  const found = new Map<string, ExportExpandedUrl>();
  for (const link of links) {
    found.set(`${link.shortUrl}\u0000${link.destination}`, { ...link });
  }
  return [...found.values()];
}

function normalizeHandle(value: string | null | undefined): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return null;
  let handle = candidate.replace(/^@/, "");
  try {
    const url = new URL(candidate);
    if (/^(?:www\.)?(?:x|twitter)\.com$/i.test(url.hostname)) {
      handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
  } catch {
    // A plain handle is the normal archive shape.
  }
  return /^[A-Za-z0-9_]{1,50}$/.test(handle) ? handle : null;
}

function firstString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
