import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("conversation routes distinguish the focal post without drawing reply connector lines", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-conversation-theme-"));
  const bundle = path.join(temp, "theme.js");
  await build({
    entryPoints: [path.join(root, "src/features/appearance/theme.ts")],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryTheme",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixture = await readFile(path.join(root, "tests/smoke/current-x-status.html"), "utf8");
    await page.route("https://x.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: fixture })
    );
    await page.route("https://pbs.twimg.com/**", (route) => route.abort());
    await page.goto("https://x.com/fixture/status/1", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ path: bundle });
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = AviaryTheme.THEME_CSS;
      document.head.append(style);
      AviaryTheme.applyTheme({
        appearance: {
          theme: "noir",
          denseMode: false,
          timelineWidth: "wide",
          hideBorders: false,
          hideCounts: false,
          restoreChirp: false
        },
        accessibility: { highContrast: false, reduceMotion: "never" }
      });
    });

    const themed = await page.evaluate(() => {
      const focal = document.querySelector('[data-av-conversation-role="focal"] article') ??
        document.querySelector('article[data-av-conversation-role="focal"]');
      const replies = [...document.querySelectorAll('article[data-av-conversation-role="reply"]')];
      const focalText = focal?.querySelector('[data-testid="tweetText"]');
      const replyCell = document.querySelector(
        '[data-testid="cellInnerDiv"][data-av-conversation-role="reply"]'
      );
      return {
        surface: document.documentElement.dataset.avSurface,
        width: Math.round(
          document.querySelector('[data-testid="primaryColumn"]').getBoundingClientRect().width
        ),
        focalCount: document.querySelectorAll('article[data-av-conversation-role="focal"]').length,
        replyCount: replies.length,
        focalFont: focalText ? Number.parseFloat(getComputedStyle(focalText).fontSize) : 0,
        replyFont: replies[0]
          ? Number.parseFloat(getComputedStyle(replies[0].querySelector('[data-testid="tweetText"]')).fontSize)
          : 0,
        replyPadding: replyCell ? getComputedStyle(replyCell.firstElementChild).paddingTop : "",
        replyLine: replyCell ? getComputedStyle(replyCell, "::before").content : "none"
      };
    });

    assert.equal(themed.surface, "conversation");
    assert.ok(themed.width >= 1200, `wide conversation should use the available canvas, saw ${themed.width}px`);
    assert.equal(themed.focalCount, 1);
    assert.equal(themed.replyCount, 2);
    assert.ok(themed.focalFont > themed.replyFont);
    assert.equal(themed.replyPadding, "14px");
    assert.equal(themed.replyLine, "none");

    const off = await page.evaluate(() => {
      AviaryTheme.applyTheme({
        appearance: {
          theme: "off",
          denseMode: false,
          timelineWidth: "default",
          hideBorders: false,
          hideCounts: false,
          restoreChirp: false
        },
        accessibility: { highContrast: false, reduceMotion: "never" }
      });
      return {
        surface: document.documentElement.dataset.avSurface ?? null,
        markers: document.querySelectorAll('[data-av-conversation-role]').length
      };
    });
    assert.deepEqual(off, { surface: null, markers: 0 });
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
