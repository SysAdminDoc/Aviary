import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Every panel action that changes settings goes through `ctx.saveSettings`.
 *
 * The old form indexed into `control-center.ts` looking for `async importSettings(` and then
 * regex-matched the next 900 characters for `ctx.saveSettings()`. That passes for a call on a
 * branch that never runs, breaks when a handler grows past 900 characters, and cannot see a
 * fourth handler nobody remembered to add to the list. Here the handlers are called and both the
 * choke point and the direct storage gateway are watched.
 *
 * It matters because the choke point is where normalization happens: a second write path is a
 * second set of guarantees, and the weaker one wins whenever it is the one that ran.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-choke-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { controlCenterFeature } from ${JSON.stringify(abs("src/features/core/control-center.ts"))};`,
      `export { DEFAULT_SETTINGS, SETTINGS_KEY, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryChoke",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Mounts the Control Center feature with a context that records both routes to persistence, and
 * runs `work` against the panel handle the feature built.
 */
async function withPanel(work) {
  return page.evaluate(async (body) => {
    document.getElementById("av-control-center")?.remove();
    const settings = AviaryChoke.cloneSettings(AviaryChoke.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";

    const calls = { saveSettings: 0, directWrites: [] };
    const values = new Map();
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage: {
        async get(key, fallback) {
          return values.has(key) ? structuredClone(values.get(key)) : fallback;
        },
        async set(key, value) {
          // The panel is allowed its own keys; what it must not do is write the settings key.
          if (key === AviaryChoke.SETTINGS_KEY) calls.directWrites.push(key);
          values.set(key, structuredClone(value));
        },
        async remove(key) {
          values.delete(key);
        }
      },
      auditLog: {
        records: [],
        snapshot: () => ({ entries: [] }),
        size: () => 0,
        async clear() {},
        async record(action, detail) {
          this.records.push({ action, detail });
        }
      },
      diagnostics: { info() {}, warn() {}, error() {} },
      async saveSettings() {
        calls.saveSettings++;
      },
      requestApply() {}
    };

    await AviaryChoke.controlCenterFeature.init(ctx);
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();

    const result = await (0, eval)(`(${body})`)({ ctx, shadow, calls, settings });
    await AviaryChoke.controlCenterFeature.destroy(ctx);
    return result;
  }, work.toString());
}

test("applying a preset from the panel persists through the choke point, not around it", async () => {
  const result = await withPanel(async ({ ctx, shadow, calls }) => {
    shadow.querySelector('.av-nav-item[data-av-section="presets"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const card = shadow.querySelector(".av-preset-card");
    if (!card) return { missing: true };
    const before = ctx.settings.appearance.theme;
    card.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      saveSettings: calls.saveSettings,
      directWrites: calls.directWrites,
      changed: ctx.settings.appearance.theme !== before || ctx.settings.layout.hideRightSidebar !== false,
      audit: ctx.auditLog.records.map((entry) => entry.action)
    };
  });

  assert.ok(!result.missing, "the preset board is not rendering cards");
  assert.ok(result.saveSettings >= 1, "applying a preset must persist through ctx.saveSettings");
  assert.deepEqual(result.directWrites, [], "the panel must not write the settings key itself");
  assert.equal(result.changed, true, "applying a preset must actually change settings");
  // Filed under its own label. It used to be recorded as the nearest available action, which put
  // a preset application in the user-facing log as something else entirely.
  assert.ok(result.audit.includes("preset.apply"), `audit recorded ${JSON.stringify(result.audit)}`);
});

test("changing the panel language persists through the choke point", async () => {
  const result = await withPanel(async ({ ctx, shadow, calls }) => {
    shadow.querySelector('.av-nav-item[data-av-section="presets"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const row = [...shadow.querySelectorAll(".av-row")].find(
      (candidate) => candidate.dataset.avLabel === "Locale"
    );
    if (!row) return { missing: true };
    const select = row.querySelector("select");
    select.value = "ja";
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Panel controls stage into a draft; the transaction bar is what commits them.
    shadow.querySelector(".av-transaction-save").click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      saveSettings: calls.saveSettings,
      directWrites: calls.directWrites,
      locale: ctx.settings.i18n.locale
    };
  });

  assert.ok(!result.missing, "the panel offers no language control");
  assert.equal(result.locale, "ja", "the choice must reach settings");
  assert.ok(result.saveSettings >= 1, "a locale change must persist through ctx.saveSettings");
  assert.deepEqual(result.directWrites, []);
});

test("importing settings persists through the choke point and reports what it took", async () => {
  const result = await withPanel(async ({ ctx, shadow, calls }) => {
    // Import is the panel's widest write: a whole settings object out of a file the user chose.
    shadow.querySelector('.av-nav-item[data-av-section="backup"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const row = [...shadow.querySelectorAll(".av-row")].find(
      (candidate) => candidate.dataset.avLabel === "Import settings (JSON)"
    );
    if (!row) {
      return {
        missing: true,
        labels: [...shadow.querySelectorAll(".av-row")].map((candidate) => candidate.dataset.avLabel)
      };
    }

    const textarea = row.querySelector("textarea");
    textarea.value = JSON.stringify({
      generator: "Aviary",
      version: 1,
      settings: { appearance: { theme: "graphite" }, layout: { hideTrends: true } }
    });
    textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    // This row commits on its own Import button rather than through the transaction bar: an
    // import replaces everything, so it is not something to stage alongside other edits.
    row.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 150));

    return {
      saveSettings: calls.saveSettings,
      directWrites: calls.directWrites,
      theme: ctx.settings.appearance.theme,
      hideTrends: ctx.settings.layout.hideTrends,
      status: shadow.querySelector(".av-status")?.textContent ?? ""
    };
  });

  assert.ok(!result.missing, `the panel offers no way to import a settings file; saw ${JSON.stringify(result.labels)}`);
  assert.equal(result.theme, "graphite", "the imported value must reach settings");
  assert.equal(result.hideTrends, true);
  assert.ok(result.saveSettings >= 1, "an import must persist through ctx.saveSettings");
  assert.deepEqual(result.directWrites, [], "and must not write the settings key directly");
  assert.match(result.status, /imported/i, "the panel must say what it did");
});
