const PRIMARY_COLUMN = '[data-testid="primaryColumn"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const QUOTE_BOUNDARY =
  '[data-testid="quoteTweet"], [aria-labelledby="quoted"], div[role="link"][tabindex="0"]';

export interface ConversationPost {
  cell: HTMLElement;
  article: HTMLElement;
}

/**
 * The posts a conversation route renders, one per outer row, in document order.
 *
 * A quoted post is an article-shaped thing inside another post, so the row's own article is the
 * one whose nearest cell is that row. Anything nested below it belongs to the post that quotes it.
 */
export function conversationPosts(root: ParentNode = document): ConversationPost[] {
  const primary = root.querySelector<HTMLElement>(PRIMARY_COLUMN) ?? null;
  if (!primary) {
    return [];
  }
  const posts: ConversationPost[] = [];
  for (const cell of Array.from(primary.querySelectorAll<HTMLElement>(CELL_SELECTOR))) {
    const article = cell.querySelector<HTMLElement>(ARTICLE_SELECTOR);
    if (!article || article.closest(CELL_SELECTOR) !== cell) continue;
    posts.push({ cell, article });
  }
  return posts;
}

/** The status id the current route names, or null anywhere that is not a conversation. */
export function routeStatusId(pathname = globalThis.location?.pathname ?? ""): string | null {
  return /(?:^|\/)status\/(\d{1,25})(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

/**
 * Which rendered post the route is actually about.
 *
 * Position alone is wrong: opening a reply's permalink renders the parent chain above it, so the
 * first cell is someone else's post. The status id in the URL is the one thing that names the
 * subject, so it is matched against each post's own permalink.
 *
 * Links inside a quoted post are skipped, because a reply quoting the subject carries the subject's
 * id too and would otherwise claim the role from the post that owns it. Falling back to the first
 * post keeps the old behaviour for a conversation whose subject has not rendered yet.
 *
 * Shared rather than copied: the theme reads this to size a post's media and the reply-media filter
 * reads it to decide what is a comment. Two copies of a rule this subtle would drift, and the first
 * version of it (whichever post rendered first) was wrong in exactly the case that matters.
 */
export function focalPostIndex(
  posts: readonly { article: HTMLElement }[],
  pathname = globalThis.location?.pathname ?? ""
): number {
  const statusId = routeStatusId(pathname);
  if (!statusId) return 0;

  const permalink = new RegExp(`/status/${statusId}(?:[/?#]|$)`);
  const found = posts.findIndex(({ article }) =>
    Array.from(article.querySelectorAll("a[href]")).some(
      (link) =>
        link.closest(QUOTE_BOUNDARY) === null &&
        permalink.test(link.getAttribute("href") ?? "")
    )
  );
  return found === -1 ? 0 : found;
}
