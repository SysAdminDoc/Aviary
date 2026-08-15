export type RouteSurface =
  | "home"
  | "status"
  | "profile"
  | "notifications"
  | "messages"
  | "settings"
  | "search"
  | "grok"
  | "unknown";

export interface RouteState {
  href: string;
  path: string;
  surface: RouteSurface;
}

export function readRoute(location: Location = globalThis.location): RouteState {
  const path = location.pathname;
  return {
    href: location.href,
    path,
    surface: detectSurface(path)
  };
}

interface NavigationLike {
  addEventListener(type: "navigatesuccess", listener: () => void): void;
  removeEventListener(type: "navigatesuccess", listener: () => void): void;
}

/**
 * The Navigation API reports SPA route changes directly, so nothing has to be monkey-patched.
 * It reached Baseline in January 2026 (Chrome, Firefox 147, Safari 26.2), but this build still
 * ships to browsers below that, and a userscript manager can run in an older engine — so the
 * History patch stays as the fallback rather than being replaced.
 */
function navigationApi(): NavigationLike | undefined {
  const candidate = (globalThis as { navigation?: unknown }).navigation;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const nav = candidate as Partial<NavigationLike>;
  return typeof nav.addEventListener === "function" && typeof nav.removeEventListener === "function"
    ? (candidate as NavigationLike)
    : undefined;
}

export function watchRoute(onRoute: (route: RouteState) => void): () => void {
  const navigation = navigationApi();
  if (navigation) {
    let lastHref = globalThis.location.href;
    const onNavigate = (): void => {
      if (globalThis.location.href === lastHref) {
        return;
      }
      lastHref = globalThis.location.href;
      onRoute(readRoute());
    };
    navigation.addEventListener("navigatesuccess", onNavigate);
    return () => navigation.removeEventListener("navigatesuccess", onNavigate);
  }

  const history = globalThis.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const callOriginalPush = originalPush.bind(history);
  const callOriginalReplace = originalReplace.bind(history);
  let lastHref = globalThis.location.href;

  const emitIfChanged = (): void => {
    if (globalThis.location.href === lastHref) {
      return;
    }
    lastHref = globalThis.location.href;
    onRoute(readRoute());
  };

  const patchedPush = (...args: Parameters<History["pushState"]>): void => {
    callOriginalPush(...args);
    queueMicrotask(emitIfChanged);
  };

  const patchedReplace = (...args: Parameters<History["replaceState"]>): void => {
    callOriginalReplace(...args);
    queueMicrotask(emitIfChanged);
  };

  try {
    history.pushState = patchedPush;
    history.replaceState = patchedReplace;
  } catch {
    // Some hardened browsers can make History methods non-writable.
  }

  globalThis.addEventListener("popstate", emitIfChanged);

  return () => {
    try {
      if (history.pushState === patchedPush) {
        history.pushState = originalPush;
      }
      if (history.replaceState === patchedReplace) {
        history.replaceState = originalReplace;
      }
    } catch {
      // Keep teardown best-effort in hardened or multiply patched browsers.
    }
    globalThis.removeEventListener("popstate", emitIfChanged);
  };
}

function detectSurface(path: string): RouteSurface {
  if (path === "/home") return "home";
  if (/\/status\/\d+/.test(path)) return "status";
  if (path.startsWith("/notifications")) return "notifications";
  // X moved Direct Messages from /messages to /i/chat in 2026. Keep both contracts so saved
  // links and older fixtures remain valid while current nested recovery/conversation routes work.
  if (path.startsWith("/messages") || path.startsWith("/i/chat")) return "messages";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/search")) return "search";
  if (path.startsWith("/i/grok")) return "grok";
  if (
    /^\/[^/]+(?:\/(?:followers|following|verified_followers|with_replies|media|likes|highlights|articles))\/?$/.test(
      path
    )
  ) {
    return "profile";
  }
  if (/^\/[^/]+\/?$/.test(path)) return "profile";
  return "unknown";
}
