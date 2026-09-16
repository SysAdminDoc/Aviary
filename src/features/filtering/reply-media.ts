import type { FeatureContext, FeatureModule } from "../registry.ts";
import { conversationPosts, focalPostIndex, routeStatusId } from "../../platform/conversation.ts";
import { structuralSelectorsFor } from "./predicates.ts";

const STYLE_ID = "av-reply-media";
const COMMENT_ATTR = "data-av-comment";

/**
 * Hides every reply that carries an image, a GIF or a video.
 *
 * A comment section under a popular post is mostly memes: reaction GIFs, screenshots, the same
 * image reposted by twenty accounts. Reading the replies means scrolling past all of it, and X
 * offers nothing that removes it.
 *
 * Carrying media is the whole test. Text beside it changes nothing, because a meme reply almost
 * always comes captioned, and a rule that spared those would leave most of them on screen.
 *
 * The existing media filter cannot do this. It is a per-surface rule, so pointing it at the
 * conversation route hides the post being read along with the replies, which is the opposite of
 * what anyone wants. This one knows which post the route is about and leaves it alone, along with
 * the parent chain above it.
 *
 * The split of work matters: JS decides only which rows are comments, which changes when the route
 * or the rendered thread changes, and CSS asks whether a row contains media. Media that loads after
 * the row was stamped is caught by the stylesheet, where a JS pass that had already marked the row
 * done would never look again. The media selectors come from the one table in `predicates.ts`, so
 * this and the filter engine cannot disagree about what a photo is.
 */
export const replyMediaFeature: FeatureModule = {
  id: "filtering.replyMedia",
  title: "Hide replies with media",
  category: "filtering",

  init(ctx) {
    apply(ctx);
    ctx.diagnostics.info("Reply media filter initialized", {
      enabled: ctx.settings.filter.hideMediaReplies
    });
  },

  apply(ctx) {
    apply(ctx);
  },

  destroy(ctx) {
    clear();
    ctx.diagnostics.info("Reply media filter destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: stampedCount > 0 ? `${stampedCount} comments watched` : "Reply media filter idle"
    };
  }
};

let stampedCount = 0;

/** Rows currently marked as comments, for diagnostics and tests. */
export function replyMediaStamped(): number {
  return stampedCount;
}

function apply(ctx: FeatureContext): void {
  // The route comes from the context, not from `location`. Aviary's own router is what keeps that
  // current across X's client-side navigation, and reading the global instead would leave this
  // feature unable to be driven by anything that is not literally on x.com.
  const pathname = ctx.route.path;
  if (!ctx.settings.filter.hideMediaReplies || routeStatusId(pathname) === null) {
    clear();
    return;
  }

  ensureStyle();
  const posts = conversationPosts();
  const focal = focalPostIndex(posts, pathname);

  stampedCount = 0;
  posts.forEach(({ cell }, index) => {
    // Only what comes after the subject. The chain above it is the thread you navigated into, and
    // removing a parent would leave a reply answering nothing.
    if (index > focal) {
      cell.setAttribute(COMMENT_ATTR, "1");
      stampedCount += 1;
    } else {
      cell.removeAttribute(COMMENT_ATTR);
    }
  });
}

function clear(): void {
  document.getElementById(STYLE_ID)?.remove();
  for (const node of Array.from(document.querySelectorAll(`[${COMMENT_ATTR}]`))) {
    node.removeAttribute(COMMENT_ATTR);
  }
  stampedCount = 0;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = REPLY_MEDIA_CSS;
  (document.head ?? document.documentElement).append(style);
}

/**
 * The row is hidden, not the media inside it.
 *
 * X positions conversation rows absolutely inside a measured container, so hiding the article alone
 * leaves its slot reserved and the thread reads as full of gaps. Collapsing the owning row is what
 * the filter engine does for the same reason.
 *
 * A quoted post's media does not count. A reply that quotes a post with a picture is still someone
 * writing something, and the quoted image is not what makes a comment section unreadable.
 */
const MEDIA_SELECTORS = structuralSelectorsFor(["photo", "video", "gif"])
  .map((selector) => `${selector}:not([data-testid="quoteTweet"] *):not([aria-labelledby="quoted"] *):not(div[role="link"][tabindex="0"] *)`)
  .join(",\n");

const REPLY_MEDIA_CSS = `
[${COMMENT_ATTR}="1"]:has(${MEDIA_SELECTORS}) {
  display: none !important;
}
`.trim();
