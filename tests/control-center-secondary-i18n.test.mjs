import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["en", "es", "pt", "fr", "de", "ja", "ko", "ar", "he"];
const sectionIds = ["snapshots", "integrations", "export", "library"];
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-secondary-i18n-"));
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
    globalName: "AviarySecondaryI18n",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("secondary Control Center sections render stable copy through every locale", async () => {
  const results = await page.evaluate((locales) => {
    const output = {};
    const sections = ["snapshots", "integrations", "export", "library"];
    for (const locale of locales) {
      document.body.replaceChildren();
      const settings = AviarySecondaryI18n.cloneSettings(AviarySecondaryI18n.DEFAULT_SETTINGS);
      settings.i18n.locale = locale;
      const panelHandle = AviarySecondaryI18n.mountControlCenter({
        settings,
        diagnostics: () => [],
        onChange: async () => {},
        onError: () => {},
        getSnapshotStatus: () => ({ total: 2, latestAt: "2026-08-12T12:00:00.000Z", latestKind: "followers", latestCount: 3 }),
        captureSnapshot: async () => ({ count: 3, handle: "alice" }),
        clearSnapshots: async () => {},
        getArchiveImportStatus: () => ({
          jobs: [
            { jobId: "running", filename: "archive.zip", status: "running", filesParsed: 2, recordCount: 4, warningCount: 1 },
            { jobId: "paused", filename: "paused.zip", status: "paused", filesParsed: 1, recordCount: 2, warningCount: 0 },
            { jobId: "failed", filename: "failed.zip", status: "failed", filesParsed: 1, recordCount: 0, warningCount: 1 }
          ]
        }),
        getArchiveLibraryStatus: () => ({
          hasImport: true,
          authoredPosts: 4,
          likes: 2,
          directMessages: 1,
          media: 3,
          followers: 5,
          following: 6,
          lists: 1,
          profile: 1,
          account: 1,
          repairs: {
            archiveLinksExpanded: 2,
            corpusLinksExpanded: 3,
            participantIdsResolved: 4,
            participantIdsUnresolved: 1
          }
        }),
        importArchive: async () => ({ records: 1, warnings: 0, errors: 0 }),
        searchArchive: () => [],
        downloadReport: async () => {},
        getCleanupQueueSize: () => ({ total: 4, queued: 2, approved: 1, skipped: 1 }),
        enqueueCleanupReview: async () => ({ added: 1, protected: 1 }),
        clearCleanupQueue: async () => {},
        pauseArchiveImport: async () => ({ ok: true }),
        resumeArchiveImport: async () => ({ ok: true }),
        cancelArchiveImport: async () => ({ ok: true }),
        retryArchiveImport: async () => ({ ok: true }),
        getIntegrationStatus: () => ({
          aria2: { enabled: true, configured: true },
          bluesky: { enabled: true, configured: true },
          mastodon: { enabled: true, configured: true },
          ai: { enabled: true, configured: true },
          semanticSearch: { enabled: true, configured: true, indexed: 4 }
        }),
        pingAria2: async () => ({ ok: true }),
        listAria2Active: async () => [],
        cancelAria2: async () => ({ ok: true }),
        crosspost: async () => ({ ok: true, posts: 1 }),
        rebuildSemanticIndex: async () => ({ added: 1, skipped: 0, errors: 0, total: 5, dropped: 0 }),
        semanticSearchQuery: async () => [],
        clearSemanticIndex: async () => {},
        recentIntegrationErrors: () => [],
        getBookmarkStatus: () => ({ total: 3, due: 1, tags: ["one"], folders: ["folder"] }),
        searchBookmarks: () => [],
        offlineSearch: () => [],
        offlineSemanticSearch: async () => [],
        updateBookmark: async () => null,
        removeBookmark: async () => true,
        clearBookmarks: async () => {},
        getExportStatus: () => ({
          jobCount: 2,
          knownQueries: 5,
          jobs: [
            { jobId: "export-running", status: "running", recordCount: 2, surface: "home", startedAt: "2026-08-12T12:00:00.000Z" },
            { jobId: "export-paused", status: "paused", recordCount: 1, surface: "search", startedAt: "2026-08-12T12:00:00.000Z" },
            { jobId: "export-queued", status: "queued", recordCount: 0, surface: "profile", startedAt: "2026-08-12T12:00:00.000Z" }
          ]
        }),
        pauseExportJob: async () => ({ ok: true }),
        resumeExportJob: async () => ({ ok: true }),
        cancelExportJob: async () => ({ ok: true }),
        runExport: async () => ({ records: 2, filename: "export.zip", files: 1 }),
        copyDiagnostics: async () => {},
        downloadWarc: async () => ({ records: 2 }),
        getWaczEstimate: () => ({ records: 2, estimatedBytes: 4096 }),
        downloadWacz: async () => ({ records: 2, bytes: 4096, filename: "archive.wacz" }),
        exportToTarget: async () => ({ target: "raw-json", records: 2 }),
        getRetentionPolicy: () => ({ maxJobs: 10, maxRecordsPerJob: 100, maxAgeDays: 30 }),
        saveRetentionPolicy: async () => {}
      });
      const host = document.querySelector("#av-control-center");
      const shadow = host.shadowRoot;
      shadow.querySelector(".av-launcher").click();
      const panel = shadow.querySelector(".av-panel");
      const text = {};
      const controls = {};
      for (const id of sections) {
        shadow.querySelector(`[data-av-section="${id}"]`).click();
        text[id] = panel.textContent;
        for (const controlId of [
          "av-import-archive",
          "av-search-archive",
          "av-semantic-search",
          "av-crosspost-thread"
        ]) {
          const control = shadow.querySelector(`#${controlId}`);
          if (!control) continue;
          const labelledBy = control.getAttribute("aria-labelledby");
          controls[controlId] = {
            name: labelledBy ? shadow.querySelector(`#${labelledBy}`)?.textContent?.trim() : "",
            labelledBy
          };
        }
      }
      output[locale] = {
        dialog: panel.getAttribute("aria-label"),
        text,
        controls
      };
      panelHandle.destroy();
      document.querySelector("#av-control-center")?.remove();
    }
    return output;
  }, locales);

  const English = results.en;
  assert.match(English.text.snapshots, /2 entries · latest followers of 3/);
  assert.match(English.text.snapshots, /2 archive links \+ 3 captured links expanded/);
  assert.match(English.text.integrations, /Aria2 active downloads/);
  assert.match(English.text.export, /2 jobs tracked · 5 GraphQL IDs cached/);
  assert.match(English.text.library, /3 saved · 1 due/);
  assert.match(English.text.library, /Search all local collections/);
  const expectedControlNames = {
    "av-import-archive": "Import official X archive",
    "av-search-archive": "Search captured records",
    "av-semantic-search": "Semantic search",
    "av-crosspost-thread": "Crosspost as thread"
  };
  for (const [id, name] of Object.entries(expectedControlNames)) {
    assert.equal(English.controls[id].name, name, `${id} has the wrong English accessible name`);
    assert.ok(English.controls[id].labelledBy, `${id} is missing aria-labelledby`);
  }

  const untranslated = [
    "Snapshots stored",
    "Capture followers from this view",
    "Imported collections",
    "Offline archive repairs",
    "Pause archive.zip.",
    "Aria2 active downloads",
    "Crosspost as thread",
    "Semantic search",
    "Export status",
    "Local bookmarks",
    "2 entries · latest followers of 3",
    "2 archive links + 3 captured links expanded · 4 participant IDs resolved · 1 kept as unresolved IDs · no requests made",
    "2 jobs tracked · 5 GraphQL IDs cached",
    "3 saved · 1 due · 1 tags · 1 folders",
    "Search all local collections",
    "Search posts, likes, bookmarks, notes, tags, folders, and snapshots with filters.",
    "Semantic ranking",
    "Try source:bookmarks, tag:reading, or has:media."
  ];
  for (const locale of locales.slice(1)) {
    assert.notEqual(results[locale].dialog, "Aviary settings", `${locale} dialog label stayed English`);
    for (const [id, name] of Object.entries(expectedControlNames)) {
      assert.ok(results[locale].controls[id].name, `${locale}.${id} has no accessible name`);
      assert.notEqual(results[locale].controls[id].name, name, `${locale}.${id} stayed English`);
      assert.ok(results[locale].controls[id].labelledBy, `${locale}.${id} is missing aria-labelledby`);
    }
    for (const id of sectionIds) {
      for (const phrase of untranslated) {
        assert.ok(!results[locale].text[id].includes(phrase), `${locale}.${id} still contains ${phrase}`);
      }
    }
  }
});
