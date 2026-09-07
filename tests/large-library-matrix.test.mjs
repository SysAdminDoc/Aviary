import assert from "node:assert/strict";
import { test } from "node:test";

import { importSourceModule } from "./helpers/source-import.mjs";
import {
  LARGE_LIBRARY_HEAP_BUDGET_BYTES,
  LARGE_LIBRARY_RECORD_COUNT,
  createLargeLibraryCorpus,
  corpusStats,
  normalizeLargeLibraryRows
} from "./helpers/large-library-corpus.mjs";

function storageFrom(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
    getStatus() {
      return { quotaBytes: null, usageBytes: 0, persisted: true };
    },
    values
  };
}

test("the deterministic 50,000-row corpus stays searchable and reports bad rows", async () => {
  const rows = createLargeLibraryCorpus();
  const normalized = normalizeLargeLibraryRows(rows);
  const stats = corpusStats(rows, normalized);

  assert.equal(stats.rows, LARGE_LIBRARY_RECORD_COUNT);
  assert.ok(stats.tombstones > 40, `tombstones were not represented: ${stats.tombstones}`);
  assert.ok(stats.malformed > 40, `malformed rows were not represented: ${stats.malformed}`);
  assert.ok(stats.duplicates > 100, `duplicate ids were not represented: ${stats.duplicates}`);
  assert.ok(stats.missingBytes > 1_000, `missing media bytes were not represented: ${stats.missingBytes}`);
  assert.ok(stats.unknownMedia > 1_000, `unknown media kinds were not represented: ${stats.unknownMedia}`);
  assert.equal(
    normalized.records.length + normalized.partials.length,
    LARGE_LIBRARY_RECORD_COUNT,
    "every input row must complete or produce a row-level partial"
  );
  assert.equal(new Set(normalized.records.map((record) => record.tweetId)).size, normalized.records.length);

  const { OfflineQueryIndex } = await importSourceModule("src/features/library/query-model.ts");
  const index = new OfflineQueryIndex();
  index.rebuild(normalized.records.map((record) => ({
    id: record.tweetId,
    collection: "posts",
    account: record.handle,
    text: record.text,
    tags: [],
    folder: null,
    capturedAt: record.capturedAt,
    mediaCount: record.media.length,
    payload: record
  })));
  assert.equal(index.size(), normalized.records.length);
  const hits = index.search("needle-7", { limit: 100 });
  assert.equal(hits.length, 100, `large index returned too few deterministic hits: ${hits.length}`);
  assert.ok(hits.every((hit) => hit.document.collection === "posts"));
});

test("backup, restore, ZIP, WARC, WACZ, and restart checkpoints survive the large corpus", async () => {
  const rows = createLargeLibraryCorpus();
  const { records } = normalizeLargeLibraryRows(rows);
  records.forEach((record) => { record.audience = "public"; });
  const [{ CheckpointStore, CHECKPOINT_KEY }, { buildStoreZip }, { readStoreZip }, { serializeExportRecords }, { buildIndexedWarcArchive }, { buildWaczArchive, estimateWaczBytes }, { buildWaczArchiveOffThread, MAX_WACZ_EXPORT_BYTES }, { createLibraryBackup, parseLibraryBackup, restoreLibraryBackup }, { pickPreferred }] = await Promise.all([
    importSourceModule("src/features/export/jobs.ts"),
    importSourceModule("src/features/export/zip-store.ts"),
    importSourceModule("src/features/export/zip-reader.ts"),
    importSourceModule("src/features/export/assets.ts"),
    importSourceModule("src/features/export/warc.ts"),
    importSourceModule("src/features/export/wacz.ts"),
    importSourceModule("src/features/export/wacz-worker-client.ts"),
    importSourceModule("src/features/core/library-backup.ts"),
    importSourceModule("src/features/media/video-extract.ts")
  ]);

  const storage = storageFrom();
  const checkpoint = new CheckpointStore(storage);
  await checkpoint.start("large-matrix", "home", ["json"], false);
  await checkpoint.append("large-matrix", records);
  assert.equal(checkpoint.records("large-matrix").length, records.length);

  const backup = await createLibraryBackup(storage, {
    selectedKeys: [CHECKPOINT_KEY],
    createdAt: "2026-09-07T00:00:00.000Z"
  });
  const parsedBackup = parseLibraryBackup(backup.artifact.data);
  assert.equal(parsedBackup.collections[0]?.count, records.length);
  const restoredStorage = storageFrom();
  const restored = await restoreLibraryBackup(restoredStorage, backup.artifact.data);
  assert.equal(restored.applied, true);
  const restoredCheckpoint = new CheckpointStore(restoredStorage);
  await restoredCheckpoint.load();
  assert.equal(restoredCheckpoint.records("large-matrix").length, records.length);

  const videoVariants = records
    .flatMap((record) => record.media)
    .filter((media) => media.kind === "video")
    .slice(0, 12)
    .map((media) => ({
      url: media.url,
      type: media.type ?? "video/mp4",
      width: media.width ?? 1280,
      height: media.height ?? 720,
      bitrate: media.bitrate ?? 1_000_000
    }));
  const preferred = pickPreferred([
    ...videoVariants,
    { url: "https://video.twimg.com/fixture.m3u8", type: "application/x-mpegURL", width: 3840, height: 2160, bitrate: 99_000_000 }
  ]);
  assert.ok(preferred.url.endsWith(".mp4"), "media selection must prefer a direct downloadable rendition");

  const payload = new TextEncoder().encode(JSON.stringify(serializeExportRecords(records)));
  const zip = buildStoreZip([{ filename: "records.json", data: payload }]);
  const zipEntries = readStoreZip(zip);
  assert.deepEqual(zipEntries.map((entry) => entry.filename), ["records.json"]);
  assert.equal(zipEntries[0]?.data.byteLength, payload.byteLength);

  const generatedAt = new Date("2026-09-07T00:00:00.000Z");
  let warc = buildIndexedWarcArchive(records, { generatedAt, filename: "matrix.warc" });
  assert.equal(warc.pages.length, records.length);
  assert.equal(warc.index.length, records.length);
  assert.ok(warc.artifact.data.byteLength > payload.byteLength / 2);
  warc = null;
  const wacz = buildWaczArchive(records, { generatedAt });
  assert.equal(wacz.contentType, "application/wacz");
  assert.ok(wacz.data.byteLength > 0);

  const oversized = [{
    ...records[0],
    media: [{ kind: "video", url: "https://video.twimg.com/huge.mp4", byteLength: MAX_WACZ_EXPORT_BYTES + 1 }]
  }];
  const estimate = estimateWaczBytes(oversized);
  assert.ok(estimate.estimatedBytes > MAX_WACZ_EXPORT_BYTES);
  const progress = [];
  await assert.rejects(
    () => buildWaczArchiveOffThread(oversized, { onProgress: (value) => progress.push(value) }),
    /safe export limit/
  );
  assert.deepEqual(progress, [], "an estimate refusal must happen before worker allocation or progress");

  const contentRestartStorage = storageFrom();
  const runningCheckpoint = new CheckpointStore(contentRestartStorage);
  await runningCheckpoint.start("content-restart", "home", ["json"], false);
  await runningCheckpoint.append("content-restart", records.slice(0, 200));
  const recoveredCheckpoint = new CheckpointStore(contentRestartStorage);
  await recoveredCheckpoint.load();
  assert.deepEqual(recoveredCheckpoint.listResumable().map((job) => job.jobId), ["content-restart"]);
  assert.equal(await recoveredCheckpoint.resume("content-restart"), true);

  const { ArchiveImportJobStore } = await importSourceModule("src/features/library/archive-import-jobs.ts");
  const workerRestartStorage = storageFrom();
  const importBeforeRestart = new ArchiveImportJobStore(workerRestartStorage);
  const importJob = await importBeforeRestart.start("matrix.zip", new Uint8Array([1, 2, 3, 4]));
  await importBeforeRestart.markRunning(importJob.jobId);
  const importAfterRestart = new ArchiveImportJobStore(workerRestartStorage);
  await importAfterRestart.load();
  const resumedImport = importAfterRestart.get(importJob.jobId);
  assert.equal(resumedImport?.status, "paused");
  assert.equal(resumedImport?.resumeOnBoot, true);
  assert.deepEqual(await importAfterRestart.source(importJob.jobId), new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(await importAfterRestart.resume(importJob.jobId), { ok: true });
});

test("Chromium keeps the large-library fixture below the documented heap budget", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info"] });
  try {
    const page = await browser.newPage();
    const rows = createLargeLibraryCorpus();
    const metrics = await page.evaluate((input) => {
      const retained = input.filter((row) => row && typeof row === "object" && row.tweetId && typeof row.text === "string");
      const documents = retained.map((row) => ({ id: row.tweetId, text: row.text, mediaCount: Array.isArray(row.media) ? row.media.length : 0 }));
      return {
        rows: input.length,
        documents: documents.length,
        heap: performance.memory?.usedJSHeapSize ?? 0
      };
    }, rows);
    assert.equal(metrics.rows, LARGE_LIBRARY_RECORD_COUNT);
    assert.ok(metrics.documents > 49_000);
    assert.ok(metrics.heap > 0, "Chromium must expose precise heap measurements for this release lane");
    assert.ok(
      metrics.heap < LARGE_LIBRARY_HEAP_BUDGET_BYTES,
      `Chromium heap ${Math.round(metrics.heap / 1024 / 1024)} MiB exceeded the documented ${Math.round(LARGE_LIBRARY_HEAP_BUDGET_BYTES / 1024 / 1024)} MiB budget`
    );
  } finally {
    await browser.close();
  }
});
