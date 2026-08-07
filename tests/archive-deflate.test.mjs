import assert from "node:assert/strict";
import { deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Builds a ZIP the way a normal zip tool would.
 *
 * Deliberately written with Node's zlib and its own CRC rather than Aviary's writer: a fixture
 * produced by the code under test proves only that it agrees with itself, and Aviary's writer
 * never compresses, which is exactly the case that was broken.
 */
function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    const deflate = file.method === 8;
    const stored = deflate ? new Uint8Array(deflateRawSync(Buffer.from(content))) : content;
    const crc = nodeCrc32(Buffer.from(content)) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, deflate ? 8 : 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    chunks.push(local, stored);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, deflate ? 8 : 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length + stored.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of central) {
    chunks.push(entry);
    centralSize += entry.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  chunks.push(eocd);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

const TWEETS_JS = `window.YTD.tweets.part0 = ${JSON.stringify([
  {
    tweet: {
      id_str: "1750000000000000001",
      full_text: "A deflated post from the official archive.",
      created_at: "Tue Jan 16 12:00:00 +0000 2026"
    }
  }
])}`;

test("a DEFLATE-compressed archive — what X actually ships — imports", async () => {
  const { importOfficialArchive } = await importBundledModule(
    "src/features/library/archive-import.ts"
  );

  const archive = buildZip([{ name: "data/tweets.js", content: TWEETS_JS, method: 8 }]);
  const result = await importOfficialArchive(archive, "archive");

  assert.deepEqual(result.errors, [], "a standard zip must not error");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].text, "A deflated post from the official archive.");
  assert.equal(result.records[0].tweetId, "1750000000000000001");
  assert.deepEqual(result.warnings, [], "the CRC must verify against the inflated bytes");
});

test("STORE entries still read, and mixed archives read both", async () => {
  const { readZip } = await importBundledModule("src/features/export/zip-reader.ts");

  const archive = buildZip([
    { name: "data/tweets.js", content: TWEETS_JS, method: 8 },
    { name: "data/manifest.js", content: "window.__THAR_CONFIG = {};", method: 0 }
  ]);
  const entries = await readZip(archive);

  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.crcOk, true, `${entry.filename} failed its CRC check`);
  }
  assert.match(new TextDecoder().decode(entries[1].data), /__THAR_CONFIG/);
});

test("readStoreZip still refuses compressed entries rather than returning garbage", async () => {
  const { readStoreZip, UnsupportedZipMethodError } = await importBundledModule(
    "src/features/export/zip-reader.ts"
  );

  const archive = buildZip([{ name: "data/tweets.js", content: TWEETS_JS, method: 8 }]);
  assert.throws(() => readStoreZip(archive), (error) => error instanceof UnsupportedZipMethodError);
});

test("a corrupted deflate stream is reported, not silently dropped", async () => {
  const { importOfficialArchive } = await importBundledModule(
    "src/features/library/archive-import.ts"
  );

  const archive = buildZip([{ name: "data/tweets.js", content: TWEETS_JS, method: 8 }]);
  // Corrupt the middle of the deflate stream, past the local header.
  archive[60] = archive[60] ^ 0xff;
  archive[61] = archive[61] ^ 0xff;

  const result = await importOfficialArchive(archive, "archive");
  assert.ok(
    result.errors.length > 0 || result.warnings.length > 0,
    "a broken archive must say so rather than importing zero records silently"
  );
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-deflate-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
