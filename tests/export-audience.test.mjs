import assert from "node:assert/strict";
import { test } from "node:test";

import { importSourceModule } from "./helpers/source-import.mjs";

const decoder = new TextDecoder();

test("GraphQL audience flags map to public, protected, and unknown without inference", async () => {
  const { parseCapturedThreadRecords } = await importSourceModule("src/features/export/thread-capture.ts");
  const body = JSON.stringify({ data: { tweets: [tweet("1", false), tweet("2", true), tweet("3")] } });
  const records = parseCapturedThreadRecords(body, "HomeTimeline", "2026-09-07T12:00:00Z");
  assert.deepEqual(records.map((record) => [record.tweetId, record.audience]), [
    ["1", "public"],
    ["2", "protected"],
    ["3", "unknown"]
  ]);
});

test("share exports exclude protected and unknown records while archival JSON and CSV keep them", async () => {
  const { summarizeAudience, filterShareRecords } = await importSourceModule("src/features/export/audience.ts");
  const { formatExport } = await importSourceModule("src/features/export/formatters.ts");
  const { buildExportZip } = await importSourceModule("src/features/export/export-feature.ts");
  const { readZip } = await importSourceModule("src/features/export/zip-reader.ts");
  const records = [
    sampleRecord("1", "public text", "public"),
    sampleRecord("2", "protected text", "protected"),
    { ...sampleRecord("3", "legacy text"), audience: undefined }
  ];
  assert.deepEqual(summarizeAudience(records), {
    total: 3,
    public: 1,
    protected: 1,
    unknown: 1,
    excludedProtected: 1,
    excludedUnknown: 1
  });
  assert.deepEqual(filterShareRecords(records).map((record) => record.tweetId), ["1"]);

  const json = JSON.parse(decoder.decode(formatExport("json", records).data));
  assert.deepEqual(json.records.map((record) => [record.tweetId, record.audience]), [
    ["1", "public"],
    ["2", "protected"],
    ["3", "unknown"]
  ]);
  const csv = decoder.decode(formatExport("csv", records).data);
  assert.match(csv, /tweetId,handle,displayName,capturedAt,surface,permalink,language,audience/);
  assert.match(csv, /protected/);
  assert.match(csv, /unknown/);

  const archive = await buildExportZip(records, ["json", "html", "markdown"], "share");
  const entries = await readZip(archive);
  const html = decoder.decode(entries.find((entry) => entry.filename === "share/tweets.html").data);
  const markdown = decoder.decode(entries.find((entry) => entry.filename === "share/tweets.md").data);
  const archivedJson = JSON.parse(decoder.decode(entries.find((entry) => entry.filename === "share/tweets.json").data));
  assert.match(html, /public text/);
  assert.doesNotMatch(html, /protected text|legacy text/);
  assert.doesNotMatch(markdown, /protected text|legacy text/);
  assert.equal(archivedJson.records.length, 3);

  const included = await buildExportZip(records, ["html"], "share", {
    audience: { includeProtected: true, includeUnknown: true }
  });
  const includedEntries = await readZip(included);
  const includedHtml = decoder.decode(includedEntries.find((entry) => entry.filename === "share/tweets.html").data);
  assert.match(includedHtml, /protected text/);
  assert.match(includedHtml, /legacy text/);
});

test("preservation builders apply the same audience policy", async () => {
  const { buildWarcArchive } = await importSourceModule("src/features/export/warc.ts");
  const { prepareWaczArchive } = await importSourceModule("src/features/export/wacz.ts");
  const records = [sampleRecord("1", "public text", "public"), sampleRecord("2", "protected text", "protected")];
  const policy = { audience: { includeProtected: false, includeUnknown: false } };
  const warc = decoder.decode(buildWarcArchive(records, policy).data);
  assert.match(warc, /public text/);
  assert.doesNotMatch(warc, /protected text/);
  const prepared = prepareWaczArchive(records, { ...policy, generatedAt: new Date("2026-09-07T00:00:00Z") });
  const archive = decoder.decode(prepared.resourceEntries.find((entry) => entry.filename === "archive/aviary.warc").data);
  assert.match(archive, /public text/);
  assert.doesNotMatch(archive, /protected text/);
});

test("library backup retains audience fields without rewriting the checkpoint value", async () => {
  const { createLibraryBackup, parseLibraryBackup } = await importSourceModule("src/features/core/library-backup.ts");
  const { CHECKPOINT_KEY } = await importSourceModule("src/features/export/jobs.ts");
  const raw = {
    jobs: {},
    records: {
      job: [sampleRecord("2", "protected text", "protected"), sampleRecord("3", "legacy text", "unknown")]
    }
  };
  const storage = {
    async get(key, fallback) { return key === CHECKPOINT_KEY ? raw : fallback; },
    async set() {},
    async remove() {}
  };
  const backup = await createLibraryBackup(storage, { selectedKeys: [CHECKPOINT_KEY], createdAt: "2026-09-07T00:00:00Z" });
  const collection = parseLibraryBackup(backup.artifact.data).collections[0];
  assert.equal(collection.value.records.job[0].audience, "protected");
  assert.equal(collection.value.records.job[1].audience, "unknown");
  assert.deepEqual(raw.records.job, collection.value.records.job);
});

function tweet(id, protectedValue) {
  return {
    rest_id: id,
    legacy: { id_str: id, full_text: `text ${id}` },
    core: { user_results: { result: {
      rest_id: `u-${id}`,
      legacy: { screen_name: `user${id}`, name: `User ${id}`, ...(typeof protectedValue === "boolean" ? { protected: protectedValue } : {}) }
    } } }
  };
}

function sampleRecord(tweetId, text, audience) {
  return {
    tweetId,
    handle: "reader",
    displayName: "Reader",
    text,
    capturedAt: "2026-09-07T00:00:00Z",
    surface: "home",
    media: [],
    permalink: `https://x.com/reader/status/${tweetId}`,
    ...(audience ? { audience } : {})
  };
}
