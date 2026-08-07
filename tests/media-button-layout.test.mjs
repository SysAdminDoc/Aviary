import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * X's real arrangement for a timeline photo, measured from a live capture:
 *
 *   [data-testid="tweetPhoto"]   display:flex, height 0, position:static
 *     > div  position:absolute inset:0   <- the visible photo, drawn as a background-image
 *     > img  position:absolute inset:0
 *
 * The height is carried by an ancestor, not by the photo box. So whichever element is the
 * nearest *positioned* ancestor decides how big those two children are.
 */
const FIXTURE = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<article data-testid="tweet" style="width:564px">
  <div id="sized" style="position:relative;width:564px;height:317px">
    <div data-testid="tweetPhoto" id="photo" style="display:flex">
      <div id="bg" style="position:absolute;inset:0;background-image:url(data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)"></div>
      <img id="pic" style="position:absolute;inset:0;width:100%;height:100%">
    </div>
  </div>
</article>`;

const MEASURE = () => {
  const bg = document.getElementById("bg").getBoundingClientRect();
  return { photoHeight: Math.round(bg.height), visible: bg.height > 4 };
};

async function mediaCss() {
  const src = await readFile(path.join(root, "src/features/media/media-buttons.ts"), "utf8");
  const open = "const MEDIA_CSS = `";
  const raw = src.slice(src.indexOf(open) + open.length, src.indexOf("`;", src.indexOf(open)));
  return raw.replace(/\$\{BUTTON_ATTR\}/g, "data-av-media-button");
}

/**
 * Switching the Save button on must not make the photo disappear.
 *
 * It did. The stylesheet forced `position: relative` onto the tweetPhoto box, which X keeps at
 * zero height, making it the containing block for the two absolutely positioned children that
 * *are* the photo. They collapsed to nothing: the image was loaded, present in the DOM, and
 * invisible. Toggling the button off brought it straight back.
 */
test("enabling the media buttons stylesheet does not collapse the photo", async () => {
  const css = await mediaCss();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(FIXTURE);
    const before = await page.evaluate(MEASURE);
    assert.equal(before.visible, true, "fixture is broken: the photo must start visible");
    assert.equal(before.photoHeight, 317);

    await page.addStyleTag({ content: css });
    await page.evaluate(() => document.documentElement.classList.add("av-media-buttons-enabled"));
    await page.waitForTimeout(60);

    const after = await page.evaluate(MEASURE);
    assert.equal(
      after.photoHeight,
      before.photoHeight,
      `the stylesheet changed the photo from ${before.photoHeight}px to ${after.photoHeight}px`
    );
    assert.equal(after.visible, true, "the photo must still be visible with buttons enabled");
  } finally {
    await browser.close();
  }
});

/** An absolutely positioned button is out of flow, so inserting it must change nothing either. */
test("inserting the button does not disturb the photo", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(FIXTURE);
    const before = await page.evaluate(MEASURE);

    const placed = await page.evaluate(() => {
      const container = document.getElementById("photo");
      const button = document.createElement("button");
      button.setAttribute("data-av-media-button", "photo");
      button.style.position = "absolute";
      button.textContent = "Save";
      container.append(button);

      // The same anchoring positionButton() performs.
      let anchor = container;
      while (anchor && anchor !== document.body && getComputedStyle(anchor).position === "static") {
        anchor = anchor.parentElement;
      }
      const media = container.getBoundingClientRect();
      const base = anchor.getBoundingClientRect();
      button.style.top = `${Math.round(media.top - base.top + 8)}px`;
      button.style.right = `${Math.round(base.right - media.right + 8)}px`;
      const box = button.getBoundingClientRect();
      return { anchorId: anchor.id, buttonTop: Math.round(box.top), buttonRight: Math.round(box.right) };
    });

    const after = await page.evaluate(MEASURE);
    assert.deepEqual(after, before, "inserting the button must not resize the photo");

    // It must anchor to the box that actually has size, not the zero-height photo container.
    assert.equal(placed.anchorId, "sized");
    assert.equal(placed.buttonTop, 8, "button sits 8px below the top of the media");
    assert.equal(placed.buttonRight, 556, "button sits 8px inside the right edge of the media");
  } finally {
    await browser.close();
  }
});

/** The rule that caused it must not come back in any form. */
test("no rule makes X's media containers the positioning context", async () => {
  const css = await mediaCss();
  const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*position\s*:\s*relative[^{}]*)\}/g)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((selector) => /data-testid=/.test(selector));
  assert.deepEqual(
    offenders,
    [],
    "making X's media box the containing block collapses the photo it holds"
  );
});
