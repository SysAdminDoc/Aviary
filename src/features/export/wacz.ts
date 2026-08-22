import { serializeExportRecord, sha256Hex } from "./assets";
import type { ExportArtifact, ExportRecord } from "./types";
import { buildIndexedWarcArchive, type WarcIndexEntry } from "./warc";
import type { WaczDigestSigner, WaczSignatureData } from "./wacz-signing";
import { buildStoreZip, type ZipFileEntry } from "./zip-store";

const ENCODER = new TextEncoder();

export const WACZ_VERSION = "1.1.1";
export const CDXJ_VERSION = "0.1.0";
export const REPLAYWEB_URL = "https://replayweb.page/";

const WARC_PATH = "archive/aviary.warc";
const INDEX_PATH = "indexes/index.cdxj";
const PAGES_PATH = "pages/pages.jsonl";

export interface WaczBuildOptions {
  generatedAt?: Date;
}

export interface WaczEstimate {
  records: number;
  estimatedBytes: number;
}

export interface PreparedWacz {
  generatedAt: Date;
  datapackageBytes: Uint8Array;
  datapackageHash: string;
  resourceEntries: ZipFileEntry[];
}

export function buildWaczArchive(
  records: readonly ExportRecord[],
  options: WaczBuildOptions = {}
): ExportArtifact {
  return finishWaczArchive(prepareWaczArchive(records, options));
}

export async function buildSignedWaczArchive(
  records: readonly ExportRecord[],
  signer: WaczDigestSigner,
  options: WaczBuildOptions = {}
): Promise<ExportArtifact> {
  const prepared = prepareWaczArchive(records, options);
  const signedData = await signer.sign(prepared.datapackageHash, prepared.generatedAt.toISOString());
  if (signedData.hash !== prepared.datapackageHash) {
    throw new Error("WACZ signer returned a signature for a different manifest hash");
  }
  return finishWaczArchive(prepared, signedData);
}

export function prepareWaczArchive(
  records: readonly ExportRecord[],
  options: WaczBuildOptions
): PreparedWacz {
  const generatedAt = validDate(options.generatedAt) ?? new Date();
  const warc = buildIndexedWarcArchive(records, {
    generatedAt,
    filename: "aviary.warc"
  });
  const indexBytes = ENCODER.encode(renderCdxj(warc.index, "aviary.warc"));
  const pagesBytes = ENCODER.encode(renderPages(warc.pages));
  const resourceEntries: ZipFileEntry[] = [
    { filename: WARC_PATH, data: warc.artifact.data, date: generatedAt },
    { filename: INDEX_PATH, data: indexBytes, date: generatedAt },
    { filename: PAGES_PATH, data: pagesBytes, date: generatedAt }
  ];
  const datapackage = {
    profile: "data-package",
    wacz_version: WACZ_VERSION,
    created: generatedAt.toISOString(),
    software: "Aviary",
    resources: resourceEntries.map((entry) => ({
      name: resourceName(entry.filename),
      path: entry.filename,
      hash: `sha256:${sha256Hex(entry.data)}`,
      bytes: entry.data.length
    }))
  };
  const datapackageBytes = ENCODER.encode(`${JSON.stringify(datapackage, null, 2)}\n`);
  return {
    generatedAt,
    datapackageBytes,
    datapackageHash: `sha256:${sha256Hex(datapackageBytes)}`,
    resourceEntries
  };
}

export function finishWaczArchive(prepared: PreparedWacz, signedData?: WaczSignatureData): ExportArtifact {
  const digestBytes = ENCODER.encode(`${JSON.stringify({
    path: "datapackage.json",
    hash: prepared.datapackageHash,
    ...(signedData ? { signedData } : {})
  }, null, 2)}\n`);
  const data = buildStoreZip([
    ...prepared.resourceEntries,
    { filename: "datapackage.json", data: prepared.datapackageBytes, date: prepared.generatedAt },
    { filename: "datapackage-digest.json", data: digestBytes, date: prepared.generatedAt }
  ]);

  return {
    filename: `aviary-${filenameTimestamp(prepared.generatedAt)}.wacz`,
    contentType: "application/wacz",
    data
  };
}

export function estimateWaczBytes(records: readonly ExportRecord[]): WaczEstimate {
  let contentBytes = 12_000;
  for (const record of records) {
    contentBytes += ENCODER.encode(JSON.stringify(serializeExportRecord(record))).length + 1_500;
    for (const media of Array.isArray(record.media) ? record.media : []) {
      contentBytes += media.bytes instanceof Uint8Array ? media.bytes.length + 900 : 700;
    }
  }
  return {
    records: records.length,
    estimatedBytes: contentBytes
  };
}

export function renderCdxj(entries: readonly WarcIndexEntry[], filename = "aviary.warc"): string {
  const lines = entries.map((entry) => `${toSurt(entry.url)} ${toCdxTimestamp(entry.timestamp)} ${JSON.stringify({
    url: entry.url,
    digest: entry.digest,
    mime: entry.mime,
    status: entry.status,
    filename,
    offset: entry.offset,
    length: entry.length
  })}`);
  lines.sort(compareUtf8);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function toSurt(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const host = hostname.includes(":")
    ? hostname
    : hostname.split(".").filter(Boolean).reverse().join(",");
  const port = url.port ? `:${url.port}` : "";
  return `${host}${port})${url.pathname || "/"}${url.search}`;
}

function renderPages(entries: readonly { url: string; ts: string; title?: string }[]): string {
  const lines = [JSON.stringify({
    format: "json-pages-1.0",
    id: "pages",
    title: "All Pages"
  })];
  entries.forEach((entry, index) => {
    lines.push(JSON.stringify({
      id: `page-${String(index + 1).padStart(6, "0")}`,
      url: entry.url,
      ts: entry.ts,
      ...(entry.title ? { title: entry.title } : {})
    }));
  });
  return `${lines.join("\n")}\n`;
}

function toCdxTimestamp(value: string): string {
  const date = validDate(value);
  if (!date) throw new TypeError(`Invalid CDX timestamp: ${value}`);
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = ENCODER.encode(left);
  const rightBytes = ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function resourceName(path: string): string {
  return path.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function filenameTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.[0-9]{3}Z$/, "Z");
}

function validDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
