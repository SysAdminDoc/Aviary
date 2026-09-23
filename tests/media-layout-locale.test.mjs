import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

import { captureHtml } from "./helpers/synthetic-capture.mjs";

/**
 * The grid media layout used to select photos by X's English label, `aria-label="Image"`, so in
 * any other X UI language the Media Archivist and Creator presets changed nothing. It now keys on
 * the `tweetPhoto` test id, which X does not translate.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-media-layout-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { mediaPresentationFeature } from ${JSON.stringify(abs("src/features/media/media-presentation.ts"))};`,
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryMediaLayout",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function photoDisplay(html) {
  await page.setContent(html);
  await page.addScriptTag({ path: bundle });
  return page.evaluate(() => {
    const ctx = {
      settings: { media: { layout: "grid" } },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryMediaLayout.mediaPresentationFeature.init(ctx);
    // The post's own photo, not one inside a quote or a reply the layouts deliberately leave alone.
    const photo = [...document.querySelectorAll('article[data-testid="tweet"] [data-testid="tweetPhoto"]')]
      .find((node) => !node.closest('div[role="link"][tabindex="0"], [data-testid="quoteTweet"]'));
    const result = { found: Boolean(photo), display: photo ? getComputedStyle(photo).display : null };
    AviaryMediaLayout.mediaPresentationFeature.destroy(ctx);
    return result;
  });
}

test("the grid layout reaches photos in X's Japanese interface as well as its English one", async () => {
  const english = await captureHtml("home");
  const japanese = english
    .replace(/<html lang="[^"]*"/, '<html lang="ja"')
    .replaceAll('aria-label="Image"', 'aria-label="画像"');
  assert.notEqual(japanese, english, "the fixture must actually carry the translated label");

  const en = await photoDisplay(english);
  const ja = await photoDisplay(japanese);
  assert.deepEqual(en, { found: true, display: "grid" });
  assert.deepEqual(ja, { found: true, display: "grid" }, "a translated label must not switch the layout off");
});
