import type { RouteSurface } from "./route.ts";

export type ChurnRisk = "Low" | "Medium" | "High";
export type SelectorRelevance = "required" | "optional" | "inapplicable";
export type SelectorMatch = "stable" | "fallback" | "missing";

export interface SelectorComparison {
  surface: string;
  equivalent: string | null;
  disagreement: string | null;
  source: string;
  checkedOn: string;
  license: string;
  reference: string;
}

/**
 * Dated comparison notes, not executable third-party code. These records keep selector research
 * reviewable and make it explicit when an upstream behavior has no equivalent in Aviary.
 */
export const SELECTOR_COMPARISON: readonly SelectorComparison[] = [
  {
    surface: "App root",
    equivalent: "h1[role=heading][aria-level=1] followed by an aria-labeled root",
    disagreement: "browsertrix walks from the heading; Aviary uses X's explicit react-root anchor",
    source: "browsertrix-behaviors 0.13.1",
    checkedOn: "2026-09-07",
    license: "AGPL-3.0-or-later",
    reference: "https://github.com/webrecorder/browsertrix-behaviors/blob/v0.13.1/src/site/twitter.ts"
  },
  {
    surface: "Tweet",
    equivalent: "article",
    disagreement: "browsertrix scopes articles below its crawl root; Aviary keeps an article fallback for recycled rows",
    source: "browsertrix-behaviors 0.13.1",
    checkedOn: "2026-09-07",
    license: "AGPL-3.0-or-later",
    reference: "https://github.com/webrecorder/browsertrix-behaviors/blob/v0.13.1/src/site/twitter.ts"
  },
  {
    surface: "Media photo",
    equivalent: "a[href*='/photo/']",
    disagreement: "the upstream behavior opens the viewer; Aviary reads the rendered image for a local download",
    source: "browsertrix-behaviors 0.13.1",
    checkedOn: "2026-09-07",
    license: "AGPL-3.0-or-later",
    reference: "https://github.com/webrecorder/browsertrix-behaviors/blob/v0.13.1/src/site/twitter.ts"
  },
  {
    surface: "Video",
    equivalent: "video or audio descendant",
    disagreement: "browsertrix waits for playback; Aviary observes network metadata so downloads do not require playback",
    source: "browsertrix-behaviors 0.13.1",
    checkedOn: "2026-09-07",
    license: "AGPL-3.0-or-later",
    reference: "https://github.com/webrecorder/browsertrix-behaviors/blob/v0.13.1/src/site/twitter.ts"
  },
  {
    surface: "Promoted placement",
    equivalent: "div[data-testid='placementTracking']",
    disagreement: null,
    source: "browsertrix-behaviors 0.13.1",
    checkedOn: "2026-09-07",
    license: "AGPL-3.0-or-later",
    reference: "https://github.com/webrecorder/browsertrix-behaviors/blob/v0.13.1/src/site/twitter.ts"
  },
  {
    surface: "Profile photo grid",
    equivalent: "entry id /^profile-(photo-)?grid-/",
    disagreement: "twitter-web-exporter observes GraphQL module ids, while Aviary can only prove rendered DOM structure",
    source: "twitter-web-exporter 1.4.3-beta.1",
    checkedOn: "2026-09-07",
    license: "MIT",
    reference: "https://github.com/prinsss/twitter-web-exporter/commit/3e07f1e7ad7469c1bd6526b03bdcb90c495f25b1"
  },
  {
    surface: "Videos plain tweet entries",
    equivalent: "TimelineAddEntries containing ordinary tweet entries",
    disagreement: "twitter-web-exporter notes the API route change; no new Aviary selector is copied without a DOM fixture",
    source: "twitter-web-exporter 1.4.3-beta.1",
    checkedOn: "2026-09-07",
    license: "MIT",
    reference: "https://github.com/prinsss/twitter-web-exporter/commit/3e07f1e7ad7469c1bd6526b03bdcb90c495f25b1"
  }
];

export interface SurfaceSelector {
  surface: string;
  stable: string;
  fallback: string;
  churnRisk: ChurnRisk;
  note: string;
  /**
   * The feature that stops working when this selector stops matching.
   *
   * Required, not optional. It was declared optional with an if-chain behind it that answered for
   * whatever the field omitted -- so the field could be skipped and the chain, ending in a generic
   * "Aviary surface", would answer instead. That is the arrangement the comment here claimed to
   * have replaced. Making it required means a new surface cannot compile without naming what breaks
   * when it stops matching, which is the whole point: Trust reports these names to a user trying to
   * find out which feature X just broke.
   */
  feature: string;
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
    note: "Readiness anchor only; do not use as the scan scope after boot.",
    feature: "Boot and timeline scope"
  },
  {
    surface: "Primary column",
    stable: '[data-testid="primaryColumn"]',
    fallback: ".r-150rngu.r-16y2uox",
    churnRisk: "Medium",
    note: "Main observer scope for timeline pages.",
    feature: "Boot and timeline scope"
  },
  {
    surface: "Sidebar",
    stable: '[data-testid="sidebarColumn"]',
    fallback: ".r-1ifxtd0.r-1udh08x",
    churnRisk: "High",
    note: "Optional because the sidebar collapses by viewport.",
    feature: "Layout declutter"
  },
  {
    surface: "Tweet",
    stable: 'article[data-testid="tweet"]',
    fallback: "article .css-175oi2r, article",
    churnRisk: "High",
    note: "Process added articles only and mark processed nodes.",
    feature: "Filtering and export"
  },
  {
    surface: "Tweet text",
    stable: '[data-testid="tweetText"]',
    fallback: 'article div[lang] span',
    churnRisk: "Medium",
    note: "Text extraction source with article textContent fallback.",
    feature: "Filtering and export"
  },
  {
    surface: "Composer",
    stable: '[data-testid="tweetTextarea_0"]',
    fallback: 'div[role="textbox"][aria-label]',
    churnRisk: "High",
    note: "Draft.js-aware insertion required for later composer features.",
    feature: "Composer and crosspost"
  },
  {
    surface: "Media photo",
    stable: '[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]',
    fallback: 'img[src*="format="], [data-testid^="profile-photo-grid-"] img[src*="pbs.twimg.com/media"]',
    churnRisk: "Medium",
    note: "Normalize image URLs to original quality before download.",
    feature: "Media controls"
  },
  {
    surface: "Video",
    stable: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
    fallback: 'video[src], div[aria-label*="Video"]',
    churnRisk: "High",
    note: "Network capture is required for complete video variants.",
    feature: "Media controls"
  },
  {
    surface: "Navigation",
    stable: '[data-testid^="AppTabBar_"], [data-testid="SideNav_NewTweet_Button"]',
    fallback: 'nav[aria-label] a[role="link"]',
    churnRisk: "High",
    note: "Support full, compact, and mobile navigation.",
    feature: "Layout declutter"
  },
  {
    surface: "Grok",
    stable:
      '[data-testid="GrokDrawer"], [data-testid="grokImgGen"], a[href="/i/grok"], button[aria-label="Grok actions"]',
    fallback: 'div[id*="grok" i]',
    churnRisk: "High",
    note: "Drawer, navigation, image-generation, and per-post Grok surfaces change frequently; isolate all tweaks.",
    feature: "Grok declutter"
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
      relevance: selectorRelevance(entry.surface, route, root),
      matched,
      matchedSelector: matched === "stable" ? entry.stable : matched === "fallback" ? entry.fallback : null,
      feature: entry.feature
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

function selectorRelevance(surface: string, route: RouteSurface, root: ParentNode): SelectorRelevance {
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
  // A post action bar is only applicable when the route actually contains a post. Treating an
  // empty feed as broken would make a freshly mounted home shell look degraded before X has
  // rendered its first article.
  if (surface === "Post actions") {
    return CONTENT_SURFACES.has(route) && countMatches(root, 'article[data-testid="tweet"]') > 0
      ? "required"
      : "inapplicable";
  }
  if (["Tweet", "Tweet text", "Composer", "Media photo", "Video"].includes(surface)) {
    return CONTENT_SURFACES.has(route) ? "optional" : "inapplicable";
  }
  if (surface === "Sidebar") {
    return route === "settings" ? "inapplicable" : "optional";
  }
  return "optional";
}

/** Stable registry ids used in content-free selector break reports. */
const SELECTOR_FEATURE_IDS: Record<string, readonly string[]> = {
  "Boot and timeline scope": ["core.boot"],
  "Layout declutter": ["layout.declutter"],
  "Filtering and export": ["filtering.engine", "export.core"],
  "Composer and crosspost": ["composer.snippets", "integrations.crosspost"],
  "Media controls": ["media.buttons", "media.presentation"],
  "Grok declutter": ["layout.declutter"],
  "Filtering, hidden posts, thread recommendations": [
    "filtering.engine",
    "filtering.hiddenPosts",
    "layout.threadRecommendations"
  ],
  "Media buttons, AI menu, composer snippets": [
    "media.buttons",
    "ai.commandMenu",
    "composer.snippets"
  ],
  "Hide engagement counts": ["appearance.theme"],
  "Account notes, colours, handle rules": ["library.userNotes", "filtering.engine"],
  "Video playback preferences": ["performance.videoPlayback", "performance.pauseOffscreenVideo"],
  "Hide trends": ["layout.declutter"],
  "Sidebar declutter": ["layout.declutter"],
  "Hide follow suggestions": ["layout.declutter"],
  "Navigation declutter, open Following first": ["layout.declutter", "layout.forceFollowing"],
  "Ad contract observations": ["privacy.adProtection", "core.selectorHealth"]
};

export function getSelectorFeatureIds(feature: string): readonly string[] {
  const known = SELECTOR_FEATURE_IDS[feature];
  if (known) return known;
  const slug = feature.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
  return [`selector.${slug || "unknown"}`];
}


function countMatches(root: ParentNode, selector: string): number {
  try {
    const self = root instanceof Element && root.matches(selector) ? 1 : 0;
    return self + root.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}
