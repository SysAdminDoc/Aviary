import type { FeatureContext, FeatureModule, FeatureStatus } from "../registry";

const STYLE_ID = "av-ad-protection";
const HIDDEN_ATTRIBUTE = "data-av-ad-hidden";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const TREND_SELECTOR = '[data-testid="trend"]';
const VIDEO_SELECTOR = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';
const HOUSE_PROMO_SELECTOR = [
  'aside[aria-label="Subscribe to Premium"]',
  '[data-testid^="super-upsell"]',
  'aside[role="complementary"]:has(a[href*="grok.com"])'
].join(", ");

const AD_LABELS = new Set([
  "Ad",
  "Promoted",
  "Sponsored",
  "Paid partnership",
  "Anuncio",
  "Promocionado",
  "Patrocinado",
  "Colaboración pagada",
  "Publicité",
  "Sponsorisé",
  "Partenariat rémunéré",
  "Anzeige",
  "Gesponsert",
  "Bezahlte Partnerschaft",
  "広告",
  "プロモーション",
  "タイアップ",
  "광고",
  "프로모션",
  "유료 파트너십",
  "Anúncio",
  "Promovido",
  "Parceria paga",
  "إعلان",
  "مُروَّج",
  "شراكة مدفوعة",
  "מודעה",
  "מקודם",
  "שותפות בתשלום"
]);

/**
 * The X UI languages whose ad labels are covered above.
 *
 * X ships far more UI languages than this. In an uncovered one, the label test can never match and
 * native sponsored posts are simply not suppressed — silently, which is the failure mode this
 * project keeps finding and fixing. `adLabelLanguageSupported` lets Trust say so out loud instead.
 *
 * Adding a language means adding its exact labels, and those cannot be invented: a guessed string
 * either never matches or matches ordinary prose. See Roadmap_Blocked.md.
 */
const LABELLED_LANGUAGES = new Set(["en", "es", "fr", "de", "ja", "ko", "pt", "ar", "he"]);

/** The X UI language, from the document element X itself sets. */
export function documentLanguage(): string {
  const raw = document.documentElement.getAttribute("lang") ?? "";
  return raw.trim().toLowerCase().split("-")[0] ?? "";
}

export function adLabelLanguageSupported(language = documentLanguage()): boolean {
  // An absent lang attribute is not evidence of an unsupported language; do not cry wolf.
  return language.length === 0 || LABELLED_LANGUAGES.has(language);
}

const PROMOTED_TREND_PREFIXES = [
  "Promoted by",
  "Sponsored by",
  "Promocionado por",
  "Patrocinado por",
  "Sponsorisé par",
  "Gesponsert von",
  "プロモーション",
  "프로모션",
  "Promovido por",
  "مُروَّج بواسطة",
  "מקודם על ידי"
];

const VIDEO_AD_MARKERS = [
  /Video will play after ad/i,
  /Skip Ad(?: in \d+ seconds?)?/i,
  /Ad will end in \d+ seconds?/i
];

let hiddenPlacements = 0;
let suppressedVideoAds = 0;

export interface AdMarkerCounts {
  native: number;
  trend: number;
  housePromo: number;
  video: number;
}

/**
 * Installs the paint-time half before storage or the feature registry can yield.
 *
 * Structural links and placement metadata are available in the same DOM insertion as the ad, so
 * modern :has() selectors can collapse those nodes in the first style calculation. The runtime
 * scanner below handles exact localized labels, counters, SPA reinsertion, and reversible opt-out.
 */
export function installEarlyAdShield(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add("av-block-ads");
  ensureStyle();
}

export const adProtectionFeature: FeatureModule = {
  id: "privacy.adProtection",
  title: "Ad protection",
  category: "privacy",

  init(ctx) {
    ensureStyle();
    applyAdProtection(ctx, document);
  },

  apply(ctx, root, addedNodes) {
    ensureStyle();
    applyAdProtection(ctx, root, addedNodes);
  },

  destroy(ctx) {
    document.documentElement.classList.remove("av-block-ads");
    clearMarked(document);
    document.getElementById(STYLE_ID)?.remove();
    hiddenPlacements = 0;
    suppressedVideoAds = 0;
    ctx.diagnostics.info("Ad protection destroyed");
  },

  getStatus(): FeatureStatus {
    const parts = [`${hiddenPlacements} placement${hiddenPlacements === 1 ? "" : "s"} removed`];
    if (suppressedVideoAds > 0) {
      parts.push(`${suppressedVideoAds} pre-roll${suppressedVideoAds === 1 ? "" : "s"} suppressed`);
    }
    return { ok: true, message: parts.join(" · ") };
  }
};

export function adProtectionCounters(): {
  hiddenPlacements: number;
  suppressedVideoAds: number;
} {
  return { hiddenPlacements, suppressedVideoAds };
}

/**
 * Counts only the structural markers the blocker itself trusts.
 *
 * This deliberately returns numbers rather than matched nodes or evidence strings. Selector
 * health can retain the result locally without retaining post text, handles, destination URLs,
 * response bodies, or any other account content.
 */
export function observeAdMarkers(root: ParentNode = document): AdMarkerCounts {
  const detected = detectPlacements(root);
  return {
    native: detected.native.length,
    trend: detected.trend.length,
    housePromo: detected.housePromo.length,
    video: detected.video.length
  };
}

function applyAdProtection(
  ctx: FeatureContext,
  root: ParentNode,
  addedNodes?: Element[]
): void {
  const enabled = ctx.settings.privacy.blockAds;
  document.documentElement.classList.toggle("av-block-ads", enabled);
  if (!enabled) {
    clearMarked(document);
    return;
  }

  const scopes: ParentNode[] = addedNodes && addedNodes.length > 0 ? addedNodes : [root];
  for (const scope of scopes) {
    const detected = detectPlacements(scope);
    for (const article of detected.native) {
      hidePlacement(article, "post");
    }
    for (const trend of detected.trend) {
      hidePlacement(trend, "trend");
    }
    for (const promo of detected.housePromo) {
      hidePlacement(promo, "house");
    }
    for (const video of detected.video) {
      hidePlacement(video, "video");
    }
    for (const video of candidates(scope, VIDEO_SELECTOR)) {
      if (!detected.video.includes(video) && video.getAttribute(HIDDEN_ATTRIBUTE) === "video") {
        video.removeAttribute(HIDDEN_ATTRIBUTE);
      }
    }
  }
}

function detectPlacements(root: ParentNode): {
  native: Element[];
  trend: Element[];
  housePromo: Element[];
  video: Element[];
} {
  return {
    native: candidates(root, ARTICLE_SELECTOR).filter(isSponsoredArticle),
    trend: candidates(root, TREND_SELECTOR).filter(isPromotedTrend),
    housePromo: candidates(root, HOUSE_PROMO_SELECTOR),
    video: candidates(root, VIDEO_SELECTOR).filter(containsVideoAdMarker)
  };
}

function candidates(root: ParentNode, selector: string): Element[] {
  const found = new Set<Element>();
  if (root instanceof Element) {
    try {
      if (root.matches(selector)) found.add(root);
      const ancestor = root.closest(selector);
      if (ancestor) found.add(ancestor);
    } catch {
      // A browser without :has() still gets every non-house detector below.
    }
  }
  try {
    for (const element of Array.from(root.querySelectorAll(selector))) found.add(element);
  } catch {
    // Selector support is best-effort; an unsupported house-promo selector must not stop posts.
  }
  return [...found];
}

function isSponsoredArticle(article: Element): boolean {
  if (
    article.querySelector(
      'a[href*="twclid="], a[href*="ad.doubleclick.net"], a[href*="/rules-and-policies/paid-partnerships-policy"]'
    )
  ) {
    return true;
  }
  const structuralPlacement = article.querySelector('[data-testid="placementTracking"]') !== null;
  const lacksTimestamp = article.querySelector("time") === null;
  return (structuralPlacement || lacksTimestamp) && containsExactLabel(article, AD_LABELS);
}

function isPromotedTrend(trend: Element): boolean {
  const lines = textLines(trend);
  return lines.some((line) => PROMOTED_TREND_PREFIXES.some((prefix) => line.startsWith(prefix)));
}

function containsExactLabel(root: Element, labels: ReadonlySet<string>): boolean {
  if (labels.has((root.textContent ?? "").trim())) return true;
  for (const node of Array.from(root.querySelectorAll("span, div"))) {
    if (labels.has((node.textContent ?? "").trim())) return true;
  }
  return false;
}

function containsVideoAdMarker(video: Element): boolean {
  return textLines(video).some((line) => VIDEO_AD_MARKERS.some((pattern) => pattern.test(line)));
}

function textLines(root: Element): string[] {
  return ((root as HTMLElement).innerText || root.textContent || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hidePlacement(element: Element, kind: "post" | "trend" | "house" | "video"): void {
  const target =
    kind === "post" ? element.closest('[data-testid="cellInnerDiv"]') ?? element : element;
  if (target.hasAttribute(HIDDEN_ATTRIBUTE)) return;
  target.setAttribute(HIDDEN_ATTRIBUTE, kind);
  if (kind === "video") suppressedVideoAds += 1;
  else hiddenPlacements += 1;
}

function clearMarked(root: ParentNode): void {
  if (root instanceof Element && root.hasAttribute(HIDDEN_ATTRIBUTE)) {
    root.removeAttribute(HIDDEN_ATTRIBUTE);
  }
  for (const element of Array.from(root.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`))) {
    element.removeAttribute(HIDDEN_ATTRIBUTE);
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = AD_PROTECTION_CSS;
  (document.head ?? document.documentElement).append(style);
}

export const AD_PROTECTION_CSS = `
html.av-block-ads [${HIDDEN_ATTRIBUTE}] {
  display: none !important;
}

/* Collapse the virtualizer cell, not just its article, so an ad cannot leave a feed-sized gap. */
html.av-block-ads [data-testid="cellInnerDiv"]:has(${ARTICLE_SELECTOR} a[href*="twclid="]),
html.av-block-ads [data-testid="cellInnerDiv"]:has(${ARTICLE_SELECTOR} a[href*="ad.doubleclick.net"]),
html.av-block-ads [data-testid="cellInnerDiv"]:has(${ARTICLE_SELECTOR} a[href*="/rules-and-policies/paid-partnerships-policy"]),
html.av-block-ads [data-testid="cellInnerDiv"]:has(${ARTICLE_SELECTOR} [data-testid="placementTracking"]):not(:has(${ARTICLE_SELECTOR} time)),
html.av-block-ads ${ARTICLE_SELECTOR}:has(a[href*="twclid="]),
html.av-block-ads ${ARTICLE_SELECTOR}:has(a[href*="ad.doubleclick.net"]),
html.av-block-ads ${ARTICLE_SELECTOR}:has(a[href*="/rules-and-policies/paid-partnerships-policy"]),
html.av-block-ads ${ARTICLE_SELECTOR}:not(:has(time)):has([data-testid="placementTracking"]),
html.av-block-ads aside[aria-label="Subscribe to Premium"],
html.av-block-ads [data-testid^="super-upsell"],
html.av-block-ads aside[role="complementary"]:has(a[href*="grok.com"]) {
  display: none !important;
}
`;
