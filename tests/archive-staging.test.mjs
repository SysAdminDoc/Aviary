import assert from "node:assert/strict";
import test from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

const { buildStoreZip, buildZip } = await importSourceModule("src/features/export/zip-store.ts");
const {
  ARCHIVE_SOURCE_CHUNK_BYTES,
  ARCHIVE_SOURCE_MAX_CHUNK_BYTES,
  MAX_SOURCE_BYTES,
  ArchiveImportJobStore,
  archiveSourceChunkKey,
  archiveSourceKey
} = await importSourceModule("src/features/library/archive-import-jobs.ts");
const { readZipSource, ZIP_SOURCE_READ_BYTES } = await importSourceModule(
  "src/features/export/zip-reader.ts"
);
const { importOfficialArchiveFromSource } = await importSourceModule(
  "src/features/library/archive-import.ts"
);

function recordingStorage(quotaBytes = null) {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      writes.push({ key, value });
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    },
    getStatus: () => ({
      backend: "userscript-manager",
      schemaVersion: 1,
      migratedKeys: 0,
      usageBytes: null,
      quotaBytes,
      persistence: "unknown",
      lastError: null,
      pendingWrites: 0
    })
  };
}

test("archive sources stage fixed manager-safe chunks and rehydrate bounded reads", async () => {
  const storage = recordingStorage();
  const source = new Uint8Array(ARCHIVE_SOURCE_CHUNK_BYTES * 2 + 11);
  source.forEach((_, index) => {
    source[index] = index % 251;
  });
  const jobs = new ArchiveImportJobStore(storage);
  const job = await jobs.startBlob("large.zip", new Blob([source]));

  assert.equal(job.sourceChunks, 3);
  assert.equal(storage.values.has(archiveSourceKey(job.jobId)), true);
  const chunkWrites = storage.writes.filter(({ key }) => key.includes(".chunk."));
  assert.equal(chunkWrites.length, 3);
  assert.ok(chunkWrites.every(({ value }) => typeof value === "string"));
  assert.ok(chunkWrites.every(({ value }) => value.length <= 4 * 1024 * 1024));
  assert.ok(ARCHIVE_SOURCE_CHUNK_BYTES <= ARCHIVE_SOURCE_MAX_CHUNK_BYTES);

  const reader = await jobs.sourceReader(job.jobId);
  assert.ok(reader);
  const range = await reader.read(ARCHIVE_SOURCE_CHUNK_BYTES - 5, 20);
  assert.deepEqual(range, source.slice(ARCHIVE_SOURCE_CHUNK_BYTES - 5, ARCHIVE_SOURCE_CHUNK_BYTES + 15));

  const reloaded = new ArchiveImportJobStore(storage);
  await reloaded.load();
  assert.deepEqual(await reloaded.source(job.jobId), source);
  await reloaded.fail(job.jobId, "test failure");
  assert.equal(storage.values.has(archiveSourceChunkKey(job.jobId, 0)), true);
  await reloaded.retry(job.jobId);
  await reloaded.complete(job.jobId, { filesParsed: 1, recordCount: 1, warningCount: 0, errorCount: 0 });
  assert.equal(storage.values.has(archiveSourceKey(job.jobId)), false);
  assert.equal(storage.values.has(archiveSourceChunkKey(job.jobId, 0)), false);
});

test("the 256 MiB boundary refuses before a Blob is read", async () => {
  const storage = recordingStorage();
  const jobs = new ArchiveImportJobStore(storage);
  let reads = 0;
  const tooLarge = {
    size: MAX_SOURCE_BYTES + 1,
    slice() {
      reads += 1;
      throw new Error("should not read");
    },
    async arrayBuffer() {
      reads += 1;
      throw new Error("should not read");
    }
  };
  await assert.rejects(() => jobs.startBlob("too-large.zip", tooLarge), /256 MiB input limit/);
  assert.equal(reads, 0);
  assert.equal(storage.writes.length, 0);
});

test("the staged ZIP reader uses bounded source reads for store and deflate entries", async () => {
  const payload = new TextEncoder().encode("window.YTD.tweets.part0 = " + JSON.stringify([{ tweet: { id_str: "1" } } ]) + ";");
  for (const archive of [
    buildStoreZip([{ filename: "data/tweets.js", data: payload }]),
    await buildZip([{ filename: "data/tweets.js", data: payload }])
  ]) {
    const reads = [];
    const source = {
      size: archive.byteLength,
      async read(offset, length) {
        reads.push(length);
        return archive.slice(offset, offset + length);
      }
    };
    const entries = await readZipSource(source);
    assert.equal(entries[0]?.filename, "data/tweets.js");
    assert.deepEqual(entries[0]?.data, payload);
    assert.ok(Math.max(...reads) <= ZIP_SOURCE_READ_BYTES);
    assert.ok(Math.max(...reads) <= 4 * 1024 * 1024);
  }
});

test("archive import forwards pause cancellation into staged ZIP reads", async () => {
  const payload = new TextEncoder().encode("window.YTD.tweets.part0 = [];");
  const archive = buildStoreZip([
    { filename: "data/tweets.js", data: payload },
    { filename: "data/likes.js", data: payload }
  ]);
  let checks = 0;
  const reads = [];
  const source = {
    size: archive.byteLength,
    async read(offset, length) {
      reads.push({ offset, length });
      return archive.slice(offset, offset + length);
    }
  };
  const result = await importOfficialArchiveFromSource(source, "archive", [], {
    shouldContinue: () => {
      checks += 1;
      return checks < 2;
    }
  });
  assert.equal(result.records.length, 0);
  assert.ok(checks >= 2);
  assert.equal(reads.length, 4, "the parser should stop after the central directory and first entry");
});
