import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-rtl-control-center-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
      `export { i18nFeature } from ${JSON.stringify(path.join(root, "src/features/core/i18n-feature.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`,
      `export { supportedLocales } from ${JSON.stringify(path.join(root, "src/platform/i18n.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryRTL",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the Control Center mirrors RTL direction and returns to LTR immediately", async () => {
  const result = await page.evaluate(async () => {
    const settings = AviaryRTL.cloneSettings(AviaryRTL.DEFAULT_SETTINGS);
    settings.i18n.locale = "ar";
    const context = {
      settings,
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryRTL.i18nFeature.init(context);
    const panelHandle = AviaryRTL.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      listLocales: () => AviaryRTL.supportedLocales(),
      setLocale: async (code) => {
        settings.i18n.locale = code;
      }
    });

    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    // The knob is moved by `transition: transform 140ms ease`, so a fixed sleep is a bet that the
    // renderer got 140ms of frames inside it. On a loaded machine it does not, and the computed
    // transform is read part-way through: at a 5ms wait this reads matrix(1,0,0,1,0,0) against the
    // expected -16 every time. Wait for the transitions themselves to finish instead.
    const settle = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await Promise.all(shadow.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="appearance"]').click();
    const checkbox = shadow.querySelector('.av-section input[type="checkbox"]');
    const toggle = checkbox.nextElementSibling;
    checkbox.checked = true;
    await settle();

    const snapshot = () => ({
      hostDir: host.getAttribute("dir"),
      panelDirection: getComputedStyle(shadow.querySelector(".av-panel")).direction,
      toggleTransform: getComputedStyle(toggle, "::before").transform,
      documentDir: document.documentElement.getAttribute("dir")
    });
    const arabic = snapshot();

    settings.i18n.locale = "he";
    AviaryRTL.i18nFeature.apply(context);
    await settle();
    const hebrew = snapshot();

    settings.i18n.locale = "en";
    AviaryRTL.i18nFeature.apply(context);
    await settle();
    const english = snapshot();

    panelHandle.destroy();
    AviaryRTL.i18nFeature.destroy(context);
    return { arabic, hebrew, english, hostAfterDestroy: document.getElementById("av-control-center") };
  });

  assert.deepEqual(result.arabic, {
    hostDir: "rtl",
    panelDirection: "rtl",
    toggleTransform: "matrix(1, 0, 0, 1, -16, 0)",
    documentDir: null
  });
  assert.equal(result.hebrew.hostDir, "rtl");
  assert.equal(result.hebrew.panelDirection, "rtl");
  assert.match(result.hebrew.toggleTransform, /-16/);
  assert.equal(result.english.hostDir, "ltr");
  assert.equal(result.english.panelDirection, "ltr");
  assert.equal(result.english.toggleTransform, "matrix(1, 0, 0, 1, 16, 0)");
  assert.equal(result.english.documentDir, null, "X's document direction must remain untouched");
  assert.equal(result.hostAfterDestroy, null);
});

// Motion reduction is decided in one place, prefersReducedMotion(), and stamped on the host. These
// two tests pin both halves of that: what it covers, and what it must not override.

const mountPanel = (reduceMotion) =>
  page.evaluate(async (choice) => {
    const settings = AviaryRTL.cloneSettings(AviaryRTL.DEFAULT_SETTINGS);
    if (choice) settings.accessibility.reduceMotion = choice;
    globalThis.__avMotionPanel = AviaryRTL.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      listLocales: () => AviaryRTL.supportedLocales(),
      setLocale: async () => {}
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="appearance"]').click();
  }, reduceMotion ?? null);

const unmountPanel = () =>
  page.evaluate(() => {
    globalThis.__avMotionPanel.destroy();
    delete globalThis.__avMotionPanel;
  });

// Controls the old rule never named, plus .av-launcher, which it did, as the control: a change that
// broke the stylesheet outright would fail that one too. .av-panel is not read, because it has no
// transition to stop -- the old rule named it anyway, which is part of why a hand-kept list was the
// wrong shape here.
const readDurations = () =>
  page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const of = (selector, pseudo) => {
      const element = shadow.querySelector(selector);
      if (!element) return `missing: ${selector}`;
      return getComputedStyle(element, pseudo ?? undefined).transitionDuration;
    };
    return {
      launcher: of(".av-launcher"),
      toggle: of(".av-toggle"),
      toggleKnob: of(".av-toggle", "::before"),
      button: of(".av-button"),
      row: of(".av-row")
    };
  });

const stillFor = (durations) =>
  Object.entries(durations).filter(([, value]) =>
    value.split(",").some((part) => part.trim() !== "0s")
  );

test("reduced motion stops every transition in the panel, not the three anyone listed", async () => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mountPanel();
  const moving = await readDurations();
  await unmountPanel();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await mountPanel();
  const reduced = await readDurations();
  await unmountPanel();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Without the preference these animate, which is what makes the second half mean something: a
  // selector that matched nothing would report 0s in both columns and prove nothing at all.
  for (const [name, duration] of Object.entries(moving)) {
    assert.ok(!duration.startsWith("missing:"), `${name} was not found in the panel`);
    assert.notEqual(duration, "0s", `${name} should animate when no reduction is asked for`);
  }

  assert.deepEqual(
    stillFor(reduced).map(([name]) => name),
    [],
    "these still animate under prefers-reduced-motion: reduce"
  );
});

test("an explicit 'never' keeps the animations the OS preference would have taken away", async () => {
  // The @media block this replaced could not see the setting, so a reader who had chosen "never"
  // lost their animations anyway the moment their OS asked for less motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mountPanel("never");
  const durations = await readDurations();
  const motionAttribute = await page.evaluate(
    () => document.getElementById("av-control-center").dataset.avMotion
  );
  await unmountPanel();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  assert.equal(motionAttribute, "full", "an explicit never must stamp the host as full");
  assert.equal(
    stillFor(durations).length,
    Object.keys(durations).length,
    `the OS preference overrode an explicit never: ${JSON.stringify(durations)}`
  );
});
