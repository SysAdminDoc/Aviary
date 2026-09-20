import type { FeatureContext, FeatureModule } from "../registry.ts";

const STORAGE_PREFIX = "aviary.timeline-position.v1:";
const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
const MAX_AGE_MS = 30 * 60 * 1000;
const SAVE_DELAY_MS = 140;
const RESTORE_TIMEOUT_MS = 7_000;
const COARSE_INTERVAL_MS = 220;
const ANCHOR_TOLERANCE_PX = 3;
const STABLE_FRAMES = 8;
const POST_RESTORE_SAVE_DELAY_MS = 850;
const ROOT_ROUTE_EXCLUSIONS = new Set([
  "compose",
  "download",
  "explore",
  "home",
  "i",
  "intent",
  "jobs",
  "legal",
  "login",
  "logout",
  "messages",
  "notifications",
  "privacy",
  "search",
  "settings",
  "share",
  "signup"
]);

interface TimelineAnchor {
  tweetId: string;
  top: number;
  handle: string | null;
  priority: "clicked" | "visible";
}

interface TimelineSnapshot {
  route: string;
  scrollY: number;
  savedAt: number;
  anchors: TimelineAnchor[];
}

let activeContext: FeatureContext | undefined;
let listenersAttached = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
let restoreFrame = 0;
let restoreToken = 0;
let restoring = false;
let suppressSaveUntil = 0;
let lastUserIntentAt = 0;
let restoredCount = 0;
let failedCount = 0;
let initialNavigationHandled = false;

export const timelinePositionFeature: FeatureModule = {
  id: "layout.timelinePosition",
  title: "Back-navigation position",
  category: "layout",

  init(ctx) {
    activeContext = ctx;
    reconcile(ctx);
  },

  apply(ctx) {
    activeContext = ctx;
    reconcile(ctx);
  },

  destroy() {
    if (enabled() && isRestorableRoute(location.href) && !restoring) savePosition("destroy");
    teardown(true);
  },

  getStatus() {
    return {
      ok: failedCount === 0,
      message: restoring
        ? "Restoring timeline position"
        : `Timeline positions restored: ${restoredCount}${failedCount ? ` / ${failedCount} incomplete` : ""}`
    };
  }
};

function reconcile(ctx: FeatureContext): void {
  if (!ctx.settings.layout.restoreTimelinePosition) {
    teardown(false);
    return;
  }
  attachListeners();
  if (initialNavigationHandled) return;
  initialNavigationHandled = true;
  const navigation = globalThis.performance?.getEntriesByType?.("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (navigation?.type === "back_forward" && isRestorableRoute(location.href)) {
    queueRestore("initial-back-forward");
  }
}

function enabled(): boolean {
  return activeContext?.settings.layout.restoreTimelinePosition === true;
}

function attachListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  globalThis.addEventListener("scroll", onScroll, { passive: true });
  globalThis.addEventListener("wheel", registerUserIntent, { capture: true, passive: true });
  globalThis.addEventListener("touchstart", registerUserIntent, { capture: true, passive: true });
  globalThis.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  globalThis.addEventListener("keydown", onKeyDown, true);
  globalThis.addEventListener("popstate", onPopState, true);
  globalThis.addEventListener("pageshow", onPageShow, true);
  globalThis.addEventListener("pagehide", onPageHide, true);
  document.addEventListener("visibilitychange", onVisibilityChange, true);
}

function detachListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  globalThis.removeEventListener("scroll", onScroll);
  globalThis.removeEventListener("wheel", registerUserIntent, true);
  globalThis.removeEventListener("touchstart", registerUserIntent, true);
  globalThis.removeEventListener("pointerdown", onPointerDown, true);
  globalThis.removeEventListener("keydown", onKeyDown, true);
  globalThis.removeEventListener("popstate", onPopState, true);
  globalThis.removeEventListener("pageshow", onPageShow, true);
  globalThis.removeEventListener("pagehide", onPageHide, true);
  document.removeEventListener("visibilitychange", onVisibilityChange, true);
}

function onScroll(): void {
  if (!enabled() || restoring || Date.now() < suppressSaveUntil || !isRestorableRoute(location.href)) {
    return;
  }
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    savePosition("scroll");
  }, SAVE_DELAY_MS);
}

function onPointerDown(event: PointerEvent): void {
  const wasRestoring = restoring;
  registerUserIntent(event);
  if (wasRestoring) return;
  if (!enabled() || event.button !== 0 || !isRestorableRoute(location.href)) return;
  const target = event.target instanceof Element ? event.target : null;
  const article = target?.closest(ARTICLE_SELECTOR) ?? null;
  if (article || target?.closest("a[href]")) savePosition("pointerdown", article);
}

function onKeyDown(event: KeyboardEvent): void {
  const scrollKeys = new Set([
    "ArrowUp",
    "ArrowDown",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    "Space",
    " "
  ]);
  if (scrollKeys.has(event.code) || scrollKeys.has(event.key)) registerUserIntent(event);
}

function registerUserIntent(event: Event): void {
  lastUserIntentAt = Date.now();
  if (restoring) cancelRestore(`user-${event.type}`);
}

function onPopState(): void {
  if (enabled() && isRestorableRoute(location.href)) queueRestore("popstate");
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted && enabled() && isRestorableRoute(location.href)) queueRestore("bfcache");
}

function onPageHide(): void {
  if (enabled() && isRestorableRoute(location.href) && !restoring) savePosition("pagehide");
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden" && enabled() && isRestorableRoute(location.href) && !restoring) {
    savePosition("hidden");
  }
}

function savePosition(_reason: string, clickedArticle: Element | null = null): void {
  const route = routeKey(location.href);
  if (!route || !isRestorableRoute(location.href) || restoring || Date.now() < suppressSaveUntil) return;
  const anchors: TimelineAnchor[] = [];
  const seen = new Set<string>();
  const candidates = [
    clickedArticle ? anchorForArticle(clickedArticle, "clicked") : null,
    ...visibleAnchors()
  ];
  for (const anchor of candidates) {
    if (!anchor || seen.has(anchor.tweetId)) continue;
    seen.add(anchor.tweetId);
    anchors.push(anchor);
    if (anchors.length >= 6) break;
  }
  writeSnapshot({
    route,
    scrollY: Math.max(0, globalThis.scrollY || 0),
    savedAt: Date.now(),
    anchors
  });
}

function visibleAnchors(): TimelineAnchor[] {
  const viewportHeight = globalThis.innerHeight || document.documentElement.clientHeight || 0;
  const complete: TimelineAnchor[] = [];
  const partial: TimelineAnchor[] = [];
  for (const article of Array.from(document.querySelectorAll<Element>(ARTICLE_SELECTOR))) {
    const rect = article.getBoundingClientRect();
    if (rect.height < 4 || rect.bottom <= 0 || rect.top >= viewportHeight) continue;
    const anchor = anchorForArticle(article, "visible");
    if (!anchor) continue;
    (rect.top >= 0 && rect.bottom <= viewportHeight ? complete : partial).push(anchor);
  }
  complete.sort((left, right) => left.top - right.top);
  partial.sort((left, right) => Math.abs(left.top) - Math.abs(right.top));
  return [...complete, ...partial];
}

function anchorForArticle(
  article: Element,
  priority: TimelineAnchor["priority"]
): TimelineAnchor | null {
  if (!article.isConnected) return null;
  const identity = articleIdentity(article);
  const rect = article.getBoundingClientRect();
  if (!identity || !Number.isFinite(rect.top) || rect.height < 4) return null;
  return { ...identity, top: rect.top, priority };
}

function articleIdentity(article: Element): Pick<TimelineAnchor, "tweetId" | "handle"> | null {
  const links = [
    ...Array.from(article.querySelectorAll<HTMLAnchorElement>('time')).map((time) => time.closest<HTMLAnchorElement>('a[href*="/status/"]')),
    ...Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
  ];
  for (const link of links) {
    if (!link || link.closest(ARTICLE_SELECTOR) !== article) continue;
    const match = /\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#]|$)/.exec(
      link.getAttribute("href") ?? ""
    );
    if (match?.[1] && match[2]) return { handle: match[1], tweetId: match[2] };
  }
  return null;
}

function queueRestore(_reason: string): void {
  cancelRestore("superseded");
  const state = readSnapshot();
  if (!state || state.route !== routeKey(location.href) || !isRestorableRoute(location.href)) return;
  const token = ++restoreToken;
  const intentAtStart = lastUserIntentAt;
  restoring = true;
  document.documentElement.dataset.avTimelineRestore = "restoring";
  restoreTimer = setTimeout(() => startRestore(state, token, intentAtStart), 35);
}

function startRestore(state: TimelineSnapshot, token: number, intentAtStart: number): void {
  restoreTimer = undefined;
  const startedAt = now();
  let lastCoarseAt = -Infinity;
  let stableFrames = 0;
  let anchorFoundAt: number | null = null;

  const frame = (): void => {
    if (
      !restoring ||
      token !== restoreToken ||
      state.route !== routeKey(location.href) ||
      intentAtStart !== lastUserIntentAt
    ) {
      finishRestore(token, false);
      return;
    }
    const elapsed = now() - startedAt;
    if (elapsed >= RESTORE_TIMEOUT_MS) {
      finishRestore(token, false);
      return;
    }

    const found = findAnchor(state.anchors);
    if (found) {
      anchorFoundAt ??= now();
      const error = found.element.getBoundingClientRect().top - found.anchor.top;
      if (Math.abs(error) > ANCHOR_TOLERANCE_PX) {
        stableFrames = 0;
        globalThis.scrollBy({ top: Math.round(error), left: 0, behavior: "auto" });
      } else {
        stableFrames += 1;
      }
      if (stableFrames >= STABLE_FRAMES && now() - anchorFoundAt >= 250) {
        finishRestore(token, true);
        return;
      }
    } else if (now() - lastCoarseAt >= COARSE_INTERVAL_MS) {
      lastCoarseAt = now();
      const maximum = Math.max(
        0,
        Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0) -
          (globalThis.innerHeight || document.documentElement.clientHeight || 0)
      );
      const target = Math.min(state.scrollY, maximum);
      if (Math.abs(globalThis.scrollY - target) > ANCHOR_TOLERANCE_PX) {
        globalThis.scrollTo({ top: target, left: 0, behavior: "auto" });
      } else if (elapsed >= 900 && maximum >= state.scrollY - ANCHOR_TOLERANCE_PX) {
        // A route can contain no stable post id, for example while X is replacing skeletons.
        // The saved absolute offset remains a useful fallback once the document is tall enough.
        finishRestore(token, true);
        return;
      }
    }
    restoreFrame = requestAnimationFrame(frame);
  };
  restoreFrame = requestAnimationFrame(frame);
}

function findAnchor(anchors: TimelineAnchor[]): { anchor: TimelineAnchor; element: Element } | null {
  for (const anchor of anchors) {
    let idFallback: Element | null = null;
    for (const article of Array.from(document.querySelectorAll<Element>(ARTICLE_SELECTOR))) {
      const identity = articleIdentity(article);
      if (identity?.tweetId !== anchor.tweetId) continue;
      if (anchor.handle && identity.handle?.toLowerCase() === anchor.handle.toLowerCase()) {
        return { anchor, element: article };
      }
      idFallback = article;
    }
    if (idFallback) return { anchor, element: idFallback };
  }
  return null;
}

function finishRestore(token: number, success: boolean): void {
  if (token !== restoreToken) return;
  restoring = false;
  restoreFrame = 0;
  suppressSaveUntil = Date.now() + POST_RESTORE_SAVE_DELAY_MS;
  delete document.documentElement.dataset.avTimelineRestore;
  if (success) restoredCount += 1;
  else failedCount += 1;
}

function cancelRestore(_reason: string): void {
  restoreToken += 1;
  if (restoreTimer !== undefined) {
    clearTimeout(restoreTimer);
    restoreTimer = undefined;
  }
  if (restoreFrame) {
    cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
  }
  restoring = false;
  delete document.documentElement.dataset.avTimelineRestore;
}

function writeSnapshot(state: TimelineSnapshot): void {
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${state.route}`, JSON.stringify(state));
  } catch (error) {
    activeContext?.diagnostics.warn("Timeline position could not be saved", errorDetails(error));
  }
}

function readSnapshot(): TimelineSnapshot | null {
  const route = routeKey(location.href);
  if (!route) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}${route}`) ?? "null") as
      Partial<TimelineSnapshot> | null;
    if (
      !parsed ||
      parsed.route !== route ||
      !Number.isFinite(parsed.scrollY) ||
      !Number.isFinite(parsed.savedAt) ||
      Date.now() - Number(parsed.savedAt) > MAX_AGE_MS
    ) {
      return null;
    }
    const anchors = Array.isArray(parsed.anchors)
      ? parsed.anchors.filter(isTimelineAnchor).slice(0, 6)
      : [];
    return {
      route,
      scrollY: Math.max(0, Number(parsed.scrollY)),
      savedAt: Number(parsed.savedAt),
      anchors
    };
  } catch (error) {
    activeContext?.diagnostics.warn("Timeline position could not be read", errorDetails(error));
    return null;
  }
}

function isTimelineAnchor(value: unknown): value is TimelineAnchor {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TimelineAnchor>;
  return typeof record.tweetId === "string" &&
    /^\d{1,25}$/.test(record.tweetId) &&
    Number.isFinite(record.top) &&
    (record.handle === null || typeof record.handle === "string") &&
    (record.priority === "clicked" || record.priority === "visible");
}

function routeKey(href: string): string {
  try {
    const url = new URL(href, location.href);
    const path = url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
    return `${path}${url.search}`;
  } catch {
    return "";
  }
}

function isRestorableRoute(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return false;
  }
  const path = url.pathname.length > 1 && url.pathname.endsWith("/")
    ? url.pathname.slice(0, -1)
    : url.pathname;
  if (path === "/home" || path.startsWith("/search") || path.startsWith("/notifications")) {
    return true;
  }
  if (/^\/[^/]+\/status\/\d{1,25}$/.test(path)) return true;
  const profile = /^\/([^/]+)(?:\/(?:with_replies|media|likes|highlights|articles|reposts))?$/.exec(path);
  return Boolean(profile?.[1] && !ROOT_ROUTE_EXCLUSIONS.has(profile[1].toLowerCase()));
}

function teardown(resetCounts: boolean): void {
  detachListeners();
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  cancelRestore("teardown");
  suppressSaveUntil = 0;
  activeContext = undefined;
  if (resetCounts) {
    restoredCount = 0;
    failedCount = 0;
    initialNavigationHandled = false;
  }
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { message: String(error) };
}
