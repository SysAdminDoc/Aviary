import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the closed panel is removed from the tab order, not just faded out", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // aria-hidden with focusable descendants is the failure being guarded against.
  assert.match(source, /overlay\.toggleAttribute\("inert", !open\)/);
  assert.match(source, /overlay\.toggleAttribute\("inert", true\)/, "closed at mount too");

  const overlayCss = source.slice(source.indexOf(".av-overlay {"), source.indexOf(".av-panel {"));
  assert.match(overlayCss, /visibility: hidden/);
  assert.match(overlayCss, /visibility: visible/);
  // The fade must still run, so visibility is delayed rather than instant on close.
  assert.match(overlayCss, /visibility 0s linear 160ms/);
  assert.match(source, /aria-modal", "true"/);
  assert.match(source, /document\.body\?\.setAttribute\("inert", ""\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /focusables\[0\]!\.focus/);
  const openCss = source.slice(source.indexOf(".av-overlay.is-open"), source.indexOf(".av-panel {"));
  assert.match(openCss, /pointer-events: auto/);
});

test("hiding engagement counts keeps the buttons and their labels", async () => {
  const theme = await readFile(path.join(root, "src/features/appearance/theme.ts"), "utf8");

  assert.match(theme, /av-hide-counts/);
  assert.match(theme, /classList\.toggle\("av-hide-counts", settings\.appearance\.hideCounts\)/);
  // Only the number inside an action button is hidden — never the button itself.
  assert.match(theme, /\[data-testid="reply"\] \[data-testid="app-text-transition-container"\]/);
  assert.match(theme, /a\[href\$="\/analytics"\] \[data-testid="app-text-transition-container"\]/);
  assert.ok(
    !/av-hide-counts[^{]*\[data-testid="reply"\]\s*\{/.test(theme),
    "the action button itself must stay visible"
  );
  // Teardown drops the class it sets.
  const destroy = theme.slice(theme.indexOf("destroy(ctx)"), theme.indexOf("export function applyTheme"));
  assert.match(destroy, /av-hide-counts/);
});

test("presets do not promise settings that nothing implements", async () => {
  const { PRESETS } = await importBundledModule("src/features/core/presets.ts");
  const source = await readFile(path.join(root, "src/features/appearance/theme.ts"), "utf8");
  const declutter = await readFile(path.join(root, "src/features/layout/declutter.ts"), "utf8");
  const implemented = `${source}${declutter}`;

  // Every appearance/layout key a preset writes must have something reading it.
  const unimplemented = [];
  for (const preset of PRESETS) {
    for (const group of ["appearance", "layout"]) {
      for (const key of Object.keys(preset.overrides[group] ?? {})) {
        if (key === "theme") continue;
        const applied = new RegExp(`settings\\.${group}\\.${key}\\b`).test(implemented);
        if (!applied) unimplemented.push(`${preset.id}: ${group}.${key}`);
      }
    }
  }
  assert.deepEqual(unimplemented, [], "presets must not report changes they cannot deliver");
});

test("archive search debounces input and only rebuilds a stale index", async () => {
  const ui = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/data.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");
  const feature = await readFile(path.join(root, "src/features/core/control-center.ts"), "utf8");

  assert.match(ui, /searchTimer = setTimeout\(runSearch, 180\)/);
  assert.match(ui, /clearTimeout\(searchTimer\)/);
  // Empty and no-result states both say something useful.
  assert.match(ui, /Type to search the records captured by export runs/);
  assert.match(ui, /No captured records match/);

  assert.match(feature, /searchIndex\.size\(\) !== storedRecordCount/);
  assert.ok(
    !/if \(hits\.length === 0\) \{\s*rebuildSearchIndex\(\);/.test(feature),
    "a miss must not trigger a full re-index"
  );
});

test("LocalSearchIndex handles empty and punctuation-only queries safely", async () => {
  const { LocalSearchIndex } = await importBundledModule("src/features/library/local-search.ts");
  const index = new LocalSearchIndex();
  index.rebuild([
    {
      tweetId: "1",
      handle: "someone",
      displayName: "Some One",
      text: "hello world",
      capturedAt: "2026-08-06T00:00:00.000Z",
      surface: "home",
      media: [],
      permalink: null
    }
  ]);

  for (const query of ["", "   ", "!!!", "(*)", "a"]) {
    assert.deepEqual(index.search(query), [], `query ${JSON.stringify(query)} must return nothing`);
  }
  assert.equal(index.search("hello").length, 1);
  assert.equal(index.search("HELLO").length, 1, "search is case-insensitive");
  assert.equal(index.search("@someone").length, 1, "handles match with or without @");
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit-a11y-"));
  const outfile = path.join(temp, "module.mjs");

  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
