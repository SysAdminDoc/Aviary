import type { FeatureModule } from "../registry";

const PROCESSED_ATTR = "data-av-share-clean";
const ORIGINAL_HREF = "avOriginalHref";

/**
 * Parameters that identify who shared a link and where from, and carry no routing meaning.
 * X appends `t` and `s` to every link its own share sheet produces; the rest are the usual
 * campaign trackers that ride in on posted URLs.
 */
const TRACKING_PARAMS = new Set([
  "t",
  "s",
  "ref_src",
  "ref_url",
  "cxt",
  "twclid",
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "igshid",
  "mc_eid",
  "mc_cid",
  "vero_id",
  "_hsenc",
  "_hsmi"
]);

const X_HOSTS = /(^|\.)((x|twitter)\.com|t\.co)$/i;

export const cleanShareLinksFeature: FeatureModule = {
  id: "library.cleanShareLinks",
  title: "Clean share links",
  category: "core",
  defaultEnabled: true,

  init(ctx) {
    if (!ctx.settings.links.cleanShareButtons) {
      return;
    }
    scan(document);
    ctx.diagnostics.info("Share link cleaning initialized");
  },

  apply(ctx, root, addedNodes) {
    if (!ctx.settings.links.cleanShareButtons) {
      restoreProcessedLinks();
      return;
    }
    if (!addedNodes || addedNodes.length === 0) {
      scan(root);
      return;
    }
    for (const node of addedNodes) {
      scan(node);
    }
  },

  destroy(ctx) {
    restoreProcessedLinks();
    ctx.diagnostics.info("Share link cleaning destroyed");
  }
};

function restoreProcessedLinks(): void {
    for (const anchor of Array.from(
      document.querySelectorAll<HTMLAnchorElement>(`a[${PROCESSED_ATTR}]`)
    )) {
      const original = anchor.dataset[ORIGINAL_HREF];
      if (original !== undefined) {
        anchor.setAttribute("href", original);
        delete anchor.dataset[ORIGINAL_HREF];
      }
      anchor.removeAttribute(PROCESSED_ATTR);
    }
}

function scan(root: ParentNode | Element): void {
  const anchors: HTMLAnchorElement[] =
    root instanceof HTMLAnchorElement
      ? [root]
      : Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"));

  for (const anchor of anchors) {
    if (anchor.getAttribute(PROCESSED_ATTR) === "1") {
      continue;
    }
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }
    const cleaned = cleanUrl(href);
    anchor.setAttribute(PROCESSED_ATTR, "1");
    if (cleaned === null || cleaned === href) {
      continue;
    }
    if (anchor.dataset[ORIGINAL_HREF] === undefined) {
      anchor.dataset[ORIGINAL_HREF] = href;
    }
    anchor.setAttribute("href", cleaned);
  }
}

/**
 * Returns the href with tracking parameters removed, or null when there is nothing to do.
 *
 * Relative hrefs are X's own SPA routes and are rewritten in place; absolute ones are parsed
 * against a base so a malformed URL throws here rather than at `setAttribute`. `t.co` links are
 * left alone -- their whole path is the identifier, so stripping anything breaks the redirect.
 */
export function cleanUrl(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0 || /^(javascript|data|mailto|blob):/i.test(trimmed)) {
    return null;
  }

  let url: URL;
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith("//");
  try {
    url = new URL(trimmed, "https://x.com");
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (/(^|\.)t\.co$/i.test(url.hostname)) {
    return null;
  }

  // Collected first: deleting while iterating the live params list would skip entries.
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => {
    keys.push(key);
  });

  let changed = false;
  for (const key of keys) {
    const lower = key.toLowerCase();
    // Campaign parameters are stripped everywhere; `t`/`s` are ambiguous single letters that
    // only mean "share token" on X's own links, so they are scoped to X hosts.
    const isCampaign = lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
    const scopedToX = lower === "t" || lower === "s";
    if (!isCampaign) {
      continue;
    }
    if (scopedToX && !X_HOSTS.test(url.hostname)) {
      continue;
    }
    url.searchParams.delete(key);
    changed = true;
  }

  if (!changed) {
    return null;
  }

  if (relative) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}
