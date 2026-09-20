import type { FeatureContext, FeatureModule } from "../registry.ts";

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const CONTROL_SELECTOR = 'button, a[role="link"], [role="button"]';
const TEXT_SELECTOR = '[data-testid="tweetText"]';
const SCROLL_IDLE_MS = 180;

/** Exact labels X currently uses for a post body's expansion control. */
const SHOW_MORE_LABELS = new Set([
  "Show more",
  "Mostrar más",
  "Mostrar mais",
  "Afficher plus",
  "Mehr anzeigen",
  "さらに表示",
  "더 보기",
  "عرض المزيد",
  "הצג עוד",
  "显示更多",
  "顯示更多"
]);

let activeContext: FeatureContext | undefined;
let expandedControls = new WeakSet<Element>();
const pendingRoots = new Set<ParentNode>();
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let scrollBusyUntil = 0;
let listenersAttached = false;
let expandedCount = 0;

export const autoExpandPostsFeature: FeatureModule = {
  id: "layout.autoExpandPosts",
  title: "Automatic long-post expansion",
  category: "layout",

  init(ctx) {
    activeContext = ctx;
    reconcile(ctx, document);
  },

  apply(ctx, root, addedNodes) {
    activeContext = ctx;
    if (!ctx.settings.layout.autoExpandPostText) {
      teardown(false);
      return;
    }
    attachListeners();
    if (addedNodes && addedNodes.length > 0) {
      for (const node of addedNodes) pendingRoots.add(node);
    } else {
      pendingRoots.add(root);
    }
    scheduleScan();
  },

  destroy() {
    teardown(true);
  },

  getStatus() {
    return {
      ok: true,
      message: expandedCount === 0
        ? "Automatic long-post expansion idle"
        : `Long posts expanded: ${expandedCount}`
    };
  }
};

function reconcile(ctx: FeatureContext, root: ParentNode): void {
  if (!ctx.settings.layout.autoExpandPostText) {
    teardown(false);
    return;
  }
  attachListeners();
  pendingRoots.add(root);
  scheduleScan();
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  globalThis.addEventListener("scroll", markScrolling, { capture: true, passive: true });
  document.addEventListener("scroll", markScrolling, { capture: true, passive: true });
}

function detachListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  globalThis.removeEventListener("scroll", markScrolling, true);
  document.removeEventListener("scroll", markScrolling, true);
}

function markScrolling(): void {
  scrollBusyUntil = now() + SCROLL_IDLE_MS;
  if (pendingRoots.size > 0) scheduleScan();
}

function scheduleScan(): void {
  if (scanTimer !== undefined) clearTimeout(scanTimer);
  const wait = Math.max(35, Math.ceil(scrollBusyUntil - now()));
  scanTimer = setTimeout(flushScan, wait);
}

function flushScan(): void {
  scanTimer = undefined;
  const ctx = activeContext;
  if (!ctx?.settings.layout.autoExpandPostText) {
    pendingRoots.clear();
    return;
  }
  const remaining = scrollBusyUntil - now();
  if (remaining > 0) {
    scheduleScan();
    return;
  }

  const roots = [...pendingRoots];
  pendingRoots.clear();
  if (roots.some((root) => root === document)) {
    expandIn(document);
    return;
  }
  for (const root of roots) {
    if (root instanceof Element && !root.isConnected) continue;
    expandIn(root);
  }
}

function expandIn(root: ParentNode): void {
  for (const article of collectArticles(root)) {
    for (const control of Array.from(article.querySelectorAll<Element>(CONTROL_SELECTOR))) {
      if (expandedControls.has(control) || !isOwnPostExpansion(article, control)) continue;
      expandedControls.add(control);
      try {
        (control as HTMLElement).click();
        expandedCount += 1;
      } catch (error) {
        activeContext?.diagnostics.warn("Long post could not be expanded", errorDetails(error));
      }
    }
  }
}

function collectArticles(root: ParentNode): Element[] {
  const articles = new Set<Element>();
  if (root instanceof Element) {
    const article = root.matches(ARTICLE_SELECTOR) ? root : root.closest(ARTICLE_SELECTOR);
    if (article) articles.add(article);
  }
  if ("querySelectorAll" in root) {
    for (const article of Array.from(root.querySelectorAll(ARTICLE_SELECTOR))) {
      articles.add(article);
    }
  }
  return [...articles];
}

function isOwnPostExpansion(article: Element, control: Element): boolean {
  if (control.closest(ARTICLE_SELECTOR) !== article) return false;
  if (control.closest('[role="group"]')) return false;
  const label = normalizedLabel(control);
  if (!SHOW_MORE_LABELS.has(label)) return false;

  // A quote card is inside the outer article and may have its own collapsed body. Its author owns
  // that control, so the outer post must not click it as a side effect of expanding itself.
  const nestedCard = control.closest('[data-testid="card.wrapper"], [role="link"][tabindex="0"]');
  if (nestedCard && nestedCard !== article && nestedCard.querySelector(TEXT_SELECTOR)) return false;

  const ownText = Array.from(article.querySelectorAll<Element>(TEXT_SELECTOR)).find((text) => {
    if (text.closest(ARTICLE_SELECTOR) !== article) return false;
    const card = text.closest('[data-testid="card.wrapper"], [role="link"][tabindex="0"]');
    return !card || card === article;
  });
  if (!ownText) return false;
  return ownText.contains(control) ||
    Boolean(ownText.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function normalizedLabel(control: Element): string {
  const html = control as HTMLElement;
  return (html.innerText || control.textContent || control.getAttribute("aria-label") || "")
    .replace(/\s+/g, " ")
    .trim();
}

function teardown(resetCount: boolean): void {
  detachListeners();
  if (scanTimer !== undefined) {
    clearTimeout(scanTimer);
    scanTimer = undefined;
  }
  pendingRoots.clear();
  scrollBusyUntil = 0;
  activeContext = undefined;
  if (resetCount) {
    expandedControls = new WeakSet();
    expandedCount = 0;
  }
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}
