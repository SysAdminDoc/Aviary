import type { EngagementMetric, FilterSurface } from "../../platform/settings.ts";
import type { FeatureContext, FeatureModule } from "../registry.ts";
import {
  compileFilters,
  extractTweetSignal,
  isExempt,
  judge,
  structuralFilterPlan,
  structuralSelectorsFor,
  type CompiledFilters,
  type FilterCause,
  type FilterDecision,
  type StructuralKey
} from "./predicates.ts";
import { ft } from "../core/feature-i18n.ts";
import { compileRules, type CompiledRule, type RuleParseError } from "./rules.ts";

const STYLE_ID = "av-filter-engine";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const PROCESSED_ATTR = "data-av-filter-processed";
const RESULT_ATTR = "data-av-filter-result";
const CELL_RESULT_ATTR = "data-av-filter-cell-hidden";
/** Written on a post the allowlist exempts, so the structural rules can step over it. */
const ALLOW_RESULT = "allow";
/** Carries the sentence a suppressed post shows about itself. Read straight into CSS content. */
const REASON_ATTR = "data-av-filter-reason";
/** Set while reasons are being shown at all, so the stylesheet can stay quiet when they are not. */
const EXPLAIN_CLASS = "av-filter-explain";
/** Set while hidden posts are collapsed to a strip rather than removed. */
const EXPLAIN_ALL_CLASS = "av-filter-explain-all";

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
    syncFilterStyle(ctx);
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
    syncFilterStyle(ctx);

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
  const active = ctx.settings.filter.enabled && surfaceMatches(ctx);
  const mode = ctx.settings.filter.showReason;
  document.documentElement.classList.toggle("av-filter-enabled", active);
  document.documentElement.classList.toggle(EXPLAIN_CLASS, active && mode !== "off");
  document.documentElement.classList.toggle(EXPLAIN_ALL_CLASS, active && mode === "all");
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

  // A regex the budget refused, or one that will not compile, is not a filter -- and until now it
  // was also not reported. The panel counted the raw lines and said "Saved N regex rules", so a
  // rule that never runs looked exactly like one that does. These join the rule-DSL errors because
  // the panel already renders that list, and the reason is the one the budget wrote.
  if (compiled.refusedPatterns.length > 0) {
    const lineOf = new Map(
      ctx.settings.filter.regexRules.map((source, index) => [source.trim(), index + 1])
    );
    ruleErrors = [
      ...ruleErrors,
      ...compiled.refusedPatterns.map((refused) => ({
        source: refused.source,
        line: lineOf.get(refused.source) ?? 0,
        message: refused.reason
      }))
    ];
    ctx.diagnostics.warn("Regex filter rules were refused", {
      count: compiled.refusedPatterns.length,
      first: compiled.refusedPatterns[0]?.source ?? ""
    });
  }
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
    // Not an input to any predicate, but the reason attribute is written per article and the
    // generation stamp is what allows it to be rewritten when the setting changes.
    filter.showReason,
    filter.enabled
  ]);
}

function scanRoot(root: ParentNode | Element, ctx: FeatureContext): void {
  if (!compiled || !ctx.settings.filter.enabled || !surfaceMatches(ctx)) {
    return;
  }

  // Built once per scan rather than per post, and not at all when nothing is being explained.
  const describe =
    ctx.settings.filter.showReason === "off"
      ? null
      : (cause: FilterCause, action: FilterDecision) => describeCause(ctx, cause, action);

  const articles = collectArticles(root);
  for (const article of articles) {
    processArticle(article, compiled, describe);
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

function processArticle(
  article: Element,
  filters: CompiledFilters,
  describe: ((cause: FilterCause, action: FilterDecision) => string) | null
): void {
  if (article.getAttribute(PROCESSED_ATTR) === String(filters.generation)) {
    return;
  }

  const signal = extractTweetSignal(article);
  // One evaluation, and the reason comes out of it. Working the reason out afterwards would be a
  // second implementation of the filter, and the two would eventually disagree.
  const verdict = judge(signal, filters);
  article.setAttribute(PROCESSED_ATTR, String(filters.generation));
  if (verdict.action !== "show") {
    article.setAttribute(RESULT_ATTR, verdict.action);
  } else if (isExempt(signal, filters)) {
    // An allowlisted author is not "undecided" — the structural rules must not reach it.
    article.setAttribute(RESULT_ATTR, ALLOW_RESULT);
  } else {
    article.removeAttribute(RESULT_ATTR);
  }

  if (describe && verdict.cause) {
    article.setAttribute(REASON_ATTR, describe(verdict.cause, verdict.action));
  } else {
    article.removeAttribute(REASON_ATTR);
  }
  syncCollapsedCell(article);
}

/**
 * The sentence a suppressed post shows. Localized, and short enough to sit on one line.
 *
 * The verb has to match what actually happened. A dimmed post is still on screen, and the default
 * `showReason` value is "dimmed" -- so out of the box the only posts carrying a reason were the
 * ones the sentence described wrongly, telling the reader a post they can plainly see was hidden.
 */
function describeCause(ctx: FeatureContext, cause: FilterCause, action: FilterDecision): string {
  const dimmed = action === "dim";
  switch (cause.kind) {
    case "rule":
      return `${ft(ctx, dimmed ? "Dimmed by your rule" : "Hidden by your rule")}: ${cause.label}`;
    case "keyword":
      return `${ft(ctx, dimmed ? "Dimmed by your keyword" : "Hidden by your keyword")}: ${cause.label}`;
    case "regex":
      return `${ft(ctx, dimmed ? "Dimmed by your pattern" : "Hidden by your pattern")}: ${cause.label}`;
    case "engagement":
      return `${ft(ctx, "Under your engagement floor")}: ${cause.min} ${metricCopy(
        ctx,
        cause.metric
      )}`;
  }
}

// Every one of these is written out as a literal `ft()` call rather than looked up in a table,
// because `tools/i18n-extract.mjs` harvests copy by matching literal arguments. Copy reached
// through a computed index is invisible to it and ships in English in all eight locales.
function metricCopy(ctx: FeatureContext, metric: EngagementMetric): string {
  switch (metric) {
    case "replies":
      return ft(ctx, "Replies");
    case "reposts":
      return ft(ctx, "Reposts");
    case "likes":
      return ft(ctx, "Likes");
  }
}

/** The sentence a structurally suppressed post shows, emitted into the stylesheet. */
function structuralCopy(ctx: FeatureContext, key: StructuralKey): string {
  switch (key) {
    case "photo":
      return ft(ctx, "Hidden: this post has a photo");
    case "video":
      return ft(ctx, "Hidden: this post has a video");
    case "gif":
      return ft(ctx, "Hidden: this post has a GIF");
    case "premium":
      return ft(ctx, "Hidden: this post is from a verified account");
    case "quote":
      return ft(ctx, "Hidden: this post quotes another");
  }
}

function clearDecorations(): void {
  document.documentElement.classList.remove(
    "av-filter-enabled",
    EXPLAIN_CLASS,
    EXPLAIN_ALL_CLASS
  );
  for (const node of Array.from(
    document.querySelectorAll(
      `[${PROCESSED_ATTR}], [${RESULT_ATTR}], [${CELL_RESULT_ATTR}], [${REASON_ATTR}]`
    )
  )) {
    node.removeAttribute(PROCESSED_ATTR);
    node.removeAttribute(RESULT_ATTR);
    node.removeAttribute(CELL_RESULT_ATTR);
    node.removeAttribute(REASON_ATTR);
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

function syncFilterStyle(ctx: FeatureContext): void {
  const wanted = filterCss(compiled, ctx);
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

function filterCss(filters: CompiledFilters | undefined, ctx?: FeatureContext): string {
  const blocks = [
    `${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"] { ${HIDDEN} }`,
    `${ROOT} [${CELL_RESULT_ATTR}="1"] { ${HIDDEN} }`,
    `${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"] { ${DIMMED} }`,
    `${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"]:hover,\n${ROOT} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"]:focus-within { ${REVEALED} }`,
    REASON_CSS
  ];
  if (filters) {
    blocks.push(...structuralCss(filters, ctx));
  }
  return `${blocks.join("\n\n")}\n`;
}

/**
 * The reason a post carries, drawn from the attribute the engine wrote. `attr()` in `content` is
 * the one place CSS may read a string out of the DOM, which is what keeps this to no elements
 * created, none removed, and nothing stored per post.
 *
 * A dimmed post is still readable, so its reason is a line above it and costs no interaction. A
 * hidden post has nothing to hover, so under "all" the article itself becomes the strip: its
 * children are folded away and the reason takes their place, until the reader hovers or tabs into
 * it and the post comes back.
 */
const REASON_CHIP =
  "display: block; font-size: 12px; line-height: 1.6; opacity: 0.72; padding: 2px 0;";
/**
 * A suppressed post is clipped to the height of its own reason rather than having its children
 * removed. `display: none` on the children would take them out of the tab order, and then
 * `:focus-within` -- the only way to open the strip without a pointer -- could never fire. Clipping
 * leaves every child focusable, so tabbing into one opens the post and the browser scrolls to it.
 */
const COLLAPSED = "display: block !important; max-height: 2.1em; overflow: hidden;";
const EXPANDED = "max-height: none; overflow: visible;";
const REASON_CSS = `
html.${EXPLAIN_CLASS} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"][${REASON_ATTR}]::before {
  content: attr(${REASON_ATTR});
  ${REASON_CHIP}
}

html.${EXPLAIN_ALL_CLASS} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"][${REASON_ATTR}] {
  ${COLLAPSED}
}

html.${EXPLAIN_ALL_CLASS} [${CELL_RESULT_ATTR}="1"]:has(${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"][${REASON_ATTR}]) {
  display: revert !important;
}

html.${EXPLAIN_ALL_CLASS} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"][${REASON_ATTR}]::before {
  content: attr(${REASON_ATTR});
  ${REASON_CHIP}
}

html.${EXPLAIN_ALL_CLASS} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"][${REASON_ATTR}]:hover,
html.${EXPLAIN_ALL_CLASS} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="hide"][${REASON_ATTR}]:focus-within {
  ${EXPANDED}
}`.trim();

/**
 * The structural half, emitted from the one table in predicates.ts. `:has()` is Baseline widely
 * available and sits far below both manifest floors (Chrome 105 / Firefox 121 against 116 / 128).
 */
/**
 * A `content:` string literal. The text comes from the translation catalog, so a quote, a
 * backslash or a line break in any of eight locales must not be able to end the declaration and
 * start writing CSS of its own.
 */
function cssString(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
  return `"${escaped}"`;
}

function structuralCss(filters: CompiledFilters, ctx?: FeatureContext): string[] {
  const plan = structuralFilterPlan(filters);
  const blocks: string[] = [];

  // A structural suppression has no JS decision to hang an attribute off, so its sentence is
  // written into the stylesheet instead -- once per predicate, not once per post.
  if (ctx && ctx.settings.filter.showReason !== "off") {
    const explainAll = ctx.settings.filter.showReason === "all";
    for (const key of [...plan.dim, ...(explainAll ? plan.hide : [])]) {
      const target = `${ROOT} ${UNDECIDED}:has(${structuralSelectorsFor([key]).join(", ")})`;
      if (plan.hide.includes(key)) {
        blocks.push(`${target} { ${COLLAPSED} }`);
        blocks.push(`${target}:hover,\n${target}:focus-within { ${EXPANDED} }`);
        // The row was collapsed with the post; it has to come back to hold the strip.
        blocks.push(
          `${ROOT} ${CELL_SELECTOR}:has(${structuralSelectorsFor([key])
            .map((selector) => `${UNDECIDED} ${selector}`)
            .join(", ")}) { display: revert !important; }`
        );
      }
      blocks.push(
        `${target}::before { content: ${cssString(structuralCopy(ctx, key))}; ${REASON_CHIP} }`
      );
    }
  }

  const hidden = structuralSelectorsFor(plan.hide);
  if (hidden.length > 0 && ctx?.settings.filter.showReason === "all") {
    // Under "all" the hide rules below are replaced by the collapse above; emitting both would
    // remove the strip the reader is meant to be able to open.
    return blocks;
  }
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
