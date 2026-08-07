import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A `<video>` stub that reproduces the one behaviour the pauser actually depends on: `pause()`
 * dispatches its event on a later task, not synchronously. A stub that fired it inline would let
 * a naive "am I pausing right now" flag pass, which is the bug this design exists to avoid.
 */
class FakeVideo {
  constructor() {
    this.paused = false;
    this.ended = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.playCalls = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type, handler) {
    const list = (this.listeners.get(type) ?? []).filter((entry) => entry !== handler);
    this.listeners.set(type, list);
  }

  pause() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    queueMicrotask(() => this.#emit("pause"));
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  /** What a viewer pressing the pause control looks like from the element's side. */
  pauseByViewer() {
    this.pause();
  }

  #emit(type) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler();
    }
  }
}

function fakeRoot(videos) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, "video");
      return videos;
    }
  };
}

/** Captures the observer callback so the test can drive intersection changes directly. */
function fakeView() {
  const state = { callback: null, observed: [], disconnected: 0 };
  state.IntersectionObserver = class {
    constructor(callback) {
      state.callback = callback;
    }
    observe(target) {
      state.observed.push(target);
    }
    disconnect() {
      state.disconnected += 1;
    }
  };
  return state;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an offscreen video is paused and resumed when it scrolls back", async () => {
  const { OffscreenVideoPauser } = await importBundledModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const video = new FakeVideo();
  const view = fakeView();
  const pauser = new OffscreenVideoPauser();

  assert.equal(pauser.start(view), true);
  pauser.scan(fakeRoot([video]));
  assert.equal(view.observed.length, 1);
  assert.equal(pauser.trackedCount, 1);

  view.callback([{ target: video, isIntersecting: false }]);
  assert.equal(video.paused, true);
  assert.equal(video.getAttribute("data-av-perf-paused"), "1");
  assert.equal(pauser.pausedCount, 1);
  await settled();

  view.callback([{ target: video, isIntersecting: true }]);
  assert.equal(video.playCalls, 1);
  assert.equal(video.paused, false);
  assert.equal(video.getAttribute("data-av-perf-paused"), null);
  assert.equal(pauser.pausedCount, 0);
});

test("a video the viewer paused is never resumed by scrolling", async () => {
  const { OffscreenVideoPauser } = await importBundledModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const video = new FakeVideo();
  const view = fakeView();
  const pauser = new OffscreenVideoPauser();
  pauser.start(view);
  pauser.scan(fakeRoot([video]));

  // Ours: the element leaves the viewport while playing.
  view.callback([{ target: video, isIntersecting: false }]);
  await settled();
  assert.equal(pauser.pausedCount, 1);

  // Theirs: still offscreen, the viewer hits pause on a video we had already resumed.
  view.callback([{ target: video, isIntersecting: true }]);
  await settled();
  assert.equal(video.paused, false);
  video.pauseByViewer();
  await settled();

  // Scrolling away and back must leave that decision alone.
  view.callback([{ target: video, isIntersecting: false }]);
  await settled();
  view.callback([{ target: video, isIntersecting: true }]);
  assert.equal(video.paused, true, "a viewer's pause survives a scroll round-trip");
  assert.equal(video.playCalls, 1, "only the first, feature-owned resume called play()");
});

test("a video already paused when it leaves the viewport is not marked for resume", async () => {
  const { OffscreenVideoPauser } = await importBundledModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const video = new FakeVideo();
  video.paused = true;
  const view = fakeView();
  const pauser = new OffscreenVideoPauser();
  pauser.start(view);
  pauser.scan(fakeRoot([video]));

  view.callback([{ target: video, isIntersecting: false }]);
  assert.equal(pauser.pausedCount, 0);

  view.callback([{ target: video, isIntersecting: true }]);
  assert.equal(video.playCalls, 0, "a video that was already paused must not be started");
});

test("stopping removes every attribute, listener and observation the feature added", async () => {
  const { OffscreenVideoPauser } = await importBundledModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const video = new FakeVideo();
  const view = fakeView();
  const pauser = new OffscreenVideoPauser();
  pauser.start(view);
  pauser.scan(fakeRoot([video]));
  view.callback([{ target: video, isIntersecting: false }]);
  await settled();

  pauser.stop();

  assert.equal(view.disconnected, 1);
  assert.equal(video.attributes.size, 0, "no data-av-* attribute is left on the page");
  assert.equal((video.listeners.get("pause") ?? []).length, 0);
  assert.equal(pauser.trackedCount, 0);
  assert.equal(pauser.pausedCount, 0);
});

test("scanning twice does not double-observe the same video", async () => {
  const { OffscreenVideoPauser } = await importBundledModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const video = new FakeVideo();
  const view = fakeView();
  const pauser = new OffscreenVideoPauser();
  pauser.start(view);
  pauser.scan(fakeRoot([video]));
  pauser.scan(fakeRoot([video]));

  assert.equal(view.observed.length, 1);
  assert.equal((video.listeners.get("pause") ?? []).length, 1);
});

test("the feature reports unavailable rather than throwing without IntersectionObserver", async () => {
  const { OffscreenVideoPauser } = await importBundledModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const pauser = new OffscreenVideoPauser();
  assert.equal(pauser.start({}), false);
  // scan() with no observer must be a no-op, not a crash.
  pauser.scan(fakeRoot([new FakeVideo()]));
  assert.equal(pauser.trackedCount, 0);
});

test("pauseOffscreenVideo is a real setting the normalizer round-trips", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );

  // Off since v1.13.0: pausing video X chose to play is a change to how X behaves, and nothing
  // that changes X is on until the user asks for it.
  assert.equal(DEFAULT_SETTINGS.performance.pauseOffscreenVideo, false);
  assert.equal(normalizeSettings({}).performance.pauseOffscreenVideo, false);
  assert.equal(
    normalizeSettings({ performance: { pauseOffscreenVideo: true } }).performance
      .pauseOffscreenVideo,
    true
  );
  assert.equal(
    normalizeSettings({ performance: { pauseOffscreenVideo: "yes" } }).performance
      .pauseOffscreenVideo,
    false,
    "a non-boolean falls back to the default rather than becoming truthy"
  );
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-perf-"));
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
    await rm(temp, { recursive: true, force: true });
  }
}
