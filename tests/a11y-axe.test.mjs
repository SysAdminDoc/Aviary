import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

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
const SECTIONS = [
  "presets",
  "appearance",
  "layout",
  "filtering",
  "hidden",
  "media",
  "performance",
  "export",
  "library",
  "snapshots",
  "integrations",
  "backup",
  "trust"
];

let browser;
let context;
let page;
let temp;

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
    await openSection(section);
    const results = await analyzePanel();
    assert.equal(
      results.violations.length,
      0,
      `axe found violations on ${section}:\n${describe(results.violations)}`
    );
  });
}

test("the panel's incomplete results do not grow unnoticed", async () => {
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
