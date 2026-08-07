import type { FeatureContext, FeatureModule } from "../registry";

const STYLE_ID = "av-layout-declutter";

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
  defaultEnabled: true,

  init(ctx) {
    ensureLayoutStyle();
    applyLayoutClasses(ctx);
    ctx.diagnostics.info("Layout declutter initialized");
  },

  apply(ctx) {
    ensureLayoutStyle();
    applyLayoutClasses(ctx);
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    unbindWriterListeners();
    document.documentElement.classList.remove(
      "av-hide-right-sidebar",
      "av-hide-trends",
      "av-hide-grok",
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

function applyLayoutClasses(ctx: FeatureContext): void {
  const root = document.documentElement;
  root.classList.toggle("av-hide-right-sidebar", ctx.settings.layout.hideRightSidebar);
  root.classList.toggle("av-hide-trends", ctx.settings.layout.hideTrends);
  root.classList.toggle("av-hide-grok", ctx.settings.layout.hideGrok);

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
html.av-hide-right-sidebar [data-testid="sidebarColumn"] {
  display: none !important;
}

html.av-hide-trends [data-testid="news_sidebar"],
html.av-hide-trends [data-testid="trend"] {
  display: none !important;
}

html.av-hide-grok [data-testid="GrokDrawer"],
html.av-hide-grok [data-testid="GrokDrawerHeader"],
html.av-hide-grok [data-testid="chat-drawer-root"],
html.av-hide-grok [data-testid="chat-drawer-main"],
html.av-hide-grok [data-testid="grokImgGen"] {
  display: none !important;
}

/* Writer mode: only active while focus is inside the composer, so the timeline is untouched
   the rest of the time. Nothing is display:none'd here — the surroundings recede and come
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
html.av-hide-nav-messages [data-testid="AppTabBar_DirectMessage_Link"],
html.av-hide-nav-profile [data-testid="AppTabBar_Profile_Link"],
html.av-hide-nav-more [data-testid="AppTabBar_More_Menu"] {
  display: none !important;
}
`;
