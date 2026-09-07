import type { ExportMedia, ExportRecord, MediaCaptureStatus } from "./types.ts";
import { normalizePostLanguage } from "./language.ts";
import { normalizeAudience } from "./audience.ts";

export interface ExportMediaManifest {
  status: MediaCaptureStatus;
  sourceUrl: string;
  capturedAt: string | null;
  byteLength: number | null;
  sha256: string | null;
  retryable: boolean;
  packagePath?: string;
  error?: string;
}

export interface ExportMediaAsset {
  path: string;
  data: Uint8Array;
  contentType: string;
}

export interface PreparedExportPackage {
  records: ExportRecord[];
  assets: ExportMediaAsset[];
}

export interface ExportPackageFile {
  path: string;
  kind: "artifact" | "media";
  contentType: string;
  byteLength: number;
  sha256: string;
}

export interface ExportPackageManifest {
  schemaVersion: 1;
  generator: "Aviary";
  generatedAt: string;
  recordCount: number;
  files: ExportPackageFile[];
  media: Array<{
    recordIndex: number;
    recordId: string | null;
    kind: ExportMedia["kind"];
    capture: ExportMediaManifest;
  }>;
  summary: {
    capturedBytes: number;
    remoteReferences: number;
    missing: number;
    retryable: number;
  };
  offlineReady: boolean;
  networkRequiredToComplete: boolean;
}

export type MediaFingerprintKind = "photo" | "video" | "thumbnail" | "audio" | "subtitle";

/**
 * Durable media identity. Only hashes reach storage, never the source URL.
 *
 * `identityHash` collapses X's size variants before any request. `exactHash` is SHA-256 over the
 * response bytes. `perceptualHash` is a 256-bit difference hash over decoded image pixels and is
 * intentionally optional because visually similar images can collide.
 */
export interface MediaFingerprint {
  identityHash: string;
  exactHash?: string;
  perceptualHash?: string;
}

export const PERCEPTUAL_HASH_WIDTH = 17;
export const PERCEPTUAL_HASH_HEIGHT = 16;
export const PERCEPTUAL_MATCH_DISTANCE = 12;

/**
 * Returns the durable meaning of a media entry. A URL is never treated as captured content, and
 * a blank/invalid URL is never presented as a link that an offline reader could fetch later.
 */
export function describeMediaCapture(
  media: ExportMedia,
  fallbackCapturedAt: string | null = null
): ExportMediaManifest {
  const sourceUrl = cleanText(media.sourceUrl ?? media.url);
  const bytes = media.bytes instanceof Uint8Array ? media.bytes : null;
  const hasRemoteSource = /^https?:\/\//i.test(sourceUrl);
  const status: MediaCaptureStatus = bytes
    ? "captured-bytes"
    : media.captureStatus === "missing" || !hasRemoteSource
      ? "missing"
      : "remote-reference";
  const byteLength = bytes
    ? bytes.byteLength
    : finiteByteLength(media.byteLength);
  const sha256 = bytes
    ? cleanChecksum(media.sha256) ?? sha256Hex(bytes)
    : cleanChecksum(media.sha256);
  const capturedAt = cleanText(media.capturedAt ?? fallbackCapturedAt) || null;
  const error = cleanText(media.captureError);

  return {
    status,
    sourceUrl,
    capturedAt,
    byteLength,
    sha256,
    retryable: status !== "captured-bytes" && hasRemoteSource,
    ...(status === "captured-bytes" && cleanText(media.assetPath)
      ? { packagePath: cleanText(media.assetPath)! }
      : {}),
    ...(error ? { error } : {})
  };
}

/** Removes transient Uint8Array data while retaining an explicit capture manifest. */
export function serializeExportMedia(
  media: ExportMedia,
  fallbackCapturedAt: string | null = null
): Record<string, unknown> {
  const capture = describeMediaCapture(media, fallbackCapturedAt);
  const serialized: Record<string, unknown> = {
    kind: media.kind,
    url: media.url,
    capture
  };
  if (media.width !== undefined) serialized.width = media.width;
  if (media.height !== undefined) serialized.height = media.height;
  if (media.bitrate !== undefined) serialized.bitrate = media.bitrate;
  if (media.type !== undefined) serialized.type = media.type;
  if (media.altText !== undefined) serialized.altText = media.altText;
  if (media.language !== undefined) serialized.language = media.language;
  if (media.label !== undefined) serialized.label = media.label;
  const httpStatus = media.httpStatus;
  if (typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
    serialized.httpStatus = httpStatus;
  }
  return serialized;
}

export function serializeExportRecord(record: ExportRecord): Record<string, unknown> {
  return {
    ...record,
    language: normalizePostLanguage(record.language),
    audience: normalizeAudience(record.audience),
    media: mediaOf(record).map((media) => serializeExportMedia(media, record.capturedAt))
  };
}

export function serializeExportRecords(records: readonly ExportRecord[]): Array<Record<string, unknown>> {
  return records.map(serializeExportRecord);
}

/** Assigns safe relative asset names and returns the bytes that belong in the ZIP. */
export function prepareExportPackage(records: readonly ExportRecord[]): PreparedExportPackage {
  const assets: ExportMediaAsset[] = [];
  let assetNumber = 0;
  const prepared = records.map((record) => {
    const media = mediaOf(record).map((entry) => {
      if (!(entry.bytes instanceof Uint8Array)) {
        return { ...entry };
      }
      const extension = mediaExtension(entry);
      const path = `media/${String(++assetNumber).padStart(6, "0")}-${entry.kind}.${extension}`;
      assets.push({
        path,
        data: new Uint8Array(entry.bytes),
        contentType: mediaContentType(entry, extension)
      });
      return { ...entry, assetPath: path };
    });
    return { ...record, media };
  });
  return { records: prepared, assets };
}

export function buildExportPackageManifest(
  records: readonly ExportRecord[],
  files: readonly ExportPackageFile[],
  packageRoot = "",
  generatedAt = new Date().toISOString()
): ExportPackageManifest {
  const media: ExportPackageManifest["media"] = [];
  let capturedBytes = 0;
  let remoteReferences = 0;
  let missing = 0;
  let retryable = 0;

  records.forEach((record, recordIndex) => {
    mediaOf(record).forEach((entry) => {
      const capture = describeMediaCapture(entry, record.capturedAt);
      const packagePath = capture.packagePath ? joinPackagePath(packageRoot, capture.packagePath) : undefined;
      const normalizedCapture = packagePath ? { ...capture, packagePath } : capture;
      media.push({
        recordIndex,
        recordId: record.tweetId,
        kind: entry.kind,
        capture: normalizedCapture
      });
      if (capture.status === "captured-bytes") {
        capturedBytes += capture.byteLength ?? 0;
      } else if (capture.status === "remote-reference") {
        remoteReferences += 1;
      } else {
        missing += 1;
      }
      if (capture.retryable) retryable += 1;
    });
  });

  return {
    schemaVersion: 1,
    generator: "Aviary",
    generatedAt,
    recordCount: records.length,
    files: files.map((file) => ({ ...file })),
    media,
    summary: { capturedBytes, remoteReferences, missing, retryable },
    offlineReady: remoteReferences === 0 && missing === 0,
    networkRequiredToComplete: remoteReferences > 0 || retryable > 0
  };
}

function mediaOf(record: ExportRecord): ExportMedia[] {
  return Array.isArray(record.media) ? record.media : [];
}

/** SHA-256 is kept synchronous so ZIP/WARC builders can checksum bytes without an async gap. */
export function sha256Hex(data: Uint8Array): string {
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = data.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ]);
  const words = new Uint32Array(64);

  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(block + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15]!, 7) ^ rotateRight(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rotateRight(words[index - 2]!, 17) ^ rotateRight(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index]! + words[index]!) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

/** Uses the browser's asynchronous digest so callers can enforce a wall-clock deadline. */
export async function sha256HexAsync(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Asynchronous SHA-256 is unavailable in this browser.");
  }
  const digest = await subtle.digest("SHA-256", data.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Hashes a stable X asset identity, not the mutable size URL that happened to render. */
export function mediaIdentityHash(
  kind: MediaFingerprintKind,
  sourceUrl: string,
  mediaId: string | null
): string {
  const identity = cleanText(mediaId) || mediaIdentityFromUrl(sourceUrl) || canonicalMediaUrl(sourceUrl);
  return sha256Hex(new TextEncoder().encode(`aviary-media:${kind}:${identity}`));
}

/**
 * Produces a 256-bit difference hash from decoded RGBA pixels.
 *
 * The caller supplies the fixed 17 by 16 sample. Keeping the comparison pure makes the matching
 * contract testable without relying on a browser image decoder.
 */
export function perceptualHashFromRgba(
  rgba: Uint8ClampedArray,
  width = PERCEPTUAL_HASH_WIDTH,
  height = PERCEPTUAL_HASH_HEIGHT
): string {
  if (width !== PERCEPTUAL_HASH_WIDTH || height !== PERCEPTUAL_HASH_HEIGHT) {
    throw new RangeError(`Perceptual samples must be ${PERCEPTUAL_HASH_WIDTH} by ${PERCEPTUAL_HASH_HEIGHT}.`);
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError("Perceptual sample length does not match its dimensions.");
  }

  const bytes = new Uint8Array(32);
  let bit = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const left = pixelLuma(rgba, (y * width + x) * 4);
      const right = pixelLuma(rgba, (y * width + x + 1) * 4);
      if (left > right) {
        bytes[Math.trunc(bit / 8)]! |= 1 << (7 - (bit % 8));
      }
      bit += 1;
    }
  }
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/** Decodes captured image bytes and normalizes them to the sample used by the difference hash. */
export async function perceptualImageHash(
  bytes: Uint8Array,
  contentType = "image/*"
): Promise<string | null> {
  if (typeof createImageBitmap !== "function") {
    return null;
  }
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer], { type: contentType }));
  try {
    const canvas = createHashCanvas();
    const context = canvas.getContext("2d", { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0, PERCEPTUAL_HASH_WIDTH, PERCEPTUAL_HASH_HEIGHT);
    const sample = context.getImageData(
      0,
      0,
      PERCEPTUAL_HASH_WIDTH,
      PERCEPTUAL_HASH_HEIGHT
    );
    return perceptualHashFromRgba(sample.data);
  } finally {
    bitmap.close();
  }
}

/** Number of differing bits between two equal-length hexadecimal signatures. */
export function hexadecimalHammingDistance(left: string, right: string): number {
  if (!/^[0-9a-f]+$/i.test(left) || left.length !== right.length || !/^[0-9a-f]+$/i.test(right)) {
    return Number.POSITIVE_INFINITY;
  }
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    distance += NIBBLE_BITS[Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16)]!;
  }
  return distance;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function pixelLuma(rgba: Uint8ClampedArray, offset: number): number {
  return rgba[offset]! * 299 + rgba[offset + 1]! * 587 + rgba[offset + 2]! * 114;
}

function createHashCanvas(): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(PERCEPTUAL_HASH_WIDTH, PERCEPTUAL_HASH_HEIGHT);
  }
  if (typeof document === "undefined") {
    throw new Error("No image canvas is available in this context.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = PERCEPTUAL_HASH_WIDTH;
  canvas.height = PERCEPTUAL_HASH_HEIGHT;
  return canvas;
}

function mediaIdentityFromUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname.toLowerCase() === "pbs.twimg.com") {
      return /^\/media\/([A-Za-z0-9_-]+)/i.exec(url.pathname)?.[1] ?? "";
    }
  } catch {
    // The canonical fallback below handles malformed or relative values without throwing.
  }
  return "";
}

function canonicalMediaUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    for (const key of ["name", "format", "width", "height", "tag"]) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return cleanText(sourceUrl);
  }
}

function cleanText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanChecksum(value: string | undefined): string | null {
  const checksum = cleanText(value).toLowerCase();
  return /^[0-9a-f]{64}$/.test(checksum) ? checksum : null;
}

function finiteByteLength(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function joinPackagePath(root: string, path: string): string {
  return root ? `${root.replace(/\/+$/g, "")}/${path}` : path;
}

function mediaExtension(media: ExportMedia): string {
  const type = cleanText(media.type).toLowerCase();
  const fromType = type.includes("/") ? type.split("/").at(-1) ?? "" : type;
  const fromUrl = /[.?](?:format=)?([a-z0-9]{2,5})(?:[?#]|$)/i.exec(media.url)?.[1]?.toLowerCase() ?? "";
  const candidate = fromType || fromUrl || defaultMediaExtension(media.kind);
  if (candidate.includes("ttml") || candidate.includes("dfxp")) return "ttml";
  if (candidate === "jpeg") return "jpg";
  return /^[a-z0-9]{2,5}$/.test(candidate) ? candidate : defaultMediaExtension(media.kind);
}

function mediaContentType(media: ExportMedia, extension: string): string {
  const declared = cleanText(media.type);
  if (declared.includes("/")) return declared;
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "mp4") return "video/mp4";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "ogg" || extension === "opus") return "audio/ogg";
  if (extension === "vtt") return "text/vtt";
  if (extension === "srt") return "text/srt";
  if (extension === "ttml") return "application/ttml+xml";
  return "application/octet-stream";
}

function defaultMediaExtension(kind: ExportMedia["kind"]): string {
  if (kind === "video") return "mp4";
  if (kind === "audio") return "m4a";
  if (kind === "subtitle") return "vtt";
  return kind === "photo" || kind === "thumbnail" ? "jpg" : "bin";
}

const SHA256_K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const NIBBLE_BITS = Uint8Array.from([0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]);
