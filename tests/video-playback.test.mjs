import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-video-playback-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { videoPlaybackFeature, resetVideoPlaybackState } from ${JSON.stringify(abs("src/features/performance/video-playback.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryVideo",
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

// Two stub players: one the user left playing, one the user paused themselves.
const MARKUP = `
  <video id="playing"></video>
  <video id="user-paused"></video>
`;

async function run({ keepVideoPlaying = false, loopVideos = false } = {}) {
  return page.evaluate(
    async ({ markup, keepVideoPlaying, loopVideos }) => {
      AviaryVideo.resetVideoPlaybackState();
      document.body.innerHTML = markup;

      // jsdom-free stubs: a real <video> with no source never reports playing, so model the
      // paused/ended state and record whether play() was called.
      const state = new Map();
      for (const id of ["playing", "user-paused"]) {
        const node = document.getElementById(id);
        const model = { paused: id === "user-paused", ended: false, plays: 0 };
        state.set(id, model);
        Object.defineProperty(node, "paused", { get: () => model.paused, configurable: true });
        Object.defineProperty(node, "ended", { get: () => model.ended, configurable: true });
        node.play = () => {
          model.plays += 1;
          model.paused = false;
          return Promise.resolve();
        };
      }

      const settings = AviaryVideo.normalizeSettings({
        performance: { keepVideoPlaying, loopVideos }
      });
      const ctx = {
        settings,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviaryVideo.videoPlaybackFeature;
      feature.init(ctx);

      const loopAfterInit = document.getElementById("playing").loop;

      // Tab goes to the background: X pauses whatever was playing.
      let visibility = "hidden";
      Object.defineProperty(document, "visibilityState", {
        get: () => visibility,
        configurable: true
      });
      document.dispatchEvent(new Event("visibilitychange"));
      for (const model of state.values()) model.paused = true;

      // Tab comes back.
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();

      const result = {
        loopAfterInit,
        resumedPlaying: state.get("playing").plays,
        resumedUserPaused: state.get("user-paused").plays
      };

      feature.destroy(ctx);
      result.loopAfterDestroy = document.getElementById("playing").loop;
      result.markersLeft = document.querySelectorAll("[data-av-video-playback]").length;
      return result;
    },
    { markup: MARKUP, keepVideoPlaying, loopVideos }
  );
}

test("a video X paused on tab blur resumes, one the user paused does not", async () => {
  const result = await run({ keepVideoPlaying: true });
  assert.equal(result.resumedPlaying, 1, "the video that was playing must resume");
  assert.equal(result.resumedUserPaused, 0, "a video the user paused must stay paused");
});

test("nothing resumes while the setting is off", async () => {
  const result = await run({ keepVideoPlaying: false });
  assert.equal(result.resumedPlaying, 0);
  assert.equal(result.resumedUserPaused, 0);
});

test("looping is applied and exactly restored on destroy", async () => {
  const result = await run({ loopVideos: true });
  assert.equal(result.loopAfterInit, true, "loop must be set while on");
  assert.equal(result.loopAfterDestroy, false, "destroy must restore the original loop value");
  assert.equal(result.markersLeft, 0, "no marker may survive destroy");
});

test("the quality setting no longer claims an outcome it cannot guarantee", async () => {
  const source = await readFile(
    path.join(root, "src/ui/control-center/sections/reading.ts"),
    "utf8"
  );
  // The old label promised every video would play at the highest quality. Aviary can only rewrite
  // a playlist it actually sees, and a player fetching one inside a worker never reaches it.
  // Match the rendered label, not the comment that records why it was renamed — the same class
  // of false positive the generated-class policy check hit on a historical comment.
  assert.doesNotMatch(source, /"Always play video at the highest quality"/);
  assert.match(source, /Pin video playlists to their best rendition/);
  assert.match(source, /Playlists rewritten/, "the real effect must be reported, not assumed");
});

test("the settings type records why the quality claim is bounded", async () => {
  const source = await readFile(path.join(root, "src/platform/settings.ts"), "utf8");
  assert.match(source, /worker bypasses the page agent/i);
});
