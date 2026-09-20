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

const FIXTURE = `
<main>
  <article data-testid="tweet" id="outer">
    <a href="/alice/status/100"><time>now</time></a>
    <div data-testid="tweetText">A long outer post</div>
    <button id="own" type="button">Show more</button>
    <div role="link" tabindex="0" id="quote">
      <a href="/bob/status/101"><time>now</time></a>
      <div data-testid="tweetText">A quoted post</div>
      <button id="quoted" type="button">Show more</button>
    </div>
    <div role="group"><button id="action" type="button">Show more</button></div>
    <button id="different" type="button">Show more replies</button>
  </article>
  <aside><button id="sidebar" type="button">Show more</button></aside>
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-auto-expand-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { autoExpandPostsFeature } from ${JSON.stringify(abs("src/features/layout/auto-expand-posts.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryExpand",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function load(enabled = true) {
  await page.evaluate(({ fixture, enabled }) => {
    document.body.innerHTML = fixture;
    const clicks = {};
    for (const id of ["own", "quoted", "action", "different", "sidebar"]) {
      clicks[id] = 0;
      document.getElementById(id).addEventListener("click", () => { clicks[id] += 1; });
    }
    const settings = AviaryExpand.cloneSettings(AviaryExpand.DEFAULT_SETTINGS);
    settings.layout.autoExpandPostText = enabled;
    const ctx = {
      settings,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    globalThis.fixtureClicks = clicks;
    globalThis.expandCtx = ctx;
  }, { fixture: FIXTURE, enabled });
}

test("only a post's own exact Show more control is clicked", async () => {
  await load(true);
  const clicks = await page.evaluate(async () => {
    AviaryExpand.autoExpandPostsFeature.init(globalThis.expandCtx);
    AviaryExpand.autoExpandPostsFeature.apply(globalThis.expandCtx, document);
    await new Promise((resolve) => setTimeout(resolve, 90));
    const result = structuredClone(globalThis.fixtureClicks);
    AviaryExpand.autoExpandPostsFeature.destroy(globalThis.expandCtx);
    return result;
  });

  assert.deepEqual(clicks, {
    own: 1,
    quoted: 0,
    action: 0,
    different: 0,
    sidebar: 0
  });
});

test("new long posts wait until scrolling settles", async () => {
  await load(true);
  const result = await page.evaluate(async () => {
    AviaryExpand.autoExpandPostsFeature.init(globalThis.expandCtx);
    await new Promise((resolve) => setTimeout(resolve, 70));
    const late = document.createElement("article");
    late.setAttribute("data-testid", "tweet");
    late.innerHTML = `
      <a href="/alice/status/102"><time>now</time></a>
      <div data-testid="tweetText">Late long post</div>
      <button id="late-more" type="button">Show more</button>`;
    let lateClicks = 0;
    late.querySelector("button").addEventListener("click", () => { lateClicks += 1; });
    document.querySelector("main").append(late);
    dispatchEvent(new Event("scroll"));
    AviaryExpand.autoExpandPostsFeature.apply(globalThis.expandCtx, late, [late]);
    await new Promise((resolve) => setTimeout(resolve, 70));
    const duringScroll = lateClicks;
    await new Promise((resolve) => setTimeout(resolve, 190));
    const afterIdle = lateClicks;
    AviaryExpand.autoExpandPostsFeature.destroy(globalThis.expandCtx);
    return { duringScroll, afterIdle };
  });

  assert.equal(result.duringScroll, 0);
  assert.equal(result.afterIdle, 1);
});

test("the setting is opt-in and normalization preserves it", async () => {
  await load(false);
  const result = await page.evaluate(async () => {
    AviaryExpand.autoExpandPostsFeature.init(globalThis.expandCtx);
    AviaryExpand.autoExpandPostsFeature.apply(globalThis.expandCtx, document);
    await new Promise((resolve) => setTimeout(resolve, 80));
    AviaryExpand.autoExpandPostsFeature.destroy(globalThis.expandCtx);
    return {
      clicks: structuredClone(globalThis.fixtureClicks),
      defaultValue: AviaryExpand.DEFAULT_SETTINGS.layout.autoExpandPostText,
      normalized: AviaryExpand.normalizeSettings({ layout: { autoExpandPostText: true } })
        .layout.autoExpandPostText
    };
  });

  assert.equal(result.defaultValue, false);
  assert.equal(result.normalized, true);
  assert.equal(result.clicks.own, 0);
});
