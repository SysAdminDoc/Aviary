import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let mod;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-viewer-i18n-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { buildExportViewer, viewerLocales } from ${JSON.stringify(abs("src/features/export/viewer.ts"))};
export { LOCALES, hasTranslation, supportedLocales, translateText } from ${JSON.stringify(abs("src/platform/i18n.ts"))};`,
    "utf8"
  );
  const outfile = path.join(temp, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  mod = await import(pathToFileURL(outfile).href);
});

after(async () => {
  await rm(temp, { recursive: true, force: true });
});

async function viewerCopySources() {
  const source = await readFile(path.join(root, "src/features/export/viewer.ts"), "utf8");
  const start = source.indexOf("const VIEWER_COPY = {");
  assert.notEqual(start, -1, "VIEWER_COPY is the single English source for viewer copy");
  const block = source.slice(start, source.indexOf("} as const;", start));
  return [...block.matchAll(/^\s+\w+: "((?:[^"\\]|\\.)*)",?$/gm)].map((m) => JSON.parse(`"${m[1]}"`));
}

test("the viewer ships every locale the rest of Aviary does", () => {
  assert.deepEqual([...mod.viewerLocales], mod.supportedLocales().map((locale) => locale.code));
});

test("every viewer string resolves from the shared catalog in every locale", async () => {
  const sources = await viewerCopySources();
  assert.ok(sources.length >= 20, `viewer copy looks truncated: ${sources.length}`);

  const untranslated = [];
  for (const locale of mod.supportedLocales()) {
    if (locale.code === "en") continue;
    for (const english of sources) {
      // Membership, not difference: "SHA-256" and "bytes" are legitimately identical in some
      // locales, so an equal rendering proves nothing. A missing catalog entry is the defect.
      if (!mod.hasTranslation(locale.code, english)) {
        untranslated.push(`${locale.code}: ${english}`);
      }
    }
  }
  // A viewer string missing from the catalog silently renders in English for every reader of that
  // locale, which is exactly how the old hand-maintained table was allowed to drift.
  assert.deepEqual(untranslated, [], `viewer copy missing from the catalog:\n${untranslated.join("\n")}`);
});

test("the generated viewer inlines translated copy, not just English", () => {
  const html = new TextDecoder().decode(mod.buildExportViewer([]));
  assert.match(html, /Archivo de Aviary|Visor de archivo local/, "Spanish viewer copy must be inlined");
  assert.match(html, /アーカイブ|メディア/, "Japanese viewer copy must be inlined");
  assert.match(html, /Aviary archive/, "English copy must still be present");
});

test("the extractor harvests viewer copy, or the sync step would drop it", async () => {
  // i18n-sync rewrites the catalog in manifest order. A viewer string absent from the manifest is
  // deleted from the catalog on the next sync, so the harvest is load-bearing, not decorative.
  const extractor = await readFile(path.join(root, "tools/i18n-extract.mjs"), "utf8");
  assert.match(extractor, /harvestViewerLiterals/);
  assert.match(extractor, /\.\.\.viewerLiterals,/);

  // The manifest is generated and gitignored, so a clean checkout (CI) simply has no file to
  // check. The harvest assertions above are the part that must hold everywhere.
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, "tools/i18n-manifest.json"), "utf8"));
  } catch {
    return;
  }
  const entries = new Set(manifest.manifest ?? manifest);
  for (const english of await viewerCopySources()) {
    assert.ok(entries.has(english), `viewer string missing from the i18n manifest: ${english}`);
  }
});

test("there is no second locale table left in the viewer", async () => {
  const source = await readFile(path.join(root, "src/features/export/viewer.ts"), "utf8");
  assert.doesNotMatch(source, /VIEWER_LABELS/, "the hand-maintained nine-locale table must be gone");
  // The endonym is the one string that must not be translated; it comes from the locale registry.
  assert.match(source, /name: locale\.label/);
});
