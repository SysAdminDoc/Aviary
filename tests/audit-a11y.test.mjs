import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * This one stays source-text on purpose. It is a contract about the *shape* of a CSS selector --
 * that the rule scopes to the count container inside an action and never to the action itself --
 * which is a claim about the stylesheet, not about rendered behaviour. Aviary's own rule cannot be
 * exercised against the panel, because it targets X's timeline; `tests/theme-matrix.test.mjs` is
 * where a rendered check would belong if one is ever added.
 *
 * The panel's accessibility assertions that used to live beside it were behavioural claims written
 * as source regexes, and they are now driven in `tests/a11y-behaviour.test.mjs`.
 */

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
