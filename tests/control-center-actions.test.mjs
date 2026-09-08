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
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`,
      `export { previewRuleSetImport } from ${JSON.stringify(path.join(root, "src/features/filtering/rules.ts").replace(/\\/g, "/"))};`
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

test("preservation actions show cost before download and keep one compact control group", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    let warcRuns = 0;
    let waczRuns = 0;
    let finishWacz;
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getWaczEstimate: () => ({ records: 7, estimatedBytes: 18 * 1024 }),
      downloadWarc: async () => {
        warcRuns += 1;
        return { records: 7 };
      },
      downloadWacz: () => {
        waczRuns += 1;
        return new Promise((resolve) => {
          finishWacz = () => resolve({ records: 7, bytes: 16 * 1024, filename: "archive.wacz" });
        });
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="export"]').click();
    const row = shadow.querySelector('[data-av-label="Preservation archive"]');
    const buttons = [...row.querySelectorAll("button")];
    const wacz = buttons.find((button) => button.textContent === "WACZ");
    const warc = buttons.find((button) => button.textContent === "WARC");
    const replay = row.querySelector("a");

    wacz.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const during = {
      disabled: wacz.disabled,
      busy: wacz.getAttribute("aria-busy")
    };
    finishWacz();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const waczStatus = shadow.querySelector(".av-status").textContent;

    warc.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const warcStatus = shadow.querySelector(".av-status").textContent;
    const output = {
      text: row.textContent,
      actionCount: row.querySelectorAll(".av-preservation-actions").length,
      replayHref: replay.href,
      replayTarget: replay.target,
      during,
      enabledAfter: buttons.every((button) => !button.disabled),
      waczStatus,
      warcStatus,
      warcRuns,
      waczRuns
    };
    panel.destroy();
    return output;
  });

  assert.match(result.text, /Estimated WACZ: 18 KiB for 7 records\./);
  assert.equal(result.actionCount, 1);
  assert.equal(result.replayHref, "https://replayweb.page/");
  assert.equal(result.replayTarget, "_blank");
  assert.deepEqual(result.during, { disabled: true, busy: "true" });
  assert.equal(result.enabledAfter, true);
  assert.equal(result.waczStatus, "WACZ downloaded (7 records, 16 KiB).");
  assert.equal(result.warcStatus, "WARC downloaded (7 records).");
  assert.equal(result.warcRuns, 1);
  assert.equal(result.waczRuns, 1);
});

test("Aviary-only WACZ proof is explicit, reports its local identity, and exports the keypair", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    let signing = { state: "missing", fingerprint: null, createdAt: null };
    let finishSigned;
    let signedRuns = 0;
    let keyRuns = 0;
    const fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getWaczSigningStatus: () => signing,
      downloadSignedWacz: () => {
        signedRuns += 1;
        return new Promise((resolve) => {
          finishSigned = () => {
            signing = { state: "ready", fingerprint, createdAt: "2026-08-21T12:00:00Z" };
            resolve({ records: 4, bytes: 12 * 1024, filename: "signed.wacz", fingerprint });
          };
        });
      },
      exportWaczSigningKey: async () => {
        keyRuns += 1;
        return { filename: "aviary-wacz-keypair-0123456789ab.json", fingerprint };
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="export"]').click();
    const row = shadow.querySelector('[data-av-label="Aviary-only WACZ proof"]');
    const initial = row.textContent;
    const signed = [...row.querySelectorAll("button")].find((button) => button.textContent === "Aviary-only WACZ proof");
    const cancel = [...row.querySelectorAll("button")].find((button) => button.textContent === "Cancel");

    signed.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const during = {
      disabled: signed.disabled,
      cancelVisible: !cancel.hidden,
      cancelEnabled: !cancel.disabled,
      busy: signed.getAttribute("aria-busy")
    };
    finishSigned();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const signedStatus = shadow.querySelector(".av-status").textContent;
    const ready = row.textContent;
    const key = [...row.querySelectorAll("button")].find((button) => button.textContent === "Export keypair");
    key.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const keyStatus = shadow.querySelector(".av-status").textContent;
    const output = {
      initial,
      ready,
      labels: [...row.querySelectorAll("button")]
        .filter((button) => !button.hidden)
        .map((button) => button.textContent),
      during,
      enabledAfter: [...row.querySelectorAll("button")]
        .filter((button) => !button.hidden)
        .every((button) => !button.disabled),
      signedStatus,
      keyStatus,
      signedRuns,
      keyRuns
    };
    panel.destroy();
    return output;
  });

  assert.match(result.initial, /First use creates a local P-384 identity/);
  assert.match(result.ready, /0123 4567 89AB CDEF/);
  assert.match(result.ready, /not what X served/);
  assert.deepEqual(result.labels, ["Aviary-only WACZ proof", "Export keypair"]);
  assert.deepEqual(result.during, { disabled: true, cancelVisible: true, cancelEnabled: true, busy: "true" });
  assert.equal(result.enabledAfter, true);
  assert.equal(result.signedStatus, "Aviary-only WACZ proof downloaded (4 records, 12 KiB).");
  assert.equal(result.keyStatus, "Signing keypair downloaded: aviary-wacz-keypair-0123456789ab.json.");
  assert.equal(result.signedRuns, 1);
  assert.equal(result.keyRuns, 1);
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
    const toggle = shadow.querySelector('input[aria-label="Semantic ranking"]');
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

test("Library downloads use the visible query and keep it when the page is revisited", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const calls = [];
    const previews = [];
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      offlineSearch: () => [],
      getCapturedMediaCount: (query) => query.includes("alice") ? 12 : 40,
      previewCapturedMediaBatch: (query) => {
        previews.push(query);
        return {
          items: [
            { id: "1:0:photo", kind: "photo", handle: "alice", tweetId: "1", filename: "alice-1.jpg", qualityLabel: "original", width: 1200, height: 800, available: true },
            { id: "2:0:video", kind: "video", handle: "alice", tweetId: "2", filename: "alice-2.mp4", qualityLabel: "best-direct", width: 1280, height: 720, available: true }
          ],
          unavailable: [
            { id: "3:0:video", kind: "video", handle: "alice", tweetId: "3", filename: "", qualityLabel: "", width: null, height: null, available: false, reason: "A streaming manifest, not a file." }
          ],
          kinds: ["photo", "video"],
          overLimit: false,
          limit: 500
        };
      },
      runCapturedMediaBatch: async (query, kind, selectedIds) => {
        calls.push({ query, selectedIds: [...(selectedIds ?? [])] });
        return {
          total: 12,
          downloaded: 8,
          started: 1,
          opened: 1,
          duplicate: 2,
          failed: 0,
          cancelled: false
        };
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="library"]').click();
    let input = [...shadow.querySelectorAll('input[type="search"]')].find((candidate) =>
      candidate.placeholder.startsWith("Search local library")
    );
    input.value = "account:alice has:media";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = input.closest(".av-row");
    const count = row.querySelector(".av-library-media-count").textContent;
    const button = row.querySelector(".av-library-media-download");
    // The action opens a review now rather than queueing the whole result set. Nothing may reach
    // the batch until someone confirms, so the run is asserted through that step.
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const review = shadow.querySelector(".av-media-review");
    const queuedBeforeConfirm = calls.length;
    const listed = review.querySelectorAll(".av-media-review-list .av-media-review-item").length;
    const skipped = [...review.querySelectorAll(".av-media-review-skipped .av-media-review-item")]
      .map((item) => item.textContent);

    // Untick one, so the confirm has to carry a selection rather than everything.
    const boxes = [...review.querySelectorAll('.av-media-review-list input[type="checkbox"]')];
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new Event("change", { bubbles: true }));
    const summary = review.querySelector(".av-media-review-summary").textContent;

    review.querySelector(".av-media-review-confirm").click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const status = shadow.querySelector(".av-status").textContent;
    shadow.querySelector('[data-av-section="appearance"]').click();
    shadow.querySelector('[data-av-section="library"]').click();
    input = [...shadow.querySelectorAll('input[type="search"]')].find((candidate) =>
      candidate.placeholder.startsWith("Search local library")
    );
    const restored = input.value;
    // Cancel writes nothing: open the review again and dismiss it. The button is re-queried
    // because the status update after a run re-renders the section.
    shadow.querySelector(".av-library-media-download").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    shadow.querySelector(".av-media-review-cancel").click();
    const queuedAfterCancel = calls.length;
    const reviewHiddenAfterCancel = shadow.querySelector(".av-media-review").hidden;

    panel.destroy();
    return {
      calls,
      previews,
      count,
      status,
      restored,
      queuedBeforeConfirm,
      queuedAfterCancel,
      reviewHiddenAfterCancel,
      summary,
      listed,
      skipped
    };
  });

  assert.equal(result.queuedBeforeConfirm, 0, "opening the review must not queue anything");
  assert.equal(result.listed, 2, "every downloadable item is listed for review");
  assert.deepEqual(
    result.skipped,
    ["video · A streaming manifest, not a file."],
    "an item that cannot be downloaded is shown with the reason, not silently dropped"
  );
  assert.match(result.summary, /1 of 2 files selected/, "the count follows the selection");
  assert.match(result.summary, /1 cannot be downloaded/);

  assert.deepEqual(
    result.calls,
    [{ query: "account:alice has:media", selectedIds: ["1:0:photo"] }],
    "only the ticked item may reach the queue, under the visible query"
  );
  assert.deepEqual(result.previews, ["account:alice has:media", "account:alice has:media"]);
  assert.equal(result.queuedAfterCancel, 1, "Cancel must not queue anything");
  assert.equal(result.reviewHiddenAfterCancel, true, "and must close the review");
  assert.equal(result.count, "12 media");
  assert.match(result.status, /8 saved \/ 1 running \/ 1 opened \/ 2 dup \/ 0 failed/);
  assert.equal(result.restored, "account:alice has:media");
});

test("the sidecar preference lives with Media downloads, not Export formats", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    const hasSidecar = () => [...shadow.querySelectorAll(".av-row-label")]
      .some((label) => label.textContent === "Metadata sidecar");
    shadow.querySelector('[data-av-section="export"]').click();
    const exportHasSidecar = hasSidecar();
    shadow.querySelector('[data-av-section="media"]').click();
    const mediaHasSidecar = hasSidecar();
    const value = [...shadow.querySelectorAll(".av-row")]
      .find((row) => row.querySelector(".av-row-label")?.textContent === "Metadata sidecar")
      ?.querySelector("select")?.value;
    panel.destroy();
    return { exportHasSidecar, mediaHasSidecar, value };
  });

  assert.equal(result.exportHasSidecar, false);
  assert.equal(result.mediaHasSidecar, true);
  assert.equal(result.value, "off");
});

test("media follow-on actions expose captured audio, captions, and date-bounded history export", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    const calls = [];
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getCapturedMediaCount: (_query, kind) => kind === "audio" ? 2 : 1,
      runCapturedMediaBatch: async (_query, kind) => {
        calls.push(kind);
        return { total: kind === "audio" ? 2 : 1, downloaded: 1, started: 0, opened: 0, duplicate: 0, failed: 0, cancelled: false };
      },
      exportMediaHistory: async (range) => {
        calls.push(range);
        return { records: 3, files: 2, filenames: ["history.json", "history.csv"] };
      }
    });
    const shadow = document.querySelector("#av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="media"]').click();
    const labels = [...shadow.querySelectorAll(".av-row-label")].map((label) => label.textContent);
    const exportRow = [...shadow.querySelectorAll(".av-row")]
      .find((row) => row.querySelector(".av-row-label")?.textContent === "Export download history");
    const dateInputs = [...exportRow.querySelectorAll('input[type="date"]')];
    dateInputs[0].value = "2026-01-01";
    dateInputs[1].value = "2026-01-31";
    exportRow.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const audioRow = [...shadow.querySelectorAll(".av-row")]
      .find((row) => row.querySelector(".av-row-label")?.textContent === "Download captured audio");
    audioRow.querySelector("button").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    panel.destroy();
    return { labels, calls };
  });

  assert.ok(result.labels.includes("Download captured audio"));
  assert.ok(result.labels.includes("Download captured captions"));
  assert.ok(result.labels.includes("Export download history"));
  assert.deepEqual(result.calls, [
    { from: "2026-01-01", to: "2026-01-31" },
    "audio"
  ]);
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
  assert.equal(result.afterClear.status, "Snapshots cleared.");
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

test("portable rules preview errors and both outcomes before applying", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const settings = AviaryActions.cloneSettings(AviaryActions.DEFAULT_SETTINGS);
    settings.filter.rules = ["text contains existing"];
    const applied = [];
    let exports = 0;
    const panel = AviaryActions.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      exportFilterRules: async () => {
        exports += 1;
        return { filename: "aviary-filter-rules.txt", rules: settings.filter.rules.length };
      },
      previewFilterRuleImport: (payload, current) => AviaryActions.previewRuleSetImport(payload, current),
      applyFilterRuleImport: async (payload, mode) => {
        const plan = AviaryActions.previewRuleSetImport(payload, settings.filter.rules)[mode];
        applied.push({ mode, errors: plan.errors.length });
        if (plan.errors.length === 0) settings.filter.rules = [...plan.lines];
        return plan;
      }
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    shadow.querySelector('[data-av-section="filtering"]').click();
    const byText = (label) =>
      [...shadow.querySelectorAll(".av-rule-set-actions .av-button")].find(
        (candidate) => candidate.textContent === label
      );
    const input = shadow.querySelector(".av-rule-set-input");

    byText("Export .txt").click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const exportStatus = shadow.querySelector(".av-status").textContent;

    input.value = "text contains sale\nmedia is audio";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    byText("Preview").click();
    const invalid = {
      copy: shadow.querySelector(".av-rule-set-preview").textContent,
      addDisabled: byText("Add rules").disabled,
      replaceDisabled: byText("Replace rules").disabled
    };

    input.value = "text contains existing\n[Videos] dim: media is video";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    byText("Preview").click();
    const valid = {
      copy: shadow.querySelector(".av-rule-set-preview").textContent,
      addDisabled: byText("Add rules").disabled,
      replaceDisabled: byText("Replace rules").disabled
    };
    byText("Add rules").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = shadow.querySelector(".av-status").textContent;
    panel.destroy();
    return { exportStatus, exports, invalid, valid, applied, rules: settings.filter.rules, status };
  });

  assert.equal(result.exports, 1);
  assert.match(result.exportStatus, /aviary-filter-rules\.txt/);
  assert.match(result.invalid.copy, /line 2/);
  assert.equal(result.invalid.addDisabled, true);
  assert.equal(result.invalid.replaceDisabled, true);
  assert.match(result.valid.copy, /2 rules found/);
  assert.match(result.valid.copy, /1 already present/);
  assert.equal(result.valid.addDisabled, false);
  assert.equal(result.valid.replaceDisabled, false);
  assert.deepEqual(result.applied, [{ mode: "add", errors: 0 }]);
  assert.deepEqual(result.rules, ["text contains existing", "[Videos] dim: media is video"]);
  assert.equal(result.status, "Added 1 rules.");
});
