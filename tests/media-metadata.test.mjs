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
      `export { mediaButtonsFeature, ingestMediaMetadata, mediaMetadataCacheSize } from ${JSON.stringify(absoluteSource("src/features/media/media-buttons.ts"))};`
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

test("MSE extraction keeps the real player as the video and thumbnail anchor", async () => {
  const result = await page.evaluate((body) => {
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const status = document.createElement("a");
    status.href = "/someone/status/123456789";
    article.append(status);

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
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoComponent");
    const video = document.createElement("video");
    video.poster = "https://pbs.twimg.com/media/456789?format=jpg&name=small";
    video.src = "blob:https://x.com/mse-player";
    player.append(video);
    article.append(player);
    document.body.append(article);

    await AviaryMedia.mediaButtonsFeature.init(ctx);
    const before = [...document.querySelectorAll("[data-av-media-button]")].map((button) => ({
      kind: button.dataset.kind,
      text: button.textContent
    }));

    AviaryMedia.ingestMediaMetadata({ body });
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    const during = [...document.querySelectorAll("[data-av-media-button]")].map((button) => ({
      kind: button.dataset.kind,
      text: button.textContent
    }));

    settings.media.buttons = false;
    await AviaryMedia.mediaButtonsFeature.apply(ctx, document);
    const off = document.querySelectorAll("[data-av-media-button]").length;
    await AviaryMedia.mediaButtonsFeature.destroy(ctx);
    return { before, during, off };
  }, metadataBody);

  assert.deepEqual(result.before, [{ kind: "thumbnail", text: "Thumb" }]);
  assert.deepEqual(result.during, [
    { kind: "video", text: "Video" },
    { kind: "thumbnail", text: "Thumb" }
  ]);
  assert.equal(result.off, 0);
});
