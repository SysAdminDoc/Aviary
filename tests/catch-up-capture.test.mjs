import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-catch-up-capture-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(entry, [
    `export { seenPostsFeature, getCatchUpStore, resetSeenPostsState, setSeenPostsTestSeams } from ${JSON.stringify(abs("src/features/filtering/seen-posts-feature.ts"))};`
  ].join("\n"), "utf8");
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCapture",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><main>
    <article data-testid="tweet" id="post">
      <div data-testid="User-Name"><a href="/alice"><span>Alice</span><span>@alice</span></a></div>
      <a href="/alice/status/8001001">time</a>
      <div data-testid="tweetText">A captured post with a photo</div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/catchup123?format=jpg" alt="sample"></div>
    </article>
  </main></body>`);
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("rendered posts are copied into catch-up with the active filter reason", async () => {
  const result = await page.evaluate(async () => {
    AviaryCapture.resetSeenPostsState();
    let now = 0;
    const timers = [];
    const observers = [];
    AviaryCapture.setSeenPostsTestSeams({
      now: () => now,
      setTimeout(callback, delay) {
        const timer = { callback, due: now + delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { timer.cancelled = true; },
      createObserver(callback) {
        const observer = { callback, observe() {}, disconnect() {} };
        observers.push(observer);
        return observer;
      }
    });
    const values = new Map();
    const storage = {
      async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
      async set(key, value) { values.set(key, structuredClone(value)); }
    };
    const settings = {
      filter: { dimSeenPosts: true },
      appearance: { restoreChirp: false }
    };
    const article = document.querySelector("article");
    article.setAttribute("data-av-filter-reason", "Hidden by your keyword: crypto");
    const ctx = {
      settings,
      storage,
      route: { surface: "home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    await AviaryCapture.seenPostsFeature.init(ctx);
    observers.at(-1)?.callback([{
      target: article,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: { height: 100 },
      intersectionRect: { height: 100 },
      rootBounds: { height: 800 }
    }]);
    now = 1000;
    for (const timer of timers) {
      if (!timer.cancelled && timer.due <= now) {
        timer.cancelled = true;
        timer.callback();
      }
    }
    const store = AviaryCapture.getCatchUpStore();
    const entries = store?.list() ?? [];
    await AviaryCapture.seenPostsFeature.destroy(ctx);
    return {
      count: entries.length,
      entry: entries[0] ? {
        tweetId: entries[0].tweetId,
        handle: entries[0].handle,
        text: entries[0].text,
        category: entries[0].category,
        reason: entries[0].filterReason,
        media: entries[0].media.length
      } : null,
      requests: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("pbs.twimg.com")).length
    };
  });

  assert.equal(result.count, 1);
  assert.deepEqual(result.entry, {
    tweetId: "8001001",
    handle: "alice",
    text: "A captured post with a photo",
    category: "filtered",
    reason: "Hidden by your keyword: crypto",
    media: 1
  });
  assert.equal(result.requests, 0, "capture reads rendered DOM and does not fetch media");
});
