import type { FilterSurface } from "../../platform/settings.ts";
import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";
import {
  derivePostKey,
  handleFromHref,
  HiddenPostStore,
  type HiddenPostEntry
} from "./hidden-posts.ts";

const STYLE_ID = "av-hidden-posts";
const TOAST_HOST_ID = "av-hidden-toast";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const BUTTON_ATTR = "data-av-hide-button";
const HIDDEN_ATTR = "data-av-hidden";
const KEY_ATTR = "data-av-post-key";
const STATE_ATTR = "data-av-hide-state";
const TOAST_TIMEOUT_MS = 8000;

/**
 * Slack around the Hide control that belongs to the control rather than to the post.
 *
 * X makes the whole row a click target, so a press that lands a few pixels off the Hide button
 * opens the tweet instead -- the one outcome someone reaching for Hide never wants. The pad,
 * the clamps and the events swallowed inside the zone are all here together because they only
 * make sense read as one rule.
 */
const DEAD_ZONE_PAD_PX = 14;
/** The zone can never grow past the post header, whatever the button ends up measuring. */
const DEAD_ZONE_MAX_HEIGHT_PX = 64;
/** Nor past the corner it guards: the rest of the row keeps opening the tweet. */
const DEAD_ZONE_MAX_WIDTH_RATIO = 0.5;
const DEAD_ZONE_EVENTS = ["mousedown", "mouseup", "click", "auxclick"] as const;
/**
 * Anything that is its own control keeps its click: the Hide button, X's More menu, the author
 * and timestamp links, embedded media. Only the inert filler between them is swallowed.
 */
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, video, audio, summary, label, [role="button"], ' +
  '[role="link"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="tab"], ' +
  '[contenteditable="true"]';
/**
 * The post's own content keeps its click even where it reaches under the zone.
 *
 * A long first line runs to the same edge the controls sit against, and opening the tweet by
 * clicking its text is the deliberate gesture the zone exists to protect, not the accident.
 */
const CONTENT_SELECTOR =
  '[data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="card.wrapper"], ' +
  '[data-testid="User-Name"], img, svg';

let store: HiddenPostStore | undefined;
let lastAppliedVersion = -1;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let reflowHandle: number | undefined;
let deadZoneListener: ((event: Event) => void) | undefined;
/**
 * The context the dead zone reads, refreshed on every boot.
 *
 * The listener is installed once and outlives any single `init`, so closing over the context it
 * was created with would leave it judging live presses against a profile that had been replaced.
 */
let deadZoneCtx: FeatureContext | undefined;
let deadZoneBlocks = 0;

interface DeadZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type NativePopover = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

export const hiddenPostsFeature: FeatureModule = {
  id: "filtering.hiddenPosts",
  title: "Hide posts",
  category: "filtering",

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
    installDeadZone(ctx);
    scan(document, ctx);
    ctx.diagnostics.info("Hidden posts initialized", { hidden: store.size() });
  },

  apply(ctx, root, addedNodes) {
    // Off, or on a surface this does not cover: clear once and leave. Calling ensureStyle first
    // appended a stylesheet that clearDecorations then removed, on every mutation batch.
    if (!ctx.settings.hidden.enabled || !surfaceMatches(ctx)) {
      applyRootClass(ctx);
      clearDecorations();
      return;
    }

    ensureStyle();
    applyRootClass(ctx);
    if (!store) {
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
    removeDeadZone();
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
  const toastHost = document.getElementById(TOAST_HOST_ID);
  const toastCard = toastHost?.shadowRoot?.querySelector<HTMLElement>(".av-toast");
  try {
    (toastCard as NativePopover | null)?.hidePopover?.();
  } catch {
    // The host is removed immediately below, so no further cleanup is required.
  }
  toastHost?.remove();
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

  // Identity first, deliberately. `resolvePostKey` is what notices the virtualizer has swapped a
  // different post into this element, and it clears the processed stamp when it does -- so reading
  // the stamp before resolving would take the already-processed fast path on a node describing a
  // post that is no longer there, and skip the reveal it now needs.
  const key = resolvePostKey(article);
  const stateStamp = String(store.version());
  if (article.getAttribute(STATE_ATTR) === stateStamp) {
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

/**
 * Cached on the node, and revalidated against it.
 *
 * The key never changes for a given *post*, but X's virtualizer reuses the article element itself
 * and swaps the post inside it. A cache that trusted the attribute therefore let a recycled node
 * carry the previous post's key — and since a stored key collapses on sight, an unrelated post
 * would vanish. Deriving a tweet id is one `a[href*="/status/"]` read, so confirming the cached key
 * still belongs to what is rendered costs little against hiding the wrong thing.
 *
 * Posts with no `/status/` link fall back to a handle+text signature, which cannot be checked this
 * cheaply; those keep the cached value, and re-deriving the full signature on every pass would cost
 * more than the case is worth.
 */
function resolvePostKey(article: Element): string | null {
  const cached = article.getAttribute(KEY_ATTR);
  if (cached) {
    const tweetId = readTweetId(article);
    if (!tweetId || cached === derivePostKey({ tweetId, handle: null, text: "" })) {
      return cached;
    }
    // The node now holds a different post, so every per-node cache on it is stale -- including the
    // processed stamp, whose fast path would otherwise skip the reveal this article now needs and
    // leave the previous post's collapse in place.
    article.removeAttribute(KEY_ATTR);
    article.removeAttribute(STATE_ATTR);
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
  // Only nudge on the transition. `apply` re-collapses every stored-hidden article on every pass,
  // and the nudge dispatches a resize the virtualizer answers with childList mutations -- which
  // drive the next apply. Nudging unconditionally therefore fed itself for as long as any hidden
  // post was on screen. `reveal` has always had this guard; collapse did not.
  const changed = target.getAttribute(HIDDEN_ATTR) !== "1";
  target.setAttribute(HIDDEN_ATTR, "1");
  article.querySelector(`[${BUTTON_ATTR}]`)?.remove();
  if (changed) {
    nudgeReflow();
  }
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

/**
 * Swallows presses that land beside the Hide control instead of on it.
 *
 * The listener sits on `window` in the capture phase, which is upstream of every handler X
 * installs on the row, and it is installed once for the life of the feature: the decision is
 * made per event, from live settings, so a toggled setting takes effect without rebinding.
 */
function installDeadZone(ctx: FeatureContext): void {
  deadZoneCtx = ctx;
  if (deadZoneListener || typeof window === "undefined") {
    return;
  }
  deadZoneListener = (event: Event) => {
    if (!deadZoneCtx || !inDeadZone(event, deadZoneCtx)) {
      return;
    }
    if (event.type === "click" || event.type === "auxclick") {
      deadZoneBlocks += 1;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  };
  for (const type of DEAD_ZONE_EVENTS) {
    window.addEventListener(type, deadZoneListener, true);
  }
}

function removeDeadZone(): void {
  if (!deadZoneListener || typeof window === "undefined") {
    return;
  }
  for (const type of DEAD_ZONE_EVENTS) {
    window.removeEventListener(type, deadZoneListener, true);
  }
  deadZoneListener = undefined;
  deadZoneCtx = undefined;
}

/** Presses Aviary has absorbed beside the Hide button, for diagnostics and tests. */
export function hideDeadZoneBlocks(): number {
  return deadZoneBlocks;
}

function inDeadZone(event: Event, ctx: FeatureContext): boolean {
  if (!ctx.settings.hidden.enabled || !ctx.settings.hidden.buttons || !surfaceMatches(ctx)) {
    return false;
  }
  if (!(event instanceof MouseEvent)) {
    return false;
  }
  // `detail` is 0 for a click synthesized from the keyboard, whose coordinates are 0,0 and
  // therefore meaningless here. Keyboard activation is never a misclick, so leave it alone.
  if (event.type === "click" && event.detail === 0) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  // X sometimes lays a filler element over the row that is outside the article; the owning cell
  // still leads back to the post it belongs to.
  const own = target.closest(ARTICLE_SELECTOR);
  const cell = target.closest(CELL_SELECTOR);
  const article = own ?? cell?.querySelector(ARTICLE_SELECTOR) ?? null;
  if (!article) {
    return false;
  }
  if (hitsControl(target, own ?? cell) || target.closest(CONTENT_SELECTOR)) {
    return false;
  }
  const zone = deadZoneRect(article);
  if (!zone) {
    return false;
  }
  return (
    event.clientX >= zone.left &&
    event.clientX <= zone.right &&
    event.clientY >= zone.top &&
    event.clientY <= zone.bottom
  );
}

/**
 * Walks from the pressed node up to the post, not to the document.
 *
 * `closest` would have been shorter and wrong: X wraps rows and quoted posts in `role="link"`
 * containers, so an unbounded walk reports a control for every press inside a post and the zone
 * would never fire once. The post itself is the boundary because its own navigation is the
 * behaviour being suppressed.
 */
function hitsControl(target: Element, boundary: Element | null): boolean {
  let node: Element | null = target;
  while (node && node !== boundary) {
    if (node.matches(INTERACTIVE_SELECTOR)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * The corner the Hide control occupies, padded.
 *
 * Anchored to the button and the More menu rather than to a fixed slice of the article, because
 * the header height and the control's inline position both move with X's layout, the font size
 * and the reading direction. Absent a button there is nothing to miss, so there is no zone.
 */
function deadZoneRect(article: Element): DeadZone | null {
  const button = article.querySelector(`[${BUTTON_ATTR}]`);
  if (!button) {
    return null;
  }
  const articleRect = article.getBoundingClientRect();
  const controls = [button, article.querySelector('[data-testid="caret"]')]
    .filter((node): node is Element => node !== null)
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (controls.length === 0 || articleRect.width === 0) {
    return null;
  }

  const left = Math.min(...controls.map((rect) => rect.left));
  const right = Math.max(...controls.map((rect) => rect.right));
  const bottom = Math.max(...controls.map((rect) => rect.bottom));

  // Reach out to whichever edge of the post the controls already sit against, so the gap between
  // the last control and the corner is covered too. That edge is the inline end in either
  // direction, which is why it is measured rather than assumed to be the right.
  const towardEnd = articleRect.right - right <= left - articleRect.left;
  const maxWidth = articleRect.width * DEAD_ZONE_MAX_WIDTH_RATIO;
  return {
    left: towardEnd
      ? Math.max(left - DEAD_ZONE_PAD_PX, articleRect.right - maxWidth)
      : articleRect.left,
    right: towardEnd
      ? articleRect.right
      : Math.min(right + DEAD_ZONE_PAD_PX, articleRect.left + maxWidth),
    top: articleRect.top,
    bottom: Math.min(bottom + DEAD_ZONE_PAD_PX, articleRect.top + DEAD_ZONE_MAX_HEIGHT_PX)
  };
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
      showToast(`${ft(ctx, "Post hidden")} · ${store.size()}`, ctx);
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
  try {
    if (!card.matches(":popover-open")) {
      (card as NativePopover).showPopover?.();
    }
  } catch {
    // The manifest floors include Popover API support. Keep the authored state as a safe fallback
    // for embedded test hosts that expose the attribute but not the methods.
  }
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
    try {
      (card as NativePopover).hidePopover?.();
    } catch {
      // Keep teardown best-effort if a host removes the popover implementation mid-toast.
    }
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
  card.setAttribute("popover", "manual");
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
  inset: auto;
  inset-inline-end: 16px;
  bottom: 76px;
  margin: 0;
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

.av-toast:popover-open {
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
