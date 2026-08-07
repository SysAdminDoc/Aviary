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
  const { PANEL_CATALOG } = await import(pathToFileURL(catOut).href);

  const merged = {};
  for (const locale of LOCALES) merged[locale] = { ...(PANEL_CATALOG[locale] ?? {}) };

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
  const blocks = [];
  for (const locale of LOCALES) {
    const present = manifest.filter((source) => merged[locale][source] !== undefined);
    const missing = manifest.filter((source) => merged[locale][source] === undefined);
    if (missing.length > 0) {
      incomplete = true;
      console.error(`${locale}: missing ${missing.length} — ${JSON.stringify(missing.slice(0, 5))}`);
    } else {
      console.log(`${locale}: ${present.length}/${manifest.length}`);
    }
    blocks.push(
      `  ${locale}: {\n` +
        present.map((s) => `    ${JSON.stringify(s)}: ${JSON.stringify(merged[locale][s])},\n`).join("") +
        `  },\n`
    );
  }

  if (incomplete && !allowIncomplete) {
    console.error("\nRefusing to write an incomplete catalog. Pass --allow-incomplete to override.");
    process.exit(1);
  }

  const source = readFileSync(path.join(root, "src/platform/i18n-catalog.ts"), "utf8");
  const header = source.split("export const PANEL_CATALOG")[0].trimEnd();
  const out =
    `${header}\nexport const PANEL_CATALOG: Partial<Record<LocaleCode, Record<string, string>>> = {\n` +
    blocks.join("") +
    `};\n\n` +
    `/** Every English string the panel is known to render — the coverage denominator. */\n` +
    `export const PANEL_STRINGS: string[] = [\n` +
    manifest.map((s) => `  ${JSON.stringify(s)},\n`).join("") +
    `];\n`;

  writeFileSync(path.join(root, "src/platform/i18n-catalog.ts"), out);
  console.log(`catalog written (${manifest.length} strings x ${LOCALES.length} locales)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
