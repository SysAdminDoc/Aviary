import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";


test("extractVideo prefers highest-bitrate source and detects GIF heuristics", async () => {
  const { extractVideo } = await importSourceModule(
    "src/features/media/video-extract.ts"
  );

  const sources = [
    {
      src: "https://video.twimg.com/ext/low.mp4",
      dataset: { bitrate: "300000", width: "640", height: "360" },
      type: "video/mp4"
    },
    {
      src: "https://video.twimg.com/ext/high.mp4",
      dataset: { bitrate: "2000000", width: "1920", height: "1080" },
      type: "video/mp4"
    },
    {
      src: "https://video.twimg.com/ext/mid.mp4",
      dataset: { bitrate: "900000", width: "1280", height: "720" },
      type: "video/mp4"
    }
  ];

  const container = stubVideoContainer({ sources });
  const extracted = extractVideo(container);
  assert.ok(extracted);
  assert.equal(extracted.preferred?.url, "https://video.twimg.com/ext/high.mp4");
  assert.equal(extracted.isGif, false);
});

test("repeated DOM URLs merge richer rendition metadata before ranking", async () => {
  const { extractVideo } = await importSourceModule(
    "src/features/media/video-extract.ts"
  );
  const url = "https://video.twimg.com/ext/shared/asset.mp4?token=signed";
  const container = stubVideoContainer({
    sources: [
      { src: url, type: "video/mp4", dataset: {} },
      {
        src: url,
        type: "video/mp4",
        dataset: { bitrate: "8000000", width: "1920", height: "1080" }
      },
      {
        src: "https://video.twimg.com/ext/low.mp4",
        type: "video/mp4",
        dataset: { bitrate: "500000", width: "640", height: "360" }
      }
    ]
  });

  const extracted = extractVideo(container);
  assert.ok(extracted);
  assert.equal(extracted.variants.length, 2);
  assert.deepEqual(extracted.variants.find((variant) => variant.url === url), {
    url,
    type: "video/mp4",
    width: 1920,
    height: 1080,
    bitrate: 8000000
  });
  assert.equal(extracted.preferred?.url, url);
});

test("same URL merge is deterministic and never drops signed queries or known text", async () => {
  const { mergeVideoVariant, mergeVideoVariants } = await importSourceModule(
    "src/features/media/video-extract.ts"
  );
  const url = "https://video.twimg.com/ext/shared/asset?token=abc&expires=9";
  const sparse = {
    url,
    type: "application/octet-stream",
    width: null,
    height: null,
    bitrate: null,
    codec: "h264",
    provenance: "graphql"
  };
  const rich = {
    url,
    type: "video/mp4",
    width: 1920,
    height: 1080,
    bitrate: 8000000,
    provenance: "dom"
  };
  const forward = mergeVideoVariant(sparse, rich);
  const reverse = mergeVideoVariant(rich, sparse);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.url, url);
  assert.equal(forward.type, "video/mp4");
  assert.equal(forward.codec, "h264");
  assert.equal(forward.provenance, "dom|graphql");
  assert.deepEqual(mergeVideoVariants([rich], [sparse]), [forward]);
  assert.deepEqual(mergeVideoVariants([sparse], [rich]), [forward]);
  assert.notStrictEqual(forward, sparse);
  assert.equal(sparse.width, null);
  assert.equal(rich.bitrate, 8000000);
});

test("extractVideo flags loop+muted GIF-style player", async () => {
  const { extractVideo } = await importSourceModule(
    "src/features/media/video-extract.ts"
  );
  const container = stubVideoContainer({
    sources: [{ src: "https://video.twimg.com/tweet_video/abc.mp4", type: "video/mp4" }],
    loop: true,
    muted: true
  });
  const extracted = extractVideo(container);
  assert.ok(extracted);
  assert.equal(extracted.isGif, true);
});

test("settings schema accepts new media presentation fields", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importSourceModule(
    "src/platform/settings.ts"
  );

  assert.equal(DEFAULT_SETTINGS.media.layout, "default");

  const normalized = normalizeSettings({
    media: { layout: "stacked", lastSaveFolder: "X/<weird>?folder" }
  });
  assert.equal(normalized.media.layout, "stacked");
  assert.ok(!normalized.media.lastSaveFolder.includes("<"));
  assert.ok(!normalized.media.lastSaveFolder.includes("?"));

  const fallback = normalizeSettings({ media: { layout: "wide" } });
  assert.equal(fallback.media.layout, "default");

  // media.sensitive was removed in v1.13.0 -- its rules could not tell sensitive media from any
  // other media, so Aviary now leaves sensitive content entirely to X. A settings file from an
  // older build still carrying the key must import without smuggling it back in.
  const legacy = normalizeSettings({ media: { sensitive: "blur", layout: "default" } });
  assert.equal("sensitive" in legacy.media, false);
});

function stubVideoContainer({ sources, loop = false, muted = false, ariaLabel = "" }) {
  const sourceStubs = sources.map((entry) =>
    stubElement({
      tagName: "SOURCE",
      attrs: {},
      properties: { src: entry.src, type: entry.type ?? "video/mp4" },
      dataset: entry.dataset ?? {}
    })
  );
  const video = stubElement({
    tagName: "VIDEO",
    attrs: {},
    properties: {
      currentSrc: "",
      src: "",
      loop,
      muted,
      poster: ""
    },
    children: sourceStubs
  });
  return stubElement({
    tagName: "DIV",
    attrs: { "data-testid": "videoComponent", "aria-label": ariaLabel },
    children: [video]
  });
}

function stubElement({
  tagName,
  attrs = {},
  properties = {},
  dataset = {},
  children = []
}) {
  const element = {
    tagName,
    attrs: new Map(Object.entries(attrs)),
    dataset,
    children,
    ...properties
  };

  element.getAttribute = (name) => element.attrs.get(name) ?? null;
  element.setAttribute = (name, value) => element.attrs.set(name, String(value));
  element.querySelector = (selector) => firstMatch(element, selector);
  element.querySelectorAll = (selector) => allMatches(element, selector);
  return element;
}

function firstMatch(root, selector) {
  const all = allMatches(root, selector);
  return all[0] ?? null;
}

function allMatches(root, selector) {
  const tagPredicate = matcherForSelector(selector);
  const matches = [];
  walk(root, (node) => {
    if (tagPredicate(node)) {
      matches.push(node);
    }
  });
  return matches;
}

function matcherForSelector(selector) {
  const lower = selector.toLowerCase().trim();
  if (lower === "video") {
    return (node) => node.tagName === "VIDEO";
  }
  if (lower === "video[poster]") {
    return (node) => node.tagName === "VIDEO" && Boolean(node.poster);
  }
  if (lower === "source") {
    return (node) => node.tagName === "SOURCE";
  }
  return () => false;
}

function walk(root, visit) {
  for (const child of root.children ?? []) {
    visit(child);
    walk(child, visit);
  }
}
