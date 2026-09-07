import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CRX_MAGIC = Buffer.from("Cr24", "utf8");
const CRX_VERSION = Buffer.from([3, 0, 0, 0]);
const SIGNATURE_CONTEXT = Buffer.from("CRX3 SignedData\0", "utf8");

/** Create or load the stable self-host signing key used for secondary CRX assets. */
export async function ensureSigningKey(keyPath) {
  try {
    const pem = await readFile(keyPath, "utf8");
    const privateKey = createPrivateKey(pem);
    return { privateKey, created: false };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Cannot load CRX signing key ${keyPath}: ${error.message}`);
    }
  }

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 4096 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  await mkdir(path.dirname(keyPath), { recursive: true });
  await writeFile(keyPath, pem, { encoding: "utf8", flag: "wx" }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return { privateKey: createPrivateKey(await readFile(keyPath, "utf8")), created: true };
}

export function keyFingerprint(privateKey) {
  const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  return `sha256:${createHash("sha256").update(publicDer).digest("hex")}`;
}

/** Pack a STORE ZIP as a CRX3 with the required crx_id and RSA proof. */
export function packCrx3(zipBytes, privateKeyInput) {
  const privateKey = typeof privateKeyInput === "string"
    ? createPrivateKey(privateKeyInput)
    : privateKeyInput;
  const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const crxId = createHash("sha256").update(publicDer).digest().subarray(0, 16);
  const signedHeaderData = fieldBytes(1, crxId);
  const signer = createSign("RSA-SHA256");
  signer.update(SIGNATURE_CONTEXT);
  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);
  signer.update(signedHeaderSize);
  signer.update(signedHeaderData);
  signer.update(zipBytes);
  const signature = signer.sign(privateKey);
  const proof = Buffer.concat([fieldBytes(1, publicDer), fieldBytes(2, signature)]);
  const header = Buffer.concat([fieldBytes(2, proof), fieldBytes(10000, signedHeaderData)]);
  const headerSize = Buffer.alloc(4);
  headerSize.writeUInt32LE(header.length, 0);
  return Buffer.concat([CRX_MAGIC, CRX_VERSION, headerSize, header, zipBytes]);
}

export async function packCrx3File(zipPath, keyPath, outputPath) {
  const { privateKey } = await ensureSigningKey(keyPath);
  const zipBytes = await readFile(zipPath);
  const crxBytes = packCrx3(zipBytes, privateKey);
  await writeFile(outputPath, crxBytes);
  const verification = verifyCrx3(crxBytes);
  if (!verification.valid) throw new Error(`CRX3 verification failed: ${verification.reason}`);
  return { ...verification, keyFingerprint: keyFingerprint(privateKey) };
}

/** Verify the CRX3 header, signature, crx_id, ZIP payload, and path separators. */
export function verifyCrx3(bytes) {
  try {
    if (!bytes.subarray(0, 4).equals(CRX_MAGIC)) return { valid: false, reason: "missing Cr24 magic" };
    if (!bytes.subarray(4, 8).equals(CRX_VERSION)) return { valid: false, reason: "unsupported CRX version" };
    const headerSize = bytes.readUInt32LE(8);
    const headerStart = 12;
    const headerEnd = headerStart + headerSize;
    if (headerEnd >= bytes.length) return { valid: false, reason: "header exceeds file" };
    const zip = bytes.subarray(headerEnd);
    if (zip[0] !== 0x50 || zip[1] !== 0x4b) return { valid: false, reason: "payload is not a ZIP" };
    assertZipNames(zip);

    const headerFields = parseFields(bytes.subarray(headerStart, headerEnd));
    const proof = parseFields(firstField(headerFields, 2));
    const publicDer = firstField(proof, 1);
    const signature = firstField(proof, 2);
    const signedHeaderData = firstField(headerFields, 10000);
    const signedFields = parseFields(signedHeaderData);
    const crxId = firstField(signedFields, 1);
    const expectedId = createHash("sha256").update(publicDer).digest().subarray(0, 16);
    if (!crxId.equals(expectedId)) return { valid: false, reason: "crx_id does not match public key" };

    const verifier = createVerify("RSA-SHA256");
    verifier.update(SIGNATURE_CONTEXT);
    const signedHeaderSize = Buffer.alloc(4);
    signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);
    verifier.update(signedHeaderSize);
    verifier.update(signedHeaderData);
    verifier.update(zip);
    const valid = verifier.verify({ key: publicDer, type: "spki", format: "der" }, signature);
    return valid
      ? { valid: true, headerSize, payloadBytes: zip.length, keyFingerprint: `sha256:${createHash("sha256").update(publicDer).digest("hex")}` }
      : { valid: false, reason: "RSA proof did not verify" };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

function fieldBytes(fieldNumber, value) {
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(value.length), value]);
}

function encodeVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let next = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0) next |= 0x80;
    bytes.push(next);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function parseFields(bytes) {
  const fields = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    offset = key.offset;
    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (wireType !== 2) throw new Error(`unsupported protobuf wire type ${wireType}`);
    const length = readVarint(bytes, offset);
    offset = length.offset;
    const end = offset + Number(length.value);
    if (end > bytes.length) throw new Error("truncated protobuf field");
    const value = bytes.subarray(offset, end);
    const existing = fields.get(fieldNumber) ?? [];
    existing.push(value);
    fields.set(fieldNumber, existing);
    offset = end;
  }
  return fields;
}

function readVarint(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
    if (shift > 63n) throw new Error("protobuf varint is too large");
  }
  throw new Error("truncated protobuf varint");
}

function firstField(fields, number) {
  const value = fields.get(number)?.[0];
  if (!value) throw new Error(`protobuf field ${number} is missing`);
  return value;
}

function assertZipNames(zip) {
  const eocd = findSignature(zip, 0x06054b50, Math.max(0, zip.length - 0x10016));
  if (eocd < 0) throw new Error("ZIP end record is missing");
  const entries = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > zip.length) throw new Error("ZIP central directory is truncated");
  let offset = centralOffset;
  for (let index = 0; index < entries; index++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP central entry is malformed");
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.includes("\\")) throw new Error(`ZIP path uses a backslash: ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function findSignature(bytes, signature, start) {
  for (let offset = bytes.length - 22; offset >= start; offset--) {
    if (bytes.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}
