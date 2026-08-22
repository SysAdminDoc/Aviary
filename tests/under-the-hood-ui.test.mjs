import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Control Center reads and exports local X Under the Hood reports", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-under-the-hood-ui-"));
  const entry = path.join(temp, "entry.ts");
  const bundle = path.join(temp, "bundle.js");
  await writeFile(
    entry,
    [
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryUnderTheHoodUi",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    await page.addScriptTag({ path: bundle });
    const state = {
      imports: [],
      exports: 0,
      status: {
        reportCount: 1,
        latest: {
          id: "uth-2026-07-01-2026-07-31",
          period: "2026-07",
          startDate: "2026-07-01",
          endDate: "2026-07-31",
          generatedAt: "2026-08-12T10:00:00.000Z",
          importedAt: "2026-08-13T12:00:00.000Z",
          postCount: 181,
          postLabelCount: 4,
          accountLabelDayCount: 3,
          postLabels: ["AbusiveBehavior"],
          accountLabels: ["Spam"]
        },
        previous: null,
        comparison: null
      }
    };
    const handle = await page.evaluateHandle((initial) => {
      const settings = AviaryUnderTheHoodUi.cloneSettings(AviaryUnderTheHoodUi.DEFAULT_SETTINGS);
      const state = initial;
      const report = {
        id: "uth-2026-08-01-2026-08-31",
        source: "x-under-the-hood",
        importedAt: "2026-09-01T00:00:00.000Z",
        generatedAt: "2026-09-01T00:00:00.000Z",
        period: { startDate: "2026-08-01", endDate: "2026-08-31", timezone: "UTC" },
        postCount: 12,
        postLabels: [],
        accountLabels: [],
        totalPostLabels: 0,
        totalAccountLabels: 0,
        notes: null
      };
      return {
        state,
        handle: AviaryUnderTheHoodUi.mountControlCenter({
          settings,
          diagnostics: () => [],
          onChange: async () => {},
          onError: () => {},
          getUnderTheHoodStatus: () => state.status,
          importUnderTheHood: async (payload) => {
            state.imports.push(payload);
            state.status.reportCount = 2;
            state.status.previous = state.status.latest;
            state.status.latest = {
              id: report.id,
              period: "2026-08",
              startDate: report.period.startDate,
              endDate: report.period.endDate,
              generatedAt: report.generatedAt,
              importedAt: report.importedAt,
              postCount: report.postCount,
              postLabelCount: 0,
              accountLabelDayCount: 0,
              postLabels: [],
              accountLabels: []
            };
            state.status.comparison = {
              earlier: "2026-07",
              later: "2026-08",
              postCountDelta: -169,
              postLabelCountDelta: -4,
              accountLabelDayCountDelta: -3,
              addedPostLabels: [],
              removedPostLabels: ["AbusiveBehavior"],
              addedAccountLabels: [],
              removedAccountLabels: ["Spam"],
              postLabelChanges: [],
              accountLabelChanges: []
            };
            return { report, warnings: [], errors: [] };
          },
          exportUnderTheHood: async () => {
            state.exports += 1;
            return { filename: "reports.json", reports: state.status.reportCount, bytes: 128 };
          }
        })
      };
    }, state);
    await page.evaluate(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-launcher").click());
    await page.locator("#av-control-center").evaluate((host) => host.shadowRoot.querySelector('[data-av-section="library"]').click());
    const host = page.locator("#av-control-center");
    await host.evaluate((element) => {
      const shadow = element.shadowRoot;
      if (!shadow.textContent.includes("X Under the Hood")) throw new Error("Under the Hood surface missing");
      if (!shadow.querySelector('input[aria-label="Import X Under the Hood JSON"]')) throw new Error("Under the Hood file input missing");
      if (!shadow.textContent.includes("Latest Under the Hood report")) throw new Error("latest report summary missing");
    });

    await host.locator('input[type="file"]').setInputFiles({
      name: "under-the-hood.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"period":{"startDate":"2026-08-01","endDate":"2026-08-31"},"postCount":12}')
    });
    await page.waitForFunction(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-status").textContent.includes("saved locally"));
    await host.evaluate((element) => {
      if (!element.shadowRoot.textContent.includes("Month-over-month")) throw new Error("comparison missing after import");
      [...element.shadowRoot.querySelectorAll("button")].find((button) => button.textContent === "Export saved Under the Hood reports").click();
    });
    await page.waitForFunction((value) => value.state.exports === 1, await handle);
    const recorded = await page.evaluate((value) => ({ imports: value.state.imports.length, exports: value.state.exports }), await handle);
    assert.deepEqual(recorded, { imports: 1, exports: 1 });
    await page.evaluate((value) => value.handle.destroy(), await handle);
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
