import { importSourceEntry } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

import { readI18nManifest } from "./helpers/i18n-manifest.mjs";

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
  // The two regexes that used to sit here -- `/harvestViewerLiterals/` and `/\.\.\.viewerLiterals,/`
  // -- are subsumed by the loop below: if the harvest stopped running, every viewer string would
  // be gone from the manifest and every iteration would fail. The manifest is generated rather
  // than skipped when absent, so this holds on a fresh clone too.
  const manifest = await readI18nManifest(root);
  const entries = new Set(manifest.manifest ?? manifest);
  for (const english of await viewerCopySources()) {
    assert.ok(entries.has(english), `viewer string missing from the i18n manifest: ${english}`);
  }
});

test("the viewer's locale list comes from the shared registry, not a table of its own", async () => {
  // Before: `doesNotMatch(/VIEWER_LABELS/)` plus `match(/name: locale\.label/)`. Neither can see
  // what the generated viewer contains -- a second table under any other name would satisfy both.
  const { buildExportViewer, supportedLocales } = await importSourceEntry([
    "src/features/export/viewer.ts",
    "src/platform/i18n.ts"
  ]);

  const html = new TextDecoder().decode(
    buildExportViewer([
      {
        tweetId: "1",
        handle: "alice",
        displayName: "Alice",
        text: "hello",
        capturedAt: "2026-08-18T10:00:00.000Z",
        surface: "home",
        media: [],
        permalink: "https://x.com/alice/status/1"
      }
    ])
  );

  const registry = supportedLocales();
  assert.ok(registry.length >= 8, `the locale registry looks truncated: ${registry.length}`);

  for (const locale of registry) {
    // The endonym is the one string that must never be translated; it comes from the registry.
    assert.ok(
      html.includes(`"name":${JSON.stringify(locale.label)}`),
      `the viewer does not carry ${locale.code}'s own name for itself (${locale.label})`
    );
  }

  // And nothing beyond it: a hand-maintained table would drift the moment a locale is added.
  const names = [...html.matchAll(/"name":("(?:[^"\\]|\\.)*")/g)].map((match) => JSON.parse(match[1]));
  assert.deepEqual(
    [...new Set(names)].sort(),
    registry.map((locale) => locale.label).sort(),
    "the viewer ships a locale list that is not the registry's"
  );
});
