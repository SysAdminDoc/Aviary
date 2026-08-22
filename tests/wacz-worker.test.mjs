import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production WACZ assembly runs in the inlined worker", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-wacz-worker-"));
  const outfile = path.join(temp, "worker-client.js");
  let browser;
  try {
    const workerBuild = await build({
      entryPoints: [path.join(root, "src/entrypoints/wacz-worker.ts")],
      bundle: true,
      write: false,
      format: "iife",
      target: "es2022",
      platform: "browser",
      minify: true,
      legalComments: "none",
      logLevel: "silent"
    });
    const workerSource = workerBuild.outputFiles[0]?.text;
    assert.ok(workerSource);
    await build({
      entryPoints: [path.join(root, "src/features/export/wacz-worker-client.ts")],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "AviaryWaczWorker",
      define: { __AVIARY_WACZ_WORKER_SOURCE__: JSON.stringify(workerSource) },
      target: "es2022",
      platform: "browser",
      logLevel: "silent"
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ path: outfile });
    const result = await page.evaluate(async () => {
      const progress = [];
      const artifact = await globalThis.AviaryWaczWorker.buildWaczArchiveOffThread([{
        tweetId: "worker-1",
        handle: "alpha",
        displayName: "Alpha",
        text: "worker test",
        capturedAt: "2026-08-12T12:00:00Z",
        surface: "home",
        media: [],
        permalink: "https://x.com/alpha/status/worker-1"
      }], {
        generatedAt: new Date("2026-08-12T12:34:56Z"),
        onProgress: (value) => progress.push(value)
      });
      return {
        contentType: artifact.contentType,
        filename: artifact.filename,
        bytes: artifact.data.byteLength,
        progress
      };
    });
    assert.equal(result.contentType, "application/wacz");
    assert.equal(result.filename, "aviary-20260812T123456Z.wacz");
    assert.ok(result.bytes > 0);
    assert.deepEqual(result.progress, [0, 0.15, 1]);
  } finally {
    await browser?.close();
    await rm(temp, { force: true, recursive: true });
  }
});
