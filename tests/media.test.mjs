import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("normalizeImageUrl forces name=orig and preserves format", async () => {
  const { normalizeImageUrl } = await importBundledModule("src/features/media/urls.ts");

  const small = normalizeImageUrl(
    "https://pbs.twimg.com/media/AbCdEfGh.jpg?format=jpg&name=small"
  );
  assert.equal(small?.url, "https://pbs.twimg.com/media/AbCdEfGh.jpg?format=jpg&name=orig");
  assert.equal(small?.format, "jpg");
  assert.equal(small?.mediaId, "AbCdEfGh");

  const png = normalizeImageUrl("https://pbs.twimg.com/media/ZZZ-789?format=png&name=large");
  assert.equal(png?.url, "https://pbs.twimg.com/media/ZZZ-789?format=png&name=orig");
  assert.equal(png?.format, "png");

  const webp = normalizeImageUrl("https://pbs.twimg.com/media/qqqqq?format=webp");
  assert.equal(webp?.format, "webp");

  assert.equal(normalizeImageUrl("https://example.com/foo.png"), null);
  assert.equal(normalizeImageUrl("not a url"), null);
});

test("tweetIdFromHref extracts the numeric tweet id when present", async () => {
  const { tweetIdFromHref } = await importBundledModule("src/features/media/urls.ts");
  assert.equal(tweetIdFromHref("/handle/status/1234567890"), "1234567890");
  assert.equal(tweetIdFromHref("https://x.com/handle/status/9876543210/photo/1"), "9876543210");
  assert.equal(tweetIdFromHref("/handle"), null);
  assert.equal(tweetIdFromHref(null), null);
});

test("renderFilename interpolates fields and sanitizes unsafe segments", async () => {
  const { renderFilename } = await importBundledModule("src/features/media/template.ts");

  const result = renderFilename("{handle}_{tweetId}_{index}", {
    handle: "alpha",
    tweetId: "999",
    index: 0,
    total: 2,
    date: new Date("2026-05-19T12:00:00Z"),
    ext: "jpg",
    text: "First post",
    mediaId: "abc"
  });
  assert.equal(result, "alpha_999_01.jpg");

  const sanitized = renderFilename("{handle}/{text}.{ext}", {
    handle: "alpha:beta",
    tweetId: "1",
    index: 0,
    total: 1,
    date: new Date("2026-05-19T12:00:00Z"),
    ext: "jpg",
    text: 'Hello? <world>: "now"',
    mediaId: "mid"
  });
  assert.ok(!sanitized.includes(":"));
  assert.ok(!sanitized.includes("<"));
  assert.ok(sanitized.endsWith(".jpg"));

  const withDate = renderFilename("{date}_{mediaId}", {
    handle: null,
    tweetId: null,
    index: 4,
    total: 5,
    date: new Date("2026-05-19T12:00:00Z"),
    ext: "png",
    text: "",
    mediaId: "MED1"
  });
  assert.equal(withDate, "2026-05-19_MED1.png");
});

test("MediaHistory records, dedupes, persists, and clears", async () => {
  const { MediaHistory, MEDIA_HISTORY_KEY } = await importBundledModule(
    "src/features/media/history.ts"
  );

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

  const limit = 50;
  const history = new MediaHistory(storage, limit);
  await history.load();

  assert.equal(history.has("a"), false);
  assert.equal(await history.record("a"), true);
  assert.equal(history.has("a"), true);
  assert.equal(await history.record("a"), false);

  for (let i = 0; i < limit + 5; i++) {
    await history.record(`fill-${i}`);
  }
  assert.equal(history.size(), limit, "history caps at the configured limit");
  assert.equal(history.has("a"), false, "oldest entry should be evicted at the limit");
  assert.equal(history.has(`fill-${limit + 4}`), true, "newest entry survives eviction");

  await history.clear();
  assert.equal(history.size(), 0);

  const reloaded = new MediaHistory(storage, limit);
  await reloaded.load();
  assert.equal(reloaded.size(), 0);

  // Round-trip through storage.
  await reloaded.record("x");
  const hydrated = new MediaHistory(storage, limit);
  await hydrated.load();
  assert.equal(hydrated.has("x"), true);
  assert.ok(store.get(MEDIA_HISTORY_KEY));
});

test("DownloadQueue tracks status transitions and snapshots", async () => {
  const { DownloadQueue } = await importBundledModule("src/features/media/queue.ts");
  const queue = new DownloadQueue();

  const a = queue.enqueue({ url: "https://x/y.jpg", filename: "a.jpg" });
  queue.mark(a.id, "running");
  queue.mark(a.id, "completed");

  const b = queue.enqueue({ url: "https://x/z.jpg", filename: "b.jpg" });
  queue.mark(b.id, "failed", "network");

  const c = queue.enqueue({ url: "https://x/w.jpg", filename: "c.jpg" });
  queue.mark(c.id, "duplicate");

  const snapshot = queue.snapshot();
  assert.equal(snapshot.total, 3);
  assert.equal(snapshot.completed, 1);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.duplicate, 1);
  assert.ok(snapshot.recent.some((job) => job.error === "network"));
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-media-"));
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
