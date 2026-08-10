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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-control-center-actions-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mountControlCenter } from ${JSON.stringify(path.join(root, "src/ui/control-center.ts").replace(/\\/g, "/"))};`,
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
    globalName: "AviaryActions",
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

test("rejected Control Center actions report failure and re-enable their buttons", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const errors = [];
    const unhandled = [];
    const reject = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("LocalOnlyError");
    };
    const integrationStatus = {
      aria2: { enabled: true, configured: true },
      bluesky: { enabled: true, configured: true },
      mastodon: { enabled: true, configured: true },
      ai: { enabled: true, configured: true },
      semanticSearch: { enabled: true, configured: true, indexed: 4 }
    };
    const onUnhandled = (event) => {
      unhandled.push(String(event.reason));
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: (message, error) => errors.push({ message, error: String(error) }),
      pingAria2: reject,
      crosspost: async () => reject(),
      clearSemanticIndex: reject,
      getIntegrationStatus: () => integrationStatus
    });
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="integrations"]').click();

    const clickAction = async (label) => {
      const button = [...shadow.querySelectorAll(".av-button")].find((candidate) => candidate.textContent === label);
      if (!button) throw new Error(`missing action: ${label}`);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 35));
      return {
        disabled: button.disabled,
        status: shadow.querySelector(".av-status").textContent
      };
    };

    const aria2 = await clickAction("Test Aria2 connection");
    const bluesky = await clickAction("Crosspost composer → Bluesky");
    const mastodon = await clickAction("Crosspost composer → Mastodon");
    const semantic = await clickAction("Clear semantic index");
    window.removeEventListener("unhandledrejection", onUnhandled);
    panel.destroy();
    return { aria2, bluesky, mastodon, semantic, errors, unhandled };
  });

  assert.deepEqual(result.aria2, { disabled: false, status: "Aria2 connection test failed." });
  assert.deepEqual(result.bluesky, { disabled: false, status: "Bluesky crosspost failed." });
  assert.deepEqual(result.mastodon, { disabled: false, status: "Mastodon crosspost failed." });
  assert.deepEqual(result.semantic, { disabled: false, status: "Could not clear semantic index." });
  assert.equal(result.unhandled.length, 0);
  assert.deepEqual(
    result.errors.map((entry) => entry.message),
    [
      "Aria2 connection test failed",
      "Bluesky crosspost failed",
      "Mastodon crosspost failed",
      "Could not clear semantic index"
    ]
  );
});

test("a rejected Aria2 cancel reports failure and re-enables the row action", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const errors = [];
    const unhandled = [];
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: (message, error) => errors.push({ message, error: String(error) }),
      listAria2Active: async () => [
        { gid: "gid-1", status: "active", totalLength: 100, completedLength: 20, path: "clip.mp4" }
      ],
      cancelAria2: async () => {
        throw new Error("LocalOnlyError");
      }
    });
    const onUnhandled = (event) => {
      unhandled.push(String(event.reason));
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onUnhandled);
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="integrations"]').click();
    const refresh = [...shadow.querySelectorAll(".av-button")].find((button) => button.textContent === "Refresh");
    refresh.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancel = [...shadow.querySelectorAll(".av-button")].find((button) => button.textContent === "Cancel");
    cancel.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = { disabled: cancel.disabled, status: shadow.querySelector(".av-status").textContent };
    window.removeEventListener("unhandledrejection", onUnhandled);
    panel.destroy();
    return { state, errors, unhandled };
  });

  assert.deepEqual(result.state, { disabled: false, status: "Aria2 cancel failed." });
  assert.deepEqual(result.errors.map((entry) => entry.message), ["Aria2 cancel failed"]);
  assert.equal(result.unhandled.length, 0);
});

test("snapshot capture and clear refresh the count while preserving action focus", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    let snapshotStatus = { total: 0, latestAt: null, latestKind: null, latestCount: 0 };
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getSnapshotStatus: () => snapshotStatus,
      captureSnapshot: async (kind) => {
        snapshotStatus = {
          total: kind === "followers" ? 3 : 6,
          latestAt: "2026-08-09T12:00:00.000Z",
          latestKind: kind,
          latestCount: kind === "followers" ? 3 : 6
        };
        return { count: snapshotStatus.latestCount, handle: "alice" };
      },
      clearSnapshots: async () => {
        snapshotStatus = { total: 0, latestAt: null, latestKind: null, latestCount: 0 };
      }
    });
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="snapshots"]').click();
    const readCount = () =>
      [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === "Snapshots stored")
        ?.querySelector(".av-row-description")?.textContent;
    const capture = [...shadow.querySelectorAll(".av-button")].find(
      (button) => button.textContent === "Capture followers from this view"
    );
    capture.focus();
    capture.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const afterCapture = {
      count: readCount(),
      focus: shadow.activeElement?.textContent,
      status: shadow.querySelector(".av-status").textContent
    };

    const clear = [...shadow.querySelectorAll(".av-button")].find(
      (button) => button.textContent === "Clear all snapshots"
    );
    clear.focus();
    clear.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const afterClear = {
      count: readCount(),
      focus: shadow.activeElement?.textContent,
      status: shadow.querySelector(".av-status").textContent
    };
    panel.destroy();
    return { afterCapture, afterClear };
  });

  assert.match(result.afterCapture.count, /^3 entries/);
  assert.equal(result.afterCapture.focus, "Capture followers from this view");
  assert.match(result.afterCapture.status, /Captured 3 followers/);
  assert.match(result.afterClear.count, /^0 entries/);
  assert.equal(result.afterClear.focus, "Clear all snapshots");
  assert.equal(result.afterClear.status, "Snapshots cleared");
});
