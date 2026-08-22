import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Two accessibility contracts that are about work rather than markup.
 *
 * The panel's structural accessibility -- focus entry and return, containment, Escape, accessible
 * names -- is driven in `tests/a11y-behaviour.test.mjs`, and its rendered appearance in
 * `tests/panel-appearance-contract.test.mjs`. What is left here is a control that must not lock
 * the panel while someone types into it, and an index that must not throw on the queries a real
 * person produces on the way to a real one.
 */

test("archive search waits for the typing to stop before it walks the records", async () => {
  // `assert.match(ui, /searchTimer = setTimeout\(runSearch, 180\)/)` matches the line that arms
  // the timer. It cannot see whether the timer is ever cleared, so a debounce that fires once per
  // keystroke -- which is what froze the panel on a large imported archive -- passes it.
  const { chromium } = await import("playwright");
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-archive-search-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const abs = (file) => path.resolve(root, file).split(path.sep).join("/");
    const entry = path.join(temp, "entry.ts");
    await writeFile(
      entry,
      [
        `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))}`,
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
      globalName: "AviaryArchive",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    await page.addScriptTag({ path: bundle });

    const result = await page.evaluate(async () => {
      const settings = AviaryArchive.cloneSettings(AviaryArchive.DEFAULT_SETTINGS);
      settings.i18n.locale = "en";
      window.__searches = [];
      AviaryArchive.mountControlCenter({
        settings,
        diagnostics: () => [],
        onChange: async () => {},
        onError: () => {},
        searchArchive(query) {
          window.__searches.push(query);
          return query === "alice"
            ? [{ handle: "alice", tweetId: "1", text: "a captured record" }]
            : [];
        }
      });
      const shadow = document.getElementById("av-control-center").shadowRoot;
      shadow.querySelector(".av-launcher").click();
      shadow.querySelector('.av-nav-item[data-av-section="snapshots"]').click();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const input = shadow.querySelector("#av-search-archive");
      if (!input) return { missing: true };
      const empty = shadow.querySelector(".av-search-results").textContent;

      window.__searches.length = 0;
      for (const char of "alice") {
        input.value += char;
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const duringTyping = window.__searches.length;
      await new Promise((resolve) => setTimeout(resolve, 260));
      const afterTyping = [...window.__searches];
      const hits = shadow.querySelectorAll(".av-search-hit").length;

      input.value = "zzzznothing";
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 260));
      const noMatch = shadow.querySelector(".av-search-results").textContent;

      return { empty, duringTyping, afterTyping, hits, noMatch };
    });

    assert.ok(!result.missing, "the panel no longer draws an archive search field");
    assert.match(result.empty, /Type to search the records captured by export runs/);
    assert.equal(result.duringTyping, 0, `${result.duringTyping} searches ran while the user was typing`);
    assert.deepEqual(result.afterTyping, ["alice"], "typing five characters must run one search");
    assert.equal(result.hits, 1, "the hit was not rendered");
    assert.match(result.noMatch, /No captured records match/, "a miss must say so, not render nothing");
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("LocalSearchIndex handles empty and punctuation-only queries safely", async () => {
  const { LocalSearchIndex } = await importSourceModule("src/features/library/local-search.ts");
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
