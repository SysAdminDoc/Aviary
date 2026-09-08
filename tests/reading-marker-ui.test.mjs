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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-reading-marker-ui-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { readingMarkerFeature, resetReadingMarkerState, getReadingMarkerStore } from ${JSON.stringify(abs("src/features/filtering/reading-marker-feature.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryReading",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 260 } });
  await page.setContent("<!doctype html><meta charset=utf-8><style>body{margin:0}article{height:220px;border-bottom:1px solid #ddd}</style><main></main>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const timeline = (ids) => ids.map((id) => `<article data-testid="tweet"><a href="/someone/status/${id}">post</a></article>`).join("");

test("separator appears at the new/old boundary and explicit mark-above removes it", async () => {
  const result = await page.evaluate(async ({ markup }) => {
    AviaryReading.resetReadingMarkerState();
    const values = new Map([
      ["aviary.readingMarkers.v1", { version: 1, markers: { home: { lastReadId: "150", updatedAt: 1 } } }]
    ]);
    const settings = AviaryReading.normalizeSettings({ layout: { readMarker: true } });
    const ctx = {
      settings,
      storage: {
        async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
        async set(key, value) { values.set(key, structuredClone(value)); }
      },
      route: { href: "https://x.com/home", path: "/home", surface: "home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    document.querySelector("main").innerHTML = markup;
    await AviaryReading.readingMarkerFeature.init(ctx);
    const before = {
      separators: document.querySelectorAll("[data-av-reading-separator]").length,
      beforeId: document.querySelector("[data-av-reading-separator]")?.nextElementSibling?.querySelector("a")?.getAttribute("href")
    };
    document.querySelector(".av-reading-mark-button")?.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await AviaryReading.readingMarkerFeature.destroy(ctx);
    return { before, stored: values.get("aviary.readingMarkers.v1") };
  }, { markup: timeline(["300", "200", "100"]) });

  assert.deepEqual(result.before, { separators: 1, beforeId: "/someone/status/100" });
  assert.equal(result.stored.markers.home.lastReadId, "300");
  assert.equal(result.stored.markers.home.updatedAt > 1, true);
});

test("rendering visible posts does not write a marker, but leaving upward does", async () => {
  const result = await page.evaluate(async ({ markup }) => {
    AviaryReading.resetReadingMarkerState();
    const values = new Map();
    const settings = AviaryReading.normalizeSettings({ layout: { readMarker: true } });
    const ctx = {
      settings,
      storage: {
        async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
        async set(key, value) { values.set(key, structuredClone(value)); }
      },
      route: { href: "https://x.com/home", path: "/home", surface: "home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    document.querySelector("main").innerHTML = markup;
    await AviaryReading.readingMarkerFeature.init(ctx);
    const afterRender = values.has("aviary.readingMarkers.v1");
    window.scrollTo(0, 280);
    // Wait for the write, not for a guess at how long it takes. A flat 25ms sleep passed alone and
    // failed inside a loaded full-suite run, where the scroll handler had not run yet: `settled()`
    // then reported a store with nothing scheduled and the assertion read undefined.
    const deadline = Date.now() + 5000;
    while (!values.has("aviary.readingMarkers.v1") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await AviaryReading.getReadingMarkerStore()?.settled();
    }
    await AviaryReading.getReadingMarkerStore()?.settled();
    const afterScroll = values.get("aviary.readingMarkers.v1");
    await AviaryReading.readingMarkerFeature.destroy(ctx);
    return { afterRender, afterScroll };
  }, { markup: timeline(["300", "200", "100"]) });

  assert.equal(result.afterRender, false);
  assert.equal(result.afterScroll?.markers?.home?.lastReadId, "300");
});
