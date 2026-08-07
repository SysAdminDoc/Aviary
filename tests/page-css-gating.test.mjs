import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * No stylesheet Aviary puts in the page may restyle X's own elements without an Aviary gate.
 *
 * Two did, and neither was reachable from any setting. `media-buttons` injected its sheet from
 * `init()` before checking `media.buttons`, forcing `position: relative` onto every tweetPhoto --
 * and X anchors the photo itself with `position: absolute; inset: 0`, so wherever the tweetPhoto
 * box is zero-height the image collapsed to nothing: loaded, present, and invisible. Turning
 * every setting off could not stop it. `i18n-feature` likewise rewrote text wrapping and tap
 * targets for everyone.
 *
 * A gate is an `av-` class, a `data-av` attribute, or `:host`. Anything else applies the moment
 * the sheet loads, which is a change to X that nobody asked for and nothing can undo.
 */
test("no injected rule restyles X without an Aviary gate", async () => {
const files = [];
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full);
    else if (e.name.endsWith(".ts")) files.push(full);
  }
};
await walk(`${root}/src/features`);

const ungated = [];
const gated = [];

for (const file of files) {
  const src = await readFile(file, "utf8");
  const rel = path.relative(root, file).replace(/\\/g, "/");
  // Every template literal assigned to a *_CSS const.
  for (const m of src.matchAll(/const (\w*CSS\w*) = `([\s\S]*?)`;/g)) {
    const [, name, css] = m;
    // Strip comments, then split rules.
    // Resolve the interpolations first: splitting a selector on `${BUTTON_ATTR}` turns one
    // gated rule into several mangled fragments and reports them all as ungated.
    const clean = css
      .replace(/\$\{BUTTON_ATTR\}/g, "data-av-media-button")
      .replace(/\$\{PROCESSED_ATTR\}/g, "data-av-media-processed")
      .replace(/\$\{RESULT_ATTR\}/g, "data-av-filter")
      .replace(/\$\{HIDDEN_ATTR\}/g, "data-av-hidden")
      .replace(/\$\{[A-Z_]+\}/g, "data-av-generated")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\s+/g, " ").trim();
      const body = rule[2].replace(/\s+/g, " ").trim();
      if (!selector || selector.startsWith("@")) continue;
      // Does every comma-separated part carry an Aviary gate?
      const parts = selector.split(",").map((p) => p.trim()).filter(Boolean);
      const isGated = (p) => /\bav-|data-av|:host/.test(p);
      const allGated = parts.every(isGated);
      // Does it target something of X's rather than only Aviary's own nodes?
      const touchesX = parts.some((p) => /data-testid|article|body|aria-label|\bimg\b|video/.test(p));
      const entry = { file: rel, name, selector: selector.slice(0, 150), body: body.slice(0, 110) };
      if (!allGated && touchesX) ungated.push(entry);
      else if (touchesX) gated.push(entry);
    }
  }
}


  assert.deepEqual(
    ungated.map((r) => `${r.file}: ${r.selector}`),
    [],
    "these rules restyle X with nothing to switch them off"
  );
  assert.ok(gated.length > 10, `expected gated rules to still exist, found ${gated.length}`);
});
