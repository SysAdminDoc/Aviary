import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("formatXlsx packages an OPC-shaped ZIP with the expected parts", async () => {
  const { formatXlsx } = await importBundledModule("src/features/export/xlsx.ts");
  const { readStoreZip } = await importBundledModule("src/features/export/zip-reader.ts");

  const artifact = formatXlsx([
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: 'Has "quoted" tokens & angle <brackets>',
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/alpha/status/1"
    }
  ]);

  assert.equal(artifact.filename, "tweets.xlsx");
  assert.equal(
    artifact.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const entries = readStoreZip(artifact.data);
  const filenames = new Set(entries.map((entry) => entry.filename));
  assert.ok(filenames.has("[Content_Types].xml"));
  assert.ok(filenames.has("_rels/.rels"));
  assert.ok(filenames.has("xl/workbook.xml"));
  assert.ok(filenames.has("xl/worksheets/sheet1.xml"));
  const sheet = new TextDecoder().decode(
    entries.find((entry) => entry.filename === "xl/worksheets/sheet1.xml").data
  );
  assert.match(sheet, /Has &quot;quoted&quot; tokens &amp; angle &lt;brackets&gt;/);
});

test("selectSupportedFormats now accepts xlsx", async () => {
  const { selectSupportedFormats } = await importBundledModule(
    "src/features/export/export-feature.ts"
  );
  assert.deepEqual(selectSupportedFormats(["json", "xlsx"]), ["json", "xlsx"]);
  assert.deepEqual(selectSupportedFormats(["exe", "xlsx"]), ["xlsx"]);
});

test("BookmarkStore round-trips, dedupes tags, and reports tag/folder summaries", async () => {
  const { BookmarkStore } = await importBundledModule("src/features/library/bookmarks.ts");

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

  const bookmarks = new BookmarkStore(storage);
  await bookmarks.load();

  const first = await bookmarks.upsert({
    tweetId: "1",
    handle: "alpha",
    text: "Hello",
    tags: ["Reading", "reading", "#reading", "DESIGN", "  spaced  "],
    folder: "later"
  });
  // "spaced" is a valid tag after trim; "Reading"/"reading"/"#reading" dedupe to "reading"; "DESIGN" lowercases.
  assert.deepEqual(first.tags, ["design", "reading", "spaced"]);
  assert.equal(first.folder, "later");

  await bookmarks.upsert({ tweetId: "2", handle: "beta", text: "Two", folder: "later" });
  await bookmarks.upsert({ tweetId: "3", handle: "gamma", text: "Three", folder: "archive" });

  assert.equal(bookmarks.list().length, 3);
  assert.deepEqual(bookmarks.folders(), ["archive", "later"]);
  assert.deepEqual(bookmarks.tags(), ["design", "reading", "spaced"]);

  await bookmarks.remove(first.id);
  assert.equal(bookmarks.list().length, 2);

  // Persistence round-trip
  const reloaded = new BookmarkStore(storage);
  await reloaded.load();
  assert.equal(reloaded.list().length, 2);
});

test("BookmarkStore.dueReminders selects entries past the cutoff", async () => {
  const { BookmarkStore } = await importBundledModule("src/features/library/bookmarks.ts");
  const store = new Map();
  const storage = makeStorage(store);
  const bookmarks = new BookmarkStore(storage);
  await bookmarks.load();
  const past = await bookmarks.upsert({ tweetId: "1", text: "past", remindAt: "2026-05-18T00:00:00Z" });
  const future = await bookmarks.upsert({ tweetId: "2", text: "future", remindAt: "2027-01-01T00:00:00Z" });

  const due = bookmarks.dueReminders(new Date("2026-05-19T12:00:00Z"));
  assert.equal(due.length, 1);
  assert.equal(due[0].id, past.id);
  assert.ok(!due.find((entry) => entry.id === future.id));
});

test("network-capture source guards GraphQL routing, payload bounds, and auth scrubbing", async () => {
  const source = await readFile(
    path.join(root, "src/features/export/network-capture.ts"),
    "utf8"
  );
  for (const marker of [
    "api\\/graphql",
    "MAX_PAYLOAD_BYTES",
    "preserveRawPayloads",
    "scrubAuth",
    "ct0",
    "Bearer"
  ]) {
    assert.ok(source.includes(marker), `network-capture missing ${marker}`);
  }
});

test("composer-snippets source uses execCommand insertText (no keyboard simulation)", async () => {
  const source = await readFile(
    path.join(root, "src/features/composer/composer-snippets.ts"),
    "utf8"
  );
  for (const marker of [
    'execCommand("insertText"',
    "tweetTextarea_0",
    "data-av-snippet-palette",
    "destroy"
  ]) {
    assert.ok(source.includes(marker), `composer-snippets missing ${marker}`);
  }
  // No simulated keypress.
  assert.ok(!/dispatchEvent\(new KeyboardEvent/.test(source));
});

function makeStorage(map) {
  return {
    async get(key, fallback) {
      return map.has(key) ? map.get(key) : fallback;
    },
    async set(key, value) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      map.delete(key);
    }
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v11x-"));
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
