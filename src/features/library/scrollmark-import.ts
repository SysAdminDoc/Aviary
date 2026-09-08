import type { ExportRecord } from "../export/types.ts";
import { normalizePostLanguage } from "../export/language.ts";
import { readZip, type ZipReadEntry } from "../export/zip-reader.ts";

/**
 * Reading a Scrollmark portable bundle, without pretending it is one of ours.
 *
 * Scrollmark is a fork of twitter-web-exporter that ships two different things under the same
 * name, and telling them apart is most of this module:
 *
 *   `canonical-zip`  the current export. A ZIP holding `manifest.json`, `records/records.jsonl`
 *                    with one `BundleRecordEnvelope` per line, and an optional
 *                    `media/media-urls.txt`. The manifest's `producer.schemaVersion` is the
 *                    bundle's own format number and `producer.appVersion` is the release of the
 *                    application that wrote it. They are different facts and are kept apart:
 *                    schema 1 has been written by several application versions.
 *   `legacy-json`    the older, roughly v1.2-era export. A bare JSON array of rows with
 *                    `full_text`, `screen_name` and a `media` array of
 *                    `{ type, thumbnail, original }`. No manifest, no version of any kind.
 *
 * A SQLite companion database is neither. Scrollmark keeps one beside the bundle, it begins with
 * the bytes `SQLite format 3`, and reading it as a bundle would produce nothing useful while
 * looking like a failed import.
 *
 * Nothing here requests anything. A bundle is a file the user hands over, and the media it names
 * stays a reference until the ordinary media capture is asked for it.
 */

export type ScrollmarkBundleKind = "canonical-zip" | "legacy-json";

/** What a bundle says about itself, before anything is imported from it. */
export interface ScrollmarkPreview {
  kind: ScrollmarkBundleKind;
  /** The bundle format's own version. `null` when the bundle declares none, as the legacy shape does. */
  schemaVersion: number | null;
  /** The application release that wrote it. Never used as the schema version. */
  appVersion: string | null;
  app: string | null;
  bundleId: string | null;
  title: string | null;
  counts: {
    records: number;
    posts: number;
    mediaReferences: number;
    unknown: number;
  };
  /**
   * Fields the bundle carries that Aviary keeps no place for. Named rather than dropped in
   * silence: a person deciding whether to import wants to know what will not survive.
   */
  unsupportedFields: string[];
  errors: string[];
}

/** A record whose kind Aviary has no mapping for, kept with enough provenance to be traced back. */
export interface ScrollmarkUnknownRecord {
  id: string;
  kind: string;
  /** Bounded: a bundle can be large, and this is a breadcrumb rather than a second copy of it. */
  preview: string;
  bundleId: string | null;
  schemaVersion: number | null;
}

export interface ScrollmarkImportResult {
  preview: ScrollmarkPreview;
  records: ExportRecord[];
  unknown: ScrollmarkUnknownRecord[];
  /** Rows that could not be read. Each is counted and reported; none aborts the rest. */
  malformedRows: number;
  errors: string[];
  warnings: string[];
  /**
   * Where a stopped run got to, so the next one can continue from the same place rather than
   * re-reading what it already imported.
   */
  nextRecordIndex: number;
  completed: boolean;
}

/** How many unknown records are retained. Beyond this they are counted, not stored. */
export const SCROLLMARK_UNKNOWN_LIMIT = 200;
/** Characters kept from an unrecognised record, purely so a person can tell what it was. */
const UNKNOWN_PREVIEW_BYTES = 240;

const SQLITE_MAGIC = "SQLite format 3";
const TEXT_DECODER = new TextDecoder();

/** Fields the current bundle carries that Aviary has nowhere to put. */
const UNSUPPORTED_FIELDS = ["sensitivity", "sourceExtension", "socialEdges", "privacy.warnings"];

export interface ScrollmarkSourceReport {
  kind: ScrollmarkBundleKind | null;
  /** Why a source was refused, when it was. */
  reason?: string;
}

/**
 * What this byte stream is, decided before anything is parsed out of it.
 *
 * The SQLite check comes first on purpose. Its companion database sits in the same folder as the
 * bundle and is the file a person is most likely to pick by mistake.
 */
export function classifyScrollmarkSource(bytes: Uint8Array): ScrollmarkSourceReport {
  const head = TEXT_DECODER.decode(bytes.slice(0, 16));
  if (head.startsWith(SQLITE_MAGIC)) {
    return {
      kind: null,
      reason: "This is Scrollmark's SQLite companion database, not its portable bundle. Export a bundle and choose that file."
    };
  }
  // A ZIP local file header. The canonical bundle is the only zipped shape here.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { kind: "canonical-zip" };

  const text = TEXT_DECODER.decode(bytes.slice(0, 4096)).trimStart();
  if (text.startsWith("[")) return { kind: "legacy-json" };
  if (text.startsWith("{")) {
    return {
      kind: null,
      reason: "This looks like a single JSON object. A legacy Scrollmark export is an array of rows, and a current one is a ZIP."
    };
  }
  return { kind: null, reason: "This is not a Scrollmark bundle: it is neither a ZIP nor a JSON array." };
}

export interface ScrollmarkImportOptions {
  /** Resume from a previous run's `nextRecordIndex`. */
  startIndex?: number;
  /** Returning false stops the run cleanly, keeping what has been read so far. */
  shouldContinue?: () => boolean | Promise<boolean>;
  surface?: string;
}

/** Reads a bundle without importing it, so the counts and the losses can be shown first. */
export async function previewScrollmarkBundle(bytes: Uint8Array): Promise<ScrollmarkPreview> {
  const result = await importScrollmarkBundle(bytes, { startIndex: 0, shouldContinue: () => false });
  return result.preview;
}

export async function importScrollmarkBundle(
  bytes: Uint8Array,
  options: ScrollmarkImportOptions = {}
): Promise<ScrollmarkImportResult> {
  const classified = classifyScrollmarkSource(bytes);
  if (classified.kind === null) {
    return emptyResult(classified.reason ?? "This is not a Scrollmark bundle.");
  }

  return classified.kind === "canonical-zip"
    ? importCanonicalBundle(bytes, options)
    : importLegacyExport(bytes, options);
}

async function importCanonicalBundle(
  bytes: Uint8Array,
  options: ScrollmarkImportOptions
): Promise<ScrollmarkImportResult> {
  let entries: ZipReadEntry[];
  try {
    entries = await readZip(bytes);
  } catch (error) {
    return emptyResult(`The bundle could not be opened: ${(error as Error).message}`);
  }

  const manifestEntry = entries.find((entry) => normalizePath(entry.filename) === "manifest.json");
  const recordsEntry = entries.find((entry) => normalizePath(entry.filename) === "records/records.jsonl");
  if (!manifestEntry || !recordsEntry) {
    return emptyResult(
      "A Scrollmark bundle needs manifest.json and records/records.jsonl. This ZIP has neither, so nothing was read."
    );
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const manifest = safeJson(TEXT_DECODER.decode(manifestEntry.data));
  const producer = isRecord(manifest) && isRecord(manifest.producer) ? manifest.producer : {};

  // The bundle's own format number and the release that wrote it. Reading one as the other is the
  // mistake this separation exists to prevent: schema 1 has shipped from several app versions.
  const schemaVersion = typeof producer.schemaVersion === "number" ? producer.schemaVersion : null;
  const appVersion = typeof producer.appVersion === "string" ? producer.appVersion : null;
  const app = typeof producer.app === "string" ? producer.app : null;
  const bundleId = isRecord(manifest) && typeof manifest.id === "string" ? manifest.id : null;
  const title = isRecord(manifest) && typeof manifest.title === "string" ? manifest.title : null;

  if (schemaVersion === null) {
    warnings.push("The bundle declares no schema version, so its shape is being assumed.");
  }

  const lines = TEXT_DECODER.decode(recordsEntry.data).split(/\r?\n/);
  const read = await readEnvelopes(lines, { bundleId, schemaVersion, app, appVersion }, options);

  // What the import cannot keep, said out loud. A field dropped in silence is a difference the
  // person only finds later, in a library that is quietly missing something they exported.
  if (UNSUPPORTED_FIELDS.length > 0) {
    warnings.push(`These bundle fields have no place in Aviary and were not imported: ${UNSUPPORTED_FIELDS.join(", ")}.`);
  }

  return {
    preview: {
      kind: "canonical-zip",
      schemaVersion,
      appVersion,
      app,
      bundleId,
      title,
      counts: {
        records: read.records.length + read.unknown.length,
        posts: read.records.length,
        mediaReferences: read.mediaReferences,
        unknown: read.unknownTotal
      },
      unsupportedFields: [...UNSUPPORTED_FIELDS],
      errors
    },
    records: read.records,
    unknown: read.unknown,
    malformedRows: read.malformed,
    errors,
    warnings: [...warnings, ...read.warnings],
    nextRecordIndex: read.nextIndex,
    completed: read.completed
  };
}

async function importLegacyExport(
  bytes: Uint8Array,
  options: ScrollmarkImportOptions
): Promise<ScrollmarkImportResult> {
  const parsed = safeJson(TEXT_DECODER.decode(bytes));
  if (!Array.isArray(parsed)) {
    return emptyResult("A legacy Scrollmark export is a JSON array of rows. This file is not one.");
  }

  // The legacy shape carries no version of any kind, which is a fact about it rather than a
  // failure to read it. Reporting `null` is what keeps it from being confused with schema 0.
  const provenance = { bundleId: null, schemaVersion: null, app: null, appVersion: null };
  const read = await readLegacyRows(parsed, provenance, options);

  return {
    preview: {
      kind: "legacy-json",
      schemaVersion: null,
      appVersion: null,
      app: null,
      bundleId: null,
      title: null,
      counts: {
        records: read.records.length + read.unknown.length,
        posts: read.records.length,
        mediaReferences: read.mediaReferences,
        unknown: read.unknownTotal
      },
      // A legacy row has no envelope, so none of the envelope-only fields can be lost from it.
      unsupportedFields: ["metadata.twe_private_fields"],
      errors: []
    },
    records: read.records,
    unknown: read.unknown,
    malformedRows: read.malformed,
    errors: [],
    warnings: read.warnings,
    nextRecordIndex: read.nextIndex,
    completed: read.completed
  };
}

interface Provenance {
  bundleId: string | null;
  schemaVersion: number | null;
  app: string | null;
  appVersion: string | null;
}

interface ReadOutcome {
  records: ExportRecord[];
  unknown: ScrollmarkUnknownRecord[];
  unknownTotal: number;
  mediaReferences: number;
  malformed: number;
  warnings: string[];
  nextIndex: number;
  completed: boolean;
}

async function readEnvelopes(
  lines: readonly string[],
  provenance: Provenance,
  options: ScrollmarkImportOptions
): Promise<ReadOutcome> {
  const outcome = emptyOutcome();
  const seenPosts = new Set<string>();
  const seenMedia = new Set<string>();
  const start = Math.max(0, options.startIndex ?? 0);

  for (let index = start; index < lines.length; index += 1) {
    if (options.shouldContinue && !(await options.shouldContinue())) {
      outcome.nextIndex = index;
      outcome.completed = false;
      return outcome;
    }
    const line = lines[index]!.trim();
    if (line.length === 0) continue;

    const envelope = safeJson(line);
    if (!isRecord(envelope) || typeof envelope.id !== "string") {
      // One bad line is one bad line. The rest of the file is still readable, and refusing it all
      // would throw away everything for the sake of a row nobody can use.
      outcome.malformed += 1;
      outcome.warnings.push(`records/records.jsonl line ${index + 1} could not be read.`);
      continue;
    }

    if (envelope.kind !== "tweet") {
      outcome.unknownTotal += 1;
      if (outcome.unknown.length < SCROLLMARK_UNKNOWN_LIMIT) {
        outcome.unknown.push({
          id: envelope.id,
          kind: typeof envelope.kind === "string" ? envelope.kind : "unknown",
          preview: line.slice(0, UNKNOWN_PREVIEW_BYTES),
          bundleId: provenance.bundleId,
          schemaVersion: provenance.schemaVersion
        });
      }
      continue;
    }

    if (seenPosts.has(envelope.id)) continue;
    seenPosts.add(envelope.id);

    const data = isRecord(envelope.data) ? envelope.data : {};
    const record = buildRecord(
      {
        id: envelope.id,
        text: stringOf(data.full_text, data.text),
        handle: stringOf(data.screen_name, data.handle),
        displayName: stringOf(data.profile_name, data.name),
        language: stringOf(data.lang, data.language),
        observedAt: typeof envelope.observedAt === "number" ? envelope.observedAt : null,
        tags: Array.isArray(envelope.tags) ? envelope.tags.filter((tag): tag is string => typeof tag === "string") : []
      },
      mediaFromRefs(envelope.mediaRefs, seenMedia, outcome),
      provenance,
      options.surface ?? "scrollmark"
    );
    outcome.records.push(record);
  }

  outcome.nextIndex = lines.length;
  outcome.completed = true;
  return outcome;
}

async function readLegacyRows(
  rows: readonly unknown[],
  provenance: Provenance,
  options: ScrollmarkImportOptions
): Promise<ReadOutcome> {
  const outcome = emptyOutcome();
  const seenPosts = new Set<string>();
  const seenMedia = new Set<string>();
  const start = Math.max(0, options.startIndex ?? 0);

  for (let index = start; index < rows.length; index += 1) {
    if (options.shouldContinue && !(await options.shouldContinue())) {
      outcome.nextIndex = index;
      outcome.completed = false;
      return outcome;
    }
    const row = rows[index];
    if (!isRecord(row) || typeof row.id !== "string") {
      outcome.malformed += 1;
      outcome.warnings.push(`Row ${index + 1} could not be read.`);
      continue;
    }

    // A legacy export mixes posts and user rows in one array, and a user row has no post text.
    const text = stringOf(row.full_text, row.text);
    if (text === null) {
      outcome.unknownTotal += 1;
      if (outcome.unknown.length < SCROLLMARK_UNKNOWN_LIMIT) {
        outcome.unknown.push({
          id: row.id,
          kind: "user",
          preview: JSON.stringify(row).slice(0, UNKNOWN_PREVIEW_BYTES),
          bundleId: null,
          schemaVersion: null
        });
      }
      continue;
    }

    if (seenPosts.has(row.id)) continue;
    seenPosts.add(row.id);

    outcome.records.push(
      buildRecord(
        {
          id: row.id,
          text,
          handle: stringOf(row.screen_name, row.handle),
          displayName: stringOf(row.profile_name, row.name),
          language: stringOf(row.lang, row.language),
          observedAt: null,
          tags: []
        },
        legacyMedia(row.media, seenMedia, outcome),
        provenance,
        options.surface ?? "scrollmark"
      )
    );
  }

  outcome.nextIndex = rows.length;
  outcome.completed = true;
  return outcome;
}

interface RecordFields {
  id: string;
  text: string | null;
  handle: string | null;
  displayName: string | null;
  language: string | null;
  observedAt: number | null;
  tags: string[];
}

function buildRecord(
  fields: RecordFields,
  media: ExportRecord["media"],
  provenance: Provenance,
  surface: string
): ExportRecord {
  const record: ExportRecord = {
    tweetId: fields.id,
    handle: fields.handle,
    displayName: fields.displayName,
    text: fields.text ?? "",
    // The import time, not the post's. `capturedAt` is what the WARC writer puts in WARC-Date.
    capturedAt: new Date().toISOString(),
    surface,
    media,
    permalink: fields.handle ? `https://x.com/${fields.handle}/status/${fields.id}` : null,
    language: normalizePostLanguage(fields.language),
    audience: "unknown",
    importSource: {
      app: provenance.app ?? "scrollmark",
      schemaVersion: provenance.schemaVersion,
      appVersion: provenance.appVersion,
      bundleId: provenance.bundleId
    }
  };
  if (fields.observedAt !== null) record.createdAt = new Date(fields.observedAt).toISOString();
  return record;
}

function mediaFromRefs(
  refs: unknown,
  seen: Set<string>,
  outcome: ReadOutcome
): ExportRecord["media"] {
  if (!Array.isArray(refs)) return [];
  const media: ExportRecord["media"] = [];
  for (const ref of refs) {
    if (!isRecord(ref)) continue;
    const url = stringOf(ref.url, ref.previewUrl);
    if (!url) continue;
    const id = typeof ref.id === "string" ? ref.id : url;
    // The same media in two records is one asset. Counting it twice would promise a larger import
    // than the one that happens.
    if (seen.has(id)) continue;
    seen.add(id);
    outcome.mediaReferences += 1;
    media.push({
      kind: mediaKind(ref.type),
      url,
      captureStatus: "remote-reference",
      ...(typeof ref.altText === "string" ? { altText: ref.altText } : {}),
      ...(typeof ref.width === "number" ? { width: ref.width } : {}),
      ...(typeof ref.height === "number" ? { height: ref.height } : {})
    });
  }
  return media;
}

function legacyMedia(value: unknown, seen: Set<string>, outcome: ReadOutcome): ExportRecord["media"] {
  if (!Array.isArray(value)) return [];
  const media: ExportRecord["media"] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    // `original` is the full-size asset; `thumbnail` is the small one the list view showed.
    const url = stringOf(entry.original, entry.thumbnail);
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    outcome.mediaReferences += 1;
    media.push({ kind: mediaKind(entry.type), url, captureStatus: "remote-reference" });
  }
  return media;
}

function mediaKind(value: unknown): ExportRecord["media"][number]["kind"] {
  if (value === "video") return "video";
  if (value === "animated_gif") return "video";
  if (value === "thumbnail") return "thumbnail";
  return "photo";
}

function emptyOutcome(): ReadOutcome {
  return {
    records: [],
    unknown: [],
    unknownTotal: 0,
    mediaReferences: 0,
    malformed: 0,
    warnings: [],
    nextIndex: 0,
    completed: true
  };
}

function emptyResult(error: string): ScrollmarkImportResult {
  return {
    preview: {
      kind: "legacy-json",
      schemaVersion: null,
      appVersion: null,
      app: null,
      bundleId: null,
      title: null,
      counts: { records: 0, posts: 0, mediaReferences: 0, unknown: 0 },
      unsupportedFields: [],
      errors: [error]
    },
    records: [],
    unknown: [],
    malformedRows: 0,
    errors: [error],
    warnings: [],
    nextRecordIndex: 0,
    completed: false
  };
}

function normalizePath(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOf(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}
