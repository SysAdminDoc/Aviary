import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Two faults that only show up under X's virtualizer.
 *
 * `collapse` dispatched a synthetic `resize` on every pass, and `apply` re-collapses every
 * stored-hidden article on every pass — while the virtualizer answers that resize with childList
 * mutations, which drive the next pass. The nudge fed itself for as long as a hidden post was on
 * screen.
 *
 * Separately the derived key was cached on the article element, and X reuses those elements for
 * different posts. A recycled node kept the previous post's key, and a stored key collapses on
 * sight, so an unrelated post disappeared.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-hidden-reconcile-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { hiddenPostsFeature, getHiddenPostStore } from ${JSON.stringify(abs("src/features/filtering/hidden-posts-feature.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryHidden",
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

const cell = (id) => `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/author${id}">@author${id}</a></div>
      <a href="/author${id}/status/${id}">link</a>
      <div data-testid="tweetText">post ${id}</div>
    </article>
  </div>`;

/** Boots the feature with one post already hidden. */
async function boot() {
  return page.evaluate(
    async ({ html, hiddenId }) => {
      document.body.innerHTML = html;
      const values = new Map();
      const storage = {
        async get(key, fallback) {
          return values.has(key) ? values.get(key) : fallback;
        },
        async set(key, value) {
          values.set(key, JSON.parse(JSON.stringify(value)));
        }
      };
      const settings = AviaryHidden.normalizeSettings({
        hidden: { enabled: true, buttons: true }
      });
      const ctx = {
        settings,
        storage,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} },
        auditLog: { record() {} },
        limiter: { take: () => true },
        saveSettings: async () => {},
        requestApply: () => {}
      };
      await AviaryHidden.hiddenPostsFeature.init(ctx);
      const store = AviaryHidden.getHiddenPostStore();
      await store.hide({ key: `id:${hiddenId}`, tweetId: hiddenId, handle: null, text: "" }, 5000);
      window.__ctx = ctx;
      return true;
    },
    { html: cell("111") + cell("222"), hiddenId: "111" }
  );
}

test("re-applying over an already-collapsed post does not keep firing resize", async () => {
  await boot();

  const resizes = await page.evaluate(async () => {
    let count = 0;
    const onResize = () => {
      count += 1;
    };
    window.addEventListener("resize", onResize);
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

    // First pass performs the collapse, which legitimately needs one nudge so the virtualizer
    // closes the row. Every pass after it changes nothing.
    await AviaryHidden.hiddenPostsFeature.apply(window.__ctx, document);
    await frame();
    const afterFirst = count;

    for (let i = 0; i < 6; i += 1) {
      await AviaryHidden.hiddenPostsFeature.apply(window.__ctx, document);
      await frame();
    }
    window.removeEventListener("resize", onResize);
    return { afterFirst, total: count };
  });

  assert.ok(resizes.afterFirst <= 1, `the collapse should nudge at most once, saw ${resizes.afterFirst}`);
  assert.equal(
    resizes.total,
    resizes.afterFirst,
    "steady-state passes must not dispatch resize, or each one drives the next"
  );
});

test("a recycled article does not inherit the previous post's identity", async () => {
  await boot();

  const result = await page.evaluate(async () => {
    await AviaryHidden.hiddenPostsFeature.apply(window.__ctx, document);

    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    const hiddenCell = cells[0];
    const article = hiddenCell.querySelector("article");
    const keyAfterHide = article.getAttribute("data-av-post-key");

    // X reuses the element and swaps the post inside it -- same node, different post.
    article.querySelector('a[href*="/status/"]').setAttribute("href", "/author999/status/999");
    article.querySelector('[data-testid="tweetText"]').textContent = "post 999";
    article.querySelector('[data-testid="User-Name"] a').setAttribute("href", "/author999");

    await AviaryHidden.hiddenPostsFeature.apply(window.__ctx, document);

    return {
      keyAfterHide,
      keyAfterRecycle: article.getAttribute("data-av-post-key"),
      recycledCellHidden: hiddenCell.getAttribute("data-av-hidden"),
      untouchedCellHidden: cells[1].getAttribute("data-av-hidden")
    };
  });

  assert.equal(result.keyAfterHide, "id:111");
  assert.equal(result.keyAfterRecycle, "id:999", "the key must follow the post, not the element");
  assert.notEqual(
    result.recycledCellHidden,
    "1",
    "post 999 is not hidden and must not inherit 111's collapse"
  );
  assert.notEqual(result.untouchedCellHidden, "1");
});
