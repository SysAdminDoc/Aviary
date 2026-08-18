import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * A filtered post hides its article, but X positions timeline rows absolutely inside a measured
 * container -- so unless the owning `cellInnerDiv` collapses too, the row keeps its full height and
 * the reader gets a blank gap instead of the next post. That is the whole point of the cell rule.
 *
 * This is asserted against computed style rather than against the attribute, because the attribute
 * was already covered by a source-text match and shipped broken anyway: `toggleAttribute` wrote the
 * empty string while the stylesheet matched `="1"`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-filter-cell-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { filterEngineFeature } from ${JSON.stringify(abs("src/features/filtering/filter-engine.ts"))};
export { DEFAULT_SETTINGS, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryFilterCell",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const TIMELINE = `
  <div id="cell-hit" data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/spammer">@spammer</a></div>
      <div data-testid="tweetText">buy crypto now</div>
    </article>
  </div>
  <div id="cell-clean" data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/friend">@friend</a></div>
      <div data-testid="tweetText">a perfectly ordinary post</div>
    </article>
  </div>
`;

async function runFilter({ keywords }) {
  return page.evaluate(
    async ({ html, keywordRules }) => {
      const { filterEngineFeature, DEFAULT_SETTINGS, normalizeSettings } = window.AviaryFilterCell;
      document.body.innerHTML = html;

      const settings = normalizeSettings(structuredClone(DEFAULT_SETTINGS));
      settings.filter.enabled = true;
      settings.filter.keywordRules = keywordRules;
      settings.filter.surfaces.home = true;

      const ctx = {
        settings,
        route: { surface: "home", path: "/home" },
        diagnostics: { info() {}, warn() {}, error() {} },
        limiter: { take: () => true },
        auditLog: { record() {} },
        storage: { async get(_k, fallback) { return fallback; }, async set() {}, async remove() {} },
        saveSettings: async () => {},
        requestApply: () => {}
      };

      await filterEngineFeature.init(ctx);
      await filterEngineFeature.apply(ctx, document);

      const read = (id) => {
        const cell = document.getElementById(id);
        const article = cell.querySelector('article[data-testid="tweet"]');
        return {
          cellDisplay: getComputedStyle(cell).display,
          articleDisplay: getComputedStyle(article).display,
          cellAttr: cell.getAttribute("data-av-filter-cell-hidden")
        };
      };
      const before = { hit: read("cell-hit"), clean: read("cell-clean") };

      await filterEngineFeature.destroy(ctx);
      const after = { hit: read("cell-hit"), clean: read("cell-clean") };

      return { before, after };
    },
    { html: TIMELINE, keywordRules: keywords }
  );
}

test("a filtered post collapses its timeline row, not just its article", async () => {
  const { before } = await runFilter({ keywords: ["crypto"] });

  // The article hiding was never the broken half -- the row staying open was.
  assert.equal(before.hit.articleDisplay, "none", "the matched article must hide");
  assert.equal(
    before.hit.cellDisplay,
    "none",
    "the owning cellInnerDiv must collapse, or the row leaves a full-height gap"
  );

  // An untouched post keeps both.
  assert.notEqual(before.clean.articleDisplay, "none");
  assert.notEqual(before.clean.cellDisplay, "none");
});

test("the cell marker carries the value its own stylesheet selects on", async () => {
  const { before } = await runFilter({ keywords: ["crypto"] });

  // Guards the exact regression: an empty-string attribute satisfies "the attribute is present"
  // while matching no `[attr="1"]` rule, which is how this shipped hiding nothing.
  assert.equal(before.hit.cellAttr, "1");
  assert.equal(before.clean.cellAttr, null);
});

test("destroy restores every collapsed row", async () => {
  const { after } = await runFilter({ keywords: ["crypto"] });

  assert.notEqual(after.hit.cellDisplay, "none", "teardown must reopen the row");
  assert.notEqual(after.hit.articleDisplay, "none");
  assert.equal(after.hit.cellAttr, null);
});
