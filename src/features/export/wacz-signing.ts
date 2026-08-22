import { AVIARY_VERSION } from "../../platform/build-version";
import { withStorageLock } from "../../platform/storage-lock";
import type { StorageGateway } from "../../platform/storage";
import { sha256Hex } from "./assets";
import type { ExportArtifact } from "./types";

export const WACZ_SIGNING_KEY = "aviary.waczSigning.v1";
export const WACZ_SIGNING_ALGORITHM = "ECDSA-P384-SHA256";

const ENCODER = new TextEncoder();
const KEY_FORMAT = "aviary-wacz-keypair-1";
const ECDSA_KEY_PARAMS: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-384" };
const ECDSA_SIGN_PARAMS: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

interface StoredWaczSigningIdentity {
  schemaVersion: 1;
  algorithm: typeof WACZ_SIGNING_ALGORITHM;
  createdAt: string;
  fingerprint: string;
  publicKey: string;
  privateKey: string;
}

export interface WaczSignatureData {
  hash: string;
  signature: string;
  publicKey: string;
  created: string;
  software: "Aviary";
  version: string;
}

export interface WaczSigningStatus {
  state: "missing" | "ready" | "invalid";
  fingerprint: string | null;
  createdAt: string | null;
}

export interface WaczDigestSigner {
  sign(hash: string, createdAt: string): Promise<WaczSignatureData>;
}

export class WaczSigningKeyStore implements WaczDigestSigner {
  readonly #storage: StorageGateway;
  #identity: StoredWaczSigningIdentity | null = null;
  #status: WaczSigningStatus = { state: "missing", fingerprint: null, createdAt: null };

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<WaczSigningStatus> {
    const raw = await this.#storage.get<unknown>(WACZ_SIGNING_KEY, undefined);
    if (raw === undefined || raw === null) {
      this.#identity = null;
      this.#status = { state: "missing", fingerprint: null, createdAt: null };
      return this.status();
    }
    try {
      this.#identity = await readIdentity(raw);
      this.#status = readyStatus(this.#identity);
    } catch {
      this.#identity = null;
      this.#status = { state: "invalid", fingerprint: null, createdAt: null };
    }
    return this.status();
  }

  status(): WaczSigningStatus {
    return { ...this.#status };
  }

  async sign(hash: string, createdAt: string): Promise<WaczSignatureData> {
    if (!/^sha256:[0-9a-f]{64}$/.test(hash)) {
      throw new TypeError("WACZ signing requires a SHA-256 manifest hash");
    }
    const identity = await this.#getOrCreate();
    const privateKey = await globalThis.crypto.subtle.importKey(
      "pkcs8",
      decodeBase64(identity.privateKey, 2_048),
      ECDSA_KEY_PARAMS,
      false,
      ["sign"]
    );
    const signature = new Uint8Array(
      await globalThis.crypto.subtle.sign(ECDSA_SIGN_PARAMS, privateKey, ENCODER.encode(hash))
    );
    return {
      hash,
      signature: encodeBase64(signature),
      publicKey: identity.publicKey,
      created: validIsoDate(createdAt),
      software: "Aviary",
      version: AVIARY_VERSION
    };
  }

  async exportKeypair(): Promise<ExportArtifact> {
    const identity = await this.#getOrCreate();
    const data = ENCODER.encode(`${JSON.stringify({
      format: KEY_FORMAT,
      algorithm: identity.algorithm,
      createdAt: identity.createdAt,
      fingerprint: identity.fingerprint,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey
    }, null, 2)}\n`);
    return {
      filename: `aviary-wacz-keypair-${identity.fingerprint.slice(0, 12)}.json`,
      contentType: "application/json",
      data
    };
  }

  async replace(): Promise<WaczSigningStatus> {
    const identity = await withStorageLock(WACZ_SIGNING_KEY, async () => {
      const created = await createIdentity();
      await this.#storage.set(WACZ_SIGNING_KEY, created);
      return created;
    });
    this.#identity = identity;
    this.#status = readyStatus(identity);
    return this.status();
  }

  async #getOrCreate(): Promise<StoredWaczSigningIdentity> {
    if (this.#identity) return this.#identity;
    if (this.#status.state === "invalid") {
      throw new Error("The stored WACZ signing keypair is invalid and was not replaced");
    }
    const identity = await withStorageLock(WACZ_SIGNING_KEY, async () => {
      const stored = await this.#storage.get<unknown>(WACZ_SIGNING_KEY, undefined);
      if (stored !== undefined && stored !== null) {
        return readIdentity(stored);
      }
      const created = await createIdentity();
      await this.#storage.set(WACZ_SIGNING_KEY, created);
      return created;
    });
    this.#identity = identity;
    this.#status = readyStatus(identity);
    return identity;
  }
}

async function createIdentity(): Promise<StoredWaczSigningIdentity> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    ECDSA_KEY_PARAMS,
    true,
    ["sign", "verify"]
  );
  const [publicKey, privateKey] = await Promise.all([
    globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey),
    globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  ]);
  const publicBytes = new Uint8Array(publicKey);
  return {
    schemaVersion: 1,
    algorithm: WACZ_SIGNING_ALGORITHM,
    createdAt: new Date().toISOString(),
    fingerprint: sha256Hex(publicBytes),
    publicKey: encodeBase64(publicBytes),
    privateKey: encodeBase64(new Uint8Array(privateKey))
  };
}

async function readIdentity(value: unknown): Promise<StoredWaczSigningIdentity> {
  if (!value || typeof value !== "object") throw new TypeError("Signing identity is not an object");
  const raw = value as Partial<StoredWaczSigningIdentity>;
  if (
    raw.schemaVersion !== 1 ||
    raw.algorithm !== WACZ_SIGNING_ALGORITHM ||
    typeof raw.createdAt !== "string" ||
    typeof raw.fingerprint !== "string" ||
    typeof raw.publicKey !== "string" ||
    typeof raw.privateKey !== "string"
  ) {
    throw new TypeError("Signing identity fields are invalid");
  }
  const publicBytes = decodeBase64(raw.publicKey, 1_024);
  const privateBytes = decodeBase64(raw.privateKey, 2_048);
  if (sha256Hex(publicBytes) !== raw.fingerprint || !/^[0-9a-f]{64}$/.test(raw.fingerprint)) {
    throw new TypeError("Signing identity fingerprint does not match its public key");
  }
  validIsoDate(raw.createdAt);
  const [publicKey, privateKey] = await Promise.all([
    globalThis.crypto.subtle.importKey("spki", publicBytes, ECDSA_KEY_PARAMS, false, ["verify"]),
    globalThis.crypto.subtle.importKey("pkcs8", privateBytes, ECDSA_KEY_PARAMS, false, ["sign"])
  ]);
  const probe = ENCODER.encode("aviary-wacz-keypair-check");
  const signature = await globalThis.crypto.subtle.sign(ECDSA_SIGN_PARAMS, privateKey, probe);
  if (!await globalThis.crypto.subtle.verify(ECDSA_SIGN_PARAMS, publicKey, signature, probe)) {
    throw new TypeError("Signing identity keys do not form a pair");
  }
  return {
    schemaVersion: 1,
    algorithm: WACZ_SIGNING_ALGORITHM,
    createdAt: raw.createdAt,
    fingerprint: raw.fingerprint,
    publicKey: raw.publicKey,
    privateKey: raw.privateKey
  };
}

function readyStatus(identity: StoredWaczSigningIdentity): WaczSigningStatus {
  return {
    state: "ready",
    fingerprint: identity.fingerprint,
    createdAt: identity.createdAt
  };
}

function validIsoDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("Signing date is invalid");
  return date.toISOString();
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function decodeBase64(value: string, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new TypeError("Signing key is not valid base64");
  }
  const binary = globalThis.atob(value);
  if (binary.length === 0 || binary.length > maxBytes) {
    throw new RangeError("Signing key length is invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
