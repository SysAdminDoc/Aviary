import type { FeatureContext, FeatureModule } from "../registry";
import { ft } from "../core/feature-i18n";
import {
  BookmarkStore,
  type BookmarkInput,
  type BookmarkRecord
} from "./bookmarks";
import { extractTweet } from "../media/extract";

const STYLE_ID = "av-local-bookmarks";
const BUTTON_ATTR = "data-av-local-bookmark";
const ARTICLE_ATTR = "data-av-local-bookmark-processed";

let store: BookmarkStore | undefined;

export const bookmarksFeature: FeatureModule = {
  id: "library.bookmarks",
  title: "Local bookmarks",
  category: "core",
  defaultEnabled: true,

  async init(ctx) {
    store = new BookmarkStore(ctx.storage);
    await store.load();
    ensureStyle();
    scan(ctx, document);
    ctx.diagnostics.info("Local bookmarks initialized", { count: store.size() });
  },

  apply(ctx, root, addedNodes) {
    ensureStyle();
    if (!addedNodes || addedNodes.length === 0) {
      scan(ctx, root);
      return;
    }
    for (const node of addedNodes) {
      scan(ctx, node);
    }
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    for (const article of Array.from(document.querySelectorAll(`[${ARTICLE_ATTR}]`))) {
      article.removeAttribute(ARTICLE_ATTR);
    }
    for (const button of Array.from(document.querySelectorAll(`[${BUTTON_ATTR}]`))) {
      button.remove();
    }
    store = undefined;
    ctx.diagnostics.info("Local bookmarks destroyed");
  },

  getStatus() {
    if (!store) {
      return { ok: true, message: "Bookmarks idle" };
    }
    const due = store.dueReminders().length;
    return {
      ok: true,
      message: `${store.size()} local bookmark${store.size() === 1 ? "" : "s"}${due > 0 ? ` · ${due} due` : ""}`
    };
  }
};

export function getBookmarkStore(): BookmarkStore | undefined {
  return store;
}

export function getBookmarks(): BookmarkRecord[] {
  return store?.list() ?? [];
}

export function searchBookmarks(query: string): BookmarkRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  return getBookmarks()
    .filter((entry) => {
      if (!needle) return true;
      return [
        entry.tweetId,
        entry.handle,
        entry.text,
        entry.url,
        entry.folder,
        entry.notes,
        ...entry.tags
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function bookmarkStatus(): {
  total: number;
  due: number;
  tags: string[];
  folders: string[];
} {
  return {
    total: store?.size() ?? 0,
    due: store?.dueReminders().length ?? 0,
    tags: store?.tags() ?? [],
    folders: store?.folders() ?? []
  };
}

export async function updateBookmark(id: string, input: BookmarkInput): Promise<BookmarkRecord | null> {
  return (await store?.update(id, input)) ?? null;
}

export async function removeBookmark(id: string): Promise<boolean> {
  const existing = store?.get(id);
  if (!existing || !store) {
    return false;
  }
  await store.remove(id);
  return true;
}

export async function clearBookmarks(): Promise<void> {
  await store?.clear();
}

function scan(ctx: FeatureContext, root: ParentNode | Element): void {
  if (!store) {
    return;
  }
  const articles =
    root instanceof Element && root.matches('article[data-testid="tweet"]')
      ? [root]
      : Array.from(root.querySelectorAll<Element>('article[data-testid="tweet"]'));
  for (const article of articles) {
    reconcileArticle(ctx, article);
  }
}

function reconcileArticle(ctx: FeatureContext, article: Element): void {
  if (!store) return;
  const tweet = extractTweet(article);
  const buttons = Array.from(article.querySelectorAll<HTMLButtonElement>(`[${BUTTON_ATTR}]`));
  const existing = buttons[0];
  for (const duplicate of buttons.slice(1)) {
    duplicate.remove();
  }

  if (!tweet.tweetId) {
    existing?.remove();
    article.removeAttribute(ARTICLE_ATTR);
    return;
  }

  const anchor = findActionAnchor(article);
  if (!anchor) {
    existing?.remove();
    article.removeAttribute(ARTICLE_ATTR);
    return;
  }

  const saved = store.findByTweetId(tweet.tweetId);
  const button = existing ?? buildButton(ctx, article);
  if (!existing) {
    anchor.append(button);
  }
  updateButton(button, Boolean(saved), ctx);
  article.setAttribute(ARTICLE_ATTR, "1");
}

function findActionAnchor(article: Element): Element | null {
  return (
    article.querySelector('[role="group"][aria-label="Post actions"]') ??
    article.querySelector('[role="group"][aria-label*="Post actions" i]') ??
    article.querySelector('[role="group"]')
  );
}

function buildButton(ctx: FeatureContext, article: Element): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "av-bookmark-button";
  button.setAttribute(BUTTON_ATTR, "1");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void toggleBookmark(ctx, article, button);
  });
  return button;
}

async function toggleBookmark(
  ctx: FeatureContext,
  article: Element,
  button: HTMLButtonElement
): Promise<void> {
  if (!store) return;
  const tweet = extractTweet(article);
  if (!tweet.tweetId) return;
  button.disabled = true;
  try {
    const existing = store.findByTweetId(tweet.tweetId);
    if (existing) {
      await store.remove(existing.id);
      void ctx.auditLog.record("bookmark.remove", { tweetId: tweet.tweetId });
      ctx.diagnostics.info("Local bookmark removed", { tweetId: tweet.tweetId });
    } else {
      const entry = await store.upsert({
        tweetId: tweet.tweetId,
        handle: tweet.handle,
        text: tweet.text,
        url: permalink(article, tweet.tweetId)
      });
      void ctx.auditLog.record("bookmark.save", { id: entry.id, tweetId: tweet.tweetId });
      ctx.diagnostics.info("Local bookmark saved", { tweetId: tweet.tweetId });
    }
    reconcileArticle(ctx, article);
    ctx.requestApply();
  } catch (error) {
    ctx.diagnostics.error("Local bookmark action failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    button.classList.add("is-error");
    button.textContent = ft(ctx, "Bookmark failed");
  } finally {
    button.disabled = false;
  }
}

function updateButton(button: HTMLButtonElement, saved: boolean, ctx: FeatureContext): void {
  button.dataset.state = saved ? "saved" : "empty";
  button.textContent = ft(ctx, saved ? "Saved locally" : "Save locally");
  button.setAttribute("aria-label", ft(ctx, saved ? "Remove local bookmark" : "Save locally"));
  button.title = button.getAttribute("aria-label") ?? "";
  button.classList.toggle("is-saved", saved);
  button.classList.remove("is-error");
}

function permalink(article: Element, tweetId: string): string | null {
  const link = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  if (link?.href && /^https?:/i.test(link.href)) {
    return link.href;
  }
  const rawHref = link?.getAttribute("href") ?? "";
  const handle = /^\/([A-Za-z0-9_]{1,15})\/status\//.exec(rawHref)?.[1];
  if (handle) {
    return `https://x.com/${handle}/status/${tweetId}`;
  }
  const profileHref = article.querySelector<HTMLAnchorElement>('a[href^="/"]')?.href;
  if (profileHref) {
    try {
      const url = new URL(profileHref);
      return `${url.origin}/i/status/${tweetId}`;
    } catch {
      // fall through to X's canonical host
    }
  }
  return `https://x.com/i/status/${tweetId}`;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BOOKMARK_CSS;
  (document.head ?? document.documentElement).append(style);
}

const BOOKMARK_CSS = `
[${BUTTON_ATTR}] {
  min-width: 0;
  min-height: 24px;
  margin-left: 4px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--av-muted, rgb(113, 118, 123));
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 24px;
}

[${BUTTON_ATTR}]:hover,
[${BUTTON_ATTR}]:focus-visible {
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 65%, transparent);
  color: var(--av-accent, rgb(29, 155, 240));
}

[${BUTTON_ATTR}].is-saved {
  color: var(--av-accent, rgb(29, 155, 240));
}

[${BUTTON_ATTR}].is-error {
  color: rgb(220, 110, 110);
}
`;
