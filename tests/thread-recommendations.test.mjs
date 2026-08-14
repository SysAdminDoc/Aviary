import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-thread-recs-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { layoutDeclutterFeature } from ${JSON.stringify(abs("src/features/layout/declutter.ts"))};
export { threadRecommendationsFeature } from ${JSON.stringify(abs("src/features/layout/thread-recommendations.ts"))};
export { DEFAULT_SETTINGS, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryThreadRecs",
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

const CONVERSATION = `
  <div data-testid="primaryColumn">
    <div id="cell-root" data-testid="cellInnerDiv"><article data-testid="tweet">Root post</article></div>
    <div id="cell-reply-1" data-testid="cellInnerDiv"><article data-testid="tweet">A real reply</article></div>
    <div id="cell-reply-2" data-testid="cellInnerDiv"><article data-testid="tweet">Another real reply</article></div>
    <div id="cell-heading" data-testid="cellInnerDiv">
      <h2 aria-level="2" role="heading"><span>Discover more</span></h2>
      <div>Sourced from across X</div>
    </div>
    <div id="cell-rec-1" data-testid="cellInnerDiv"><article data-testid="tweet">Recommended post</article></div>
    <div id="cell-rec-2" data-testid="cellInnerDiv"><article data-testid="tweet">Another recommendation</article></div>
  </div>
`;

async function run(markup, { surface = "status", enabled = true } = {}) {
  return page.evaluate(
    async ({ markup, surface, enabled }) => {
      document.body.innerHTML = markup;
      const settings = AviaryThreadRecs.normalizeSettings({
        layout: { hideThreadRecommendations: enabled }
      });
      const context = {
        route: { href: "https://x.com/user/status/1", path: "/user/status/1", surface },
        settings,
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      // The stylesheet that acts on the marker lives in the declutter feature.
      AviaryThreadRecs.layoutDeclutterFeature.init(context);
      const feature = AviaryThreadRecs.threadRecommendationsFeature;
      feature.init(context);

      const state = () =>
        Array.from(document.querySelectorAll("[data-testid='cellInnerDiv']")).map((cell) => ({
          id: cell.id,
          display: getComputedStyle(cell).display,
          marked: cell.hasAttribute("data-av-thread-recommendation")
        }));

      const applied = state();
      feature.destroy(context);
      const restored = state();
      AviaryThreadRecs.layoutDeclutterFeature.destroy(context);
      return { applied, restored };
    },
    { markup, surface, enabled }
  );
}

test("the Discover more boundary and everything after it collapses, replies survive", async () => {
  const { applied, restored } = await run(CONVERSATION);
  const byId = Object.fromEntries(applied.map((cell) => [cell.id, cell]));

  for (const id of ["cell-root", "cell-reply-1", "cell-reply-2"]) {
    assert.equal(byId[id].display, "block", `${id} is a real reply and must stay visible`);
    assert.equal(byId[id].marked, false, `${id} must not be marked as a recommendation`);
  }
  for (const id of ["cell-heading", "cell-rec-1", "cell-rec-2"]) {
    assert.equal(byId[id].display, "none", `${id} is recommended content and must collapse`);
  }

  // Every feature must fully reverse itself.
  for (const cell of restored) {
    assert.equal(cell.display, "block", `${cell.id} must return after destroy`);
    assert.equal(cell.marked, false, `${cell.id} must lose its marker after destroy`);
  }
});

test("the feature is inert while off and outside a conversation", async () => {
  const off = await run(CONVERSATION, { enabled: false });
  for (const cell of off.applied) {
    assert.equal(cell.display, "block", `${cell.id} must be untouched while the setting is off`);
  }

  const home = await run(CONVERSATION, { surface: "home" });
  for (const cell of home.applied) {
    assert.equal(cell.display, "block", `${cell.id} must be untouched outside a conversation route`);
  }
});

test("an unrelated heading never collapses a conversation", async () => {
  const markup = `
    <div data-testid="primaryColumn">
      <div id="cell-a" data-testid="cellInnerDiv"><article data-testid="tweet">Root</article></div>
      <div id="cell-b" data-testid="cellInnerDiv"><h2 role="heading">Replies</h2></div>
      <div id="cell-c" data-testid="cellInnerDiv"><article data-testid="tweet">Reply</article></div>
    </div>
  `;
  const { applied } = await run(markup);
  for (const cell of applied) {
    assert.equal(cell.display, "block", `${cell.id} must survive an unrecognised heading`);
  }
});

test("a post whose own text says discover more is not a boundary", async () => {
  const markup = `
    <div data-testid="primaryColumn">
      <div id="cell-a" data-testid="cellInnerDiv">
        <article data-testid="tweet"><h2 role="heading">Discover more</h2>quoting the module name</article>
      </div>
      <div id="cell-b" data-testid="cellInnerDiv"><article data-testid="tweet">Reply</article></div>
    </div>
  `;
  const { applied } = await run(markup);
  for (const cell of applied) {
    assert.equal(cell.display, "block", `${cell.id} must survive: the heading belongs to a post`);
  }
});

test("the captured status page still contains the heading this contract depends on", async () => {
  const capture = await readFile(path.join(root, "_decoded/status.html"), "utf8");
  assert.match(
    capture,
    /Discover more/,
    "the status capture no longer contains the Discover more module this feature matches"
  );
});
