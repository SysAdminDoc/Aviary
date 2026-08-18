import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * What the media controls look like once they are on a post, and what they do to the post.
 *
 * The old form sliced `MEDIA_CSS` out of `media-buttons.ts` and matched `/opacity:\s*1/`,
 * `/min-height:\s*36px/` and `/box-shadow:/` anywhere inside it — any rule in the sheet
 * satisfies all three, including rules for something else entirely. It also parsed the sheet for
 * selectors declaring `position: relative` on a `data-testid` container, standing in for a defect
 * worth measuring directly: making `tweetPhoto` the containing block collapsed the photo, because
 * X keeps that box at height 0 and hangs the picture off it with `position:absolute; inset:0`.
 * The picture inherited the zero height and vanished the moment Save was switched on.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

/** X's real shape: a zero-height `tweetPhoto` with the picture absolutely positioned inside it. */
const FIXTURE = `
<main data-testid="primaryColumn">
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <a href="/alice/status/1900000000000001"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
      <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
      <div style="position: relative; width: 500px; height: 280px;">
        <div data-testid="tweetPhoto" style="height: 0;">
          <img src="https://pbs.twimg.com/media/photo1?format=jpg&name=small"
               style="position:absolute; inset:0; width:100%; height:100%;" alt="">
        </div>
      </div>
    </article>
  </div>
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-media-presence-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mediaButtonsFeature } from ${JSON.stringify(abs("src/features/media/media-buttons.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryMedia",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><body>${FIXTURE}</body>`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.mediaCtx = (mutate) => {
      const settings = AviaryMedia.cloneSettings(AviaryMedia.DEFAULT_SETTINGS);
      mutate?.(settings);
      return {
        settings,
        route: { surface: "home", path: "/home" },
        storage: {
          async get(key, fallback) {
            // A queued handoff, so `reconcile` has work to do. With an empty history it makes no
            // network call at all and "a disabled integration is never contacted" proves nothing.
            if (String(key).includes("aria2")) {
              return {
                entries: [
                  { gid: "abc123", url: "https://video.twimg.com/a.mp4", filename: "a.mp4", queuedAt: "2026-08-18T10:00:00.000Z", status: "queued" }
                ]
              };
            }
            return fallback;
          },
          async set() {},
          async remove() {}
        },
        auditLog: { async record() {} },
        limiter: { async waitForToken() {} },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("attaching the controls does not collapse the photo they sit on", async () => {
  const sizes = await page.evaluate(async () => {
    const photo = () => document.querySelector('[data-testid="tweetPhoto"] img').getBoundingClientRect();
    const before = photo();

    const ctx = window.mediaCtx();
    await AviaryMedia.mediaButtonsFeature.init(ctx);
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const after = photo();
    const buttons = document.querySelectorAll("[data-av-media-button]").length;

    await AviaryMedia.mediaButtonsFeature.destroy(ctx);
    return { beforeHeight: before.height, afterHeight: after.height, buttons };
  });

  assert.ok(sizes.beforeHeight > 100, `the fixture photo must have height, saw ${sizes.beforeHeight}`);
  assert.ok(sizes.buttons > 0, "no media control was attached — this proves nothing");
  assert.equal(sizes.afterHeight, sizes.beforeHeight, "the photo collapsed when the controls attached");
});

test("a media control is visible at rest, not only on hover, and is big enough to hit", async () => {
  const control = await page.evaluate(async () => {
    const ctx = window.mediaCtx();
    await AviaryMedia.mediaButtonsFeature.init(ctx);
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const button = document.querySelector("[data-av-media-button]");
    const style = getComputedStyle(button);
    const box = button.getBoundingClientRect();
    const resting = {
      opacity: Number(style.opacity),
      display: style.display,
      visibility: style.visibility,
      height: box.height,
      shadow: style.boxShadow,
      onScreen: box.width > 0 && box.height > 0
    };

    // A control that only appears on hover is undiscoverable and unusable by touch.
    const article = button.closest('article[data-testid="tweet"]');
    article.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const hovered = Number(getComputedStyle(button).opacity);

    await AviaryMedia.mediaButtonsFeature.destroy(ctx);
    return { resting, hovered };
  });

  assert.equal(control.resting.onScreen, true, "the control has no box");
  assert.notEqual(control.resting.display, "none");
  assert.notEqual(control.resting.visibility, "hidden");
  assert.ok(control.resting.opacity >= 0.9, `resting opacity ${control.resting.opacity} hides the control`);
  assert.ok(control.resting.height >= 36, `the control is ${control.resting.height}px tall`);
  assert.notEqual(control.resting.shadow, "none", "the control needs separation from the photo behind it");
  assert.ok(control.hovered >= control.resting.opacity, "hover must not hide a persistent control");
});

test("destroy removes every control and leaves the post as it was", async () => {
  const after = await page.evaluate(async () => {
    const article = document.querySelector('article[data-testid="tweet"]');
    const before = article.outerHTML;

    const ctx = window.mediaCtx();
    await AviaryMedia.mediaButtonsFeature.init(ctx);
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const during = document.querySelectorAll("[data-av-media-button]").length;

    await AviaryMedia.mediaButtonsFeature.destroy(ctx);
    return {
      during,
      buttons: document.querySelectorAll("[data-av-media-button]").length,
      style: Boolean(document.getElementById("av-media-buttons")),
      identical: article.outerHTML === before
    };
  });

  assert.ok(after.during > 0);
  assert.equal(after.buttons, 0, "destroy left a control behind");
  assert.equal(after.style, false, "destroy must take its stylesheet with it");
  assert.equal(after.identical, true, "the post markup did not return to what it was");
});

test("a disabled aria2 integration is never contacted, endpoint or not", async () => {
  const result = await page.evaluate(async () => {
    let reached = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      reached += 1;
      throw new Error("network should not be reached");
    };
    try {
      // An endpoint string survives disabling the integration, so `endpoint` alone is the wrong
      // gate: a user who configures aria2 and then turns it off would still be contacted at boot.
      const ctx = window.mediaCtx((settings) => {
        settings.integrations.aria2.enabled = false;
        settings.integrations.aria2.endpoint = "http://127.0.0.1:6800/jsonrpc";
      });
      let threw = null;
      try {
        await AviaryMedia.mediaButtonsFeature.init(ctx);
        await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
        await new Promise((resolve) => setTimeout(resolve, 40));
      } catch (error) {
        threw = String(error);
      }
      const buttons = document.querySelectorAll("[data-av-media-button]").length;
      await AviaryMedia.mediaButtonsFeature.destroy(ctx);
      return { reached, threw, buttons };
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  assert.equal(result.reached, 0, "a disabled integration was contacted anyway");
  assert.equal(result.threw, null, "boot must not fail");
  assert.ok(result.buttons > 0, "and the Save controls must still be drawn");
});

test("a failing aria2 reconcile does not take the Save controls down with it", async () => {
  const result = await page.evaluate(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("connection refused"));
    try {
      const ctx = window.mediaCtx((settings) => {
        settings.integrations.aria2.enabled = true;
        settings.integrations.aria2.endpoint = "http://127.0.0.1:6800/jsonrpc";
      });
      const warnings = [];
      ctx.diagnostics.warn = (message) => warnings.push(message);

      let threw = null;
      try {
        await AviaryMedia.mediaButtonsFeature.init(ctx);
        await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
        await new Promise((resolve) => setTimeout(resolve, 60));
      } catch (error) {
        threw = String(error);
      }
      const buttons = document.querySelectorAll("[data-av-media-button]").length;
      await AviaryMedia.mediaButtonsFeature.destroy(ctx);
      return { threw, buttons };
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Housekeeping against an aria2 daemon that is not running must never fail the feature that
  // owns the Save buttons; the user would lose media downloads because a side integration is down.
  assert.equal(result.threw, null, "a refused aria2 connection failed the media feature");
  assert.ok(result.buttons > 0, "the Save controls disappeared");
});
