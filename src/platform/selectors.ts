import type { RouteSurface } from "./route";

export type ChurnRisk = "Low" | "Medium" | "High";
export type SelectorRelevance = "required" | "optional" | "inapplicable";
export type SelectorMatch = "stable" | "fallback" | "missing";

export interface SurfaceSelector {
  surface: string;
  stable: string;
  fallback: string;
  churnRisk: ChurnRisk;
  note: string;
  /**
   * The feature that stops working when this selector stops matching. Declared on the entry so a
   * new surface cannot be added without naming its owner -- the older if-chain silently answered
   * "Aviary surface" for anything it had not been taught about.
   */
  feature?: string;
  /** Routes where this selector must be present. Absent means "content routes, optional". */
  requiredOn?: readonly RouteSurface[];
}

export interface SelectorHealth {
  surface: string;
  stable: string;
  fallback: string;
  stableCount: number;
  fallbackCount: number;
  churnRisk: ChurnRisk;
  healthy: boolean;
  relevance: SelectorRelevance;
  matched: SelectorMatch;
  matchedSelector: string | null;
  feature: string;
}

export const SURFACE_SELECTORS: SurfaceSelector[] = [
  {
    surface: "App root",
    stable: "#react-root",
    fallback: "body > div:first-child",
    churnRisk: "Medium",
    note: "Readiness anchor only; do not use as the scan scope after boot."
  },
  {
    surface: "Primary column",
    stable: '[data-testid="primaryColumn"]',
    fallback: ".r-150rngu.r-16y2uox",
    churnRisk: "Medium",
    note: "Main observer scope for timeline pages."
  },
  {
    surface: "Sidebar",
    stable: '[data-testid="sidebarColumn"]',
    fallback: ".r-1ifxtd0.r-1udh08x",
    churnRisk: "High",
    note: "Optional because the sidebar collapses by viewport."
  },
  {
    surface: "Tweet",
    stable: 'article[data-testid="tweet"]',
    fallback: "article .css-175oi2r",
    churnRisk: "High",
    note: "Process added articles only and mark processed nodes."
  },
  {
    surface: "Tweet text",
    stable: '[data-testid="tweetText"]',
    fallback: 'article div[lang] span',
    churnRisk: "Medium",
    note: "Text extraction source with article textContent fallback."
  },
  {
    surface: "Composer",
    stable: '[data-testid="tweetTextarea_0"]',
    fallback: 'div[role="textbox"][aria-label]',
    churnRisk: "High",
    note: "Draft.js-aware insertion required for later composer features."
  },
  {
    surface: "Media photo",
    stable: '[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]',
    fallback: 'img[src*="format="]',
    churnRisk: "Medium",
    note: "Normalize image URLs to original quality before download."
  },
  {
    surface: "Video",
    stable: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
    fallback: 'video[src], div[aria-label*="Video"]',
    churnRisk: "High",
    note: "Network capture is required for complete video variants."
  },
  {
    surface: "Navigation",
    stable: '[data-testid^="AppTabBar_"], [data-testid="SideNav_NewTweet_Button"]',
    fallback: 'nav[aria-label] a[role="link"]',
    churnRisk: "High",
    note: "Support full, compact, and mobile navigation."
  },
  {
    surface: "Grok",
    stable:
      '[data-testid="GrokDrawer"], [data-testid="grokImgGen"], a[href="/i/grok"], button[aria-label="Grok actions"]',
    fallback: 'div[id*="grok" i]',
    churnRisk: "High",
    note: "Drawer, navigation, image-generation, and per-post Grok surfaces change frequently; isolate all tweaks."
  },
  // Below: the selectors features actually depend on. Watching only the ten foundational surfaces
  // meant a rename anywhere else silently disabled its owning feature with no diagnostic -- the
  // exact failure the fixture discipline exists to prevent, happening outside the fixture's reach.
  {
    surface: "Timeline cell",
    stable: '[data-testid="cellInnerDiv"]',
    fallback: 'section[role="region"] > div > div',
    churnRisk: "High",
    note: "The hide/dim boundary and the thread-recommendation cut both anchor here.",
    feature: "Filtering, hidden posts, thread recommendations"
  },
  {
    surface: "Post actions",
    stable: '[data-testid="toolBar"]',
    fallback: 'article[data-testid="tweet"] [role="group"]',
    churnRisk: "High",
    note: "Where the media, AI and snippet controls mount.",
    feature: "Media buttons, AI menu, composer snippets"
  },
  {
    surface: "Engagement counts",
    stable: '[data-testid="app-text-transition-container"]',
    fallback: 'article[data-testid="tweet"] [role="group"] span',
    churnRisk: "High",
    note: "The per-metric count hiding scopes to this container.",
    feature: "Hide engagement counts"
  },
  {
    surface: "Author name",
    stable: '[data-testid="User-Name"]',
    fallback: 'article[data-testid="tweet"] a[role="link"] time',
    churnRisk: "Medium",
    note: "Handle extraction for notes, colours, whitelists and filter rules.",
    feature: "Account notes, colours, handle rules"
  },
  {
    surface: "Video component",
    stable: '[data-testid="videoComponent"]',
    fallback: 'article[data-testid="tweet"] video',
    churnRisk: "Medium",
    note: "Offscreen pause, keep-playing and loop all scope to this container.",
    feature: "Video playback preferences"
  },
  {
    surface: "Trends",
    stable: '[data-testid="trend"]',
    fallback: '[aria-label*="Trending"]',
    churnRisk: "High",
    note: "Trend declutter hides these rows.",
    feature: "Hide trends"
  },
  {
    surface: "News sidebar",
    stable: '[data-testid="news_sidebar"]',
    fallback: '[data-testid="sidebarColumn"] section',
    churnRisk: "High",
    note: "The right-rail news module.",
    feature: "Sidebar declutter"
  },
  {
    surface: "Who to follow",
    stable: '[data-testid="UserCell"]',
    fallback: '[data-testid="sidebarColumn"] [role="button"] img',
    churnRisk: "Medium",
    note: "Follow-suggestion rows in the rail and between timeline cells.",
    feature: "Hide follow suggestions"
  },
  {
    surface: "Home tab link",
    stable: '[data-testid="AppTabBar_Home_Link"]',
    fallback: 'nav[role="navigation"] a[href="/home"]',
    churnRisk: "Medium",
    note: "Navigation declutter and the Following-first behaviour both need it.",
    feature: "Navigation declutter, open Following first"
  },
  {
    surface: "Search box",
    stable: '[data-testid="SearchBox_Search_Input"]',
    fallback: 'input[role="combobox"]',
    churnRisk: "Medium",
    note: "Present on every route that carries the rail.",
    feature: "Sidebar declutter"
  },
  {
    surface: "Promoted placement",
    stable: '[data-testid="placementTracking"]',
    fallback: 'article[data-testid="tweet"] [data-testid="placementTracking"]',
    churnRisk: "High",
    note: "Observed for ad-contract drift only -- never used alone to hide a post.",
    feature: "Ad contract observations"
  }
];

export function getSelectorHealth(root: ParentNode = document): SelectorHealth[] {
  return getSelectorHealthForRoute(root, "unknown");
}

export function getSelectorHealthForRoute(
  root: ParentNode = document,
  route: RouteSurface = "unknown"
): SelectorHealth[] {
  return SURFACE_SELECTORS.map((entry) => {
    const stableCount = countMatches(root, entry.stable);
    const fallbackCount = countMatches(root, entry.fallback);
    const matched: SelectorMatch = stableCount > 0 ? "stable" : fallbackCount > 0 ? "fallback" : "missing";
    return {
      surface: entry.surface,
      stable: entry.stable,
      fallback: entry.fallback,
      stableCount,
      fallbackCount,
      churnRisk: entry.churnRisk,
      healthy: stableCount > 0 || fallbackCount > 0,
      relevance: selectorRelevance(entry.surface, route),
      matched,
      matchedSelector: matched === "stable" ? entry.stable : matched === "fallback" ? entry.fallback : null,
      feature: featureForSurface(entry.surface)
    };
  });
}

const CONTENT_SURFACES = new Set<RouteSurface>([
  "home",
  "status",
  "profile",
  "notifications",
  "search"
]);

function selectorRelevance(surface: string, route: RouteSurface): SelectorRelevance {
  const entry = SURFACE_SELECTORS.find((item) => item.surface === surface);
  if (entry?.requiredOn) {
    if (entry.requiredOn.includes(route)) return "required";
    return CONTENT_SURFACES.has(route) ? "optional" : "inapplicable";
  }
  if (surface === "App root" || surface === "Navigation") {
    return "required";
  }
  // Current /settings pages keep the app shell and navigation but no longer mount the timeline's
  // primaryColumn anchor. Treating it as required turned a healthy settings page red.
  if (surface === "Primary column") {
    return route === "settings" ? "inapplicable" : "required";
  }
  if (surface === "Grok") {
    return route === "grok" ? "required" : "optional";
  }
  if (["Tweet", "Tweet text", "Composer", "Media photo", "Video"].includes(surface)) {
    return CONTENT_SURFACES.has(route) ? "optional" : "inapplicable";
  }
  if (surface === "Sidebar") {
    return route === "settings" ? "inapplicable" : "optional";
  }
  return "optional";
}

function featureForSurface(surface: string): string {
  const declared = SURFACE_SELECTORS.find((entry) => entry.surface === surface)?.feature;
  if (declared) return declared;
  if (surface === "App root" || surface === "Primary column") return "Boot and timeline scope";
  if (surface === "Sidebar" || surface === "Navigation") return "Layout declutter";
  if (surface === "Tweet" || surface === "Tweet text") return "Filtering and export";
  if (surface === "Composer") return "Composer and crosspost";
  if (surface === "Media photo" || surface === "Video") return "Media controls";
  if (surface === "Grok") return "Grok declutter";
  return "Aviary surface";
}

function countMatches(root: ParentNode, selector: string): number {
  try {
    const self = root instanceof Element && root.matches(selector) ? 1 : 0;
    return self + root.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}
