import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("normalizeImageUrl forces name=orig and preserves format", async () => {
  const { normalizeImageUrl } = await importSourceModule("src/features/media/urls.ts");

  const small = normalizeImageUrl(
    "https://pbs.twimg.com/media/AbCdEfGh.jpg?format=jpg&name=small"
  );
  assert.equal(small?.url, "https://pbs.twimg.com/media/AbCdEfGh.jpg?format=jpg&name=orig");
  assert.deepEqual(small?.fallbackUrls, [
    "https://pbs.twimg.com/media/AbCdEfGh.jpg?format=jpg&name=4096x4096"
  ]);
  assert.equal(small?.format, "jpg");
  assert.equal(small?.mediaId, "AbCdEfGh");

  const png = normalizeImageUrl("https://pbs.twimg.com/media/ZZZ-789?format=png&name=large");
  assert.equal(png?.url, "https://pbs.twimg.com/media/ZZZ-789?format=png&name=orig");
  assert.equal(png?.format, "png");

  const webp = normalizeImageUrl("https://pbs.twimg.com/media/qqqqq?format=webp");
  assert.equal(webp?.format, "webp");

  const pngPathOnly = normalizeImageUrl("https://pbs.twimg.com/media/path-only.png?name=small");
  assert.equal(pngPathOnly?.url, "https://pbs.twimg.com/media/path-only.png?name=orig&format=png");
  assert.deepEqual(pngPathOnly?.fallbackUrls, [
    "https://pbs.twimg.com/media/path-only.png?name=4096x4096&format=png"
  ]);
  assert.equal(pngPathOnly?.format, "png");

  const webpPathOnly = normalizeImageUrl("https://pbs.twimg.com/media/path-only.webp");
  assert.equal(webpPathOnly?.format, "webp");

  const jpegPathOnly = normalizeImageUrl("https://pbs.twimg.com/media/path-only.jpeg?name=small");
  assert.equal(jpegPathOnly?.format, "jpg");

  const served = normalizeImageUrl(
    "https://pbs.twimg.com/media/served?format=jpg&name=medium",
    { preferOriginal: false }
  );
  assert.equal(served?.url, "https://pbs.twimg.com/media/served?format=jpg&name=medium");
  assert.deepEqual(served?.fallbackUrls, []);

  assert.equal(normalizeImageUrl("https://example.com/foo.png"), null);
  assert.equal(normalizeImageUrl("not a url"), null);
});

test("content fingerprints collapse X size variants and distinguish match strength", async () => {
  const {
    hexadecimalHammingDistance,
    mediaIdentityHash,
    perceptualHashFromRgba,
    PERCEPTUAL_HASH_HEIGHT,
    PERCEPTUAL_HASH_WIDTH
  } = await importSourceModule("src/features/export/assets.ts");
  const small = mediaIdentityHash(
    "photo",
    "https://pbs.twimg.com/media/AbCdEfGh?format=jpg&name=small",
    null
  );
  const original = mediaIdentityHash(
    "photo",
    "https://pbs.twimg.com/media/AbCdEfGh?format=png&name=orig",
    null
  );
  assert.equal(small, original, "the mutable size and encoding must not define the X asset");
  assert.notEqual(
    small,
    mediaIdentityHash("photo", "https://pbs.twimg.com/media/Different?name=small", null)
  );

  const ascending = new Uint8ClampedArray(PERCEPTUAL_HASH_WIDTH * PERCEPTUAL_HASH_HEIGHT * 4);
  const descending = new Uint8ClampedArray(ascending.length);
  for (let y = 0; y < PERCEPTUAL_HASH_HEIGHT; y += 1) {
    for (let x = 0; x < PERCEPTUAL_HASH_WIDTH; x += 1) {
      const offset = (y * PERCEPTUAL_HASH_WIDTH + x) * 4;
      const light = x * 12;
      const dark = 255 - light;
      ascending.set([light, light, light, 255], offset);
      descending.set([dark, dark, dark, 255], offset);
    }
  }
  const ascendingHash = perceptualHashFromRgba(ascending);
  const descendingHash = perceptualHashFromRgba(descending);
  assert.equal(ascendingHash.length, 64, "the visual signature must carry 256 bits");
  assert.equal(hexadecimalHammingDistance(ascendingHash, ascendingHash), 0);
  assert.equal(hexadecimalHammingDistance(ascendingHash, descendingHash), 256);
});

test("MediaHistory matches exact bytes, X identities, and opt-in visual similarity", async () => {
  const { MediaHistory, MEDIA_HISTORY_KEY } = await importSourceModule(
    "src/features/media/history.ts"
  );
  const { mediaIdentityHash } = await importSourceModule("src/features/export/assets.ts");
  const store = new Map();
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? structuredClone(store.get(key)) : fallback;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
    async remove(key) {
      store.delete(key);
    }
  };
  const history = new MediaHistory(storage);
  await history.load();

  const saved = {
    identityHash: mediaIdentityHash(
      "photo",
      "https://pbs.twimg.com/media/AssetOne?format=jpg&name=small",
      null
    ),
    exactHash: "1".repeat(64),
    perceptualHash: "0".repeat(64)
  };
  assert.equal(await history.record(saved), true);

  const resized = {
    identityHash: mediaIdentityHash(
      "photo",
      "https://pbs.twimg.com/media/AssetOne?format=png&name=orig",
      null
    ),
    exactHash: "2".repeat(64)
  };
  assert.equal(history.findMatch(resized), "identity", "a different name= size is the same X asset");

  const sameBytesElsewhere = {
    identityHash: mediaIdentityHash(
      "photo",
      "https://pbs.twimg.com/media/OtherAsset?format=jpg&name=orig",
      null
    ),
    exactHash: saved.exactHash
  };
  assert.equal(history.findMatch(sameBytesElsewhere), "exact");
  assert.equal(await history.record(sameBytesElsewhere), false, "one content hash must keep one entry");

  const visuallySimilar = {
    identityHash: mediaIdentityHash(
      "photo",
      "https://pbs.twimg.com/media/Reencoded?format=webp&name=orig",
      null
    ),
    exactHash: "3".repeat(64),
    perceptualHash: `${"0".repeat(63)}1`
  };
  assert.equal(history.findMatch(visuallySimilar, false), null, "visual matching stays opt-in");
  assert.equal(history.findMatch(visuallySimilar, true), "perceptual");
  await history.noteMatch("identity");
  await history.noteMatch("exact");
  await history.noteMatch("perceptual");

  const snapshot = history.snapshot();
  assert.equal(snapshot.entries.length, 1, "alternate URLs must not grow the index");
  assert.deepEqual(snapshot.matches, { identity: 1, exact: 1, perceptual: 1 });
  assert.equal(snapshot.lastMatch.kind, "perceptual");
  const stored = store.get(MEDIA_HISTORY_KEY);
  assert.equal(stored.schemaVersion, 4);
  assert.deepEqual(stored.reservations, []);
  assert.ok(stored.entries.every((entry) => !Object.hasOwn(entry, "key")));
  assert.ok(stored.entries.every((entry) => !JSON.stringify(entry).includes("twimg.com")));
});

test("MediaHistory records quality receipts, upgrades fallback saves, and migrates old entries", async () => {
  const { MediaHistory, MEDIA_HISTORY_KEY } = await importSourceModule(
    "src/features/media/history.ts"
  );
  const { mediaIdentityHash } = await importSourceModule("src/features/export/assets.ts");
  const identityHash = mediaIdentityHash(
    "photo",
    "https://pbs.twimg.com/media/Receipt?format=png&name=orig",
    null
  );
  const store = new Map([[MEDIA_HISTORY_KEY, {
    schemaVersion: 3,
    entries: [{ identityHash, at: "2026-08-01T00:00:00.000Z" }],
    reservations: []
  }]]);
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? structuredClone(store.get(key)) : fallback;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
    async remove(key) {
      store.delete(key);
    }
  };
  const history = new MediaHistory(storage);
  await history.load();

  assert.deepEqual(history.findQuality({ identityHash }), {
    label: "quality-unknown",
    width: null,
    height: null,
    bitrate: null,
    mime: null
  });
  assert.equal(store.get(MEDIA_HISTORY_KEY).schemaVersion, 4);

  assert.equal(await history.record({ identityHash }, {
    label: "fallback",
    width: 4096,
    height: 4096,
    bitrate: null,
    mime: "image/png"
  }), true);
  assert.equal(await history.record({ identityHash }, {
    label: "original",
    width: 12_000,
    height: 8_000,
    bitrate: null,
    mime: "image/png"
  }), true);
  assert.deepEqual(history.findQuality({ identityHash }), {
    label: "original",
    width: 12_000,
    height: 8_000,
    bitrate: null,
    mime: "image/png"
  });
  assert.doesNotMatch(JSON.stringify(store.get(MEDIA_HISTORY_KEY)), /pbs\.twimg|https?:/i);
});

test("fingerprintMediaDownload hashes the bytes returned by the media host", async () => {
  const { fingerprintMediaDownload } = await importSourceModule(
    "src/features/media/downloader.ts"
  );
  const originalFetch = globalThis.fetch;
  const bytes = new Uint8Array([9, 8, 7, 6, 5, 4]);
  globalThis.fetch = async () => new Response(bytes, {
    status: 200,
    headers: { "content-type": "image/jpeg", "content-length": String(bytes.byteLength) }
  });
  try {
    const first = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/First?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: false
    });
    const second = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/Second?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: false
    });
    assert.notEqual(first.identityHash, second.identityHash, "the fixture needs distinct source identities");
    assert.equal(first.exactHash, second.exactHash, "equal response bytes must share one exact hash");
    assert.match(first.exactHash, /^[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fingerprinting uses one short budget for every fallback candidate", async () => {
  const { fingerprintMediaDownload, MEDIA_FINGERPRINT_TIMEOUT_MS } = await importSourceModule(
    "src/features/media/downloader.ts"
  );
  assert.ok(MEDIA_FINGERPRINT_TIMEOUT_MS <= 2_000);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    });
  };
  try {
    const startedAt = Date.now();
    const fingerprint = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/stalled-one?format=jpg&name=orig",
      fallbackUrls: [
        "https://pbs.twimg.com/media/stalled-two?format=jpg&name=orig",
        "https://pbs.twimg.com/media/stalled-three?format=jpg&name=orig"
      ],
      mediaId: null,
      includePerceptual: false,
      timeoutMs: 20
    });
    assert.ok(Date.now() - startedAt < 200, "a fingerprint miss must not delay the save path");
    assert.equal(requests, 1, "a spent total budget must not restart for every fallback");
    assert.equal(fingerprint.exactHash, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("media sidecars render bounded JSON or text beside the saved filename", async () => {
  const { buildMediaSidecar } = await importSourceModule(
    "src/features/media/sidecar.ts"
  );
  const input = {
    mediaFilename: "saved/alice_123_1.jpg",
    kind: "photo",
    handle: "alice",
    tweetId: "123",
    text: `hello ${"x".repeat(12_000)}`,
    permalink: "https://x.com/alice/status/123",
    savedAt: "2026-08-21T12:00:00.000Z"
  };

  const json = buildMediaSidecar("json", input);
  assert.equal(json.filename, "saved/alice_123_1.json");
  assert.equal(json.contentType, "application/json");
  const payload = JSON.parse(new TextDecoder().decode(json.data));
  assert.equal(payload.media.filename, "saved/alice_123_1.jpg");
  assert.equal(payload.post.handle, "alice");
  assert.equal(payload.post.text.length, 10_000, "persisted sidecar text must stay bounded");

  const text = buildMediaSidecar("text", input);
  assert.equal(text.filename, "saved/alice_123_1.txt");
  assert.equal(text.contentType, "text/plain");
  assert.match(new TextDecoder().decode(text.data), /Post: https:\/\/x\.com\/alice\/status\/123/);
  assert.equal(buildMediaSidecar("off", input), null);
});

test("sidecar format is opt-in and rejects unknown imported values", async () => {
  const { normalizeSettings } = await importSourceModule("src/platform/settings.ts");
  assert.equal(normalizeSettings({}).media.sidecarFormat, "off");
  assert.equal(normalizeSettings({ media: { sidecarFormat: "json" } }).media.sidecarFormat, "json");
  assert.equal(normalizeSettings({ media: { sidecarFormat: "xml" } }).media.sidecarFormat, "off");
});

test("MediaHistory repairs malformed entries and reservations in a current-version snapshot", async () => {
  const { MediaHistory, MEDIA_HISTORY_KEY } = await importSourceModule(
    "src/features/media/history.ts"
  );
  const store = new Map([[MEDIA_HISTORY_KEY, {
    schemaVersion: 3,
    entries: [null, "broken", 4],
    reservations: [{ token: "a".repeat(64), identityHash: "b".repeat(64) }]
  }]]);
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? structuredClone(store.get(key)) : fallback;
    },
    async set(key, value) {
      store.set(key, structuredClone(value));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const history = new MediaHistory(storage);
  await history.load();

  assert.equal(history.size(), 0);
  assert.deepEqual(store.get(MEDIA_HISTORY_KEY), {
    schemaVersion: 4,
    entries: [],
    reservations: [],
    matches: { identity: 0, exact: 0, perceptual: 0 },
    lastMatch: null
  });
});

test("media history export filters inclusive date ranges without exposing source URLs", async () => {
  const { buildMediaHistoryExportArtifacts } = await importSourceModule(
    "src/features/media/history.ts"
  );
  const snapshot = {
    entries: [
      { identityHash: "a".repeat(64), at: "2026-01-01T00:00:00.000Z" },
      { identityHash: "b".repeat(64), exactHash: "c".repeat(64), at: "2026-01-15T12:30:00.000Z" },
      { identityHash: "d".repeat(64), at: "2026-02-01T00:00:00.000Z" }
    ],
    matches: { identity: 2, exact: 1, perceptual: 0 },
    lastMatch: { kind: "exact", at: "2026-01-15T12:30:00.000Z" }
  };
  const artifacts = buildMediaHistoryExportArtifacts(snapshot, {
    from: "2026-01-01",
    to: "2026-01-31"
  });
  assert.deepEqual(artifacts.map((artifact) => artifact.filename), [
    "aviary-media-history-20260101-to-20260131.json",
    "aviary-media-history-20260101-to-20260131.csv"
  ]);
  const payload = JSON.parse(new TextDecoder().decode(artifacts[0].data));
  assert.equal(payload.count, 2);
  assert.deepEqual(payload.entries.map((entry) => entry.identityHash), ["a".repeat(64), "b".repeat(64)]);
  assert.ok(payload.entries.every((entry) => entry.quality.label === "quality-unknown"));
  assert.doesNotMatch(JSON.stringify(payload), /pbs\.twimg|https?:/i);
  const csv = new TextDecoder().decode(artifacts[1].data);
  assert.match(csv, /quality,width,height,bitrate,mime,downloaded_at/);
  assert.doesNotMatch(csv, /2026-02-01/);
  assert.throws(
    () => buildMediaHistoryExportArtifacts(snapshot, { from: "2026-02-31" }),
    /History date is invalid/
  );
  assert.throws(
    () => buildMediaHistoryExportArtifacts(snapshot, { from: "2026-02-02", to: "2026-02-01" }),
    /on or before/
  );
});

test("tweetIdFromHref extracts the numeric tweet id when present", async () => {
  const { tweetIdFromHref } = await importSourceModule("src/features/media/urls.ts");
  assert.equal(tweetIdFromHref("/handle/status/1234567890"), "1234567890");
  assert.equal(tweetIdFromHref("https://x.com/handle/status/9876543210/photo/1"), "9876543210");
  assert.equal(tweetIdFromHref("/handle"), null);
  assert.equal(tweetIdFromHref(null), null);
});

test("renderFilename interpolates fields and sanitizes unsafe segments", async () => {
  const { renderFilename } = await importSourceModule("src/features/media/template.ts");

  assert.equal(
    renderFilename("{account}/{tweetId}", {
      handle: "alpha",
      tweetId: "999",
      index: 0,
      total: 1,
      date: new Date("2026-05-19T12:00:00Z"),
      ext: "jpg",
      text: "",
      mediaId: null
    }),
    "alpha/999.jpg"
  );

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
  const { MediaHistory, MEDIA_HISTORY_KEY } = await importSourceModule(
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

test("last download hint persists only valid media source metadata", async () => {
  const { getLastDownload, rememberLastDownload, LAST_DOWNLOAD_KEY } = await importSourceModule(
    "src/features/media/last-download.ts"
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

  await rememberLastDownload(storage, { url: "javascript:alert(1)", filename: "bad.jpg", kind: "photo" });
  assert.equal(await getLastDownload(storage), null);
  await rememberLastDownload(storage, {
    url: "https://pbs.twimg.com/media/abc.jpg?name=orig",
    filename: "post.jpg",
    kind: "photo"
  });
  const saved = await getLastDownload(storage);
  assert.equal(saved?.url, "https://pbs.twimg.com/media/abc.jpg?name=orig");
  assert.equal(saved?.filename, "post.jpg");
  assert.ok(store.has(LAST_DOWNLOAD_KEY));
});

test("DownloadQueue tracks status transitions and snapshots", async () => {
  const { DownloadQueue } = await importSourceModule("src/features/media/queue.ts");
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

test("DownloadQueue refreshes a queued media target before it starts", async () => {
  const { DownloadQueue } = await importSourceModule("src/features/media/queue.ts");
  const queue = new DownloadQueue();
  const job = queue.enqueue({
    url: "https://video.twimg.com/low.mp4",
    fallbackUrls: ["https://video.twimg.com/fallback.mp4"],
    filename: "video.mp4",
    mediaId: "media-1"
  });

  assert.equal(
    queue.updateTarget(job.id, {
      url: "https://video.twimg.com/high.mp4",
      fallbackUrls: ["https://video.twimg.com/low.mp4"],
      mediaId: "media-1"
    }),
    true
  );
  assert.deepEqual(queue.pending()[0], {
    ...job,
    url: "https://video.twimg.com/high.mp4",
    fallbackUrls: ["https://video.twimg.com/low.mp4"]
  });

  queue.mark(job.id, "running");
  assert.equal(
    queue.updateTarget(job.id, {
      url: "https://video.twimg.com/ignored.mp4",
      mediaId: "media-1"
    }),
    false,
    "a target must not change after the transfer starts"
  );
});

test("DownloadQueue persists interrupted work and supports recovery controls", async () => {
  const { DownloadQueue, MEDIA_QUEUE_KEY } = await importSourceModule("src/features/media/queue.ts");
  const store = new Map([
    [MEDIA_QUEUE_KEY, {
      sequence: 4,
      jobs: [{ id: "job-4", url: "https://cdn.test/recover.jpg", filename: "recover.jpg", status: "running" }]
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

  const queue = new DownloadQueue(storage);
  await queue.load();
  assert.equal(queue.snapshot().paused, 1);
  const [interrupted] = queue.pending(true);
  assert.equal(interrupted?.resumeOnBoot, true);
  assert.match(interrupted?.error ?? "", /Interrupted/);

  assert.equal(queue.resume(interrupted.id), true);
  assert.equal(queue.pause(interrupted.id), true);
  assert.equal(queue.snapshot().paused, 1);
  assert.equal(queue.cancel(interrupted.id), true);
  assert.equal(queue.snapshot().cancelled, 1);

  const failed = queue.enqueue({ url: "https://cdn.test/retry.jpg", filename: "retry.jpg" });
  queue.mark(failed.id, "failed", "network");
  const retryable = queue.retryFailed();
  assert.deepEqual(retryable.map((job) => job.id), ["job-4", failed.id]);
  assert.equal(queue.snapshot().queued, 2);
  await queue.flush();

  const reloaded = new DownloadQueue(storage);
  await reloaded.load();
  assert.equal(reloaded.snapshot().queued, 2);
  assert.equal(reloaded.snapshot().paused, 0);
});

test("Aria2 history persists queued gids and reconciles completed or failed work", async () => {
  const { Aria2History, ARIA2_HISTORY_KEY } = await importSourceModule(
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
  const { Aria2History } = await importSourceModule("src/features/integrations/aria2.ts");
  const { createDownloader } = await importSourceModule("src/features/media/downloader.ts");
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

test("userscript downloads try the original image before the bounded fallback", async () => {
  const { createDownloader } = await importSourceModule("src/features/media/downloader.ts");
  const attempted = [];
  const originalDownload = globalThis.GM_download;
  globalThis.GM_download = (options) => {
    attempted.push(options.url);
    if (options.url.includes("name=orig")) {
      options.onerror?.(new Error("original unavailable"));
    } else {
      options.onload?.();
    }
  };

  try {
    const downloader = createDownloader();
    const result = await downloader({
      url: "https://pbs.twimg.com/media/AbCdEfGh?format=jpg&name=orig",
      fallbackUrls: [
        "https://pbs.twimg.com/media/AbCdEfGh?format=jpg&name=4096x4096"
      ],
      filename: "AbCdEfGh.jpg"
    });
    assert.deepEqual(result, { ok: true, via: "gm" });
    assert.deepEqual(attempted, [
      "https://pbs.twimg.com/media/AbCdEfGh?format=jpg&name=orig",
      "https://pbs.twimg.com/media/AbCdEfGh?format=jpg&name=4096x4096"
    ]);
  } finally {
    if (originalDownload === undefined) {
      delete globalThis.GM_download;
    } else {
      globalThis.GM_download = originalDownload;
    }
  }
});
