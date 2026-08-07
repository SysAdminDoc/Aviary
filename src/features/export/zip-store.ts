export interface ZipFileEntry {
  filename: string;
  data: Uint8Array;
  date?: Date;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (CRC32_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * General-purpose bit 11: "the filename and comment are UTF-8". `TextEncoder` only emits UTF-8,
 * so without this flag a conforming extractor must read the bytes as IBM CP437 (APPNOTE 4.4.4)
 * and a name like `Recherché-アーカイブ/` arrives as `Recherch├⌐-πéóπâ╝πé½πéñπâû/`. Reachable
 * from any non-ASCII save-folder hint, which `sanitizeFolder` deliberately preserves.
 *
 * Set unconditionally: UTF-8 and CP437 agree on the ASCII range, so there is no case where
 * flagging it is wrong, and a single code path beats one that is only sometimes correct.
 */
const FLAG_UTF8_NAMES = 0x0800;

/** The format's 32-bit ceilings. Past them a STORE archive needs ZIP64 to stay readable. */
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

export function buildStoreZip(entries: ZipFileEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localBlocks: Uint8Array[] = [];
  const centralBlocks: Uint8Array[] = [];
  let offset = 0;

  // These fields are written with setUint16/setUint32, which truncate silently. Producing an
  // archive that unzips to the wrong thing is worse than refusing to produce one, and the
  // caller (an export run) can surface the message.
  if (entries.length > MAX_UINT16) {
    throw new RangeError(
      `A STORE zip holds at most ${MAX_UINT16} entries without ZIP64; got ${entries.length}.`
    );
  }

  for (const entry of entries) {
    if (entry.data.length > MAX_UINT32) {
      throw new RangeError(
        `"${entry.filename}" is ${entry.data.length} bytes; a STORE zip entry cannot exceed ${MAX_UINT32} without ZIP64.`
      );
    }
    const nameBytes = encoder.encode(entry.filename);
    if (nameBytes.length > MAX_UINT16) {
      throw new RangeError(`"${entry.filename}" has a name longer than ${MAX_UINT16} bytes.`);
    }
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const date = entry.date ?? new Date();
    const dosDate = toDosDate(date);
    const dosTime = toDosTime(date);

    const localHeader = new ArrayBuffer(30 + nameBytes.length);
    const lhView = new DataView(localHeader);
    lhView.setUint32(0, 0x04034b50, true);
    lhView.setUint16(4, 20, true); // version
    lhView.setUint16(6, FLAG_UTF8_NAMES, true); // flags
    lhView.setUint16(8, 0, true); // method = STORE
    lhView.setUint16(10, dosTime, true);
    lhView.setUint16(12, dosDate, true);
    lhView.setUint32(14, crc, true);
    lhView.setUint32(18, size, true);
    lhView.setUint32(22, size, true);
    lhView.setUint16(26, nameBytes.length, true);
    lhView.setUint16(28, 0, true);
    const localHeaderBytes = new Uint8Array(localHeader);
    localHeaderBytes.set(nameBytes, 30);
    localBlocks.push(localHeaderBytes);
    localBlocks.push(entry.data);

    const centralHeader = new ArrayBuffer(46 + nameBytes.length);
    const chView = new DataView(centralHeader);
    chView.setUint32(0, 0x02014b50, true);
    chView.setUint16(4, 20, true); // version made by
    chView.setUint16(6, 20, true); // version needed
    chView.setUint16(8, FLAG_UTF8_NAMES, true); // flags
    chView.setUint16(10, 0, true); // STORE
    chView.setUint16(12, dosTime, true);
    chView.setUint16(14, dosDate, true);
    chView.setUint32(16, crc, true);
    chView.setUint32(20, size, true);
    chView.setUint32(24, size, true);
    chView.setUint16(28, nameBytes.length, true);
    chView.setUint16(30, 0, true);
    chView.setUint16(32, 0, true);
    chView.setUint16(34, 0, true);
    chView.setUint16(36, 0, true);
    chView.setUint32(38, 0, true); // external attrs
    chView.setUint32(42, offset, true);
    const centralBytes = new Uint8Array(centralHeader);
    centralBytes.set(nameBytes, 46);
    centralBlocks.push(centralBytes);

    offset += localHeaderBytes.length + entry.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const block of centralBlocks) {
    centralSize += block.length;
  }

  // The end-of-central-directory record stores both as uint32.
  if (centralStart > MAX_UINT32 || centralSize > MAX_UINT32) {
    throw new RangeError(
      `The archive is too large for a non-ZIP64 zip (central directory at ${centralStart}, size ${centralSize}).`
    );
  }

  const endRecord = new Uint8Array(22);
  const erView = new DataView(endRecord.buffer);
  erView.setUint32(0, 0x06054b50, true);
  erView.setUint16(4, 0, true);
  erView.setUint16(6, 0, true);
  erView.setUint16(8, entries.length, true);
  erView.setUint16(10, entries.length, true);
  erView.setUint32(12, centralSize, true);
  erView.setUint32(16, centralStart, true);
  erView.setUint16(20, 0, true);

  const total = offset + centralSize + endRecord.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const block of localBlocks) {
    output.set(block, cursor);
    cursor += block.length;
  }
  for (const block of centralBlocks) {
    output.set(block, cursor);
    cursor += block.length;
  }
  output.set(endRecord, cursor);
  return output;
}

function toDosDate(date: Date): number {
  const year = Math.max(date.getUTCFullYear() - 1980, 0);
  return ((year & 0x7f) << 9) | (((date.getUTCMonth() + 1) & 0x0f) << 5) | (date.getUTCDate() & 0x1f);
}

function toDosTime(date: Date): number {
  return (
    ((date.getUTCHours() & 0x1f) << 11) |
    ((date.getUTCMinutes() & 0x3f) << 5) |
    (Math.floor(date.getUTCSeconds() / 2) & 0x1f)
  );
}
