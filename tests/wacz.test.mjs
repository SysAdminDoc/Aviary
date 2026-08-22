import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
const decoder = new TextDecoder();

test("WACZ 1.1.1 package has checksummed STORE members and deterministic output", async () => {
  const [{ buildWaczArchive }, { readStoreZip }, { sha256Hex }] = await Promise.all([
    importSourceModule("src/features/export/wacz.ts"),
    importSourceModule("src/features/export/zip-reader.ts"),
    importSourceModule("src/features/export/assets.ts")
  ]);
  const generatedAt = new Date("2026-08-12T12:34:56Z");
  const records = [sampleRecord()];
  const artifact = buildWaczArchive(records, { generatedAt });
  const again = buildWaczArchive(records, { generatedAt });

  assert.equal(artifact.contentType, "application/wacz");
  assert.equal(artifact.filename, "aviary-20260812T123456Z.wacz");
  assert.deepEqual(artifact.data, again.data);
  assert.deepEqual(zipMethods(artifact.data), [0, 0, 0, 0, 0]);

  const entries = new Map(readStoreZip(artifact.data).map((entry) => [entry.filename, entry.data]));
  assert.deepEqual([...entries.keys()], [
    "archive/aviary.warc",
    "indexes/index.cdxj",
    "pages/pages.jsonl",
    "datapackage.json",
    "datapackage-digest.json"
  ]);
  const datapackageBytes = entries.get("datapackage.json");
  assert.ok(datapackageBytes);
  const datapackage = JSON.parse(decoder.decode(datapackageBytes));
  assert.equal(datapackage.profile, "data-package");
  assert.equal(datapackage.wacz_version, "1.1.1");
  assert.equal(datapackage.resources.length, 3);
  for (const resource of datapackage.resources) {
    const bytes = entries.get(resource.path);
    assert.ok(bytes, `${resource.path} is missing`);
    assert.equal(resource.bytes, bytes.length);
    assert.equal(resource.hash, `sha256:${sha256Hex(bytes)}`);
  }
  const digest = JSON.parse(decoder.decode(entries.get("datapackage-digest.json")));
  assert.deepEqual(digest, {
    path: "datapackage.json",
    hash: `sha256:${sha256Hex(datapackageBytes)}`
  });
});

test("CDXJ offsets address replayable WARC records and pages use RFC3339 timestamps", async () => {
  const [{ buildWaczArchive, toSurt }, { readStoreZip }] = await Promise.all([
    importSourceModule("src/features/export/wacz.ts"),
    importSourceModule("src/features/export/zip-reader.ts")
  ]);
  const artifact = buildWaczArchive([sampleRecord()], {
    generatedAt: new Date("2026-08-12T12:34:56Z")
  });
  const entries = new Map(readStoreZip(artifact.data).map((entry) => [entry.filename, entry.data]));
  const warc = entries.get("archive/aviary.warc");
  assert.ok(warc);
  const warcText = decoder.decode(warc);
  assert.match(warcText, /^WARC\/1\.1\r\nWARC-Type: warcinfo\r\n/);
  assert.match(warcText, /WARC-Filename: aviary\.warc/);
  assert.doesNotMatch(warcText, /WARC-Type: request/);

  const cdxLines = decoder.decode(entries.get("indexes/index.cdxj")).trim().split("\n");
  const sorted = [...cdxLines].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  assert.deepEqual(cdxLines, sorted);
  assert.equal(toSurt("https://X.com/alpha/status/1#media"), "com,x)/alpha/status/1");

  let sawMedia = false;
  for (const line of cdxLines) {
    const firstSpace = line.indexOf(" ");
    const secondSpace = line.indexOf(" ", firstSpace + 1);
    const surt = line.slice(0, firstSpace);
    const timestamp = line.slice(firstSpace + 1, secondSpace);
    const metadata = JSON.parse(line.slice(secondSpace + 1));
    assert.match(surt, /^[^)]+\)\//);
    assert.equal(timestamp, "20260812120000");
    assert.equal(metadata.filename, "aviary.warc");
    assert.match(metadata.digest, /^sha256:[A-Z2-7]{52}$/);
    assert.ok(Number.isInteger(metadata.offset) && metadata.offset >= 0);
    assert.ok(Number.isInteger(metadata.length) && metadata.length > 0);
    const record = decoder.decode(warc.slice(metadata.offset, metadata.offset + metadata.length));
    assert.match(record, /^WARC\/1\.1\r\n/);
    assert.match(record, new RegExp(`WARC-Target-URI: ${escapeRegExp(metadata.url)}`));
    if (metadata.url.includes("pbs.twimg.com")) {
      sawMedia = true;
      assert.equal(metadata.status, "200");
      assert.equal(metadata.mime, "image/jpeg");
      assert.match(record, /WARC-Type: response/);
      assert.match(record, /Content-Type: application\/http; msgtype=response/);
      assert.match(record, /HTTP\/1\.1 200 OK\r\n/);
      const blockDigest = record.match(/WARC-Block-Digest: (sha256:[A-Z2-7]+)/)?.[1];
      const payloadDigest = record.match(/WARC-Payload-Digest: (sha256:[A-Z2-7]+)/)?.[1];
      assert.ok(blockDigest);
      assert.ok(payloadDigest);
      assert.notEqual(blockDigest, payloadDigest);
      assert.match(record, /captured media/);
    }
  }
  assert.equal(sawMedia, true);

  const pageLines = decoder.decode(entries.get("pages/pages.jsonl")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(pageLines[0], { format: "json-pages-1.0", id: "pages", title: "All Pages" });
  assert.equal(pageLines[1].url, "https://aviary.invalid/pages/000001-1.html");
  assert.equal(pageLines[1].ts, "2026-08-12T12:00:00Z");
  assert.equal(pageLines[1].title, "@alpha captured post");
  assert.match(warcText, /<title>@alpha captured post<\/title>/);
  assert.match(warcText, /href="https:\/\/x\.com\/alpha\/status\/1"/);
});

test("WARC represents derived post data as a synthetic resource", async () => {
  const { buildIndexedWarcArchive } = await importSourceModule("src/features/export/warc.ts");
  const archive = buildIndexedWarcArchive([sampleRecord({ media: [] })], {
    generatedAt: new Date("2026-08-12T12:34:56Z")
  });
  const text = decoder.decode(archive.artifact.data);
  assert.match(text, /WARC-Type: resource\r\nWARC-Target-URI: https:\/\/aviary\.invalid\/records\//);
  assert.doesNotMatch(text, /WARC-Type: response\r\nWARC-Target-URI: https:\/\/x\.com\/alpha\/status\/1/);
});

function sampleRecord(overrides = {}) {
  return {
    tweetId: "1",
    handle: "alpha",
    displayName: "Alpha",
    text: "hello",
    capturedAt: "2026-08-12T12:00:00Z",
    surface: "home",
    media: [{
      kind: "photo",
      url: "https://pbs.twimg.com/media/c.jpg?format=jpg&name=orig",
      bytes: new TextEncoder().encode("captured media"),
      type: "image/jpeg"
    }],
    permalink: "https://x.com/alpha/status/1",
    ...overrides
  };
}

function zipMethods(bytes) {
  const methods = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    methods.push(view.getUint16(offset + 8, true));
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    offset += 30 + nameLength + extraLength + size;
  }
  return methods;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
