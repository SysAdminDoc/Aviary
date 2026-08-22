import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
const decoder = new TextDecoder();
const encoder = new TextEncoder();

test("a profile-local P-384 keypair persists and signs the manifest hash", async () => {
  const { WACZ_SIGNING_KEY, WaczSigningKeyStore } = await importSourceModule(
    "src/features/export/wacz-signing.ts"
  );
  const storage = new MemoryStorage();
  const first = new WaczSigningKeyStore(storage);
  assert.deepEqual(await first.load(), { state: "missing", fingerprint: null, createdAt: null });

  const signature = await first.sign(`sha256:${"a".repeat(64)}`, "2026-08-21T12:00:00Z");
  assert.equal(signature.software, "Aviary");
  assert.equal(signature.version, "dev");
  assert.match(signature.publicKey, /^[A-Za-z0-9+/]+=*$/);
  assert.match(signature.signature, /^[A-Za-z0-9+/]+=*$/);

  const publicKey = await crypto.subtle.importKey(
    "spki",
    Buffer.from(signature.publicKey, "base64"),
    { name: "ECDSA", namedCurve: "P-384" },
    false,
    ["verify"]
  );
  assert.equal(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    Buffer.from(signature.signature, "base64"),
    encoder.encode(signature.hash)
  ), true);

  const second = new WaczSigningKeyStore(storage);
  const persisted = await second.load();
  assert.equal(persisted.state, "ready");
  assert.equal(persisted.fingerprint, first.status().fingerprint);
  assert.equal(storage.writes.filter((key) => key === WACZ_SIGNING_KEY).length, 1);

  const keyArtifact = await second.exportKeypair();
  const exported = JSON.parse(decoder.decode(keyArtifact.data));
  assert.equal(exported.format, "aviary-wacz-keypair-1");
  assert.equal(exported.algorithm, "ECDSA-P384-SHA256");
  assert.equal(exported.fingerprint, persisted.fingerprint);
  assert.match(exported.privateKey, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(keyArtifact.filename, `aviary-wacz-keypair-${persisted.fingerprint.slice(0, 12)}.json`);
});

test("signed WACZ embeds verifiable anonymous signature data and unsigned WACZ stays valid", async () => {
  const [{ buildSignedWaczArchive, buildWaczArchive }, { WaczSigningKeyStore }, { readStoreZip }] =
    await Promise.all([
      importSourceModule("src/features/export/wacz.ts"),
      importSourceModule("src/features/export/wacz-signing.ts"),
      importSourceModule("src/features/export/zip-reader.ts")
    ]);
  const signing = new WaczSigningKeyStore(new MemoryStorage());
  await signing.load();
  const generatedAt = new Date("2026-08-21T12:00:00Z");
  const signed = await buildSignedWaczArchive([sampleRecord()], signing, { generatedAt });
  const signedEntries = new Map(readStoreZip(signed.data).map((entry) => [entry.filename, entry.data]));
  const digest = JSON.parse(decoder.decode(signedEntries.get("datapackage-digest.json")));

  assert.equal(signed.contentType, "application/wacz");
  assert.equal(digest.signedData.hash, digest.hash);
  assert.equal(digest.signedData.created, generatedAt.toISOString());
  assert.equal(digest.signedData.software, "Aviary");
  assert.match(digest.signedData.signature, /^[A-Za-z0-9+/]+=*$/);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    Buffer.from(digest.signedData.publicKey, "base64"),
    { name: "ECDSA", namedCurve: "P-384" },
    false,
    ["verify"]
  );
  assert.equal(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    Buffer.from(digest.signedData.signature, "base64"),
    encoder.encode(digest.hash)
  ), true);

  const unsigned = buildWaczArchive([sampleRecord()], { generatedAt });
  const unsignedEntries = new Map(readStoreZip(unsigned.data).map((entry) => [entry.filename, entry.data]));
  const unsignedDigest = JSON.parse(decoder.decode(unsignedEntries.get("datapackage-digest.json")));
  assert.equal(unsignedDigest.signedData, undefined);
  assert.equal(unsignedDigest.hash, digest.hash);
});

test("routine library backups cannot carry the WACZ private key", async () => {
  const [{ createLibraryBackup, LIBRARY_BACKUP_COLLECTIONS }, { WACZ_SIGNING_KEY }]
    = await Promise.all([
      importSourceModule("src/features/core/library-backup.ts"),
      importSourceModule("src/features/export/wacz-signing.ts")
    ]);
  const privateSentinel = "PRIVATE-WACZ-KEY-MUST-NOT-BACK-UP";
  const storage = new MemoryStorage({
    [WACZ_SIGNING_KEY]: { privateKey: privateSentinel }
  });
  const artifact = await createLibraryBackup(storage, { createdAt: "2026-08-21T12:00:00Z" });
  const text = decoder.decode(artifact.data);

  assert.equal(LIBRARY_BACKUP_COLLECTIONS.some((entry) => entry.key === WACZ_SIGNING_KEY), false);
  assert.doesNotMatch(text, /aviary\.waczSigning\.v1/);
  assert.doesNotMatch(text, new RegExp(privateSentinel));
});

test("an invalid stored identity is reported and never silently replaced", async () => {
  const { WACZ_SIGNING_KEY, WaczSigningKeyStore } = await importSourceModule(
    "src/features/export/wacz-signing.ts"
  );
  const invalid = { schemaVersion: 1, algorithm: "ECDSA-P384-SHA256", privateKey: "broken" };
  const storage = new MemoryStorage({ [WACZ_SIGNING_KEY]: invalid });
  const signing = new WaczSigningKeyStore(storage);

  assert.deepEqual(await signing.load(), { state: "invalid", fingerprint: null, createdAt: null });
  await assert.rejects(
    signing.sign(`sha256:${"b".repeat(64)}`, "2026-08-21T12:00:00Z"),
    /invalid and was not replaced/
  );
  assert.deepEqual(storage.values.get(WACZ_SIGNING_KEY), invalid);
  assert.equal(storage.writes.length, 0);
});

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.writes = [];
  }

  async get(key, fallback) {
    return this.values.has(key) ? structuredClone(this.values.get(key)) : fallback;
  }

  async set(key, value) {
    this.values.set(key, structuredClone(value));
    this.writes.push(key);
  }

  async remove(key) {
    this.values.delete(key);
  }
}

function sampleRecord() {
  return {
    tweetId: "1",
    handle: "alpha",
    displayName: "Alpha",
    text: "signed archive",
    capturedAt: "2026-08-21T11:59:00Z",
    surface: "home",
    media: [],
    permalink: "https://x.com/alpha/status/1"
  };
}
