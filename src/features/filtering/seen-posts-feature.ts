import type { FeatureContext, FeatureModule } from "../registry";
import { SeenPostStore } from "./seen-posts";

const STYLE_ID = "av-seen-posts";
const MARKER = "data-av-seen";
const FLUSH_DELAY_MS = 1500;

let store: SeenPostStore | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (!ctx.settings.filter.dimSeenPosts) {
      teardown();
      return;
    }
    ensureStyle();
    if (!store) {
      store = new SeenPostStore(ctx.storage);
      await store.load();
    }
    scan(ctx, document);
  },

  apply(ctx, root, addedNodes) {
    if (!ctx.settings.filter.dimSeenPosts) {
      teardown();
      return;
    }
    ensureStyle();
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

  destroy(ctx) {
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

function scan(ctx: FeatureContext, root: ParentNode | Element): void {
  const articles = collect(root);
  if (articles.length === 0) {
    return;
  }
  const now = Date.now();
  let marked = false;

  for (const article of articles) {
    const id = readTweetId(article);
    if (!id) {
      continue;
    }
    if (store!.has(id)) {
      article.setAttribute(MARKER, "1");
      continue;
    }
    // First sighting: leave it undimmed, but remember it for next time.
    if (store!.mark(id, now)) {
      marked = true;
    }
    article.removeAttribute(MARKER);
  }

  if (marked) {
    scheduleFlush(now);
  }
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
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    store?.flush(now);
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
  document.getElementById(STYLE_ID)?.remove();
  for (const article of Array.from(document.querySelectorAll(`[${MARKER}]`))) {
    article.removeAttribute(MARKER);
  }
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
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
}
