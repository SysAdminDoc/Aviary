import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The Markdown report, taken from the button that produces it.
 *
 * `assert.match(source, /reportInput\.version\s*=\s*AVIARY_VERSION/)` was the whole test. It
 * passes for a line that assigns the right value into an object nobody builds a report from, and
 * it says nothing about the file the user ends up with. Here the Control Center feature is
 * mounted, the report row is clicked, and the bytes handed to the download are read back.
 *
 * The defect it stood in for was `reportInput.version = ctx.settings.i18n.locale` — a report that
 * announced itself as "for vja" once the panel was switched to Japanese.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const BUILD_VERSION = "9.9.9-report";

let browser;
let context;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-report-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { controlCenterFeature } from ${JSON.stringify(abs("src/features/core/control-center.ts"))};`,
      `export { AVIARY_VERSION } from ${JSON.stringify(abs("src/platform/build-version.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryReport",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    // The same define the real build uses, so the version under test is the build's, not "dev".
    define: { __AVIARY_VERSION__: JSON.stringify(BUILD_VERSION) }
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Mounts the Control Center feature, clicks the report row, and returns the file the browser was
 * asked to save.
 */
async function downloadReport(locale) {
  return page.evaluate(async (code) => {
    document.getElementById("av-control-center")?.remove();

    const settings = AviaryReport.cloneSettings(AviaryReport.DEFAULT_SETTINGS);
    settings.i18n.locale = code;

    const captured = {};
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      captured.type = blob.type;
      captured.promise = blob.text();
      return "blob:captured";
    };
    // The anchor is appended and clicked; letting that navigate would tear down the page.
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      captured.filename = this.download;
    };

    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage: {
        async get(_key, fallback) { return fallback; },
        async set() {},
        async remove() {}
      },
      auditLog: {
        snapshot: () => ({
          entries: [{ at: "2026-08-18T10:00:00.000Z", action: "media.download", details: { filename: "a.jpg" } }]
        }),
        async record() {}
      },
      diagnostics: { info() {}, warn() {}, error() {} },
      saveSettings: async () => {},
      requestApply: () => {}
    };

    try {
      await AviaryReport.controlCenterFeature.init(ctx);
      const shadow = document.getElementById("av-control-center").shadowRoot;
      shadow.querySelector(".av-launcher").click();
      shadow.querySelector('.av-nav-item[data-av-section="snapshots"]').click();
      await new Promise((resolve) => setTimeout(resolve, 20));

      const row = [...shadow.querySelectorAll(".av-row")].find(
        (candidate) => candidate.dataset.avLabel === "Download Markdown report"
      );
      if (!row) return { missing: true };
      row.querySelector("button").click();
      await new Promise((resolve) => setTimeout(resolve, 120));

      return {
        filename: captured.filename ?? null,
        type: captured.type ?? null,
        markdown: captured.promise ? await captured.promise : null,
        status: shadow.querySelector(".av-status")?.textContent ?? null
      };
    } finally {
      URL.createObjectURL = originalCreate;
      HTMLAnchorElement.prototype.click = originalClick;
      await AviaryReport.controlCenterFeature.destroy(ctx);
    }
  }, locale);
}

test("the report row produces a Markdown file stamped with the build version", async () => {
  const result = await downloadReport("en");

  assert.ok(!result.missing, "the panel no longer offers the report the audit log is built for");
  assert.match(result.filename ?? "", /\.md$/, "the report is saved as Markdown");
  assert.equal(result.type, "text/markdown");
  assert.match(result.markdown, /for v9\.9\.9-report/, "the report must name the build that made it");
  assert.match(result.markdown, /media\.download/, "and must carry the audit log it summarises");
  assert.match(result.status ?? "", /Report downloaded/, "the panel must confirm what it did");
});

test("switching the panel's language does not change the version the report claims", async () => {
  const japanese = await downloadReport("ja");

  // The bug: `reportInput.version = ctx.settings.i18n.locale`, which produced "for vja". A report
  // is a bug-report attachment; the one thing it has to get right is which build produced it.
  assert.match(japanese.markdown, /for v9\.9\.9-report/);
  assert.ok(!/for vja\b/.test(japanese.markdown), "the locale is not a version");
});

/**
 * Scroll depth is not a follow list.
 *
 * A DOM capture reads the account rows the browser has rendered, and X renders a follower list a
 * screenful at a time. Nothing recorded how much of the list a capture had seen, so two captures
 * at different scroll depths were compared as though both were complete and the difference was
 * printed under "Removed". Scroll to 400 rows one week and 150 the next and the report names 250
 * specific accounts as removed. Nobody unfollowed; they were off screen.
 */
test("a report never presents a difference in scroll depth as a follow or unfollow list", async () => {
  const { diffSnapshots } = await importSourceModule("src/features/library/snapshots.ts");
  const { buildMarkdownReport } = await importSourceModule("src/features/library/reports.ts");

  const handles = Array.from({ length: 400 }, (_, index) => `account${String(index).padStart(3, "0")}`);
  const capture = (accounts, reachedEnd, at) => ({
    kind: "followers",
    handle: "self",
    capturedAt: at,
    source: "dom",
    accounts,
    coverage: { rows: accounts.length, reachedEnd }
  });

  // Deep scroll last week, shallow scroll today. Nobody unfollowed.
  const deep = capture(handles, false, "2026-08-01T00:00:00.000Z");
  const shallow = capture(handles.slice(0, 150), false, "2026-08-15T00:00:00.000Z");

  const diff = diffSnapshots(deep, shallow);
  assert.equal(diff.onlyEarlier.length, 250, "the raw difference is still reported");
  assert.equal(diff.partial, true, "but it must be marked as a comparison of two partial views");

  const markdown = buildMarkdownReport({
    audit: [],
    snapshots: { latest: shallow, diff },
    generatedAt: "2026-08-15T00:00:00.000Z"
  });

  assert.ok(
    !/^- Removed/m.test(markdown),
    "the report must not print a bucket called Removed for a difference it cannot attribute"
  );
  assert.ok(
    !/^- Added/m.test(markdown),
    "nor one called Added"
  );
  assert.match(markdown, /Present only in the earlier capture \(250\)/);
  assert.match(markdown, /did not reach the end of its list/);
  assert.match(markdown, /list still loading/);

  // The control: two captures that both reached the end describe a real change, and say so.
  const before = capture(handles.slice(0, 200), true, "2026-08-01T00:00:00.000Z");
  const after = capture(handles.slice(0, 199), true, "2026-08-15T00:00:00.000Z");
  const real = diffSnapshots(before, after);
  assert.equal(real.partial, false);
  assert.deepEqual(real.onlyEarlier, ["account199"]);
  const complete = buildMarkdownReport({
    audit: [],
    snapshots: { latest: after, diff: real },
    generatedAt: "2026-08-15T00:00:00.000Z"
  });
  assert.ok(
    !/did not reach the end of its list/.test(complete),
    "a comparison of two complete captures must not be hedged"
  );
  assert.match(complete, /list finished loading/);

  // An entry stored before coverage was recorded is unknown, and unknown is not complete.
  const legacy = { kind: "followers", handle: "self", capturedAt: "2026-07-01T00:00:00.000Z", source: "dom", accounts: handles.slice(0, 300) };
  assert.equal(diffSnapshots(legacy, after).partial, true);

  // An archive export is the whole list by construction.
  const archived = { kind: "followers", handle: "self", capturedAt: "2026-07-01T00:00:00.000Z", source: "archive", accounts: handles.slice(0, 300) };
  assert.equal(diffSnapshots(archived, after).partial, false);
});

/**
 * The end of a list is two facts, not one.
 *
 * X keeps a progressbar in the tree while more rows are on the way, and a reader who has not
 * scrolled to the bottom has not seen what is below the fold even when nothing is loading at that
 * instant. A list that fits on one screen satisfies both and is complete.
 */
test("reaching the end of a list needs both no spinner and no rows below the fold", async () => {
  const { measureListCoverage } = await importSourceModule("src/features/library/snapshots.ts");

  const doc = (options) => ({
    querySelector: (selector) =>
      selector === '[role="progressbar"]' && options.loading ? {} : null,
    scrollingElement: {
      scrollHeight: options.scrollHeight,
      scrollTop: options.scrollTop,
      clientHeight: options.clientHeight
    },
    documentElement: null
  });

  const atBottom = { scrollHeight: 10_000, scrollTop: 9_200, clientHeight: 800, loading: false };
  assert.equal(measureListCoverage(doc(atBottom), 400).reachedEnd, true);

  assert.equal(
    measureListCoverage(doc({ ...atBottom, loading: true }), 400).reachedEnd,
    false,
    "a spinner means more rows are coming"
  );
  assert.equal(
    measureListCoverage(doc({ ...atBottom, scrollTop: 3_000 }), 150).reachedEnd,
    false,
    "rows below the fold have not been seen"
  );

  // A short list that never scrolls is complete.
  assert.equal(
    measureListCoverage(doc({ scrollHeight: 800, scrollTop: 0, clientHeight: 800, loading: false }), 12)
      .reachedEnd,
    true
  );

  assert.equal(measureListCoverage(doc(atBottom), 400).rows, 400);
});
