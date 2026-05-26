import type { FeatureContext, FeatureModule } from "../registry";

const STYLE_ID = "av-layout-declutter";

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
    document.documentElement.classList.remove(
      "av-hide-right-sidebar",
      "av-hide-trends",
      "av-hide-grok"
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
