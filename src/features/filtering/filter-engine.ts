import type { FilterSurface } from "../../platform/settings";
import type { FeatureContext, FeatureModule } from "../registry";
import {
  compileFilters,
  decide,
  extractTweetSignal,
  isExempt,
  structuralFilterPlan,
  structuralSelectorsFor,
  type CompiledFilters,
  type FilterDecision
} from "./predicates";
import { compileRules, type CompiledRule, type RuleParseError } from "./rules";

const STYLE_ID = "av-filter-engine";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const PROCESSED_ATTR = "data-av-filter-processed";
const RESULT_ATTR = "data-av-filter-result";
const CELL_RESULT_ATTR = "data-av-filter-cell-hidden";
/** Written on a post the allowlist exempts, so the structural rules can step over it. */
const ALLOW_RESULT = "allow";

let generation = 0;
let ruleErrors: RuleParseError[] = [];
let expiredRules: CompiledRule[] = [];
/** When the compiled set stops being current on its own, because a rule's window closes. */
let nextExpiry: number | null = null;

/** Parse failures from the last compile, for the Control Center to surface. */
export function filterRuleErrors(): RuleParseError[] {
  return [...ruleErrors];
}

/** Rules whose window has closed, for the Control Center to offer a renewal of. */
export function filterExpiredRules(): CompiledRule[] {
  return [...expiredRules];
}
let compiled: CompiledFilters | undefined;
/** Serialised filter inputs behind the current `compiled`, so an unchanged apply is free. */
let compiledSignature = "";
/** The stylesheet currently in the document, so an unchanged apply does not rewrite it. */
let styleText = "";
let filterActive = false;

export const filterEngineFeature: FeatureModule = {
  id: "filtering.engine",
  title: "Filter engine",
  category: "filtering",

  init(ctx) {
    refreshCompiled(ctx);
    syncFilterStyle();
    filterActive = ctx.settings.filter.enabled && surfaceMatches(ctx);
    applyRootClasses(ctx);
    if (filterActive) {
      scanRoot(document, ctx);
    }
    ctx.diagnostics.info("Filter engine initialized", filterSummary(ctx));
  },

  apply(ctx, root, addedNodes) {
    applyRootClasses(ctx);
    refreshCompiled(ctx);
    syncFilterStyle();

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
    styleText = "";
    expiredRules = [];
    nextExpiry = null;
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
  const now = Date.now();
  // A rule with a window stops applying when the window closes, and nothing else about the
  // settings changes at that moment -- so the compiled set has its own expiry beside the
  // signature. The clock is read once per apply, never per post.
  const stale = nextExpiry !== null && now >= nextExpiry;
  if (compiled && signature === compiledSignature && !stale) {
    return;
  }
  compiledSignature = signature;
  generation += 1;
  const ruleSet = compileRules(ctx.settings.filter.rules, now);
  ruleErrors = ruleSet.errors;
  expiredRules = ruleSet.expired;
  nextExpiry = ruleSet.nextExpiry;
  if (ruleSet.expired.length > 0) {
    ctx.diagnostics.info("Filter rules have expired", {
      count: ruleSet.expired.length,
      titles: ruleSet.expired.map((rule) => rule.title ?? rule.source).slice(0, 5)
    });
  }
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
    quotePosts: ctx.settings.filter.quotePosts,
    engagement: {
      action: ctx.settings.filter.engagementRule,
      metric: ctx.settings.filter.engagementMetric,
      min: ctx.settings.filter.engagementMin
    },
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
    filter.quotePosts,
    filter.engagementRule,
    filter.engagementMetric,
    filter.engagementMin,
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
  if (decision !== "show") {
    article.setAttribute(RESULT_ATTR, decision);
  } else if (isExempt(signal, filters)) {
    // An allowlisted author is not "undecided" — the structural rules must not reach it.
    article.setAttribute(RESULT_ATTR, ALLOW_RESULT);
  } else {
    article.removeAttribute(RESULT_ATTR);
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
  // The stylesheet matches [CELL_RESULT_ATTR="1"], so this has to be a value, not a bare presence
  // flag. `toggleAttribute` writes the empty string, which never matched -- the article hid and its
  // virtualizer row stayed at full height, leaving exactly the gap hidden-posts exists to close.
  if (hasHiddenArticle) {
    cell.setAttribute(CELL_RESULT_ATTR, "1");
  } else {
    cell.removeAttribute(CELL_RESULT_ATTR);
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

function syncFilterStyle(): void {
  const wanted = filterCss(compiled);
  const existing = document.getElementById(STYLE_ID);
  if (existing && wanted === styleText) {
    return;
  }
  styleText = wanted;
  const style = existing ?? document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = wanted;
  if (!existing) {
    (document.head ?? document.documentElement).append(style);
  }
}

const HIDDEN = "display: none !important;";
const DIMMED = "opacity: 0.36; filter: grayscale(0.5); transition: opacity 120ms ease, filter 120ms ease;";
const REVEALED = "opacity: 1; filter: none;";
const ROOT = "html.av-filter-enabled";
/**
 * A post the JS half looked at and did not decide. Every structural rule hangs off this, which is
 * what gives the two halves their precedence: a rule that hides or dims wins, an allowlisted
 * author wins, and only a post nothing textual matched is left for the stylesheet.
 */
const UNDECIDED = `${ARTICLE_SELECTOR}[${PROCESSED_ATTR}]:not([${RESULT_ATTR}])`;

function filterCss(filters: CompiledFilters | undefined): string {
  const blocks = [
    `${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"] { ${HIDDEN} }`,
    `${ROOT} [${CELL_RESULT_ATTR}="1"] { ${HIDDEN} }`,
    `${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"] { ${DIMMED} }`,
    `${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"]:hover,\n${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"]:focus-within { ${REVEALED} }`
  ];
  if (filters) {
    blocks.push(...structuralCss(filters));
  }
  return `${blocks.join("\n\n")}\n`;
}

/**
 * The structural half, emitted from the one table in predicates.ts. `:has()` is Baseline widely
 * available and sits far below both manifest floors (Chrome 105 / Firefox 121 against 116 / 128).
 */
function structuralCss(filters: CompiledFilters): string[] {
  const plan = structuralFilterPlan(filters);
  const blocks: string[] = [];

  const hidden = structuralSelectorsFor(plan.hide);
  if (hidden.length > 0) {
    blocks.push(`${ROOT} ${UNDECIDED}:has(${hidden.join(", ")}) { ${HIDDEN} }`);
    // The row has to collapse with the post or X's absolutely-positioned virtualizer leaves a
    // full-height gap. `:has()` cannot nest, so the article condition and the media it must
    // contain are flattened into one descendant selector per member.
    blocks.push(
      `${ROOT} ${CELL_SELECTOR}:has(${hidden
        .map((selector) => `${UNDECIDED} ${selector}`)
        .join(", ")}) { ${HIDDEN} }`
    );
  }

  const dimmed = structuralSelectorsFor(plan.dim);
  if (dimmed.length > 0) {
    const target = `${ROOT} ${UNDECIDED}:has(${dimmed.join(", ")})`;
    blocks.push(`${target} { ${DIMMED} }`);
    blocks.push(`${target}:hover,\n${target}:focus-within { ${REVEALED} }`);
  }

  return blocks;
}
