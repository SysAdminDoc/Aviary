import { crc32 } from "./zip-store.ts";

export interface ZipReadEntry {
  filename: string;
  data: Uint8Array;
  crcOk: boolean;
}

/** A random-readable archive source backed by staged chunks, a File, or an in-memory fixture. */
export interface ZipByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export const ZIP_SOURCE_READ_BYTES = 4 * 1024 * 1024;
export const ZIP_MAX_ALLOCATOR_BYTES = 8 * 1024 * 1024;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

export const ZIP_LIMITS = {
  maxEntries: 4096,
  maxCentralDirectoryBytes: 4 * 1024 * 1024,
  maxEntryCompressedBytes: 25 * 1024 * 1024,
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

interface SourceZipEntry {
  filename: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  declaredCrc: number;
  localOffset: number;
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

/**
 * Read a ZIP from a random-readable source without first copying the archive into one byte array.
 * The central directory and compressed members are fetched in bounded ranges. A staged source
 * therefore remains usable after a page reload and can be backed by extension-owned IndexedDB or
 * userscript manager chunks.
 */
export async function readZipSource(
  source: ZipByteSource,
  options: { shouldContinue?: () => boolean | Promise<boolean> } = {}
): Promise<ZipReadEntry[]> {
  if (!Number.isInteger(source.size) || source.size < 0) {
    throw new ZipLimitError("ZIP source has an invalid byte length.");
  }
  const tailLength = Math.min(source.size, 0xffff + 22);
  const tail = await readSourceRange(source, source.size - tailLength, tailLength);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const eocd = locateEOCD(tailView, tail.byteLength);
  if (eocd === -1) return [];
  const entryCount = tailView.getUint16(eocd + 10, true);
  if (entryCount > ZIP_LIMITS.maxEntries) {
    throw new ZipLimitError(`ZIP contains more than ${ZIP_LIMITS.maxEntries} entries.`);
  }
  const centralSize = tailView.getUint32(eocd + 12, true);
  const centralOffset = tailView.getUint32(eocd + 16, true);
  if (centralSize > ZIP_LIMITS.maxCentralDirectoryBytes) {
    throw new ZipLimitError("ZIP central directory exceeds the 4 MiB parser allocation limit.");
  }
  if (centralOffset + centralSize > source.size) {
    throw new ZipLimitError("ZIP central directory is outside the archive.");
  }
  const central = await readSourceRange(source, centralOffset, centralSize);
  const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const entries = parseSourceEntries(centralView, central.byteLength, entryCount);
  const results: ZipReadEntry[] = [];
  let totalUncompressed = 0;
  for (const entry of entries) {
    if (options.shouldContinue && !(await options.shouldContinue())) break;
    if (entry.compressedSize > ZIP_LIMITS.maxEntryCompressedBytes) {
      throw new ZipLimitError(
        `ZIP entry "${entry.filename}" exceeds the ${ZIP_LIMITS.maxEntryCompressedBytes / (1024 * 1024)} MiB compressed limit.`
      );
    }
    if (entry.uncompressedSize > ZIP_LIMITS.maxEntryUncompressedBytes) {
      throw new ZipLimitError(
        `ZIP entry exceeds the ${ZIP_LIMITS.maxEntryUncompressedBytes / (1024 * 1024)} MiB entry limit.`
      );
    }
    if (totalUncompressed + entry.uncompressedSize > ZIP_LIMITS.maxTotalUncompressedBytes) {
      throw new ZipLimitError("ZIP expands beyond the 100 MiB archive limit.");
    }
    const localHeader = await readSourceRange(source, entry.localOffset, 30);
    const localView = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
    if (localView.getUint32(0, true) !== LOCAL_HEADER) continue;
    const localNameLength = localView.getUint16(26, true);
    const localExtraLength = localView.getUint16(28, true);
    const fileStart = entry.localOffset + 30 + localNameLength + localExtraLength;
    if (fileStart < 0 || fileStart + entry.compressedSize > source.size) continue;
    const compressed = await readSourceBlob(source, fileStart, entry.compressedSize);
    if (entry.method === METHOD_STORE) {
      const data = await blobToBytes(compressed, entry.filename);
      totalUncompressed += data.length;
      results.push(finish({ ...entry, raw: data }, data));
      continue;
    }
    if (entry.method !== METHOD_DEFLATE) {
      throw new UnsupportedZipMethodError(entry.method, entry.filename);
    }
    const inflated = await inflateRaw(
      compressed,
      entry.filename,
      Math.min(entry.uncompressedSize, ZIP_LIMITS.maxTotalUncompressedBytes - totalUncompressed)
    );
    totalUncompressed += inflated.length;
    results.push(finish({ ...entry, raw: inflated }, inflated));
  }
  return results;
}

export function zipByteSourceFromBytes(data: Uint8Array): ZipByteSource {
  return {
    size: data.byteLength,
    async read(offset, length) {
      if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > data.byteLength) {
        throw new Error("ZIP source read is outside the archive.");
      }
      return data.slice(offset, offset + length);
    }
  };
}

/** True when this build can inflate; lets callers explain the failure instead of guessing. */
export function canInflate(): boolean {
  return typeof globalThis.DecompressionStream === "function";
}

async function inflateRaw(bytes: Uint8Array | Blob, filename: string, maxBytes: number): Promise<Uint8Array> {
  if (!canInflate()) {
    throw new UnsupportedZipMethodError(METHOD_DEFLATE, filename);
  }
  // "deflate-raw" is the bare stream a ZIP stores; "deflate" would expect a zlib header.
  const stream = new Blob([bytes instanceof Blob ? bytes : new Uint8Array(bytes)])
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

function parseSourceEntries(view: DataView, length: number, entryCount: number): SourceZipEntry[] {
  const results: SourceZipEntry[] = [];
  let cursor = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > length || view.getUint32(cursor, true) !== CENTRAL_HEADER) break;
    const entryStart = cursor;
    const method = view.getUint16(entryStart + 10, true);
    const declaredCrc = view.getUint32(entryStart + 16, true);
    const compressedSize = view.getUint32(entryStart + 20, true);
    const uncompressedSize = view.getUint32(entryStart + 24, true);
    const nameLength = view.getUint16(entryStart + 28, true);
    const extraLength = view.getUint16(entryStart + 30, true);
    const commentLength = view.getUint16(entryStart + 32, true);
    const localOffset = view.getUint32(entryStart + 42, true);
    const end = entryStart + 46 + nameLength + extraLength + commentLength;
    if (end > length) break;
    const filename = TEXT_DECODER.decode(view.buffer instanceof ArrayBuffer
      ? new Uint8Array(view.buffer, view.byteOffset + entryStart + 46, nameLength)
      : new Uint8Array(0));
    cursor = end;
    if (filename.endsWith("/")) continue;
    results.push({ filename, method, compressedSize, uncompressedSize, declaredCrc, localOffset });
  }
  return results;
}

async function readSourceRange(source: ZipByteSource, offset: number, length: number): Promise<Uint8Array> {
  if (length < 0 || offset < 0 || offset + length > source.size) {
    throw new ZipLimitError("ZIP source range is outside the archive.");
  }
  if (length > ZIP_SOURCE_READ_BYTES) {
    throw new ZipLimitError("ZIP parser requested a range larger than its 4 MiB read window.");
  }
  const bytes = await source.read(offset, length);
  if (bytes.byteLength !== length) throw new ZipLimitError("ZIP source returned a short read.");
  return bytes;
}

async function readSourceBlob(source: ZipByteSource, offset: number, length: number): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let cursor = offset;
  let remaining = length;
  while (remaining > 0) {
    const nextLength = Math.min(remaining, ZIP_SOURCE_READ_BYTES);
    chunks.push(await readSourceRange(source, cursor, nextLength));
    cursor += nextLength;
    remaining -= nextLength;
  }
  return new Blob(chunks.map((chunk) => Uint8Array.from(chunk) as BlobPart));
}

async function blobToBytes(blob: Blob, filename: string): Promise<Uint8Array> {
  if (blob.size > ZIP_LIMITS.maxEntryUncompressedBytes) {
    throw new ZipLimitError(`ZIP entry "${filename}" exceeds its size limit.`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}

function locateEOCD(view: DataView, length: number): number {
  for (let i = length - 22; i >= Math.max(0, length - 0xffff - 22); i--) {
    if (i < 0 || i + 4 > length) continue;
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
