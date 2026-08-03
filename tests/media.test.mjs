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

test("Aria2 history persists queued gids and reconciles completed or failed work", async () => {
  const { Aria2History, ARIA2_HISTORY_KEY } = await importBundledModule(
    "src/features/integrations/aria2.ts"
  );
  const store = new Map([
    [ARIA2_HISTORY_KEY, {
      entries: [
        { gid: "done", url: "https://cdn.test/done.mp4", filename: "done.mp4", status: "queued", queuedAt: "2026-05-19T00:00:00Z" },
        { gid: "gone", url: "https://cdn.test/gone.mp4", filename: "gone.mp4", status: "queued", queuedAt: "2026-05-19T00:00:00Z" }
      ]
    }]
  ]);
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.params[0] === "done") {
      return new Response(JSON.stringify({ result: { status: "complete" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: "gid not found" } }), { status: 200 });
  };

  try {
    const history = new Aria2History(storage);
    await history.load();
    const result = await history.reconcile({ endpoint: "http://aria.test", secret: "" });
    assert.deepEqual(result, { completed: 1, removed: 1 });
    assert.equal(history.hasUrl("https://cdn.test/done.mp4"), true);
    assert.equal(history.hasUrl("https://cdn.test/gone.mp4"), false);
    assert.equal(history.snapshot().entries[0].status, "complete");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Aria2 downloader history prevents the same URL from requeueing", async () => {
  const { Aria2History } = await importBundledModule("src/features/integrations/aria2.ts");
  const { createDownloader } = await importBundledModule("src/features/media/downloader.ts");
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
  const history = new Aria2History(storage);
  await history.load();
  const originalFetch = globalThis.fetch;
  let addCalls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "aria2.addUri") {
      addCalls += 1;
      return new Response(JSON.stringify({ result: "gid-1" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };

  try {
    const integrations = {
      aria2: { enabled: true, endpoint: "http://aria.test", secret: "", minBytes: 1 },
      bluesky: { enabled: false, service: "", handle: "", appPassword: "" },
      mastodon: { enabled: false, instance: "", token: "", visibility: "public" },
      ai: { enabled: false, provider: "anthropic", endpoint: "", apiKey: "", model: "" },
      semanticSearch: { enabled: false, endpoint: "", apiKey: "", model: "", autoIndex: false }
    };
    const downloader = createDownloader({ integrations, aria2History: history });
    const first = await downloader({ url: "https://cdn.test/one.mp4", filename: "one.mp4", estimatedBytes: 10 });
    const second = await downloader({ url: "https://cdn.test/one.mp4", filename: "one-again.mp4", estimatedBytes: 10 });
    assert.deepEqual(first, { ok: true, via: "aria2", gid: "gid-1" });
    assert.deepEqual(second, { ok: true, via: "aria2", deduplicated: true });
    assert.equal(addCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
