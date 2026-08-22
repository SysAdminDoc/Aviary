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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-first-run-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { firstRunFeature, resetFirstRunGuard, FIRST_RUN_KEY } from ${JSON.stringify(abs("src/features/core/first-run.ts"))};
export { DEFAULT_SETTINGS, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryFirstRun",
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

async function run({ freshInstall = true, stored = undefined, failStorage = false } = {}) {
  return page.evaluate(
    async ({ freshInstall, stored, failStorage }) => {
      document.getElementById("av-first-run")?.remove();
      AviaryFirstRun.resetFirstRunGuard();
      const writes = [];
      const warnings = [];
      const ctx = {
        freshInstall,
        settings: AviaryFirstRun.normalizeSettings({}),
        storage: {
          async get(key, fallback) {
            if (failStorage) throw new Error("storage down");
            return key === AviaryFirstRun.FIRST_RUN_KEY && stored !== undefined ? stored : fallback;
          },
          async set(key, value) {
            if (failStorage) throw new Error("storage down");
            writes.push([key, value]);
          }
        },
        diagnostics: { info() {}, warn: (m) => warnings.push(m), error() {} }
      };
      await AviaryFirstRun.firstRunFeature.init(ctx);
      const host = document.getElementById("av-first-run");
      const text = host?.shadowRoot?.textContent ?? "";
      const result = {
        mounted: Boolean(host),
        text,
        role: host?.shadowRoot?.querySelector(".card")?.getAttribute("role") ?? null
      };
      host?.shadowRoot?.querySelector("button")?.click();
      // The write is fire-and-forget; give it a turn to settle.
      await Promise.resolve();
      await Promise.resolve();
      result.dismissed = document.getElementById("av-first-run") === null;
      result.writes = writes;
      result.warnings = warnings;
      return result;
    },
    { freshInstall, stored, failStorage }
  );
}

test("a fresh install is told exactly what is already on and where settings live", async () => {
  const result = await run();
  assert.equal(result.mounted, true);
  assert.equal(result.role, "status", "a passive notice must not steal focus like an alert");
  assert.match(result.text, /Sponsored posts/, "must name the ad protection that is already on");
  assert.match(result.text, /download control/, "must name the media controls that are already on");
  assert.match(result.text, /left navigation/, "must say where the settings entry is");
});

test("dismissing removes it and records the acknowledgement", async () => {
  const result = await run();
  assert.equal(result.dismissed, true);
  assert.deepEqual(result.writes, [
    [ "aviary.firstRun.v1", { version: 1, acknowledged: true } ]
  ]);
});

test("an acknowledged profile never sees it again", async () => {
  const result = await run({ stored: { version: 1, acknowledged: true } });
  assert.equal(result.mounted, false);
});

test("an upgrading install never sees it", async () => {
  // Existing users already know what Aviary does; a "here is what is on" notice would be noise.
  const result = await run({ freshInstall: false });
  assert.equal(result.mounted, false);
});

test("a storage failure suppresses the notice instead of repeating it every load", async () => {
  const result = await run({ failStorage: true });
  assert.equal(result.mounted, false, "an unreadable marker must not mean an unskippable notice");
});

