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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-selector-health-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { selectorHealthFeature, getSelectorHealthSnapshot } from ${JSON.stringify(path.join(root, "src/features/core/selector-health.ts").replace(/\\/g, "/"))};`,
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
    globalName: "AviarySelectorHealth",
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

test("Trust shows current selector matches and clears a required-surface warning live", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const app = document.createElement("div");
    app.id = "react-root";
    const primary = document.createElement("main");
    primary.setAttribute("data-testid", "primaryColumn");
    const nav = document.createElement("a");
    nav.setAttribute("data-testid", "AppTabBar_Home");
    app.append(primary, nav);
    document.body.append(app);

    const settings = AviarySelectorHealth.cloneSettings(AviarySelectorHealth.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    const context = {
      route: { surface: "home" },
      settings,
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviarySelectorHealth.selectorHealthFeature.init(context);
    AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    const panel = AviarySelectorHealth.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getSelectorHealth: () => AviarySelectorHealth.getSelectorHealthSnapshot()
    });
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="trust"]').click();

    const read = (label) =>
      [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === label)
        ?.querySelector(".av-row-description")?.textContent ?? null;
    const initial = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      summary: read("Selector health"),
      matches: read("Selector matches")
    };

    primary.remove();
    AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    shadow.querySelector(".av-panel").focus();
    panel.refresh();
    const degraded = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      summary: read("Selector health"),
      missing: read("Missing required surfaces"),
      affected: read("Affected features")
    };

    app.append(primary);
    AviarySelectorHealth.selectorHealthFeature.apply(context, document);
    shadow.querySelector(".av-panel").focus();
    panel.refresh();
    const restored = {
      snapshot: AviarySelectorHealth.getSelectorHealthSnapshot(),
      summary: read("Selector health"),
      missing: read("Missing required surfaces")
    };
    panel.destroy();
    AviarySelectorHealth.selectorHealthFeature.destroy(context);
    return { initial, degraded, restored };
  });

  assert.equal(result.initial.snapshot.state, "healthy");
  assert.equal(result.initial.snapshot.requiredMatched, result.initial.snapshot.required);
  assert.equal(result.initial.snapshot.surfaces.find((item) => item.surface === "Grok").relevance, "optional");
  assert.match(result.initial.summary, /Healthy · home/);
  assert.match(result.initial.matches, /Primary column: stable/);

  assert.equal(result.degraded.snapshot.state, "degraded");
  assert.deepEqual(result.degraded.snapshot.missingRequired, ["Primary column"]);
  assert.match(result.degraded.summary, /Degraded · home/);
  assert.equal(result.degraded.missing, "Primary column");
  assert.match(result.degraded.affected, /Boot and timeline scope/);
  assert.equal(result.degraded.snapshot.lastTransition.from, "healthy");
  assert.equal(result.degraded.snapshot.lastTransition.to, "degraded");

  assert.equal(result.restored.snapshot.state, "healthy");
  assert.equal(result.restored.missing, "None");
  assert.match(result.restored.summary, /Healthy · home/);
  assert.equal(result.restored.snapshot.lastTransition.from, "degraded");
  assert.equal(result.restored.snapshot.lastTransition.to, "healthy");
});
