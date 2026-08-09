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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-runtime-reconcile-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { aiCommandMenuFeature } from ${JSON.stringify(abs("src/features/ai/command-menu.ts"))};`,
      `export { composerSnippetsFeature } from ${JSON.stringify(abs("src/features/composer/composer-snippets.ts"))};`,
      `export { cleanShareLinksFeature } from ${JSON.stringify(abs("src/features/library/clean-share-links.ts"))};`,
      `export { linkUnshortenFeature } from ${JSON.stringify(abs("src/features/library/link-unshorten.ts"))};`,
      `export { userNotesFeature, setUserNote } from ${JSON.stringify(abs("src/features/library/user-notes.ts"))};`,
      `export { hiddenPostsFeature, getHiddenPostStore } from ${JSON.stringify(abs("src/features/filtering/hidden-posts-feature.ts"))};`,
      `export { inlineOriginalImagesFeature } from ${JSON.stringify(abs("src/features/media/inline-original-images.ts"))};`,
      `export { mediaButtonsFeature } from ${JSON.stringify(abs("src/features/media/media-buttons.ts"))};`,
      `export { pauseOffscreenVideoFeature } from ${JSON.stringify(abs("src/features/performance/pause-offscreen-video.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryRuntime",
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

test("runtime features restore an already-rendered timeline when toggled off", async () => {
  const result = await page.evaluate(async () => {
    const settings = {
      ai: { commandMenu: false },
      composer: { snippets: [] },
      links: { expandTco: false, cleanShareButtons: false },
      media: {
        buttons: false,
        preferOriginalImages: true,
        filenameTemplate: "{handle}",
        downloadHistory: false,
        inlineOriginalImages: false
      },
      performance: { pauseOffscreenVideo: false },
      hidden: { enabled: false, buttons: false, surfaces: ["home"], maxEntries: 100 },
      integrations: {
        aria2: { enabled: false, endpoint: "", secret: "", minBytes: 50000000 },
        ai: { enabled: false, apiKey: "", provider: "openai", endpoint: "", model: "" }
      },
      i18n: { locale: "en" },
      accessibility: { reduceMotion: "never" }
    };
    const storage = {
      async get(key, fallback) {
        if (key === "aviary.userNotes.v1") {
          return { notes: { someone: "first note" }, updatedAt: null };
        }
        return fallback;
      },
      async set() {}
    };
    const context = {
      settings,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      storage,
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };

    document.body.replaceChildren();
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    const article = document.createElement("article");
    article.id = "tweet-123";
    article.setAttribute("data-testid", "tweet");

    const userName = document.createElement("div");
    userName.setAttribute("data-testid", "User-Name");
    const handle = document.createElement("a");
    handle.href = "/someone";
    handle.textContent = "@someone";
    userName.append(handle);

    const status = document.createElement("a");
    status.href = "/someone/status/123";
    status.textContent = "status";
    const text = document.createElement("div");
    text.setAttribute("data-testid", "tweetText");
    text.textContent = "A post with a link";

    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Post actions");

    const photo = document.createElement("div");
    photo.setAttribute("data-testid", "tweetPhoto");
    const image = document.createElement("img");
    image.src = "https://pbs.twimg.com/media/ABC12345?format=jpg&name=small";
    photo.append(image);

    const tco = document.createElement("a");
    tco.href = "https://t.co/abc";
    tco.setAttribute("aria-label", "https://example.com/article");
    tco.textContent = "https://t.co/abc";
    const shared = document.createElement("a");
    shared.href = "https://example.com/article?utm_source=x&keep=1";
    shared.textContent = "shared";

    const video = document.createElement("video");
    video.id = "timeline-video";
    video.paused = false;
    photo.append(video);
    article.append(userName, status, text, group, photo, tco, shared);
    cell.append(article);

    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-testid", "toolBar");
    document.body.append(cell, toolbar);

    await AviaryRuntime.userNotesFeature.init(context);
    await AviaryRuntime.hiddenPostsFeature.init(context);
    await AviaryRuntime.mediaButtonsFeature.init(context);
    AviaryRuntime.aiCommandMenuFeature.init(context);
    AviaryRuntime.composerSnippetsFeature.init(context);
    AviaryRuntime.linkUnshortenFeature.init(context);
    AviaryRuntime.cleanShareLinksFeature.init(context);
    AviaryRuntime.inlineOriginalImagesFeature.init(context);
    AviaryRuntime.pauseOffscreenVideoFeature.init(context);

    const applyAll = async () => {
      await AviaryRuntime.userNotesFeature.apply(context, document);
      await AviaryRuntime.hiddenPostsFeature.apply(context, document);
      await AviaryRuntime.mediaButtonsFeature.apply(context, document);
      await AviaryRuntime.aiCommandMenuFeature.apply(context, document);
      await AviaryRuntime.composerSnippetsFeature.apply(context, document);
      await AviaryRuntime.linkUnshortenFeature.apply(context, document);
      await AviaryRuntime.cleanShareLinksFeature.apply(context, document);
      await AviaryRuntime.inlineOriginalImagesFeature.apply(context, document);
      await AviaryRuntime.pauseOffscreenVideoFeature.apply(context, document);
    };

    const offState = () => ({
      ai: document.querySelectorAll("[data-av-ai-trigger]").length,
      snippets: document.querySelectorAll('[data-av-snippet-palette="trigger"]').length,
      media: document.querySelectorAll("[data-av-media-button]").length,
      hiddenButtons: document.querySelectorAll("[data-av-hide-button]").length,
      hiddenMarkers: document.querySelectorAll("[data-av-hidden], [data-av-post-key], [data-av-hide-state]").length,
      cleanMarkers: document.querySelectorAll("[data-av-share-clean]").length,
      linkMarkers: document.querySelectorAll("[data-av-link-clean]").length,
      originalMarkers: document.querySelectorAll("[data-av-orig-image]").length,
      videoMarkers: document.querySelectorAll("[data-av-perf-video], [data-av-perf-paused]").length,
      classes: {
        media: document.documentElement.classList.contains("av-media-buttons-enabled"),
        hidden: document.documentElement.classList.contains("av-hide-posts-enabled")
      }
    });

    const initial = offState();
    settings.ai.commandMenu = true;
    settings.composer.snippets = ["first snippet"];
    settings.links.expandTco = true;
    settings.links.cleanShareButtons = true;
    settings.media.buttons = true;
    settings.media.inlineOriginalImages = true;
    settings.performance.pauseOffscreenVideo = true;
    settings.hidden.enabled = true;
    settings.hidden.buttons = true;
    await applyAll();

    const onState = {
      ai: document.querySelectorAll("[data-av-ai-trigger]").length,
      snippets: document.querySelectorAll('[data-av-snippet-palette="trigger"]').length,
      media: document.querySelectorAll("[data-av-media-button]").length,
      hiddenButtons: document.querySelectorAll("[data-av-hide-button]").length,
      cleanHref: shared.getAttribute("href"),
      expandedText: tco.textContent,
      note: userName.querySelector("[data-av-note-badge]")?.getAttribute("title"),
      original: image.getAttribute("src"),
      hiddenClass: document.documentElement.classList.contains("av-hide-posts-enabled"),
      videoMarker: video.getAttribute("data-av-perf-video")
    };

    const snippetTrigger = document.querySelector('[data-av-snippet-palette="trigger"]');
    snippetTrigger.click();
    const snippetBefore = document.querySelector('[data-av-snippet-palette="popover"] button')?.textContent;
    settings.composer.snippets = ["second snippet"];
    await AviaryRuntime.composerSnippetsFeature.apply(context, document);
    const paletteClosedAfterUpdate =
      document.querySelector('[data-av-snippet-palette="popover"]') === null;
    snippetTrigger.click();
    const snippetAfter = document.querySelector('[data-av-snippet-palette="popover"] button')?.textContent;

    const store = AviaryRuntime.getHiddenPostStore();
    await store.hide({ key: "id:123", tweetId: "123", handle: "someone", text: text.textContent }, 100);
    await AviaryRuntime.hiddenPostsFeature.apply(context, document);
    const collapsed = cell.getAttribute("data-av-hidden");

    settings.ai.commandMenu = false;
    settings.composer.snippets = [];
    settings.links.expandTco = false;
    settings.links.cleanShareButtons = false;
    settings.media.buttons = false;
    settings.media.inlineOriginalImages = false;
    settings.performance.pauseOffscreenVideo = false;
    settings.hidden.enabled = false;
    settings.hidden.buttons = false;
    await applyAll();

    await AviaryRuntime.setUserNote("someone", "updated note");
    await AviaryRuntime.userNotesFeature.apply(context, document);
    const updatedNote = userName.querySelector("[data-av-note-badge]")?.getAttribute("title");
    await AviaryRuntime.setUserNote("someone", "");
    await AviaryRuntime.userNotesFeature.apply(context, document);

    await AviaryRuntime.userNotesFeature.destroy(context);
    await AviaryRuntime.hiddenPostsFeature.destroy(context);
    await AviaryRuntime.mediaButtonsFeature.destroy(context);
    await AviaryRuntime.aiCommandMenuFeature.destroy(context);
    await AviaryRuntime.composerSnippetsFeature.destroy(context);
    await AviaryRuntime.linkUnshortenFeature.destroy(context);
    await AviaryRuntime.cleanShareLinksFeature.destroy(context);
    await AviaryRuntime.inlineOriginalImagesFeature.destroy(context);
    await AviaryRuntime.pauseOffscreenVideoFeature.destroy(context);

    return {
      initial,
      onState,
      snippetBefore,
      snippetAfter,
      paletteClosedAfterUpdate,
      collapsed,
      updatedNote,
      final: {
        ...offState(),
        restoredHref: shared.getAttribute("href"),
        restoredText: tco.textContent,
        restoredImage: image.getAttribute("src"),
        restoredTitle: tco.getAttribute("title"),
        noteBadges: document.querySelectorAll("[data-av-note-badge]").length,
        cellHidden: cell.getAttribute("data-av-hidden")
      }
    };
  });

  assert.deepEqual(result.initial, {
    ai: 0,
    snippets: 0,
    media: 0,
    hiddenButtons: 0,
    hiddenMarkers: 0,
    cleanMarkers: 0,
    linkMarkers: 0,
    originalMarkers: 0,
    videoMarkers: 0,
    classes: { media: false, hidden: false }
  });
  assert.equal(result.onState.ai, 1);
  assert.equal(result.onState.snippets, 1);
  assert.equal(result.onState.media, 1);
  assert.equal(result.onState.hiddenButtons, 1);
  assert.equal(result.onState.cleanHref, "https://example.com/article?keep=1");
  assert.equal(result.onState.expandedText, "https://example.com/article");
  assert.equal(result.onState.note, "first note");
  assert.match(result.onState.original, /name=orig/);
  assert.equal(result.onState.hiddenClass, true);
  assert.equal(result.onState.videoMarker, "1");
  assert.equal(result.snippetBefore, "first snippet");
  assert.equal(result.snippetAfter, "second snippet");
  assert.equal(result.paletteClosedAfterUpdate, true);
  assert.equal(result.collapsed, "1");
  assert.equal(result.updatedNote, "updated note");
  assert.equal(result.final.ai, 0);
  assert.equal(result.final.snippets, 0);
  assert.equal(result.final.media, 0);
  assert.equal(result.final.hiddenButtons, 0);
  assert.equal(result.final.hiddenMarkers, 0);
  assert.equal(result.final.cleanMarkers, 0);
  assert.equal(result.final.linkMarkers, 0);
  assert.equal(result.final.originalMarkers, 0);
  assert.equal(result.final.videoMarkers, 0);
  assert.deepEqual(result.final.classes, { media: false, hidden: false });
  assert.equal(result.final.restoredHref, "https://example.com/article?utm_source=x&keep=1");
  assert.equal(result.final.restoredText, "https://t.co/abc");
  assert.equal(result.final.restoredImage, "https://pbs.twimg.com/media/ABC12345?format=jpg&name=small");
  assert.equal(result.final.restoredTitle, null);
  assert.equal(result.final.noteBadges, 0);
  assert.equal(result.final.cellHidden, null);
});
