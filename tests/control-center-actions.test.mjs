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

test("semantic search ignores results that belong to an older query", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const deferred = new Map();
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      semanticSearchQuery: (query) =>
        new Promise((resolve) => {
          deferred.set(query, resolve);
        })
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="integrations"]').click();
    const input = [...shadow.querySelectorAll('input[type="search"]')].find(
      (candidate) => candidate.placeholder === "Describe what you're looking for…"
    );
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(240);
    input.value = "beta";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(240);
    deferred.get("beta")([{ tweetId: "b", handle: "beta", text: "new result", score: 0.9 }]);
    await wait(0);
    deferred.get("alpha")([{ tweetId: "a", handle: "alpha", text: "stale result", score: 0.99 }]);
    await wait(0);
    const text = input.closest(".av-row").querySelector(".av-search-results").textContent;
    panel.destroy();
    return text;
  });

  assert.match(result, /new result/);
  assert.doesNotMatch(result, /stale result/);
});

test("library search labels the ranking signals used for each result", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const hitDocument = {
      id: "record:42",
      collection: "posts",
      account: "alice",
      text: "Local archive workflow",
      tags: [],
      folder: null,
      capturedAt: "2026-08-21T00:00:00.000Z",
      mediaCount: 0
    };
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      offlineSearch: () => [{
        document: hitDocument,
        score: 1,
        matchedTerms: ["archive"],
        snippet: hitDocument.text,
        mode: "lexical"
      }],
      offlineSemanticSearch: async () => [{
        document: hitDocument,
        score: 1,
        matchedTerms: ["archive"],
        snippet: hitDocument.text,
        mode: "hybrid"
      }]
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="library"]').click();
    const input = [...shadow.querySelectorAll('input[type="search"]')].find((candidate) =>
      candidate.placeholder.startsWith("Search local library")
    );
    const toggle = shadow.querySelector('input[aria-label="Use semantic ranking (optional)"]');
    input.value = "archive";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const lexical = input.closest(".av-row").querySelector(".av-search-results").textContent;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hybrid = input.closest(".av-row").querySelector(".av-search-results").textContent;
    panel.destroy();
    return { lexical, hybrid };
  });

  assert.match(result.lexical, /Text match/);
  assert.match(result.hybrid, /Text \+ semantic match/);
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

test("a saving page transaction announces itself busy to assistive technology", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {
        await pending;
      },
      onError: () => {}
    });
    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="appearance"]').click();

    const bar = shadow.querySelector(".av-transaction-bar");
    const idle = bar.getAttribute("aria-busy");

    const toggle = shadow.querySelector('.av-toggle-control > input[type="checkbox"]');
    toggle.click();

    const save = shadow.querySelector(".av-transaction-save");
    save.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const saving = bar.getAttribute("aria-busy");

    release();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const settled = bar.getAttribute("aria-busy");

    panel.destroy();
    return { idle, saving, settled };
  });

  // An ARIA boolean is the literal string. `toggleAttribute` wrote "", which reads as the default
  // (false), so the save was silent to a screen reader while the button sat disabled.
  assert.equal(result.idle, null, "an idle bar must not claim to be busy");
  assert.equal(result.saving, "true", 'a saving bar must expose aria-busy="true", not ""');
  assert.equal(result.settled, null, "the busy state must clear once the write resolves");
});
