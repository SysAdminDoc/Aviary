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
