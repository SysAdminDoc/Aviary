import type { ExportMedia, ExportRecord } from "./types.ts";
import { filterShareRecords, normalizeAudienceSelection, type ExportAudienceSelection } from "./audience.ts";
import { compareRecordIds } from "./static-archive.ts";
import { reconstructThreads } from "./thread-reconstruction.ts";

/**
 * An Activity Streams 2.0 outbox, written beside the rest of the export.
 *
 * There is no converged social-archive format to adopt. AS2 is the closest thing: it is what
 * Mastodon's own account export emits and there is real tooling that parses it. It is not a
 * migration path -- Mastodon imports a social graph and never posts, and no other major platform
 * imports posts from it either -- so the file says so about itself, in `summary`, where anything
 * reading it will find the claim next to the data.
 *
 * Two choices worth stating. A post the capture never got is a `Tombstone` rather than a hole,
 * because an outbox that silently skips what it could not reach is an outbox that misrepresents
 * how complete it is. And an attachment whose bytes are in the package points at the package copy,
 * while one whose bytes were never captured points at the original address and says that is what
 * it is doing.
 */

const AS2_CONTEXT = "https://www.w3.org/ns/activitystreams";

const INTEROP_NOTICE =
  "Activity Streams 2.0 is an interoperability format, not a migration path. No major platform " +
  "currently imports posts from an AS2 outbox: Mastodon's importer takes the social graph only. " +
  "This file exists so the archive can be read by tooling that already understands AS2.";

export interface ActivityStreamsOptions {
  audience?: Partial<ExportAudienceSelection>;
  /** Declared once on the collection; the only value that changes between two exports. */
  generatedAt?: Date;
  /** Where the outbox says it lives, when the export was given a destination. */
  id?: string;
}

export interface ActivityStreamsOutbox {
  "@context": string;
  type: "OrderedCollection";
  id?: string;
  summary: string;
  generator: string;
  published: string;
  totalItems: number;
  orderedItems: Array<Record<string, unknown>>;
}

/** Builds the outbox document. */
export function buildActivityStreamsOutbox(
  records: readonly ExportRecord[],
  options: ActivityStreamsOptions = {}
): ActivityStreamsOutbox {
  const visible = filterShareRecords(records, normalizeAudienceSelection(options.audience));
  const generatedAt = options.generatedAt ?? new Date();

  const known = new Map<string, ExportRecord>();
  for (const record of visible) {
    if (record.tweetId) known.set(record.tweetId, record);
  }

  const ordered = [...visible]
    .filter((record) => record.tweetId !== null)
    .sort((left, right) => compareRecordIds(left.tweetId, right.tweetId));

  // Reply contexts that were reconstructed locally know which parents were never captured. Those
  // are the posts the outbox has to name rather than leave out.
  const missing = new Set<string>();
  for (const thread of reconstructThreads(visible)) {
    for (const gap of thread.gaps) {
      if (gap.missingId && !known.has(gap.missingId)) missing.add(gap.missingId);
    }
  }

  const items: Array<{ id: string; value: Record<string, unknown> }> = [];
  for (const record of ordered) {
    items.push({ id: record.tweetId!, value: createActivity(record, known) });
  }
  for (const id of missing) {
    items.push({ id, value: tombstone(id) });
  }
  items.sort((left, right) => compareRecordIds(left.id, right.id));

  return {
    "@context": AS2_CONTEXT,
    type: "OrderedCollection",
    ...(options.id ? { id: options.id } : {}),
    summary: INTEROP_NOTICE,
    generator: "Aviary",
    published: generatedAt.toISOString(),
    totalItems: items.length,
    orderedItems: items.map((item) => item.value)
  };
}

/** The outbox as the bytes that go in the package. */
export function serializeActivityStreamsOutbox(
  records: readonly ExportRecord[],
  options: ActivityStreamsOptions = {}
): Uint8Array {
  return new TextEncoder().encode(
    `${JSON.stringify(buildActivityStreamsOutbox(records, options), null, 2)}\n`
  );
}

function createActivity(record: ExportRecord, known: ReadonlyMap<string, ExportRecord>): Record<string, unknown> {
  const noteId = objectId(record.tweetId!, record.permalink);
  const actor = actorId(record.handle);
  const published = publishedAt(record);
  const note: Record<string, unknown> = {
    type: "Note",
    id: noteId,
    ...(published ? { published } : {}),
    attributedTo: actor,
    content: record.text,
    ...(record.language ? { contentMap: { [record.language]: record.text } } : {}),
    ...(record.permalink ? { url: record.permalink } : {})
  };

  const parent = record.parentId ?? null;
  if (parent) {
    // The parent's own address when it is in this export, its identifier when it is not. Either
    // way `inReplyTo` says what the reply was a reply to instead of dropping the relationship.
    note["inReplyTo"] = objectId(parent, known.get(parent)?.permalink ?? null);
  }
  if (record.conversationId) note["context"] = objectId(record.conversationId, null);

  const attachment = record.media.map(attachmentFor).filter((entry) => entry !== null);
  if (attachment.length > 0) note["attachment"] = attachment;

  return {
    type: "Create",
    id: `${noteId}#create`,
    ...(published ? { published } : {}),
    actor,
    object: note
  };
}

/**
 * `Tombstone` is the AS2 way to say "there was an object here and it is not available".
 *
 * `deleted` is left off: it takes a time, and the archive does not know one. A guessed timestamp
 * would be the outbox inventing a fact about a post it never saw.
 */
function tombstone(missingId: string): Record<string, unknown> {
  return {
    type: "Tombstone",
    id: objectId(missingId, null),
    formerType: "Note",
    summary: "This post was referenced by a captured reply but was never captured, so its content is unavailable."
  };
}

function attachmentFor(media: ExportMedia): Record<string, unknown> | null {
  const kind = media.kind === "video" ? "Video" : media.kind === "audio" ? "Audio" : "Document";
  const base: Record<string, unknown> = {
    type: media.kind === "photo" || media.kind === "thumbnail" ? "Image" : kind,
    ...(media.type ? { mediaType: media.type } : {}),
    ...(media.altText ? { name: media.altText } : {}),
    ...(typeof media.width === "number" ? { width: media.width } : {}),
    ...(typeof media.height === "number" ? { height: media.height } : {})
  };

  if (media.assetPath) {
    return { ...base, url: media.assetPath };
  }
  const address = media.url || media.sourceUrl || "";
  if (!address) return null;
  return {
    ...base,
    url: address,
    summary: "The bytes were not captured; this points at the original address rather than a file in this package."
  };
}

/**
 * An IRI for a post.
 *
 * The permalink where there is one, because that is a real address. A `urn:` otherwise, because
 * an AS2 id has to be an IRI and a bare status number is not one -- and because inventing an
 * `https://x.com/...` URL for a post whose address was never recorded would be a guess.
 */
function objectId(tweetId: string, permalink: string | null): string {
  return permalink ?? `urn:x-aviary:post:${encodeURIComponent(tweetId)}`;
}

function actorId(handle: string | null): string {
  return handle ? `https://x.com/${encodeURIComponent(handle)}` : "urn:x-aviary:actor:unknown";
}

/** The authored time. `capturedAt` is when Aviary saw the post, which is a different fact. */
function publishedAt(record: ExportRecord): string | null {
  const raw = record.createdAt ?? null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
