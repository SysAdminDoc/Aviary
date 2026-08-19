import type { FeatureContext, FeatureModule } from "../registry";
import { ft } from "../core/feature-i18n";
import { showFeatureToast } from "../core/feature-toast";
import { tweetIdFromHref } from "../media/urls";
import { handleFromHref } from "../filtering/hidden-posts";
import type { CopyLinkHost } from "../../platform/settings";

/**
 * Copy a post's link on a front-end other than X.
 *
 * Deliberately copy-time rewriting rather than redirection. Redirecting `x.com` navigation is the
 * shape of this feature that keeps breaking on everyone who ships it: logging in through the
 * alternate host now sets an `x.com` cookie, and the front-ends people redirected to have been
 * architecturally dead since X removed guest tokens. Rewriting only the text the user asked to
 * copy touches no navigation, originates no request, and cannot break a session.
 *
 * Nothing X rendered is modified. The control writes a string to the clipboard and stops.
 */

const STYLE_ID = "av-copy-post-link";
const BUTTON_ATTR = "data-av-copy-link";
const PROCESSED_ATTR = "data-av-copy-link-processed";

/** The canonical form of a post's address: whichever host, the path X uses is the path they serve. */
export function buildPostLink(
  handle: string | null,
  tweetId: string | null,
  host: CopyLinkHost
): string | null {
  if (!handle || !tweetId) {
    return null;
  }
  return `https://${host === "" ? "x.com" : host}/${handle}/status/${tweetId}`;
}

/**
 * The post's own identity, read from its permalink rather than from anything ambient.
 *
 * Skips a quoted post's link the same way the media extractor does: the timestamp anchor sits in
 * the article's own header, and the quote card carries a second one that belongs to somebody else.
 */
export function readPostIdentity(article: Element): { handle: string | null; tweetId: string | null } {
  for (const link of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))) {
    if (link.closest('div[role="link"][tabindex="0"]') !== null) {
      continue;
    }
    const href = link.getAttribute("href");
    const tweetId = tweetIdFromHref(href);
    if (tweetId) {
      return { handle: handleFromHref(href), tweetId };
    }
  }
  return { handle: null, tweetId: null };
}

export const copyPostLinkFeature: FeatureModule = {
  id: "library.copyPostLink",
  title: "Copy post link",
  category: "layout",

  init(ctx) {
    if (ctx.settings.links.copyLinkHost !== "") {
      ensureStyle();
    }
  },

  apply(ctx, root) {
    if (ctx.settings.links.copyLinkHost === "") {
      // Off is the default, and off means the page is exactly as X rendered it.
      clearDecorations();
      return;
    }
    ensureStyle();
    const scope = root instanceof Element ? root : document;
    const articles = new Set<Element>();
    if (scope instanceof Element && scope.matches('article[data-testid="tweet"]')) {
      articles.add(scope);
    }
    for (const article of Array.from(scope.querySelectorAll('article[data-testid="tweet"]'))) {
      articles.add(article);
    }
    for (const article of articles) {
      decorate(article, ctx);
    }
  },

  destroy() {
    clearDecorations();
  },

  getStatus() {
    const count = document.querySelectorAll(`[${BUTTON_ATTR}]`).length;
    return {
      ok: true,
      message: count === 0 ? "Copy post link idle" : `Copy post link on ${count} post(s)`
    };
  }
};

function decorate(article: Element, ctx: FeatureContext): void {
  if (article.getAttribute(PROCESSED_ATTR) === "1" && article.querySelector(`[${BUTTON_ATTR}]`)) {
    return;
  }
  const identity = readPostIdentity(article);
  if (!identity.handle || !identity.tweetId) {
    // A post with no permalink of its own -- a shell still building -- gets nothing rather than a
    // control that would copy the wrong address.
    return;
  }
  article.setAttribute(PROCESSED_ATTR, "1");
  if (article.querySelector(`[${BUTTON_ATTR}]`)) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "av-copy-link-button";
  button.setAttribute(BUTTON_ATTR, "1");
  const label = ft(ctx, "Copy link");
  button.textContent = label;
  const host = ctx.settings.links.copyLinkHost;
  const accessible = `${ft(ctx, "Copy this post's link")} (${host === "" ? "x.com" : host})`;
  button.title = accessible;
  button.setAttribute("aria-label", accessible);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void copy(article, button, ctx);
  });

  const caret = article.querySelector('[data-testid="caret"]');
  if (caret?.parentElement) {
    caret.parentElement.insertBefore(button, caret);
    return;
  }
  const userName = article.querySelector('[data-testid="User-Name"]');
  if (userName) {
    userName.append(button);
    return;
  }
  article.prepend(button);
}

async function copy(article: Element, button: HTMLButtonElement, ctx: FeatureContext): Promise<void> {
  // Read at click time, not at decoration time: the setting can change while the timeline stands.
  const identity = readPostIdentity(article);
  const link = buildPostLink(identity.handle, identity.tweetId, ctx.settings.links.copyLinkHost);
  if (!link) {
    showFeatureToast(ft(ctx, "This post has no link Aviary can copy."), { ctx, tone: "error" });
    return;
  }
  const original = button.textContent;
  try {
    await writeClipboard(link);
    button.textContent = ft(ctx, "Copied");
    void ctx.auditLog.record("link.copy", { host: ctx.settings.links.copyLinkHost || "x.com" });
  } catch (error) {
    button.textContent = ft(ctx, "Failed");
    ctx.diagnostics.error("Post link could not be copied", errorDetails(error));
    showFeatureToast(ft(ctx, "The clipboard refused this copy."), { ctx, tone: "error" });
  }
  globalThis.setTimeout(() => {
    if (button.isConnected) {
      button.textContent = original;
    }
  }, 1200);
}

async function writeClipboard(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) {
    throw new Error("This browser exposes no clipboard write.");
  }
  await clipboard.writeText(text);
}

function clearDecorations(): void {
  document.getElementById(STYLE_ID)?.remove();
  for (const button of Array.from(document.querySelectorAll(`[${BUTTON_ATTR}]`))) {
    button.remove();
  }
  for (const article of Array.from(document.querySelectorAll(`[${PROCESSED_ATTR}]`))) {
    article.removeAttribute(PROCESSED_ATTR);
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = COPY_LINK_CSS;
  (document.head ?? document.documentElement).append(style);
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

/** Matches the hide control's resting weight so two per-post affordances do not compete. */
const COPY_LINK_CSS = `
.av-copy-link-button {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin-inline-end: 4px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--av-muted, rgb(132, 139, 145)) 55%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--av-muted, rgb(132, 139, 145));
  cursor: pointer;
  font: 700 11px/1.1 TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 0.75;
}

.av-copy-link-button:hover,
.av-copy-link-button:focus-visible {
  opacity: 1;
  color: var(--av-text, rgb(231, 233, 234));
}

@media (prefers-reduced-motion: no-preference) {
  .av-copy-link-button {
    transition: opacity 120ms ease, color 120ms ease;
  }
}
`;
