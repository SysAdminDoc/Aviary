import type { FeatureModule } from "../registry";

const STYLE_ID = "av-link-unshorten";
const PROCESSED_ATTR = "data-av-link-clean";
const ORIGINAL_TITLE_PRESENT = "avOriginalTitlePresent";
const MAX_KNOWLEDGE_NODES = 100_000;
const MAX_KNOWN_LINKS = 10_000;

export interface KnownShortLink {
  shortUrl: string;
  destination: string;
}

export type LinkKnowledgeSource = "archive" | "local-corpus";

export interface ResolvedShortLink extends KnownShortLink {
  source: LinkKnowledgeSource;
}

export const linkUnshortenFeature: FeatureModule = {
  id: "library.linkUnshorten",
  title: "Direct link unshortening",
  category: "core",

  init(ctx) {
    if (!ctx.settings.links.expandTco) {
      return;
    }
    ensureStyle();
    scan(document);
    ctx.diagnostics.info("Link unshortening initialized");
  },

  apply(ctx, root, addedNodes) {
    if (!ctx.settings.links.expandTco) {
      restoreProcessedLinks();
      document.getElementById(STYLE_ID)?.remove();
      return;
    }
    ensureStyle();
    if (!addedNodes || addedNodes.length === 0) {
      scan(root);
      return;
    }
    for (const node of addedNodes) {
      scan(node);
    }
  },

  destroy(ctx) {
    // restoreProcessedLinks removes the av-link-clean class and restores every captured value.
    restoreProcessedLinks();
    document.getElementById(STYLE_ID)?.remove();
    ctx.diagnostics.info("Link unshortening destroyed");
  }
};

/** Reads only URL pairs already present in a local archive or captured response body. */
export function collectKnownShortLinks(root: unknown): KnownShortLink[] {
  const found = new Map<string, KnownShortLink>();
  const pending: unknown[] = [root];
  const visited = new Set<object>();
  let inspected = 0;

  while (pending.length > 0 && inspected < MAX_KNOWLEDGE_NODES && found.size < MAX_KNOWN_LINKS) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    inspected += 1;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    const record = value as Record<string, unknown>;
    const shortUrl = firstString(record, "url", "tco_url", "tcoUrl", "short_url", "shortUrl");
    const destination = firstString(
      record,
      "expanded_url",
      "expandedUrl",
      "unwound_url",
      "unwoundUrl",
      "destination"
    );
    const key = shortUrl ? tcoLinkKey(shortUrl) : null;
    if (shortUrl && key && destination && isExpandedHttpUrl(destination)) {
      found.set(key, { shortUrl, destination });
    }
    pending.push(...Object.values(record));
  }

  return [...found.values()];
}

/** Replaces only t.co links for which the caller can provide a captured destination. */
export function replaceKnownTcoLinks(
  text: string,
  resolve: (shortUrl: string) => Omit<ResolvedShortLink, "shortUrl"> | null
): { text: string; resolved: ResolvedShortLink[] } {
  const resolved: ResolvedShortLink[] = [];
  const expanded = text.replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/gi, (shortUrl) => {
    const match = resolve(shortUrl);
    if (!match || !isExpandedHttpUrl(match.destination)) return shortUrl;
    resolved.push({ shortUrl, ...match });
    return match.destination;
  });
  return { text: expanded, resolved };
}

export function tcoLinkKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "t.co") return null;
    const match = /^\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function restoreProcessedLinks(): void {
  for (const link of Array.from(
    document.querySelectorAll<HTMLAnchorElement>(`a[${PROCESSED_ATTR}]`)
  )) {
    const original = link.dataset.avOriginalText;
    if (original !== undefined) {
      link.textContent = original;
      delete link.dataset.avOriginalText;
    }
    const originalTitle = link.dataset.avOriginalTitle;
    const titleWasPresent = link.dataset[ORIGINAL_TITLE_PRESENT] === "1";
    if (originalTitle !== undefined && titleWasPresent) {
      link.title = originalTitle;
    } else {
      link.removeAttribute("title");
    }
    delete link.dataset.avOriginalTitle;
    delete link.dataset[ORIGINAL_TITLE_PRESENT];
    link.classList.remove("av-link-clean");
    link.removeAttribute(PROCESSED_ATTR);
  }
}

function scan(root: ParentNode | Element): void {
  const anchors: HTMLAnchorElement[] =
    root instanceof HTMLAnchorElement
      ? [root]
      : Array.from(root.querySelectorAll<HTMLAnchorElement>("a"));
  for (const anchor of anchors) {
    if (anchor.getAttribute(PROCESSED_ATTR) === "1") {
      continue;
    }
    const href = anchor.getAttribute("href") ?? "";
    if (!/(^|\.)t\.co\//.test(href) && !/^https?:\/\/t\.co\//.test(href)) {
      continue;
    }
    const target = resolveDestination(anchor);
    if (!target) {
      continue;
    }
    if (anchor.dataset.avOriginalText === undefined) {
      anchor.dataset.avOriginalText = anchor.textContent ?? "";
    }
    if (anchor.dataset.avOriginalTitle === undefined) {
      anchor.dataset.avOriginalTitle = anchor.title;
      anchor.dataset[ORIGINAL_TITLE_PRESENT] = anchor.hasAttribute("title") ? "1" : "0";
    }
    anchor.classList.add("av-link-clean");
    anchor.title = target;
    anchor.setAttribute(PROCESSED_ATTR, "1");
    if (anchor.textContent && /^https?:\/\/t\.co\//i.test(anchor.textContent.trim())) {
      anchor.textContent = target;
    }
  }
}

function resolveDestination(anchor: HTMLAnchorElement): string | null {
  const candidates = [
    anchor.getAttribute("aria-label") ?? "",
    anchor.getAttribute("data-expanded-url") ?? "",
    anchor.title,
    anchor.textContent ?? ""
  ];
  for (const candidate of candidates) {
    const match = /https?:\/\/[^\s]+/i.exec(candidate);
    if (match && !/^https?:\/\/t\.co\//i.test(match[0])) {
      return match[0];
    }
  }
  return null;
}

function firstString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isExpandedHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.toLowerCase() !== "t.co";
  } catch {
    return false;
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LINK_CSS;
  (document.head ?? document.documentElement).append(style);
}

const LINK_CSS = `
a.av-link-clean {
  text-decoration-style: dotted;
  text-decoration-thickness: 1px;
}
`;
