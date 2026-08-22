import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

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
    // The pauser reconciles against this, so a stub without it would model a video X has already
    // torn out of the document -- and every test would silently exercise the detached path.
    this.isConnected = true;
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
  const state = { callback: null, observed: [], unobserved: [], disconnected: 0 };
  state.IntersectionObserver = class {
    constructor(callback) {
      state.callback = callback;
    }
    observe(target) {
      state.observed.push(target);
    }
    unobserve(target) {
      state.unobserved.push(target);
    }
    disconnect() {
      state.disconnected += 1;
    }
  };
  return state;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an offscreen video is paused and resumed when it scrolls back", async () => {
  const { OffscreenVideoPauser } = await importSourceModule(
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
  const { OffscreenVideoPauser } = await importSourceModule(
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
  const { OffscreenVideoPauser } = await importSourceModule(
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
  const { OffscreenVideoPauser } = await importSourceModule(
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
  const { OffscreenVideoPauser } = await importSourceModule(
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

test("videos X removes from the page stop being tracked", async () => {
  const { OffscreenVideoPauser } = await importSourceModule(
    "src/features/performance/pause-offscreen-video.ts"
  );
  const view = fakeView();
  const pauser = new OffscreenVideoPauser();
  pauser.start(view);

  const kept = new FakeVideo();
  const recycled = new FakeVideo();
  pauser.scan(fakeRoot([kept, recycled]));
  assert.equal(pauser.trackedCount, 2);

  // Park one offscreen first, so the resume ledger has an entry to leak too.
  view.callback([{ target: recycled, isIntersecting: false }]);
  await settled();
  assert.equal(pauser.pausedCount, 1);

  // X's virtualizer drops the row. Nothing removed the entry before `stop()`, so an infinite
  // scroll retained every video it had ever shown for the whole session.
  recycled.isConnected = false;
  pauser.scan(fakeRoot([kept]));

  assert.equal(pauser.trackedCount, 1, "a detached video must not stay tracked");
  assert.equal(pauser.pausedCount, 0, "its resume debt must go with it");
  assert.ok(view.unobserved.includes(recycled), "and it must be unobserved, not just forgotten");
  assert.equal(recycled.listeners.get("pause")?.length ?? 0, 0, "its pause listener must be released");

  // The video still on the page is untouched by the sweep.
  assert.equal(kept.getAttribute("data-av-perf-video"), "1");
  pauser.stop();
});

test("the feature reports unavailable rather than throwing without IntersectionObserver", async () => {
  const { OffscreenVideoPauser } = await importSourceModule(
    "src/features/performance/pause-offscreen-video.ts"
  );

  const pauser = new OffscreenVideoPauser();
  assert.equal(pauser.start({}), false);
  // scan() with no observer must be a no-op, not a crash.
  pauser.scan(fakeRoot([new FakeVideo()]));
  assert.equal(pauser.trackedCount, 0);
});

test("pauseOffscreenVideo is a real setting the normalizer round-trips", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importSourceModule(
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
