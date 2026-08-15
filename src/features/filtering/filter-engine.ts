import type { FilterSurface } from "../../platform/settings";
import type { FeatureContext, FeatureModule } from "../registry";
import {
  compileFilters,
  decide,
  extractTweetSignal,
  type CompiledFilters,
  type FilterDecision
} from "./predicates";
import { compileRules, type RuleParseError } from "./rules";

const STYLE_ID = "av-filter-engine";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const PROCESSED_ATTR = "data-av-filter-processed";
const RESULT_ATTR = "data-av-filter-result";
const CELL_RESULT_ATTR = "data-av-filter-cell-hidden";

let generation = 0;
let ruleErrors: RuleParseError[] = [];

/** Parse failures from the last compile, for the Control Center to surface. */
export function filterRuleErrors(): RuleParseError[] {
  return [...ruleErrors];
}
let compiled: CompiledFilters | undefined;
/** Serialised filter inputs behind the current `compiled`, so an unchanged apply is free. */
let compiledSignature = "";
let filterActive = false;

export const filterEngineFeature: FeatureModule = {
  id: "filtering.engine",
  title: "Filter engine",
  category: "filtering",

  init(ctx) {
    ensureFilterStyle();
    refreshCompiled(ctx);
    filterActive = ctx.settings.filter.enabled && surfaceMatches(ctx);
    applyRootClasses(ctx);
    if (filterActive) {
      scanRoot(document, ctx);
    }
    ctx.diagnostics.info("Filter engine initialized", filterSummary(ctx));
  },

  apply(ctx, root, addedNodes) {
    ensureFilterStyle();
    applyRootClasses(ctx);
    refreshCompiled(ctx);

    const active = ctx.settings.filter.enabled && surfaceMatches(ctx);
    if (!active) {
      if (filterActive) {
        clearDecorations();
      }
      filterActive = false;
      return;
    }
    filterActive = true;

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
    compiledSignature = "";
    generation = 0;
    clearDecorations();
    document.getElementById(STYLE_ID)?.remove();
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
  document.documentElement.classList.toggle(
    "av-filter-enabled",
    ctx.settings.filter.enabled && surfaceMatches(ctx)
  );
}

function surfaceMatches(ctx: FeatureContext): boolean {
  const surfaces = ctx.settings.filter.surfaces as readonly FilterSurface[];
  return surfaces.includes(ctx.route.surface as FilterSurface);
}

function refreshCompiled(ctx: FeatureContext): void {
  // `generation` doubles as the per-article processed stamp, so bumping it on every apply
  // invalidated every article on every mutation batch -- the stamp check could never hit and
  // the whole visible timeline was re-extracted (5+ querySelectorAll each) roughly every 120ms.
  const signature = filterSignature(ctx);
  if (compiled && signature === compiledSignature) {
    return;
  }
  compiledSignature = signature;
  generation += 1;
  const ruleSet = compileRules(ctx.settings.filter.rules);
  ruleErrors = ruleSet.errors;
  if (ruleErrors.length > 0) {
    // A rule that cannot be parsed must be visible, not a filter that silently never matches.
    ctx.diagnostics.warn("Filter rules could not be parsed", {
      count: ruleErrors.length,
      firstLine: ruleErrors[0]?.line ?? 0
    });
  }
  compiled = compileFilters({
    rules: ruleSet.rules,
    keywords: ctx.settings.filter.keywordRules,
    regex: ctx.settings.filter.regexRules,
    whitelist: ctx.settings.filter.whitelist,
    premium: ctx.settings.filter.premiumRule,
    media: ctx.settings.filter.mediaTypes,
    generation
  });
}

function filterSignature(ctx: FeatureContext): string {
  const filter = ctx.settings.filter;
  return JSON.stringify([
    filter.rules,
    filter.keywordRules,
    filter.regexRules,
    filter.whitelist,
    filter.premiumRule,
    filter.mediaTypes,
    filter.enabled
  ]);
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
  syncCollapsedCell(article);
}

function clearDecorations(): void {
  document.documentElement.classList.remove("av-filter-enabled");
  for (const node of Array.from(
    document.querySelectorAll(`[${PROCESSED_ATTR}], [${RESULT_ATTR}], [${CELL_RESULT_ATTR}]`)
  )) {
    node.removeAttribute(PROCESSED_ATTR);
    node.removeAttribute(RESULT_ATTR);
    node.removeAttribute(CELL_RESULT_ATTR);
  }
  filterActive = false;
}

function syncCollapsedCell(article: Element): void {
  const cell = article.closest(CELL_SELECTOR);
  if (!cell || cell === article) {
    return;
  }
  const hasHiddenArticle = cell.querySelector(
    `${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"]`
  ) !== null;
  cell.toggleAttribute(CELL_RESULT_ATTR, hasHiddenArticle);
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

html.av-filter-enabled [${CELL_RESULT_ATTR}="1"] {
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
