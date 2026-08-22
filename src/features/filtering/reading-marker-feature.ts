import { translateText } from "../../platform/i18n.ts";
import type { FeatureContext, FeatureModule } from "../registry.ts";
import {
  compareTweetIds,
  isReadingMarkerSurface,
  ReadingMarkerStore,
  type ReadingMarkerSurface
} from "./seen-posts.ts";

const STYLE_ID = "av-reading-marker";
const SEPARATOR_ATTR = "data-av-reading-separator";
const NEW_ATTR = "data-av-reading-new";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const FLUSH_DELAY_MS = 900;

interface ArticleState {
  id: string;
  wasVisible: boolean;
}

let store: ReadingMarkerStore | undefined;
let storeLoading: Promise<void> | undefined;
let activeSurface: ReadingMarkerSurface | undefined;
let activeContext: FeatureContext | undefined;
let articleStates = new Map<Element, ArticleState>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let listenersAttached = false;

async function ensureStore(ctx: FeatureContext): Promise<void> {
  if (store) return;
  if (!storeLoading) {
    const pending = new ReadingMarkerStore(ctx.storage);
    storeLoading = pending.load().then(
      () => {
        store = pending;
      },
      (error) => {
        storeLoading = undefined;
        throw error;
      }
    );
  }
  await storeLoading;
}

export const readingMarkerFeature: FeatureModule = {
  id: "filtering.readingMarkers",
  title: "Read markers",
  category: "filtering",

  async init(ctx) {
    if (!enabled(ctx)) {
      teardown();
      return;
    }
    await ensureStore(ctx);
    switchSurface(ctx);
    ensureStyle();
    attachListeners();
    scanArticles();
    renderSeparator(ctx, false);
  },

  async apply(ctx) {
    if (!enabled(ctx)) {
      teardown();
      return;
    }
    await ensureStore(ctx);
    switchSurface(ctx);
    activeContext = ctx;
    ensureStyle();
    attachListeners();
    scanArticles();
    renderSeparator(ctx, true);
  },

  async destroy() {
    store?.flush();
    await store?.settled();
    teardown();
  },

  getStatus() {
    return {
      ok: true,
      message: store ? `Read markers stored: ${Object.keys(store.snapshot().markers).length}` : "Read markers idle"
    };
  }
};

function enabled(ctx: FeatureContext): boolean {
  const surface = ctx.route.surface;
  return Boolean(
    ctx.settings.layout.readMarker &&
      isReadingMarkerSurface(surface) &&
      ctx.settings.layout.readMarkerSurfaces.includes(surface)
  );
}

function switchSurface(ctx: FeatureContext): void {
  const next = isReadingMarkerSurface(ctx.route.surface) ? ctx.route.surface : undefined;
  if (activeSurface === next) {
    activeContext = ctx;
    return;
  }
  removeSeparator();
  articleStates = new Map();
  activeSurface = next;
  activeContext = ctx;
}

function scanArticles(): void {
  const live = new Set<Element>();
  const height = globalThis.innerHeight || document.documentElement.clientHeight || 0;
  for (const article of Array.from(document.querySelectorAll<Element>(ARTICLE_SELECTOR))) {
    const id = readTweetId(article);
    if (!id) continue;
    live.add(article);
    const existing = articleStates.get(article);
    if (existing && existing.id === id) continue;
    const rect = article.getBoundingClientRect();
    articleStates.set(article, {
      id,
      // This is observation only. A marker is never advanced from this render pass.
      wasVisible: height > 0 && rect.bottom > 0 && rect.top < height
    });
  }
  for (const article of articleStates.keys()) {
    if (!live.has(article)) articleStates.delete(article);
  }
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  globalThis.addEventListener("scroll", scheduleScrollScan, { passive: true });
  document.addEventListener("scroll", scheduleScrollScan, { capture: true, passive: true });
}

function detachListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  globalThis.removeEventListener("scroll", scheduleScrollScan);
  document.removeEventListener("scroll", scheduleScrollScan, true);
  if (scrollTimer !== undefined) {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  }
}

function scheduleScrollScan(): void {
  if (scrollTimer !== undefined) return;
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined;
    observeUpwardExit();
  }, 0);
}

function observeUpwardExit(): void {
  if (!activeSurface || !store || !activeContext) return;
  const height = globalThis.innerHeight || document.documentElement.clientHeight || 0;
  if (height <= 0) return;
  let changed = false;
  const now = Date.now();
  for (const [article, state] of articleStates) {
    if (!article.isConnected) {
      articleStates.delete(article);
      continue;
    }
    const rect = article.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < height;
    if (visible) {
      state.wasVisible = true;
      continue;
    }
    if (state.wasVisible && rect.bottom <= 0) {
      state.wasVisible = false;
      changed = store.advance(activeSurface, state.id, now) || changed;
    }
  }
  if (changed) {
    store.flush();
    scheduleFlush();
    renderSeparator(activeContext, true);
  }
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    store?.flush();
  }, FLUSH_DELAY_MS);
}

function renderSeparator(ctx: FeatureContext, preservePosition: boolean): void {
  if (!activeSurface || !store) return;
  const marker = store.get(activeSurface);
  const anchor = preservePosition ? readingAnchor() : null;
  const articles = Array.from(document.querySelectorAll<Element>(ARTICLE_SELECTOR))
    .map((article) => ({ article, id: readTweetId(article) }))
    .filter((entry): entry is { article: Element; id: string } => entry.id !== null);
  for (const { article } of articles) article.removeAttribute(NEW_ATTR);
  removeSeparator();
  if (!marker) {
    restoreReadingAnchor(anchor);
    return;
  }

  const newEntries = articles.filter(({ id }) => compareTweetIds(id, marker.lastReadId) > 0);
  if (newEntries.length === 0) {
    restoreReadingAnchor(anchor);
    return;
  }
  for (const { article } of newEntries) article.setAttribute(NEW_ATTR, "1");

  const firstOldIndex = articles.findIndex(({ id }) => compareTweetIds(id, marker.lastReadId) <= 0);
  const separator = buildSeparator(ctx, newEntries);
  if (firstOldIndex >= 0) {
    articles[firstOldIndex]!.article.parentElement?.insertBefore(separator, articles[firstOldIndex]!.article);
  } else {
    const last = articles.at(-1)?.article;
    last?.parentElement?.insertBefore(separator, last.nextSibling);
  }
  restoreReadingAnchor(anchor);
}

function buildSeparator(
  ctx: FeatureContext,
  newEntries: Array<{ article: Element; id: string }>
): HTMLElement {
  const separator = document.createElement("div");
  separator.className = "av-reading-separator";
  separator.setAttribute(SEPARATOR_ATTR, "1");
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", translateText(ctx.settings.i18n.locale, "New since you last looked"));
  const label = document.createElement("span");
  label.textContent = translateText(ctx.settings.i18n.locale, "New since you last looked");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "av-reading-mark-button";
  button.textContent = translateText(ctx.settings.i18n.locale, "Mark above as read");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // The line is before the first old post. The topmost new id is the boundary that marks the
    // whole group above it as read, so the separator disappears in one explicit action.
    const target = newEntries[0];
    if (!activeSurface || !target || !store) return;
    if (store.set(activeSurface, target.id, Date.now())) {
      store.flush();
      void store.settled();
      renderSeparator(ctx, true);
    }
  });
  separator.append(label, button);
  return separator;
}

interface ReadingAnchor {
  article: Element;
  top: number;
}

function readingAnchor(): ReadingAnchor | null {
  for (const article of Array.from(document.querySelectorAll<Element>(ARTICLE_SELECTOR))) {
    const rect = article.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < (globalThis.innerHeight || document.documentElement.clientHeight || 0)) {
      return { article, top: rect.top };
    }
  }
  return null;
}

function restoreReadingAnchor(anchor: ReadingAnchor | null): void {
  if (!anchor?.article.isConnected) return;
  const delta = anchor.article.getBoundingClientRect().top - anchor.top;
  if (!delta) return;
  const scroller = document.scrollingElement;
  if (scroller) {
    scroller.scrollTop += delta;
  } else {
    globalThis.scrollBy?.(0, delta);
  }
}

function removeSeparator(): void {
  document.querySelector(`[${SEPARATOR_ATTR}]`)?.remove();
}

function readTweetId(article: Element): string | null {
  for (const link of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))) {
    const match = /\/status\/(\d{1,25})/.exec(link.getAttribute("href") ?? "");
    if (match?.[1]) return match[1];
  }
  return null;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.av-reading-separator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  margin: 8px 0;
  padding: 0 16px;
  border-block: 1px solid color-mix(in srgb, var(--av-accent, #1d9bf0) 32%, transparent);
  background: color-mix(in srgb, var(--av-accent, #1d9bf0) 8%, transparent);
  color: var(--av-accent, #1d9bf0);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
}
.av-reading-mark-button {
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid currentColor;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  font-style: inherit;
  font-size: 12px;
  font-weight: inherit;
  line-height: inherit;
}
.av-reading-mark-button:hover,
.av-reading-mark-button:focus-visible {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
html[data-av-motion="reduce"] .av-reading-mark-button { transition: none; }
`;
  (document.head ?? document.documentElement).append(style);
}

function teardown(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  detachListeners();
  removeSeparator();
  for (const article of articleStates.keys()) article.removeAttribute(NEW_ATTR);
  document.getElementById(STYLE_ID)?.remove();
  articleStates = new Map();
  activeSurface = undefined;
  activeContext = undefined;
}

export function getReadingMarkerStore(): ReadingMarkerStore | undefined {
  return store;
}

export function resetReadingMarkerState(): void {
  teardown();
  store = undefined;
  storeLoading = undefined;
}
