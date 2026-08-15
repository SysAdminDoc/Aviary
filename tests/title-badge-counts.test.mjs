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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-title-counts-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { themeFeature } from ${JSON.stringify(abs("src/features/appearance/theme.ts"))};
export { titleBadgeFeature, resetTitleBadgeState } from ${JSON.stringify(abs("src/features/appearance/title-badge.ts"))};
export { DEFAULT_SETTINGS, normalizeSettings, COUNT_METRICS } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCounts",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><html><head><title>Home / X</title></head><body></body></html>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const POST = `
  <article data-testid="tweet">
    <div data-testid="reply"><span data-testid="app-text-transition-container">12</span></div>
    <div data-testid="retweet"><span data-testid="app-text-transition-container">34</span></div>
    <div data-testid="like"><span data-testid="app-text-transition-container">56</span></div>
    <a href="/user/status/1/analytics"><span data-testid="app-text-transition-container">78</span></a>
  </article>
`;

async function counts(appearance) {
  return page.evaluate(
    async ({ markup, appearance }) => {
      document.body.innerHTML = markup;
      const settings = AviaryCounts.normalizeSettings({ appearance });
      const ctx = {
        settings,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      AviaryCounts.themeFeature.init(ctx);
      const read = (selector) => {
        const node = document.querySelector(selector);
        return node ? getComputedStyle(node).display : "absent";
      };
      const state = {
        replies: read('[data-testid="reply"] [data-testid="app-text-transition-container"]'),
        reposts: read('[data-testid="retweet"] [data-testid="app-text-transition-container"]'),
        likes: read('[data-testid="like"] [data-testid="app-text-transition-container"]'),
        views: read('a[href$="/analytics"] [data-testid="app-text-transition-container"]')
      };
      AviaryCounts.themeFeature.destroy(ctx);
      state.afterDestroy = read('[data-testid="like"] [data-testid="app-text-transition-container"]');
      state.leftoverClasses = Array.from(document.documentElement.classList).filter((name) =>
        name.startsWith("av-hide-count")
      );
      return state;
    },
    { markup: POST, appearance }
  );
}

test("the master switch still hides every metric, as it always did", async () => {
  const state = await counts({ hideCounts: true });
  assert.equal(state.replies, "none");
  assert.equal(state.reposts, "none");
  assert.equal(state.likes, "none");
  assert.equal(state.views, "none");
});

test("each metric can be kept while the others are hidden", async () => {
  const state = await counts({
    hideCounts: true,
    countMetrics: { replies: true, reposts: false, likes: false, views: true }
  });
  assert.equal(state.replies, "none");
  assert.equal(state.views, "none");
  assert.notEqual(state.reposts, "none", "reposts were opted out and must stay visible");
  assert.notEqual(state.likes, "none", "likes were opted out and must stay visible");
});

test("per-metric choices do nothing while the master switch is off", async () => {
  const state = await counts({
    hideCounts: false,
    countMetrics: { replies: true, reposts: true, likes: true, views: true }
  });
  for (const metric of ["replies", "reposts", "likes", "views"]) {
    assert.notEqual(state[metric], "none", `${metric} must be visible while hideCounts is off`);
  }
});

test("destroy removes every per-metric class it set", async () => {
  const state = await counts({ hideCounts: true });
  assert.notEqual(state.afterDestroy, "none", "counts must return after destroy");
  assert.deepEqual(state.leftoverClasses, []);
});

async function title(initial, { enabled = true, then = undefined } = {}) {
  return page.evaluate(
    async ({ initial, enabled, then }) => {
      AviaryCounts.resetTitleBadgeState();
      document.title = initial;
      const settings = AviaryCounts.normalizeSettings({ appearance: { hideTitleBadge: enabled } });
      const ctx = {
        settings,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      AviaryCounts.titleBadgeFeature.init(ctx);
      const afterInit = document.title;
      let afterUpdate = afterInit;
      if (then !== undefined) {
        // X rewrites the title on navigation and on each new notification.
        document.title = then;
        await new Promise((resolve) => setTimeout(resolve, 30));
        afterUpdate = document.title;
      }
      AviaryCounts.titleBadgeFeature.destroy(ctx);
      return { afterInit, afterUpdate };
    },
    { initial, enabled, then }
  );
}

test("the unread badge is stripped from the tab title", async () => {
  const result = await title("(3) Home / X");
  assert.equal(result.afterInit, "Home / X");
});

test("a badge X writes later is stripped too, without looping", async () => {
  const result = await title("Home / X", { then: "(12) Notifications / X" });
  assert.equal(result.afterUpdate, "Notifications / X");
});

test("a title with no badge is left exactly alone", async () => {
  const result = await title("Example Account on X: \"a post (with parens) here\" / X");
  assert.equal(result.afterInit, "Example Account on X: \"a post (with parens) here\" / X");
});

test("the feature is inert while off", async () => {
  const result = await title("(9) Home / X", { enabled: false });
  assert.equal(result.afterInit, "(9) Home / X");
});
