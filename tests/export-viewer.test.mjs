import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("standalone viewer is local-only, responsive, virtualized, searchable, and RTL-aware", async () => {
  const { buildExportViewer } = await importBundledModule("src/features/export/viewer.ts");
  const records = Array.from({ length: 120 }, (_, index) => ({
    tweetId: String(index + 1),
    handle: "archivist",
    displayName: "Archivist",
    text: index === 73 ? "needle survives the filter" : `post ${index}`,
    capturedAt: `2026-08-12T12:${String(index % 60).padStart(2, "0")}:00Z`,
    surface: "home",
    media: index === 73
      ? [{ kind: "photo", url: "https://pbs.twimg.com/media/remote.jpg", capture: {
          status: "remote-reference",
          sourceUrl: "https://pbs.twimg.com/media/remote.jpg",
          capturedAt: "2026-08-12T12:00:00Z",
          byteLength: null,
          sha256: null,
          retryable: true
        } }]
      : [],
    permalink: `https://x.com/archivist/status/${index + 1}`
  }));
  const html = new TextDecoder().decode(buildExportViewer(records));
  assert.match(html, /<title>Aviary archive<\/title>/);
  assert.equal((html.match(/<script[^>]*\bsrc=/g) || []).length, 0, "viewer must not load remote scripts");
  assert.match(html, /remote-reference/);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 600 }, locale: "en-US" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent(html, { waitUntil: "load" });

    const initialCards = await page.locator("#list .record-card").count();
    assert.ok(initialCards < records.length, `virtualized viewer rendered ${initialCards} of ${records.length} cards`);
    assert.equal(await page.locator("#records").evaluate((node) => node.clientWidth <= 320), true);

    await page.locator("#search").fill("needle");
    assert.equal(await page.locator("#list .record-card").count(), 1, JSON.stringify({ summary: await page.locator("#summary").textContent(), errors: pageErrors }));
    assert.match(await page.locator("#list").textContent(), /needle survives the filter/);
    assert.match(await page.locator("#list").textContent(), /Remote reference/);

    await page.locator("#search").fill("");
    await page.locator("#thread").check();
    assert.equal(await page.locator("#list .record-card").count(), 1);
    assert.match(await page.locator("#list").textContent(), /120 posts/);

    await page.selectOption("#locale", "ar");
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.locator("html").getAttribute("lang"), "ar");
    assert.match(await page.locator("#title").textContent(), /أرشيف/);
    await context.close();
  } finally {
    await browser.close();
  }
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-viewer-"));
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
