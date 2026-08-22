import { crc32 } from "./zip-store.ts";

export interface ZipReadEntry {
  filename: string;
  data: Uint8Array;
  crcOk: boolean;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export const ZIP_LIMITS = {
  maxEntries: 4096,
  maxEntryUncompressedBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 100 * 1024 * 1024
} as const;

const TEXT_DECODER = new TextDecoder();

export class UnsupportedZipMethodError extends Error {
  constructor(method: number, filename: string) {
    super(`Unsupported ZIP compression method ${method} for "${filename}"`);
    this.name = "UnsupportedZipMethodError";
  }
}

export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

interface RawZipEntry {
  filename: string;
  method: number;
  uncompressedSize: number;
  declaredCrc: number;
  /** Bytes exactly as stored: identical to the file for STORE, deflate stream for method 8. */
  raw: Uint8Array;
}

/**
 * Reads a ZIP written with STORE only.
 *
 * Kept for Aviary's own archives (`zip-store.ts` never compresses) and for callers that cannot
 * await. Anything produced by a normal zip tool needs {@link readZip}.
 */
export function readStoreZip(data: Uint8Array): ZipReadEntry[] {
  let totalUncompressed = 0;
  return parseEntries(data).map((entry) => {
    if (entry.method !== METHOD_STORE) {
      throw new UnsupportedZipMethodError(entry.method, entry.filename);
    }
    totalUncompressed += entry.raw.length;
    if (totalUncompressed > ZIP_LIMITS.maxTotalUncompressedBytes) {
      throw new ZipLimitError("ZIP expands beyond the 100 MiB archive limit.");
    }
    return finish(entry, entry.raw);
  });
}

/**
 * Reads a ZIP written with STORE or DEFLATE.
 *
 * Official X archives are produced by a standard zip tool, so their data files are deflated —
 * which meant the STORE-only reader rejected essentially every archive the import feature exists
 * to read. Inflation uses the platform's own `DecompressionStream`, so there is no dependency to
 * vet and nothing to keep patched.
 */
export async function readZip(data: Uint8Array): Promise<ZipReadEntry[]> {
  const results: ZipReadEntry[] = [];
  let totalUncompressed = 0;
  for (const entry of parseEntries(data)) {
    if (entry.method === METHOD_STORE) {
      totalUncompressed += entry.raw.length;
      if (totalUncompressed > ZIP_LIMITS.maxTotalUncompressedBytes) {
        throw new ZipLimitError("ZIP expands beyond the 100 MiB archive limit.");
      }
      results.push(finish(entry, entry.raw));
      continue;
    }
    if (entry.method !== METHOD_DEFLATE) {
      throw new UnsupportedZipMethodError(entry.method, entry.filename);
    }
    const remaining = ZIP_LIMITS.maxTotalUncompressedBytes - totalUncompressed;
    const inflated = await inflateRaw(
      entry.raw,
      entry.filename,
      Math.min(entry.uncompressedSize, remaining)
    );
    totalUncompressed += inflated.length;
    results.push(finish(entry, inflated));
  }
  return results;
}

/** True when this build can inflate; lets callers explain the failure instead of guessing. */
export function canInflate(): boolean {
  return typeof globalThis.DecompressionStream === "function";
}

async function inflateRaw(bytes: Uint8Array, filename: string, maxBytes: number): Promise<Uint8Array> {
  if (!canInflate()) {
    throw new UnsupportedZipMethodError(METHOD_DEFLATE, filename);
  }
  // "deflate-raw" is the bare stream a ZIP stores; "deflate" would expect a zlib header.
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      const chunk = next.value as Uint8Array;
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw new ZipLimitError(`ZIP entry "${filename}" expands beyond its size limit.`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function finish(entry: RawZipEntry, data: Uint8Array): ZipReadEntry {
  return {
    filename: entry.filename,
    data: new Uint8Array(data),
    // Checked against the inflated bytes, which is what the CRC in the header describes.
    crcOk: crc32(data) === entry.declaredCrc && data.length === entry.uncompressedSize
  };
}

function parseEntries(data: Uint8Array): RawZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = locateEOCD(view, data.length);
  if (eocd === -1) {
    return [];
  }
  const entryCount = view.getUint16(eocd + 10, true);
  if (entryCount > ZIP_LIMITS.maxEntries) {
    throw new ZipLimitError(`ZIP contains more than ${ZIP_LIMITS.maxEntries} entries.`);
  }
  const centralOffset = view.getUint32(eocd + 16, true);

  const results: RawZipEntry[] = [];
  let cursor = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > data.length || view.getUint32(cursor, true) !== CENTRAL_HEADER) {
      break;
    }
    const entryStart = cursor;
    const method = view.getUint16(entryStart + 10, true);
    const declaredCrc = view.getUint32(entryStart + 16, true);
    const compressedSize = view.getUint32(entryStart + 20, true);
    const uncompressedSize = view.getUint32(entryStart + 24, true);
    if (uncompressedSize > ZIP_LIMITS.maxEntryUncompressedBytes) {
      throw new ZipLimitError(
        `ZIP entry exceeds the ${ZIP_LIMITS.maxEntryUncompressedBytes / (1024 * 1024)} MiB entry limit.`
      );
    }
    const nameLength = view.getUint16(entryStart + 28, true);
    const extraLength = view.getUint16(entryStart + 30, true);
    const commentLength = view.getUint16(entryStart + 32, true);
    const localOffset = view.getUint32(entryStart + 42, true);
    const filename = TEXT_DECODER.decode(
      data.subarray(entryStart + 46, entryStart + 46 + nameLength)
    );
    cursor = entryStart + 46 + nameLength + extraLength + commentLength;

    if (filename.endsWith("/")) {
      continue;
    }
    if (localOffset + 30 > data.length || view.getUint32(localOffset, true) !== LOCAL_HEADER) {
      continue;
    }

    // The local header carries its own name/extra lengths; the central copy's extra field is a
    // different record and using it here would land the read inside the file data.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const fileStart = localOffset + 30 + localNameLength + localExtraLength;
    const fileEnd = Math.min(fileStart + compressedSize, data.length);

    results.push({
      filename,
      method,
      uncompressedSize,
      declaredCrc,
      raw: data.subarray(fileStart, fileEnd)
    });
  }

  return results;
}

function locateEOCD(view: DataView, length: number): number {
  for (let i = length - 22; i >= Math.max(0, length - 0xffff - 22); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      return i;
    }
    if (view.getUint32(i, true) === ZIP64_LOCATOR) {
      // Aviary doesn't write ZIP64 archives, but treat the locator as a hint and keep searching.
      continue;
    }
  }
  return -1;
}
