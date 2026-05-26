import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("formatExport produces deterministic JSON, CSV, HTML, and Markdown artifacts", async () => {
  const { formatExport } = await importBundledModule("src/features/export/formatters.ts");
  const records = [
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: "Hello, world",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/x?format=jpg&name=orig", type: "jpg" }],
      permalink: "https://x.com/alpha/status/1"
    },
    {
      tweetId: "2",
      handle: "beta",
      displayName: "Beta",
      text: "Quoted \"line\", with commas",
      capturedAt: "2026-05-19T12:01:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/beta/status/2"
    }
  ];

  const json = formatExport("json", records);
  assert.equal(json.filename, "tweets.json");
  const decoded = JSON.parse(new TextDecoder().decode(json.data));
  assert.equal(decoded.records.length, 2);
  assert.equal(decoded.records[1].handle, "beta");

  const csv = formatExport("csv", records);
  const csvText = new TextDecoder().decode(csv.data);
  assert.ok(csvText.split("\n")[0].startsWith("tweetId,handle,"));
  assert.ok(csvText.includes('"Quoted ""line"", with commas"'));

  const html = formatExport("html", records);
  const htmlText = new TextDecoder().decode(html.data);
  assert.match(htmlText, /<article class="record">/);
  assert.ok(!htmlText.includes("<script>"));

  const md = formatExport("markdown", records);
  const mdText = new TextDecoder().decode(md.data);
  assert.match(mdText, /^# Aviary export/);
  assert.match(mdText, /## Alpha \(@alpha\)/);
});

test("crc32 matches a known IEEE 802.3 vector", async () => {
  const { crc32 } = await importBundledModule("src/features/export/zip-store.ts");
  const data = new TextEncoder().encode("123456789");
  assert.equal(crc32(data), 0xcbf43926);
});

test("buildStoreZip produces a parseable archive with end-of-central-directory record", async () => {
  const { buildStoreZip } = await importBundledModule("src/features/export/zip-store.ts");
  const archive = buildStoreZip([
    { filename: "hello.txt", data: new TextEncoder().encode("hello") },
    { filename: "folder/nested.txt", data: new TextEncoder().encode("world") }
  ]);

  // ZIP signatures
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50, "local file header signature missing");

  // EOCD signature should be present at the tail.
  let foundEOCD = false;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      foundEOCD = true;
      assert.equal(view.getUint16(i + 10, true), 2, "total entry count mismatch");
      break;
    }
  }
  assert.ok(foundEOCD, "missing end of central directory record");
});

test("CheckpointStore round-trips jobs and dedupes records", async () => {
  const { CheckpointStore } = await importBundledModule("src/features/export/jobs.ts");
  const store = new Map();
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const checkpoints = new CheckpointStore(storage);
  await checkpoints.start("job-1", "home", ["json", "csv"], false);
  await checkpoints.append("job-1", [
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: "First",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    }
  ]);
  await checkpoints.append("job-1", [
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: "First",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    },
    {
      tweetId: "2",
      handle: "beta",
      displayName: "Beta",
      text: "Second",
      capturedAt: "2026-05-19T12:01:00Z",
      surface: "home",
      media: [],
      permalink: null
    }
  ]);
  await checkpoints.finish("job-1");

  assert.equal(checkpoints.records("job-1").length, 2, "duplicates should be dropped");
  assert.equal(checkpoints.list()[0].done, true);

  const reloaded = new (await importBundledModule("src/features/export/jobs.ts")).CheckpointStore(storage);
  await reloaded.load();
  assert.equal(reloaded.records("job-1").length, 2, "checkpoint persisted across reloads");
});

test("selectSupportedFormats filters unsupported values and never returns empty", async () => {
  const { selectSupportedFormats } = await importBundledModule(
    "src/features/export/export-feature.ts"
  );
  assert.deepEqual(selectSupportedFormats(["json", "exe", "html", "xlsx"]), ["json", "html", "xlsx"]);
  assert.deepEqual(selectSupportedFormats(["xlsx"]), ["xlsx"]);
  assert.deepEqual(selectSupportedFormats(["exe"]), ["json"]);
  assert.deepEqual(selectSupportedFormats([]), ["json"]);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-export-"));
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
