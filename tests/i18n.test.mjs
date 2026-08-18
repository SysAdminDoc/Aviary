import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["es", "pt", "fr", "de", "ja", "ko", "ar", "he"];

test("every locale covers the whole panel manifest", async () => {
  const { panelCatalog, PANEL_STRINGS } = await importBundledModule("src/platform/i18n-catalog.ts");
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
  const { panelCoverage, supportedLocales } = await importBundledModule("src/platform/i18n.ts");

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
  const { panelCatalog, PANEL_STRINGS } = await importBundledModule("src/platform/i18n-catalog.ts");
  const PANEL_CATALOG = panelCatalog();

  // Brand names and bare URLs legitimately survive translation unchanged; anything else that
  // matches its source means an untranslated row slipped in behind a filled-in-looking entry.
  const allowedIdentical = new Set([
    "Aviary",
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
  const { localeDirection } = await importBundledModule("src/platform/i18n.ts");

  assert.equal(localeDirection("ar"), "rtl");
  assert.equal(localeDirection("he"), "rtl");
  for (const locale of ["en", "es", "pt", "fr", "de", "ja", "ko"]) {
    assert.equal(localeDirection(locale), "ltr", `${locale} should be left-to-right`);
  }
});

test("translateText falls back to the English source instead of an empty box", async () => {
  const { translateText, hasTranslation } = await importBundledModule("src/platform/i18n.ts");

  assert.equal(translateText("es", "Close"), "Cerrar");
  assert.equal(translateText("en", "Close"), "Close");
  // A string nobody has translated must degrade to itself, never to "" or a key name.
  assert.equal(translateText("es", "A brand new row"), "A brand new row");
  assert.equal(hasTranslation("es", "A brand new row"), false);
  assert.equal(hasTranslation("en", "A brand new row"), true);
});

test("the Control Center routes its copy through the translator", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // The row helpers are the choke point: if these stop calling t(), every label silently
  // reverts to English while the coverage readout keeps claiming the locale is complete.
  for (const helper of ["function section(", "function toggleRow(", "function readonlyRow("]) {
    const start = source.indexOf(helper);
    assert.ok(start > -1, `${helper} not found`);
    const body = source.slice(start, start + 600);
    assert.match(body, /\bt\(/, `${helper} no longer translates its copy`);
  }

  assert.match(source, /export function renderedPanelStrings\(/, "drift accounting was removed");
});

test("the extractor reaches every panel section and every status branch", async () => {
  const tool = await readFile(path.join(root, "tools/i18n-extract.mjs"), "utf8");

  // The panel draws one section at a time behind the nav rail, and the coverage tally resets on
  // every render. A single render therefore reports only the default section -- which is exactly
  // how the extractor silently degraded from 254 strings to 26 when the rail landed.
  assert.match(tool, /querySelectorAll\(".av-nav-item"\)/);
  assert.match(tool, /no nav items found/);

  // `save(checked ? "X on" : "X off")` is how nearly every toggle reports itself. Anchoring the
  // status harvest on the literal immediately after the open paren missed both arms, so 51
  // confirmations shipped in English regardless of locale.
  assert.match(tool, /function harvestStatusLiterals\(/);
  const { harvested } = await harvestFrom(tool);
  assert.ok(harvested.includes("Link cleaning on"), "ternary status arms must be harvested");
  assert.ok(harvested.includes("Link cleaning off"), "ternary status arms must be harvested");
});

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
        'save(checked ? "Link cleaning on" : "Link cleaning off");\nsetStatus("Plain one");'
      )
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-i18n-test-"));
  try {
    const outfile = path.join(temp, "module.mjs");
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      logLevel: "silent"
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
