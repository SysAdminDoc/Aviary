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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-abs-time-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { absoluteTimeFeature } from ${JSON.stringify(abs("src/features/appearance/absolute-time.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryTime",
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

async function run({ enabled = true, locale = "en", markup } = {}) {
  return page.evaluate(
    async ({ enabled, locale, markup }) => {
      document.body.innerHTML = markup;
      const settings = AviaryTime.normalizeSettings({
        appearance: { absoluteTimestamps: enabled },
        i18n: { locale }
      });
      const ctx = {
        settings,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviaryTime.absoluteTimeFeature;
      feature.init(ctx);
      const applied = Array.from(document.querySelectorAll("time")).map((node) => node.textContent);
      feature.destroy(ctx);
      const restored = Array.from(document.querySelectorAll("time")).map((node) => node.textContent);
      return { applied, restored };
    },
    { enabled, locale, markup }
  );
}

const POSTS = `
  <article data-testid="tweet"><time datetime="2026-05-18T20:14:08.000Z">2h</time></article>
  <article data-testid="tweet"><time datetime="2026-05-18T21:33:30.000Z">May 18</time></article>
`;

test("relative text becomes an exact date and time", async () => {
  const { applied } = await run({ markup: POSTS });
  assert.notEqual(applied[0], "2h");
  assert.match(applied[0], /2026/, "the year must be shown");
  assert.match(applied[0], /\d{1,2}:\d{2}/, "the time must be shown");
});

test("Off restores exactly what X wrote, not a string Aviary invented", async () => {
  const { restored } = await run({ markup: POSTS });
  assert.deepEqual(restored, ["2h", "May 18"]);
});

test("the feature is inert while off", async () => {
  const { applied } = await run({ markup: POSTS, enabled: false });
  assert.deepEqual(applied, ["2h", "May 18"]);
});

test("the panel locale decides the format", async () => {
  const en = await run({ markup: POSTS, locale: "en" });
  const ja = await run({ markup: POSTS, locale: "ja" });
  assert.notEqual(en.applied[0], ja.applied[0], "a locale change must change the rendering");
});

test("a time without a usable datetime is left alone", async () => {
  const { applied } = await run({
    markup: `
      <article data-testid="tweet"><time>just now</time></article>
      <article data-testid="tweet"><time datetime="not-a-date">2h</time></article>
    `
  });
  assert.deepEqual(applied, ["just now", "2h"]);
});

test("the captured home timeline carries the datetime this feature reads", async () => {
  const { readFile } = await import("node:fs/promises");
  const capture = await readFile(path.join(root, "_decoded/home.html"), "utf8");
  const times = capture.match(/<time datetime="[^"]+"/g) ?? [];
  assert.ok(times.length > 0, "the capture must contain time elements with datetime attributes");
});
