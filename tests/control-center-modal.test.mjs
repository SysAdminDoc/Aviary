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
      title: launcher.getAttribute("title"),
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
    title: null,
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

/**
 * A closed panel must not be on screen.
 *
 * The Popover API hides a closed popover through the UA-origin rule
 * `[popover]:not(:popover-open) { display: none }`, and `.av-panel` sets `display: flex` in the
 * author sheet -- which wins. v1.45.0 shipped with the closed panel laid out full-screen on every
 * page load and `inert` keeping it dead to input, so the settings window covered X and could not
 * be dismissed. Every other assertion in this file drives the panel open first, which is exactly
 * why none of them saw it. This one measures the state the user actually loads into.
 */
test("a closed Control Center is not rendered, and opening then closing restores that", async () => {
  const states = await page.evaluate(async () => {
    const settings = AviaryModal.cloneSettings(AviaryModal.DEFAULT_SETTINGS);
    globalThis.__modalHandle = AviaryModal.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    const panel = shadow.querySelector(".av-panel");
    const read = () => {
      const rect = panel.getBoundingClientRect();
      return {
        display: getComputedStyle(panel).display,
        area: Math.round(rect.width) * Math.round(rect.height),
        popoverOpen: panel.matches(":popover-open")
      };
    };
    const onMount = read();
    shadow.querySelector(".av-launcher").click();
    const afterOpen = read();
    shadow.querySelector(".av-launcher").click();
    const afterClose = read();
    globalThis.__modalHandle?.destroy();
    delete globalThis.__modalHandle;
    return { onMount, afterOpen, afterClose };
  });

  assert.deepEqual(states.onMount, { display: "none", area: 0, popoverOpen: false });
  assert.equal(states.afterOpen.display, "flex");
  assert.ok(states.afterOpen.area > 0, `an opened panel must have a box, got ${states.afterOpen.area}`);
  assert.equal(states.afterOpen.popoverOpen, true);
  assert.deepEqual(states.afterClose, { display: "none", area: 0, popoverOpen: false });
});

/**
 * A host with the popover selector but no showPopover must not swallow the panel.
 *
 * Three places carried a comment saying the surface "remains usable in a test host that exposes
 * the attribute but not the methods". Once the closed state was hidden by `:not(:popover-open)`
 * that stopped being true, and for the panel it was the worst possible end state: the rule hides
 * it, `inert` is on <body>, focus is inside, and the only way out is a UA light-dismiss that
 * cannot fire because nothing was ever shown as a popover.
 *
 * No shipping engine is in that shape. This pins the behaviour anyway, because the code asserted
 * the opposite in three places and now has to earn it.
 */
test("a host without showPopover still shows the panel rather than trapping the page", async () => {
  const result = await page.evaluate(() => {
    document.querySelector("#av-control-center")?.remove();
    document.body.removeAttribute("inert");

    const showPopover = HTMLElement.prototype.showPopover;
    const hidePopover = HTMLElement.prototype.hidePopover;
    // Present, and throwing: the selector still parses, so the closed-state rule still applies.
    HTMLElement.prototype.showPopover = function () {
      throw new Error("not supported in this host");
    };
    HTMLElement.prototype.hidePopover = function () {
      throw new Error("not supported in this host");
    };

    try {
      const settings = AviaryModal.cloneSettings(AviaryModal.DEFAULT_SETTINGS);
      const handle = AviaryModal.mountControlCenter({
        settings,
        diagnostics: () => [],
        onChange: async () => {},
        onError: () => {}
      });
      const shadow = document.querySelector("#av-control-center").shadowRoot;
      const panel = shadow.querySelector(".av-panel");
      shadow.querySelector(".av-launcher").click();

      const opened = {
        display: getComputedStyle(panel).display,
        width: panel.getBoundingClientRect().width > 0,
        bodyInert: document.body.hasAttribute("inert")
      };

      shadow.querySelector(".av-launcher").click();
      const closed = {
        display: getComputedStyle(panel).display,
        bodyInert: document.body.hasAttribute("inert")
      };

      handle?.destroy?.();
      return { opened, closed };
    } finally {
      HTMLElement.prototype.showPopover = showPopover;
      HTMLElement.prototype.hidePopover = hidePopover;
      document.querySelector("#av-control-center")?.remove();
      document.body.removeAttribute("inert");
    }
  });

  assert.notEqual(
    result.opened.display,
    "none",
    "the panel was made inert and given focus, so it must also be visible"
  );
  assert.equal(result.opened.width, true, "and it must have a box, not a zero-sized one");
  assert.equal(result.opened.bodyInert, true, "the page behind it is still held back");

  // Closing puts it back: the escape hatch is not a permanent override.
  assert.equal(result.closed.display, "none");
  assert.equal(result.closed.bodyInert, false, "and the page is usable again");
});
