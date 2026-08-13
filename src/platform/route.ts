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

export function watchRoute(onRoute: (route: RouteState) => void): () => void {
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
