import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let mod;
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-focus-mode-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { focusModeFeature, resetFocusModeState, withinWindow, parseTime, minutesOfDay } from ${JSON.stringify(abs("src/features/layout/focus-mode.ts"))};
export { normalizeSettings, DEFAULT_SETTINGS } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );

  const esm = path.join(temp, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile: esm,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  mod = await import(pathToFileURL(esm).href);

  const iife = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: iife,
    bundle: true,
    format: "iife",
    globalName: "AviaryFocus",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: iife });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("a window that wraps midnight is a real window, not an empty one", () => {
  // 22:00-02:00 is the shape most evening limits take. Treating start > end as empty would
  // silently allow nothing, which is the opposite of what the user asked for.
  const start = 22 * 60;
  const end = 2 * 60;
  assert.equal(mod.withinWindow(23 * 60, start, end), true, "23:00 is inside 22:00-02:00");
  assert.equal(mod.withinWindow(1 * 60, start, end), true, "01:00 is inside");
  assert.equal(mod.withinWindow(12 * 60, start, end), false, "midday is outside");
});

test("an ordinary window includes its start and excludes its end", () => {
  const start = 9 * 60;
  const end = 18 * 60;
  assert.equal(mod.withinWindow(start, start, end), true);
  assert.equal(mod.withinWindow(end, start, end), false);
  assert.equal(mod.withinWindow(8 * 60 + 59, start, end), false);
  assert.equal(mod.withinWindow(17 * 60 + 59, start, end), true);
});

test("identical start and end means always allowed, never always blocked", () => {
  assert.equal(mod.withinWindow(0, 600, 600), true);
  assert.equal(mod.withinWindow(1439, 600, 600), true);
});

test("only real 24-hour times parse", () => {
  assert.equal(mod.parseTime("09:00"), 540);
  assert.equal(mod.parseTime("23:59"), 1439);
  for (const bad of ["", "9", "24:00", "12:60", "noon", "9:0", "-1:00"]) {
    assert.equal(mod.parseTime(bad), null, `${bad} must not parse`);
  }
});

test("an unreadable window falls back rather than locking anyone out", () => {
  const settings = mod.normalizeSettings({
    layout: { focusMode: true, focusStart: "nonsense", focusEnd: "25:99" }
  });
  assert.equal(settings.layout.focusStart, mod.DEFAULT_SETTINGS.layout.focusStart);
  assert.equal(settings.layout.focusEnd, mod.DEFAULT_SETTINGS.layout.focusEnd);
});

async function runPanel({ focusStart, focusEnd, enabled = true, override = false }) {
  return page.evaluate(
    async ({ focusStart, focusEnd, enabled, override }) => {
      AviaryFocus.resetFocusModeState();
      document.body.innerHTML = '<div data-testid="primaryColumn"><div id="feed">timeline</div></div>';
      const settings = AviaryFocus.normalizeSettings({
        layout: { focusMode: enabled, focusStart, focusEnd }
      });
      const ctx = {
        settings,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      AviaryFocus.focusModeFeature.init(ctx);

      const state = () => ({
        panel: document.getElementById("av-focus-mode") !== null,
        blurred: getComputedStyle(document.getElementById("feed")).filter
      });
      const covered = state();

      if (override) {
        document.getElementById("av-focus-mode").shadowRoot.querySelector("button").click();
      }
      const afterOverride = state();

      AviaryFocus.focusModeFeature.destroy(ctx);
      const afterDestroy = state();
      return { covered, afterOverride, afterDestroy };
    },
    { focusStart, focusEnd, enabled, override }
  );
}

// A window that cannot contain "now" whatever the clock says, and one that always does.
const ALWAYS_OUTSIDE = () => {
  const now = new Date();
  const start = (now.getHours() + 2) % 24;
  const end = (now.getHours() + 3) % 24;
  return { focusStart: `${String(start).padStart(2, "0")}:00`, focusEnd: `${String(end).padStart(2, "0")}:00` };
};

test("outside the window the reading column is covered, and the override clears it", async () => {
  const { covered, afterOverride, afterDestroy } = await runPanel({
    ...ALWAYS_OUTSIDE(),
    override: true
  });

  assert.equal(covered.panel, true, "a panel must appear outside the window");
  assert.notEqual(covered.blurred, "none", "the reading column must be covered");

  assert.equal(afterOverride.panel, false, "the override must clear the panel");
  assert.equal(afterOverride.blurred, "none", "the override must restore the column");

  assert.equal(afterDestroy.panel, false);
  assert.equal(afterDestroy.blurred, "none", "destroy must leave nothing behind");
});

test("inside the window nothing is covered", async () => {
  const { covered } = await runPanel({ focusStart: "00:00", focusEnd: "23:59" });
  assert.equal(covered.panel, false);
  assert.equal(covered.blurred, "none");
});

test("the feature is inert while off", async () => {
  const { covered } = await runPanel({ ...ALWAYS_OUTSIDE(), enabled: false });
  assert.equal(covered.panel, false);
  assert.equal(covered.blurred, "none");
});
