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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-seen-dim-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { seenPostsFeature, resetSeenPostsState, getSeenPostStore, setSeenPostsTestSeams } from ${JSON.stringify(abs("src/features/filtering/seen-posts-feature.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviarySeen",
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

const TIMELINE = (ids) =>
  ids
    .map(
      (id) =>
        `<article data-testid="tweet" id="post-${id}"><a href="/someone/status/${id}">link</a></article>`
    )
    .join("");

async function run({ enabled = true } = {}) {
  return page.evaluate(
    async ({ enabled, first, second }) => {
      AviarySeen.resetSeenPostsState();
      let now = 0;
      const timers = [];
      const observers = [];
      AviarySeen.setSeenPostsTestSeams({
        now: () => now,
        setTimeout(callback, delay) {
          const timer = { callback, due: now + delay, cancelled: false };
          timers.push(timer);
          return timer;
        },
        clearTimeout(timer) {
          timer.cancelled = true;
        },
        createObserver(callback) {
          const observer = { callback, observe() {}, disconnect() {} };
          observers.push(observer);
          return observer;
        }
      });
      const reveal = () => {
        const entries = [...document.querySelectorAll('article[data-testid="tweet"]')].map((target) => ({
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: { height: 100 },
          intersectionRect: { height: 100 },
          rootBounds: { height: 800 }
        }));
        observers.at(-1)?.callback(entries);
      };
      const advance = (milliseconds) => {
        now += milliseconds;
        for (const timer of timers.filter((entry) => !entry.cancelled && entry.due <= now)) {
          timer.cancelled = true;
          timer.callback();
        }
      };
      const values = new Map();
      const storage = {
        async get(key, fallback) {
          return values.has(key) ? values.get(key) : fallback;
        },
        async set(key, value) {
          values.set(key, JSON.parse(JSON.stringify(value)));
        }
      };
      const settings = AviarySeen.normalizeSettings({ filter: { dimSeenPosts: enabled } });
      const ctx = {
        settings,
        storage,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviarySeen.seenPostsFeature;

      // First pass: these posts are new, so nothing should fade.
      document.body.innerHTML = first;
      await feature.init(ctx);
      reveal();
      advance(1000);
      const opacityOf = (id) => {
        const node = document.getElementById(`post-${id}`);
        return node ? getComputedStyle(node).opacity : "absent";
      };
      const firstPass = { a: opacityOf("111"), b: opacityOf("222") };

      // Second pass: the same two return alongside one genuinely new post.
      document.body.innerHTML = second;
      await feature.apply(ctx, document);
      reveal();
      const secondPass = { a: opacityOf("111"), b: opacityOf("222"), fresh: opacityOf("333") };

      await feature.destroy(ctx);
      const afterDestroy = {
        a: opacityOf("111"),
        marked: document.querySelectorAll("[data-av-seen]").length
      };
      return { firstPass, secondPass, afterDestroy };
    },
    { enabled, first: TIMELINE(["111", "222"]), second: TIMELINE(["111", "222", "333"]) }
  );
}

test("a post fades only on its second pass, never while first being read", async () => {
  const { firstPass, secondPass } = await run();

  assert.equal(firstPass.a, "1", "a post must not fade the first time it is on screen");
  assert.equal(firstPass.b, "1");

  assert.notEqual(secondPass.a, "1", "a returning post must fade");
  assert.notEqual(secondPass.b, "1");
  assert.equal(secondPass.fresh, "1", "a genuinely new post must stay at full opacity");
});

test("a direct Status route qualifies its focal post without waiting for dwell", async () => {
  const result = await page.evaluate(async () => {
    AviarySeen.resetSeenPostsState();
    const values = new Map();
    AviarySeen.setSeenPostsTestSeams({
      createObserver(callback) {
        return { callback, observe() {}, disconnect() {} };
      },
      now: () => Date.now(),
      setTimeout() { return { cancelled: false }; },
      clearTimeout(timer) { timer.cancelled = true; }
    });
    document.body.innerHTML = ["999", "888"]
      .map((id) => `<article data-testid="tweet" id="post-${id}"><a href="/someone/status/${id}">link</a></article>`)
      .join("");
    const ctx = {
      settings: AviarySeen.normalizeSettings({ filter: { dimSeenPosts: true } }),
      storage: {
        async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
        async set(key, value) { values.set(key, structuredClone(value)); }
      },
      route: { href: "https://x.com/someone/status/999", path: "/someone/status/999", surface: "status" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    await AviarySeen.seenPostsFeature.init(ctx);
    const store = AviarySeen.getSeenPostStore();
    const focal = document.getElementById("post-999");
    const reply = document.getElementById("post-888");
    await AviarySeen.seenPostsFeature.destroy(ctx);
    return {
      size: store?.size ?? 0,
      focal: focal?.getAttribute("data-av-seen"),
      reply: reply?.getAttribute("data-av-seen"),
      links: [...document.querySelectorAll("article a")].map((link) => link.getAttribute("href")),
      status: AviarySeen.seenPostsFeature.getStatus(),
      surfaces: ctx.settings.filter.dimSeenSurfaces,
      route: ctx.route
    };
  });
  assert.deepEqual(result, { size: 1, focal: null, reply: null, links: ["/someone/status/999", "/someone/status/888"], route: { href: "https://x.com/someone/status/999", path: "/someone/status/999", surface: "status" }, status: { ok: true, message: "Seen posts tracked: 1" }, surfaces: ["home", "status", "profile", "search", "notifications", "messages"] });
});

test("dwell is independent per post and cancels when a post leaves the viewport", async () => {
  const result = await page.evaluate(async () => {
    AviarySeen.resetSeenPostsState();
    let now = 0;
    const timers = [];
    const observers = [];
    AviarySeen.setSeenPostsTestSeams({
      now: () => now,
      setTimeout(callback, delay) {
        const timer = { callback, due: now + delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { timer.cancelled = true; },
      createObserver(callback) {
        const observer = { callback, observe() {}, disconnect() {} };
        observers.push(observer);
        return observer;
      }
    });
    const values = new Map();
    const storage = {
      async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
      async set(key, value) { values.set(key, structuredClone(value)); }
    };
    const ctx = {
      settings: AviarySeen.normalizeSettings({ filter: { dimSeenPosts: true } }),
      storage,
      route: { href: "https://x.com/home", path: "/home", surface: "home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    document.body.innerHTML = ["111", "222"]
      .map((id) => `<article data-testid="tweet" id="post-${id}"><a href="/someone/status/${id}">link</a></article>`)
      .join("");
    await AviarySeen.seenPostsFeature.init(ctx);
    const first = document.getElementById("post-111");
    const second = document.getElementById("post-222");
    const emit = (entries) => observers.at(-1)?.callback(entries);
    emit([
      { target: first, isIntersecting: true, intersectionRatio: 1, boundingClientRect: { height: 100 }, intersectionRect: { height: 100 }, rootBounds: { height: 800 } },
      { target: second, isIntersecting: true, intersectionRatio: 0.25, boundingClientRect: { height: 1200 }, intersectionRect: { height: 250 }, rootBounds: { height: 800 } }
    ]);
    emit([{ target: first, isIntersecting: false, intersectionRatio: 0, boundingClientRect: { height: 100 }, intersectionRect: { height: 0 }, rootBounds: { height: 800 } }]);
    now = 1000;
    for (const timer of timers) {
      if (!timer.cancelled && timer.due <= now) {
        timer.cancelled = true;
        timer.callback();
      }
    }
    const size = AviarySeen.getSeenPostStore()?.size ?? 0;
    await AviarySeen.seenPostsFeature.destroy(ctx);
    return { size, firstCancelled: timers[0]?.cancelled, secondCancelled: timers[1]?.cancelled };
  });
  assert.deepEqual(result, { size: 1, firstCancelled: true, secondCancelled: true });
});

test("background-tab time never qualifies a visible candidate", async () => {
  const result = await page.evaluate(async () => {
    AviarySeen.resetSeenPostsState();
    let now = 0;
    const timers = [];
    const observers = [];
    AviarySeen.setSeenPostsTestSeams({
      now: () => now,
      setTimeout(callback, delay) {
        const timer = { callback, due: now + delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { timer.cancelled = true; },
      createObserver(callback) {
        const observer = { callback, observe() {}, disconnect() {} };
        observers.push(observer);
        return observer;
      }
    });
    const values = new Map();
    const storage = {
      async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
      async set(key, value) { values.set(key, structuredClone(value)); }
    };
    const ctx = {
      settings: AviarySeen.normalizeSettings({ filter: { dimSeenPosts: true } }),
      storage,
      route: { href: "https://x.com/home", path: "/home", surface: "home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    document.body.innerHTML = `<article data-testid="tweet" id="post-777"><a href="/someone/status/777">link</a></article>`;
    await AviarySeen.seenPostsFeature.init(ctx);
    const article = document.getElementById("post-777");
    const emit = (entry) => observers.at(-1)?.callback([{ target: article, ...entry }]);
    const originalVisibility = document.visibilityState;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    emit({ isIntersecting: true, intersectionRatio: 1, boundingClientRect: { height: 100 }, intersectionRect: { height: 100 }, rootBounds: { height: 800 } });
    now = 2000;
    for (const timer of timers) {
      if (!timer.cancelled && timer.due <= now) {
        timer.cancelled = true;
        timer.callback();
      }
    }
    const hiddenSize = AviarySeen.getSeenPostStore()?.size ?? 0;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: originalVisibility });
    document.dispatchEvent(new Event("visibilitychange"));
    await AviarySeen.seenPostsFeature.destroy(ctx);
    return hiddenSize;
  });
  assert.equal(result, 0);
});

test("destroy removes the fade and every marker", async () => {
  const { afterDestroy } = await run();
  assert.equal(afterDestroy.a, "1", "opacity must return after destroy");
  assert.equal(afterDestroy.marked, 0, "no seen marker may survive destroy");
});

test("the feature is inert while off", async () => {
  const { firstPass, secondPass } = await run({ enabled: false });
  assert.equal(firstPass.a, "1");
  assert.equal(secondPass.a, "1", "nothing may fade while the setting is off");
});

test("enabling the setting after boot starts working without a reload", async () => {
  const result = await page.evaluate(
    async ({ first, second }) => {
      AviarySeen.resetSeenPostsState();
      let now = 0;
      const timers = [];
      const observers = [];
      AviarySeen.setSeenPostsTestSeams({
        now: () => now,
        setTimeout(callback, delay) {
          const timer = { callback, due: now + delay, cancelled: false };
          timers.push(timer);
          return timer;
        },
        clearTimeout(timer) {
          timer.cancelled = true;
        },
        createObserver(callback) {
          const observer = { callback, observe() {}, disconnect() {} };
          observers.push(observer);
          return observer;
        }
      });
      const reveal = () => observers.at(-1)?.callback(
        [...document.querySelectorAll('article[data-testid="tweet"]')].map((target) => ({
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: { height: 100 },
          intersectionRect: { height: 100 },
          rootBounds: { height: 800 }
        }))
      );
      const advance = (milliseconds) => {
        now += milliseconds;
        for (const timer of timers.filter((entry) => !entry.cancelled && entry.due <= now)) {
          timer.cancelled = true;
          timer.callback();
        }
      };
      const values = new Map();
      const storage = {
        async get(key, fallback) {
          return values.has(key) ? values.get(key) : fallback;
        },
        async set(key, value) {
          values.set(key, JSON.parse(JSON.stringify(value)));
        }
      };
      // Boot with the setting off, which is the default -- init returns before building the store.
      const settings = AviarySeen.normalizeSettings({ filter: { dimSeenPosts: false } });
      const ctx = {
        settings,
        storage,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviarySeen.seenPostsFeature;
      document.body.innerHTML = first;
      await feature.init(ctx);

      // The user turns it on mid-session. The store was only ever built in init, so apply used to
      // hit `if (!store) return` for the rest of the session and mark nothing.
      settings.filter.dimSeenPosts = true;
      await feature.apply(ctx, document);
      reveal();
      advance(1000);
      const trackedAfterEnable = AviarySeen.getSeenPostStore()?.size ?? 0;

      document.body.innerHTML = second;
      await feature.apply(ctx, document);
      reveal();
      const opacityOf = (id) => {
        const node = document.getElementById(`post-${id}`);
        return node ? getComputedStyle(node).opacity : "absent";
      };
      const returning = opacityOf("111");
      await feature.destroy(ctx);
      return { trackedAfterEnable, returning };
    },
    { first: TIMELINE(["111", "222"]), second: TIMELINE(["111", "222", "333"]) }
  );

  assert.ok(result.trackedAfterEnable > 0, "turning the setting on must build the store");
  assert.notEqual(result.returning, "1", "and a returning post must then fade");
});

test("destroy waits for the pending write instead of resolving ahead of it", async () => {
  const persisted = await page.evaluate(
    async ({ first }) => {
      AviarySeen.resetSeenPostsState();
      let now = 0;
      const timers = [];
      const observers = [];
      AviarySeen.setSeenPostsTestSeams({
        now: () => now,
        setTimeout(callback, delay) {
          const timer = { callback, due: now + delay, cancelled: false };
          timers.push(timer);
          return timer;
        },
        clearTimeout(timer) {
          timer.cancelled = true;
        },
        createObserver(callback) {
          const observer = { callback, observe() {}, disconnect() {} };
          observers.push(observer);
          return observer;
        }
      });
      const values = new Map();
      const storage = {
        async get(key, fallback) {
          return values.has(key) ? values.get(key) : fallback;
        },
        async set(key, value) {
          // A real backend does not settle in the same tick, which is what made the missing await
          // invisible: `flush` returns void, so `await flush()` awaited undefined.
          await new Promise((resolve) => setTimeout(resolve, 5));
          values.set(key, JSON.parse(JSON.stringify(value)));
        }
      };
      const settings = AviarySeen.normalizeSettings({ filter: { dimSeenPosts: true } });
      const ctx = {
        settings,
        storage,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      document.body.innerHTML = first;
      await AviarySeen.seenPostsFeature.init(ctx);
      observers.at(-1)?.callback([...document.querySelectorAll('article[data-testid="tweet"]')].map((target) => ({
        target,
        isIntersecting: true,
        intersectionRatio: 1,
        boundingClientRect: { height: 100 },
        intersectionRect: { height: 100 },
        rootBounds: { height: 800 }
      })));
      now = 1000;
      for (const timer of timers) {
        if (!timer.cancelled && timer.due <= now) {
          timer.cancelled = true;
          timer.callback();
        }
      }
      await AviarySeen.seenPostsFeature.destroy(ctx);

      // Read the store the moment destroy resolves. Anything marked must already be on disk.
      const stored = values.get("aviary.seenPosts.v1");
      return Object.keys(stored?.seen ?? {}).length;
    },
    { first: TIMELINE(["111", "222"]) }
  );

  assert.equal(persisted, 2, "every post marked before teardown must be persisted by the time destroy resolves");
});
