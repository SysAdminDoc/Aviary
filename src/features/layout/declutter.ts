import type { FeatureContext, FeatureModule } from "../registry.ts";

const STYLE_ID = "av-layout-declutter";
/** Where a removed native `title` is parked so teardown can put X's own text back. */
const TITLE_STASH_ATTRIBUTE = "data-av-title";

/**
 * Writer mode watches the composer through focus events only. Key events are banned by policy
 * (preflight and the source contracts both reject them), and they would be the wrong signal
 * anyway — focus is what says "the user is composing", whether they arrived by pointer,
 * touch or Tab.
 */
const COMPOSER_SELECTOR = [
  '[data-testid^="tweetTextarea_"]',
  '[data-testid="toolBar"]',
  '[data-testid="tweetButtonInline"]',
  '[data-testid="tweetButton"]'
].join(", ");

let writerListenersBound = false;
let writerFrame = 0;

export const layoutDeclutterFeature: FeatureModule = {
  id: "layout.declutter",
  title: "Layout declutter",
  category: "layout",

  init(ctx) {
    ensureLayoutStyle();
    applyLayoutClasses(ctx);
    ctx.diagnostics.info("Layout declutter initialized");
  },

  apply(ctx, root) {
    ensureLayoutStyle();
    applyLayoutClasses(ctx);
    // Runs on every mutation batch, so a hover portal or a titled control X inserts later is
    // covered without this feature holding a pointer listener of its own. Suppression is CSS plus
    // an attribute swap; nothing here reacts to the pointer, which is also why a touch-only
    // session gains no listeners.
    if (ctx.settings.layout.suppressHoverPreviews) {
      stripNativeTitles(root instanceof Element || root instanceof Document ? root : document);
    }
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    restoreNativeTitles();
    unbindWriterListeners();
    document.documentElement.classList.remove(
      "av-hide-right-sidebar",
      "av-hide-trends",
      "av-hide-follow-suggestions",
      "av-hide-home-composer",
      "av-hide-grok",
      "av-suppress-hover",
      "av-writer-mode",
      "av-writing"
    );
    for (const className of Array.from(document.documentElement.classList)) {
      if (className.startsWith("av-hide-nav-")) {
        document.documentElement.classList.remove(className);
      }
    }
    ctx.diagnostics.info("Layout declutter destroyed");
  }
};

/**
 * Removes native `title` bubbles, keeping the text so the removal is reversible.
 *
 * A `title` is the one hover surface CSS cannot reach: the bubble is drawn by the browser, not by
 * the page. The value is parked on the element rather than dropped, because turning the setting
 * off has to give X back exactly what it wrote. Nothing else about the control changes, so
 * `aria-label`, `aria-describedby`, visible text and focus treatment are all untouched.
 */
function stripNativeTitles(scope: ParentNode): void {
  const roots: Element[] = [];
  if (scope instanceof Element && scope.hasAttribute("title")) roots.push(scope);
  for (const node of Array.from(scope.querySelectorAll<HTMLElement>("[title]"))) {
    roots.push(node);
  }
  for (const node of roots) {
    const title = node.getAttribute("title");
    if (title === null || node.hasAttribute(TITLE_STASH_ATTRIBUTE)) continue;
    node.setAttribute(TITLE_STASH_ATTRIBUTE, title);
    node.removeAttribute("title");
  }
}

function restoreNativeTitles(): void {
  for (const node of Array.from(
    document.querySelectorAll<HTMLElement>(`[${TITLE_STASH_ATTRIBUTE}]`)
  )) {
    const title = node.getAttribute(TITLE_STASH_ATTRIBUTE);
    if (title !== null) node.setAttribute("title", title);
    node.removeAttribute(TITLE_STASH_ATTRIBUTE);
  }
}

function applyLayoutClasses(ctx: FeatureContext): void {
  const root = document.documentElement;
  root.classList.toggle("av-hide-right-sidebar", ctx.settings.layout.hideRightSidebar);
  root.classList.toggle("av-hide-trends", ctx.settings.layout.hideTrends);
  root.classList.toggle("av-hide-follow-suggestions", ctx.settings.layout.hideFollowSuggestions === true);
  root.classList.toggle(
    "av-hide-home-composer",
    ctx.settings.layout.hideHomeComposer === true && ctx.route?.surface === "home"
  );
  root.classList.toggle("av-hide-grok", ctx.settings.layout.hideGrok);

  const suppressHover = ctx.settings.layout.suppressHoverPreviews === true;
  root.classList.toggle("av-suppress-hover", suppressHover);
  if (suppressHover) stripNativeTitles(document);
  else restoreNativeTitles();

  root.classList.toggle("av-writer-mode", ctx.settings.layout.writerMode);
  if (ctx.settings.layout.writerMode) {
    bindWriterListeners();
    syncWritingClass();
  } else {
    unbindWriterListeners();
  }

  for (const className of Array.from(root.classList)) {
    if (className.startsWith("av-hide-nav-")) {
      root.classList.remove(className);
    }
  }

  for (const item of ctx.settings.layout.hideNavItems) {
    const safe = item.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    if (safe.length > 0) {
      root.classList.add(`av-hide-nav-${safe}`);
    }
  }
}

function isComposerNode(node: unknown): boolean {
  if (!(node instanceof Element)) {
    return false;
  }
  return node.closest(COMPOSER_SELECTOR) !== null;
}

function syncWritingClass(): void {
  const writing = isComposerNode(document.activeElement);
  document.documentElement.classList.toggle("av-writing", writing);
}

/** focusout fires before focus lands, so re-read on the next frame. */
function onFocusOut(): void {
  if (writerFrame !== 0) {
    return;
  }
  const schedule = globalThis.requestAnimationFrame ?? ((cb: FrameRequestCallback) => globalThis.setTimeout(() => cb(0), 16));
  writerFrame = schedule(() => {
    writerFrame = 0;
    syncWritingClass();
  }) as unknown as number;
}

function bindWriterListeners(): void {
  if (writerListenersBound) {
    return;
  }
  document.addEventListener("focusin", syncWritingClass, true);
  document.addEventListener("focusout", onFocusOut, true);
  writerListenersBound = true;
}

function unbindWriterListeners(): void {
  if (!writerListenersBound) {
    document.documentElement.classList.remove("av-writing");
    return;
  }
  document.removeEventListener("focusin", syncWritingClass, true);
  document.removeEventListener("focusout", onFocusOut, true);
  if (writerFrame !== 0) {
    globalThis.cancelAnimationFrame?.(writerFrame);
    writerFrame = 0;
  }
  writerListenersBound = false;
  document.documentElement.classList.remove("av-writing");
}

function ensureLayoutStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LAYOUT_CSS;
  (document.head ?? document.documentElement).append(style);
}

const LAYOUT_CSS = `
/* Hover-only surfaces. X opens a profile card or a visual tooltip when the pointer rests on a
   name, avatar or control; both are portals it inserts near the end of the body, so hiding them
   by role and test id reaches every one without this feature listening for the pointer at all.
   Click-opened menus and dialogs use different roles and are deliberately left alone. */
html.av-suppress-hover [data-testid="hoverCardParent"],
html.av-suppress-hover [role="tooltip"] {
  display: none !important;
}

html.av-hide-right-sidebar [data-testid="sidebarColumn"] {
  display: none !important;
}

/* Once the discovery rail is gone, current X leaves its 820px reading column pinned to the
   rail's old edge inside a wider main canvas. Center it on full desktop layouts so the empty
   space becomes an intentional gutter on both sides instead of a stranded right-hand void. */
@media (min-width: 1200px) {
  html.av-hide-right-sidebar main[role="main"] div:has(> [data-testid="primaryColumn"]) {
    justify-content: center !important;
  }
}

/* Current X puts a zero-height news_sidebar marker beside the visible news card and nests
   trends inside an unlabelled region. Collapse the semantic module boundaries so headings and
   empty card chrome do not survive after their rows disappear. Keep the leaf selectors as a
   compatibility path for older markup. */
html.av-hide-trends [data-testid="sidebarColumn"] div:has(> [data-testid="news_sidebar"]),
html.av-hide-trends [data-testid="sidebarColumn"] section:has([data-testid="trend"]),
html.av-hide-trends [data-testid="news_sidebar"],
html.av-hide-trends [data-testid^="news_sidebar_article_"],
html.av-hide-trends [data-testid="trend"] {
  display: none !important;
}

html.av-hide-follow-suggestions [data-testid="sidebarColumn"] aside[role="complementary"]:has(a[href^="/i/connect_people"]),
html.av-hide-follow-suggestions [data-testid="sidebarColumn"] [data-testid="whoToFollowSspAd"] {
  display: none !important;
}

/* Home's quick composer is the direct child of its labelled timeline shell in current X. The
   direct toolbar selector keeps the sanitized/legacy fixture covered without reaching reply
   composers on status pages. The route-aware root class is only present on Home. */
html.av-hide-home-composer [data-testid="primaryColumn"] > [data-testid="toolBar"],
html.av-hide-home-composer [data-testid="primaryColumn"] > * > *:has([data-testid^="tweetTextarea_"]) {
  display: none !important;
}

/* Collapsed by features/layout/thread-recommendations.ts, which stamps the owning
   timeline cells only after a bounded heading label matched on a conversation route. */
[data-av-thread-recommendation="1"] {
  display: none !important;
}

html.av-hide-grok [data-testid="GrokDrawer"],
html.av-hide-grok [data-testid="GrokDrawerHeader"],
html.av-hide-grok [data-testid="chat-drawer-root"],
html.av-hide-grok [data-testid="chat-drawer-main"],
html.av-hide-grok [data-testid="grokImgGen"],
html.av-hide-grok [data-testid="sidebarColumn"] aside[role="complementary"]:has(a[href*="grok.com/"]),
html.av-hide-grok a[href="/i/grok"],
html.av-hide-grok button[aria-label="Grok actions"] {
  display: none !important;
}

/* Writer mode: only active while focus is inside the composer, so the timeline is untouched
   the rest of the time. Nothing is display:none'd here. The surroundings recede and come
   straight back on blur, which keeps the effect reversible mid-scroll. */
html.av-writer-mode.av-writing [data-testid="sidebarColumn"],
html.av-writer-mode.av-writing [data-testid="news_sidebar"] {
  opacity: 0.12;
  pointer-events: none;
}

html.av-writer-mode.av-writing [data-testid="cellInnerDiv"] {
  opacity: 0.28;
}

html.av-writer-mode [data-testid="sidebarColumn"],
html.av-writer-mode [data-testid="news_sidebar"],
html.av-writer-mode [data-testid="cellInnerDiv"] {
  transition: opacity 160ms ease;
}

html.av-writer-mode.av-writing [data-testid="cellInnerDiv"]:hover {
  opacity: 1;
}

html.av-hide-nav-premium [data-testid="premium-signup-tab"],
html.av-hide-nav-home [data-testid="AppTabBar_Home_Link"],
html.av-hide-nav-explore [data-testid="AppTabBar_Explore_Link"],
html.av-hide-nav-notifications [data-testid="AppTabBar_Notifications_Link"],
html.av-hide-nav-follow [data-testid="AppTabBar_Follow_Link"],
html.av-hide-nav-messages [data-testid="AppTabBar_DirectMessage_Link"],
html.av-hide-nav-chat [data-testid="AppTabBar_DirectMessage_Link"],
html.av-hide-nav-grok a[href="/i/grok"],
html.av-hide-nav-history a[href="/i/history"],
html.av-hide-nav-studio a[href="/i/jf/creators/studio"],
html.av-hide-nav-profile [data-testid="AppTabBar_Profile_Link"],
html.av-hide-nav-more [data-testid="AppTabBar_More_Menu"] {
  display: none !important;
}
`;
