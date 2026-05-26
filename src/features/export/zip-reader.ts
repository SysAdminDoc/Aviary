import { crc32 } from "./zip-store";

export interface ZipReadEntry {
  filename: string;
  data: Uint8Array;
  crcOk: boolean;
}

const LOCAL_HEADER = 0x04034b50;
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;

const TEXT_DECODER = new TextDecoder();

export class UnsupportedZipMethodError extends Error {
  constructor(method: number, filename: string) {
    super(`Unsupported ZIP compression method ${method} for "${filename}"`);
    this.name = "UnsupportedZipMethodError";
  }
}

export function readStoreZip(data: Uint8Array): ZipReadEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = locateEOCD(view, data.length);
  if (eocd === -1) {
    return [];
  }
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  const results: ZipReadEntry[] = [];
  let cursor = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const filename = TEXT_DECODER.decode(data.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (filename.endsWith("/")) {
      continue;
    }

    if (method !== 0) {
      throw new UnsupportedZipMethodError(method, filename);
    }

    if (view.getUint32(localOffset, true) !== LOCAL_HEADER) {
      continue;
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const fileStart = localOffset + 30 + localNameLength + localExtraLength;
    const fileEnd = fileStart + compressedSize;
    const fileData = data.subarray(fileStart, fileEnd);
    const declaredCrc = view.getUint32(cursor - (extraLength + commentLength + nameLength + 46) + 16, true);
    const actualCrc = crc32(fileData);
    const expectedSize = uncompressedSize;
    results.push({
      filename,
      data: new Uint8Array(fileData),
      crcOk: declaredCrc === actualCrc && fileData.length === expectedSize
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
