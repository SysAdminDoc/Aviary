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
        replyLine: replyCell ? getComputedStyle(replyCell, "::before").content : "none",
        // X draws the connector as its own element in the avatar gutter. Reading the reply cell's
        // pseudo-element proves nothing about it: that assertion passed while the line was still
        // on screen, which is the defect this covers.
        nativeLines: [...document.querySelectorAll("[data-av-conversation-line]")].map((node) => ({
          hidden: getComputedStyle(node).display === "none",
          insideReply: node.closest('article[data-av-conversation-role="reply"]') !== null,
          namedByClass: node.getAttribute("data-av-conversation-line")
        })),
        // Nothing in the avatar gutter may be collateral damage.
        avatars: [...document.querySelectorAll('[data-testid="Tweet-User-Avatar"]')].map((node) => {
          const box = node.getBoundingClientRect();
          return { width: Math.round(box.width), height: Math.round(box.height) };
        }),
        decoysStamped: [...document.querySelectorAll("[data-av-decoy]")]
          .filter((node) => node.hasAttribute("data-av-conversation-line"))
          .map((node) => node.getAttribute("data-av-decoy")),
        authorLinkClickable: (() => {
          const link = document.querySelector(
            'article[data-av-conversation-role="reply"] [data-testid="User-Name"] a'
          );
          if (!link) return false;
          const box = link.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) return false;
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return link.contains(hit) || hit === link;
        })()
      };
    });

    assert.equal(themed.surface, "conversation");
    assert.ok(themed.width >= 1200, `wide conversation should use the available canvas, saw ${themed.width}px`);
    assert.equal(themed.focalCount, 1);
    assert.equal(themed.replyCount, 2);
    assert.ok(themed.focalFont > themed.replyFont);
    assert.equal(themed.replyPadding, "14px");
    assert.equal(themed.replyLine, "none");

    // The real element, not the pseudo-element. Both replies in the fixture carry one.
    assert.equal(
      themed.nativeLines.length,
      2,
      "X's own reply connectors were not detected, so hiding them cannot have been proved"
    );
    for (const line of themed.nativeLines) {
      assert.equal(line.hidden, true, "a stamped connector is still painted");
      assert.equal(line.insideReply, true, "a connector was stamped outside a reply cell");
    }
    assert.deepEqual(
      themed.avatars,
      [
        { width: 44, height: 44 },
        { width: 44, height: 44 },
        { width: 44, height: 44 }
      ],
      "hiding the connector must not resize the avatars beside it"
    );
    assert.equal(themed.authorLinkClickable, true, "the reply author link lost its hit target");
    assert.deepEqual(
      themed.decoysStamped,
      [],
      "a non-connector element was stamped, so the geometry checks are not doing anything"
    );

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
      const line = document.querySelector(".css-175oi2r.r-1bnu78o");
      return {
        surface: document.documentElement.dataset.avSurface ?? null,
        markers: document.querySelectorAll('[data-av-conversation-role]').length,
        lineStamps: document.querySelectorAll("[data-av-conversation-line]").length,
        // X's node has to come back, not merely lose its stamp.
        lineVisible: line ? getComputedStyle(line).display !== "none" : false
      };
    });
    assert.deepEqual(off, { surface: null, markers: 0, lineStamps: 0, lineVisible: true });
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
