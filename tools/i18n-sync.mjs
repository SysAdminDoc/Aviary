/**
 * Merges translation additions into src/platform/i18n-catalog.ts and rewrites it in manifest
 * order, so the catalog stays a generated artifact rather than something hand-sorted.
 *
 *   node tools/i18n-extract.mjs --write        # refresh tools/i18n-manifest.json first
 *   node tools/i18n-sync.mjs additions.json    # then fold in the new translations
 *
 * `additions.json` is `{ "<locale>": { "<english source>": "<translation>" } }`. Existing
 * entries win only when the additions file does not mention them, so re-running is safe.
 *
 * Any manifest string a locale still lacks is reported and the file is not written -- a
 * partially-translated catalog that silently claims completeness is the failure mode the whole
 * coverage design exists to prevent.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["es", "pt", "fr", "de", "ja", "ko", "ar", "he"];
const additionFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const allowIncomplete = process.argv.includes("--allow-incomplete");

const manifestPath = path.join(root, "tools/i18n-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("tools/i18n-manifest.json is missing. Run: node tools/i18n-extract.mjs --write");
  process.exit(1);
}
const { manifest } = JSON.parse(readFileSync(manifestPath, "utf8"));

const temp = mkdtempSync(path.join(tmpdir(), "aviary-i18n-sync-"));
try {
  const catOut = path.join(temp, "catalog.mjs");
  await build({
    entryPoints: [path.join(root, "src/platform/i18n-catalog.ts")],
    outfile: catOut,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent"
  });
  const { panelCatalog } = await import(pathToFileURL(catOut).href);

  const merged = {};
  for (const locale of LOCALES) merged[locale] = { ...(panelCatalog()[locale] ?? {}) };

  for (const file of additionFiles) {
    const resolved = path.resolve(file);
    if (!existsSync(resolved)) {
      console.error(`additions file not found: ${resolved}`);
      process.exit(1);
    }
    for (const [locale, entries] of Object.entries(JSON.parse(readFileSync(resolved, "utf8")))) {
      if (!merged[locale]) {
        console.error(`unknown locale "${locale}" in ${file}`);
        process.exit(1);
      }
      Object.assign(merged[locale], entries);
    }
  }

  let incomplete = false;
  const catalog = {};
  for (const locale of LOCALES) {
    const present = manifest.filter((source) => merged[locale][source] !== undefined);
    const missing = manifest.filter((source) => merged[locale][source] === undefined);
    if (missing.length > 0) {
      incomplete = true;
      console.error(`${locale}: missing ${missing.length} — ${JSON.stringify(missing.slice(0, 5))}`);
    } else {
      console.log(`${locale}: ${present.length}/${manifest.length}`);
    }
    // Positional against the manifest rather than keyed by it. The keys are the English source
    // strings, and they were being written out once per locale -- eight copies of the same 51 kB,
    // 413 kB of a 831 kB catalog, in a bundle where the catalog was already a third of everything
    // delivered. `PANEL_STRINGS` below ships that list once, and `panelCatalog()` zips the two
    // back together on first use, so nothing outside this file can tell the difference. A locale
    // missing a string writes null and keeps every later string on its own index.
    catalog[locale] = manifest.map((source) => merged[locale][source] ?? null);
  }

  if (incomplete && !allowIncomplete) {
    console.error("\nRefusing to write an incomplete catalog. Pass --allow-incomplete to override.");
    process.exit(1);
  }

  const source = readFileSync(path.join(root, "src/platform/i18n-catalog.ts"), "utf8");
  // Split on the first generated declaration, whichever shape the file is currently in, so
  // regenerating never appends to what it was meant to replace.
  const marker = [
    "export type PanelCatalog",
    "export const PANEL_CATALOG",
    "export const PANEL_STRINGS",
    "const PANEL_CATALOG_JSON"
  ]
    .map((token) => source.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const header = (marker === undefined ? source : source.slice(0, marker)).trimEnd();
  // One JSON string rather than an object literal. A literal is materialized when the module
  // runs, which happened on every X page load in every tab -- roughly 2.8 MB of retained heap and
  // 6.6 ms of execution, to serve a panel most sessions never open. The string costs the same
  // bytes on disk and nothing at all until something actually asks for a translation.
  const out =
    `${header}\n\nexport type PanelCatalog = Partial<Record<LocaleCode, Record<string, string>>>;\n\n` +
    `/** Every English string the panel is known to render — the coverage denominator, and the\n` +
    ` * key list every locale's translations below are positional against. */\n` +
    `export const PANEL_STRINGS: string[] = [\n` +
    manifest.map((s) => `  ${JSON.stringify(s)},\n`).join("") +
    `];\n\n` +
    `/**\n` +
    ` * Translations only, one array per locale, aligned index-for-index with PANEL_STRINGS.\n` +
    ` *\n` +
    ` * Storing the English key beside every translation meant shipping that key nine times: once\n` +
    ` * in PANEL_STRINGS and once inside each locale's bundle. Positions cost nothing.\n` +
    ` */\n` +
    `const PANEL_CATALOG_JSON =\n  ${JSON.stringify(JSON.stringify(catalog))};\n\n` +
    `let parsedCatalog: PanelCatalog | undefined;\n\n` +
    `/**\n` +
    ` * The catalog, parsed and zipped back into per-locale records on first use, then cached.\n` +
    ` *\n` +
    ` * Nothing on the document-start path calls this; a translation is only needed once the panel\n` +
    ` * or a translated feature string is actually rendered. A null means that locale has no\n` +
    ` * translation for the string at that index, which leaves it absent from the record and so\n` +
    ` * falls back to English, exactly as a missing key did.\n` +
    ` */\n` +
    `export function panelCatalog(): PanelCatalog {\n` +
    `  if (parsedCatalog) {\n` +
    `    return parsedCatalog;\n` +
    `  }\n` +
    `  const rows = JSON.parse(PANEL_CATALOG_JSON) as Partial<\n` +
    `    Record<LocaleCode, (string | null)[]>\n` +
    `  >;\n` +
    `  const built: PanelCatalog = {};\n` +
    `  for (const [locale, values] of Object.entries(rows)) {\n` +
    `    const bundle: Record<string, string> = {};\n` +
    `    const count = Math.min(values.length, PANEL_STRINGS.length);\n` +
    `    for (let index = 0; index < count; index += 1) {\n` +
    `      const value = values[index];\n` +
    `      const key = PANEL_STRINGS[index];\n` +
    `      if (value != null && key !== undefined) {\n` +
    `        bundle[key] = value;\n` +
    `      }\n` +
    `    }\n` +
    `    built[locale as LocaleCode] = bundle;\n` +
    `  }\n` +
    `  parsedCatalog = built;\n` +
    `  return parsedCatalog;\n` +
    `}\n`;

  writeFileSync(path.join(root, "src/platform/i18n-catalog.ts"), out);
  console.log(`catalog written (${manifest.length} strings x ${LOCALES.length} locales)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
