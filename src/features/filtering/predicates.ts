import { checkRegexBudget } from "./regex-budget";
import type { FilterAction, FilterMediaKey } from "../../platform/settings";
import { handleFromHref } from "./hidden-posts";
import { evaluateRules, type CompiledRule, type RuleSignal } from "./rules";

export interface CompiledFilters {
  /** Parsed field/operator/value rules; see ./rules.ts. */
  rules: CompiledRule[];
  keywords: string[];
  patterns: RegExp[];
  whitelist: Set<string>;
  premium: FilterAction;
  media: Record<FilterMediaKey, boolean>;
  generation: number;
}

export type FilterDecision = "show" | "hide" | "dim";

/**
 * Which side of the engine a predicate belongs on.
 *
 * A predicate is **structural** when it is one question about the shape of the article's own
 * subtree — "does it contain a photo?", "does it carry the verified badge?" — answerable by a
 * selector, with nothing read, compared, lowercased, or combined. Those are exactly the questions
 * `:has()` answers, so they are emitted as CSS by the engine and never run per article per batch.
 * They also self-correct: media that renders after the article was stamped is caught by the
 * stylesheet, where the JS pass had already marked the article done and would never look again.
 *
 * A predicate stays **in JS** when it needs a value the selector engine cannot produce: the post's
 * text, the author's handle after normalization, or a user-written rule combining several fields.
 * The whitelist stays in JS for a second reason — it is the only predicate that *overrides* a
 * structural hide, which a `:has()` rule cannot express against a handle it would have to read out
 * of an href. It is published to CSS as the `allow` decision instead, and every structural rule is
 * guarded on the article carrying no decision at all.
 *
 * The test for a future predicate: if you can write it as one selector against the article's
 * subtree, add it to `STRUCTURAL_SELECTORS` and it is both read and emitted from that one table.
 * Otherwise it belongs in `decide`.
 */
export type StructuralKey = FilterMediaKey | "premium";

export const STRUCTURAL_SELECTORS: Record<StructuralKey, readonly string[]> = {
  photo: ['[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]'],
  video: ['[data-testid="videoPlayer"]', '[data-testid="videoComponent"]'],
  gif: [
    '[data-testid="videoComponent"][aria-label*="GIF" i]',
    '[aria-label="Embedded video"][data-testid*="gif" i]'
  ],
  premium: ['[data-testid="icon-verified"]', '[aria-label*="Verified" i]']
};

/**
 * The structural predicates the current settings turn on, split by the action they take. The
 * engine renders this to CSS; nothing else decides what a structural filter does.
 */
export function structuralFilterPlan(filters: CompiledFilters): {
  hide: StructuralKey[];
  dim: StructuralKey[];
} {
  const hide: StructuralKey[] = [];
  if (filters.media.photo) {
    hide.push("photo");
  }
  if (filters.media.video) {
    // A GIF is a video player to X and to the media signal, so hiding video hides GIFs.
    hide.push("video", "gif");
  } else if (filters.media.gif) {
    hide.push("gif");
  }
  const dim: StructuralKey[] = [];
  if (filters.premium === "hide") {
    hide.push("premium");
  } else if (filters.premium === "dim") {
    dim.push("premium");
  }
  return { hide, dim };
}

/** Every selector for a set of structural keys, deduplicated, in table order. */
export function structuralSelectorsFor(keys: readonly StructuralKey[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) {
    for (const selector of STRUCTURAL_SELECTORS[key]) {
      seen.add(selector);
    }
  }
  return [...seen];
}

function hasStructural(article: Element, key: StructuralKey): boolean {
  return article.querySelector(STRUCTURAL_SELECTORS[key].join(", ")) !== null;
}

export interface FilterInput {
  text: string;
  handle: string | null;
  premium: boolean;
  media: Record<FilterMediaKey, boolean>;
  /** Whether the post text carries an outbound link. Absent on older callers. */
  hasLink?: boolean;
}

export interface TweetSignal {
  text: string;
  handle: string | null;
  premium: boolean;
  media: Record<FilterMediaKey, boolean>;
  hasLink: boolean;
}

export function compileFilters(input: {
  rules?: CompiledRule[];
  keywords: string[];
  regex: string[];
  whitelist: string[];
  premium: FilterAction;
  media: Record<string, boolean>;
  generation: number;
}): CompiledFilters {
  const keywords = input.keywords
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const patterns: RegExp[] = [];
  for (const source of input.regex) {
    const compiled = tryCompileRegex(source);
    if (compiled) {
      patterns.push(compiled);
    }
  }

  const whitelist = new Set<string>();
  for (const handle of input.whitelist) {
    const normalized = normalizeHandle(handle);
    if (normalized) {
      whitelist.add(normalized);
    }
  }

  return {
    rules: input.rules ?? [],
    keywords,
    patterns,
    whitelist,
    premium: input.premium,
    media: {
      photo: Boolean(input.media.photo),
      video: Boolean(input.media.video),
      gif: Boolean(input.media.gif)
    },
    generation: input.generation
  };
}

/** Whether the author is allowlisted, which outranks every other predicate on either side. */
export function isExempt(signal: FilterInput, filters: CompiledFilters): boolean {
  return signal.handle !== null && signal.handle !== "" && filters.whitelist.has(signal.handle);
}

/**
 * The JS half of the decision: allowlist, user rules, keywords, regexes. The media and verified
 * predicates are structural and live in the stylesheet the engine emits — see
 * `structuralFilterPlan`. A "show" here means "nothing textual matched", which is what lets the
 * structural rules take it from there.
 */
export function decide(signal: FilterInput, filters: CompiledFilters): FilterDecision {
  if (isExempt(signal, filters)) {
    return "show";
  }

  if (filters.rules.length > 0) {
    const ruled = evaluateRules(asRuleSignal(signal), filters.rules);
    if (ruled !== "show") {
      return ruled;
    }
  }

  if (filters.keywords.length > 0) {
    const text = signal.text.toLowerCase();
    for (const keyword of filters.keywords) {
      if (text.includes(keyword)) {
        return "hide";
      }
    }
  }

  for (const pattern of filters.patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(signal.text)) {
      return "hide";
    }
  }

  return "show";
}

/**
 * Widens a signal to the rule shape without spreading it: the extracted signal computes its
 * structural fields lazily, and a spread would read every one of them to build the copy.
 */
function asRuleSignal(signal: FilterInput): RuleSignal {
  return {
    get text() {
      return signal.text;
    },
    get handle() {
      return signal.handle;
    },
    get premium() {
      return signal.premium;
    },
    get media() {
      return signal.media;
    },
    get hasLink() {
      return signal.hasLink === true;
    }
  };
}

/**
 * Every field is read on first access and remembered, because most of them are never asked for.
 * A post the allowlist exempts costs one handle read; a configuration with no rule naming `media`
 * or `verified` never runs those queries at all. The engine's own media and verified predicates
 * are answered by the stylesheet now, so this is the only thing that would still have paid for
 * them per article per batch.
 */
export function extractTweetSignal(article: Element): TweetSignal {
  let text: string | undefined;
  let handle: string | null | undefined;
  let premium: boolean | undefined;
  let media: Record<FilterMediaKey, boolean> | undefined;
  let hasLink: boolean | undefined;

  return {
    get text() {
      return (text ??= readText(article));
    },
    get handle() {
      if (handle === undefined) {
        handle = readHandle(article);
      }
      return handle;
    },
    get premium() {
      return (premium ??= hasStructural(article, "premium"));
    },
    get media() {
      return (media ??= readMedia(article));
    },
    get hasLink() {
      return (hasLink ??= readHasLink(article));
    }
  };
}

function readText(article: Element): string {
  const textNodes = article.querySelectorAll('[data-testid="tweetText"]');
  return textNodes.length > 0
    ? Array.from(textNodes)
        .map((node) => node.textContent ?? "")
        .join("\n")
    : article.textContent ?? "";
}

function readMedia(article: Element): Record<FilterMediaKey, boolean> {
  const media: Record<FilterMediaKey, boolean> = {
    photo: hasStructural(article, "photo"),
    video: hasStructural(article, "video"),
    gif: hasStructural(article, "gif")
  };
  if (media.gif) {
    media.video = true;
  }
  return media;
}

function readHasLink(article: Element): boolean {
  // Only links inside the post's own text; the action bar and quoted chrome are not the author's.
  const textNode = article.querySelector('[data-testid="tweetText"]');
  return (
    (textNode ?? article).querySelector('a[href^="http"], a[href^="/t.co/"], a[href*="t.co/"]') !==
    null
  );
}

function readHandle(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  // Every profile link, not just relative ones: the saved captures rewrite hrefs to absolute
  // URLs, so a relative-only selector reads every author as unknown when tested against them.
  // handleFromHref strips the origin first and is the same reader the hide feature uses.
  const links = userName?.querySelectorAll("a[href]") ?? [];
  for (const link of Array.from(links)) {
    const candidate = handleFromHref(link.getAttribute("href"));
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function normalizeHandle(value: string): string | null {
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

function tryCompileRegex(source: string): RegExp | null {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const match = /^\/(.+)\/([a-z]*)$/i.exec(trimmed);
    const body = match?.[1];
    const flags = match?.[2] ?? "";
    // Bounded before compiling: these run against every article in every batch, and JavaScript
    // offers no way to abort a match once it is away.
    if (checkRegexBudget(body ?? trimmed).reason !== null) {
      return null;
    }
    if (match && body) {
      return new RegExp(body, sanitizeFlags(flags));
    }
    return new RegExp(trimmed, "i");
  } catch {
    return null;
  }
}

function sanitizeFlags(input: string): string {
  const allowed = new Set(["i", "m", "s", "u"]);
  const flags: string[] = [];
  for (const flag of input.toLowerCase()) {
    if (allowed.has(flag) && !flags.includes(flag)) {
      flags.push(flag);
    }
  }
  if (!flags.includes("i")) {
    flags.push("i");
  }
  return flags.join("");
}
