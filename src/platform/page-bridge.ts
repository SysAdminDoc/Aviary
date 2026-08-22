import {
  PAGE_CHANNEL,
  installPageAgent,
  isPageAgentEnvelope,
  sanitizeCapturedGraphqlPayload,
  type PageAgentConfig,
  type PageAgentEnvelope,
  type PageAgentKind,
  type PageAgentTarget
} from "../page/page-agent.ts";
import type { Diagnostics } from "./diagnostics.ts";

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
export type PageScopeReason =
  | ""
  | "no-page-scope"
  | "agent-absent"
  /** An agent is present and already bound to a channel this bridge does not hold. */
  | "agent-taken"
  | "torn-down";

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


/**
 * A control channel the page cannot observe or write to.
 *
 * The handshake still starts on the window, because that is the only place the page-world agent can
 * be reached from -- but the `hello` carries a transferred `MessagePort`, and everything after it
 * travels over that port. A `MessagePort` is not readable from the page and cannot be posted to
 * without the reference, so the nonce stops being load-bearing: catching an envelope no longer lets
 * a page script replay `config` to switch the default-on ad guard off, or `teardown` to remove the
 * agent. Hosts without transferables fall back to the window, which is what shipped before.
 */
interface ControlChannel {
  port: MessagePort;
  transfer: MessagePort;
  post(envelope: PageAgentEnvelope): void;
  close(): void;
}

function openControlChannel(onMessage: (value: unknown) => void): ControlChannel | undefined {
  const Channel = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel;
  if (typeof Channel !== "function") {
    return undefined;
  }
  let channel: MessageChannel;
  try {
    channel = new Channel();
  } catch {
    return undefined;
  }
  channel.port1.onmessage = (event: MessageEvent) => {
    onMessage(event.data);
  };
  channel.port1.start?.();
  return {
    port: channel.port1,
    transfer: channel.port2,
    post(envelope) {
      try {
        channel.port1.postMessage(envelope);
      } catch {
        // handled by the ready-timeout path
      }
    },
    close() {
      channel.port1.onmessage = null;
      try {
        channel.port1.close();
      } catch {
        // already neutered
      }
    }
  };
}

export function createPageBridge(options: {
  source: "userscript" | "extension";
  diagnostics: Diagnostics;
}): PageBridge {
  const handlers = new Map<PageAgentKind, Set<PageEventHandler>>();
  const sessionNonce = createSessionNonce();
  let status: PageScopeStatus = "connecting";
  let reason: PageScopeReason = "";
  let lastConfig: PageAgentConfig | undefined;
  let uninstallAgent: (() => void) | undefined;
  let controlChannel: ControlChannel | undefined;
  let windowListener: ((event: MessageEvent) => void) | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRejectedAt = 0;

  function rejectMessage(reason: string): void {
    const now = Date.now();
    if (now - lastRejectedAt < 1000) {
      return;
    }
    lastRejectedAt = now;
    options.diagnostics.warn("Page bridge rejected an untrusted message", { reason });
  }

  function dispatch(value: unknown): void {
    if (!isPageAgentEnvelope(value)) {
      rejectMessage("invalid envelope");
      return;
    }
    const envelope = value;
    if (envelope.nonce !== sessionNonce) {
      return;
    }
    if (envelope.kind === "refused") {
      // An agent is here and already answering somebody else. Reported rather than left to the
      // handshake timeout, which says "this browser did not load Aviary's page script" -- the one
      // thing that is definitely not true. See the note in page-agent.ts: this is a diagnostic,
      // not a security control, and the page can forge it.
      if (status !== "connected") {
        clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
        status = "unavailable";
        reason = "agent-taken";
        options.diagnostics.warn("Page agent is already bound to another channel", {
          source: options.source
        });
      }
      return;
    }
    if (envelope.kind === "ready") {
      if (status !== "connected") {
        status = "connected";
        reason = "";
        options.diagnostics.info("Page bridge connected", { source: options.source });
        if (lastConfig) {
          send(makeEnvelope("config", lastConfig));
        }
      }
      return;
    }
    let payload = envelope.payload;
    if (envelope.kind === "graphql") {
      const sanitized = sanitizeCapturedGraphqlPayload(payload, globalThis.location?.origin);
      if (!sanitized) {
        rejectMessage("invalid GraphQL payload");
        return;
      }
      payload = sanitized;
    }
    const set = handlers.get(envelope.kind);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        options.diagnostics.error("Page bridge handler failed", {
          kind: envelope.kind,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  let send: (envelope: PageAgentEnvelope) => void = () => {
    // No page-scope transport is available until a supported source is installed below.
  };

  if (options.source === "userscript") {
    const target = pageWindowFromSandbox();
    if (!target) {
      status = "unavailable";
      reason = "no-page-scope";
    } else {
      uninstallAgent = installPageAgent(target, dispatch);
      const channel = openControlChannel(dispatch);
      send = (envelope) => {
        if (channel) {
          channel.post(envelope);
          return;
        }
        // Fallback for a host without transferables: the agent still listens on the page window.
        try {
          target.postMessage(envelope, "*");
        } catch {
          // handled by the ready-timeout path
        }
      };
      controlChannel = channel;
      sendHello(target, "*", channel);
    }
  } else {
    windowListener = (event: MessageEvent): void => {
      if (event.source && event.source !== globalThis.window) {
        return;
      }
      const expectedOrigin = globalThis.location?.origin;
      if (event.origin && event.origin !== "null" && expectedOrigin && event.origin !== expectedOrigin) {
        return;
      }
      dispatch(event.data);
    };
    globalThis.addEventListener("message", windowListener as EventListener);
    const channel = openControlChannel(dispatch);
    send = (envelope) => {
      if (channel) {
        channel.post(envelope);
        return;
      }
      try {
        globalThis.postMessage(envelope, globalThis.location?.origin ?? "*");
      } catch {
        // handled by the ready-timeout path
      }
    };
    controlChannel = channel;
    sendHello(
      globalThis as unknown as { postMessage(data: unknown, origin: string, transfer?: unknown[]): void },
      globalThis.location?.origin ?? "*",
      channel
    );
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
      send(makeEnvelope("config", config));
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
        send(makeEnvelope("teardown"));
      }
      uninstallAgent?.();
      uninstallAgent = undefined;
      if (windowListener) {
        globalThis.removeEventListener("message", windowListener as EventListener);
        windowListener = undefined;
      }
      controlChannel?.close();
      controlChannel = undefined;
      handlers.clear();
      status = "unavailable";
      reason = "torn-down";
    }
  };

  /**
   * Starts the handshake on the window and hands the private port over with it. The `hello` is the
   * only control envelope the page can see; everything after it rides the transferred port.
   */
  function sendHello(
    target: { postMessage(data: unknown, origin: string, transfer?: unknown[]): void },
    targetOrigin: string,
    channel: ControlChannel | undefined
  ): void {
    const envelope = makeEnvelope("hello");
    try {
      if (channel) {
        target.postMessage(envelope, targetOrigin, [channel.transfer]);
        return;
      }
      target.postMessage(envelope, targetOrigin);
    } catch {
      // handled by the ready-timeout path
    }
  }

  function makeEnvelope(kind: PageAgentKind, payload?: unknown): PageAgentEnvelope {
    return {
      channel: PAGE_CHANNEL,
      kind,
      nonce: sessionNonce,
      ...(payload === undefined ? {} : { payload })
    };
  }
}

function createSessionNonce(): string {
  try {
    const values = new Uint32Array(4);
    globalThis.crypto?.getRandomValues(values);
    if (values.some((value) => value !== 0)) {
      return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
    }
  } catch {
    // Fall through to a best-effort value for hardened manager environments without Web Crypto.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
