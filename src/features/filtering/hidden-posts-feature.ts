import type { FilterSurface } from "../../platform/settings";
import type { FeatureContext, FeatureModule } from "../registry";
import { ft } from "../core/feature-i18n";
import {
  derivePostKey,
  handleFromHref,
  HiddenPostStore,
  type HiddenPostEntry
} from "./hidden-posts";

const STYLE_ID = "av-hidden-posts";
const TOAST_HOST_ID = "av-hidden-toast";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const BUTTON_ATTR = "data-av-hide-button";
const HIDDEN_ATTR = "data-av-hidden";
const KEY_ATTR = "data-av-post-key";
const STATE_ATTR = "data-av-hide-state";
const TOAST_TIMEOUT_MS = 8000;

let store: HiddenPostStore | undefined;
let lastAppliedVersion = -1;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let reflowHandle: number | undefined;

export const hiddenPostsFeature: FeatureModule = {
  id: "filtering.hiddenPosts",
  title: "Hide posts",
  category: "filtering",
  defaultEnabled: true,

  async init(ctx) {
    store = new HiddenPostStore(ctx.storage, (error) => {
      ctx.diagnostics.error("Hidden posts failed to save", errorDetails(error));
    });
    try {
      await store.load(ctx.settings.hidden.maxEntries);
    } catch (error) {
      ctx.diagnostics.error("Hidden posts failed to load", errorDetails(error));
    }
    if (ctx.settings.hidden.enabled) {
      ensureStyle();
    }
    applyRootClass(ctx);
    scan(document, ctx);
    ctx.diagnostics.info("Hidden posts initialized", { hidden: store.size() });
  },

  apply(ctx, root, addedNodes) {
    ensureStyle();
    applyRootClass(ctx);
    if (!store) {
      return;
    }

    if (!ctx.settings.hidden.enabled || !surfaceMatches(ctx)) {
      clearDecorations();
      return;
    }

    // A store mutation invalidates every article decision, not just the new nodes.
    if (store.version() !== lastAppliedVersion) {
      lastAppliedVersion = store.version();
      scan(document, ctx);
      return;
    }

    if (!addedNodes || addedNodes.length === 0) {
      scan(root, ctx);
      return;
    }
    for (const node of addedNodes) {
      scan(node, ctx);
    }
  },

  destroy(ctx) {
    clearDecorations();
    store = undefined;
    lastAppliedVersion = -1;
    ctx.diagnostics.info("Hidden posts destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: store ? `${store.size()} posts hidden` : "Hidden posts idle"
    };
  }
};

export function getHiddenPostStore(): HiddenPostStore | undefined {
  return store;
}

export async function undoLastHide(ctx: FeatureContext): Promise<HiddenPostEntry | null> {
  if (!store) {
    return null;
  }
  const entry = await store.undoLast();
  if (entry) {
    ctx.requestApply();
    void ctx.auditLog.record("post.unhide", { key: entry.key });
  }
  return entry;
}

export async function clearHiddenPosts(ctx: FeatureContext): Promise<number> {
  if (!store) {
    return 0;
  }
  const removed = await store.clear();
  ctx.requestApply();
  void ctx.auditLog.record("post.hide.cleared", { removed });
  return removed;
}

function applyRootClass(ctx: FeatureContext): void {
  document.documentElement.classList.toggle(
    "av-hide-posts-enabled",
    ctx.settings.hidden.enabled
  );
}

function clearDecorations(): void {
  const hadHiddenRows = document.querySelector(`[${HIDDEN_ATTR}]`) !== null;
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(TOAST_HOST_ID)?.remove();
  document.documentElement.classList.remove("av-hide-posts-enabled");
  for (const button of Array.from(document.querySelectorAll(`[${BUTTON_ATTR}]`))) {
    button.remove();
  }
  for (const node of Array.from(
    document.querySelectorAll(`[${HIDDEN_ATTR}], [${KEY_ATTR}], [${STATE_ATTR}]`)
  )) {
    node.removeAttribute(HIDDEN_ATTR);
    node.removeAttribute(KEY_ATTR);
    node.removeAttribute(STATE_ATTR);
  }
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer);
    toastTimer = undefined;
  }
  if (reflowHandle !== undefined && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(reflowHandle);
    reflowHandle = undefined;
  }
  if (hadHiddenRows) {
    nudgeReflow();
  }
}

function surfaceMatches(ctx: FeatureContext): boolean {
  const surfaces = ctx.settings.hidden.surfaces as readonly FilterSurface[];
  return surfaces.includes(ctx.route.surface as FilterSurface);
}

function scan(root: ParentNode | Element, ctx: FeatureContext): void {
  if (!store || !ctx.settings.hidden.enabled || !surfaceMatches(ctx)) {
    return;
  }

  for (const article of collectArticles(root)) {
    processArticle(article, ctx);
  }
}

function collectArticles(root: ParentNode | Element): Element[] {
  const found: Element[] = [];
  if (root instanceof Element && root.matches(ARTICLE_SELECTOR)) {
    found.push(root);
  }
  if ("querySelectorAll" in root) {
    for (const article of Array.from(root.querySelectorAll(ARTICLE_SELECTOR))) {
      found.push(article);
    }
  }
  return found;
}

function processArticle(article: Element, ctx: FeatureContext): void {
  if (!store) {
    return;
  }

  const stateStamp = String(store.version());
  if (article.getAttribute(STATE_ATTR) === stateStamp) {
    const key = resolvePostKey(article);
    if (!key) {
      return;
    }
    if (ctx.settings.hidden.buttons && !store.has(key)) {
      ensureButton(article, key, ctx);
    } else if (!ctx.settings.hidden.buttons) {
      article.querySelector(`[${BUTTON_ATTR}]`)?.remove();
    }
    return;
  }

  const key = resolvePostKey(article);
  article.setAttribute(STATE_ATTR, stateStamp);
  if (!key) {
    return;
  }

  if (store.has(key)) {
    collapse(article);
    return;
  }

  reveal(article);
  if (ctx.settings.hidden.buttons) {
    ensureButton(article, key, ctx);
  }
}

/** Cached on the node — the key never changes for a given rendered article. */
function resolvePostKey(article: Element): string | null {
  const cached = article.getAttribute(KEY_ATTR);
  if (cached) {
    return cached;
  }

  const key = derivePostKey(readIdentity(article));
  if (key) {
    article.setAttribute(KEY_ATTR, key);
  }
  return key;
}

function readIdentity(article: Element): {
  tweetId: string | null;
  handle: string | null;
  text: string;
} {
  return {
    tweetId: readTweetId(article),
    handle: readHandle(article),
    text: readText(article)
  };
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

function readHandle(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  for (const link of Array.from(userName?.querySelectorAll("a[href]") ?? [])) {
    const handle = handleFromHref(link.getAttribute("href"));
    if (handle) {
      return handle;
    }
  }
  return null;
}

function readText(article: Element): string {
  const nodes = article.querySelectorAll('[data-testid="tweetText"]');
  if (nodes.length > 0) {
    return Array.from(nodes)
      .map((node) => node.textContent ?? "")
      .join(" ");
  }
  return article.textContent ?? "";
}

/**
 * X positions timeline rows absolutely inside a measured container, so hiding the
 * article alone leaves its slot reserved. Collapsing the owning cell drops the row
 * height to zero and the next post is promoted into view.
 */
function collapseTarget(article: Element): Element {
  return article.closest(CELL_SELECTOR) ?? article;
}

function collapse(article: Element): void {
  const target = collapseTarget(article);
  target.setAttribute(HIDDEN_ATTR, "1");
  article.querySelector(`[${BUTTON_ATTR}]`)?.remove();
  nudgeReflow();
}

function reveal(article: Element): void {
  const target = collapseTarget(article);
  if (target.hasAttribute(HIDDEN_ATTR)) {
    target.removeAttribute(HIDDEN_ATTR);
    nudgeReflow();
  }
}

/**
 * The timeline virtualizer recomputes row offsets on resize; a single coalesced
 * event closes the gap left by a collapsed row without touching scroll position.
 */
function nudgeReflow(): void {
  if (reflowHandle !== undefined || typeof requestAnimationFrame !== "function") {
    return;
  }
  reflowHandle = requestAnimationFrame(() => {
    reflowHandle = undefined;
    globalThis.dispatchEvent(new Event("resize"));
  });
}

function ensureButton(article: Element, key: string, ctx: FeatureContext): void {
  if (article.querySelector(`[${BUTTON_ATTR}]`)) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "av-hide-button";
  button.setAttribute(BUTTON_ATTR, "1");
  button.textContent = ft(ctx, "Hide");
  button.title = ft(ctx, "Hide this post — Aviary keeps it hidden on future visits");
  button.setAttribute("aria-label", ft(ctx, "Hide this post"));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void hidePost(article, key, button, ctx);
  });

  const caret = article.querySelector('[data-testid="caret"]');
  if (caret?.parentElement) {
    caret.parentElement.insertBefore(button, caret);
    return;
  }

  const userName = article.querySelector('[data-testid="User-Name"]');
  if (userName) {
    userName.append(button);
    return;
  }

  article.prepend(button);
}

async function hidePost(
  article: Element,
  key: string,
  button: HTMLButtonElement,
  ctx: FeatureContext
): Promise<void> {
  if (!store) {
    return;
  }

  button.disabled = true;
  const identity = readIdentity(article);

  try {
    const entry = await store.hide({ ...identity, key }, ctx.settings.hidden.maxEntries);
    lastAppliedVersion = store.version();
    collapse(article);
    if (entry) {
      ctx.diagnostics.info("Post hidden", { key, handle: entry.handle });
      void ctx.auditLog.record("post.hide", { key });
      showToast(`${ft(ctx, "Post hidden")} — ${store.size()}`, ctx);
    }
  } catch (error) {
    button.disabled = false;
    ctx.diagnostics.error("Could not hide post", errorDetails(error));
    showToast(ft(ctx, "Could not save the hidden post. Storage rejected the write."), ctx);
  }
}

function showToast(message: string, ctx: FeatureContext): void {
  const shadow = ensureToastHost();
  const toastHost = document.getElementById(TOAST_HOST_ID);
  if (toastHost) {
    // The page-level motion class cannot cross into this shadow tree.
    toastHost.dataset.avMotion = reduceMotion(ctx) ? "reduce" : "full";
  }
  const card = shadow.querySelector(".av-toast");
  const text = shadow.querySelector(".av-toast-text");
  const undo = shadow.querySelector(".av-toast-undo");
  if (!(card instanceof HTMLElement) || !(text instanceof HTMLElement) || !(undo instanceof HTMLButtonElement)) {
    return;
  }

  text.textContent = message;
  undo.textContent = ft(ctx, "Undo");
  undo.disabled = false;
  undo.onclick = () => {
    undo.disabled = true;
    void undoLastHide(ctx)
      .then((entry) => {
        text.textContent = ft(ctx, entry ? "Post restored." : "Nothing left to restore.");
        scheduleToastDismiss(card, 2500);
      })
      .catch((error: unknown) => {
        ctx.diagnostics.error("Could not restore post", errorDetails(error));
        text.textContent = ft(ctx, "Could not restore that post.");
        scheduleToastDismiss(card, 4000);
      });
  };

  card.classList.add("is-open");
  scheduleToastDismiss(card, TOAST_TIMEOUT_MS);
}

function reduceMotion(ctx: FeatureContext): boolean {
  if (ctx.settings.accessibility.reduceMotion === "always") return true;
  if (ctx.settings.accessibility.reduceMotion === "never") return false;
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function scheduleToastDismiss(card: HTMLElement, delay: number): void {
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    card.classList.remove("is-open");
    toastTimer = undefined;
  }, delay);
}

function ensureToastHost(): ShadowRoot {
  const existing = document.getElementById(TOAST_HOST_ID);
  if (existing?.shadowRoot) {
    existing.dir = document.documentElement.dir || "ltr";
    return existing.shadowRoot;
  }

  const host = document.createElement("div");
  host.id = TOAST_HOST_ID;
  host.dataset.avOwned = "true";
  host.dir = document.documentElement.dir || "ltr";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOAST_CSS;

  const card = document.createElement("div");
  card.className = "av-toast";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const text = document.createElement("span");
  text.className = "av-toast-text";

  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "av-toast-undo";
  // Label set per-show in showToast, where the context (and therefore the locale) is in hand.

  card.append(text, undo);
  shadow.append(style, card);
  return shadow;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = HIDDEN_CSS;
  (document.head ?? document.documentElement).append(style);
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

const HIDDEN_CSS = `
html.av-hide-posts-enabled [${HIDDEN_ATTR}="1"] {
  display: none !important;
}

.av-hide-button {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin-inline-end: 4px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--av-muted, rgb(132, 139, 145)) 55%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--av-muted, rgb(132, 139, 145));
  cursor: pointer;
  font: 700 11px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  /* Resting state stays legible on its own: at 0.4 the label measured 1.56:1, which is
     invisible in practice and unreachable on touch, where there is no hover to reveal it. */
  opacity: 0.75;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
}

article[data-testid="tweet"]:hover .av-hide-button,
article[data-testid="tweet"]:focus-within .av-hide-button,
.av-hide-button:focus-visible {
  opacity: 1;
}

/* No hover to reveal on touch, so the control is always at full strength. */
@media (hover: none) {
  .av-hide-button {
    opacity: 1;
  }
}

.av-hide-button:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

.av-hide-button:hover {
  border-color: color-mix(in srgb, rgb(244, 33, 46) 70%, transparent);
  color: rgb(244, 33, 46);
}

.av-hide-button[disabled] {
  cursor: default;
  opacity: 0.3;
}
`;

/* Custom properties inherit through the shadow boundary, so the toast tracks the active
   theme instead of pinning the dim palette into every theme. */
const TOAST_CSS = `
.av-toast {
  position: fixed;
  inset-inline-end: 16px;
  bottom: 76px;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 320px;
  padding: 10px 12px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 97%, black);
  color: var(--av-text, rgb(239, 243, 244));
  font: 500 13px/1.35 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.av-toast.is-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.av-toast-text {
  flex: 1 1 auto;
}

.av-toast-undo {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--av-accent, rgb(29, 155, 240));
  border-radius: 6px;
  background: transparent;
  color: var(--av-accent, rgb(29, 155, 240));
  cursor: pointer;
  font-weight: 700;
  font-size: 12px;
  line-height: 1.1;
  font-family: inherit;
}

.av-toast-undo:focus-visible {
  outline: 2px solid var(--av-accent, rgb(29, 155, 240));
  outline-offset: 2px;
}

.av-toast-undo[disabled] {
  border-color: var(--av-border, rgb(47, 51, 54));
  color: var(--av-muted, rgb(132, 139, 145));
  cursor: default;
}

@media (pointer: coarse) {
  .av-toast-undo {
    min-height: 44px;
    padding: 8px 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .av-toast {
    transition: none;
    transform: none;
  }
}

:host([data-av-motion="reduce"]) .av-toast {
  transition: none;
  transform: none;
}
`;
