import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { importSourceModule } from "./helpers/source-import.mjs";

/**
 * An automated WCAG rule sweep over Aviary's own injected UI.
 *
 * Complements `a11y-behaviour.test.mjs` rather than repeating it: that file drives interactions a
 * rule engine cannot express (focus entry and return, containment, Escape), while this one catches
 * the class those checks cannot — invalid ARIA, missing accessible names, insufficient contrast —
 * across every destination at once.
 *
 * Two limits worth stating rather than discovering. Axe covers roughly half of accessibility issues
 * by volume and none of the judgement ones, so a clean run is evidence and not a certificate. And
 * no axe rule covers forced-colors breakage at all, which is why `forced-colors.test.mjs` exists
 * separately.
 *
 * Scoped to Aviary's shadow root throughout: X's own DOM is not ours to assert on, and a fixture of
 * it would only report their violations.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

/** Every Control Center destination, so a violation cannot hide on a page nobody opens. */
const { CONTROL_CENTER_SECTION_MANIFEST } = await importSourceModule(
  "src/ui/control-center/section-manifest.ts"
);
const { buildExportViewer } = await importSourceModule("src/features/export/viewer.ts");
const SECTIONS = CONTROL_CENTER_SECTION_MANIFEST.map((entry) => entry.id);

let browser;
let context;
let page;
let temp;
let optionsBundlePath;
let optionsHtml;

const A11Y_FIXTURES = [
  { name: "dark", theme: "dim", colorScheme: "dark", forcedColors: "none", width: 1440 },
  { name: "light", theme: "off", colorScheme: "light", forcedColors: "none", width: 1440 },
  { name: "narrow", theme: "dim", colorScheme: "dark", forcedColors: "none", width: 320 },
  { name: "forced-colors", theme: "dim", colorScheme: "dark", forcedColors: "active", width: 320 }
];

const MEDIA_TERMINAL_STATES = [
  { name: "queued", running: 0, queued: 2, paused: 0, completed: 0, opened: 0, duplicate: 0, failed: 0 },
  { name: "running", running: 1, queued: 0, paused: 0, completed: 0, opened: 0, duplicate: 0, failed: 0 },
  { name: "paused", running: 0, queued: 0, paused: 1, completed: 0, opened: 0, duplicate: 0, failed: 0 },
  { name: "completed", running: 0, queued: 0, paused: 0, completed: 2, opened: 0, duplicate: 0, failed: 0 },
  { name: "failed", running: 0, queued: 0, paused: 0, completed: 0, opened: 0, duplicate: 0, failed: 1 },
  { name: "cancelled", running: 0, queued: 0, paused: 0, completed: 0, opened: 0, duplicate: 0, failed: 0, cancelled: 1 }
];

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-a11y-axe-"));
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
    globalName: "AviaryAxe",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  optionsBundlePath = path.join(temp, "options.js");
  await build({
    entryPoints: [path.join(root, "src/entrypoints/extension-options.ts")],
    outfile: optionsBundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  optionsHtml = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  const optionsCss = await readFile(path.join(root, "src/extension/options.css"), "utf8");
  optionsHtml = optionsHtml
    .replace(/<script[^>]*src="options\.js"[^>]*>\s*<\/script>/i, "")
    .replace(/<link[^>]*href="options\.css"[^>]*>/i, `<style>${optionsCss}</style>`);

  browser = await chromium.launch({ headless: true });
  // AxeBuilder refuses a page created by browser.newPage(); it wants a context.
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    const settings = AviaryAxe.cloneSettings(AviaryAxe.DEFAULT_SETTINGS);
    window.__panel = AviaryAxe.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    document.getElementById("av-control-center").shadowRoot.querySelector(".av-launcher").click();
  });
  const railSections = await page.evaluate(() =>
    [...document.getElementById("av-control-center").shadowRoot.querySelectorAll(".av-nav-item")].map(
      (item) => item.dataset.avSection
    )
  );
  assert.deepEqual(railSections, SECTIONS, "the rendered section rail must match the canonical manifest");
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function openSection(section) {
  await page.evaluate((name) => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(`[data-av-section="${name}"]`)?.click();
  }, section);
  await page.waitForTimeout(30);
}

async function mountPanelFixture(fixture, mediaStatus = null) {
  await page.setViewportSize({ width: fixture.width, height: 900 });
  await page.emulateMedia({ colorScheme: fixture.colorScheme, forcedColors: fixture.forcedColors });
  await page.evaluate(({ theme, light, media }) => {
    window.__panel?.destroy();
    document.body.style.backgroundColor = light ? "rgb(255, 255, 255)" : "rgb(15, 20, 25)";
    const settings = AviaryAxe.cloneSettings(AviaryAxe.DEFAULT_SETTINGS);
    settings.appearance.theme = theme;
    const mediaOptions = media
      ? {
          getMediaStatus: () => media,
          runMediaBatch: async () => ({ total: 0, downloaded: 0, started: 0, opened: 0, duplicate: 0, failed: 0, cancelled: false }),
          pauseMediaBatch: () => ({ ok: true }),
          resumeMediaBatch: () => ({ ok: true }),
          cancelMediaBatch: () => ({ ok: true }),
          resumePendingMediaJobs: async () => ({ downloaded: 0, started: 0, opened: 0, failed: 0, cancelled: false }),
          retryFailedMediaJobs: async () => ({ retried: 0 }),
          clearMediaHistory: async () => {},
          exportMediaHistory: async () => ({ records: 0, files: 0, filenames: [] }),
          getCapturedMediaCount: () => 0,
          runCapturedMediaBatch: async () => ({ downloaded: 0, duplicate: 0, failed: 0 })
        }
      : {};
    window.__panel = AviaryAxe.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      ...mediaOptions
    });
    document.getElementById("av-control-center").shadowRoot.querySelector(".av-launcher").click();
  }, { theme: fixture.theme, light: fixture.name === "light", media: mediaStatus });
  await page.waitForTimeout(20);
}

/** Runs axe against Aviary's injected UI only, never X's DOM. */
function analyzePanel() {
  return new AxeBuilder({ page })
    .include({ fromShadowDom: ["#av-control-center", ".av-panel"] })
    .analyze();
}

function describe(violations) {
  return violations
    .map((violation) => {
      const where = violation.nodes
        .map((node) => (Array.isArray(node.target) ? node.target.flat(2).join(" ") : String(node.target)))
        .join(" | ");
      return `${violation.id} (${violation.impact}): ${violation.help} -> ${where}`;
    })
    .join("\n");
}

for (const section of SECTIONS) {
  test(`the ${section} destination has no accessibility violations`, async () => {
    for (const fixture of A11Y_FIXTURES) {
      await mountPanelFixture(fixture);
      await openSection(section);
      const results = await analyzePanel();
      assert.equal(
        results.violations.length,
        0,
        `axe found violations on ${section} (${fixture.name}):\n${describe(results.violations)}`
      );
    }
  });
}

test("the panel's incomplete results do not grow unnoticed", async () => {
  await mountPanelFixture(A11Y_FIXTURES[0]);
  await openSection("appearance");
  const results = await analyzePanel();

  // Aviary's surfaces use colour-mix and layered translucency, which axe cannot resolve to a single
  // contrast ratio — those land in `incomplete` rather than `violations`. That is expected, so the
  // count is pinned: a jump means new unresolvable contrast to look at by hand, not a pass.
  const contrast = results.incomplete.filter((entry) => entry.id === "color-contrast");
  const others = results.incomplete.filter((entry) => entry.id !== "color-contrast");

  assert.deepEqual(
    others.map((entry) => entry.id),
    [],
    `unexpected incomplete results:\n${describe(others)}`
  );
  assert.ok(
    contrast.length <= 1,
    `color-contrast should be the only unresolvable rule, saw ${contrast.length} groups`
  );
});

test("the options page has no accessibility violations in every release fixture", async () => {
  for (const fixture of A11Y_FIXTURES) {
    await page.setViewportSize({ width: fixture.width, height: 900 });
    await page.emulateMedia({ colorScheme: fixture.colorScheme, forcedColors: fixture.forcedColors });
    await page.setContent(optionsHtml);
    await page.evaluate(() => {
      globalThis.chrome = { runtime: { getManifest: () => ({ version: "test" }) } };
    });
    await page.addScriptTag({ path: optionsBundlePath });
    await page.waitForTimeout(50);
    const results = await new AxeBuilder({ page }).include("body").analyze();
    assert.equal(
      results.violations.length,
      0,
      `axe found options-page violations (${fixture.name}):\n${describe(results.violations)}`
    );
  }
});

test("media terminal states and the standalone viewer have no serious accessibility violations", async () => {
  for (const state of MEDIA_TERMINAL_STATES) {
    await mountPanelFixture(A11Y_FIXTURES[0], {
      historySize: 2,
      historyMatches: { identity: 0, exact: 1, perceptual: 0 },
      lastHistoryMatch: "exact",
      completed: state.completed,
      failed: state.failed,
      running: state.running,
      queued: state.queued,
      paused: state.paused,
      cancelled: state.cancelled,
      opened: state.opened,
      duplicate: state.duplicate,
      batch: state.running || state.queued || state.paused
        ? { id: "fixture", status: state.paused ? "paused" : "running", total: 2, enqueued: 2, downloaded: state.completed, started: state.running, opened: 0, duplicate: 0, failed: state.failed }
        : undefined
    });
    await openSection("media");
    const results = await analyzePanel();
    assert.equal(
      results.violations.length,
      0,
      `axe found media-state violations (${state.name}):\n${describe(results.violations)}`
    );
  }

  const viewerRecords = [{
    tweetId: "a11y-1",
    handle: "fixture",
    displayName: "Fixture",
    conversationId: "a11y-1",
    rootId: "a11y-1",
    text: "archive viewer accessibility fixture",
    capturedAt: "2026-09-07T12:00:00Z",
    surface: "home",
    media: [{
      kind: "photo",
      url: "https://pbs.twimg.com/media/fixture.jpg",
      capture: { status: "remote-reference", sourceUrl: "https://pbs.twimg.com/media/fixture.jpg", capturedAt: null, byteLength: null, sha256: null, retryable: true }
    }],
    permalink: "https://x.com/fixture/status/a11y-1"
  }];
  const viewerHtml = new TextDecoder().decode(buildExportViewer(viewerRecords));
  for (const fixture of A11Y_FIXTURES) {
    await page.setViewportSize({ width: fixture.width, height: 900 });
    await page.emulateMedia({ colorScheme: fixture.colorScheme, forcedColors: fixture.forcedColors });
    await page.setContent(viewerHtml);
    await page.waitForTimeout(30);
    const results = await new AxeBuilder({ page }).include("body").analyze();
    assert.equal(
      results.violations.length,
      0,
      `axe found viewer violations (${fixture.name}):\n${describe(results.violations)}`
    );
  }
});
