import {
  PAGE_CHANNEL,
  installPageAgent,
  type PageAgentConfig,
  type PageAgentEnvelope,
  type PageAgentKind,
  type PageAgentTarget
} from "../page/page-agent";
import type { Diagnostics } from "./diagnostics";

/**
 * The isolated-world half of the page bridge.
 *
 * Reaching the page's own `fetch` takes a different route per artifact, and the two are not
 * interchangeable:
 *
 *   - extension: `page.js` is declared in the manifest with `"world": "MAIN"`, so the browser has
 *     already run it by the time we get here. We handshake over `postMessage` and wait for `ready`.
 *   - userscript: `unsafeWindow` is a live reference to the page's window, so we install the agent
 *     ourselves and take delivery through a direct callback.
 *
 * When neither route is available -- an old userscript manager, a `@grant`-less install, a browser
 * that ignores `world` -- `status` stays `"unavailable"` and every dependent feature says so out
 * loud. That matters more here than usual: the three features this bridge exists to serve were
 * each, at some point, shipped in a state where they reported success while doing nothing.
 */

export type PageScopeStatus = "unavailable" | "connecting" | "connected";

/**
 * Why page scope is unavailable, as a code rather than a sentence.
 *
 * The platform layer has no locale and no access to `t()`, so a sentence built here would render
 * in English in every translated build. The Control Center owns the wording.
 */
export type PageScopeReason = "" | "no-page-scope" | "agent-absent" | "torn-down";

export type PageEventHandler = (payload: unknown) => void;

export interface PageBridge {
  status(): PageScopeStatus;
  reason(): PageScopeReason;
  configure(config: PageAgentConfig): void;
  on(kind: PageAgentKind, handler: PageEventHandler): void;
  destroy(): void;
}

/** How long the extension build waits for `page.js` to answer before declaring it absent. */
const HANDSHAKE_TIMEOUT_MS = 3000;

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

/**
 * Returns the page's window when the sandbox can genuinely reach it.
 *
 * The identity check is the whole point: managers that do not grant page scope define
 * `unsafeWindow` as an alias of the sandbox's own `window`, and patching that would produce a
 * feature that installs cleanly, reports itself healthy, and never sees a single request.
 */
function pageWindowFromSandbox(): PageAgentTarget | undefined {
  try {
    if (typeof unsafeWindow === "undefined" || !unsafeWindow) {
      return undefined;
    }
    if ((unsafeWindow as unknown) === (globalThis as unknown)) {
      return undefined;
    }
    if (typeof unsafeWindow.fetch !== "function") {
      return undefined;
    }
    return unsafeWindow as unknown as PageAgentTarget;
  } catch {
    return undefined;
  }
}

export function createPageBridge(options: {
  source: "userscript" | "extension";
  diagnostics: Diagnostics;
}): PageBridge {
  const handlers = new Map<PageAgentKind, Set<PageEventHandler>>();
  let status: PageScopeStatus = "connecting";
  let reason: PageScopeReason = "";
  let lastConfig: PageAgentConfig | undefined;
  let uninstallAgent: (() => void) | undefined;
  let windowListener: ((event: MessageEvent) => void) | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(envelope: PageAgentEnvelope): void {
    if (envelope.kind === "ready") {
      if (status !== "connected") {
        status = "connected";
        reason = "";
        options.diagnostics.info("Page bridge connected", { source: options.source });
        if (lastConfig) {
          send({ channel: PAGE_CHANNEL, kind: "config", payload: lastConfig });
        }
      }
      return;
    }
    const set = handlers.get(envelope.kind);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        handler(envelope.payload);
      } catch (error) {
        options.diagnostics.error("Page bridge handler failed", {
          kind: envelope.kind,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  let send: (envelope: PageAgentEnvelope) => void = () => {};

  if (options.source === "userscript") {
    const target = pageWindowFromSandbox();
    if (!target) {
      status = "unavailable";
      reason = "no-page-scope";
    } else {
      uninstallAgent = installPageAgent(target, dispatch);
      send = (envelope) => {
        // The agent listens on the page window; posting there reaches it under every manager.
        try {
          target.postMessage(envelope, "*");
        } catch {
          // handled by the ready-timeout path
        }
      };
      status = "connected";
    }
  } else {
    windowListener = (event: MessageEvent): void => {
      if (event.source !== globalThis.window) {
        return;
      }
      const data = event.data as PageAgentEnvelope | undefined;
      if (!data || data.channel !== PAGE_CHANNEL) {
        return;
      }
      dispatch(data);
    };
    globalThis.addEventListener("message", windowListener as EventListener);
    send = (envelope) => {
      try {
        globalThis.postMessage(envelope, globalThis.location?.origin ?? "*");
      } catch {
        // handled by the ready-timeout path
      }
    };
    send({ channel: PAGE_CHANNEL, kind: "hello" });
    handshakeTimer = setTimeout(() => {
      if (status !== "connected") {
        status = "unavailable";
        reason = "agent-absent";
        options.diagnostics.warn("Page bridge handshake timed out");
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }

  return {
    status: () => status,
    reason: () => reason,
    configure(config) {
      lastConfig = config;
      if (status === "unavailable") {
        return;
      }
      send({ channel: PAGE_CHANNEL, kind: "config", payload: config });
    },
    on(kind, handler) {
      const set = handlers.get(kind) ?? new Set<PageEventHandler>();
      set.add(handler);
      handlers.set(kind, set);
    },
    destroy() {
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
      }
      if (status === "connected") {
        send({ channel: PAGE_CHANNEL, kind: "teardown" });
      }
      uninstallAgent?.();
      uninstallAgent = undefined;
      if (windowListener) {
        globalThis.removeEventListener("message", windowListener as EventListener);
        windowListener = undefined;
      }
      handlers.clear();
      status = "unavailable";
      reason = "torn-down";
    }
  };
}
