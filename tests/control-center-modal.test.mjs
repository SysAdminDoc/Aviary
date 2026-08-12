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
    const handle = AviaryModal.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    const host = document.querySelector("#av-control-center");
    const shadow = host.shadowRoot;
    const launcher = shadow.querySelector(".av-launcher");
    const overlay = shadow.querySelector(".av-overlay");
    const panel = shadow.querySelector(".av-panel");
    launcher.click();
    const opened = {
      modal: panel.getAttribute("aria-modal"),
      labelledBy: panel.getAttribute("aria-labelledby"),
      bodyInert: document.body.hasAttribute("inert"),
      pointerEvents: getComputedStyle(overlay).pointerEvents,
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
  assert.equal(result.opened.bodyInert, true);
  assert.equal(result.opened.pointerEvents, "auto");
  assert.equal(result.opened.focus, "av-panel");
  assert.equal(result.focusStayedInside, true);

  await page.keyboard.press("Tab");
  const wrappedForward = await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    const panel = shadow.querySelector(".av-panel");
    return shadow.activeElement === panel.querySelector("button, input, select, textarea, a[href]");
  });
  assert.equal(wrappedForward, true);

  await page.keyboard.press("Escape");
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
    shadow.querySelector(".av-overlay").click();
  });
  assert.equal(
    await page.evaluate(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-overlay").getAttribute("aria-hidden")),
    "true"
  );
  await page.evaluate(() => document.querySelector("#av-control-center")?.remove());
});
