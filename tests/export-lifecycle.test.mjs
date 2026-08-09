import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-export-lifecycle-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { exportFeature, getDiscoveredQueries } from ${JSON.stringify(path.join(root, "src/features/export/export-feature.ts").replace(/\\/g, "/"))};`,
      `export { CHECKPOINT_KEY } from ${JSON.stringify(path.join(root, "src/features/export/jobs.ts").replace(/\\/g, "/"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryExport",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("export discovery and capture sessions reconcile live toggles exactly once", async () => {
  const result = await page.evaluate(async () => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    const data = new Map();
    let queryWrites = 0;
    const storage = {
      async get(key, fallback) {
        return data.has(key) ? structuredClone(data.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        if (key === "aviary.queryIds.v1") queryWrites += 1;
        data.set(key, structuredClone(value));
      }
    };
    const settings = AviaryExport.cloneSettings(AviaryExport.DEFAULT_SETTINGS);
    settings.export.enabled = false;
    settings.export.autoDiscoverQueryIds = false;
    const context = {
      route: { surface: "home" },
      settings,
      storage,
      limiter: {},
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      saveSettings: async () => {},
      requestApply() {}
    };

    await AviaryExport.exportFeature.init(context);
    await AviaryExport.exportFeature.apply(context, document);
    const jobsAtBoot = Object.values(data.get(AviaryExport.CHECKPOINT_KEY)?.jobs ?? {});

    const script = document.createElement("script");
    script.textContent = "/i/api/graphql/ABCDEF123/HomeTimeline";
    document.head.append(script);
    settings.export.autoDiscoverQueryIds = true;
    await AviaryExport.exportFeature.apply(context, document);
    const discovered = AviaryExport.getDiscoveredQueries();
    const queryWritesAfterEnable = queryWrites;
    await AviaryExport.exportFeature.apply(context, document);
    const queryWritesAfterRepeat = queryWrites;

    settings.export.enabled = true;
    await AviaryExport.exportFeature.apply(context, document);
    const firstOpen = Object.values(data.get(AviaryExport.CHECKPOINT_KEY).jobs);
    await AviaryExport.exportFeature.apply(context, document);
    const afterUnchangedCapture = Object.values(data.get(AviaryExport.CHECKPOINT_KEY).jobs);

    settings.export.enabled = false;
    await AviaryExport.exportFeature.apply(context, document);
    const afterDisable = Object.values(data.get(AviaryExport.CHECKPOINT_KEY).jobs);
    await AviaryExport.exportFeature.apply(context, document);
    const afterRepeatedDisable = Object.values(data.get(AviaryExport.CHECKPOINT_KEY).jobs);

    settings.export.enabled = true;
    await AviaryExport.exportFeature.apply(context, document);
    const afterReenable = Object.values(data.get(AviaryExport.CHECKPOINT_KEY).jobs);
    await AviaryExport.exportFeature.destroy(context);
    const afterDestroy = Object.values(data.get(AviaryExport.CHECKPOINT_KEY).jobs);

    return {
      jobsAtBoot,
      discovered: discovered?.queries ?? null,
      queryWritesAfterEnable,
      queryWritesAfterRepeat,
      firstOpen,
      afterUnchangedCapture,
      afterDisable,
      afterRepeatedDisable,
      afterReenable,
      afterDestroy
    };
  });

  assert.deepEqual(result.jobsAtBoot, []);
  assert.equal(result.queryWritesAfterEnable, 1);
  assert.equal(result.queryWritesAfterRepeat, 1, "unchanged auto-discovery must not rescan");
  assert.equal(result.discovered.HomeTimeline, "ABCDEF123");
  assert.equal(result.firstOpen.length, 1);
  assert.equal(result.firstOpen[0].done, false);
  assert.equal(result.afterUnchangedCapture.length, 1, "unchanged capture must reuse its session");
  assert.equal(result.afterDisable.length, 1);
  assert.equal(result.afterDisable[0].done, true);
  assert.equal(result.afterRepeatedDisable.length, 1, "unchanged disabled state must not add a job");
  assert.equal(result.afterReenable.length, 2);
  assert.notEqual(result.afterReenable[0].jobId, result.afterReenable[1].jobId);
  assert.equal(result.afterReenable[1].done, false);
  assert.ok(result.afterDestroy.every((job) => job.done), "destroy must finish the active session");
});
