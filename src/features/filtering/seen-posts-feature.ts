import type { FeatureContext, FeatureModule } from "../registry.ts";
import type { FilterSurface } from "../../platform/settings.ts";
import { collectExportRecords } from "../export/collector.ts";
import { CatchUpStore, type CatchUpCategory, type CatchUpMetrics } from "./catch-up.ts";
import { SeenPostStore } from "./seen-posts.ts";

const STYLE_ID = "av-seen-posts";
const MARKER = "data-av-seen";
const FLUSH_DELAY_MS = 1500;
const DWELL_MS = 1000;
const MIN_VISIBLE_RATIO = 0.5;
const MIN_VISIBLE_PIXELS = 200;

let store: SeenPostStore | undefined;
let storeLoading: Promise<void> | undefined;
let catchUpStore: CatchUpStore | undefined;
let catchUpLoading: Promise<void> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let visibilityObserver: IntersectionObserver | undefined;
let visibilityChangeHandler: (() => void) | undefined;
let visibilityRefreshHandler: (() => void) | undefined;
const visibility = new Map<Element, { id: string; visible: boolean }>();
const dwellTimers = new Map<Element, ReturnType<typeof setTimeout>>();

interface SeenPostsTestSeams {
  createObserver?: (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => IntersectionObserver;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

let testSeams: SeenPostsTestSeams = {};

/**
 * Builds and loads the store on first need, whichever entry point gets there first.
 *
 * It used to be built only in `init`, which runs once at boot and returns early when the setting is
 * off — so enabling the setting later left `apply` hitting `if (!store) return` for the rest of the
 * session. The feature reported itself healthy and marked nothing until the page was reloaded.
 * Concurrent applies share the one load rather than racing two reads of the same key.
 */
async function ensureStore(ctx: FeatureContext): Promise<void> {
  if (store) {
    return;
  }
  if (!storeLoading) {
    const pending = new SeenPostStore(ctx.storage);
    storeLoading = pending.load().then(
      () => {
        store = pending;
      },
      (error) => {
        // A failed read must not wedge the feature: clear the latch so the next apply retries.
        storeLoading = undefined;
        throw error;
      }
    );
  }
  await storeLoading;
}

async function ensureCatchUpStore(ctx: FeatureContext): Promise<void> {
  if (catchUpStore) return;
  if (!catchUpLoading) {
    const pending = new CatchUpStore(ctx.storage);
    catchUpLoading = pending.load().then(
      () => {
        catchUpStore = pending;
      },
      () => {
        catchUpLoading = undefined;
      }
    );
  }
  await catchUpLoading;
}

/**
 * Fades posts that already scrolled past once, so a second pass down the timeline reads as
 * "new since last time" instead of the same posts again.
 *
 * A post is marked on its *first* pass and dimmed on later ones: dimming it the moment it appears
 * would fade everything as you read it. The store keeps ids and timestamps only.
 */
export const seenPostsFeature: FeatureModule = {
  id: "filtering.seenPosts",
  title: "Dim already-seen posts",
  category: "filtering",

  async init(ctx) {
    if (!seenDimmingEnabled(ctx)) {
      teardown();
      return;
    }
    ensureStyle();
    await ensureStore(ctx);
    await ensureCatchUpStore(ctx);
    scan(ctx, document);
  },

  async apply(ctx, root, addedNodes) {
    if (!seenDimmingEnabled(ctx)) {
      teardown();
      return;
    }
    ensureStyle();
    await ensureStore(ctx);
    await ensureCatchUpStore(ctx);
    if (!store) {
      return;
    }
    if (!addedNodes || addedNodes.length === 0) {
      scan(ctx, root);
      return;
    }
    for (const node of addedNodes) {
      scan(ctx, node);
    }
  },

  async destroy(ctx) {
    // The flush is coalesced on a 1.5s timer, so tearing down without it discarded up to that much
    // of what the user had just scrolled past. `flush` only queues the write onto its own tail and
    // returns void, so awaiting it awaited `undefined` and resolved before the write landed --
    // exactly the loss this was meant to prevent. `settled()` is the part worth waiting for.
    store?.flush(now());
    catchUpStore?.flush(now());
    await store?.settled();
    await catchUpStore?.settled();
    teardown();
    ctx.diagnostics.info("Seen-post dimming removed");
  },

  getStatus() {
    return {
      ok: true,
    message: store ? `Seen posts tracked: ${store.size}` : "Seen-post tracking idle"
    };
  }
};

function seenDimmingEnabled(ctx: FeatureContext): boolean {
  const surfaces = ctx.settings.filter.dimSeenSurfaces;
  return (
    ctx.settings.filter.dimSeenPosts &&
    (!surfaces || surfaces.includes(ctx.route.surface as FilterSurface))
  );
}

function scan(ctx: FeatureContext, root: ParentNode | Element): void {
  const articles = collect(root);
  if (articles.length === 0) {
    return;
  }
  let marked = false;
  let captured = false;

  for (const article of articles) {
    const id = readTweetId(article);
    if (!id) {
      continue;
    }
    const tracked = visibility.get(article);
    if (tracked && tracked.id !== id) {
      cancelDwell(article);
      visibility.delete(article);
    }
    if (store!.has(id)) {
      article.setAttribute(MARKER, "1");
    } else if (isDirectStatusPost(ctx, article, id)) {
      const result = qualify(ctx, article, id);
      marked ||= result.marked;
      captured ||= result.captured;
    } else {
      article.removeAttribute(MARKER);
      observeArticle(ctx, article, id);
    }

    const seenAt = store!.seenAt(id);
    if (seenAt !== null && catchUpStore && !isDirectStatusPost(ctx, article, id)) {
      const record = collectExportRecords(article, ctx.route.surface)[0];
      if (record) {
        catchUpStore.upsertExportRecord(
          record,
          seenAt,
          classifyArticle(article, article.getAttribute("data-av-filter-reason")),
          article.getAttribute("data-av-filter-reason"),
          readMetrics(article)
        );
        captured = true;
      }
    }
  }

  if (marked || captured) {
    scheduleFlush(now());
  }
}

function now(): number {
  return testSeams.now?.() ?? Date.now();
}

function scheduleTimer(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
  return (testSeams.setTimeout ?? setTimeout)(callback, delay);
}

function clearTimer(timer: ReturnType<typeof setTimeout>): void {
  (testSeams.clearTimeout ?? clearTimeout)(timer);
}

function ensureVisibilityObserver(ctx: FeatureContext): IntersectionObserver | undefined {
  if (visibilityObserver) return visibilityObserver;
  const factory = testSeams.createObserver ?? ((callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => {
    if (typeof IntersectionObserver !== "function") return undefined as unknown as IntersectionObserver;
    return new IntersectionObserver(callback, options);
  });
  visibilityObserver = factory((entries) => {
    for (const entry of entries) {
      handleVisibility(ctx, entry);
    }
  }, { threshold: [0, MIN_VISIBLE_RATIO] });
  if (!visibilityObserver) return undefined;
  visibilityChangeHandler = () => {
    if (document.visibilityState === "visible") {
      refreshTrackedVisibility(ctx);
      return;
    }
    for (const article of visibility.keys()) {
      const state = visibility.get(article);
      if (state) visibility.set(article, { ...state, visible: false });
      cancelDwell(article);
    }
  };
  document.addEventListener("visibilitychange", visibilityChangeHandler);
  visibilityRefreshHandler = () => refreshTrackedVisibility(ctx);
  document.addEventListener("scroll", visibilityRefreshHandler, true);
  window.addEventListener("resize", visibilityRefreshHandler);
  return visibilityObserver;
}

function observeArticle(ctx: FeatureContext, article: Element, id: string): void {
  const observer = ensureVisibilityObserver(ctx);
  if (!observer || visibility.has(article)) return;
  visibility.set(article, { id, visible: false });
  observer.observe(article);
}

function handleVisibility(ctx: FeatureContext, entry: IntersectionObserverEntry): void {
  const article = entry.target as Element;
  const id = readTweetId(article);
  if (!id || !store || store.has(id)) {
    cancelDwell(article);
    return;
  }
  const visible = document.visibilityState === "visible" && entry.isIntersecting && isVisibleEnough(entry);
  updateVisibility(ctx, article, id, visible);
}

function refreshTrackedVisibility(ctx: FeatureContext): void {
  const viewportHeight = typeof window === "object" && Number.isFinite(window.innerHeight)
    ? window.innerHeight
    : 0;
  for (const article of [...visibility.keys()]) {
    if (!article.isConnected) {
      cancelDwell(article);
      visibility.delete(article);
      continue;
    }
    const id = readTweetId(article);
    if (!id || !store || store.has(id)) {
      cancelDwell(article);
      continue;
    }
    const rect = article.getBoundingClientRect();
    const height = rect.height;
    const intersectionHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    const ratio = height > 0 ? intersectionHeight / height : 0;
    const visible = document.visibilityState === "visible" && intersectionHeight > 0 && (
      ratio >= MIN_VISIBLE_RATIO || intersectionHeight >= MIN_VISIBLE_PIXELS
    );
    updateVisibility(ctx, article, id, visible);
  }
}

function updateVisibility(ctx: FeatureContext, article: Element, id: string, visible: boolean): void {
  const prior = visibility.get(article);
  visibility.set(article, { id, visible });
  if (!visible) {
    cancelDwell(article);
    return;
  }
  if (prior?.visible && dwellTimers.has(article)) return;
  const scheduledId = id;
  const timer = scheduleTimer(() => {
    dwellTimers.delete(article);
    const current = visibility.get(article);
    const currentId = readTweetId(article);
    if (!article.isConnected || !current?.visible || current.id !== scheduledId || currentId !== scheduledId) return;
    const result = qualify(ctx, article, scheduledId);
    if (result.marked || result.captured) scheduleFlush(now());
  }, DWELL_MS);
  dwellTimers.set(article, timer);
}

function isVisibleEnough(entry: IntersectionObserverEntry): boolean {
  if (entry.intersectionRatio >= MIN_VISIBLE_RATIO) return true;
  return entry.intersectionRect.height >= MIN_VISIBLE_PIXELS;
}

function cancelDwell(article: Element): void {
  const timer = dwellTimers.get(article);
  if (timer !== undefined) {
    clearTimer(timer);
    dwellTimers.delete(article);
  }
}

function isDirectStatusPost(ctx: FeatureContext, article: Element, id: string): boolean {
  if (ctx.route.surface !== "status") return false;
  const match = /\/status\/(\d{1,25})/.exec(ctx.route.path ?? "");
  if (!match) return false;
  return match[1] === id;
}

function qualify(ctx: FeatureContext, article: Element, id: string): { marked: boolean; captured: boolean } {
  if (!store || store.has(id)) return { marked: false, captured: false };
  const marked = store.mark(id, now());
  article.removeAttribute(MARKER);
  let captured = false;
  const seenAt = store.seenAt(id);
  if (seenAt !== null && catchUpStore) {
    const record = collectExportRecords(article, ctx.route.surface)[0];
    if (record) {
      catchUpStore.upsertExportRecord(
        record,
        seenAt,
        classifyArticle(article, article.getAttribute("data-av-filter-reason")),
        article.getAttribute("data-av-filter-reason"),
        readMetrics(article)
      );
      captured = true;
    }
  }
  return { marked, captured };
}

function collect(root: ParentNode | Element): Element[] {
  const selector = 'article[data-testid="tweet"]';
  const found: Element[] = [];
  if (root instanceof Element && root.matches(selector)) {
    found.push(root);
  }
  if ("querySelectorAll" in root) {
    for (const article of Array.from(root.querySelectorAll(selector))) {
      found.push(article);
    }
  }
  return found;
}

function readTweetId(article: Element): string | null {
  for (const link of Array.from(article.querySelectorAll('a[href*="/status/"]'))) {
    const match = /\/status\/(\d{1,25})/.exec(link.getAttribute("href") ?? "");
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/** A scroll marks dozens of posts; coalesce the writes rather than persisting per post. */
function scheduleFlush(now: number): void {
  if (flushTimer !== undefined) {
    return;
  }
  flushTimer = scheduleTimer(() => {
    flushTimer = undefined;
    store?.flush(now);
    catchUpStore?.flush(now);
  }, FLUSH_DELAY_MS);
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
article[data-testid="tweet"][${MARKER}="1"] {
  opacity: 0.55;
  transition: opacity 120ms ease;
}

/* Reading a faded post should bring it back rather than forcing a setting change. */
article[data-testid="tweet"][${MARKER}="1"]:hover,
article[data-testid="tweet"][${MARKER}="1"]:focus-within {
  opacity: 1;
}

html[data-av-motion="reduce"] article[data-testid="tweet"][${MARKER}="1"] {
  transition: none;
}
`;
  (document.head ?? document.documentElement).append(style);
}

function teardown(): void {
  // Turning the setting off also drops the pending timer, so push what it was holding first.
  if (flushTimer !== undefined) {
    const at = now();
    store?.flush(at);
    catchUpStore?.flush(at);
  }
  visibilityObserver?.disconnect();
  visibilityObserver = undefined;
  if (visibilityChangeHandler) {
    document.removeEventListener("visibilitychange", visibilityChangeHandler);
    visibilityChangeHandler = undefined;
  }
  if (visibilityRefreshHandler) {
    document.removeEventListener("scroll", visibilityRefreshHandler, true);
    window.removeEventListener("resize", visibilityRefreshHandler);
    visibilityRefreshHandler = undefined;
  }
  for (const timer of dwellTimers.values()) clearTimer(timer);
  dwellTimers.clear();
  visibility.clear();
  document.getElementById(STYLE_ID)?.remove();
  for (const article of Array.from(document.querySelectorAll(`[${MARKER}]`))) {
    article.removeAttribute(MARKER);
  }
  if (flushTimer !== undefined) {
    clearTimer(flushTimer);
    flushTimer = undefined;
  }
}

export function getSeenPostStore(): SeenPostStore | undefined {
  return store;
}

/** Test seam: module-level store and timer must not leak between cases. */
export function resetSeenPostsState(): void {
  teardown();
  store = undefined;
  storeLoading = undefined;
  catchUpStore = undefined;
  catchUpLoading = undefined;
  testSeams = {};
}

/** Test seam for deterministic dwell and observer-boundary tests. Production uses browser APIs. */
export function setSeenPostsTestSeams(next: SeenPostsTestSeams = {}): void {
  testSeams = next;
}

export function getCatchUpStore(): CatchUpStore | undefined {
  return catchUpStore;
}

function classifyArticle(article: Element, filterReason: string | null): CatchUpCategory {
  if (filterReason) return "filtered";
  const socialContext = article.querySelector('[data-testid="socialContext"]')?.textContent ?? "";
  if (/repost|retweeted|reposted/i.test(socialContext)) return "reposts";
  if (article.querySelector('[data-testid="quoteTweet"], [aria-labelledby="quoted"], div[role="link"][tabindex="0"] [data-testid="User-Name"]')) {
    return "quotes";
  }
  if (/replying to/i.test(article.textContent ?? "")) return "replies";
  return "original";
}

function readMetrics(article: Element): CatchUpMetrics {
  return {
    replies: readMetric(article, "reply"),
    likes: readMetric(article, "like"),
    reposts: readMetric(article, "retweet") || readMetric(article, "repost")
  };
}

function readMetric(article: Element, testId: string): number {
  const node = article.querySelector(`[data-testid="${testId}"], [data-testid="${testId}Toggle"]`);
  const source = node?.getAttribute("aria-label") ?? node?.textContent ?? "";
  const match = /([\d,.]+)\s*(?:[KMB])?/i.exec(source);
  if (!match) return 0;
  const raw = match[1]!.replace(/,/g, "");
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  const suffix = /([KMB])/i.exec(source)?.[1]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.max(0, Math.floor(value * multiplier));
}
