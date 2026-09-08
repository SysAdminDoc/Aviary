import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * X makes the whole post row a click target, and the Hide control sits in the busiest corner of
 * it. A press that lands a few pixels off the button opened the tweet -- the one outcome someone
 * reaching for Hide never wants, and the reason the corner is now inert.
 *
 * Every assertion here drives the real mouse against real layout, because the whole rule is
 * geometry: a synthesized event carrying coordinates the test chose would only prove the test
 * can do arithmetic.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-dead-zone-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { hiddenPostsFeature, getHiddenPostStore, hideDeadZoneBlocks } from ${JSON.stringify(abs("src/features/filtering/hidden-posts-feature.ts"))};
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
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(PAGE);
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * A stripped copy of the shape X ships: an absolutely measured cell, a header row whose trailing
 * controls are pushed to the inline end, and body text that runs the full width underneath.
 */
const PAGE = `<!doctype html><meta charset=utf-8>
<style>
  body { margin: 0; font: 15px/1.3 system-ui, sans-serif; }
  [data-testid="cellInnerDiv"] { width: 600px; margin: 40px 0 0 40px; border: 1px solid #333; }
  article { display: block; padding: 12px; cursor: pointer; }
  .head { display: flex; align-items: center; gap: 6px; }
  .spacer { flex: 1 1 auto; }
  .trailing { display: flex; align-items: center; gap: 12px; padding: 4px 6px; }
  [data-testid="caret"] { width: 22px; height: 22px; }
  [data-testid="tweetText"] { margin-top: 6px; }
</style>
<body>
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div class="head">
        <div data-testid="User-Name"><a href="#/author1">@author1</a></div>
        <a href="#/author1/status/1" data-role="timestamp">2h</a>
        <div class="spacer"></div>
        <div class="trailing"><button data-testid="caret" type="button">...</button></div>
      </div>
      <div data-testid="tweetText">post one, long enough that its line reaches the far edge of the row</div>
    </article>
  </div>
</body>`;

/** Boots the feature over the page above and wires the counters every assertion reads. */
async function boot(overrides = {}) {
  await page.evaluate(async (settingsOverrides) => {
    if (window.__ctx) {
      await AviaryHidden.hiddenPostsFeature.destroy(window.__ctx);
    }
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
      hidden: { enabled: true, buttons: true, ...settingsOverrides }
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
    window.__ctx = ctx;
    await AviaryHidden.hiddenPostsFeature.apply(ctx, document);

    // X opens the tweet from a handler on the row, so that is where the counter goes. A press the
    // dead zone swallows never reaches it.
    window.__opened = 0;
    window.__caret = 0;
    window.__timestamp = 0;
    if (!window.__wired) {
      window.__wired = true;
      document.querySelector("article").addEventListener("click", () => {
        window.__opened += 1;
      });
      document.querySelector('[data-testid="caret"]').addEventListener("click", () => {
        window.__caret += 1;
      });
      document.querySelector('[data-role="timestamp"]').addEventListener("click", () => {
        window.__timestamp += 1;
      });
    }
  }, overrides);
}

async function rectOf(selector) {
  return page.evaluate((sel) => {
    const rect = document.querySelector(sel).getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }, selector);
}

async function counters() {
  return page.evaluate(() => ({
    opened: window.__opened,
    caret: window.__caret,
    timestamp: window.__timestamp,
    blocked: AviaryHidden.hideDeadZoneBlocks(),
    hidden: document.querySelector('[data-testid="cellInnerDiv"]').getAttribute("data-av-hidden")
  }));
}

test("a press beside the Hide button does not open the post", async () => {
  await boot();
  const button = await rectOf("[data-av-hide-button]");
  const caret = await rectOf('[data-testid="caret"]');
  const article = await rectOf("article");

  const before = await counters();

  // Above the button, in the header's own padding.
  await page.mouse.click((button.left + button.right) / 2, article.top + 2);
  // In the gap between the Hide button and the More menu.
  await page.mouse.click((button.right + caret.left) / 2, (caret.top + caret.bottom) / 2);
  // The corner itself, outboard of the More menu.
  await page.mouse.click(article.right - 2, article.top + 2);

  const after = await counters();
  assert.equal(after.opened, before.opened, "no press near the Hide control may open the post");
  assert.equal(after.blocked - before.blocked, 3, "all three presses are accounted for");
  assert.notEqual(after.hidden, "1", "and none of them hides the post either");
});

test("the controls inside the zone still work", async () => {
  await boot();
  const caret = await rectOf('[data-testid="caret"]');
  await page.mouse.click((caret.left + caret.right) / 2, (caret.top + caret.bottom) / 2);
  assert.equal((await counters()).caret, 1, "the More menu is inside the zone and must still fire");

  const stamp = await rectOf('[data-role="timestamp"]');
  await page.mouse.click((stamp.left + stamp.right) / 2, (stamp.top + stamp.bottom) / 2);
  assert.equal((await counters()).timestamp, 1, "the timestamp link must still fire");

  const button = await rectOf("[data-av-hide-button]");
  await page.mouse.click((button.left + button.right) / 2, (button.top + button.bottom) / 2);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="cellInnerDiv"]').getAttribute("data-av-hidden") === "1"
  );
});

test("the rest of the post still opens", async () => {
  await boot();
  const text = await rectOf('[data-testid="tweetText"]');
  const article = await rectOf("article");

  // The body text, including the end of its first line -- which runs to the same edge the
  // controls sit against, and must not be swallowed with them.
  await page.mouse.click(text.left + 20, text.top + 6);
  await page.mouse.click(text.right - 4, text.top + 6);
  // Empty row space well below the header.
  await page.mouse.click(article.right - 6, article.bottom - 4);

  const after = await counters();
  assert.equal(after.opened, 3, "clicks outside the corner keep opening the post");
});

/**
 * The zone is only ever drawn around a Hide button that exists. Turn the buttons off and the same
 * corner has to go back to opening the post -- otherwise the guard above proves nothing, since a
 * rule that swallows every press would satisfy it just as well.
 */
test("with the Hide buttons off, the same corner opens the post again", async () => {
  await boot({ buttons: false });
  const article = await rectOf("article");
  assert.equal(
    await page.evaluate(() => document.querySelectorAll("[data-av-hide-button]").length),
    0,
    "the button must be gone for this to test what it claims"
  );

  const before = await counters();
  await page.mouse.click(article.right - 2, article.top + 2);
  const after = await counters();

  assert.equal(after.opened - before.opened, 1, "no button, no dead zone");
  assert.equal(after.blocked, before.blocked, "and nothing was counted as blocked");
});

test("with hiding switched off entirely, nothing is swallowed", async () => {
  await boot();
  const article = await rectOf("article");
  await page.evaluate(() => {
    window.__ctx.settings.hidden.enabled = false;
  });

  const before = await counters();
  await page.mouse.click(article.right - 2, article.top + 2);
  const after = await counters();

  assert.equal(after.opened - before.opened, 1, "a disabled feature guards nothing");
  assert.equal(after.blocked, before.blocked);
});
