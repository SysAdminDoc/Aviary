import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-bookmarks-product-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { BookmarkStore } from ${JSON.stringify(abs("src/features/library/bookmarks.ts"))};`,
      `export { bookmarksFeature, getBookmarks, getBookmarkStore, bookmarkStatus, searchBookmarks } from ${JSON.stringify(abs("src/features/library/bookmarks-feature.ts"))};`,
      `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};`,
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
    globalName: "AviaryBookmarks",
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

test("a rendered post saves, removes, and reloads a local bookmark", async () => {
  const result = await page.evaluate(async () => {
    const data = new Map();
    const storage = {
      async get(key, fallback) {
        return data.has(key) ? structuredClone(data.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        data.set(key, structuredClone(value));
      },
      async remove(key) {
        data.delete(key);
      }
    };
    const context = {
      storage,
      settings: { i18n: { locale: "en" } },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };

    const addArticle = () => {
      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      const status = document.createElement("a");
      status.href = "/alice/status/777777";
      status.textContent = "post";
      const name = document.createElement("div");
      name.setAttribute("data-testid", "User-Name");
      const handle = document.createElement("a");
      handle.href = "/alice";
      handle.textContent = "@alice";
      name.append(handle);
      const text = document.createElement("div");
      text.setAttribute("data-testid", "tweetText");
      text.textContent = "A post worth keeping";
      const actions = document.createElement("div");
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", "Post actions");
      article.append(status, name, text, actions);
      document.body.append(article);
      return article;
    };

    document.body.replaceChildren();
    const article = addArticle();
    await AviaryBookmarks.bookmarksFeature.init(context);
    const button = () => article.querySelector("[data-av-local-bookmark]");
    const before = { text: button()?.textContent, count: AviaryBookmarks.getBookmarks().length };
    button().click();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const saved = {
      text: button()?.textContent,
      count: AviaryBookmarks.getBookmarks().length,
      record: AviaryBookmarks.getBookmarks()[0]
    };

    button().click();
    await new Promise((resolve) => setTimeout(resolve, 15));
    const removed = { text: button()?.textContent, count: AviaryBookmarks.getBookmarks().length };

    button().click();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await AviaryBookmarks.bookmarksFeature.destroy(context);
    await AviaryBookmarks.bookmarksFeature.init(context);
    const reloaded = {
      text: button()?.textContent,
      count: AviaryBookmarks.getBookmarks().length,
      persistedId: AviaryBookmarks.getBookmarks()[0]?.id ?? null
    };
    await AviaryBookmarks.bookmarksFeature.destroy(context);
    return { before, saved, removed, reloaded, style: document.getElementById("av-local-bookmarks") };
  });

  assert.deepEqual(result.before, { text: "Save locally", count: 0 });
  assert.equal(result.saved.text, "Saved locally");
  assert.equal(result.saved.count, 1);
  assert.equal(result.saved.record.tweetId, "777777");
  assert.equal(result.saved.record.handle, "alice");
  assert.equal(result.saved.record.url, "https://x.com/alice/status/777777");
  assert.deepEqual(result.removed, { text: "Save locally", count: 0 });
  assert.equal(result.reloaded.text, "Saved locally");
  assert.equal(result.reloaded.count, 1);
  assert.ok(result.reloaded.persistedId);
  assert.equal(result.style, null);
});

test("Library exposes editable bookmark metadata and removal", async () => {
  const result = await page.evaluate(async () => {
    const data = new Map();
    const storage = {
      async get(key, fallback) {
        return data.has(key) ? structuredClone(data.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        data.set(key, structuredClone(value));
      },
      async remove(key) {
        data.delete(key);
      }
    };
    const context = {
      storage,
      settings: { i18n: { locale: "en" } },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };
    document.body.replaceChildren();
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
      status.href = "/alice/status/888888";
    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Post actions");
    article.append(status, actions);
    document.body.append(article);
    await AviaryBookmarks.bookmarksFeature.init(context);
    const localButton = actions.querySelector("[data-av-local-bookmark]");
    localButton.click();
    await new Promise((resolve) => setTimeout(resolve, 15));

    let exportCalls = 0;
    const settings = AviaryBookmarks.cloneSettings(AviaryBookmarks.DEFAULT_SETTINGS);
    const panel = AviaryBookmarks.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {},
      getBookmarkStatus: () => AviaryBookmarks.bookmarkStatus(),
      searchBookmarks: (query) => {
        const needle = query.toLowerCase();
        return AviaryBookmarks.getBookmarks().filter((entry) =>
          `${entry.tweetId} ${entry.text} ${entry.handle}`.toLowerCase().includes(needle)
        );
      },
      updateBookmark: (id, input) => AviaryBookmarks.getBookmarkStore().update(id, input),
      removeBookmark: async (id) => {
        const store = AviaryBookmarks.getBookmarkStore();
        if (!store?.get(id)) return false;
        await store.remove(id);
        return true;
      },
      exportBookmarks: async () => {
        exportCalls += 1;
        return { records: AviaryBookmarks.getBookmarks().length, files: 2, filenames: ["bookmarks.json", "bookmarks.csv"] };
      },
      clearBookmarks: async () => AviaryBookmarks.getBookmarkStore().clear()
    });

    const host = document.getElementById("av-control-center");
    const shadow = host.shadowRoot;
    shadow.querySelector('[data-av-section="library"]').click();
    const hit = () => shadow.querySelector(".av-bookmark-hit");
    const fields = () => [...hit().querySelectorAll(".av-bookmark-field")];
    fields()[0].value = "research, #saved";
    fields()[1].value = "reading";
    fields()[2].value = "2026-08-20T10:30";
    hit().querySelector(".av-bookmark-notes").value = "Review this later";
    hit().querySelector(".av-inline-controls .av-button").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const updated = AviaryBookmarks.getBookmarks()[0];

    shadow.querySelector('[data-av-label="Export local bookmarks"] button').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const removeButtons = () => [...shadow.querySelectorAll(".av-bookmark-hit .av-inline-controls .av-button")];
    removeButtons()[1].click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterRemove = AviaryBookmarks.getBookmarks().length;
    panel.destroy();
    await AviaryBookmarks.bookmarksFeature.destroy(context);
    return { updated, afterRemove, exportCalls };
  });

  assert.deepEqual(result.updated.tags, ["research", "saved"]);
  assert.equal(result.updated.folder, "reading");
  assert.equal(result.updated.remindAt, "2026-08-20T14:30:00.000Z");
  assert.equal(result.updated.notes, "Review this later");
  assert.equal(result.afterRemove, 0);
  assert.equal(result.exportCalls, 1);
});

test("malformed persisted bookmarks are repaired or ignored before Library search sorts them", async () => {
  const result = await page.evaluate(async () => {
    const data = new Map([
      [
        "aviary.library.bookmarks.v1",
        {
          entries: [
            {
              id: "missing-updated",
              tweetId: "1",
              handle: "alice",
              text: "valid bookmark",
              capturedAt: "2026-08-10T00:00:00Z",
              tags: ["Reading", 42],
              updatedAt: undefined
            },
            {
              id: "bad-arrays",
              capturedAt: "2026-08-11T00:00:00Z",
              tags: "not-an-array",
              updatedAt: null,
              notes: null
            },
            { id: "bad-date", capturedAt: "not-a-date", updatedAt: "also-not-a-date" }
          ]
        }
      ]
    ]);
    const storage = {
      async get(key, fallback) {
        return data.has(key) ? structuredClone(data.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        data.set(key, structuredClone(value));
      },
      async remove(key) {
        data.delete(key);
      }
    };
    const context = {
      storage,
      settings: { i18n: { locale: "en" } },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };
    document.body.replaceChildren();
    await AviaryBookmarks.bookmarksFeature.init(context);
    const searched = AviaryBookmarks.searchBookmarks("");
    const state = searched.map((entry) => ({
      id: entry.id,
      updatedAt: entry.updatedAt,
      capturedAt: entry.capturedAt,
      tags: entry.tags
    }));
    await AviaryBookmarks.bookmarksFeature.destroy(context);
    return state;
  });

  assert.equal(result.length, 2, "the invalid timestamp record should be ignored");
  assert.ok(result.every((entry) => typeof entry.updatedAt === "string"));
  const repaired = result.find((entry) => entry.id === "missing-updated");
  assert.equal(repaired.updatedAt, repaired.capturedAt);
  assert.deepEqual(result.find((entry) => entry.id === "bad-arrays").tags, []);
});
