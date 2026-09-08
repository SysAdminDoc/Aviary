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
