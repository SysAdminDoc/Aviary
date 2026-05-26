import type { ExportArtifact, ExportRecord } from "./types";

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
  blocks.push(formatRecord({
    url: "metadata://aviary",
    mime: "application/json",
    body: JSON.stringify({
      generator: "Aviary",
      generatedAt: new Date().toISOString(),
      count: records.length
    }),
    recordType: "metadata"
  }));

  for (const record of records) {
    const summary = JSON.stringify(record, null, 2);
    blocks.push(formatRecord({
      url: record.permalink ?? `tweet://${record.tweetId ?? "unknown"}`,
      mime: "application/json",
      body: summary,
      recordType: "resource"
    }));
    for (const media of record.media) {
      blocks.push(formatRecord({
        url: media.url,
        mime: media.type ?? "application/octet-stream",
        body: `Aviary captured the resource URL for ${media.kind} ${media.url} without re-downloading the body. Use the Aviary media downloader to fetch the bytes if needed.`,
        recordType: "metadata"
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

export function formatRecord(input: WarcRecordInput): Uint8Array {
  const recordType = input.recordType ?? "resource";
  const recordedAt = (input.recordedAt ?? new Date()).toISOString().replace(/\.[0-9]{3}Z$/, "Z");
  const id = `<urn:uuid:${randomUuid()}>`;
  const bodyBytes = typeof input.body === "string" ? ENCODER.encode(input.body) : input.body;
  const headerLines = [
    "WARC/1.1",
    `WARC-Type: ${recordType}`,
    `WARC-Target-URI: ${input.url}`,
    `WARC-Date: ${recordedAt}`,
    `WARC-Record-ID: ${id}`,
    `Content-Type: ${input.mime}`,
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
