import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

import { readI18nManifest } from "./helpers/i18n-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["es", "pt", "fr", "de", "ja", "ko", "ar", "he"];

test("every locale covers the whole panel manifest", async () => {
  const { panelCatalog, PANEL_STRINGS } = await importSourceModule("src/platform/i18n-catalog.ts");
  const PANEL_CATALOG = panelCatalog();

  assert.ok(PANEL_STRINGS.length > 250, `manifest looks truncated: ${PANEL_STRINGS.length}`);
  assert.equal(new Set(PANEL_STRINGS).size, PANEL_STRINGS.length, "manifest has duplicates");

  for (const locale of LOCALES) {
    const bundle = PANEL_CATALOG[locale];
    assert.ok(bundle, `${locale} has no catalog`);
    const missing = PANEL_STRINGS.filter((source) => bundle[source] === undefined);
    assert.deepEqual(missing, [], `${locale} is missing ${missing.length} strings, e.g. ${missing[0]}`);
  }
});

test("panelCoverage reports 100% for every shipped locale", async () => {
  const { panelCoverage, supportedLocales } = await importSourceModule("src/platform/i18n.ts");

  for (const entry of supportedLocales()) {
    const coverage = panelCoverage(entry.code);
    assert.equal(
      coverage.percent,
      100,
      `${entry.code} claims ${coverage.percent}% (${coverage.translated}/${coverage.total})`
    );
  }
});

test("translations are not just the English string echoed back", async () => {
  const { panelCatalog, PANEL_STRINGS } = await importSourceModule("src/platform/i18n-catalog.ts");
  const PANEL_CATALOG = panelCatalog();

  // Brand names, format names, units and bare URLs legitimately survive translation unchanged;
  // anything else that matches its source means an untranslated row slipped in behind a
  // filled-in-looking entry. A word that simply happens to be spelled the same in one target
  // language does NOT belong here -- that is what the budget below is for.
  const allowedIdentical = new Set([
    "Aviary",
    "WARC",
    "WACZ",
    "JSON",
    "SHA-256",
    "bytes",
    // A list of file-format names; every one is a proper noun in every locale.
    "JSON, CSV, HTML, Markdown",
    // The theme's own name, presented untranslated in the picker in every locale.
    "Noir",
    "https://mastodon.social",
    "Anthropic Messages API",
    "OpenAI Chat Completions"
  ]);

  for (const locale of LOCALES) {
    const echoed = PANEL_STRINGS.filter(
      (source) => PANEL_CATALOG[locale][source] === source && !allowedIdentical.has(source)
    );
    assert.ok(
      echoed.length <= 6,
      `${locale} echoes ${echoed.length} English strings verbatim, e.g. ${JSON.stringify(echoed.slice(0, 4))}`
    );
  }
});

test("RTL locales are declared right-to-left and LTR ones are not", async () => {
  const { localeDirection } = await importSourceModule("src/platform/i18n.ts");

  assert.equal(localeDirection("ar"), "rtl");
  assert.equal(localeDirection("he"), "rtl");
  for (const locale of ["en", "es", "pt", "fr", "de", "ja", "ko"]) {
    assert.equal(localeDirection(locale), "ltr", `${locale} should be left-to-right`);
  }
});

test("translateText falls back to the English source instead of an empty box", async () => {
  const { translateText, hasTranslation } = await importSourceModule("src/platform/i18n.ts");

  assert.equal(translateText("es", "Close"), "Cerrar");
  assert.equal(translateText("en", "Close"), "Close");
  // A string nobody has translated must degrade to itself, never to "" or a key name.
  assert.equal(translateText("es", "A brand new row"), "A brand new row");
  assert.equal(hasTranslation("es", "A brand new row"), false);
  assert.equal(hasTranslation("en", "A brand new row"), true);
});

test("the Control Center actually renders translated copy, not just English", async () => {
  // The row helpers are the choke point. The old form checked that `t(` appeared within 600
  // characters of three function names -- which passes for a helper that calls `t()` on a
  // constant and renders something else, and fails on any reformat. This renders the panel in a
  // locale and reads what the user would see.
  const { chromium } = await import("playwright");
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-i18n-panel-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const entry = path.join(temp, "entry.ts");
    const abs = (file) => path.resolve(root, file).split(path.sep).join("/");
    await writeFile(
      entry,
      [
        `export { mountControlCenter, renderedPanelStrings } from ${JSON.stringify(abs("src/ui/control-center.ts"))}`,
        `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))}`
      ].join(";\n"),
      "utf8"
    );
    const bundle = path.join(temp, "bundle.js");
    await build({
      entryPoints: [entry],
      outfile: bundle,
      bundle: true,
      format: "iife",
      globalName: "AviaryI18n",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    await page.addScriptTag({ path: bundle });

    const render = (locale) =>
      page.evaluate(async (code) => {
        document.getElementById("av-control-center")?.remove();
        const settings = AviaryI18n.cloneSettings(AviaryI18n.DEFAULT_SETTINGS);
        settings.i18n.locale = code;
        AviaryI18n.mountControlCenter({
          settings,
          diagnostics: () => [],
          onChange: async () => {},
          onError: () => {}
        });
        const shadow = document.getElementById("av-control-center").shadowRoot;
        shadow.querySelector(".av-launcher").click();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          labels: [...shadow.querySelectorAll(".av-row-label")].map((node) => node.textContent),
          sections: [...shadow.querySelectorAll(".av-nav-item")].map((node) => node.textContent),
          title: shadow.querySelector(".av-section-title")?.textContent ?? null,
          accounted: AviaryI18n.renderedPanelStrings().length
        };
      }, locale);

    const english = await render("en");
    const japanese = await render("ja");

    assert.ok(english.labels.length > 0, "the panel rendered no rows");
    // If a helper stopped calling the translator, its copy would come out identical in both.
    assert.notDeepEqual(japanese.sections, english.sections, "the nav rail is not translated");
    assert.notEqual(japanese.title, english.title, "the section heading is not translated");
    assert.ok(
      japanese.labels.some((label, index) => label !== english.labels[index]),
      "not one row label changed with the locale"
    );
    // The coverage readout counts what the translator saw; a helper bypassing it would leave the
    // tally claiming a locale is complete while the panel renders English.
    assert.ok(japanese.accounted > 20, `only ${japanese.accounted} strings reached the translator`);
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("the extractor reaches every panel section and every status branch", async () => {
  const tool = await readFile(path.join(root, "tools/i18n-extract.mjs"), "utf8");

  // The panel draws one section at a time behind the nav rail, and the coverage tally resets on
  // every render. A single render therefore reports only the default section -- which is exactly
  // how the extractor silently degraded from 254 strings to 26 when the rail landed.
  // Read the committed manifest rather than the extractor's source: it is the artifact the sync
  // step consumes, and the failure being guarded is a manifest that shrank, not a line that
  // disappeared. When the nav rail landed, a single render reported only the default section and
  // the harvest silently fell from 254 strings to 26.
  const manifest = await readI18nManifest(root);
  assert.ok(
    manifest.manifest.length > 400,
    `the harvest collapsed to ${manifest.manifest.length} strings; it must reach every section`
  );
  // Copy that only exists on a destination other than the one the panel opens on. If the
  // extractor stopped walking the rail, every one of these would be gone.
  for (const perSection of [
    "Reset ad observations",
    "Import settings (JSON)",
    "Download Markdown report",
    "Concurrent downloads"
  ]) {
    assert.ok(
      manifest.manifest.includes(perSection),
      `the harvest never reached the section that draws "${perSection}"`
    );
  }

  // `save(checked ? "X on" : "X off")` is how nearly every toggle reports itself. Anchoring the
  // status harvest on the literal immediately after the open paren missed both arms, so 51
  // confirmations shipped in English regardless of locale.
  const { harvested } = await harvestFrom(tool);
  assert.ok(harvested.includes("Link cleaning on."), "ternary status arms must be harvested");
  assert.ok(harvested.includes("Link cleaning off."), "ternary status arms must be harvested");
});

test("a conditional row's description is harvested, not only its label", async () => {
  // A row drawn behind a condition -- an expired rule, a callback the stub does not supply -- is
  // never rendered during extraction, so its copy reaches the manifest only through the source
  // scan. That scan read one string per helper call, which is the label. Every such row's
  // explanatory sentence therefore shipped in English in all eight locales while coverage
  // reported 100%: the same defect the label rule was written to fix, one argument to the right.
  const tool = await readFile(path.join(root, "tools/i18n-extract.mjs"), "utf8");
  const { harvestPanelLiterals } = await importToolFunction(tool, "harvestPanelLiterals");

  const harvested = harvestPanelLiterals(`
    ctx.actionRow("Renew expired rules", "Restart each rule's window.", async () => {});
    ctx.toggleRow("Ad-free mode", "Collapse sponsored posts.", true, async () => {});
    ctx.dataRow("Expired rules", someRuntimeValue);
    ctx.selectRow("Quote posts", value, OPTIONS, onChange, "Posts that quote another post.");
  `);

  assert.ok(harvested.includes("Renew expired rules"), "the label must still be harvested");
  assert.ok(
    harvested.includes("Restart each rule's window."),
    "an action row's description is copy and must be harvested too"
  );
  assert.ok(
    harvested.includes("Collapse sponsored posts."),
    "and so is a toggle row's description"
  );

  // The real manifest, not a sample: a description that only renders behind a condition.
  const manifest = await readI18nManifest(root);
  for (const conditional of [
    "Clear the stored post IDs so everything reads as unseen again.",
    "Retry every failed or cancelled media job in the durable queue."
  ]) {
    assert.ok(
      manifest.manifest.includes(conditional),
      `"${conditional}" is drawn behind a condition and is missing from the harvest`
    );
  }
});

/** Imports one named function out of the top-level-await tool script. */
async function importToolFunction(toolSource, name) {
  const start = toolSource.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found`);
  const end = toolSource.indexOf("\n}\n", start);
  assert.ok(end > start, `could not find the end of ${name}`);
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-i18n-fn-"));
  try {
    const file = path.join(temp, "fn.mjs");
    await writeFile(file, `${toolSource.slice(start, end + 3)}\nexport { ${name} };\n`, "utf8");
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** Runs the tool's own harvester over a sample so the assertion tests behaviour, not just text. */
async function harvestFrom(toolSource) {
  const start = toolSource.indexOf("function harvestStatusLiterals(");
  assert.ok(start > -1, "harvestStatusLiterals not found");
  // The tool is a top-level-await script, so only the function itself can be imported.
  const end = toolSource.indexOf("\n}\n", start);
  assert.ok(end > start, "could not find the end of harvestStatusLiterals");
  const fn = toolSource.slice(start, end + 3);
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-i18n-harvest-"));
  try {
    const file = path.join(temp, "harvest.mjs");
    await writeFile(
      file,
      `${fn}
export { harvestStatusLiterals };
`,
      "utf8"
    );
    const mod = await import(pathToFileURL(file).href);
    return {
      harvested: mod.harvestStatusLiterals(
        'save(checked ? "Link cleaning on." : "Link cleaning off.");\nsetStatus("Plain one");'
      )
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/**
 * The catalog stores translations, not nine copies of the English.
 *
 * The keys are the English source strings, and they used to be written beside every translation:
 * once in PANEL_STRINGS and once more inside each of the eight locale bundles. That was 413 kB of
 * an 831 kB catalog, in a bundle where the catalog was already a third of everything delivered,
 * and it grew by eight copies of every string anyone translated. Positions cost nothing.
 *
 * This pins the stored shape rather than a byte count, because a byte count drifts with the copy
 * and this does not: regenerate with an emitter that writes objects again and it fails.
 */
test("the stored catalog is positional, not keyed by the English source string", async () => {
  const source = await readFile(path.join(root, "src/platform/i18n-catalog.ts"), "utf8");
  const literal = /const PANEL_CATALOG_JSON =\s*("(?:[^"\\]|\\.)*");/s.exec(source);
  assert.ok(literal, "the generated catalog literal must be findable");

  const rows = JSON.parse(JSON.parse(literal[1]));
  const { PANEL_STRINGS, panelCatalog } = await importSourceModule("src/platform/i18n-catalog.ts");

  for (const [locale, values] of Object.entries(rows)) {
    assert.ok(Array.isArray(values), `${locale} must be stored as an array of translations`);
    assert.equal(
      values.length,
      PANEL_STRINGS.length,
      `${locale} must line up index-for-index with the manifest`
    );
  }

  // And the zip back into records is faithful: same keys, same values, for every locale.
  const catalog = panelCatalog();
  for (const [locale, values] of Object.entries(rows)) {
    const bundle = catalog[locale];
    assert.ok(bundle, `${locale} must survive the zip`);
    const translated = values.filter((value) => value !== null).length;
    assert.equal(Object.keys(bundle).length, translated, `${locale} lost entries in the zip`);
    for (let index = 0; index < values.length; index += 1) {
      if (values[index] === null) continue;
      assert.equal(
        bundle[PANEL_STRINGS[index]],
        values[index],
        `${locale} misaligned at index ${index} (${PANEL_STRINGS[index]})`
      );
    }
  }
});
