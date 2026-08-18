import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Windows High Contrast, driven for real.
 *
 * Nothing in this repository tested forced-colors before, and the Control Center did not survive
 * it: the UA drops non-url() `background-image` and `box-shadow` to `none` and overrides author
 * colours, and the settings toggle carried its entire on/off state in a background colour plus a
 * background-coloured `::before` knob -- over a real `<input>` that was `opacity: 0` and
 * `appearance: none`, so the UA's own guaranteed-contrast rendering was suppressed too.
 *
 * These assertions read computed style under `forcedColors: "active"` rather than checking that a
 * media query exists, because a block that exists and does not change anything is the failure mode.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-forced-colors-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};
export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryForced",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Opens the panel under a chosen forced-colors state and reports computed style. */
async function inspect(forcedColors) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    forcedColors
  });
  const page = await context.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });

  const result = await page.evaluate(() => {
    const settings = AviaryForced.cloneSettings(AviaryForced.DEFAULT_SETTINGS);
    const panel = AviaryForced.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="appearance"]').click();

    const input = shadow.querySelector('.av-toggle-control > input[type="checkbox"]');
    const track = shadow.querySelector(".av-toggle");
    const button = shadow.querySelector(".av-button");
    const row = shadow.querySelector(".av-row");

    const read = (node) => {
      const style = getComputedStyle(node);
      return {
        opacity: style.opacity,
        appearance: style.appearance,
        display: style.display,
        boxShadow: style.boxShadow,
        backgroundImage: style.backgroundImage,
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth
      };
    };

    // Every element the panel draws, so a shadow or gradient cannot hide in a corner.
    const offenders = { shadows: [], images: [] };
    for (const node of shadow.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      if (style.boxShadow && style.boxShadow !== "none") {
        offenders.shadows.push(node.className || node.tagName);
      }
      const image = style.backgroundImage;
      if (image && image !== "none" && !image.includes("url(")) {
        offenders.images.push(node.className || node.tagName);
      }
    }

    const forced = matchMedia("(forced-colors: active)").matches;
    const out = {
      forced,
      input: read(input),
      track: read(track),
      button: read(button),
      row: read(row),
      offenders
    };
    panel.destroy();
    return out;
  });

  await context.close();
  return result;
}

test("forced colors hands the toggle back to the browser's own rendering", async () => {
  const active = await inspect("active");
  assert.equal(active.forced, true, "the harness must actually be in forced-colors mode");

  // The painted track cannot express state once its colours are overridden, so it steps aside and
  // the real checkbox -- which the UA draws with guaranteed contrast -- becomes visible again.
  assert.equal(active.input.opacity, "1", "the real checkbox must be visible");
  assert.notEqual(active.input.appearance, "none", "and must keep its native rendering");
  assert.equal(active.track.display, "none", "the painted track must step aside");
});

test("nothing in the panel depends on a shadow or a gradient for meaning", async () => {
  const active = await inspect("active");

  // The UA drops both outright, so anything still relying on them is invisible in this mode.
  assert.deepEqual(active.offenders.shadows, [], "box-shadow is dropped by the UA in forced colors");
  assert.deepEqual(
    active.offenders.images,
    [],
    "non-url() background-image is dropped by the UA in forced colors"
  );
});

test("rows and buttons keep an explicit edge once tints are overridden", async () => {
  const active = await inspect("active");

  for (const [name, node] of Object.entries({ row: active.row, button: active.button })) {
    assert.notEqual(node.borderTopStyle, "none", `${name} must keep a visible edge`);
    assert.notEqual(node.borderTopWidth, "0px", `${name} must keep a measurable edge`);
  }
});

test("the ordinary appearance is untouched", async () => {
  const normal = await inspect("none");
  assert.equal(normal.forced, false);

  // The custom toggle is the whole point of the design outside this mode.
  assert.equal(normal.input.opacity, "0", "the real checkbox stays hidden normally");
  assert.notEqual(normal.track.display, "none", "and the painted track does the work");
});
