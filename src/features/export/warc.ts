import {
  buildExportPackageManifest,
  describeMediaCapture,
  serializeExportRecord,
  sha256Hex
} from "./assets.ts";
import type { ExportArtifact, ExportMedia, ExportRecord } from "./types.ts";
import { filterShareRecords, normalizeAudienceSelection, type ExportAudienceSelection } from "./audience.ts";

const ENCODER = new TextEncoder();
const WARC_VERSION = "WARC/1.1";

export interface WarcRecordInput {
  url?: string;
  mime: string;
  body: string | Uint8Array;
  recordType?: "warcinfo" | "response" | "resource" | "metadata" | "revisit";
  recordedAt?: Date;
  recordId?: string;
  /** Stable position within one archive, used only to prevent duplicate deterministic ids. */
  occurrence?: number;
  payloadDigest?: string;
  extraHeaders?: Readonly<Record<string, string>>;
}

export interface WarcIndexEntry {
  url: string;
  timestamp: string;
  digest: string;
  mime: string;
  status: number;
  offset: number;
  length: number;
}

export interface WarcPageEntry {
  url: string;
  ts: string;
  title?: string;
  capturedAt?: string;
  publishedAt?: string;
}

export interface IndexedWarcArchive {
  artifact: ExportArtifact;
  index: WarcIndexEntry[];
  pages: WarcPageEntry[];
}

export interface WarcBuildOptions {
  generatedAt?: Date;
  filename?: string;
  audience?: Partial<ExportAudienceSelection>;
}

export function buildWarcArchive(
  records: readonly ExportRecord[],
  options: WarcBuildOptions = {}
): ExportArtifact {
  return buildIndexedWarcArchive(records, options).artifact;
}

export function buildIndexedWarcArchive(
  records: readonly ExportRecord[],
  options: WarcBuildOptions = {}
): IndexedWarcArchive {
  const selectedRecords = options.audience === undefined
    ? [...records]
    : filterShareRecords(records, normalizeAudienceSelection(options.audience));
  const generatedAt = validDate(options.generatedAt) ?? new Date();
  const filename = sanitizeFilename(options.filename ?? "tweets.warc");
  const generatedAtIso = toWarcDate(generatedAt);
  const blocks: Uint8Array[] = [];
  const index: WarcIndexEntry[] = [];
  const pages: WarcPageEntry[] = [];
  let offset = 0;
  let occurrence = 0;

  const append = (input: WarcRecordInput, indexed?: Omit<WarcIndexEntry, "offset" | "length">): void => {
    const block = formatRecord({ ...input, occurrence: occurrence++ });
    blocks.push(block);
    if (indexed) index.push({ ...indexed, offset, length: block.length });
    offset += block.length;
  };

  append({
    mime: "application/warc-fields",
    body: [
      "software: Aviary",
      `format: ${WARC_VERSION}`,
      "conformsTo: https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/"
    ].join("\r\n"),
    recordType: "warcinfo",
    recordedAt: generatedAt,
    extraHeaders: { "WARC-Filename": filename }
  });

  const packageManifest = buildExportPackageManifest(selectedRecords, [], "", generatedAtIso);
  append({
    url: "urn:aviary:export-metadata",
    mime: "application/json",
    body: JSON.stringify({
      generator: "Aviary",
      generatedAt: generatedAtIso,
      count: records.length,
      metadataOnly: true,
      packageManifest
    }),
    recordType: "metadata",
    recordedAt: generatedAt
  });

  selectedRecords.forEach((record, recordIndex) => {
    const recordedAt = validDate(record.capturedAt) ?? generatedAt;
    const timestamp = toWarcDate(recordedAt);
    const summaryUrl = syntheticRecordUrl(record, recordIndex);
    const summaryBytes = ENCODER.encode(JSON.stringify(serializeExportRecord(record), null, 2));
    const summaryDigest = digestValue(summaryBytes);
    append({
      url: summaryUrl,
      mime: "application/json",
      body: summaryBytes,
      recordType: "resource",
      recordedAt,
      payloadDigest: summaryDigest
    });

    const pageUrl = syntheticPageUrl(record, recordIndex);
    const pageTitle = record.handle ? `@${record.handle} captured post` : `Captured post ${recordIndex + 1}`;
    const pageBytes = ENCODER.encode(renderReplayPage(record, pageTitle));
    const pageDigest = digestValue(pageBytes);
    append({
      url: pageUrl,
      mime: "application/http; msgtype=response",
      body: httpResponseBlock(pageBytes, "text/html; charset=utf-8", 200),
      recordType: "response",
      recordedAt,
      payloadDigest: pageDigest
    }, {
      url: pageUrl,
      timestamp,
      digest: pageDigest,
      mime: "text/html",
      status: 200
    });
    const publishedAt = validDate(record.createdAt);
    pages.push({
      url: pageUrl,
      ts: timestamp,
      title: pageTitle,
      capturedAt: timestamp,
      ...(publishedAt ? { publishedAt: toWarcDate(publishedAt) } : {})
    });

    for (const [mediaIndex, media] of mediaOf(record).entries()) {
      const capture = describeMediaCapture(media, record.capturedAt);
      const mediaRecordedAt = validDate(capture.capturedAt) ?? recordedAt;
      const mediaTimestamp = toWarcDate(mediaRecordedAt);
      const sourceUrl = normalizeHttpUrl(capture.sourceUrl);
      const mime = mediaMime(media);

      if (capture.status === "captured-bytes" && media.bytes instanceof Uint8Array) {
        const payloadDigest = digestValue(media.bytes);
        if (sourceUrl) {
          const responseStatus = validHttpStatus(media.httpStatus);
          if (responseStatus !== null) {
            const responseBlock = httpResponseBlock(media.bytes, mime, responseStatus, media.httpHeaders);
            append({
              url: sourceUrl,
              mime: "application/http; msgtype=response",
              body: responseBlock,
              recordType: "response",
              recordedAt: mediaRecordedAt,
              payloadDigest
            }, {
              url: sourceUrl,
              timestamp: mediaTimestamp,
              digest: payloadDigest,
              mime,
              status: responseStatus
            });
          } else {
            append({
              url: sourceUrl,
              mime,
              body: media.bytes,
              recordType: "resource",
              recordedAt: mediaRecordedAt,
              payloadDigest
            });
          }
        } else {
          const syntheticUrl = syntheticMediaUrl(recordIndex, mediaIndex, media);
          append({
            url: syntheticUrl,
            mime,
            body: media.bytes,
            recordType: "resource",
            recordedAt: mediaRecordedAt,
            payloadDigest
          });
        }
        continue;
      }

      append({
        url: sourceUrl ?? syntheticMediaUrl(recordIndex, mediaIndex, media),
        mime: "application/json",
        body: JSON.stringify({
          generator: "Aviary",
          metadataOnly: true,
          message: "The media body is not in this WARC; the manifest records whether it is retryable.",
          media: capture
        }),
        recordType: "metadata",
        recordedAt: mediaRecordedAt
      });
    }
  });

  return {
    artifact: {
      filename,
      contentType: "application/warc",
      data: concatenate(blocks, offset)
    },
    index: index.sort(compareIndexEntries),
    pages: uniquePages(pages)
  };
}

function mediaOf(record: ExportRecord): ExportMedia[] {
  return Array.isArray(record.media) ? record.media : [];
}

function validDate(value: Date | string | null | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toWarcDate(date: Date): string {
  return date.toISOString().replace(/\.[0-9]{3}Z$/, "Z");
}

function mediaMime(media: ExportMedia): string {
  if (media.type?.includes("/")) return media.type;
  if (media.type === "png") return "image/png";
  if (media.type === "webp") return "image/webp";
  if (media.kind === "video") return "video/mp4";
  if (media.kind === "audio") return "audio/mp4";
  if (media.kind === "subtitle") return "text/vtt";
  return "image/jpeg";
}

function mediaExtension(media: ExportMedia): string {
  const mime = mediaMime(media);
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "video/mp4") return "mp4";
  if (mime === "audio/mp4") return "m4a";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "text/vtt") return "vtt";
  if (mime === "text/srt") return "srt";
  if (mime === "application/ttml+xml" || mime === "text/ttml") return "ttml";
  return "jpg";
}

function syntheticRecordUrl(record: ExportRecord, recordIndex: number): string {
  const identity = encodeURIComponent(record.tweetId?.trim() || `record-${recordIndex + 1}`);
  return `https://aviary.invalid/records/${padIndex(recordIndex)}-${identity}.json`;
}

function syntheticPageUrl(record: ExportRecord, recordIndex: number): string {
  const identity = encodeURIComponent(record.tweetId?.trim() || `record-${recordIndex + 1}`);
  return `https://aviary.invalid/pages/${padIndex(recordIndex)}-${identity}.html`;
}

function syntheticMediaUrl(recordIndex: number, mediaIndex: number, media: ExportMedia): string {
  return `https://aviary.invalid/media/${padIndex(recordIndex)}-${padIndex(mediaIndex)}.${mediaExtension(media)}`;
}

function padIndex(index: number): string {
  return String(index + 1).padStart(6, "0");
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function renderReplayPage(record: ExportRecord, title: string): string {
  const original = normalizeHttpUrl(record.permalink);
  const authoredAt = validDate(record.createdAt) ?? validDate(record.capturedAt);
  const capturedAt = validDate(record.capturedAt);
  const authoredIso = authoredAt?.toISOString() ?? "unknown";
  const capturedIso = capturedAt?.toISOString() ?? "unknown";
  const media = mediaOf(record).map((entry) => {
    const source = normalizeHttpUrl(entry.sourceUrl || entry.url);
    if (!source) return "";
    const escaped = escapeHtml(source);
    if (entry.kind === "video") {
      return `<video controls preload="metadata" src="${escaped}"></video>`;
    }
    if (entry.kind === "audio") {
      return `<audio controls preload="metadata" src="${escaped}"></audio>`;
    }
    if (entry.kind === "subtitle") {
      return `<p><a href="${escaped}" rel="noreferrer">Captured captions${entry.language ? ` (${escapeHtml(entry.language)})` : ""}</a></p>`;
    }
    return `<img src="${escaped}" alt="${escapeHtml(entry.altText ?? "Captured post media")}">`;
  }).join("");
  const originalLink = original
    ? `<a href="${escapeHtml(original)}" rel="noreferrer">Original post</a>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;background:#07080a;color:#f2f4f7;font:16px/1.55 system-ui,sans-serif}
body{margin:0;padding:clamp(24px,6vw,72px)}main{max-width:680px;margin:auto}
article{background:#111318;border:1px solid #292d35;border-radius:12px;padding:24px;box-shadow:0 20px 60px #0008}
header{display:flex;justify-content:space-between;gap:16px;color:#aab2c0;font-size:14px}strong{color:#f2f4f7}
p{white-space:pre-wrap;font-size:18px}.media{display:grid;gap:10px;margin-top:18px}img,video{width:100%;border-radius:12px;background:#050506}
a{display:inline-block;margin-top:18px;color:#7dd3fc;text-underline-offset:3px}
</style>
</head>
<body><main><article><header><strong>${escapeHtml(record.handle ? `@${record.handle}` : record.displayName ?? "Captured post")}</strong><span><time datetime="${escapeHtml(authoredIso)}">Posted ${escapeHtml(authoredIso)}</time><br><small>Captured ${escapeHtml(capturedIso)}</small></span></header><p>${escapeHtml(record.text ?? "")}</p>${media ? `<div class="media">${media}</div>` : ""}${originalLink}</article></main></body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function httpResponseBlock(
  payload: Uint8Array,
  mime: string,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {}
): Uint8Array {
  const headers = [
    `HTTP/1.1 ${status} ${status === 200 ? "OK" : "Captured"}`,
    ...Object.entries(extraHeaders)
      .sort(([left], [right]) => left.localeCompare(right))
      .filter(([name]) => !/^(?:content-type|content-length|connection)$/i.test(name))
      .map(([name, value]) => `${sanitizeHeaderName(name)}: ${sanitizeHeaderValue(value)}`),
    `Content-Type: ${sanitizeHeaderValue(mime) || "application/octet-stream"}`,
    `Content-Length: ${payload.length}`,
    "Connection: close",
    "",
    ""
  ];
  const headerBytes = ENCODER.encode(headers.join("\r\n"));
  return concatenate([headerBytes, payload], headerBytes.length + payload.length);
}

function validHttpStatus(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) return null;
  return value;
}

/** Strip control characters from untrusted WARC header values. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function formatRecord(input: WarcRecordInput): Uint8Array {
  const recordType = input.recordType ?? "resource";
  const recordedAt = toWarcDate(validDate(input.recordedAt) ?? new Date());
  const bodyBytes = typeof input.body === "string" ? ENCODER.encode(input.body) : input.body;
  const url = sanitizeHeaderValue(input.url ?? "");
  const mime = sanitizeHeaderValue(input.mime) || "application/octet-stream";
  const blockDigest = digestValue(bodyBytes);
  const recordId = sanitizeHeaderValue(input.recordId ?? deterministicRecordId({
    recordType,
    recordedAt,
    url,
    mime,
    blockDigest,
    occurrence: input.occurrence ?? 0
  }));
  const headerLines = [
    WARC_VERSION,
    `WARC-Type: ${recordType}`,
    ...(recordType === "warcinfo" ? [] : [`WARC-Target-URI: ${url || "urn:aviary:unknown"}`]),
    `WARC-Date: ${recordedAt}`,
    `WARC-Record-ID: ${recordId.startsWith("<") ? recordId : `<${recordId}>`}`,
    ...Object.entries(input.extraHeaders ?? {}).map(
      ([name, value]) => `${sanitizeHeaderName(name)}: ${sanitizeHeaderValue(value)}`
    ),
    `WARC-Block-Digest: ${blockDigest}`,
    ...(input.payloadDigest ? [`WARC-Payload-Digest: ${sanitizeHeaderValue(input.payloadDigest)}`] : []),
    `Content-Type: ${mime}`,
    `Content-Length: ${bodyBytes.length}`
  ];
  const headerBytes = ENCODER.encode(`${headerLines.join("\r\n")}\r\n\r\n`);
  const trailer = ENCODER.encode("\r\n\r\n");
  return concatenate([headerBytes, bodyBytes, trailer], headerBytes.length + bodyBytes.length + trailer.length);
}

function sanitizeHeaderName(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9-]/g, "");
  return clean || "X-Aviary-Header";
}

function deterministicRecordId(parts: {
  recordType: string;
  recordedAt: string;
  url: string;
  mime: string;
  blockDigest: string;
  occurrence: number;
}): string {
  const hex = sha256Hex(ENCODER.encode([
    parts.recordType,
    parts.recordedAt,
    parts.url,
    parts.mime,
    parts.blockDigest,
    String(parts.occurrence)
  ].join("\n")));
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return `<urn:uuid:${uuid}>`;
}

function digestValue(data: Uint8Array): string {
  return `sha256:${hexToBase32(sha256Hex(data))}`;
}

function hexToBase32(hex: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let value = 0;
  let bits = 0;
  let output = "";
  for (let index = 0; index < hex.length; index += 2) {
    value = (value << 8) | Number.parseInt(hex.slice(index, index + 2), 16);
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function concatenate(blocks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const block of blocks) {
    output.set(block, cursor);
    cursor += block.length;
  }
  return output;
}

function sanitizeFilename(value: string): string {
  const clean = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return clean.toLowerCase().endsWith(".warc") ? clean : `${clean || "tweets"}.warc`;
}

function compareIndexEntries(left: WarcIndexEntry, right: WarcIndexEntry): number {
  return left.url.localeCompare(right.url) || left.timestamp.localeCompare(right.timestamp) || left.offset - right.offset;
}

function uniquePages(entries: readonly WarcPageEntry[]): WarcPageEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.url}\n${entry.ts}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
