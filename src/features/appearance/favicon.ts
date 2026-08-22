import type { FeatureContext, FeatureModule } from "../registry.ts";

const MARKER = "data-av-favicon";
const ORIGINAL = "data-av-favicon-original";
const ICON_REL = /(^|\s)(shortcut\s+)?icon(\s|$)/i;

/**
 * Aviary's own mark, authored inline so the swap needs no network request and works identically in
 * the userscript build, which cannot reference packaged extension resources.
 *
 * Only Aviary's mark is offered. A "classic bird" option is deliberately absent: that logo is
 * Twitter/X's trademark, and shipping either it or a deliberate lookalike is not something a
 * declutter setting should do.
 */
const AVIARY_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#8b5cf6"/>
</linearGradient></defs>
<rect width="64" height="64" rx="14" fill="#0b0e12"/>
<path d="M32 12 L46 46 H38.5 L35.6 38.5 H28.4 L25.5 46 H18 Z M32 24.5 L29.9 32.5 H34.1 Z" fill="url(#g)"/>
<circle cx="45" cy="20" r="4" fill="url(#g)"/>
</svg>`;

function markUrl(): string {
  // encodeURIComponent rather than base64: smaller here, and no atob/btoa dependency.
  return `data:image/svg+xml,${encodeURIComponent(AVIARY_MARK.replace(/\n/g, ""))}`;
}

let observer: MutationObserver | undefined;

export const faviconFeature: FeatureModule = {
  id: "appearance.favicon",
  title: "Replace the X favicon",
  category: "appearance",

  init(ctx) {
    applyFavicon(ctx);
  },

  apply(ctx) {
    applyFavicon(ctx);
  },

  destroy(ctx) {
    stop();
    restoreFavicons();
    ctx.diagnostics.info("Favicon restored");
  }
};

function applyFavicon(ctx: FeatureContext): void {
  if (!ctx.settings.appearance.replaceFavicon) {
    stop();
    restoreFavicons();
    return;
  }
  swap();
  if (observer || typeof MutationObserver === "undefined") {
    return;
  }
  const head = document.head;
  if (!head) {
    return;
  }
  // X rewrites its icon link when the unread count changes, which would undo the swap.
  observer = new MutationObserver(() => swap());
  observer.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
}

function iconLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel]")).filter((link) =>
    ICON_REL.test(link.getAttribute("rel") ?? "")
  );
}

function swap(): void {
  const url = markUrl();
  for (const link of iconLinks()) {
    if (link.getAttribute("href") === url) {
      continue;
    }
    if (!link.hasAttribute(ORIGINAL)) {
      link.setAttribute(ORIGINAL, link.getAttribute("href") ?? "");
    }
    link.setAttribute("href", url);
    link.setAttribute(MARKER, "1");
  }
}

function restoreFavicons(): void {
  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>(`link[${MARKER}]`))) {
    const original = link.getAttribute(ORIGINAL);
    if (original) {
      link.setAttribute("href", original);
    }
    link.removeAttribute(MARKER);
    link.removeAttribute(ORIGINAL);
  }
}

function stop(): void {
  observer?.disconnect();
  observer = undefined;
}

/** Test seam: the module-level observer must not leak between cases. */
export function resetFaviconState(): void {
  stop();
}

export const AVIARY_FAVICON_URL = markUrl;
