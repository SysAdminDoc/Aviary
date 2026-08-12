import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Control Center previews, dry-runs, and restores a selected library backup", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-library-backup-ui-"));
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
    globalName: "AviaryBackupUi",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  try {
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    await page.addScriptTag({ path: bundle });
    const calls = await page.evaluateHandle(() => {
      const settings = AviaryBackupUi.cloneSettings(AviaryBackupUi.DEFAULT_SETTINGS);
      const state = { calls: [] };
      const preview = {
        schemaVersion: 1,
        createdAt: "2026-08-12T12:00:00.000Z",
        profile: null,
        includeCredentials: false,
        credentialsRedacted: true,
        totalBytes: 512,
        collections: [{
          key: "aviary.library.bookmarks.v1",
          label: "Bookmarks",
          version: 1,
          present: true,
          count: 2,
          byteLength: 512,
          conflict: "replace",
          currentPresent: true,
          currentCount: 1,
          currentByteLength: 256
        }],
        conflictCount: 1,
        warnings: []
      };
      const handle = AviaryBackupUi.mountControlCenter({
        settings,
        diagnostics: () => [],
        onChange: async () => {},
        onError: () => {},
        exportLibraryBackup: async () => ({ filename: "backup.json", collections: 19, bytes: 2048 }),
        previewLibraryRestore: async () => preview,
        restoreLibraryBackup: async (_payload, options) => {
          state.calls.push(options.dryRun);
          return {
            applied: true,
            dryRun: options.dryRun,
            cancelled: false,
            rolledBack: false,
            restoredKeys: ["aviary.library.bookmarks.v1"],
            warnings: [],
            errors: [],
            rollbackErrors: [],
            preview
          };
        }
      });
      return { state, handle };
    });
    await page.evaluate(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-launcher").click());
    await page.locator("#av-control-center").evaluate((host) => host.shadowRoot.querySelector('[data-av-section="backup"]').click());
    await page.locator("#av-control-center").evaluate((host) => {
      const backup = host.shadowRoot;
      if (![...backup.querySelectorAll("button")].some((button) => button.textContent === "Export full library backup")) {
        throw new Error("backup export action missing");
      }
      if (!backup.querySelector('input[type="file"]')) throw new Error("backup file input missing");
    });

    const file = page.locator("#av-control-center").locator("input[type=file]");
    await file.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from("{}") });
    await page.waitForFunction(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-status").textContent.includes("Backup loaded"));
    await page.locator("#av-control-center").evaluate((host) => {
      [...host.shadowRoot.querySelectorAll("button")].find((button) => button.textContent === "Dry-run restore").click();
    });
    await page.waitForFunction(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-status").textContent.includes("No local data changed"));
    await page.locator("#av-control-center").evaluate((host) => {
      [...host.shadowRoot.querySelectorAll("button")].find((button) => button.textContent === "Restore this library backup").click();
    });
    await page.waitForFunction(() => document.querySelector("#av-control-center").shadowRoot.querySelector(".av-status").textContent.includes("Library backup restored"));

    const recorded = await page.evaluate((handle) => handle.state.calls, await calls);
    assert.deepEqual(recorded, [true, false]);
    await page.evaluate((handle) => handle.handle.destroy(), await calls);
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
