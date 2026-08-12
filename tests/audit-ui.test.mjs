import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mixOver = (color, percent, backdrop) =>
  color.map((c, i) => Math.round((c * percent + backdrop[i] * (100 - percent)) / 100));

test("every theme's muted token meets AA on the Control Center row surface", async () => {
  const source = await readFile(path.join(root, "src/features/appearance/theme.ts"), "utf8");

  const themes = {};
  for (const match of source.matchAll(/(\w+): `([^`]+)`/g)) {
    const vars = {};
    for (const decl of match[2].matchAll(/--av-([a-z-]+): rgb\((\d+), (\d+), (\d+)\)/g)) {
      vars[decl[1]] = [Number(decl[2]), Number(decl[3]), Number(decl[4])];
    }
    if (vars.muted) themes[match[1]] = vars;
  }
  assert.equal(Object.keys(themes).length, 5, "all five themes must be parsed");

  for (const [name, vars] of Object.entries(themes)) {
    // Panel: color-mix(surface 96%, black); row: color-mix(surface-raised 62%, transparent).
    const panel = mixOver(vars.surface, 96, [0, 0, 0]);
    const row = mixOver(vars["surface-raised"], 62, panel);
    const ratio = contrast(vars.muted, row);
    assert.ok(
      ratio >= 4.5,
      `${name}: muted text on a settings row is ${ratio.toFixed(2)}:1, below the 4.5:1 AA floor`
    );
  }
});

test("Control Center ships its own touch and viewport rules", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
  const mobile = await readFile(path.join(root, "src/features/core/mobile-touch.ts"), "utf8");

  // Media queries work inside a shadow root; page-level classes do not reach it.
  assert.match(source, /@media \(pointer: coarse\)/);
  assert.match(source, /@media \(max-width: 760px\)/);
  assert.match(source, /min-height: 44px/);

  for (const deadSelector of ["html.av-touch .av-row", "html.av-mobile .av-launcher", "html.av-mobile .av-panel"]) {
    assert.ok(
      !mobile.includes(deadSelector),
      `${deadSelector} cannot cross the shadow boundary and must not be shipped as dead CSS`
    );
  }
});

test("Control Center implements the ImageGen page system across every menu section", async () => {
  const source = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/advanced.ts",
      "src/ui/control-center/sections/data.ts",
      "src/ui/control-center/sections/presets.ts",
      "src/ui/control-center/sections/reading.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");
  const presets = await readFile(path.join(root, "src/features/core/presets.ts"), "utf8");
  const feature = await readFile(path.join(root, "src/features/core/control-center.ts"), "utf8");
  const registry = source.slice(source.indexOf("const sectionRegistry"), source.indexOf("const buildNav"));

  assert.equal([...registry.matchAll(/\bicon:\s*"/g)].length, 13, "every section needs its own line icon");
  assert.equal([...registry.matchAll(/\baccent:\s*"rgb\(/g)].length, 13, "every section needs its own accent");
  assert.equal([...registry.matchAll(/\bsummary:\s*"/g)].length, 13, "every section needs its own page summary");
  for (const id of [
    "presets",
    "appearance",
    "layout",
    "filtering",
    "hidden",
    "performance",
    "media",
    "export",
    "library",
    "snapshots",
    "integrations",
    "backup",
    "trust"
  ]) {
    assert.match(registry, new RegExp(`id: "${id}"`));
  }

  assert.match(source, /header\.append\(titleWrap, searchBar, close\)/);
  assert.match(source, /classList\.add\("av-page-icon"\)/);
  assert.match(source, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(source, /\.av-section\[data-av-section="presets"\] \.av-page-grid/);
  assert.match(source, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(source, /@media \(max-width: 1100px\)/);
  assert.match(source, /cardHeader\.append\((?:ctx\.)?presetIcon\(preset\.id\), copy\)/);
  assert.match(source, /"av-preset-highlights"/);
  assert.match(presets, /highlights: PresetHighlight\[\]/);
  assert.match(feature, /highlights: preset\.highlights\.map/);

  for (const board of [
    "control-center-presets.png",
    "control-center-reading.png",
    "control-center-data.png",
    "control-center-advanced.png"
  ]) {
    const image = await readFile(path.join(root, "docs", "mockups", board));
    assert.ok(image.length > 100_000, `${board} must retain the generated design reference`);
  }
});

test("credential fields are masked and offer an explicit reveal", async () => {
  const source = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/advanced.ts",
      "src/ui/control-center/sections/data.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");

  assert.match(source, /function secretInputRow\(/);
  assert.match(source, /input\.type = "password"/);
  assert.match(source, /input\.autocomplete = "off"/);
  assert.match(source, /aria-pressed/);

  for (const label of [
    "Aria2 RPC secret",
    "Bluesky app password",
    "Mastodon access token",
    "AI API key",
    "Embedding API key"
  ]) {
    const index = source.indexOf(`"${label}"`);
    assert.ok(index > 0, `${label} row is missing`);
    const call = source.slice(Math.max(0, index - 80), index);
    assert.ok(
      call.includes("secretInputRow("),
      `${label} must render through secretInputRow, not a plain text field`
    );
  }
});

test("reduced motion reaches shadow content and is reachable from the UI", async () => {
  const controlCenter = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/reading.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");
  const hidden = await readFile(path.join(root, "src/features/filtering/hidden-posts-feature.ts"), "utf8");

  // A page-level class cannot style shadow descendants, so the host carries the state.
  assert.match(controlCenter, /:host\(\[data-av-motion="reduce"\]\)/);
  assert.match(hidden, /:host\(\[data-av-motion="reduce"\]\)/);
  assert.match(controlCenter, /host\.dataset\.avMotion/);
  assert.match(hidden, /toastHost\.dataset\.avMotion/);

  // The setting existed with no way to change it from the panel.
  assert.match(controlCenter, /"Reduced motion"/);
  assert.match(controlCenter, /\["always", "Always reduce"\]/);
  assert.match(controlCenter, /function coerceReduceMotion/);
});

test("the hide control stays legible at rest and on touch", async () => {
  const source = await readFile(path.join(root, "src/features/filtering/hidden-posts-feature.ts"), "utf8");

  const restingOpacity = Number(/\.av-hide-button \{[^}]*opacity: ([\d.]+);/s.exec(source)?.[1]);
  assert.ok(restingOpacity >= 0.7, `resting opacity ${restingOpacity} is too faint to discover`);
  assert.match(source, /@media \(hover: none\)/);
  assert.match(source, /\.av-hide-button:focus-visible/);

  // Effective contrast of the label against the timeline at rest.
  const muted = [132, 139, 145];
  const effective = mixOver(muted, restingOpacity * 100, [0, 0, 0]);
  assert.ok(
    contrast(effective, [0, 0, 0]) >= 3,
    `hide label renders at ${contrast(effective, [0, 0, 0]).toFixed(2)}:1 against the timeline`
  );
});

test("the toast and launcher use theme tokens rather than pinned colours", async () => {
  const hidden = await readFile(path.join(root, "src/features/filtering/hidden-posts-feature.ts"), "utf8");
  const controlCenter = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  const toastCss = hidden.slice(hidden.indexOf("const TOAST_CSS"));
  const pinned = [...toastCss.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)].filter(
    (match) => !toastCss.slice(Math.max(0, match.index - 40), match.index).includes("var(--av-")
  );
  assert.deepEqual(pinned.map((m) => m[0]), [], "toast colours must come from theme tokens");

  const launcherCss = controlCenter.slice(
    controlCenter.indexOf(".av-launcher {"),
    controlCenter.indexOf(".av-launcher:hover")
  );
  assert.ok(
    !/rgba\(29, 155, 240/.test(launcherCss),
    "the launcher gradient must follow --av-accent, not a fixed blue"
  );
});

test("normalizeSettings still round-trips the reduce-motion values the new control emits", async () => {
  const { normalizeSettings } = await importBundledModule("src/platform/settings.ts");

  for (const mode of ["system", "always", "never"]) {
    assert.equal(normalizeSettings({ accessibility: { reduceMotion: mode } }).accessibility.reduceMotion, mode);
  }
  assert.equal(
    normalizeSettings({ accessibility: { reduceMotion: "sometimes" } }).accessibility.reduceMotion,
    "system"
  );
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit-ui-"));
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
