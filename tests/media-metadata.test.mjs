import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const absoluteSource = (relativePath) =>
  path.resolve(root, relativePath).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-media-metadata-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { MediaMetadataCache } from ${JSON.stringify(absoluteSource("src/features/media/media-metadata.ts"))};`,
      `export { extractTweet } from ${JSON.stringify(absoluteSource("src/features/media/extract.ts"))};`,
      `export { collectExportRecords } from ${JSON.stringify(absoluteSource("src/features/export/collector.ts"))};`,
      `export { mediaButtonsFeature, ingestMediaMetadata, mediaMetadataCacheSize } from ${JSON.stringify(absoluteSource("src/features/media/media-buttons.ts"))};`,
      `export { DEFAULT_SETTINGS } from ${JSON.stringify(absoluteSource("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryMedia",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const metadataBody = JSON.stringify({
  data: {
    home: {
      instructions: [
        {
          entries: [
            {
              content: {
                itemContent: {
                  tweet_results: {
                    result: {
                      rest_id: "123456789",
                      legacy: {
                        extended_entities: {
                          media: [
                            {
                              type: "video",
                              media_key: "7_456789",
                              preview_image_url_https:
                                "https://pbs.twimg.com/media/456789?format=jpg&name=small",
                              video_info: {
                                variants: [
                                  {
                                    content_type: "video/mp4",
                                    url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4",
                                    bitrate: 2176000
                                  }
                                ]
                              }
                            }
                          ]
                        }
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      ]
    }
  }
});

test("GraphQL media metadata is bounded, keyed, and rejects ambiguous matches", async () => {
  const result = await page.evaluate((body) => {
    const cache = new AviaryMedia.MediaMetadataCache();
    const changed = cache.ingest({ body });
    const found = cache.find(
      "123456789",
      null,
      "https://pbs.twimg.com/media/456789?format=jpg&name=900x900"
    );
    return {
      changed,
      size: cache.size,
      found,
      wrongTweet: cache.find("999999999", "456789"),
      wrongMedia: cache.find("123456789", "999999")
    };
  }, metadataBody);

  assert.equal(result.changed, 1);
  assert.equal(result.size, 1);
  assert.equal(result.found.tweetId, "123456789");
  assert.equal(result.found.mediaId, "456789");
  assert.equal(result.found.poster, "https://pbs.twimg.com/media/456789?format=jpg&name=small");
  assert.equal(
    result.found.variants[0].url,
    "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4"
  );
  assert.equal(result.wrongTweet, null);
  assert.equal(result.wrongMedia, null);
});

test("repeated GraphQL URLs merge richer dimensions and bitrate before a blob player ranks them", async () => {
  const body = JSON.stringify({
    data: {
      tweetResult: {
        rest_id: "333333333",
        legacy: {
          extended_entities: {
            media: [{
              type: "video",
              media_key: "7_333333",
              preview_image_url_https: "https://pbs.twimg.com/media/333333?format=jpg&name=small",
              video_info: {
                variants: [
                  {
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/333/shared.mp4?token=signed"
                  },
                  {
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/333/pu/vid/640x360/low.mp4",
                    width: 640,
                    height: 360,
                    bitrate: 500000
                  },
                  {
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/333/shared.mp4?token=signed",
                    width: 1920,
                    height: 1080,
                    bitrate: 8000000,
                    codec: "h264"
                  }
                ]
              }
            }]
          }
        }
      }
    }
  });

  const result = await page.evaluate((body) => {
    const cache = new AviaryMedia.MediaMetadataCache();
    cache.ingest({ body });
    const found = cache.find("333333333", "333333");
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/owner/status/333333333";
    article.append(status);
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoComponent");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/333333?format=jpg&name=small";
    video.src = "blob:https://x.com/enriched-player";
    player.append(video);
    article.append(player);
    const tweet = AviaryMedia.extractTweet(article, {
      mediaMetadata: ({ tweetId, mediaId, poster }) => cache.find(tweetId, mediaId, poster)
    });
    const videoMedia = tweet.media.find((entry) => entry.kind === "video");
    return {
      variants: found?.variants ?? [],
      preferred: videoMedia?.video?.preferred ?? null
    };
  }, body);

  assert.deepEqual(result.variants.find((variant) => variant.url.includes("shared.mp4")), {
    url: "https://video.twimg.com/ext_tw_video/333/shared.mp4?token=signed",
    type: "video/mp4",
    width: 1920,
    height: 1080,
    bitrate: 8000000,
    codec: "h264"
  });
  assert.equal(result.preferred?.url, "https://video.twimg.com/ext_tw_video/333/shared.mp4?token=signed");
  assert.equal(result.preferred?.width, 1920);
  assert.equal(result.preferred?.height, 1080);
  assert.equal(result.preferred?.bitrate, 8000000);
});

test("captured media metadata keeps direct audio and caption tracks with the player", async () => {
  const body = JSON.stringify({
    data: {
      tweetResult: {
        rest_id: "987654321",
        legacy: {
          extended_entities: {
            media: [{
              type: "video",
              media_key: "7_888888",
              preview_image_url_https: "https://pbs.twimg.com/media/888888?format=jpg&name=small",
              video_info: {
                variants: [
                  {
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/987/pu/vid/1920x1080/main.mp4",
                    bitrate: 4_000_000
                  },
                  {
                    content_type: "audio/mp4",
                    url: "https://video.twimg.com/ext_tw_audio/987/track.m4a",
                    bitrate: 192_000
                  }
                ],
                captions: [{
                  url: "https://video.twimg.com/ext_tw_video/987/captions-en.vtt",
                  language: "en",
                  label: "English"
                }]
              }
            }]
          }
        }
      }
    }
  });

  const result = await page.evaluate((metadataBody) => {
    const cache = new AviaryMedia.MediaMetadataCache();
    cache.ingest({ body: metadataBody });
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/someone/status/987654321";
    article.append(status);
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/888888?format=jpg&name=small";
    video.src = "blob:https://x.com/captured-player";
    player.append(video);
    article.append(player);
    const tweet = AviaryMedia.extractTweet(article, {
      mediaMetadata: ({ tweetId, mediaId, poster }) => cache.find(tweetId, mediaId, poster)
    });
    return {
      cached: cache.find("987654321", "888888"),
      media: tweet.media.map((entry) => ({
        kind: entry.kind,
        url: entry.audio?.preferred?.url ?? entry.subtitle?.track.url ?? entry.video?.preferred?.url ?? null,
        language: entry.subtitle?.track.language ?? null
      }))
    };
  }, body);

  assert.equal(result.cached.audioVariants[0].url, "https://video.twimg.com/ext_tw_audio/987/track.m4a");
  assert.deepEqual(result.cached.subtitleTracks[0], {
    url: "https://video.twimg.com/ext_tw_video/987/captions-en.vtt",
    type: "text/vtt",
    language: "en",
    label: "English"
  });
  assert.deepEqual(result.media, [
    {
      kind: "video",
      url: "https://video.twimg.com/ext_tw_video/987/pu/vid/1920x1080/main.mp4",
      language: null
    },
    {
      kind: "audio",
      url: "https://video.twimg.com/ext_tw_audio/987/track.m4a",
      language: null
    },
    {
      kind: "subtitle",
      url: "https://video.twimg.com/ext_tw_video/987/captions-en.vtt",
      language: "en"
    },
    { kind: "thumbnail", url: null, language: null }
  ]);
});

test("export collection includes direct audio and caption downloads", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/someone/status/246813579";
    article.append(status);
    const audio = document.createElement("audio");
    audio.src = "https://video.twimg.com/ext_tw_audio/246/track.m4a";
    const track = document.createElement("track");
    track.kind = "captions";
    track.src = "https://video.twimg.com/ext_tw_video/246/captions-en.vtt";
    track.srclang = "en";
    track.label = "English";
    audio.append(track);
    article.append(audio);
    document.body.append(article);
    return AviaryMedia.collectExportRecords(document, "home");
  });

  assert.deepEqual(result[0].media, [
    {
      kind: "audio",
      url: "https://video.twimg.com/ext_tw_audio/246/track.m4a",
      type: "audio/mp4"
    },
    {
      kind: "subtitle",
      url: "https://video.twimg.com/ext_tw_video/246/captions-en.vtt",
      type: "text/vtt",
      language: "en",
      label: "English"
    }
  ]);
});

test("DOM export collection keeps a tweet language tag and rejects markup-looking tags", async () => {
  const result = await page.evaluate(() => {
    const make = (language) => {
      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      const status = document.createElement("a");
      status.href = "/someone/status/246813580";
      const text = document.createElement("div");
      text.setAttribute("data-testid", "tweetText");
      text.setAttribute("lang", language);
      text.textContent = language === "ar" ? "مرحبا, @alice" : "invalid";
      article.append(status, text);
      return article;
    };
    document.body.replaceChildren(make("ar"), make("<script>"));
    return AviaryMedia.collectExportRecords(document, "home").map((record) => record.language);
  });

  assert.deepEqual(result, ["ar", null]);
});

test("MSE extraction keeps the real player as the video and thumbnail anchor", async () => {
  const result = await page.evaluate((body) => {
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/someone/status/123456789";
    article.append(status);
    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    const reply = document.createElement("button");
    reply.setAttribute("data-testid", "reply");
    actions.append(reply);
    article.append(actions);

    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/456789?format=jpg&name=small";
    video.src = "blob:https://x.com/mse-player";
    player.append(video);
    article.append(player);

    const cache = new AviaryMedia.MediaMetadataCache();
    cache.ingest({ body });
    const tweet = AviaryMedia.extractTweet(article, {
      mediaMetadata: ({ tweetId, mediaId, poster }) => cache.find(tweetId, mediaId, poster)
    });
    return tweet.media.map((media) => ({
      kind: media.kind,
      sourceIsPlayer: media.source === player,
      target: media.video?.preferred?.url ?? media.image?.url ?? null
    }));
  }, metadataBody);

  assert.deepEqual(result, [
    {
      kind: "video",
      sourceIsPlayer: true,
      target: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4"
    },
    {
      kind: "thumbnail",
      sourceIsPlayer: true,
      target: "https://pbs.twimg.com/media/456789?format=jpg&name=orig"
    }
  ]);
});

test("current X nested video containers produce one set of controls", async () => {
  const result = await page.evaluate((body) => {
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/someone/status/123456789";
    article.append(status);

    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    const component = document.createElement("div");
    component.setAttribute("data-testid", "videoComponent");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/456789?format=jpg&name=small";
    video.src = "blob:https://x.com/nested-mse-player";
    component.append(video);
    player.append(component);
    article.append(player);

    const cache = new AviaryMedia.MediaMetadataCache();
    cache.ingest({ body });
    const tweet = AviaryMedia.extractTweet(article, {
      mediaMetadata: ({ tweetId, mediaId, poster }) => cache.find(tweetId, mediaId, poster)
    });
    return tweet.media.map((media) => ({
      kind: media.kind,
      sourceIsComponent: media.source === component,
      sourceIsPlayer: media.source === player
    }));
  }, metadataBody);

  assert.deepEqual(result, [
    { kind: "video", sourceIsComponent: true, sourceIsPlayer: false },
    { kind: "thumbnail", sourceIsComponent: true, sourceIsPlayer: false }
  ]);
});

test("media buttons reconcile a blob-only player when its direct variant arrives", async () => {
  const result = await page.evaluate(async (body) => {
    const settings = {
      media: {
        buttons: true,
        preferOriginalImages: true,
        filenameTemplate: "{handle}_{tweetId}_{index}",
        downloadHistory: false,
        zipChunkSize: 250
      },
      integrations: {
        aria2: { enabled: false, endpoint: "", secret: "", minBytes: 50000000 }
      },
      i18n: { locale: "en" }
    };
    const storage = {
      async get(_key, fallback) {
        return fallback;
      },
      async set() {}
    };
    const ctx = {
      settings,
      storage,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };

    document.body.replaceChildren();
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/someone/status/123456789";
    article.append(status);
    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    const reply = document.createElement("button");
    reply.setAttribute("data-testid", "reply");
    actions.append(reply);
    article.append(actions);
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoComponent");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/456789?format=jpg&name=small";
    video.src = "blob:https://x.com/mse-player";
    player.append(video);
    article.append(player);
    document.body.append(article);

    await AviaryMedia.mediaButtonsFeature.init(ctx);
    const actionBefore = article.querySelector("[data-av-media-action]");
    const before = [...document.querySelectorAll("[data-av-media-button]")].map((button) => ({
      kind: button.dataset.kind,
      text: button.textContent,
      top: button.style.top,
      opacity: getComputedStyle(button).opacity
    }));

    AviaryMedia.ingestMediaMetadata({ body });
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    const actionDuring = article.querySelector("[data-av-media-action]");
    const during = [...document.querySelectorAll("[data-av-media-button]")].map((button) => ({
      kind: button.dataset.kind,
      text: button.textContent,
      top: button.style.top,
      opacity: getComputedStyle(button).opacity
    }));

    settings.media.buttons = false;
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    const off = document.querySelectorAll("[data-av-media-button]").length;
    const actionOff = document.querySelectorAll("[data-av-media-action]").length;
    await AviaryMedia.mediaButtonsFeature.destroy(ctx);
    return {
      before,
      during,
      off,
      actionBefore: {
        text: actionBefore?.textContent ?? null,
        disabled: actionBefore instanceof HTMLButtonElement ? actionBefore.disabled : null
      },
      actionDuring: {
        text: actionDuring?.textContent ?? null,
        disabled: actionDuring instanceof HTMLButtonElement ? actionDuring.disabled : null
      },
      actionOff
    };
  }, metadataBody);

  assert.deepEqual(result.before, [
    { kind: "thumbnail", text: "↓ Thumb", top: "8px", opacity: "1" }
  ]);
  assert.deepEqual(result.during, [
    { kind: "video", text: "↓ Video", top: "8px", opacity: "1" },
    { kind: "thumbnail", text: "↓ Thumb", top: "48px", opacity: "1" }
  ]);
  assert.equal(result.off, 0);
  assert.deepEqual(result.actionBefore, { text: "↓ Download", disabled: false });
  assert.deepEqual(result.actionDuring, { text: "↓ Download", disabled: false });
  assert.equal(result.actionOff, 0);
});

test("a pending video download stays actionable and uses the best variant when metadata arrives", async () => {
  const result = await page.evaluate(async (body) => {
    document.body.replaceChildren();
    const transfers = [];
    globalThis.GM_download = ({ url, name, onload }) => {
      transfers.push({ url, name });
      queueMicrotask(() => onload?.());
    };

    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const userName = document.createElement("div");
    userName.setAttribute("data-testid", "User-Name");
    const profile = document.createElement("a");
    profile.href = "/someone";
    userName.append(profile);
    const status = document.createElement("a");
    status.href = "/someone/status/123456789";
    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    const reply = document.createElement("button");
    reply.setAttribute("data-testid", "reply");
    actions.append(reply);
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoComponent");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/456789?format=jpg&name=small";
    video.src = "blob:https://x.com/mse-player";
    player.append(video);
    article.append(userName, status, actions, player);
    document.body.append(article);

    const settings = structuredClone(AviaryMedia.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    const storage = {
      async get(_key, fallback) {
        return fallback;
      },
      async set() {}
    };
    const ctx = {
      settings,
      storage,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };

    try {
      await AviaryMedia.mediaButtonsFeature.init(ctx);
      const action = article.querySelector("[data-av-media-action]");
      if (!(action instanceof HTMLButtonElement)) throw new Error("Pending action missing");
      const initial = { text: action.textContent, disabled: action.disabled };
      action.click();
      const finding = {
        text: action.textContent,
        disabled: action.disabled,
        busy: action.getAttribute("aria-busy")
      };
      setTimeout(() => AviaryMedia.ingestMediaMetadata({ body }), 100);
      const deadline = performance.now() + 3_000;
      while (transfers.length === 0 && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return { initial, finding, transfers, finalText: action.textContent };
    } finally {
      await AviaryMedia.mediaButtonsFeature.destroy(ctx);
      delete globalThis.GM_download;
    }
  }, metadataBody);

  assert.deepEqual(result.initial, { text: "↓ Download", disabled: false });
  assert.deepEqual(result.finding, {
    text: "↻ Downloading…",
    disabled: true,
    busy: "true"
  });
  assert.deepEqual(result.transfers, [
    {
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4",
      name: "someone_123456789_01.mp4"
    }
  ]);
  assert.equal(result.finalText, "✓ Saved");
});

test("a queued page-bridge observation makes a blob-backed video downloadable after boot", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const transfers = [];
    globalThis.GM_download = ({ url, name, onload }) => {
      transfers.push({ url, name });
      queueMicrotask(() => onload?.());
    };

    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const userName = document.createElement("div");
    userName.setAttribute("data-testid", "User-Name");
    const profile = document.createElement("a");
    profile.href = "/early_owner";
    userName.append(profile);
    const status = document.createElement("a");
    status.href = "/early-owner/status/123456789";
    const actions = document.createElement("div");
    actions.setAttribute("role", "group");
    const reply = document.createElement("button");
    reply.setAttribute("data-testid", "reply");
    actions.append(reply);
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoComponent");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/EarlyMedia1?format=jpg&name=small";
    video.src = "blob:https://x.com/early-player";
    player.append(video);
    article.append(userName, status, actions, player);
    document.body.append(article);

    const queued = {
      tweetId: "123456789",
      mediaId: "EarlyMedia1",
      poster: "https://pbs.twimg.com/media/EarlyMedia1?format=jpg&name=small",
      variants: [{
        url: "https://video.twimg.com/ext_tw_video/early/pu/vid/1280x720/direct.mp4",
        type: "video/mp4",
        width: 1280,
        height: 720,
        bitrate: 2176000
      }],
      audioVariants: [],
      subtitleTracks: [],
      isGif: false
    };
    const queuedItems = [queued];
    const handlers = new Set();
    let subscribeCount = 0;
    const bridge = {
      onMediaMetadata(handler) {
        subscribeCount += 1;
        handlers.add(handler);
        for (const item of queuedItems.splice(0)) handler(item);
      },
      offMediaMetadata(handler) {
        handlers.delete(handler);
      },
      on() {},
      off() {}
    };
    const settings = structuredClone(AviaryMedia.DEFAULT_SETTINGS);
    settings.media.downloadHistory = false;
    const storage = {
      async get(_key, fallback) {
        return fallback;
      },
      async set() {}
    };
    const ctx = {
      settings,
      storage,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      pageBridge: bridge,
      requestApply() {}
    };

    try {
      await AviaryMedia.mediaButtonsFeature.init(ctx);
      const action = article.querySelector("[data-av-media-action]");
      const initial = { text: action?.textContent, disabled: action?.disabled };
      action?.click();
      const deadline = performance.now() + 2_000;
      while (transfers.length === 0 && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        initial,
        transfers,
        subscribeCount,
        remainingQueued: queuedItems.length,
        handlerCount: handlers.size,
        finalText: action?.textContent
      };
    } finally {
      await AviaryMedia.mediaButtonsFeature.destroy(ctx);
      delete globalThis.GM_download;
    }
  });

  assert.deepEqual(result.initial, { text: "↓ Download", disabled: false });
  assert.deepEqual(result.transfers, [{
    url: "https://video.twimg.com/ext_tw_video/early/pu/vid/1280x720/direct.mp4",
    name: "early_owner_123456789_01.mp4"
  }]);
  assert.equal(result.subscribeCount, 1);
  assert.equal(result.remainingQueued, 0, "startup metadata must be consumed exactly once");
  assert.equal(result.handlerCount, 1);
  assert.equal(result.finalText, "✓ Saved");
});

test("media buttons reattach when X recycles a processed post's media subtree", async () => {
  const result = await page.evaluate(async () => {
    document.body.replaceChildren();
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/photographer/status/99887766";
    article.append(status);

    const buildActions = () => {
      const actions = document.createElement("div");
      actions.setAttribute("role", "group");
      const reply = document.createElement("button");
      reply.setAttribute("data-testid", "reply");
      actions.append(reply);
      return actions;
    };
    const firstActions = buildActions();
    article.append(firstActions);

    const buildPhoto = (mediaId) => {
      const photo = document.createElement("div");
      photo.setAttribute("data-testid", "tweetPhoto");
      const image = document.createElement("img");
      image.src = `https://pbs.twimg.com/media/${mediaId}?format=jpg&name=small`;
      photo.append(image);
      return { photo, image };
    };

    const first = buildPhoto("FirstVirtualizedPhoto");
    article.append(first.photo);
    document.body.append(article);

    const settings = structuredClone(AviaryMedia.DEFAULT_SETTINGS);
    const storage = {
      async get(_key, fallback) {
        return fallback;
      },
      async set() {}
    };
    const ctx = {
      settings,
      storage,
      route: { surface: "home", path: "/home", href: "https://x.com/home" },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    };

    await AviaryMedia.mediaButtonsFeature.init(ctx);
    const initialButton = first.photo.querySelector('[data-av-media-button="photo"]');
    const initialAction = firstActions.querySelector("[data-av-media-action]");
    const processedBefore = article.getAttribute("data-av-media-processed");

    const replacement = buildPhoto("ReplacementVirtualizedPhoto");
    const replacementActions = buildActions();
    first.photo.replaceWith(replacement.photo);
    firstActions.replaceWith(replacementActions);
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document, [replacement.image, replacementActions]);

    const replacementButton = replacement.photo.querySelector(
      '[data-av-media-button="photo"]'
    );
    const output = {
      initialText: initialButton?.textContent ?? null,
      initialConnected: initialButton?.isConnected ?? null,
      processedBefore,
      replacementText: replacementButton?.textContent ?? null,
      replacementContainer: replacementButton?.parentElement === replacement.photo,
      buttonCount: article.querySelectorAll("[data-av-media-button]").length,
      initialActionConnected: initialAction?.isConnected ?? null,
      replacementActionText:
        replacementActions.querySelector("[data-av-media-action]")?.textContent ?? null,
      actionCount: article.querySelectorAll("[data-av-media-action]").length
    };
    await AviaryMedia.mediaButtonsFeature.destroy(ctx);
    return output;
  });

  assert.deepEqual(result, {
    initialText: "↓ Download",
    initialConnected: false,
    processedBefore: "1",
    replacementText: "↓ Download",
    replacementContainer: true,
    buttonCount: 1,
    initialActionConnected: false,
    replacementActionText: "↓ Download",
    actionCount: 1
  });
});

test("default media controls transfer both image and direct video bytes", async () => {
  await page.route("https://pbs.twimg.com/media/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/jpeg",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    })
  );
  await page.route("https://video.twimg.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "video/mp4",
      headers: { "access-control-allow-origin": "*" },
      body: Buffer.from("fixture-mp4")
    })
  );

  try {
    const result = await page.evaluate(async (body) => {
      document.body.replaceChildren();
      const transfers = [];
      // The feature registers more than one runtime listener -- the native context-menu handler and
      // the one that waits for a browser download's terminal state -- so this keeps the set rather
      // than the last one added, and reports that destroy took them all back off.
      const runtimeListeners = new Set();
      const extensionMessageListener = (message, sender, respond) => {
        let keptOpen = false;
        for (const listener of runtimeListeners) {
          keptOpen = listener(message, sender, respond) === true || keptOpen;
        }
        return keptOpen;
      };
      const chromeRoot = globalThis.chrome ?? {};
      const originalRuntime = chromeRoot.runtime;
      globalThis.chrome = chromeRoot;
      chromeRoot.runtime = {
        id: "fixture-extension",
        onMessage: {
          addListener(listener) {
            runtimeListeners.add(listener);
          },
          removeListener(listener) {
            runtimeListeners.delete(listener);
          }
        }
      };
      globalThis.GM_download = ({ url, name, onload, onerror }) => {
        void fetch(url)
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            transfers.push({
              url,
              name,
              byteLength: bytes.byteLength,
              contentType: response.headers.get("content-type")
            });
            onload?.();
          })
          .catch((error) => onerror?.(error));
      };

      const appendIdentity = (article, handle, tweetId, text) => {
        const userName = document.createElement("div");
        userName.setAttribute("data-testid", "User-Name");
        const profile = document.createElement("a");
        profile.href = `/${handle}`;
        userName.append(profile);
        const status = document.createElement("a");
        status.href = `/${handle}/status/${tweetId}`;
        const copy = document.createElement("div");
        copy.setAttribute("data-testid", "tweetText");
        copy.textContent = text;
        const actions = document.createElement("div");
        actions.setAttribute("role", "group");
        const reply = document.createElement("button");
        reply.setAttribute("data-testid", "reply");
        actions.append(reply);
        article.append(userName, status, copy, actions);
      };

      const imageArticle = document.createElement("article");
      imageArticle.id = "default-image-tweet";
      imageArticle.setAttribute("data-testid", "tweet");
      appendIdentity(imageArticle, "photographer", "22334455", "A default image save");
      const photo = document.createElement("div");
      photo.setAttribute("data-testid", "tweetPhoto");
      const image = document.createElement("img");
      image.src = "https://pbs.twimg.com/media/DefaultPhoto?format=jpg&name=small";
      photo.append(image);
      imageArticle.append(photo);

      const videoArticle = document.createElement("article");
      videoArticle.id = "default-video-tweet";
      videoArticle.setAttribute("data-testid", "tweet");
      appendIdentity(videoArticle, "videographer", "123456789", "A direct video save");
      const player = document.createElement("div");
      player.setAttribute("data-testid", "videoComponent");
      const video = document.createElement("video");
      video.poster = "https://pbs.twimg.com/media/456789?format=jpg&name=small";
      video.src = "blob:https://x.com/default-media-player";
      player.append(video);
      videoArticle.append(player);
      document.body.append(imageArticle, videoArticle);

      const settings = structuredClone(AviaryMedia.DEFAULT_SETTINGS);
      settings.media.downloadHistory = false;
      const storage = {
        async get(_key, fallback) {
          return fallback;
        },
        async set() {}
      };
      const ctx = {
        settings,
        storage,
        route: { surface: "home", path: "/home", href: "https://x.com/home" },
        diagnostics: { info() {}, warn() {}, error() {} },
        auditLog: { record() {} },
        requestApply() {}
      };

      let output;
      try {
        AviaryMedia.ingestMediaMetadata({ body });
        await AviaryMedia.mediaButtonsFeature.init(ctx);
        const imageButton = imageArticle.querySelector("[data-av-media-action]");
        const videoButton = videoArticle.querySelector("[data-av-media-action]");
        const directVideoButton = videoArticle.querySelector('[data-av-media-button="video"]');
        if (!(imageButton instanceof HTMLButtonElement)) throw new Error("Default image button missing");
        if (!(videoButton instanceof HTMLButtonElement)) throw new Error("Default video button missing");
        if (!(directVideoButton instanceof HTMLButtonElement)) throw new Error("Direct video button missing");

        imageButton.click();
        videoButton.click();
        const runningState = {
          text: videoButton.textContent,
          busy: videoButton.getAttribute("aria-busy"),
          disabled: videoButton.disabled,
          state: videoButton.dataset.state
        };
        const deadline = performance.now() + 2_000;
        while (transfers.length < 2 && performance.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (transfers.length !== 2) throw new Error("Default media transfers did not finish");

        const completedState = {
          text: videoButton.textContent,
          busy: videoButton.getAttribute("aria-busy"),
          disabled: videoButton.disabled,
          state: videoButton.dataset.state
        };
        directVideoButton.click();
        const repeatRunningState = {
          text: directVideoButton.textContent,
          busy: directVideoButton.getAttribute("aria-busy"),
          disabled: directVideoButton.disabled
        };
        const repeatDeadline = performance.now() + 2_000;
        while (transfers.length < 3 && performance.now() < repeatDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (transfers.length !== 3) throw new Error("Repeat video transfer did not finish");

        const buttonTransfers = structuredClone(transfers);
        transfers.length = 0;
        const invokeContextDownload = async (target) => {
          const nativeMenuPreserved = target.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
          );
          if (runtimeListeners.size === 0) throw new Error("Context download listener missing");
          const response = await new Promise((resolve) => {
            const keptOpen = extensionMessageListener(
              { type: "AVIARY_DOWNLOAD_CONTEXT_MEDIA", documentUrl: "https://x.com/home" },
              { id: "fixture-extension" },
              resolve
            );
            if (keptOpen !== true) throw new Error("Context download response channel closed");
          });
          return { nativeMenuPreserved, response };
        };

        const videoContext = await invokeContextDownload(video);
        const imageContext = await invokeContextDownload(image);
        if (transfers.length !== 2) throw new Error("Context media transfers did not finish");

        output = {
          defaultEnabled: settings.media.buttons,
          imageButton: imageButton.textContent,
          videoButton: videoButton.textContent,
          runningState,
          completedState,
          repeatRunningState,
          buttonTransfers: buttonTransfers.sort((a, b) => a.url.localeCompare(b.url)),
          contextTransfers: transfers.sort((a, b) => a.url.localeCompare(b.url)),
          contextResults: { videoContext, imageContext }
        };
      } finally {
        await AviaryMedia.mediaButtonsFeature.destroy(ctx);
        delete globalThis.GM_download;
        chromeRoot.runtime = originalRuntime;
        output = { ...output, listenerRemoved: runtimeListeners.size === 0 };
      }
      return output;
    }, metadataBody);

    assert.equal(result.defaultEnabled, true);
    assert.equal(result.imageButton, "✓ Saved");
    assert.equal(result.videoButton, "✓ Saved");
    assert.deepEqual(result.runningState, {
      text: "↻ Downloading…",
      busy: "true",
      disabled: true,
      state: "active"
    });
    assert.deepEqual(result.completedState, {
      text: "✓ Saved",
      busy: "false",
      disabled: false,
      state: "success"
    });
    assert.deepEqual(result.repeatRunningState, {
      text: "↻ Downloading…",
      busy: "true",
      disabled: true
    });
    const expectedTransfers = [
      {
        url: "https://pbs.twimg.com/media/DefaultPhoto?format=jpg&name=orig",
        name: "photographer_22334455_01.jpg",
        byteLength: 4,
        contentType: "image/jpeg"
      },
      {
        url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4",
        name: "videographer_123456789_01.mp4",
        byteLength: 11,
        contentType: "video/mp4"
      },
      {
        url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4",
        name: "videographer_123456789_01.mp4",
        byteLength: 11,
        contentType: "video/mp4"
      }
    ];
    assert.deepEqual(result.buttonTransfers, expectedTransfers);
    assert.deepEqual(result.contextTransfers, expectedTransfers.slice(0, 2));
    assert.deepEqual(result.contextResults, {
      videoContext: { nativeMenuPreserved: true, response: { ok: true } },
      imageContext: { nativeMenuPreserved: true, response: { ok: true } }
    });
    assert.equal(result.listenerRemoved, true);
  } finally {
    await page.unroute("https://pbs.twimg.com/media/**");
    await page.unroute("https://video.twimg.com/**");
  }
});
