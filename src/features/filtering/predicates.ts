import type { FilterAction, FilterMediaKey } from "../../platform/settings";

export interface CompiledFilters {
  keywords: string[];
  patterns: RegExp[];
  whitelist: Set<string>;
  premium: FilterAction;
  media: Record<FilterMediaKey, boolean>;
  generation: number;
}

export type FilterDecision = "show" | "hide" | "dim";

export interface FilterInput {
  text: string;
  handle: string | null;
  premium: boolean;
  media: Record<FilterMediaKey, boolean>;
}

export interface TweetSignal {
  text: string;
  handle: string | null;
  premium: boolean;
  media: Record<FilterMediaKey, boolean>;
}

export function compileFilters(input: {
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

export function decide(signal: FilterInput, filters: CompiledFilters): FilterDecision {
  if (signal.handle && filters.whitelist.has(signal.handle)) {
    return "show";
  }

  const text = signal.text.toLowerCase();
  for (const keyword of filters.keywords) {
    if (text.includes(keyword)) {
      return "hide";
    }
  }

  for (const pattern of filters.patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(signal.text)) {
      return "hide";
    }
  }

  for (const key of ["photo", "video", "gif"] as FilterMediaKey[]) {
    if (filters.media[key] && signal.media[key]) {
      return "hide";
    }
  }

  if (filters.premium !== "off" && signal.premium) {
    return filters.premium;
  }

  return "show";
}

export function extractTweetSignal(article: Element): TweetSignal {
  const textNodes = article.querySelectorAll('[data-testid="tweetText"]');
  const text =
    textNodes.length > 0
      ? Array.from(textNodes)
          .map((node) => node.textContent ?? "")
          .join("\n")
      : article.textContent ?? "";

  const handle = readHandle(article);
  const premium =
    article.querySelector('[data-testid="icon-verified"], [aria-label*="Verified" i]') !== null;

  const media: Record<FilterMediaKey, boolean> = {
    photo: article.querySelector('[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]') !== null,
    video: article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"]') !== null,
    gif: article.querySelector('[data-testid="videoComponent"][aria-label*="GIF" i], [aria-label="Embedded video"][data-testid*="gif" i]') !== null
  };

  if (media.gif) {
    media.video = true;
  }

  return { text, handle, premium, media };
}

function readHandle(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  const links = userName?.querySelectorAll('a[href^="/"]') ?? [];
  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") ?? "";
    const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
    const candidate = match?.[1];
    if (candidate) {
      return normalizeHandle(candidate);
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
