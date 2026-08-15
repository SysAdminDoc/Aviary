import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-user-colors-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export * from ${JSON.stringify(abs("src/features/library/user-notes.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryNotes",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

// Absolute profile hrefs, exactly as the saved captures store them.
const TIMELINE = `
  <article data-testid="tweet" id="a">
    <div data-testid="User-Name"><a href="https://x.com/tagged">Tagged</a></div>
  </article>
  <article data-testid="tweet" id="b">
    <div data-testid="User-Name"><a href="https://x.com/noted">Noted</a></div>
  </article>
  <article data-testid="tweet" id="c">
    <div data-testid="User-Name"><a href="https://x.com/plain">Plain</a></div>
  </article>
`;

async function run(seed) {
  return page.evaluate(
    async ({ markup, seed }) => {
      document.body.innerHTML = markup;
      document.getElementById("av-user-notes")?.remove();
      const values = new Map([["aviary.userNotes.v1", seed]]);
      const storage = {
        async get(key, fallback) {
          return values.has(key) ? values.get(key) : fallback;
        },
        async set(key, value) {
          values.set(key, JSON.parse(JSON.stringify(value)));
        }
      };
      const ctx = {
        storage,
        settings: { i18n: { locale: "en" } },
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviaryNotes.userNotesFeature;
      await feature.init(ctx);

      const badgeOf = (id) => {
        const badge = document.querySelector(`#${id} [data-av-note-badge]`);
        if (!badge) return null;
        return {
          text: badge.textContent,
          color: badge.getAttribute("data-av-note-color"),
          label: badge.getAttribute("aria-label"),
          background: getComputedStyle(badge).backgroundColor
        };
      };

      const applied = { a: badgeOf("a"), b: badgeOf("b"), c: badgeOf("c") };
      // Read the store before destroy: teardown clears the module cache by design.
      const colors = AviaryNotes.getUserColors();
      feature.destroy(ctx);
      const afterDestroy = document.querySelectorAll("[data-av-note-badge]").length;
      return { applied, afterDestroy, colors };
    },
    { markup: TIMELINE, seed }
  );
}

test("a colour tag alone earns a badge, and names the colour to assistive tech", async () => {
  const { applied } = await run({
    notes: {},
    colors: { tagged: "violet" },
    updatedAt: null
  });

  assert.ok(applied.a, "a tagged handle must get a badge even with no note");
  assert.equal(applied.a.color, "violet");
  assert.match(applied.a.label, /violet/, "colour must not be the only carrier of meaning");
  assert.ok(applied.a.text.length > 0, "the badge keeps visible text, not just a colour");
  assert.equal(applied.c, null, "an untagged handle gets nothing");
});

test("a note keeps its own badge, and a colour tints it", async () => {
  const { applied } = await run({
    notes: { noted: "met at a conference" },
    colors: { noted: "sky" },
    updatedAt: null
  });

  assert.ok(applied.b);
  assert.equal(applied.b.color, "sky");
  assert.match(applied.b.label, /met at a conference/, "the note stays in the accessible label");
  assert.notEqual(applied.b.background, "rgba(0, 0, 0, 0)", "the palette rule must apply");
});

test("only palette colours survive a load; anything else is dropped", async () => {
  const { applied, colors } = await run({
    notes: {},
    colors: { tagged: "chartreuse", noted: "green" },
    updatedAt: null
  });

  assert.equal(colors.tagged, undefined, "an unknown colour must not be stored");
  assert.equal(colors.noted, "green");
  assert.equal(applied.a, null, "a handle whose colour was rejected gets no badge");
  assert.equal(applied.b.color, "green");
});

test("a payload written before colours existed still loads", async () => {
  // The shipped shape was { notes, updatedAt } with no colors key at all.
  const { applied, colors } = await run({ notes: { noted: "older note" }, updatedAt: null });
  assert.deepEqual(colors, {});
  assert.ok(applied.b, "the note must still render");
  assert.equal(applied.b.color, null);
});

test("destroy removes every badge", async () => {
  const { afterDestroy } = await run({ notes: {}, colors: { tagged: "rose" }, updatedAt: null });
  assert.equal(afterDestroy, 0);
});
