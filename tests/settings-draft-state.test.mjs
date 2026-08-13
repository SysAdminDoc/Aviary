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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-drafts-"));
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
    globalName: "AviaryDrafts",
    platform: "browser",
    target: "es2022",
    define: { __AVIARY_VERSION__: JSON.stringify("test") },
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("draft settings stay visible, survive another row save, and block destructive navigation", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryDrafts.cloneSettings(AviaryDrafts.DEFAULT_SETTINGS);
    let saves = 0;
    const handle = AviaryDrafts.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {
        saves += 1;
      },
      onError: () => undefined
    });
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="integrations"]').click();

    const row = (label) =>
      [...shadow.querySelectorAll(".av-row")].find(
        (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
      );
    const input = (label) => row(label)?.querySelector("input");
    const save = (label) => row(label)?.querySelector("button:last-of-type");
    const write = (control, value) => {
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    const endpoint = input("Aria2 endpoint");
    const secret = input("Aria2 RPC secret");
    write(endpoint, "http://localhost:6800");
    write(secret, "secret-draft");
    const dirty = {
      text: shadow.querySelector(".av-status").textContent,
      state: shadow.querySelector(".av-status").dataset.state
    };

    save("Aria2 endpoint").click();
    await settle();
    const afterFirstSave = {
      secret: input("Aria2 RPC secret").value,
      status: shadow.querySelector(".av-status").textContent,
      section: shadow.querySelector(".av-section").dataset.avSection
    };

    save("Aria2 RPC secret").click();
    await settle();
    const afterSecondSave = {
      endpoint: input("Aria2 endpoint").value,
      secret: input("Aria2 RPC secret").value,
      state: shadow.querySelector(".av-status").dataset.state,
      settingsEndpoint: settings.integrations.aria2.endpoint,
      settingsSecret: settings.integrations.aria2.secret
    };

    const endpointAgain = input("Aria2 endpoint");
    write(endpointAgain, "http://dirty.example");
    shadow.querySelector('[data-av-section="layout"]').click();
    const blockedNavigation = {
      section: shadow.querySelector(".av-section").dataset.avSection,
      status: shadow.querySelector(".av-status").textContent,
      focused: shadow.activeElement?.getAttribute("aria-label")
    };

    write(endpointAgain, "http://localhost:6800");
    shadow.querySelector('[data-av-section="layout"]').click();
    const afterRevert = {
      section: shadow.querySelector(".av-section").dataset.avSection,
      state: shadow.querySelector(".av-status").dataset.state,
      groups: [...shadow.querySelectorAll(".av-group-title")].map((node) => node.textContent)
    };
    handle.destroy();
    return { dirty, afterFirstSave, afterSecondSave, blockedNavigation, afterRevert, saves };
  });

  assert.deepEqual(result.dirty, { text: "Unsaved changes", state: "dirty" });
  assert.equal(result.afterFirstSave.secret, "secret-draft");
  assert.equal(result.afterFirstSave.status, "Unsaved changes");
  assert.equal(result.afterFirstSave.section, "integrations");
  assert.deepEqual(result.afterSecondSave, {
    endpoint: "http://localhost:6800",
    secret: "secret-draft",
    state: "saved",
    settingsEndpoint: "http://localhost:6800",
    settingsSecret: "secret-draft"
  });
  assert.equal(result.saves, 2);
  assert.equal(result.blockedNavigation.section, "integrations");
  assert.match(result.blockedNavigation.status, /Save or revert/);
  assert.equal(result.blockedNavigation.focused, "Aria2 endpoint");
  assert.equal(result.afterRevert.section, "layout");
  assert.equal(result.afterRevert.state, "saved");
  assert.deepEqual(result.afterRevert.groups, ["Ad protection", "Page chrome", "Reading flow", "Navigation"]);
});
