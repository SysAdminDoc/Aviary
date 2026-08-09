import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-schema-settings-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`,
      `export { TokenBucket } from ${JSON.stringify(path.join(root, "src/platform/rate-limit.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviarySchemaSettings",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("schema-only preferences have bounded Control Center editors and round-trip immediately", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviarySchemaSettings.cloneSettings(AviarySchemaSettings.DEFAULT_SETTINGS);
    let saves = 0;
    const panel = AviarySchemaSettings.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {
        saves += 1;
      },
      onError: () => {}
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const wait = () => new Promise((resolve) => setTimeout(resolve, 25));
    const row = (label) =>
      [...shadow.querySelectorAll(".av-row")].find(
        (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
      );
    shadow.querySelector(".av-launcher").click();

    shadow.querySelector('[data-av-section="layout"]').click();
    const navRow = row("Hide navigation items");
    navRow.querySelector("textarea").value = "home\nnot-a-real-nav-id\nprofile\nhome";
    navRow.querySelector("button").click();
    await wait();
    const navItems = [...settings.layout.hideNavItems];

    shadow.querySelector('[data-av-section="media"]').click();
    const concurrencyRow = row("Concurrent downloads");
    concurrencyRow.querySelector('input[type="number"]').value = "20";
    concurrencyRow.querySelector("button").click();
    await wait();
    const concurrentDownloads = settings.jobs.concurrentDownloads;

    const pacing = row("Download pacing").querySelector("select");
    pacing.value = "balanced";
    pacing.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    const rateLimitMode = settings.jobs.rateLimitMode;

    shadow.querySelector('[data-av-section="trust"]').click();
    const selectorToggle = row("Monitor selector health").querySelector('input[type="checkbox"]');
    selectorToggle.click();
    await wait();
    const selectorHealth = settings.diagnostics.selectorHealth;
    panel.destroy();
    const bucket = new AviarySchemaSettings.TokenBucket(4, 1);
    bucket.configure(rateLimitMode === "balanced" ? 8 : 4, rateLimitMode === "balanced" ? 4 : 1);
    return {
      navItems,
      concurrentDownloads,
      rateLimitMode,
      selectorHealth,
      saves,
      bucket: bucket.snapshot()
    };
  });

  assert.deepEqual(result.navItems, ["home", "profile"]);
  assert.equal(result.concurrentDownloads, 6, "concurrency is clamped to the batch worker limit");
  assert.equal(result.rateLimitMode, "balanced");
  assert.equal(result.selectorHealth, false);
  assert.equal(result.bucket.capacity, 8);
  assert.equal(result.bucket.refillPerSecond, 4);
  assert.equal(result.saves, 4);
});
