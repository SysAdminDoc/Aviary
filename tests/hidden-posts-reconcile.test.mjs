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

/**
 * A second pass over an unchanged page must schedule no new reflow nudge.
 *
 * This used to count `resize` events after awaiting one real animation frame, which made it a
 * measurement of how many frames elapsed rather than of what the feature scheduled: under a loaded
 * full-suite run the first pass could be seen to nudge twice and the test failed intermittently.
 * The frames are driven explicitly here, so the count is the feature's decision and nothing else.
 */
test("re-applying over an already-collapsed post does not keep firing resize", async () => {
  await boot();

  const resizes = await page.evaluate(async () => {
    let count = 0;
    const onResize = () => {
      count += 1;
    };
    window.addEventListener("resize", onResize);

    // A frame queue the test drains, so no wall-clock frame can slip in between passes.
    const pending = new Map();
    let nextHandle = 1;
    const realRaf = window.requestAnimationFrame;
    const realCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = (handle) => {
      pending.delete(handle);
    };
    const drain = () => {
      const scheduled = [...pending.entries()];
      pending.clear();
      for (const [, callback] of scheduled) callback(0);
      return scheduled.length;
    };

    try {
      // The first pass performs the collapse, which legitimately needs one nudge so the
      // virtualizer closes the row.
      await AviaryHidden.hiddenPostsFeature.apply(window.__ctx, document);
      const scheduledByFirst = drain();
      const afterFirst = count;

      // Every pass after it changes nothing, so none of them may schedule anything.
      let scheduledAfter = 0;
      for (let i = 0; i < 6; i += 1) {
        await AviaryHidden.hiddenPostsFeature.apply(window.__ctx, document);
        scheduledAfter += drain();
      }
      return { scheduledByFirst, afterFirst, scheduledAfter, total: count };
    } finally {
      window.requestAnimationFrame = realRaf;
      window.cancelAnimationFrame = realCancel;
      window.removeEventListener("resize", onResize);
    }
  });

  assert.ok(
    resizes.scheduledByFirst <= 1,
    `the collapse should schedule at most one nudge, saw ${resizes.scheduledByFirst}`
  );
  assert.equal(resizes.afterFirst, resizes.scheduledByFirst, "each scheduled nudge fires once");
  assert.equal(
    resizes.scheduledAfter,
    0,
    `a pass that changes nothing must schedule nothing, saw ${resizes.scheduledAfter}`
  );
  assert.equal(resizes.total, resizes.afterFirst, "and therefore fire nothing further");
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
