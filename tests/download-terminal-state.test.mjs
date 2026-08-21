import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

import { loadBackground } from "./helpers/background-harness.mjs";

/**
 * A handoff is not a saved file.
 *
 * `chrome.downloads.download()` resolves when the browser accepts the request. Everything after
 * that -- the connection dropping, the disk filling, the user cancelling -- happens later, and used
 * to be invisible: the button said Saved, the queue said completed, and the duplicate index had
 * already recorded the file, so the retry the user then wanted was refused as something already
 * downloaded.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const FIXTURE = `
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
  <a href="/alice/status/1900000000000001"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
  <div data-testid="tweetPhoto" style="width:400px;height:240px">
    <img src="https://pbs.twimg.com/media/OnePhoto?format=jpg&name=small" style="width:100%;height:100%" alt="">
  </div>
  <div role="group"><button data-testid="reply">Reply</button></div>
</article>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-download-state-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mediaButtonsFeature, getMediaQueue } from ${JSON.stringify(abs("src/features/media/media-buttons.ts"))};`,
      `export { sharedDownloadWatcher, DownloadWatcher } from ${JSON.stringify(abs("src/features/media/download-watch.ts"))};`,
      `export { DOWNLOAD_STATE_MESSAGE } from ${JSON.stringify(abs("src/extension/download-state.ts"))};`,
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
    globalName: "AviaryDownloads",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("https://pbs.twimg.com/**", (route) => route.fulfill({
    status: 200,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "image/jpeg"
    },
    body: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  }));
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.evaluate((fixture) => {
    /**
     * Stands in for the extension: `AVIARY_DOWNLOAD` is answered with a pending handoff, and the
     * test decides afterwards what the browser did with it.
     */
    window.installExtension = () => {
      const listeners = new Set();
      window.__handed = [];
      globalThis.chrome = {
        runtime: {
          id: "fixture",
          onMessage: {
            addListener(listener) { listeners.add(listener); },
            removeListener(listener) { listeners.delete(listener); }
          },
          async sendMessage(message) {
            if (message?.type !== "AVIARY_DOWNLOAD") return { ok: true };
            window.__handed.push(message);
            return { ok: true, id: 500 + window.__handed.length, pending: true };
          }
        }
      };
      window.__report = (id, state) => {
        for (const listener of [...listeners]) {
          listener({ type: AviaryDownloads.DOWNLOAD_STATE_MESSAGE, id, state }, {}, () => {});
        }
      };
    };
    window.mediaCtx = () => ({
      settings: AviaryDownloads.cloneSettings(AviaryDownloads.DEFAULT_SETTINGS),
      route: { surface: "home", path: "/home" },
      storage: {
        async get(_key, fallback) { return fallback; },
        async set() {},
        async remove() {}
      },
      auditLog: { async record() {} },
      limiter: { async waitForToken() {} },
      diagnostics: { info() {}, warn() {}, error() {} }
    });
    window.mount = async (ctx) => {
      document.body.innerHTML = fixture;
      await AviaryDownloads.mediaButtonsFeature.init(ctx);
      await AviaryDownloads.mediaButtonsFeature.apply(ctx, document);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return document.querySelector("[data-av-media-button]");
    };
    window.queueStatuses = () =>
      (AviaryDownloads.getMediaQueue()?.snapshot().recent ?? []).map((job) => job.status);
  }, FIXTURE);
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("Started and Saved are distinct, and Saved waits for the browser to finish", async () => {
  const observed = await page.evaluate(async () => {
    window.installExtension();
    const ctx = window.mediaCtx();
    const button = await window.mount(ctx);

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const whileRunning = {
      label: button.textContent,
      busy: button.getAttribute("aria-busy"),
      handed: window.__handed.length,
      queue: window.queueStatuses()
    };

    window.__report(501, "complete");
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterComplete = { label: button.textContent, queue: window.queueStatuses() };

    await AviaryDownloads.mediaButtonsFeature.destroy(ctx);
    return { whileRunning, afterComplete };
  });

  assert.equal(observed.whileRunning.handed, 1, "the download was never handed to the browser");
  // The transfer is in flight: the browser has the request and nothing has proved the file landed.
  assert.match(observed.whileRunning.label, /Started/);
  assert.doesNotMatch(observed.whileRunning.label, /Saved/);
  assert.equal(observed.whileRunning.busy, "true");
  assert.deepEqual(observed.whileRunning.queue, ["running"]);

  assert.match(observed.afterComplete.label, /Saved/);
  assert.deepEqual(observed.afterComplete.queue, ["completed"]);
});

test("an interrupted transfer offers Retry and never enters the duplicate history", async () => {
  const observed = await page.evaluate(async () => {
    window.installExtension();
    const ctx = window.mediaCtx();
    const stored = new Map();
    ctx.storage.get = async (key, fallback) => {
      return stored.has(key) ? structuredClone(stored.get(key)) : structuredClone(fallback);
    };
    ctx.storage.set = async (key, value) => {
      stored.set(key, structuredClone(value));
    };
    const button = await window.mount(ctx);

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    window.__report(501, "interrupted");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterInterrupt = {
      label: button.textContent,
      disabled: button.disabled,
      queue: window.queueStatuses(),
      historyEntries: [...stored.values()].find((value) => value?.schemaVersion === 3)?.entries.length ?? 0,
      reservations: [...stored.values()].find((value) => value?.schemaVersion === 3)?.reservations.length ?? 0
    };

    // Retrying is the whole point of not recording it: the asset must be downloadable again.
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const retried = { handed: window.__handed.length, label: button.textContent };

    await AviaryDownloads.mediaButtonsFeature.destroy(ctx);
    return { afterInterrupt, retried };
  });

  assert.match(observed.afterInterrupt.label, /Retry/);
  assert.equal(observed.afterInterrupt.disabled, false, "a failed transfer must be retryable");
  assert.deepEqual(observed.afterInterrupt.queue, ["failed"]);
  assert.equal(
    observed.afterInterrupt.historyEntries,
    0,
    "an interrupted transfer was written into the duplicate history"
  );
  assert.equal(observed.afterInterrupt.reservations, 0, "the failed transfer kept its reservation");

  assert.equal(observed.retried.handed, 2, "the retry was refused as a duplicate");
  assert.match(observed.retried.label, /Started/);
});

test("a transfer that never reports back stays Started rather than becoming Saved", async () => {
  const observed = await page.evaluate(async () => {
    window.installExtension();
    const ctx = window.mediaCtx();
    const button = await window.mount(ctx);

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    // Give up on the wait the way the five-minute timeout does, without waiting five minutes.
    AviaryDownloads.sharedDownloadWatcher().stop();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const settled = {
      label: button.textContent,
      title: button.title,
      queue: window.queueStatuses()
    };
    await AviaryDownloads.mediaButtonsFeature.destroy(ctx);
    return settled;
  });

  assert.match(observed.label, /Started/);
  assert.doesNotMatch(observed.label, /Saved/);
  assert.match(observed.title, /still transferring/);
  assert.deepEqual(observed.queue, ["running"], "an unproven transfer must not read as completed");
});

test("a userscript download, which has no handoff to wait on, still reports Saved", async () => {
  const observed = await page.evaluate(async () => {
    delete globalThis.chrome;
    globalThis.GM_download = (options) => options.onload?.();
    const ctx = window.mediaCtx();
    const button = await window.mount(ctx);

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const result = { label: button.textContent, queue: window.queueStatuses() };
    await AviaryDownloads.mediaButtonsFeature.destroy(ctx);
    delete globalThis.GM_download;
    return result;
  });

  // GM_download's own callback *is* the terminal state, so nothing there should start waiting.
  assert.match(observed.label, /Saved/);
  assert.deepEqual(observed.queue, ["completed"]);
});

test("a terminal state that arrives before anyone waits for it is not lost", async () => {
  const outcomes = await page.evaluate(() => {
    const watcher = new AviaryDownloads.DownloadWatcher();
    watcher.settle(9, "complete");
    // And is consumed once: a second wait on the same id has nothing left to collect.
    return Promise.all([watcher.wait(9, 50), watcher.wait(9, 50)]);
  });

  // A small file completes while the caller is still awaiting the handoff response. Dropping that
  // message would leave the button on Started for a file that is already on disk.
  assert.deepEqual(outcomes, ["complete", "pending"]);
});

test("the background reports the terminal state to the tab that asked, after a restart", async () => {
  const stored = {};
  const first = await loadBackground({ stored });

  const response = await first.send(
    { type: "AVIARY_DOWNLOAD", url: "https://pbs.twimg.com/media/a?name=orig", filename: "a.jpg" },
    { tab: { id: 77 } }
  );
  assert.deepEqual(response, { ok: true, id: 1, pending: true });

  // A new worker with no memory of the handoff, exactly as Chrome leaves one after suspending it.
  const second = await loadBackground({ stored });
  assert.deepEqual(second.tabMessages, []);
  second.onDownloadChanged({ id: 1, state: { current: "complete" } });
  await second.settled();

  assert.deepEqual(second.tabMessages, [
    { tabId: 77, message: { type: "AVIARY_DOWNLOAD_STATE", id: 1, state: "complete" } }
  ]);
  assert.deepEqual(stored["aviary.downloadTracking.v2"], {});
});

test("a transfer with no candidates left is reported interrupted, not left waiting", async () => {
  const stored = {};
  const background = await loadBackground({ stored });

  await background.send(
    {
      type: "AVIARY_DOWNLOAD",
      url: "https://pbs.twimg.com/media/a?name=orig",
      fallbackUrls: ["https://pbs.twimg.com/media/a?name=4096x4096"],
      filename: "a.jpg"
    },
    { tab: { id: 12 } }
  );

  // The first transfer dies: the fallback is tried and nothing is reported to the tab yet.
  background.onDownloadChanged({
    id: 1,
    state: { current: "interrupted" },
    error: { current: "NETWORK_FAILED" }
  });
  await background.settled();
  assert.deepEqual(background.tabMessages, [], "a retry that is still running must not report failure");
  assert.equal(background.downloads.length, 2, "the quality fallback was never attempted");

  // The fallback dies too, and there is nothing left to try.
  background.onDownloadChanged({
    id: 2,
    state: { current: "interrupted" },
    error: { current: "NETWORK_FAILED" }
  });
  await background.settled();
  assert.deepEqual(background.tabMessages, [
    {
      tabId: 12,
      message: {
        type: "AVIARY_DOWNLOAD_STATE",
        // The id the content script was told about, not the fallback download's own.
        id: 1,
        state: "interrupted",
        error: "NETWORK_FAILED"
      }
    }
  ]);
});
