import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * What a media batch does to the rate limiter and to a refused download permission.
 *
 * Both were asserted as regexes: `/await ctx\.limiter\.waitForToken\(\)/` in the batch, and
 * `/if \(needsDownloadPermission\) return;/`. Neither can tell whether the token is drawn once
 * per item or once per batch, and the second matches a `return` inside a branch that is never
 * reached. The batch is run here against a fixture with a limiter that counts.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const FIXTURE = `
<main data-testid="primaryColumn">
  ${Array.from({ length: 10 }, (_, i) => `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <a href="/alice/status/190000000000000${i}"><time datetime="2026-08-18T10:0${i}:00.000Z">now</time></a>
      <div data-testid="User-Name"><a href="/alice">@alice</a></div>
      <div data-testid="tweetPhoto">
        <img src="https://pbs.twimg.com/media/photo${i}&format=jpg&name=small" alt="">
      </div>
    </article>
  </div>`).join("")}
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-batch-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { resumePendingMediaJobs, runMediaBatch, runCapturedMediaBatch } from ${JSON.stringify(abs("src/features/media/batch-downloader.ts"))};`,
      `export { mediaButtonsFeature, getMediaQueue, ingestMediaMetadata } from ${JSON.stringify(abs("src/features/media/media-buttons.ts"))};`,
      `export { sharedDownloadWatcher } from ${JSON.stringify(abs("src/features/media/download-watch.ts"))};`,
      `export { DownloadPermissionError, createDownloader } from ${JSON.stringify(abs("src/features/media/downloader.ts"))};`,
      `export { TokenBucket } from ${JSON.stringify(abs("src/platform/rate-limit.ts"))};`,
      // The page bundle carries its own copy of the outbound policy, and nothing is permitted
      // until one is installed. The cases below drive a configured integration, so they say so.
      `export { setLocalOnlyPolicy } from ${JSON.stringify(abs("src/features/integrations/network-policy.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryBatch",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><body>${FIXTURE}</body>`);
  await page.addScriptTag({ path: bundle });
  // Not in local-only mode, said once and explicitly. The module refuses everything until a policy
  // is installed, which is what stops a boot-order bug from letting a request out.
  await page.evaluate(() => AviaryBatch.setLocalOnlyPolicy(() => false));
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Runs a batch with a counting limiter and a download stub the test controls. */
function runBatch({ failWith } = {}) {
  return page.evaluate(async (mode) => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;

    let draws = 0;
    const limiter = {
      async waitForToken() {
        draws++;
      }
    };

    const attempts = [];
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          attempts.push(message.url);
          if (mode === "permission") {
            return { ok: false, code: "downloads-permission-missing", error: "downloads permission not granted" };
          }
          return { ok: true };
        }
      }
    };

    const result = await AviaryBatch.runMediaBatch({
      settings,
      route: { surface: "home", path: "/home" },
      limiter,
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    });

    return { draws, attempts: new Set(attempts).size, result };
  }, failWith);
}

test("a batch draws one token per item it enqueues, not one per batch", async () => {
  const { draws, attempts, result } = await runBatch();

  assert.ok(result.total >= 10, `the fixture must offer work, saw ${result.total}`);
  assert.equal(result.enqueued, result.total, "every task should have been enqueued");
  assert.equal(
    draws,
    result.enqueued,
    "pacing is per download — one token for the whole batch paces nothing"
  );
  assert.equal(attempts, result.enqueued, "each drawn token must be followed by a download");
});

test("a refused download permission stops the batch instead of failing every item the same way", async () => {
  const { attempts, result } = await runBatch({ failWith: "permission" });

  assert.equal(result.needsDownloadPermission, true, "the batch must say why it stopped");
  assert.ok(
    attempts < result.total,
    `the batch must stop early, but tried all ${attempts} of ${result.total}`
  );
  assert.ok(result.failed >= 1, "the item that hit the refusal is still a failure");
});

test("conservative and standard differ in sustained rate, not only opening burst", async () => {
  const timings = await page.evaluate(async () => {
    const drain = async (bucket, n) => {
      const started = performance.now();
      for (let i = 0; i < n; i++) await bucket.waitForToken();
      return performance.now() - started;
    };
    // Both buckets start full, so their burst is free. The wait shows on the token after it —
    // if the two modes only differed in capacity, these numbers would match.
    const conservative = await drain(new AviaryBatch.TokenBucket(4, 1), 5);
    const standard = await drain(new AviaryBatch.TokenBucket(8, 4), 9);
    return { conservative, standard };
  });

  assert.ok(timings.conservative > 500, `conservative refills at 1/s, waited ${timings.conservative}ms`);
  assert.ok(
    timings.conservative > timings.standard,
    `conservative must pace harder (${timings.conservative}ms vs ${timings.standard}ms)`
  );
});

test("changing the mode reconfigures a bucket that is already running", async () => {
  const waited = await page.evaluate(async () => {
    const bucket = new AviaryBatch.TokenBucket(8, 4);
    for (let i = 0; i < 8; i++) await bucket.waitForToken();
    // The live change the settings panel makes: same bucket, new pacing, tokens already earned
    // are not thrown away.
    bucket.configure(4, 1);
    const started = performance.now();
    await bucket.waitForToken();
    return performance.now() - started;
  });

  assert.ok(waited > 400, `a reconfigured bucket must pace at the new rate, waited ${waited}ms`);
});

test("a refused aria2 handoff is reported before falling back to the browser", async () => {
  const result = await page.evaluate(async () => {
    const warnings = [];
    const sent = [];
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          sent.push(message.url);
          return { ok: true };
        }
      }
    };
    // Aria2 answers, and answers no. Falling back is right; falling back silently is not — the
    // user configured a downloader and has no way to notice it stopped being used.
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { code: 1, message: "Unauthorized" } }), { status: 200 });

    const downloader = AviaryBatch.createDownloader({
      integrations: {
        aria2: { enabled: true, endpoint: "http://127.0.0.1:6800/jsonrpc", secret: "", dir: "" }
      },
      onWarn: (message, details) => warnings.push({ message, details })
    });

    const outcome = await downloader({ url: "https://video.twimg.com/a.mp4", filename: "a.mp4" });
    return { outcome, warnings, sent };
  });

  assert.equal(result.outcome.ok, true, "the download must still happen");
  assert.equal(result.outcome.via, "extension", "and must fall back to the browser");
  assert.equal(result.sent.length, 1, "the fallback must actually reach the download path");
  assert.equal(result.warnings.length, 1, "the refusal must be reported exactly once");
  assert.match(result.warnings[0].message, /Aria2 refused the handoff/);
});

test("the original-image preference reaches the URL the batch actually asks for", async () => {
  const urls = async (preferOriginalImages) =>
    page.evaluate(async (prefer) => {
      const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
      settings.media.downloadHistory = false;
      settings.media.preferOriginalImages = prefer;

      const requested = [];
      globalThis.chrome = {
        runtime: {
          async sendMessage(message) {
            requested.push(message.url);
            return { ok: true };
          }
        }
      };

      await AviaryBatch.runMediaBatch({
        settings,
        route: { surface: "home", path: "/home" },
        limiter: { async waitForToken() {} },
        auditLog: { async record() {} },
        diagnostics: { info() {}, warn() {}, error() {} }
      });
      return requested;
    }, preferOriginalImages);

  const original = await urls(true);
  const asRendered = await urls(false);

  assert.ok(original.length > 0 && asRendered.length > 0, "the fixture must offer media both ways");
  // The setting is only meaningful if it changes what is fetched; the fixture's `name=small`
  // thumbnails are exactly what "prefer original" is supposed to replace.
  assert.ok(
    original.every((url) => /name=orig/.test(url)),
    `preferOriginalImages did not reach extraction: ${original[0]}`
  );
  assert.ok(
    asRendered.every((url) => !/name=orig/.test(url)),
    `turning it off still requested originals: ${asRendered[0]}`
  );
});

test("a late high-quality observation updates an unstarted queued batch target", async () => {
  const observed = await page.evaluate(async () => {
    const originalBody = document.body.innerHTML;
    const poster = "https://pbs.twimg.com/media/late-quality?format=jpg&name=small";
    const lowUrl = "https://video.twimg.com/ext_tw_video/late/pu/vid/640x360/low.mp4";
    const highUrl = "https://video.twimg.com/ext_tw_video/late/pu/vid/1920x1080/high.mp4";
    const payload = (variants) => JSON.stringify({
      data: {
        tweetResult: {
          rest_id: "late-quality",
          legacy: {
            extended_entities: {
              media: [{
                type: "video",
                media_key: "7_late-quality",
                preview_image_url_https: poster,
                video_info: { variants }
              }]
            }
          }
        }
      }
    });
    document.body.innerHTML = `
      <main data-testid="primaryColumn">
        <article data-testid="tweet">
          <a href="/alice/status/late-quality"><time datetime="2026-09-06T10:00:00.000Z">now</time></a>
          <div data-testid="User-Name"><a href="/alice">@alice</a></div>
          <div data-testid="videoPlayer"><video poster="${poster}" src="blob:https://x.com/late-quality"></video></div>
        </article>
      </main>`;
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.buttons = true;
    settings.media.downloadHistory = false;
    const stored = new Map();
    const storage = {
      async get(key, fallback) {
        return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        stored.set(key, structuredClone(value));
      },
      async remove(key) {
        stored.delete(key);
      }
    };
    const attempts = [];
    globalThis.chrome = {
      runtime: {
        id: "aviary-test",
        onMessage: { addListener() {}, removeListener() {} },
        async sendMessage(message) {
          if (message.url) attempts.push(message.url);
          return { ok: true };
        }
      }
    };
    AviaryBatch.ingestMediaMetadata(payload([{
      content_type: "video/mp4",
      url: lowUrl,
      width: 640,
      height: 360,
      bitrate: 500000
    }]));
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: {
        release: null,
        async waitForToken() {
          await new Promise((resolve) => { this.release = resolve; });
        }
      },
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    try {
      await AviaryBatch.mediaButtonsFeature.init(ctx);
      const batch = AviaryBatch.runMediaBatch(ctx, { filterKind: "video" });
      while (!ctx.limiter.release) await new Promise((resolve) => setTimeout(resolve, 0));
      AviaryBatch.ingestMediaMetadata(payload([
        {
          content_type: "video/mp4",
          url: lowUrl,
          width: 640,
          height: 360,
          bitrate: 500000
        },
        {
          content_type: "video/mp4",
          url: highUrl,
          width: 1920,
          height: 1080,
          bitrate: 8000000
        }
      ]));
      ctx.limiter.release();
      const result = await batch;
      return { attempts, result, queued: stored.get("aviary.media.queue.v1") };
    } finally {
      await AviaryBatch.mediaButtonsFeature.destroy(ctx);
      document.body.innerHTML = originalBody;
    }
  });

  assert.equal(observed.result.downloaded, 1);
  assert.deepEqual(observed.attempts, ["https://video.twimg.com/ext_tw_video/late/pu/vid/1920x1080/high.mp4"]);
  assert.equal(observed.queued.jobs[0].url, observed.attempts[0]);
});

test("a captured-library batch checkpoints every task before media handoff and originates no GraphQL", async () => {
  const observed = await page.evaluate(async () => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    const stored = new Map();
    const storage = {
      async get(key, fallback) {
        return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        stored.set(key, structuredClone(value));
      },
      async remove(key) {
        stored.delete(key);
      }
    };
    const handed = [];
    const checkpointSizes = [];
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          handed.push(message.url);
          checkpointSizes.push(stored.get("aviary.media.queue.v1")?.jobs?.length ?? 0);
          return { ok: true };
        }
      }
    };
    const fetched = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      throw new Error("captured-library batch must not originate a request");
    };
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: { async waitForToken() {} },
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    const records = [{
      tweetId: "199",
      handle: "alice",
      displayName: "Alice",
      text: "captured once",
      capturedAt: "2026-08-21T12:00:00.000Z",
      surface: "home",
      permalink: "https://x.com/alice/status/199",
      media: [
        { kind: "photo", url: "https://pbs.twimg.com/media/CapturedOne?format=jpg&name=small", type: "image/jpeg" },
        { kind: "video", url: "https://video.twimg.com/ext_tw_video/199/pu/vid/1280x720/video199.mp4", type: "video/mp4", bitrate: 2176000 }
      ]
    }];

    try {
      await AviaryBatch.mediaButtonsFeature.init(ctx);
      const result = await AviaryBatch.runCapturedMediaBatch(ctx, records);
      await AviaryBatch.mediaButtonsFeature.destroy(ctx);
      return { result, handed, checkpointSizes, fetched };
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  assert.equal(observed.result.total, 2);
  assert.equal(observed.handed.length, 2);
  assert.deepEqual(observed.checkpointSizes, [2, 2], "the first handoff happened before the full checkpoint");
  assert.equal(observed.fetched.some((url) => /graphql/i.test(url)), false);
  assert.match(observed.handed[0], /name=orig/);
  assert.match(observed.handed[1], /video199\.mp4/);
});

test("a failed queue checkpoint aborts before the first media handoff", async () => {
  const observed = await page.evaluate(async () => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    let handed = 0;
    globalThis.chrome = {
      runtime: {
        async sendMessage() {
          handed += 1;
          return { ok: true };
        }
      }
    };
    const storage = {
      async get(_key, fallback) {
        return structuredClone(fallback);
      },
      async set(key) {
        if (key === "aviary.media.queue.v1") throw new Error("quota exceeded");
      },
      async remove() {}
    };
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: { async waitForToken() {} },
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    const records = [{
      tweetId: "checkpoint-failure",
      handle: "alice",
      text: "captured",
      capturedAt: "2026-08-21T12:00:00.000Z",
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/Checkpoint?format=jpg&name=small" }]
    }];
    let error = "";
    try {
      await AviaryBatch.mediaButtonsFeature.init(ctx);
      await AviaryBatch.runCapturedMediaBatch(ctx, records);
    } catch (caught) {
      error = String(caught?.message ?? caught);
    } finally {
      await AviaryBatch.mediaButtonsFeature.destroy(ctx);
    }
    return { error, handed };
  });

  assert.match(observed.error, /quota exceeded/);
  assert.equal(observed.handed, 0, "the downloader ran without a durable checkpoint");
});

test("a pending batch handoff stays durable and becomes saved only on terminal completion", async () => {
  const observed = await page.evaluate(async () => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    settings.media.sidecarFormat = "text";
    const stored = new Map();
    const storage = {
      async get(key, fallback) {
        return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        stored.set(key, structuredClone(value));
      },
      async remove(key) {
        stored.delete(key);
      }
    };
    const listeners = new Set();
    globalThis.chrome = {
      runtime: {
        id: "fixture",
        onMessage: {
          addListener(listener) { listeners.add(listener); },
          removeListener(listener) { listeners.delete(listener); }
        },
        async sendMessage(message) {
          if (message?.type === "AVIARY_DOWNLOAD") return { ok: true, id: 701, pending: true };
          return { ok: true };
        }
      }
    };
    const audits = [];
    const sidecarBlobs = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () {};
    URL.createObjectURL = (blob) => {
      sidecarBlobs.push(blob);
      return "blob:batch-sidecar";
    };
    URL.revokeObjectURL = () => {};
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: { async waitForToken() {} },
      auditLog: { async record(action, detail) { audits.push({ action, detail }); } },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    const records = [{
      tweetId: "pending-batch",
      handle: "alice",
      text: "captured",
      capturedAt: "2026-08-21T12:00:00.000Z",
      permalink: "https://x.com/alice/status/pending-batch",
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/Pending?format=jpg&name=small" }]
    }];
    try {
      await AviaryBatch.mediaButtonsFeature.init(ctx);
      const result = await AviaryBatch.runCapturedMediaBatch(ctx, records);
      const beforeJob = structuredClone(AviaryBatch.getMediaQueue().snapshot().recent.at(-1));
      const persistedBefore = stored.get("aviary.media.queue.v1")?.jobs?.at(-1);
      const before = {
        result,
        job: beforeJob,
        persistedDownloadId: persistedBefore?.downloadId,
        sidecars: sidecarBlobs.length,
        saves: audits.filter((entry) => entry.action === "media.download").length
      };

      const reportedAt = Date.now();
      for (const listener of [...listeners]) {
        listener({ type: "AVIARY_DOWNLOAD_STATE", id: 701, state: "complete" }, {}, () => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const sidecarText = sidecarBlobs.length > 0 ? await sidecarBlobs[0].text() : "";
      const savedAt = /^Saved: (.+)$/m.exec(sidecarText)?.[1] ?? "";
      const after = {
        job: AviaryBatch.getMediaQueue().snapshot().recent.at(-1),
        sidecars: sidecarBlobs.length,
        saves: audits.filter((entry) => entry.action === "media.download").length,
        savedAt: Date.parse(savedAt),
        reportedAt
      };
      await AviaryBatch.mediaButtonsFeature.destroy(ctx);
      return { before, after };
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  assert.equal(observed.before.result.downloaded, 0);
  assert.equal(observed.before.result.started, 1);
  assert.equal(observed.before.job.status, "running");
  assert.equal(observed.before.job.downloadId, 701);
  assert.equal(observed.before.persistedDownloadId, 701);
  assert.equal(observed.before.sidecars, 0);
  assert.equal(observed.before.saves, 0);
  assert.equal(observed.after.job.status, "completed");
  assert.equal(observed.after.job.downloadId, undefined);
  assert.equal(observed.after.sidecars, 1);
  assert.equal(observed.after.saves, 1);
  assert.ok(observed.after.savedAt >= observed.after.reportedAt, "the sidecar kept its queue timestamp");
});

test("a second batch is rejected before it can mutate the durable queue", async () => {
  const observed = await page.evaluate(async () => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    const stored = new Map();
    const storage = {
      async get(key, fallback) {
        return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        stored.set(key, structuredClone(value));
      },
      async remove(key) {
        stored.delete(key);
      }
    };
    let holding = true;
    const releases = [];
    globalThis.chrome = {
      runtime: {
        sendMessage() {
          if (!holding) return Promise.resolve({ ok: true });
          return new Promise((resolve) => releases.push(() => resolve({ ok: true })));
        }
      }
    };
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: { async waitForToken() {} },
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    await AviaryBatch.mediaButtonsFeature.init(ctx);
    const first = AviaryBatch.runMediaBatch(ctx);
    while (releases.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const before = AviaryBatch.getMediaQueue().snapshot().total;
    let error = "";
    try {
      await AviaryBatch.runMediaBatch(ctx);
    } catch (caught) {
      error = String(caught?.message ?? caught);
    }
    const after = AviaryBatch.getMediaQueue().snapshot().total;
    holding = false;
    for (const release of releases) release();
    await first;
    await AviaryBatch.mediaButtonsFeature.destroy(ctx);
    return { before, after, error };
  });

  assert.match(observed.error, /already running/i);
  assert.equal(observed.after, observed.before, "the rejected batch appended jobs before checking the active batch");
});

test("resumed jobs retain fallback URLs and save sidecars only after completion", async () => {
  const observed = await page.evaluate(async () => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    const stored = new Map([["aviary.media.queue.v1", {
      sequence: 4,
      jobs: [{
        id: "job-4",
        url: "https://pbs.twimg.com/media/resume?format=jpg&name=orig",
        fallbackUrls: ["https://pbs.twimg.com/media/resume?format=jpg&name=4096x4096"],
        filename: "resume.jpg",
        kind: "photo",
        mediaId: "resume",
        sidecar: {
          format: "text",
          mediaFilename: "resume.jpg",
          kind: "photo",
          handle: "alice",
          tweetId: "204",
          text: "resumed capture",
          permalink: "https://x.com/alice/status/204",
          savedAt: "2026-08-21T12:00:00.000Z"
        },
        status: "queued",
        resumeOnBoot: true
      }]
    }]]);
    const storage = {
      async get(key, fallback) {
        return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        stored.set(key, structuredClone(value));
      },
      async remove(key) {
        stored.delete(key);
      }
    };
    const messages = [];
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          return { ok: true };
        }
      }
    };
    const sidecars = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    HTMLAnchorElement.prototype.click = function () {
      sidecars.push(this.download);
    };
    URL.createObjectURL = () => "blob:resume-sidecar";
    URL.revokeObjectURL = () => {};
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: { async waitForToken() {} },
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    try {
      await AviaryBatch.mediaButtonsFeature.init(ctx);
      const result = await AviaryBatch.resumePendingMediaJobs(ctx);
      const job = AviaryBatch.getMediaQueue().snapshot().recent.at(-1);
      await AviaryBatch.mediaButtonsFeature.destroy(ctx);
      return { result, messages, sidecars, job };
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  assert.deepEqual(observed.messages[0].fallbackUrls, [
    "https://pbs.twimg.com/media/resume?format=jpg&name=4096x4096"
  ]);
  assert.deepEqual(observed.sidecars, ["resume.txt"]);
  assert.equal(observed.job.status, "completed");
  assert.equal(observed.result.downloaded, 1);
});

test("resuming a retained browser transfer does not create a duplicate download", async () => {
  const observed = await page.evaluate(async () => {
    const settings = AviaryBatch.cloneSettings(AviaryBatch.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    const stored = new Map([[
      "aviary.media.queue.v1",
      {
        sequence: 4,
        jobs: [{
          id: "job-4",
          url: "https://pbs.twimg.com/media/retained?format=mp4&name=orig",
          filename: "retained.mp4",
          kind: "video",
          mediaId: "retained",
          status: "running",
          downloadId: 701,
          resumeOnBoot: true
        }]
      }
    ]]);
    const storage = {
      async get(key, fallback) {
        return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        stored.set(key, structuredClone(value));
      },
      async remove(key) {
        stored.delete(key);
      }
    };
    const listeners = new Set();
    const messages = [];
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener(listener) { listeners.add(listener); },
          removeListener(listener) { listeners.delete(listener); }
        },
        async sendMessage(message) {
          messages.push(message);
          if (message?.type === "AVIARY_DOWNLOAD_QUERY") {
            return { ok: true, id: 701, state: "in_progress" };
          }
          return { ok: true };
        }
      }
    };
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage,
      limiter: { async waitForToken() {} },
      auditLog: { async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    await AviaryBatch.mediaButtonsFeature.init(ctx);
    const result = await AviaryBatch.resumePendingMediaJobs(ctx);
    const before = structuredClone(AviaryBatch.getMediaQueue().snapshot().recent.at(-1));
    for (const listener of [...listeners]) {
      listener({ type: "AVIARY_DOWNLOAD_STATE", id: 701, state: "complete" }, {}, () => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = AviaryBatch.getMediaQueue().snapshot().recent.at(-1);
    await AviaryBatch.mediaButtonsFeature.destroy(ctx);
    return {
      result,
      before,
      after,
      queries: messages.filter((message) => message.type === "AVIARY_DOWNLOAD_QUERY").length,
      downloads: messages.filter((message) => message.type === "AVIARY_DOWNLOAD").length
    };
  });

  assert.equal(observed.result.started, 1);
  assert.equal(observed.result.downloaded, 0);
  assert.equal(observed.queries, 1);
  assert.equal(observed.downloads, 0, "an in-progress retained id was downloaded again");
  assert.equal(observed.before.status, "running");
  assert.equal(observed.after.status, "completed");
});
