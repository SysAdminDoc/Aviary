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
  if (surface === "App root" || surface === "Primary column" || surface === "Navigation") {
    return "required";
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
