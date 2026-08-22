import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("reconstructThreads merges overlapping contexts, orders parents, and marks conversations", async () => {
  const { reconstructThreads, reconstructExportOrder } = await importBundledModule("src/features/export/thread-reconstruction.ts");
  const records = [
    record("103", "reply two", "bob", "101", "101", "bob", "2026-08-22T12:03:00Z"),
    record("101", "root", "alice", null, "101", "alice", "2026-08-22T12:00:00Z"),
    record("102", "reply one", "alice", "101", "101", "alice", "2026-08-22T12:01:00Z"),
    record("103", "reply two with media", "bob", "101", "101", "bob", "2026-08-22T12:03:00Z", [{ kind: "photo", url: "https://pbs.twimg.com/x" }])
  ];
  const [thread] = reconstructThreads(records);
  assert.equal(thread.kind, "conversation");
  assert.deepEqual(thread.records.map((entry) => entry.tweetId), ["101", "102", "103"]);
  assert.deepEqual(thread.participants.map((entry) => entry.handle), ["alice", "bob"]);
  assert.equal(thread.items.filter((entry) => entry.kind === "post")[2].differentAuthor, true);
  assert.deepEqual(reconstructExportOrder(records).map((entry) => entry.tweetId), ["101", "102", "103"]);
});

test("reconstructThreads surfaces missing parents and collapses same-author runs", async () => {
  const { reconstructThreads } = await importBundledModule("src/features/export/thread-reconstruction.ts");
  const [thread] = reconstructThreads([
    record("202", "second", "alice", "201", "201", "a1", "2026-08-22T12:02:00Z"),
    record("203", "third", "alice", "202", "201", "a1", "2026-08-22T12:03:00Z")
  ]);
  assert.equal(thread.rootId, "201");
  assert.deepEqual(thread.gaps.map((gap) => gap.missingId), ["201"]);
  assert.deepEqual(thread.records.map((entry) => entry.tweetId), ["202", "203"]);
  assert.equal(thread.authorRuns.length, 1);
  assert.equal(thread.authorRuns[0].count, 2);
});

test("reconstructThreads keeps richer duplicate data and does not invent handle threads", async () => {
  const { reconstructThreads } = await importBundledModule("src/features/export/thread-reconstruction.ts");
  const rich = record("500", "rich text", "same", null, null, "author-1", "2026-08-22T12:00:00Z");
  const poor = {
    ...rich,
    handle: null,
    displayName: null,
    text: "",
    authorId: null,
    conversationId: null,
    rootId: null,
    createdAt: null
  };
  const [merged] = reconstructThreads([rich, poor]);
  assert.equal(merged.records[0].text, "rich text");
  assert.equal(merged.records[0].handle, "same");
  assert.equal(merged.records[0].displayName, "same");
  assert.equal(merged.records[0].authorId, "author-1");

  const unrelated = reconstructThreads([
    record("501", "first", "same", null, null, null, "2026-08-22T12:01:00Z"),
    record("502", "second", "same", null, null, null, "2026-08-22T12:02:00Z")
  ]);
  assert.equal(unrelated.length, 2, "metadata-less posts from one author are not one fabricated thread");
});

function record(tweetId, text, handle, parentId, conversationId, authorId, createdAt, media = []) {
  return {
    tweetId,
    handle,
    displayName: handle,
    text,
    capturedAt: createdAt,
    createdAt,
    surface: "home",
    media,
    permalink: `https://x.com/${handle}/status/${tweetId}`,
    ...(parentId ? { parentId } : {}),
    ...(conversationId ? { conversationId, rootId: conversationId } : {}),
    ...(authorId ? { authorId } : {})
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-thread-"));
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
