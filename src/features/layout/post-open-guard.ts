import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";

const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const REPLY_SELECTOR = '[data-testid="reply"]';
const LABEL_ATTR = "data-av-open-label";
const GUARDED_EVENTS = ["click", "auxclick"] as const;

/**
 * Anything that carries its own meaning keeps its press: links, buttons, form controls, media,
 * and a quoted post, which is its own link to somewhere else. Everything between them is the row
 * itself, and the row is what this feature takes the click target away from.
 *
 * The quote boundary is the one `features/media/extract.ts` declares, for the reason recorded
 * there: X uses `role="link"` widely for things that are not quotes.
 */
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, video, audio, summary, label, [role="button"], ' +
  '[role="menuitem"], [role="checkbox"], [role="switch"], [role="tab"], [role="slider"], ' +
  '[contenteditable="true"], [data-testid="quoteTweet"], [aria-labelledby="quoted"], ' +
  'div[role="link"][tabindex="0"]';

let guardListener: ((event: Event) => void) | undefined;
let guardCtx: FeatureContext | undefined;
let swallowed = 0;
let opened = 0;

/**
 * Takes the click target off the post and puts it on the reply icon.
 *
 * X makes an entire row navigate. That is fine until it is not: a press on the text, on the gap
 * beside a control, or a few pixels off the one you meant, and a post you never chose is open and
 * your place in the feed is gone. The dead zone around the Hide control fixed one corner of that;
 * this is the same complaint answered for the whole row.
 *
 * The reply icon carries the gesture instead, because replying is the one thing a post's own
 * controls cannot already do from the feed, and it lands on the post anyway. Its accessible name
 * is rewritten to say so, so a screen reader is not told "Reply" by a control that opens a post.
 */
export const postOpenGuardFeature: FeatureModule = {
  id: "layout.postOpenGuard",
  title: "Open posts from the reply icon",
  category: "layout",

  init(ctx) {
    installGuard(ctx);
    if (ctx.settings.layout.openFromReplyOnly) {
      relabelReplyControls(document, ctx);
    }
    ctx.diagnostics.info("Post open guard initialized", {
      enabled: ctx.settings.layout.openFromReplyOnly
    });
  },

  apply(ctx, root) {
    guardCtx = ctx;
    if (!ctx.settings.layout.openFromReplyOnly) {
      restoreReplyControls();
      return;
    }
    relabelReplyControls(root, ctx);
  },

  destroy(ctx) {
    removeGuard();
    restoreReplyControls();
    ctx.diagnostics.info("Post open guard destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: guardCtx?.settings.layout.openFromReplyOnly
        ? `${swallowed} stray presses absorbed, ${opened} posts opened`
        : "Post open guard idle"
    };
  }
};

/** Presses absorbed and posts opened through the reply icon, for diagnostics and tests. */
export function postOpenGuardCounts(): { swallowed: number; opened: number } {
  return { swallowed, opened };
}

/**
 * One capture-phase listener on `window`, upstream of every handler X installs on the row, and
 * installed once for the life of the feature: the decision is made per event from live settings,
 * so the setting takes effect without rebinding.
 */
function installGuard(ctx: FeatureContext): void {
  guardCtx = ctx;
  if (guardListener || typeof window === "undefined") {
    return;
  }
  guardListener = (event: Event) => {
    if (!guardCtx?.settings.layout.openFromReplyOnly || !(event instanceof MouseEvent)) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const article = target.closest(ARTICLE_SELECTOR);
    if (!article) {
      return;
    }

    const reply = target.closest(REPLY_SELECTOR);
    if (reply && reply.closest(ARTICLE_SELECTOR) === article) {
      openPost(article, event);
      return;
    }
    if (hitsControl(target, article)) {
      return;
    }

    swallowed += 1;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  };
  for (const type of GUARDED_EVENTS) {
    window.addEventListener(type, guardListener, true);
  }
}

function removeGuard(): void {
  if (!guardListener || typeof window === "undefined") {
    return;
  }
  for (const type of GUARDED_EVENTS) {
    window.removeEventListener(type, guardListener, true);
  }
  guardListener = undefined;
  guardCtx = undefined;
}

/**
 * Walks from the pressed node up to the post, not to the document.
 *
 * X wraps rows and quoted posts in containers that answer to the same selectors a control does,
 * so an unbounded walk would report a control for every press inside a post and the guard would
 * silently never fire. The post is the boundary because its navigation is what is being replaced.
 */
function hitsControl(target: Element, article: Element): boolean {
  let node: Element | null = target;
  while (node && node !== article) {
    if (node.matches(INTERACTIVE_SELECTOR)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Opens the post the reply icon belongs to.
 *
 * A plain press goes through the post's own permalink so X's router handles it and the feed is
 * not reloaded. A modifier or a middle click means "somewhere else", and a synthesized event
 * cannot ask the browser for a new tab, so that case opens the URL directly.
 */
function openPost(article: Element, event: MouseEvent): void {
  const permalink = postPermalink(article);
  if (!permalink) {
    // No permalink means no post to open, and the composer X would have opened is the better
    // outcome than swallowing the press and doing nothing at all.
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
  opened += 1;

  const elsewhere = event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1;
  if (elsewhere) {
    globalThis.open?.(permalink.href, "_blank", "noopener");
    return;
  }
  permalink.click();
}

/**
 * The post's own permalink anchor, never one belonging to a quoted post inside it.
 *
 * A post's media links are `/status/<id>` URLs too, with `/photo/1` or `/video/1` on the end, and
 * following one opens the lightbox rather than the post. So the id has to end the path: the loose
 * form is accepted only as a fallback, and never for a media or analytics link, because opening
 * the wrong thing is worse than leaving the press to X.
 */
function postPermalink(article: Element): HTMLAnchorElement | null {
  const candidates = Array.from(
    article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')
  ).filter(
    (link) =>
      link.closest(ARTICLE_SELECTOR) === article &&
      !link.closest('[data-testid="quoteTweet"], [aria-labelledby="quoted"], div[role="link"][tabindex="0"]')
  );

  const exact = candidates.find((link) =>
    /\/status\/\d{1,25}(?:$|[?#])/.test(link.getAttribute("href") ?? "")
  );
  if (exact) return exact;

  return (
    candidates.find((link) => {
      const href = link.getAttribute("href") ?? "";
      if (/\/(?:photo|video|analytics|likes|retweets|quotes|history)(?:\/|$)/.test(href)) return false;
      return /\/status\/\d{1,25}(?:$|[/?#])/.test(href);
    }) ?? null
  );
}

/**
 * Says what the control now does, and remembers what it said before.
 *
 * The original name is kept on the element so turning the feature off puts X's own label back
 * rather than leaving a control that reads as Aviary's after Aviary stopped touching it.
 */
function relabelReplyControls(root: ParentNode | Element, ctx: FeatureContext): void {
  const label = ft(ctx, "Open post");
  for (const reply of collectReplyControls(root)) {
    if (reply.getAttribute("aria-label") === label) continue;
    if (!reply.hasAttribute(LABEL_ATTR)) {
      reply.setAttribute(LABEL_ATTR, reply.getAttribute("aria-label") ?? "");
    }
    reply.setAttribute("aria-label", label);
  }
}

function restoreReplyControls(): void {
  for (const reply of Array.from(document.querySelectorAll<HTMLElement>(`[${LABEL_ATTR}]`))) {
    const original = reply.getAttribute(LABEL_ATTR) ?? "";
    if (original === "") {
      reply.removeAttribute("aria-label");
    } else {
      reply.setAttribute("aria-label", original);
    }
    reply.removeAttribute(LABEL_ATTR);
  }
}

function collectReplyControls(root: ParentNode | Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(REPLY_SELECTOR)) {
    found.push(root);
  }
  if ("querySelectorAll" in root) {
    for (const node of Array.from(root.querySelectorAll<HTMLElement>(REPLY_SELECTOR))) {
      if (node.closest(ARTICLE_SELECTOR)) {
        found.push(node);
      }
    }
  }
  return found;
}
