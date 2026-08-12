import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("media manifests distinguish captured bytes, remote references, and missing assets", async () => {
  const { describeMediaCapture, sha256Hex } = await importBundledModule("src/features/export/assets.ts");
  const bytes = new TextEncoder().encode("hello");
  assert.equal(
    sha256Hex(bytes),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  );
  assert.deepEqual(describeMediaCapture({
    kind: "photo",
    url: "https://pbs.twimg.com/media/a.jpg",
    bytes,
    capturedAt: "2026-08-12T12:00:00Z"
  }), {
    status: "captured-bytes",
    sourceUrl: "https://pbs.twimg.com/media/a.jpg",
    capturedAt: "2026-08-12T12:00:00Z",
    byteLength: 5,
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    retryable: false
  });
  assert.equal(
    describeMediaCapture({ kind: "photo", url: "https://pbs.twimg.com/media/b.jpg" }).status,
    "remote-reference"
  );
  assert.equal(describeMediaCapture({ kind: "video", url: "", captureStatus: "missing" }).status, "missing");
});

test("all export formats carry an explicit media status and source", async () => {
  const { formatExport } = await importBundledModule("src/features/export/formatters.ts");
  const record = sampleRecord({
    media: [{
      kind: "photo",
      url: "https://pbs.twimg.com/media/remote.jpg",
      capturedAt: "2026-08-12T12:00:00Z"
    }]
  });

  const json = JSON.parse(new TextDecoder().decode(formatExport("json", [record]).data));
  assert.equal(json.records[0].media[0].capture.status, "remote-reference");
  assert.equal(json.records[0].media[0].capture.sourceUrl, record.media[0].url);
  for (const format of ["csv", "html", "markdown", "xlsx"]) {
    const text = new TextDecoder().decode(formatExport(format, [record]).data);
    assert.match(text, /remote-reference/, `${format} omitted the capture status`);
    assert.match(text, /https:\/\/pbs\.twimg\.com\/media\/remote\.jpg/, `${format} omitted the source URL`);
  }
});

test("WARC stores captured bytes as responses and remote media as metadata-only", async () => {
  const { buildWarcArchive } = await importBundledModule("src/features/export/warc.ts");
  const bytes = new TextEncoder().encode("captured media");
  const artifact = buildWarcArchive([sampleRecord({
    media: [
      { kind: "photo", url: "https://pbs.twimg.com/media/c.jpg", bytes, type: "image/jpeg" },
      { kind: "photo", url: "https://pbs.twimg.com/media/d.jpg" }
    ]
  })]);
  const text = new TextDecoder().decode(artifact.data);
  assert.match(text, /WARC-Type: response/);
  assert.match(text, /captured media/);
  assert.match(text, /metadataOnly":true/);
  assert.match(text, /remote-reference/);
  assert.match(text, /The media body is not in this WARC/);
});

test("export ZIPs include a checksum manifest and package media without silent network fetches", async () => {
  const { buildExportZip } = await importBundledModule("src/features/export/export-feature.ts");
  const { readStoreZip } = await importBundledModule("src/features/export/zip-reader.ts");
  const bytes = new TextEncoder().encode("offline image");
  const archive = buildExportZip([sampleRecord({
    media: [
      { kind: "photo", url: "https://pbs.twimg.com/media/e.jpg", bytes, type: "image/jpeg" },
      { kind: "photo", url: "https://pbs.twimg.com/media/f.jpg" },
      { kind: "video", url: "", captureStatus: "missing" }
    ]
  })], ["json", "html"], "archive");
  const entries = readStoreZip(archive);
  assert.ok(entries.some((entry) => entry.filename === "archive/viewer.html"));
  const manifestEntry = entries.find((entry) => entry.filename === "archive/manifest.json");
  assert.ok(manifestEntry);
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  assert.equal(manifest.offlineReady, false);
  assert.deepEqual(manifest.summary, {
    capturedBytes: bytes.length,
    remoteReferences: 1,
    missing: 1,
    retryable: 1
  });
  assert.ok(manifest.files.some((file) => file.kind === "media" && file.byteLength === bytes.length));
  assert.ok(entries.some((entry) => entry.filename === "archive/media/000001-photo.jpg"));
  const jsonEntry = entries.find((entry) => entry.filename === "archive/tweets.json");
  const json = JSON.parse(new TextDecoder().decode(jsonEntry.data));
  assert.equal(json.records[0].media[0].capture.packagePath, "media/000001-photo.jpg");
  assert.equal(json.records[0].media[1].capture.status, "remote-reference");
});

test("media capture records failures as retryable metadata", async () => {
  const { captureExportRecordMedia } = await importBundledModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("no", { status: 503 });
  try {
    const result = await captureExportRecordMedia(sampleRecord({
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/retry.jpg" }]
    }));
    assert.equal(result.media[0].captureStatus, "remote-reference");
    assert.equal(result.media[0].bytes, undefined);
    assert.match(result.media[0].captureError, /HTTP 503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sampleRecord(overrides = {}) {
  return {
    tweetId: "1",
    handle: "alpha",
    displayName: "Alpha",
    text: "hello",
    capturedAt: "2026-08-12T12:00:00Z",
    surface: "home",
    media: [],
    permalink: "https://x.com/alpha/status/1",
    ...overrides
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-truthful-export-"));
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
    await rm(temp, { force: true, recursive: true });
  }
}
