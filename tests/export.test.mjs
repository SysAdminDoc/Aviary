import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("formatExport produces deterministic JSON, CSV, HTML, and Markdown artifacts", async () => {
  const { formatExport } = await importSourceModule("src/features/export/formatters.ts");
  const records = [
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: "Hello, world",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [
        { kind: "photo", url: "https://pbs.twimg.com/media/x?format=jpg&name=orig", type: "jpg" },
        {
          kind: "audio",
          url: "https://video.twimg.com/ext_tw_audio/1/track.m4a",
          type: "audio/mp4",
          bitrate: 192000
        },
        {
          kind: "subtitle",
          url: "https://video.twimg.com/ext_tw_video/1/captions.vtt",
          type: "text/vtt",
          language: "en",
          label: "English"
        }
      ],
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
  assert.deepEqual(decoded.records[0].media.slice(1).map((media) => media.kind), ["audio", "subtitle"]);
  assert.equal(decoded.records[0].media[2].language, "en");

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
  const { crc32 } = await importSourceModule("src/features/export/zip-store.ts");
  const data = new TextEncoder().encode("123456789");
  assert.equal(crc32(data), 0xcbf43926);
});

test("buildStoreZip produces a parseable archive with end-of-central-directory record", async () => {
  const { buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
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
  const { CheckpointStore } = await importSourceModule("src/features/export/jobs.ts");
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

  const reloaded = new (await importSourceModule("src/features/export/jobs.ts")).CheckpointStore(storage);
  await reloaded.load();
  assert.equal(reloaded.records("job-1").length, 2, "checkpoint persisted across reloads");
});

test("CheckpointStore applies configurable retention at boot and append time", async () => {
  const {
    CheckpointStore,
    RETENTION_KEYS,
    saveRetentionPolicy
  } = await importSourceModule("src/features/export/jobs.ts");
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
  const { CheckpointStore, saveRetentionPolicy } = await importSourceModule("src/features/export/jobs.ts");
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
  const { CheckpointStore } = await importSourceModule("src/features/export/jobs.ts");
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
  const { selectSupportedFormats } = await importSourceModule(
    "src/features/export/export-feature.ts"
  );
  assert.deepEqual(selectSupportedFormats(["json", "exe", "html", "xlsx"]), ["json", "html", "xlsx"]);
  assert.deepEqual(selectSupportedFormats(["xlsx"]), ["xlsx"]);
  assert.deepEqual(selectSupportedFormats(["exe"]), ["json"]);
  assert.deepEqual(selectSupportedFormats([]), ["json"]);
});

test("buildZip deflates text and leaves incompressible bytes alone", async () => {
  const { buildZip, buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
  const { readZip } = await importSourceModule("src/features/export/zip-reader.ts");
  const encoder = new TextEncoder();

  // Text an export actually produces: repetitive JSON, which is where the win is.
  const json = encoder.encode(
    JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({
        tweetId: String(i),
        handle: "someone",
        text: "the same sentence over and over again",
        capturedAt: "2026-08-15T00:00:00Z"
      })),
      null,
      2
    )
  );
  // Already-compressed bytes: DEFLATE makes these bigger, so the writer must keep STORE per entry.
  // Real randomness, not an arithmetic sequence — a `(i * prime) % 251` ramp looks scrambled but
  // deflates to a fraction of its size, which made this assertion measure nothing.
  const incompressible = new Uint8Array(4096);
  globalThis.crypto.getRandomValues(incompressible);

  const entries = [
    { filename: "archive/tweets.json", data: json },
    { filename: "archive/media/photo.jpg", data: incompressible }
  ];
  const deflated = await buildZip(entries);
  const stored = buildStoreZip(entries);

  assert.ok(
    deflated.length < stored.length * 0.6,
    `expected a real saving, got ${deflated.length} vs ${stored.length} bytes`
  );
  assert.ok(
    deflated.length > incompressible.length,
    "the incompressible entry must still be present at roughly its own size"
  );

  // The archive has to survive the round trip, which is the only thing the user cares about.
  const read = await readZip(deflated);
  assert.deepEqual(
    read.map((entry) => entry.filename).sort(),
    ["archive/media/photo.jpg", "archive/tweets.json"]
  );
  const roundTripped = read.find((entry) => entry.filename === "archive/tweets.json");
  assert.deepEqual([...roundTripped.data], [...json], "deflated text must inflate back byte for byte");
  const media = read.find((entry) => entry.filename === "archive/media/photo.jpg");
  assert.deepEqual([...media.data], [...incompressible], "stored bytes must come back unchanged");
});

test("an empty entry and a zero-record archive still produce a readable zip", async () => {
  const { buildZip } = await importSourceModule("src/features/export/zip-store.ts");
  const { readZip } = await importSourceModule("src/features/export/zip-reader.ts");
  const empty = await buildZip([{ filename: "empty.txt", data: new Uint8Array(0) }]);
  const read = await readZip(empty);
  assert.equal(read.length, 1);
  assert.equal(read[0].data.length, 0);
  assert.ok((await buildZip([])).length > 0, "an archive with no entries is still a valid zip");
});

/**
 * The save-folder hint names the root folder inside every export ZIP, and it travels verbatim in a
 * shared settings file and in a library restore. It stripped only the Windows-illegal characters,
 * so `..` survived -- and the export side rewrites a backslash to a forward slash, which turned a
 * Windows-shaped traversal into a working POSIX one on the way into the archive.
 */
test("a hostile save-folder hint cannot put a traversal into a ZIP entry name", async () => {
  const { normalizeSettings } = await importSourceModule("src/platform/settings.ts");
  const { buildExportZip } = await importSourceModule("src/features/export/export-feature.ts");

  const records = [
    {
      tweetId: "1",
      handle: "someone",
      displayName: "Someone",
      text: "hello",
      capturedAt: new Date(0).toISOString(),
      surface: "home",
      media: [],
      permalink: "https://x.com/someone/status/1"
    }
  ];

  const localHeaderNames = (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const names = [];
    for (let index = 0; index + 30 <= bytes.length; index += 1) {
      if (view.getUint32(index, true) !== 0x04034b50) continue;
      const nameLength = view.getUint16(index + 26, true);
      names.push(new TextDecoder().decode(bytes.subarray(index + 30, index + 30 + nameLength)));
    }
    return names;
  };

  const hostile = [
    "../../../../AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup",
    "..\\..\\..\\Startup",
    "./../escape",
    "CON",
    "trailing. ",
    "//leading"
  ];

  for (const folder of hostile) {
    const persisted = normalizeSettings({ media: { lastSaveFolder: folder } }).media.lastSaveFolder;
    assert.ok(
      !persisted.split("/").includes(".."),
      `${JSON.stringify(folder)} persisted as ${JSON.stringify(persisted)}`
    );
    const names = localHeaderNames(await buildExportZip(records, ["json"], persisted));
    assert.ok(names.length > 0, "the archive must still contain entries");
    for (const name of names) {
      assert.ok(
        !name.split("/").includes(".."),
        `${JSON.stringify(folder)} produced the entry ${JSON.stringify(name)}`
      );
      assert.ok(!name.startsWith("/"), `${JSON.stringify(name)} must not be absolute`);
    }
  }

  // The control: an ordinary folder name is still used, unchanged.
  const ordinary = normalizeSettings({
    media: { lastSaveFolder: "aviary-exports" }
  }).media.lastSaveFolder;
  assert.equal(ordinary, "aviary-exports");
  const kept = localHeaderNames(await buildExportZip(records, ["json"], ordinary));
  assert.ok(
    kept.every((name) => name.startsWith("aviary-exports/")),
    `an ordinary folder must still prefix every entry, saw ${JSON.stringify(kept)}`
  );
});

/**
 * The length cap is applied after the segments are rejoined, so it can land on a separator. A
 * trailing slash turns every entry into `folder//name`, an empty path segment.
 */
test("a truncated save-folder hint leaves no empty path segment", async () => {
  const { normalizeSettings, sanitizeFolderHint } = await importSourceModule(
    "src/platform/settings.ts"
  );

  const long = "seg/".repeat(40) + "tail";
  for (const value of [long, "folder/", "folder//", "a/b/"]) {
    const reduced = sanitizeFolderHint(value, 80);
    assert.ok(!reduced.endsWith("/"), `${JSON.stringify(value)} kept a trailing separator`);
    assert.ok(!reduced.includes("//"), `${JSON.stringify(value)} kept an empty segment`);
  }

  // Windows reserved device names are refused whatever extension follows them.
  for (const reserved of ["CON", "con.txt", "NUL", "com1", "LPT9.log", "CONIN$", "clock$.txt"]) {
    assert.equal(
      normalizeSettings({ media: { lastSaveFolder: reserved } }).media.lastSaveFolder,
      "",
      `${reserved} is reserved on Windows and must not become a folder`
    );
  }
});
