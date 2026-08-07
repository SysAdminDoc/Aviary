import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("extractVideo prefers highest-bitrate source and detects GIF heuristics", async () => {
  const { extractVideo } = await importBundledModule(
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

test("extractVideo flags loop+muted GIF-style player", async () => {
  const { extractVideo } = await importBundledModule(
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
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
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

test("presentation feature destroy removes every class it sets", async () => {
  const source = await readFile(
    path.join(root, "src/features/media/media-presentation.ts"),
    "utf8"
  );
  for (const marker of [
    "av-media-layout-default",
    "av-media-layout-stacked",
    "av-media-layout-grid"
  ]) {
    assert.ok(source.includes(marker), `presentation source missing ${marker}`);
  }
  assert.match(source, /destroy/);
  // Nothing may reintroduce a rule that claims to act on sensitive media: the build cannot tell
  // sensitive media apart, which is exactly why the modes were removed.
  assert.ok(!source.includes("av-sensitive"), "sensitive-media rules must not come back unscoped");
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

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v6-"));
  const outfile = path.join(temp, "module.mjs");

  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
