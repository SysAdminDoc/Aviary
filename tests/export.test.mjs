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

  await checkpoints.start("capture-HomeTimeline", "capture", ["json"], true);
  const sharedPrefix = "x".repeat(120);
  await checkpoints.append("capture-HomeTimeline", [
    {
      tweetId: null,
      handle: null,
      displayName: null,
      text: `${sharedPrefix}A`,
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "graphql:HomeTimeline",
      media: [],
      permalink: "https://x.com/i/api/graphql/a/HomeTimeline"
    },
    {
      tweetId: null,
      handle: null,
      displayName: null,
      text: `${sharedPrefix}B`,
      capturedAt: "2026-05-19T12:00:01Z",
      surface: "graphql:HomeTimeline",
      media: [],
      permalink: "https://x.com/i/api/graphql/a/HomeTimeline"
    }
  ]);
  assert.equal(
    checkpoints.records("capture-HomeTimeline").length,
    2,
    "raw bodies that differ after the old 80-character key must both be retained"
  );

  const reloaded = new (await importBundledModule("src/features/export/jobs.ts")).CheckpointStore(storage);
  await reloaded.load();
  assert.equal(reloaded.records("job-1").length, 2, "checkpoint persisted across reloads");
});

test("CheckpointStore applies configurable retention at boot and append time", async () => {
  const {
    CheckpointStore,
    RETENTION_KEYS,
    saveRetentionPolicy
  } = await importBundledModule("src/features/export/jobs.ts");
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

  await saveRetentionPolicy(storage, { maxJobs: 2, maxRecordsPerJob: 2, maxAgeDays: 0 });
  const checkpoints = new CheckpointStore(storage);
  await checkpoints.start("job-1", "home", ["json"], false);
  await checkpoints.append("job-1", [
    { tweetId: "1", handle: "a", displayName: "A", text: "one", capturedAt: "2026-05-19T00:00:00Z", surface: "home", media: [], permalink: null },
    { tweetId: "2", handle: "a", displayName: "A", text: "two", capturedAt: "2026-05-19T00:01:00Z", surface: "home", media: [], permalink: null },
    { tweetId: "3", handle: "a", displayName: "A", text: "three", capturedAt: "2026-05-19T00:02:00Z", surface: "home", media: [], permalink: null }
  ]);
  await checkpoints.start("job-2", "home", ["json"], false);
  await checkpoints.start("job-3", "home", ["json"], false);

  assert.deepEqual(checkpoints.list().map((job) => job.jobId), ["job-2", "job-3"]);
  assert.equal(checkpoints.records("job-1").length, 0);
  assert.equal(checkpoints.records("job-3").length, 0);
  assert.equal(store.get(RETENTION_KEYS.maxJobs), 2);
  assert.equal(store.get(RETENTION_KEYS.maxRecordsPerJob), 2);
});

test("CheckpointStore removes jobs older than the configured age at boot", async () => {
  const { CheckpointStore, saveRetentionPolicy } = await importBundledModule("src/features/export/jobs.ts");
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
  await saveRetentionPolicy(storage, { maxJobs: 0, maxRecordsPerJob: 0, maxAgeDays: 30 });
  await storage.set("aviary.export.checkpoints.v1", {
    jobs: {
      old: { jobId: "old", startedAt: "2020-01-01T00:00:00Z", surface: "home", recordCount: 1, done: true, formats: ["json"], preserveRawPayloads: false },
      fresh: { jobId: "fresh", startedAt: new Date().toISOString(), surface: "home", recordCount: 0, done: false, formats: ["json"], preserveRawPayloads: false }
    },
    records: {
      old: [{ tweetId: "old", handle: "a", displayName: "A", text: "old", capturedAt: "2020-01-01T00:00:00Z", surface: "home", media: [], permalink: null }],
      fresh: []
    }
  });

  const checkpoints = new CheckpointStore(storage);
  const sweep = await checkpoints.load();
  assert.equal(sweep.removedJobs, 1);
  assert.equal(checkpoints.list().length, 1);
  assert.equal(checkpoints.list()[0].jobId, "fresh");
  assert.equal(checkpoints.records("old").length, 0);
});

test("CheckpointStore recovers interrupted jobs and keeps lifecycle actions durable", async () => {
  const { CheckpointStore } = await importBundledModule("src/features/export/jobs.ts");
  const store = new Map();
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? structuredClone(store.get(key)) : structuredClone(fallback);
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const first = new CheckpointStore(storage);
  await first.start("job-interrupted", "home", ["json"], false);
  await first.append("job-interrupted", [
    { tweetId: "1", handle: "alpha", displayName: "Alpha", text: "saved", capturedAt: "2026-05-19T00:00:00Z", surface: "home", media: [], permalink: null }
  ]);

  const reloaded = new CheckpointStore(storage);
  await reloaded.load();
  assert.equal(reloaded.list()[0].status, "paused");
  assert.equal(reloaded.list()[0].resumeOnBoot, true);
  assert.equal(reloaded.listResumable()[0].jobId, "job-interrupted");

  assert.equal(await reloaded.resume("job-interrupted"), true);
  assert.equal(reloaded.list()[0].status, "running");
  assert.equal(await reloaded.updateProgress("job-interrupted", { completed: 1, total: 3 }), true);
  assert.deepEqual(reloaded.list()[0].progress, { completed: 1, total: 3 });
  assert.equal(await reloaded.pause("job-interrupted"), true);
  assert.equal(reloaded.list()[0].resumeOnBoot, false, "manual pause must not auto-resume");
  assert.equal(await reloaded.cancel("job-interrupted"), true);
  assert.equal(reloaded.list()[0].status, "cancelled");
  assert.equal(reloaded.list()[0].done, true);
  assert.equal(await reloaded.resume("job-interrupted"), false, "terminal jobs are idempotently closed");
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
