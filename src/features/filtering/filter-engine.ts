import type { FilterSurface } from "../../platform/settings";
import type { FeatureContext, FeatureModule } from "../registry";
import {
  compileFilters,
  decide,
  extractTweetSignal,
  type CompiledFilters,
  type FilterDecision
} from "./predicates";

const STYLE_ID = "av-filter-engine";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const PROCESSED_ATTR = "data-av-filter-processed";
const RESULT_ATTR = "data-av-filter-result";

let generation = 0;
let compiled: CompiledFilters | undefined;

export const filterEngineFeature: FeatureModule = {
  id: "filtering.engine",
  title: "Filter engine",
  category: "filtering",
  defaultEnabled: true,

  init(ctx) {
    ensureFilterStyle();
    refreshCompiled(ctx);
    applyRootClasses(ctx);
    scanRoot(document, ctx);
    ctx.diagnostics.info("Filter engine initialized", filterSummary(ctx));
  },

  apply(ctx, root, addedNodes) {
    ensureFilterStyle();
    applyRootClasses(ctx);
    refreshCompiled(ctx);

    if (!ctx.settings.filter.enabled || !surfaceMatches(ctx)) {
      return;
    }

    if (!addedNodes || addedNodes.length === 0) {
      scanRoot(root, ctx);
      return;
    }

    for (const node of addedNodes) {
      scanRoot(node, ctx);
    }
  },

  destroy(ctx) {
    compiled = undefined;
    generation = 0;
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.classList.remove("av-filter-enabled");
    for (const article of Array.from(
      document.querySelectorAll(`[${PROCESSED_ATTR}]`)
    )) {
      article.removeAttribute(PROCESSED_ATTR);
      article.removeAttribute(RESULT_ATTR);
    }
    ctx.diagnostics.info("Filter engine destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: compiled
        ? `Filters: ${compiled.keywords.length} keyword, ${compiled.patterns.length} regex`
        : "Filters idle"
    };
  }
};

function applyRootClasses(ctx: FeatureContext): void {
  const active = ctx.settings.filter.enabled && surfaceMatches(ctx);
  document.documentElement.classList.toggle("av-filter-enabled", active);
}

function surfaceMatches(ctx: FeatureContext): boolean {
  const surfaces = ctx.settings.filter.surfaces as readonly FilterSurface[];
  return surfaces.includes(ctx.route.surface as FilterSurface);
}

function refreshCompiled(ctx: FeatureContext): void {
  generation += 1;
  compiled = compileFilters({
    keywords: ctx.settings.filter.keywordRules,
    regex: ctx.settings.filter.regexRules,
    whitelist: ctx.settings.filter.whitelist,
    premium: ctx.settings.filter.premiumRule,
    media: ctx.settings.filter.mediaTypes,
    generation
  });
}

function scanRoot(root: ParentNode | Element, ctx: FeatureContext): void {
  if (!compiled || !ctx.settings.filter.enabled || !surfaceMatches(ctx)) {
    return;
  }

  const articles = collectArticles(root);
  for (const article of articles) {
    processArticle(article, compiled);
  }
}

function collectArticles(root: ParentNode | Element): Element[] {
  const results: Element[] = [];
  if (root instanceof Element && root.matches(ARTICLE_SELECTOR)) {
    results.push(root);
  }
  if ("querySelectorAll" in root) {
    for (const article of Array.from(root.querySelectorAll(ARTICLE_SELECTOR))) {
      results.push(article);
    }
  }
  return results;
}

function processArticle(article: Element, filters: CompiledFilters): void {
  if (article.getAttribute(PROCESSED_ATTR) === String(filters.generation)) {
    return;
  }

  const signal = extractTweetSignal(article);
  const decision: FilterDecision = decide(signal, filters);
  article.setAttribute(PROCESSED_ATTR, String(filters.generation));
  if (decision === "show") {
    article.removeAttribute(RESULT_ATTR);
  } else {
    article.setAttribute(RESULT_ATTR, decision);
  }
}

function filterSummary(ctx: FeatureContext): Record<string, unknown> {
  return {
    enabled: ctx.settings.filter.enabled,
    keywords: ctx.settings.filter.keywordRules.length,
    regex: ctx.settings.filter.regexRules.length,
    premium: ctx.settings.filter.premiumRule,
    media: Object.entries(ctx.settings.filter.mediaTypes)
      .filter(([, value]) => value)
      .map(([key]) => key),
    surfaces: ctx.settings.filter.surfaces
  };
}

function ensureFilterStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FILTER_CSS;
  (document.head ?? document.documentElement).append(style);
}

const FILTER_CSS = `
html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="hide"] {
  display: none !important;
}

html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="dim"] {
  opacity: 0.36;
  filter: grayscale(0.5);
  transition: opacity 120ms ease, filter 120ms ease;
}

html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="dim"]:hover,
html.av-filter-enabled article[data-testid="tweet"][${RESULT_ATTR}="dim"]:focus-within {
  opacity: 1;
  filter: none;
}
`;
