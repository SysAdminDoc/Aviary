import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The accessibility contract, driven rather than read.
 *
 * These assertions previously matched literal source strings — `overlay.toggleAttribute("inert",
 * !open)`, `event.key === "Escape"`, a `visibility: hidden` substring. That form fails on any
 * rename while a real regression that keeps the string passes, and it demonstrably let two defects
 * ship: a settings toggle unreadable in forced colors, and an `aria-busy` written as the empty
 * string. Nothing here reads a `.ts` file; every check mounts the panel and drives it.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let context;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-a11y-behaviour-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};
export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryA11y",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.setContent(
    "<!doctype html><meta charset=utf-8><body><a id=outside href='#'>outside</a><button id=host-button>host</button></body>"
  );
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Mounts a fresh panel and leaves it available on `window.__panel`. */
async function mount() {
  await page.evaluate(() => {
    window.__panel?.destroy?.();
    const settings = AviaryA11y.cloneSettings(AviaryA11y.DEFAULT_SETTINGS);
    window.__panel = AviaryA11y.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
  });
}

test("a closed panel is out of the tab order, not merely invisible", async () => {
  await mount();

  const closed = await page.evaluate(() => {
    const root = document.getElementById("av-control-center").shadowRoot;
    const overlay = root.querySelector(".av-overlay");
    const style = getComputedStyle(overlay);
    return {
      inert: overlay.inert === true || overlay.hasAttribute("inert"),
      visibility: style.visibility,
      pointerEvents: style.pointerEvents
    };
  });

  // `aria-hidden` over focusable descendants is the failure this guards; `inert` is what actually
  // removes them from the tab order, and visibility keeps them off the accessibility tree.
  assert.equal(closed.inert, true, "a closed overlay must be inert");
  assert.equal(closed.visibility, "hidden");
  assert.equal(closed.pointerEvents, "none");
});

test("opening moves focus into the panel and exposes it as a modal", async () => {
  await mount();

  const open = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const overlay = root.querySelector(".av-overlay");
    const panel = root.querySelector(".av-panel");
    return {
      inert: overlay.inert === true || overlay.hasAttribute("inert"),
      visibility: getComputedStyle(overlay).visibility,
      role: panel.getAttribute("role"),
      ariaModal: panel.getAttribute("aria-modal"),
      bodyInert: document.body.hasAttribute("inert"),
      focusInsidePanel: panel.contains(root.activeElement)
    };
  });

  assert.equal(open.inert, false, "an open overlay must be interactive");
  assert.equal(open.visibility, "visible");
  assert.equal(open.ariaModal, "true", "a modal must say so");
  assert.ok(open.role === "dialog" || open.role === "alertdialog", `unexpected role ${open.role}`);
  assert.equal(open.bodyInert, true, "the page behind a modal must be inert");
  assert.equal(open.focusInsidePanel, true, "focus must land inside the panel, not stay on the trigger");
});

test("Escape closes the panel and returns focus to what opened it", async () => {
  await mount();

  const result = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    const launcher = root.querySelector(".av-launcher");
    launcher.focus();
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const openedWith = root.activeElement?.className ?? "";

    root.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 220));

    const overlay = root.querySelector(".av-overlay");
    return {
      openedWith,
      closedInert: overlay.inert === true || overlay.hasAttribute("inert"),
      bodyInert: document.body.hasAttribute("inert"),
      focusReturned: root.activeElement === launcher
    };
  });

  assert.notEqual(result.openedWith, "", "the panel must take focus when it opens");
  assert.equal(result.closedInert, true, "Escape must close the panel");
  assert.equal(result.bodyInert, false, "and must release the page behind it");
  assert.equal(result.focusReturned, true, "focus must go back to the control that opened it");
});

test("focus stays inside the panel while it is open", async () => {
  await mount();

  const contained = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Anything outside the modal is inert, so it cannot take focus even when asked directly.
    document.getElementById("outside").focus();
    document.getElementById("host-button").focus();
    const panel = root.querySelector(".av-panel");
    return {
      hostFocusEscaped:
        document.activeElement !== null &&
        document.activeElement.id !== "" &&
        document.activeElement.id !== "av-control-center",
      stillInPanel: panel.contains(root.activeElement)
    };
  });

  assert.equal(contained.hostFocusEscaped, false, "an inert page must not accept focus");
  assert.equal(contained.stillInPanel, true, "focus must remain inside the open modal");
});

test("every control the panel draws has an accessible name", async () => {
  await mount();

  const unnamed = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const nameOf = (node) => {
      const labelled = node.getAttribute("aria-labelledby");
      if (labelled) {
        const target = root.getElementById?.(labelled) ?? root.querySelector(`#${CSS.escape(labelled)}`);
        if (target?.textContent?.trim()) return target.textContent.trim();
      }
      return (
        node.getAttribute("aria-label")?.trim() ||
        node.getAttribute("title")?.trim() ||
        node.textContent?.trim() ||
        // A checkbox is named by the row it sits in; the row label is its visible name.
        node.closest(".av-row")?.querySelector(".av-row-label")?.textContent?.trim() ||
        ""
      );
    };

    const missing = [];
    for (const node of root.querySelectorAll("button, select, input, textarea, a[href]")) {
      if (node.hidden || node.closest("[hidden]")) continue;
      if (!nameOf(node)) {
        missing.push(`${node.tagName.toLowerCase()}.${node.className || "(no class)"}`);
      }
    }
    return missing;
  });

  assert.deepEqual(unnamed, [], "controls without an accessible name are unusable by screen reader");
});
