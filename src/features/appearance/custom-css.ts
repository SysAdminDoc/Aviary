import type { FeatureModule } from "../registry.ts";
import {
  CUSTOM_CSS_SCOPE_IDS,
  sanitizeCustomCss,
  type CustomCssRules,
  type CustomCssScopeId
} from "../../platform/settings.ts";

const STYLE_ID = "av-custom-css";
const SCOPE_ATTRIBUTE = "data-av-custom-css-scope";

const ROOT_SELECTORS: Record<CustomCssScopeId, string> = {
  posts: 'article[data-testid="tweet"]',
  media: "[data-av-media-button]",
  navigation: 'nav[role="navigation"], nav[aria-label]',
  sidebar: '[data-testid="sidebarColumn"]',
  composer: '[data-testid="toolBar"], [data-testid^="tweetTextarea_"]'
};

const originalScopeAttributes = new Map<Element, string | null>();
let currentRules: CustomCssRules | null = null;
let scopeObserver: MutationObserver | null = null;
let nativeScopeSupport: boolean | undefined;
let scopeMode: "native" | "fallback" | null = null;

export const customCssFeature: FeatureModule = {
  id: "appearance.customCss",
  title: "Custom CSS",
  category: "appearance",

  init(ctx) {
    applyCustomCss(ctx.settings.appearance.customCss);
  },

  apply(ctx) {
    applyCustomCss(ctx.settings.appearance.customCss);
  },

  destroy() {
    scopeObserver?.disconnect();
    scopeObserver = null;
    currentRules = null;
    scopeMode = null;
    document.getElementById(STYLE_ID)?.remove();
    restoreScopeAttributes();
  },

  getStatus() {
    return {
      ok: true,
      message: scopeMode === "fallback" ? "Custom CSS scopes ready (compatibility mode)" : "Custom CSS scopes ready"
    };
  }
};

export function buildScopedCustomCss(
  rules: Partial<CustomCssRules>,
  useNativeScope = detectNativeScope()
): string {
  const blocks: string[] = [];
  for (const scope of CUSTOM_CSS_SCOPE_IDS) {
    const candidate = rules[scope];
    if (typeof candidate !== "string") continue;
    const css = sanitizeCustomCss(candidate).value.trim();
    if (css.length === 0) continue;
    const selector = `[${SCOPE_ATTRIBUTE}~="${scope}"]`;
    const scoped = useNativeScope ? `@scope (${selector}) {\n${css}\n}` : scopeCssFallback(css, selector);
    if (scoped.length > 0) blocks.push(scoped);
  }
  return blocks.join("\n\n");
}

export function applyCustomCss(rules: CustomCssRules): void {
  if (typeof document === "undefined") return;
  currentRules = { ...rules };
  const useNativeScope = detectNativeScope();
  scopeMode = useNativeScope ? "native" : "fallback";
  const css = buildScopedCustomCss(rules, useNativeScope);
  const existing = document.getElementById(STYLE_ID);
  if (css.length === 0) {
    existing?.remove();
    scopeObserver?.disconnect();
    scopeObserver = null;
  } else {
    const style = existing?.tagName === "STYLE" ? (existing as HTMLStyleElement) : document.createElement("style");
    if (existing && style !== existing) existing.remove();
    style.id = STYLE_ID;
    style.dataset.avOwned = "true";
    style.textContent = css;
    if (!style.isConnected) {
      (document.head ?? document.documentElement).append(style);
    }
    ensureScopeObserver();
  }
  syncScopeAttributes(rules);
}

function ensureScopeObserver(): void {
  if (scopeObserver || typeof MutationObserver === "undefined") return;
  const root = document.body ?? document.documentElement;
  if (!root) return;
  scopeObserver = new MutationObserver(() => {
    if (currentRules) syncScopeAttributes(currentRules);
  });
  scopeObserver.observe(root, { childList: true, subtree: true });
}

function detectNativeScope(): boolean {
  if (nativeScopeSupport !== undefined) return nativeScopeSupport;
  if (typeof document === "undefined") return false;
  const style = document.createElement("style");
  style.textContent = `@scope ([${SCOPE_ATTRIBUTE}]) {}`;
  const parent = document.head ?? document.documentElement;
  if (!parent) return false;
  parent.append(style);
  try {
    nativeScopeSupport = Array.from(style.sheet?.cssRules ?? []).some((rule) =>
      rule.cssText.trimStart().startsWith("@scope")
    );
  } catch {
    nativeScopeSupport = false;
  }
  style.remove();
  return nativeScopeSupport;
}

/**
 * Rewrites the small, declaration-oriented CSS language accepted by the editor for browsers below
 * the @scope floor. Nested media, supports, container, and layer blocks stay nested; every ordinary
 * selector is prefixed with the owning scope attribute and can still match the scope root itself.
 */
function scopeCssFallback(css: string, scopeSelector: string): string {
  const output: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = findNextBrace(css, cursor);
    if (open === -1) {
      if (css.slice(cursor).trim().length > 0) return "";
      break;
    }
    const prelude = css.slice(cursor, open).trim();
    const close = findMatchingBrace(css, open);
    if (!prelude || close === -1) return "";
    const body = css.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      const atRule = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      if (!atRule || !["media", "supports", "container", "layer"].includes(atRule)) return "";
      const nested = scopeCssFallback(body, scopeSelector);
      if (body.trim().length > 0 && nested.length === 0) return "";
      output.push(`${prelude} {\n${nested}\n}`);
    } else {
      const selectors = splitSelectorList(prelude).map((selector) =>
        prefixSelector(selector, scopeSelector)
      );
      if (selectors.some((selector) => selector.length === 0)) return "";
      output.push(`${selectors.join(", ")} {\n${body}\n}`);
    }
    cursor = close + 1;
  }
  return output.join("\n");
}

function findNextBrace(source: string, start: number): number {
  let quote: '"' | "'" | null = null;
  let comment = false;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (let index = start; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
    if (comment) {
      if (current === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      // A newline inside a CSS string is a parse error: the tokenizer emits a bad-string token and
      // ends the string there. Tracking on past it is what let a real block-closing brace hide
      // inside what this scan believed was still a string. End the string and reprocess the
      // character the way the tokenizer would.
      if (current !== "\n" && current !== "\r") {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) quote = null;
        continue;
      }
      quote = null;
      escaped = false;
    }
    if (current === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (current === '"' || current === "'") quote = current;
    else if (current === "[") brackets += 1;
    else if (current === "]") brackets = Math.max(0, brackets - 1);
    else if (current === "(") parentheses += 1;
    else if (current === ")") parentheses = Math.max(0, parentheses - 1);
    else if (current === "{" && brackets === 0 && parentheses === 0) return index;
  }
  return -1;
}

function findMatchingBrace(source: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let comment = false;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const current = source[index]!;
    const next = source[index + 1];
    if (comment) {
      if (current === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      // A newline inside a CSS string is a parse error: the tokenizer emits a bad-string token and
      // ends the string there. Tracking on past it is what let a real block-closing brace hide
      // inside what this scan believed was still a string. End the string and reprocess the
      // character the way the tokenizer would.
      if (current !== "\n" && current !== "\r") {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) quote = null;
        continue;
      }
      quote = null;
      escaped = false;
    }
    if (current === "/" && next === "*") {
      comment = true;
      index += 1;
    } else if (current === '"' || current === "'") quote = current;
    else if (current === "{") depth += 1;
    else if (current === "}" && --depth === 0) return index;
  }
  return -1;
}

function splitSelectorList(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!;
    if (quote) {
      // A newline inside a CSS string is a parse error: the tokenizer emits a bad-string token and
      // ends the string there. Tracking on past it is what let a real block-closing brace hide
      // inside what this scan believed was still a string. End the string and reprocess the
      // character the way the tokenizer would.
      if (current !== "\n" && current !== "\r") {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) quote = null;
        continue;
      }
      quote = null;
      escaped = false;
    }
    if (current === '"' || current === "'") quote = current;
    else if (current === "[") brackets += 1;
    else if (current === "]") brackets = Math.max(0, brackets - 1);
    else if (current === "(") parentheses += 1;
    else if (current === ")") parentheses = Math.max(0, parentheses - 1);
    else if (current === "," && brackets === 0 && parentheses === 0) {
      selectors.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(value.slice(start).trim());
  return selectors.filter(Boolean);
}

function prefixSelector(selector: string, scopeSelector: string): string {
  const trimmed = selector.trim();
  if (trimmed.startsWith(":scope")) return `${scopeSelector}${trimmed.slice(6)}`;
  if (trimmed === ":root" || trimmed.startsWith(":root ")) {
    return `${scopeSelector}${trimmed.slice(5)}`;
  }
  if (/^[>+~]/.test(trimmed)) return `${scopeSelector} ${trimmed}`;
  const firstEnd = firstCombinatorIndex(trimmed);
  const first = trimmed.slice(0, firstEnd).trim();
  const rest = trimmed.slice(firstEnd).trim();
  if (!first) return `${scopeSelector} ${trimmed}`;
  const rootCompound = first === "*" ? scopeSelector : `${first}${scopeSelector}`;
  const scoped = `:is(${rootCompound}, ${scopeSelector} ${first})`;
  return rest ? `${scoped} ${rest}` : scoped;
}

function firstCombinatorIndex(value: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let brackets = 0;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]!;
    if (quote) {
      // A newline inside a CSS string is a parse error: the tokenizer emits a bad-string token and
      // ends the string there. Tracking on past it is what let a real block-closing brace hide
      // inside what this scan believed was still a string. End the string and reprocess the
      // character the way the tokenizer would.
      if (current !== "\n" && current !== "\r") {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) quote = null;
        continue;
      }
      quote = null;
      escaped = false;
    }
    if (current === '"' || current === "'") quote = current;
    else if (current === "[") brackets += 1;
    else if (current === "]") brackets = Math.max(0, brackets - 1);
    else if (current === "(") parentheses += 1;
    else if (current === ")") parentheses = Math.max(0, parentheses - 1);
    else if (brackets === 0 && parentheses === 0 && (current === ">" || current === "+" || current === "~" || /\s/.test(current))) {
      return index;
    }
  }
  return value.length;
}

function syncScopeAttributes(rules: CustomCssRules): void {
  const active = new Map<Element, Set<CustomCssScopeId>>();
  for (const scope of CUSTOM_CSS_SCOPE_IDS) {
    if (sanitizeCustomCss(rules[scope]).value.trim().length === 0) continue;
    for (const element of document.querySelectorAll(ROOT_SELECTORS[scope])) {
      const scopes = active.get(element) ?? new Set<CustomCssScopeId>();
      scopes.add(scope);
      active.set(element, scopes);
    }
  }

  for (const [element, scopes] of active) {
    if (!originalScopeAttributes.has(element)) {
      originalScopeAttributes.set(element, element.getAttribute(SCOPE_ATTRIBUTE));
    }
    element.setAttribute(SCOPE_ATTRIBUTE, [...scopes].sort().join(" "));
  }

  for (const [element, original] of originalScopeAttributes) {
    if (active.has(element)) continue;
    if (original === null) {
      element.removeAttribute(SCOPE_ATTRIBUTE);
    } else {
      element.setAttribute(SCOPE_ATTRIBUTE, original);
    }
    originalScopeAttributes.delete(element);
  }
}

function restoreScopeAttributes(): void {
  for (const [element, original] of originalScopeAttributes) {
    if (original === null) {
      element.removeAttribute(SCOPE_ATTRIBUTE);
    } else {
      element.setAttribute(SCOPE_ATTRIBUTE, original);
    }
  }
  originalScopeAttributes.clear();
}
