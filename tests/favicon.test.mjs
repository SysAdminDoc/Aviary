import assert from "node:assert/strict";
import { captureHtml } from "./helpers/synthetic-capture.mjs";
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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-favicon-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { faviconFeature, resetFaviconState } from ${JSON.stringify(abs("src/features/appearance/favicon.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryFavicon",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

// The rel values X actually ships, from the captured home page.
const HEAD = `
  <link rel="apple-touch-icon" sizes="192x192" href="https://abs.twimg.com/icon-ios.png">
  <link rel="mask-icon" sizes="any" href="https://abs.twimg.com/icon-svg.svg" color="#1D9BF0">
  <link rel="shortcut icon" href="https://abs.twimg.com/favicons/twitter.3.ico">
`;

async function run({ enabled = true, rewriteAfter = false } = {}) {
  return page.evaluate(
    async ({ head, enabled, rewriteAfter }) => {
      AviaryFavicon.resetFaviconState();
      document.head.innerHTML = head;
      const settings = AviaryFavicon.normalizeSettings({ appearance: { replaceFavicon: enabled } });
      const ctx = {
        settings,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviaryFavicon.faviconFeature;
      feature.init(ctx);

      const read = () =>
        Array.from(document.querySelectorAll("link[rel]")).map((link) => ({
          rel: link.getAttribute("rel"),
          href: link.getAttribute("href")
        }));

      const applied = read();
      let afterRewrite = applied;
      if (rewriteAfter) {
        // X rewrites its icon link when the unread count changes.
        document.querySelector('link[rel="shortcut icon"]').setAttribute("href", "https://abs.twimg.com/favicons/twitter-pip.ico");
        await new Promise((resolve) => setTimeout(resolve, 40));
        afterRewrite = read();
      }

      feature.destroy(ctx);
      return { applied, afterRewrite, restored: read() };
    },
    { head: HEAD, enabled, rewriteAfter }
  );
}

test("only the browser tab icon is swapped, neighbouring rels are left alone", async () => {
  const { applied } = await run();
  const byRel = Object.fromEntries(applied.map((link) => [link.rel, link.href]));

  assert.match(byRel["shortcut icon"], /^data:image\/svg\+xml,/, "the tab icon must be swapped");
  // apple-touch-icon is the iOS home-screen icon and mask-icon is Safari's pinned-tab glyph.
  // Aviary is desktop-only and this setting is about picking an X tab out of a tab strip, so
  // neither is in scope: a feature should not rewrite what it does not claim.
  assert.equal(byRel["apple-touch-icon"], "https://abs.twimg.com/icon-ios.png");
  assert.equal(byRel["mask-icon"], "https://abs.twimg.com/icon-svg.svg");
});

test("X rewriting its icon does not undo the swap", async () => {
  const { afterRewrite } = await run({ rewriteAfter: true });
  const shortcut = afterRewrite.find((link) => link.rel === "shortcut icon");
  assert.match(shortcut.href, /^data:image\/svg\+xml,/);
});

test("Off restores the exact original hrefs", async () => {
  const { restored } = await run();
  assert.deepEqual(
    restored.map((link) => link.href),
    [
      "https://abs.twimg.com/icon-ios.png",
      "https://abs.twimg.com/icon-svg.svg",
      "https://abs.twimg.com/favicons/twitter.3.ico"
    ]
  );
});

test("the feature is inert while off", async () => {
  const { applied } = await run({ enabled: false });
  assert.equal(applied.find((link) => link.rel === "shortcut icon").href, "https://abs.twimg.com/favicons/twitter.3.ico");
});

test("the swapped icon is self-contained and needs no network request", async () => {
  const { applied } = await run();
  const href = applied.find((link) => link.rel === "shortcut icon").href;
  assert.ok(!/^https?:/.test(href), "a replacement icon must not be fetched from anywhere");
  assert.ok(href.length < 4000, `the inlined mark should stay small, saw ${href.length} chars`);
});

test("the generated page still carries the icon link this feature swaps", async () => {
  const capture = await captureHtml("home");
  assert.match(capture, /<link rel="shortcut icon"/, "X still ships a shortcut icon link");
});
