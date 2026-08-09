import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-grok-declutter-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { layoutDeclutterFeature } from ${JSON.stringify(abs("src/features/layout/declutter.ts"))};
export { getSelectorHealth } from ${JSON.stringify(abs("src/platform/selectors.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryGrok",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("Hide Grok covers current navigation and per-post actions without hiding neighbors", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const drawer = document.createElement("aside");
    drawer.setAttribute("data-testid", "GrokDrawer");
    const imageGen = document.createElement("button");
    imageGen.setAttribute("data-testid", "grokImgGen");
    const nav = document.createElement("a");
    nav.href = "/i/grok";
    nav.textContent = "Grok";
    const home = document.createElement("a");
    home.href = "/home";
    home.textContent = "Home";
    const grokAction = document.createElement("button");
    grokAction.setAttribute("aria-label", "Grok actions");
    const like = document.createElement("button");
    like.setAttribute("aria-label", "Like");
    document.body.append(drawer, imageGen, nav, home, grokAction, like);

    const context = {
      settings: {
        layout: {
          hideGrok: true,
          hideRightSidebar: false,
          hideTrends: false,
          hideNavItems: [],
          writerMode: false
        }
      },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    const feature = AviaryGrok.layoutDeclutterFeature;
    feature.init(context);
    const hidden = [drawer, imageGen, nav, home, grokAction, like].map(
      (node) => getComputedStyle(node).display
    );
    const health = AviaryGrok.getSelectorHealth(document).find((item) => item.surface === "Grok");

    context.settings.layout.hideGrok = false;
    feature.apply(context, document);
    const restored = [drawer, imageGen, nav, home, grokAction, like].map(
      (node) => getComputedStyle(node).display
    );
    await feature.destroy(context);
    const afterDestroy = {
      classPresent: document.documentElement.classList.contains("av-hide-grok"),
      stylePresent: document.getElementById("av-layout-declutter") !== null,
      nav: getComputedStyle(nav).display,
      grokAction: getComputedStyle(grokAction).display
    };
    return { hidden, restored, health, afterDestroy };
  });

  assert.deepEqual(result.hidden, ["none", "none", "none", "inline", "none", "inline-block"]);
  assert.equal(result.health.stableCount, 4);
  assert.equal(result.health.healthy, true);
  assert.deepEqual(result.restored, ["block", "inline-block", "inline", "inline", "inline-block", "inline-block"]);
  assert.deepEqual(result.afterDestroy, {
    classPresent: false,
    stylePresent: false,
    nav: "inline",
    grokAction: "inline-block"
  });
});
