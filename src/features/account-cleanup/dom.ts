import {
  ACCOUNT_CLEANUP_TIMING,
  type AccountCleanupCategory,
  accountCleanupHandleFromHref,
  sameAccountCleanupHandle
} from "./state.ts";

export type AccountCleanupTargetKind = "delete" | "undoRepost" | "unlike" | "removeBookmark";

export interface AccountCleanupTarget {
  category: AccountCleanupCategory;
  kind: AccountCleanupTargetKind;
  article: HTMLElement;
  control: HTMLButtonElement;
  author: string;
  id: string;
}

export interface AccountCleanupActionOutcome {
  status: "success" | "failed" | "skipped" | "stale";
  reason?: string;
}

interface StatusIdentity {
  author: string;
  id: string;
}

const DELETE_WORDS = new Set([
  "delete",
  "delete post",
  "delete reply",
  "eliminar",
  "eliminar publicación",
  "supprimer",
  "supprimer le post",
  "löschen",
  "beitrag löschen",
  "elimina",
  "elimina post",
  "excluir",
  "excluir post",
  "verwijderen",
  "usuń",
  "удалить",
  "sil",
  "削除",
  "삭제",
  "删除",
  "刪除",
  "حذف",
  "מחיקה"
]);

const DANGER_RGB = [244, 33, 46] as const;

export function parseAccountCleanupStatusHref(href: string | null): StatusIdentity | null {
  if (!href) return null;
  let pathname: string;
  try {
    pathname = new URL(href, "https://x.com").pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/|$)/);
  if (!match?.[1] || !match[2]) return null;
  const author = accountCleanupHandleFromHref(`/${match[1]}`);
  return author ? { author, id: match[2] } : null;
}

export function getPrimaryAccountCleanupStatus(article: Element): StatusIdentity | null {
  for (const time of article.querySelectorAll('a[href*="/status/"] time')) {
    const parsed = parseAccountCleanupStatusHref(time.closest("a")?.getAttribute("href") ?? null);
    if (parsed) return parsed;
  }
  for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    const parsed = parseAccountCleanupStatusHref(link.getAttribute("href"));
    if (parsed) return parsed;
  }
  return null;
}

export function findAccountCleanupTargets(
  category: AccountCleanupCategory,
  handle: string,
  documentObject: Document = document
): AccountCleanupTarget[] {
  const targets: AccountCleanupTarget[] = [];
  const seen = new Set<string>();
  const articles = Array.from(
    documentObject.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')
  );
  const windowObject = documentObject.defaultView ?? window;

  for (const [index, article] of articles.entries()) {
    if (!article.isConnected) continue;
    const status = getPrimaryAccountCleanupStatus(article);
    if (!status || seen.has(status.id)) continue;
    if (
      category === "replies" &&
      !isAccountCleanupReplyArticle(article, articles[index - 1] ?? null, handle, windowObject)
    ) {
      continue;
    }
    const target = targetForCategory(category, handle, article, status);
    if (!target) continue;
    seen.add(status.id);
    targets.push(target);
  }
  return targets;
}

export function isAccountCleanupReplyArticle(
  article: HTMLElement,
  previousArticle: HTMLElement | null,
  handle: string,
  windowObject: Window = window
): boolean {
  if (hasReplyContextLink(article)) return true;
  if (!previousArticle || !hasAccountCleanupReplyConnector(previousArticle, windowObject)) return false;

  const parentStatus = getPrimaryAccountCleanupStatus(previousArticle);
  const replyStatus = getPrimaryAccountCleanupStatus(article);
  if (!parentStatus || !replyStatus || !sameAccountCleanupHandle(replyStatus.author, handle)) return false;
  return compareDecimalIds(replyStatus.id, parentStatus.id) > 0;
}

export function hasAccountCleanupReplyConnector(
  article: HTMLElement,
  windowObject: Window = window
): boolean {
  const articleRect = article.getBoundingClientRect();
  if (articleRect.width <= 0 || articleRect.height <= 0) return false;

  return Array.from(article.querySelectorAll<HTMLElement>("div")).some((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.width > 4 || rect.height < 20) return false;
    const relativeX = rect.left - articleRect.left;
    const reachesBottom = Math.abs(articleRect.bottom - rect.bottom) <= 2;
    if (relativeX < 18 || relativeX > 58 || !reachesBottom) return false;
    const style = windowObject.getComputedStyle(element);
    return style.display === "flex" && style.flexGrow === "1" &&
      style.backgroundColor !== "rgba(0, 0, 0, 0)";
  });
}

export async function performAccountCleanupTarget(
  target: AccountCleanupTarget,
  options: {
    documentObject?: Document;
    windowObject?: Window;
    signal?: AbortSignal;
  } = {}
): Promise<AccountCleanupActionOutcome> {
  const documentObject = options.documentObject ?? document;
  const windowObject = options.windowObject ?? window;
  if (!target.control.isConnected) return { status: "stale", reason: "control_missing" };

  if (target.kind === "delete") {
    return deleteAccountCleanupPost(target, documentObject, windowObject, options.signal);
  }
  if (target.kind === "undoRepost") {
    return clickAndConfirmAccountCleanupTarget(
      target,
      documentObject,
      options.signal,
      '[data-testid="unretweetConfirm"]',
      '[data-testid="unretweet"]'
    );
  }
  if (target.kind === "unlike") {
    target.control.click();
    return waitForAccountCleanupTargetChange(
      target,
      documentObject,
      options.signal,
      '[data-testid="unlike"]'
    );
  }
  target.control.click();
  return waitForAccountCleanupTargetChange(
    target,
    documentObject,
    options.signal,
    '[data-testid="removeBookmark"]'
  );
}

export function selectAccountCleanupDeleteMenuItem(
  menu: Element,
  windowObject: Window = window
): HTMLElement | null {
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const explicit = items.find((item) => DELETE_WORDS.has(normalizeText(item.textContent)));
  if (explicit) return explicit;
  const byTestId = items.find((item) => /delete/i.test(item.getAttribute("data-testid") ?? ""));
  if (byTestId) return byTestId;
  return items.find((item) => hasAccountCleanupDangerColor(item, windowObject)) ?? null;
}

export function hasAccountCleanupDangerColor(
  element: Element,
  windowObject: Window = window
): boolean {
  const candidates = [element, ...Array.from(element.querySelectorAll("*"))].slice(0, 40);
  return candidates.some((candidate) => {
    const color = windowObject.getComputedStyle(candidate).color;
    const channels = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (!channels) return false;
    return DANGER_RGB.every((channel, index) => Number(channels[index + 1]) === channel);
  });
}

export function findAccountCleanupConfirmationButton(
  documentObject: Document = document,
  windowObject: Window = window
): HTMLButtonElement | null {
  const direct = documentObject.querySelector<HTMLButtonElement>(
    'button[data-testid="confirmationSheetConfirm"]'
  );
  if (visibleElement(direct, windowObject)) return direct;

  const dialog = Array.from(documentObject.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .find((candidate) => visibleElement(candidate, windowObject));
  if (!dialog) return null;
  const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"));
  const explicit = buttons.find((button) => DELETE_WORDS.has(normalizeText(
    button.getAttribute("aria-label") ?? button.textContent
  )));
  return explicit ?? buttons.find((button) => hasAccountCleanupDangerColor(button, windowObject)) ?? null;
}

export function findAccountCleanupArticleByStatusId(
  statusId: string,
  documentObject: Document = document
): HTMLElement | null {
  // Match the article's own status, not any link inside it: a substring match also finds a post
  // that quotes the target, or one whose id merely starts with the same digits.
  for (const article of documentObject.querySelectorAll<HTMLElement>('article[data-testid="tweet"]')) {
    if (getPrimaryAccountCleanupStatus(article)?.id === statusId) return article;
  }
  return null;
}

export function visibleAccountCleanupStatusIds(documentObject: Document = document): Set<string> {
  const ids = new Set<string>();
  for (const article of documentObject.querySelectorAll('article[data-testid="tweet"]')) {
    const status = getPrimaryAccountCleanupStatus(article);
    if (status) ids.add(status.id);
  }
  return ids;
}

export function isAccountCleanupChallengePresent(
  documentObject: Document = document,
  locationObject: Pick<Location, "pathname"> = location
): boolean {
  if (/\/i\/flow\/(login|signup)/.test(locationObject.pathname)) return true;
  return Boolean(
    documentObject.querySelector('[data-testid="captcha"]') ||
    documentObject.querySelector('iframe[src*="captcha" i]') ||
    documentObject.querySelector('iframe[src*="challenge" i]')
  );
}

export async function scrollAccountCleanupForMore(options: {
  documentObject?: Document;
  windowObject?: Window;
  signal?: AbortSignal;
} = {}): Promise<{ changed: boolean; visible: number }> {
  const documentObject = options.documentObject ?? document;
  const windowObject = options.windowObject ?? window;
  const scroller = documentObject.scrollingElement ?? documentObject.documentElement;
  const beforeTop = scroller.scrollTop || windowObject.scrollY || 0;
  const beforeHeight = scroller.scrollHeight || documentObject.body?.scrollHeight || 0;
  const beforeIds = visibleAccountCleanupStatusIds(documentObject);
  windowObject.scrollTo({ top: beforeHeight, left: 0, behavior: "auto" });
  await accountCleanupSleep(ACCOUNT_CLEANUP_TIMING.scrollPauseMs, options.signal);

  const afterTop = scroller.scrollTop || windowObject.scrollY || 0;
  const afterHeight = scroller.scrollHeight || documentObject.body?.scrollHeight || 0;
  const afterIds = visibleAccountCleanupStatusIds(documentObject);
  const hasNewId = [...afterIds].some((id) => !beforeIds.has(id));
  return {
    changed: hasNewId || afterTop !== beforeTop || afterHeight !== beforeHeight,
    visible: afterIds.size
  };
}

export function accountCleanupSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      globalThis.clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

export async function waitForAccountCleanupValue<T>(
  read: () => T | null | undefined | false,
  options: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal | undefined }
): Promise<T | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    if (options.signal?.aborted) throw abortError();
    const value = read();
    if (value) return value;
    await accountCleanupSleep(options.intervalMs ?? 100, options.signal);
  }
  return null;
}

function targetForCategory(
  category: AccountCleanupCategory,
  handle: string,
  article: HTMLElement,
  status: StatusIdentity
): AccountCleanupTarget | null {
  if (category === "posts" || category === "replies") {
    if (!sameAccountCleanupHandle(status.author, handle)) return null;
    const control = findMoreButton(article);
    return control ? { category, kind: "delete", article, control, ...status } : null;
  }
  if (category === "reposts") {
    const control = findButton(article, '[data-testid="unretweet"]');
    return control ? { category, kind: "undoRepost", article, control, ...status } : null;
  }
  if (category === "likes") {
    const control = findButton(article, '[data-testid="unlike"]') ??
      findButton(article, '[aria-label="Liked"]');
    return control ? { category, kind: "unlike", article, control, ...status } : null;
  }
  const control = findButton(article, '[data-testid="removeBookmark"]');
  return control ? { category, kind: "removeBookmark", article, control, ...status } : null;
}

function hasReplyContextLink(article: Element): boolean {
  const tweetText = article.querySelector('[data-testid="tweetText"]');
  if (!tweetText) return false;
  return Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')).some((link) => {
    if (link.closest('[data-testid="User-Name"]')) return false;
    const href = link.getAttribute("href") ?? "";
    if (!/^\/[A-Za-z0-9_]{1,30}\/?$/.test(href)) return false;
    return Boolean(link.compareDocumentPosition(tweetText) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
}

function findMoreButton(article: Element): HTMLButtonElement | null {
  return findButton(article, '[data-testid="caret"]') ??
    findButton(article, '[data-testid="more"]') ??
    findButton(article, '[aria-label="More"]');
}

function findButton(root: Element, selector: string): HTMLButtonElement | null {
  const match = root.querySelector<HTMLElement>(selector);
  return match instanceof HTMLButtonElement ? match : match?.closest("button") ?? null;
}

async function deleteAccountCleanupPost(
  target: AccountCleanupTarget,
  documentObject: Document,
  windowObject: Window,
  signal?: AbortSignal
): Promise<AccountCleanupActionOutcome> {
  target.control.click();
  const menu = await waitForAccountCleanupValue(
    () => visibleElement(documentObject.querySelector<HTMLElement>('[role="menu"]'), windowObject),
    { timeoutMs: ACCOUNT_CLEANUP_TIMING.menuTimeoutMs, signal }
  );
  if (!menu) return { status: "failed", reason: "menu_missing" };

  const deleteItem = selectAccountCleanupDeleteMenuItem(menu, windowObject);
  if (!deleteItem) {
    toggleMenuClosed(target.control, documentObject);
    return { status: "skipped", reason: "delete_item_missing" };
  }
  deleteItem.click();
  const confirmButton = await waitForAccountCleanupValue(
    () => findAccountCleanupConfirmationButton(documentObject, windowObject),
    { timeoutMs: ACCOUNT_CLEANUP_TIMING.actionTimeoutMs, signal }
  );
  if (!confirmButton) {
    toggleMenuClosed(target.control, documentObject);
    return { status: "failed", reason: "confirmation_missing" };
  }
  confirmButton.click();
  return waitForAccountCleanupTargetChange(
    target,
    documentObject,
    signal,
    '[data-testid="caret"]',
    true
  );
}

async function clickAndConfirmAccountCleanupTarget(
  target: AccountCleanupTarget,
  documentObject: Document,
  signal: AbortSignal | undefined,
  confirmSelector: string,
  activeSelector: string
): Promise<AccountCleanupActionOutcome> {
  target.control.click();
  const confirmButton = await waitForAccountCleanupValue(
    () => documentObject.querySelector<HTMLButtonElement>(confirmSelector),
    { timeoutMs: ACCOUNT_CLEANUP_TIMING.menuTimeoutMs, signal }
  );
  if (!confirmButton) return { status: "failed", reason: "confirmation_missing" };
  confirmButton.click();
  return waitForAccountCleanupTargetChange(target, documentObject, signal, activeSelector);
}

async function waitForAccountCleanupTargetChange(
  target: AccountCleanupTarget,
  documentObject: Document,
  signal: AbortSignal | undefined,
  activeSelector: string,
  requireGone = false
): Promise<AccountCleanupActionOutcome> {
  const changed = await waitForAccountCleanupValue(() => {
    const fresh = findAccountCleanupArticleByStatusId(target.id, documentObject);
    if (!fresh) return true;
    return requireGone ? false : !fresh.querySelector(activeSelector);
  }, {
    timeoutMs: ACCOUNT_CLEANUP_TIMING.actionTimeoutMs,
    intervalMs: 120,
    signal
  });
  return changed ? { status: "success" } : { status: "failed", reason: "action_not_applied" };
}

function visibleElement<T extends Element>(element: T | null, windowObject: Window): T | null {
  if (!element) return null;
  const style = windowObject.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden" ? null : element;
}

function toggleMenuClosed(control: HTMLButtonElement, documentObject: Document): void {
  if (documentObject.querySelector('[role="menu"]') && control.isConnected) control.click();
}

function normalizeText(value: string | null): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function compareDecimalIds(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+/, "") || "0";
  const normalizedRight = right.replace(/^0+/, "") || "0";
  if (!/^\d+$/.test(normalizedLeft) || !/^\d+$/.test(normalizedRight)) return 0;
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft > normalizedRight ? 1 : -1;
}

function abortError(): DOMException {
  return new DOMException("Account cleanup was interrupted", "AbortError");
}
