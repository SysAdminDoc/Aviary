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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-custom-css-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { DEFAULT_SETTINGS, normalizeSettings, sanitizeCustomCss } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`,
      `export { applyCustomCss, buildScopedCustomCss } from ${JSON.stringify(path.join(root, "src/features/appearance/custom-css.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCustomCss",
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

test("custom CSS is normalized, scoped, and removed with the override", async () => {
  const result = await page.evaluate(() => {
    document.body.innerHTML = `
      <nav aria-label="Primary"><a>Home</a></nav>
      <main data-testid="primaryColumn">
        <article data-testid="tweet"><p>Post</p><button data-av-media-button>Save</button></article>
      </main>
      <aside data-testid="sidebarColumn">Side</aside>`;
    const rules = {
      posts: "article { color: rgb(255, 0, 0); }",
      media: ".av-media-button { border-radius: 16px; }",
      navigation: "a { text-decoration: none; }",
      sidebar: "{ broken",
      composer: ""
    };
    AviaryCustomCss.applyCustomCss(rules);
    const applied = {
      style: document.getElementById("av-custom-css")?.textContent ?? "",
      postScope: document.querySelector("article")?.getAttribute("data-av-custom-css-scope"),
      mediaScope: document.querySelector("[data-av-media-button]")?.getAttribute("data-av-custom-css-scope"),
      navScope: document.querySelector("nav")?.getAttribute("data-av-custom-css-scope"),
      sideScope: document.querySelector("aside")?.getAttribute("data-av-custom-css-scope")
    };
    AviaryCustomCss.applyCustomCss({ posts: "", media: "", navigation: "", sidebar: "", composer: "" });
    return {
      applied,
      removed: {
        style: document.getElementById("av-custom-css"),
        postScope: document.querySelector("article")?.getAttribute("data-av-custom-css-scope"),
        navScope: document.querySelector("nav")?.getAttribute("data-av-custom-css-scope")
      }
    };
  });
  assert.match(result.applied.style, /@scope \(\[data-av-custom-css-scope~="posts"\]\)/);
  assert.match(result.applied.style, /@scope \(\[data-av-custom-css-scope~="media"\]\)/);
  assert.match(result.applied.style, /@scope \(\[data-av-custom-css-scope~="navigation"\]\)/);
  assert.equal(result.applied.postScope, "posts");
  assert.equal(result.applied.mediaScope, "media");
  assert.equal(result.applied.navScope, "navigation");
  assert.equal(result.applied.sideScope, null, "malformed CSS must not get a scope marker");
  assert.equal(result.removed.style, null);
  assert.equal(result.removed.postScope, null);
  assert.equal(result.removed.navScope, null);
});

test("custom CSS sanitization refuses network and script-like hooks", async () => {
  const result = await page.evaluate(() => {
    const clean = AviaryCustomCss.sanitizeCustomCss(".x { background: url(https://example.test/x); }");
    const bounded = AviaryCustomCss.sanitizeCustomCss("a { color: red; }".repeat(2000));
    const settings = AviaryCustomCss.normalizeSettings({
      appearance: { customCss: { posts: "article { color: red; }", media: "@import url(x);" } }
    });
    return { clean, bounded: bounded.value.length, settings: settings.appearance.customCss };
  });
  assert.equal(result.clean.value, "");
  assert.equal(result.clean.changed, true);
  assert.ok(result.bounded <= 12_000);
  assert.equal(result.settings.posts, "article { color: red; }");
  assert.equal(result.settings.media, "");
});

test("custom CSS scopes follow posts and controls added after the first pass", async () => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = "<main></main>";
    AviaryCustomCss.applyCustomCss({
      posts: "article { color: red; }",
      media: "",
      navigation: "",
      sidebar: "",
      composer: ""
    });
    const article = document.createElement("article");
    article.dataset.testid = "tweet";
    document.querySelector("main").append(article);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return article.getAttribute("data-av-custom-css-scope");
  });
  assert.equal(result, "posts");
});

test("custom CSS has a selector fallback below the @scope browser floor", async () => {
  const fallback = await page.evaluate(() =>
    AviaryCustomCss.buildScopedCustomCss(
      {
        posts: "article, .card > p { color: red; }",
        navigation: "@media (min-width: 1px) { a { text-decoration: none; } }"
      },
      false
    )
  );
  assert.doesNotMatch(fallback, /@scope/);
  assert.match(fallback, /article\[data-av-custom-css-scope~="posts"\]/);
  assert.match(fallback, /data-av-custom-css-scope~="posts"\] \.card\) > p/);
  assert.match(fallback, /@media \(min-width: 1px\)/);
  assert.match(fallback, /a\[data-av-custom-css-scope~="navigation"\]/);
});
