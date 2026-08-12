import { buildExportPackageManifest, describeMediaCapture, serializeExportRecord } from "./assets";
import type { ExportArtifact, ExportMedia, ExportRecord } from "./types";

const ENCODER = new TextEncoder();

export interface WarcRecordInput {
  url: string;
  mime: string;
  body: string | Uint8Array;
  recordType?: "response" | "resource" | "metadata";
  recordedAt?: Date;
}

export function buildWarcArchive(records: readonly ExportRecord[]): ExportArtifact {
  const blocks: Uint8Array[] = [];
  const packageManifest = buildExportPackageManifest(records, []);
  blocks.push(formatRecord({
    url: "metadata://aviary",
    mime: "application/json",
    body: JSON.stringify({
      generator: "Aviary",
      generatedAt: new Date().toISOString(),
      count: records.length,
      metadataOnly: true,
      packageManifest
    }),
    recordType: "metadata"
  }));

  for (const record of records) {
    const summary = JSON.stringify(serializeExportRecord(record), null, 2);
    blocks.push(formatRecord({
      url: record.permalink ?? `tweet://${record.tweetId ?? "unknown"}`,
      mime: "application/json",
      body: summary,
      recordType: "resource"
    }));
    for (const media of Array.isArray(record.media) ? record.media : []) {
      const capture = describeMediaCapture(media, record.capturedAt);
      const recordedAt = capture.capturedAt ? validDate(capture.capturedAt) : undefined;
      if (capture.status === "captured-bytes" && media.bytes instanceof Uint8Array) {
        blocks.push(formatRecord({
          url: capture.sourceUrl || `media://${record.tweetId ?? "unknown"}/${media.kind}`,
          mime: mediaMime(media),
          body: media.bytes,
          recordType: "response",
          ...(recordedAt ? { recordedAt } : {})
        }));
        continue;
      }

      blocks.push(formatRecord({
        url: capture.sourceUrl || `media://${record.tweetId ?? "unknown"}/${media.kind}`,
        mime: "application/json",
        body: JSON.stringify({
          generator: "Aviary",
          metadataOnly: true,
          message: "The media body is not in this WARC; the manifest records whether it is retryable.",
          media: capture
        }),
        recordType: "metadata",
        ...(recordedAt ? { recordedAt } : {})
      }));
    }
  }

  const totalSize = blocks.reduce((acc, block) => acc + block.length, 0);
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const block of blocks) {
    out.set(block, cursor);
    cursor += block.length;
  }

  return {
    filename: "tweets.warc",
    contentType: "application/warc",
    data: out
  };
}

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function mediaMime(media: ExportMedia): string {
  if (media.type?.includes("/")) return media.type;
  if (media.type === "png") return "image/png";
  if (media.type === "webp") return "image/webp";
  if (media.kind === "video") return "video/mp4";
  return "image/jpeg";
}

/**
 * WARC headers are CRLF-delimited, so a CR or LF inside a value does not escape — it ends the
 * line. A scraped permalink or media URL carrying one injects arbitrary headers (including a
 * forged `WARC-Type`) and, once the injected text is mistaken for a record boundary, the reader
 * fails the whole file: warcio raises ArchiveLoadFailed and every later record is lost.
 *
 * These values are not all browser-normalized — `library/archive-import.ts` feeds records
 * straight out of a downloaded X archive, where a field can hold anything. Strip CR, LF and the
 * other C0 controls rather than trusting the source, the same way CSV export escapes formulas.
 */
function sanitizeHeaderValue(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    // C0 controls (CR and LF among them) and DEL end or corrupt a header line. Written as a
    // code-point test rather than a character class so no control byte lives in this source.
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.split(" ").filter((part) => part.length > 0).join(" ");
}

export function formatRecord(input: WarcRecordInput): Uint8Array {
  const recordType = input.recordType ?? "resource";
  const recordedAt = (input.recordedAt ?? new Date()).toISOString().replace(/\.[0-9]{3}Z$/, "Z");
  const id = `<urn:uuid:${randomUuid()}>`;
  const bodyBytes = typeof input.body === "string" ? ENCODER.encode(input.body) : input.body;
  const url = sanitizeHeaderValue(input.url);
  const mime = sanitizeHeaderValue(input.mime);
  const headerLines = [
    "WARC/1.1",
    `WARC-Type: ${recordType}`,
    // A record with no usable target still has to carry the field, or readers reject it.
    `WARC-Target-URI: ${url.length > 0 ? url : "urn:aviary:unknown"}`,
    `WARC-Date: ${recordedAt}`,
    `WARC-Record-ID: ${id}`,
    `Content-Type: ${mime.length > 0 ? mime : "application/octet-stream"}`,
    `Content-Length: ${bodyBytes.length}`
  ];
  const headerBytes = ENCODER.encode(`${headerLines.join("\r\n")}\r\n\r\n`);
  const trailer = ENCODER.encode("\r\n\r\n");

  const block = new Uint8Array(headerBytes.length + bodyBytes.length + trailer.length);
  block.set(headerBytes, 0);
  block.set(bodyBytes, headerBytes.length);
  block.set(trailer, headerBytes.length + bodyBytes.length);
  return block;
}

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Tiny RFC4122 v4 fallback that does not require WebCrypto.
  const random = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${random(8)}-${random(4)}-4${random(3)}-a${random(3)}-${random(12)}`;
}
