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

/**
 * Hover-only surfaces, suppressed without touching anything a click or a screen reader uses.
 *
 * X opens a profile card or a visual tooltip when the pointer rests on a name, avatar or control,
 * and the browser draws its own bubble for a native title. The first two are portals CSS can
 * reach; the third is drawn by the browser, so the attribute has to come off. It is parked rather
 * than dropped, because turning the setting off has to give X back exactly what it wrote.
 */
test("suppressing hover previews hides X hover portals and native titles, reversibly", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();

    const hoverCard = document.createElement("div");
    hoverCard.setAttribute("data-testid", "hoverCardParent");
    hoverCard.textContent = "Profile card";
    const tooltip = document.createElement("div");
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = "Follow";

    // A click-opened menu must survive: it is not a hover surface.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.textContent = "More";
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.textContent = "Compose";

    const titled = document.createElement("button");
    titled.setAttribute("title", "Verified account");
    titled.setAttribute("aria-label", "Verified account");
    titled.setAttribute("aria-describedby", "hint");
    titled.textContent = "Northline";

    document.body.append(hoverCard, tooltip, menu, dialog, titled);

    const context = {
      settings: {
        layout: {
          hideGrok: false,
          hideRightSidebar: false,
          hideTrends: false,
          hideNavItems: [],
          writerMode: false,
          suppressHoverPreviews: true
        }
      },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    const feature = AviaryGrok.layoutDeclutterFeature;

    // Count pointer listeners: this must be CSS and attributes only, so a touch-only session
    // gains nothing. Patching addEventListener is the only way to see them from here.
    const pointerEvents = [];
    const nativeAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (/^(pointer|mouse)/.test(type) || type === "mouseover" || type === "hover") {
        pointerEvents.push(type);
      }
      return nativeAdd.call(this, type, ...rest);
    };
    feature.init(context);
    EventTarget.prototype.addEventListener = nativeAdd;

    const suppressed = {
      hoverCard: getComputedStyle(hoverCard).display,
      tooltip: getComputedStyle(tooltip).display,
      menu: getComputedStyle(menu).display,
      dialog: getComputedStyle(dialog).display,
      title: titled.getAttribute("title"),
      ariaLabel: titled.getAttribute("aria-label"),
      ariaDescribedBy: titled.getAttribute("aria-describedby"),
      text: titled.textContent,
      pointerEvents: [...pointerEvents]
    };

    // A portal X inserts after the fact is covered by the next apply, still with no listener.
    const lateCard = document.createElement("div");
    lateCard.setAttribute("data-testid", "hoverCardParent");
    const lateTitled = document.createElement("button");
    lateTitled.setAttribute("title", "Joined 2019");
    document.body.append(lateCard, lateTitled);
    feature.apply(context, document);
    const late = {
      card: getComputedStyle(lateCard).display,
      title: lateTitled.getAttribute("title")
    };

    // Turning it off gives X back its own text and stops suppressing.
    context.settings.layout.suppressHoverPreviews = false;
    feature.apply(context, document);
    const restored = {
      hoverCard: getComputedStyle(hoverCard).display,
      tooltip: getComputedStyle(tooltip).display,
      title: titled.getAttribute("title"),
      lateTitle: lateTitled.getAttribute("title"),
      stash: document.querySelectorAll("[data-av-title]").length
    };

    context.settings.layout.suppressHoverPreviews = true;
    feature.apply(context, document);
    await feature.destroy(context);
    const afterDestroy = {
      classPresent: document.documentElement.classList.contains("av-suppress-hover"),
      hoverCard: getComputedStyle(hoverCard).display,
      title: titled.getAttribute("title"),
      stash: document.querySelectorAll("[data-av-title]").length
    };

    return { suppressed, late, restored, afterDestroy };
  });

  assert.equal(result.suppressed.hoverCard, "none", "the profile card was still shown");
  assert.equal(result.suppressed.tooltip, "none", "the visual tooltip was still shown");
  assert.notEqual(result.suppressed.menu, "none", "a click-opened menu must not be suppressed");
  assert.notEqual(result.suppressed.dialog, "none", "a dialog must not be suppressed");
  assert.equal(result.suppressed.title, null, "the native title bubble was left in place");
  assert.equal(
    result.suppressed.ariaLabel,
    "Verified account",
    "the accessible name must survive"
  );
  assert.equal(result.suppressed.ariaDescribedBy, "hint", "the description link must survive");
  assert.equal(result.suppressed.text, "Northline", "the visible label must survive");
  assert.deepEqual(
    result.suppressed.pointerEvents,
    [],
    "suppression must not register pointer listeners, or a touch-only session pays for it"
  );

  assert.equal(result.late.card, "none", "a later hover portal was not covered");
  assert.equal(result.late.title, null, "a later native title was not removed");

  assert.notEqual(result.restored.hoverCard, "none", "disabling did not stop suppressing");
  assert.notEqual(result.restored.tooltip, "none", "disabling did not stop suppressing");
  assert.equal(result.restored.title, "Verified account", "X own title was not given back");
  assert.equal(result.restored.lateTitle, "Joined 2019", "a later title was not given back");
  assert.equal(result.restored.stash, 0, "the stash must be emptied when it is restored");

  assert.equal(result.afterDestroy.classPresent, false);
  assert.notEqual(result.afterDestroy.hoverCard, "none", "destroy left hover portals suppressed");
  assert.equal(result.afterDestroy.title, "Verified account", "destroy did not restore the title");
  assert.equal(result.afterDestroy.stash, 0, "destroy left a stashed title behind");
});
