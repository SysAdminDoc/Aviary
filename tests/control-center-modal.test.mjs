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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-modal-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryModal",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent("<!doctype html><button id=outside>Outside</button><main>Page</main>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("Control Center behaves as a modal and restores launcher focus", async () => {
  const result = await page.evaluate(() => {
    const settings = AviaryModal.cloneSettings(AviaryModal.DEFAULT_SETTINGS);
    globalThis.__modalHandle = AviaryModal.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    const host = document.querySelector("#av-control-center");
    const shadow = host.shadowRoot;
    const launcher = shadow.querySelector(".av-launcher");
    const panel = shadow.querySelector(".av-panel");
    launcher.click();
    const opened = {
      modal: panel.getAttribute("aria-modal"),
      labelledBy: panel.getAttribute("aria-labelledby"),
      popover: panel.getAttribute("popover"),
      popoverOpen: panel.matches(":popover-open"),
      bodyInert: document.body.hasAttribute("inert"),
      pointerEvents: getComputedStyle(panel).pointerEvents,
      focus: shadow.activeElement?.className ?? ""
    };

    document.querySelector("#outside").focus();
    const focusStayedInside = shadow.activeElement === panel;

    const focusables = [...panel.querySelectorAll("button, input, select, textarea, a[href]")].filter(
      (node) => !node.disabled && node.getClientRects().length > 0
    );
    focusables.at(-1).focus();
    return {
      opened,
      focusStayedInside,
      first: focusables[0].textContent || focusables[0].getAttribute("aria-label"),
      last: focusables.at(-1).textContent || focusables.at(-1).getAttribute("aria-label")
    };
  });

  assert.equal(result.opened.modal, "true");
  assert.equal(result.opened.labelledBy, "av-control-title");
  assert.equal(result.opened.popover, "auto");
  assert.equal(result.opened.popoverOpen, true);
  assert.equal(result.opened.bodyInert, true);
  assert.equal(result.opened.pointerEvents, "auto");
  assert.equal(result.opened.focus, "av-panel");
  assert.equal(result.focusStayedInside, true);

  await page.waitForTimeout(25);
  await page.keyboard.press("Tab");
  const wrappedForward = await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    const panel = shadow.querySelector(".av-panel");
    return shadow.activeElement === panel.querySelector("button, input, select, textarea, a[href]");
  });
  assert.equal(wrappedForward, true);

  await page.waitForTimeout(25);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(25);
  const closed = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const shadow = host.shadowRoot;
    return {
      hidden: shadow.querySelector(".av-overlay").getAttribute("aria-hidden"),
      bodyInert: document.body.hasAttribute("inert"),
      focus: shadow.activeElement?.className ?? ""
    };
  });
  assert.deepEqual(closed, { hidden: "true", bodyInert: false, focus: "av-launcher" });

  await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
  });
  await page.waitForTimeout(25);
  await page.mouse.click(4, 4);
  await page.waitForTimeout(25);
  assert.equal(
    await page.evaluate(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-overlay").getAttribute("aria-hidden")),
    "true"
  );
  await page.evaluate(() => {
    globalThis.__modalHandle?.destroy();
    delete globalThis.__modalHandle;
  });
});

test("the launcher joins X's navigation, adapts to compact rails, and survives SPA replacement", async () => {
  await page.setContent(`
    <!doctype html>
    <style>
      nav { display: flex; flex-direction: column; width: 259px; color: rgb(231, 233, 234); }
      nav > a, nav > button { min-height: 58px; }
    </style>
    <nav aria-label="Primary">
      <a data-testid="AppTabBar_Home_Link" href="/home">Home</a>
      <button data-testid="AppTabBar_More_Menu" type="button">More</button>
    </nav>
    <main>Page</main>
  `);
  await page.evaluate(() => {
    globalThis.__modalHandle = AviaryModal.mountControlCenter({
      settings: AviaryModal.cloneSettings(AviaryModal.DEFAULT_SETTINGS),
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
  });
  await page.waitForFunction(() => document.querySelector('nav > #av-control-center-nav'));

  const expanded = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const fallback = host.shadowRoot.querySelector(".av-launcher");
    const navHost = document.querySelector("#av-control-center-nav");
    const launcher = navHost.shadowRoot.querySelector(".av-nav-launcher");
    const label = navHost.shadowRoot.querySelector(".av-nav-launcher-label");
    const rect = launcher.getBoundingClientRect();
    return {
      directChild: navHost.parentElement?.matches('nav[aria-label="Primary"]') ?? false,
      lastChild: navHost.parentElement?.lastElementChild === navHost,
      fallbackHidden: fallback.hidden,
      label: label.textContent,
      ariaLabel: launcher.getAttribute("aria-label"),
      compact: navHost.dataset.avCompact,
      labelDisplay: getComputedStyle(label).display,
      width: rect.width,
      height: rect.height
    };
  });
  assert.deepEqual(expanded, {
    directChild: true,
    lastChild: true,
    fallbackHidden: true,
    label: "Aviary",
    ariaLabel: "Aviary settings",
    compact: "false",
    labelDisplay: "block",
    width: 259,
    height: 58
  });

  await page.evaluate(() => {
    document.querySelector("nav").style.width = "60px";
  });
  await page.waitForFunction(() => document.querySelector("#av-control-center-nav")?.dataset.avCompact === "true");
  const compact = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center-nav");
    const shadow = host.shadowRoot;
    const rect = shadow.querySelector(".av-nav-launcher").getBoundingClientRect();
    return {
      labelDisplay: getComputedStyle(shadow.querySelector(".av-nav-launcher-label")).display,
      width: rect.width,
      height: rect.height
    };
  });
  assert.deepEqual(compact, { labelDisplay: "none", width: 60, height: 58 });

  await page.evaluate(() => {
    document
      .querySelector("#av-control-center-nav")
      .shadowRoot.querySelector(".av-nav-launcher")
      .click();
  });
  await page.waitForTimeout(25);
  assert.equal(await page.evaluate(() => document.body.hasAttribute("inert")), true);
  await page.evaluate(() => {
    document.querySelector("#av-control-center").shadowRoot.querySelector(".av-panel").focus();
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(25);
  const restored = await page.evaluate(() => {
    const navHost = document.querySelector("#av-control-center-nav");
    const launcher = navHost.shadowRoot.querySelector(".av-nav-launcher");
    return {
      documentFocus: document.activeElement === navHost,
      shadowFocus: navHost.shadowRoot.activeElement === launcher,
      expanded: launcher.getAttribute("aria-expanded")
    };
  });
  assert.deepEqual(restored, { documentFocus: true, shadowFocus: true, expanded: "false" });

  await page.evaluate(() => document.querySelector("nav").remove());
  await page.waitForFunction(() => {
    const host = document.querySelector("#av-control-center");
    return host?.shadowRoot.querySelector(".av-launcher")?.hidden === false;
  });
  assert.equal(await page.evaluate(() => Boolean(document.querySelector("#av-control-center-nav")?.isConnected)), false);

  await page.evaluate(() => {
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Primary");
    nav.style.cssText = "display:flex;flex-direction:column;width:259px";
    nav.innerHTML = '<a data-testid="AppTabBar_Home_Link" href="/home">Home</a>';
    document.body.prepend(nav);
  });
  await page.waitForFunction(() => document.querySelector('nav > #av-control-center-nav'));
  assert.equal(
    await page.evaluate(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-launcher").hidden),
    true
  );

  await page.evaluate(() => {
    globalThis.__modalHandle?.destroy();
    delete globalThis.__modalHandle;
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      panel: document.querySelector("#av-control-center"),
      launcher: document.querySelector("#av-control-center-nav")
    })),
    { panel: null, launcher: null }
  );
});
