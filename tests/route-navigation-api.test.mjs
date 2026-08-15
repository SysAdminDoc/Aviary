import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let temp;
let outfile;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-route-nav-"));
  outfile = path.join(temp, "route.mjs");
  await build({
    entryPoints: [path.join(root, "src/platform/route.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
});

after(async () => {
  await rm(temp, { recursive: true, force: true });
});

// Each case needs its own module instance: watchRoute reads globals at call time and the
// History fallback patches them, so a shared copy would leak state between cases.
async function load() {
  return import(`${pathToFileURL(outfile).href}?case=${Math.random()}`);
}

function stubGlobalEvents() {
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  return () => {
    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
  };
}

function fakeLocation(href) {
  const url = new URL(href);
  return { href: url.href, pathname: url.pathname };
}

test("the Navigation API is used when the browser has one", async () => {
  const mod = await load();
  const listeners = new Map();
  const navigation = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };
  const originalNavigation = globalThis.navigation;
  const originalLocation = globalThis.location;
  const originalPush = globalThis.history?.pushState;
  globalThis.navigation = navigation;
  globalThis.location = fakeLocation("https://x.com/home");

  try {
    const seen = [];
    const stop = mod.watchRoute((route) => seen.push(route.surface));

    assert.ok(listeners.has("navigatesuccess"), "the Navigation API must be subscribed to");
    assert.equal(
      globalThis.history?.pushState,
      originalPush,
      "History must not be patched when the Navigation API is available"
    );

    globalThis.location = fakeLocation("https://x.com/someone/status/1");
    listeners.get("navigatesuccess")();
    assert.deepEqual(seen, ["status"]);

    // An event that does not change the URL must not re-emit.
    listeners.get("navigatesuccess")();
    assert.deepEqual(seen, ["status"]);

    stop();
    assert.equal(listeners.size, 0, "teardown must unsubscribe");
  } finally {
    globalThis.navigation = originalNavigation;
    globalThis.location = originalLocation;
  }
});

test("browsers without the Navigation API still get the History fallback", async () => {
  const mod = await load();
  const originalNavigation = globalThis.navigation;
  const originalLocation = globalThis.location;
  delete globalThis.navigation;
  globalThis.location = fakeLocation("https://x.com/home");

  const pushState = function pushState() {};
  const replaceState = function replaceState() {};
  const originalHistory = globalThis.history;
  globalThis.history = { pushState, replaceState };
  // The fallback listens for popstate on the global; Node has no DOM event target.
  const restoreEvents = stubGlobalEvents();

  try {
    const stop = mod.watchRoute(() => {});
    assert.notEqual(globalThis.history.pushState, pushState, "History must be patched as fallback");
    stop();
    assert.equal(globalThis.history.pushState, pushState, "teardown must restore History");
  } finally {
    restoreEvents();
    globalThis.history = originalHistory;
    globalThis.navigation = originalNavigation;
    globalThis.location = originalLocation;
  }
});

test("a navigation-shaped object without listeners is not mistaken for the API", async () => {
  const mod = await load();
  const originalNavigation = globalThis.navigation;
  const originalLocation = globalThis.location;
  // Some environments expose an unrelated `navigation` global.
  globalThis.navigation = { currentEntry: null };
  globalThis.location = fakeLocation("https://x.com/home");
  const pushState = function pushState() {};
  const originalHistory = globalThis.history;
  globalThis.history = { pushState, replaceState() {} };
  const restoreEvents = stubGlobalEvents();

  try {
    const stop = mod.watchRoute(() => {});
    assert.notEqual(globalThis.history.pushState, pushState, "must fall back when it cannot listen");
    stop();
  } finally {
    restoreEvents();
    globalThis.history = originalHistory;
    globalThis.navigation = originalNavigation;
    globalThis.location = originalLocation;
  }
});
