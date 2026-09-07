import assert from "node:assert/strict";
import { captureUrl } from "./helpers/synthetic-capture.mjs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/**
 * The six authored palettes, driven for real.
 *
 * `theme.ts` carried eighteen shadow, gradient and background-image declarations and no
 * `forced-colors` block at all, and this file drove the Control Center and nothing else. The
 * palettes had never been checked. Every state below was expressed only through a property the
 * user agent drops or overrides -- the hovered row was a tint, the selected tab a colour and,
 * under noir, a glow; the active navigation item a tint plus an inset shadow rail; the search
 * field's focus a border tint plus a shadow ring; the media action a filled accent button with a
 * transparent border. In Windows High Contrast a reader could not tell any of them apart.
 *
 * Each case reads computed style on both routes, compares a state against its own resting state,
 * and finishes with a positive control: the same comparison is run again with the rule that
 * restores the state deleted from the stylesheet, and it has to stop finding a difference.
 */

const PALETTES = ["dim", "lightsOut", "graphite", "plum", "midnight", "noir"];

const themeSettings = (theme) => ({
  appearance: {
    theme,
    denseMode: false,
    timelineWidth: "default",
    hideBorders: false,
    hideCounts: false,
    restoreChirp: false
  },
  accessibility: { reduceMotion: "never", highContrast: false }
});

/** The properties forced colors leaves alone, which is what a state has left to speak with. */
function signatureOf(node) {
  const style = getComputedStyle(node);
  return [
    style.outlineStyle,
    style.outlineWidth,
    style.outlineColor,
    style.borderTopStyle, style.borderTopWidth,
    style.borderBottomStyle, style.borderBottomWidth,
    style.borderLeftStyle, style.borderLeftWidth,
    style.textDecorationLine,
    style.opacity,
    style.filter
  ].join("|");
}

const ROW = '[data-testid="cellInnerDiv"] > div';
const TAB_SELECTED = '[data-testid="primaryColumn"] [role="tab"][aria-selected="true"]';
const TAB_RESTING = '[data-testid="primaryColumn"] [role="tab"][aria-selected="false"]';
const NAV_ACTIVE = '[data-testid="AppTabBar_Home_Link"]';
const NAV_RESTING = '[data-testid="AppTabBar_Explore_Link"]';
const SEARCH = 'form[role="search"]';
const ACTION = "[data-av-media-action]";

async function openThemedRoute(route, themeBundle, extraCss = "") {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, forcedColors: "active" });
  const page = await context.newPage();
  await page.goto(await captureUrl(route));
  await page.addScriptTag({ content: themeBundle });
  await page.evaluate(
    ({ extra }) => {
      const style = document.createElement("style");
      style.id = "av-theme-forced";
      style.textContent = globalThis.__theme.THEME_CSS + extra;
      document.head.append(style);

      // Two states the generated document does not carry on its own: X marks the current
      // navigation item, and Aviary mounts its own action into the post action bar.
      document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.setAttribute("aria-current", "page");
      const group = document.querySelector('article [role="group"]');
      if (group) {
        const action = document.createElement("button");
        action.type = "button";
        action.setAttribute("data-av-media-action", "1");
        action.textContent = "Download";
        group.append(action);
      }
      // The search field needs to be focusable for the focus state to exist at all.
      const form = document.createElement("form");
      form.setAttribute("role", "search");
      const input = document.querySelector('[data-testid="SearchBox_Search_Input"]');
      input?.parentElement?.append(form);
      if (input) form.append(input);
    },
    { extra: extraCss }
  );
  return { context, page };
}

/** Applies a palette and returns each state beside the resting state it has to differ from. */
async function readStates(page, theme, route) {
  await page.evaluate((settings) => globalThis.__theme.applyTheme(settings), themeSettings(theme));

  const signature = async (selector) => page.$eval(selector, signatureOf).catch(() => null);

  const rowResting = await signature(ROW);
  await page.hover(ROW);
  const rowHovered = await signature(ROW);
  await page.mouse.move(0, 0);

  const actionResting = await signature(ACTION);
  await page.hover(ACTION);
  const actionHovered = await signature(ACTION);
  await page.mouse.move(0, 0);

  const searchResting = await signature(SEARCH);
  await page.focus('[data-testid="SearchBox_Search_Input"]');
  const searchFocused = await signature(SEARCH);
  await page.evaluate(() => document.activeElement?.blur());

  const filtered = await page.evaluate(() => {
    const article = document.querySelector('article[data-testid="tweet"]');
    const before = article.getAttribute("style");
    article.setAttribute("style", "opacity: 0.36; filter: grayscale(0.5);");
    const style = getComputedStyle(article);
    const after = [style.opacity, style.filter].join("|");
    if (before === null) article.removeAttribute("style");
    else article.setAttribute("style", before);
    const resting = getComputedStyle(article);
    return { filtered: after, resting: [resting.opacity, resting.filter].join("|") };
  });

  const pairs = {
    "a hovered row": [rowResting, rowHovered],
    "a hovered media action": [actionResting, actionHovered],
    "a focused search field": [searchResting, searchFocused],
    "a filtered post": [filtered.resting, filtered.filtered],
    "an active navigation item": [await signature(NAV_RESTING), await signature(NAV_ACTIVE)]
  };
  if (route === "home") {
    pairs["a selected tab"] = [await signature(TAB_RESTING), await signature(TAB_SELECTED)];
  }
  return pairs;
}

test("every authored palette keeps its states distinguishable in forced colors", async () => {
  const themeBundle = await bundleTheme();

  for (const route of ["home", "status"]) {
    const { context, page } = await openThemedRoute(route, themeBundle);
    try {
      const confirmedForced = await page.evaluate(() => matchMedia("(forced-colors: active)").matches);
      assert.equal(confirmedForced, true, "the harness must actually be in forced-colors mode");

      for (const theme of PALETTES) {
        const pairs = await readStates(page, theme, route);
        for (const [label, [resting, active]] of Object.entries(pairs)) {
          assert.ok(resting !== null && active !== null, `${theme} on ${route}: ${label} was not found`);
          assert.notEqual(
            active,
            resting,
            `${theme} on ${route}: ${label} is indistinguishable from the resting state`
          );
        }
      }

      // Off paints none of these rules, so it makes no claim to check. What it must not do is
      // introduce a shadow or a gradient of its own.
      await page.evaluate((settings) => globalThis.__theme.applyTheme(settings), themeSettings("off"));
      assert.deepEqual(await lostAffordances(page), [], "Off must not add a shadow-only affordance");
    } finally {
      await context.close();
    }
  }
});

test("removing one restoring border makes the sweep stop finding a difference", async () => {
  // The positive control. Without it, "every state differs" could mean the rules work or could
  // mean the comparison cannot tell anything apart. Each rule below is deleted in turn by an
  // override that puts the state back exactly where forced colors left it.
  const themeBundle = await bundleTheme();
  const removals = {
    "a hovered row": `@media (forced-colors: active) { html[data-av-theme] [data-testid="cellInnerDiv"] > div:hover { outline: none !important; } }`,
    "a selected tab": `@media (forced-colors: active) { html[data-av-theme] [data-testid="primaryColumn"] [role="tab"][aria-selected="true"] { border-bottom-width: 0 !important; border-bottom-style: none !important; } }`,
    "an active navigation item": `@media (forced-colors: active) { html[data-av-theme] [data-testid^="AppTabBar_"][aria-current="page"] { outline: none !important; } }`,
    "a focused search field": `@media (forced-colors: active) { html[data-av-theme] form[role="search"]:has([data-testid="SearchBox_Search_Input"]):focus-within { outline: none !important; } }`
  };

  for (const [label, removal] of Object.entries(removals)) {
    const { context, page } = await openThemedRoute("home", themeBundle, removal);
    try {
      const pairs = await readStates(page, "noir", "home");
      const [resting, active] = pairs[label];
      assert.equal(
        active,
        resting,
        `deleting the rule for ${label} must make it indistinguishable again, or the sweep proves nothing`
      );
    } finally {
      await context.close();
    }
  }
});

/** Every element the themed page draws, so a shadow or gradient cannot hide in a corner. */
async function lostAffordances(page) {
  return page.evaluate(() => {
    const found = [];
    for (const node of document.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      if (style.boxShadow && style.boxShadow !== "none") found.push(`shadow:${node.tagName}`);
      const image = style.backgroundImage;
      if (image && image !== "none" && !image.includes("url(")) found.push(`image:${node.tagName}`);
    }
    return found;
  });
}

async function bundleTheme() {
  const entry = path.join(temp, "theme-entry.ts");
  await writeFile(
    entry,
    `export { applyTheme, themeFeature, THEME_CSS } from ${JSON.stringify(abs("src/features/appearance/theme.ts"))};`,
    "utf8"
  );
  const outfile = path.join(temp, "theme-bundle.js");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    globalName: "__theme",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  return readFile(outfile, "utf8");
}
