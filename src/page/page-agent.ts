/**
 * The page-world half of Aviary.
 *
 * Everything else in this codebase runs in the isolated world: the extension content script has no
 * `"world": "MAIN"` entry, and the userscript is granted `GM_*`, which sandboxes it the same way.
 * Both therefore hold their *own* copies of `fetch`, `XMLHttpRequest` and `navigator.sendBeacon`,
 * and X's own requests never pass through them. Three features were designed against a world the
 * content script cannot reach; this module is that world.
 *
 * It is deliberately dependency-free and DOM-free. It receives a target window and patches that
 * object, which is what lets one implementation serve both artifacts:
 *
 *   - extension: a second content script declared with `"world": "MAIN"`, patching its own `window`
 *   - userscript: the sandbox patching `unsafeWindow`, a live reference to the page's window
 *
 * Default-on protections and media metadata capture start immediately; persisted settings replace
 * that boot configuration as soon as the isolated world connects. Every hook falls through to the
 * original on any internal error, and `uninstallPageAgent` restores the exact references it
 * replaced.
 */

export const PAGE_CHANNEL = "aviary.page.v1";

export type PageAgentKind =
  | "hello"
  | "refused"
  | "ready"
  | "config"
  | "graphql"
  | "blocked"
  | "playlist"
  | "teardown";

export interface PageAgentConfig {
  blockAds: boolean;
  blockBeacons: boolean;
  captureGraphql: boolean;
  captureMediaMetadata: boolean;
  forceVideoQuality: boolean;
}

export interface PageAgentEnvelope {
  channel: typeof PAGE_CHANNEL;
  kind: PageAgentKind;
  /** Per-install capability negotiated by the isolated world. */
  nonce?: string;
  payload?: unknown;
}

export interface CapturedGraphqlPayload {
  url: string;
  operation: string;
  status: number;
  bytes: number;
  at: string;
  body?: string;
}

export interface SanitizedCapturedGraphqlPayload extends CapturedGraphqlPayload {
  body: string;
  /** True when the page agent dropped the body because it exceeded the cap. */
  truncated?: boolean;
  /** The size the response actually was, present only when `truncated`. */
  originalBytes?: number;
}

export interface BlockedBeaconPayload {
  url: string;
  via: "fetch" | "xhr" | "sendBeacon";
  at: string;
  category: "ad" | "analytics";
}

export interface PlaylistRewritePayload {
  url: string;
  variantsBefore: number;
  at: string;
}

/** Mirrors the isolated-world cap so a hostile response cannot grow the message channel. */
export const MAX_GRAPHQL_PAYLOAD_BYTES = 1_500_000;

const PAGE_AGENT_KINDS = new Set<PageAgentKind>([
  "hello",
  "refused",
  "ready",
  "config",
  "graphql",
  "blocked",
  "playlist",
  "teardown"
]);
const MAX_NONCE_LENGTH = 256;
const X_GRAPHQL_HOSTNAMES = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "pro.x.com",
]);
const GRAPHQL_PATH_PATTERN = /^\/i\/api\/graphql\/([A-Za-z0-9_-]{1,200})\/([A-Za-z0-9_-]{1,100})$/;

/** Rejects arbitrary page objects before they can be interpreted as bridge messages. */
export function isPageAgentEnvelope(value: unknown): value is PageAgentEnvelope {
  if (!isRecord(value) || value.channel !== PAGE_CHANNEL || typeof value.kind !== "string") {
    return false;
  }
  if (!PAGE_AGENT_KINDS.has(value.kind as PageAgentKind)) {
    return false;
  }
  return (
    value.nonce === undefined ||
    (typeof value.nonce === "string" && value.nonce.length >= 16 && value.nonce.length <= MAX_NONCE_LENGTH)
  );
}

/**
 * Converts a page-visible GraphQL event into a bounded, same-origin value.
 *
 * The nonce is a session correlation value, not a cryptographic signature: page scripts can observe
 * postMessage traffic. This validator is therefore the actual trust boundary for the isolated
 * world, and it intentionally returns a fresh object rather than passing the page-owned object on.
 */
export function sanitizeCapturedGraphqlPayload(
  value: unknown,
  expectedOrigin?: string
): SanitizedCapturedGraphqlPayload | null {
  if (!isRecord(value)) {
    return null;
  }
  const url = typeof value.url === "string" ? value.url : "";
  const route = parseGraphqlRoute(url, expectedOrigin);
  if (!route || value.operation !== route.operation) {
    return null;
  }
  const status = value.status;
  if (typeof status !== "number" || !Number.isSafeInteger(status) || status < 100 || status > 599) {
    return null;
  }
  // A truncated payload carries no body, so it reports zero bytes; everything else must report a
  // real size inside the cap. Both are well-formed -- neither is a reason to distrust the sender.
  const truncated = value.truncated === true;
  const bytes = value.bytes;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes)) {
    return null;
  }
  if (truncated ? bytes !== 0 : bytes <= 0 || bytes > MAX_GRAPHQL_PAYLOAD_BYTES) {
    return null;
  }
  const at = typeof value.at === "string" ? value.at : "";
  if (at.length === 0 || at.length > 80 || !Number.isFinite(Date.parse(at))) {
    return null;
  }
  const body = value.body;
  if (typeof body !== "string") {
    return null;
  }
  const encoded = new TextEncoder().encode(body);
  if (encoded.byteLength !== bytes) {
    return null;
  }
  try {
    if (new TextDecoder("utf-8", { fatal: true }).decode(encoded) !== body) {
      return null;
    }
  } catch {
    return null;
  }
  if (truncated) {
    const originalBytes = value.originalBytes;
    return {
      url: route.href,
      operation: route.operation,
      status,
      bytes,
      at,
      body: "",
      truncated: true,
      ...(typeof originalBytes === "number" && Number.isSafeInteger(originalBytes) && originalBytes > 0
        ? { originalBytes }
        : {})
    };
  }
  return { url: route.href, operation: route.operation, status, bytes, at, body };
}

/**
 * Telemetry endpoints only.
 *
 * X's analytics traffic is the `jot` family under `/i/api/<version>/jot/` plus the standalone
 * analytics host. GraphQL lives at `/i/api/graphql/`, which none of these can match -- that
 * separation is asserted directly in tests/page-agent.test.mjs, because a matcher that is one
 * character too greedy here would silently break the timeline rather than fail a check.
 */
const TELEMETRY_PATTERNS: RegExp[] = [
  /\/i\/api\/[^/]+\/jot(?:\/|$)/i,
  /\/i\/api\/[^/]+\/jot\.json(?:$|\?)/i,
  /^https?:\/\/analytics\.twitter\.com\//i
];

export function isTelemetryUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  return TELEMETRY_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * The only ad request live recon proved separable from timeline delivery.
 *
 * Sponsored records themselves arrive inside HomeTimeline GraphQL responses, so blocking that
 * transport would blank organic content too. X sends impression/click bookkeeping separately to
 * this exact first-party endpoint; refusing it cannot intercept login, timeline, media, or action
 * traffic. Keep this matcher deliberately narrower than the DOM detector.
 */
export function isAdRequestUrl(rawUrl: string): boolean {
  if (!rawUrl) {
    return false;
  }
  try {
    const url = new URL(rawUrl, "https://x.com");
    return (
      X_GRAPHQL_HOSTNAMES.has(url.hostname.toLowerCase()) &&
      url.pathname === "/i/api/1.1/promoted_content/log.json"
    );
  } catch {
    return false;
  }
}

/**
 * Finishes a refused XMLHttpRequest the way a failed network request finishes: readyState DONE,
 * status 0, then `readystatechange`, `error`, and `loadend`. Every field is written defensively --
 * a real XHR's readyState and status are read-only accessors, so this defines them on the instance
 * and gives up quietly if the object refuses, which is no worse than the previous behaviour.
 */
function completeAsNetworkError(xhr: Record<string, unknown>): void {
  const define = (name: string, value: unknown): void => {
    try {
      Object.defineProperty(xhr, name, { configurable: true, value });
    } catch {
      // A frozen or exotic XHR keeps whatever it had; the events below still fire.
    }
  };
  define("readyState", 4);
  define("status", 0);
  define("statusText", "");
  define("responseText", "");
  define("response", "");

  const dispatch = (type: string): void => {
    try {
      const handler = xhr[`on${type}`];
      if (typeof handler === "function") {
        (handler as (event: unknown) => void).call(xhr, { type, target: xhr });
      }
      const dispatchEvent = xhr.dispatchEvent;
      if (typeof dispatchEvent === "function" && typeof ProgressEvent === "function") {
        (dispatchEvent as (event: unknown) => boolean).call(xhr, new ProgressEvent(type));
      }
    } catch {
      // One listener throwing must not stop the remaining events.
    }
  };
  dispatch("readystatechange");
  dispatch("error");
  dispatch("loadend");
}

export function isGraphqlUrl(url: string): boolean {
  return parseGraphqlRoute(url) !== null;
}

export function graphqlOperationName(url: string): string {
  return parseGraphqlRoute(url)?.operation ?? "unknown";
}

/**
 * Rewrites an HLS master playlist down to its highest-bandwidth rendition.
 *
 * X plays timeline video through Media Source Extensions, so there is no `src` to rewrite and no
 * `<source>` list to re-rank -- the choice is made by the player's own adaptive-bitrate logic over
 * a manifest it fetches itself. Removing every rendition but the best one from that manifest is
 * the only lever that exists, and it works precisely because the player still believes it is
 * choosing freely.
 *
 * Returns `undefined` when the text is not a master playlist (a media playlist has no
 * `EXT-X-STREAM-INF` lines) or when there is nothing to remove, so callers pass the original
 * response through untouched rather than serving a rebuilt one.
 */
export function rewritePlaylistToBestVariant(text: string):
  | { playlist: string; variantsBefore: number }
  | undefined {
  if (!text.includes("#EXT-X-STREAM-INF")) {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  const header: string[] = [];
  const variants: Array<{ bandwidth: number; lines: string[] }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("#EXT-X-STREAM-INF")) {
      if (variants.length === 0) {
        header.push(line);
      }
      continue;
    }

    // A stream-inf tag is followed by its URI on the next non-empty line.
    const uriIndex = nextUriIndex(lines, index + 1);
    if (uriIndex === -1) {
      continue;
    }
    variants.push({
      bandwidth: parseBandwidth(line),
      lines: [line, lines[uriIndex] ?? ""]
    });
    index = uriIndex;
  }

  const best = variants.reduce<{ bandwidth: number; lines: string[] } | undefined>(
    (winner, variant) => (winner && winner.bandwidth >= variant.bandwidth ? winner : variant),
    undefined
  );

  if (variants.length < 2 || !best) {
    return undefined;
  }

  const trimmedHeader = [...header];
  while (trimmedHeader.length > 0 && (trimmedHeader[trimmedHeader.length - 1] ?? "").trim() === "") {
    trimmedHeader.pop();
  }

  return {
    playlist: [...trimmedHeader, ...best.lines, ""].join("\n"),
    variantsBefore: variants.length
  };
}

function nextUriIndex(lines: string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    const candidate = (lines[index] ?? "").trim();
    if (candidate === "") {
      continue;
    }
    if (candidate.startsWith("#")) {
      return -1;
    }
    return index;
  }
  return -1;
}

function parseBandwidth(line: string): number {
  const average = /AVERAGE-BANDWIDTH=(\d+)/i.exec(line);
  const peak = /[^-]BANDWIDTH=(\d+)/i.exec(` ${line}`);
  const value = average?.[1] ?? peak?.[1];
  return value ? Number.parseInt(value, 10) : 0;
}

function isPlaylistUrl(url: string): boolean {
  return /\.m3u8(?:$|\?)/i.test(url);
}

/** The subset of `window` the agent needs, so tests can pass a plain object. */
export interface PageAgentTarget {
  fetch: typeof fetch;
  navigator: { sendBeacon?: (url: string, data?: unknown) => boolean };
  XMLHttpRequest?: {
    prototype: {
      open: (...args: unknown[]) => void;
      send: (...args: unknown[]) => void;
    };
  };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  location?: { origin?: string };
}

const INITIAL_CONFIG: PageAgentConfig = {
  // Page scripts run at document_start. Default-on work must be active before the isolated world
  // finishes opening storage; persisted opt-outs replace these values during config. In
  // particular, X's first timeline response contains the direct MP4 variants and then leaves only
  // a MediaSource `blob:` URL in the DOM, so starting media capture later cannot recover it.
  blockAds: true,
  blockBeacons: false,
  captureGraphql: false,
  captureMediaMetadata: true,
  forceVideoQuality: false
};

interface AgentState {
  config: PageAgentConfig;
  peerNonce: string | undefined;
  target: PageAgentTarget;
  originalFetch: typeof fetch;
  originalSendBeacon: ((url: string, data?: unknown) => boolean) | undefined;
  originalXhrOpen: ((...args: unknown[]) => void) | undefined;
  originalXhrSend: ((...args: unknown[]) => void) | undefined;
  messageListener: (event: unknown) => void;
  sink: PageAgentSink | undefined;
  /**
   * The private control channel, once the isolated world has handed one over.
   *
   * The nonce was only ever a session correlation value, and it rides every envelope on a bus the
   * page can read -- so any page script that caught one could replay `config` to switch the
   * default-on ad guard off, or `teardown` to remove the agent outright. A transferred
   * `MessagePort` is not readable or postable from the page at all, so once one is adopted the
   * window is no longer accepted as a source of control messages.
   */
  controlPort: MessagePort | undefined;
  /**
   * The wrappers this agent installed. Teardown compares against these so it restores only what is
   * still ours -- assigning the original back over someone else's later wrapper would delete their
   * layer along with ours.
   */
  patchedFetch?: typeof fetch;
  patchedSendBeacon?: (url: string, data?: unknown) => boolean;
  patchedXhrOpen?: (...args: unknown[]) => void;
  patchedXhrSend?: (...args: unknown[]) => void;
}

/**
 * Optional direct delivery, used by the userscript build.
 *
 * The extension's agent is a separate script in a separate world and can only reach the isolated
 * world through `postMessage`. The userscript's sandbox, by contrast, already holds a live
 * reference to the page window, so it hands the agent a callback instead of assuming the sandbox
 * and the page share a `message` event target -- which is manager-specific and not worth betting
 * the feature on.
 */
export type PageAgentSink = (envelope: PageAgentEnvelope) => void;

/**
 * Tells a `hello` that arrived too late that an agent is here and already spoken for.
 *
 * Without this the refusal is silent, and the isolated world cannot tell "no page script loaded"
 * from "a page script loaded and something else is holding its channel". Both end as a three-second
 * timeout, and the first is an ordinary compatibility message while the second means Aviary's
 * default-on ad guard is under someone else's control.
 *
 * Deliberately posted on the window rather than the private port: the whole point is to reach a
 * caller that has no port. That also means a page script can forge one, which is why the isolated
 * world treats it as a *warning about* the boundary and never as a security decision -- see the
 * note on `installPageAgent`.
 */
function refuseHello(nonce: string): void {
  const target = state?.target;
  if (!target || typeof target.postMessage !== "function") {
    return;
  }
  // An opaque origin serializes as the string "null", which postMessage rejects as a target.
  const origin = target.location?.origin;
  try {
    target.postMessage(
      { channel: PAGE_CHANNEL, kind: "refused", nonce, payload: undefined },
      origin && origin !== "null" ? origin : "*"
    );
  } catch {
    // A host that will not accept the post leaves the caller on its timeout, as before.
  }
}

let state: AgentState | undefined;

/**
 * Installs the agent on `target` and returns a teardown function.
 *
 * Installation patches the request functions, but each path checks the current configuration
 * before doing work. The isolated world replaces the boot defaults by posting a `config` envelope,
 * so persisted opt-outs take effect as soon as settings finish loading.
 *
 * ## What the handshake does and does not defend
 *
 * This boundary is **not cryptographic**, and nothing here should be read as if it were. The agent
 * runs in the page's own world, so any script in that world can read its code, its state, and every
 * envelope on the window. What the design buys is narrower and worth stating exactly:
 *
 * - Once a `hello` is adopted its `MessagePort` becomes the only control surface. A page script
 *   cannot obtain a reference to a transferred port it did not receive, so replaying a captured
 *   `config` (to switch the default-on ad guard off) or a `teardown` no longer works. Before the
 *   port, the nonce rode every envelope on a bus the page could read, which made it useless as a
 *   secret.
 * - A later `hello` cannot displace a standing channel, so a script that arrives after the isolated
 *   world cannot take the agent over.
 * - A script that wins the *first* `hello` does own the agent. Nothing here prevents that: the
 *   agent has no way to authenticate its peer, and inventing one would be theatre. What it can do
 *   is refuse the real bridge audibly rather than silently, which is what `refused` is for. The
 *   practical reach is narrow -- `document_start` content scripts run before any page script, so
 *   only another extension's MAIN-world script can win that race.
 * - `refused` is itself forgeable by the page. It downgrades a diagnostic message, never a
 *   decision: the isolated world stops waiting and reports what it saw, and every control path
 *   still requires the port.
 */
export function installPageAgent(target: PageAgentTarget, sink?: PageAgentSink): () => void {
  if (state) {
    return () => uninstallPageAgent();
  }

  const originalFetch = target.fetch;
  const originalSendBeacon = target.navigator?.sendBeacon;
  const xhrProto = target.XMLHttpRequest?.prototype;

  const messageListener = (event: unknown): void => {
    const message = event as { data?: unknown; source?: unknown; origin?: unknown; ports?: unknown };
    if (message.source !== undefined && message.source !== target) {
      return;
    }
    const expectedOrigin = target.location?.origin;
    if (
      typeof message.origin === "string" &&
      message.origin.length > 0 &&
      message.origin !== "null" &&
      expectedOrigin &&
      message.origin !== expectedOrigin
    ) {
      return;
    }
    if (!isPageAgentEnvelope(message.data)) {
      return;
    }
    const data = message.data;
    if (data.kind === "hello") {
      const nonce = typeof data.nonce === "string" ? data.nonce : "";
      if (nonce.length < 16) {
        return;
      }
      // A control port already stands, so this hello is either a duplicate or a squatter. Either
      // way the standing channel is the one the isolated world holds; do not let a later hello
      // replace it.
      if (state?.controlPort) {
        if (state.peerNonce !== nonce) {
          refuseHello(nonce);
        }
        return;
      }
      if (state?.peerNonce && state.peerNonce !== nonce) {
        refuseHello(nonce);
        return;
      }
      if (state) {
        state.peerNonce = nonce;
        const port = readTransferredPort(message);
        if (port) {
          adoptControlPort(port);
        }
      }
      emit("ready");
      return;
    }
    // Once a private channel exists, the window is not a control surface any more.
    if (state?.controlPort) {
      return;
    }
    if (!state?.peerNonce || data.nonce !== state.peerNonce) {
      return;
    }
    handleControlEnvelope(data);
  };

  state = {
    config: { ...INITIAL_CONFIG },
    peerNonce: undefined,
    controlPort: undefined,
    target,
    originalFetch,
    originalSendBeacon,
    originalXhrOpen: xhrProto?.open,
    originalXhrSend: xhrProto?.send,
    messageListener,
    sink
  };

  target.addEventListener("message", messageListener);
  target.fetch = makePatchedFetch(originalFetch, target.location?.origin);
  state.patchedFetch = target.fetch;

  if (originalSendBeacon && target.navigator) {
    target.navigator.sendBeacon = function patchedSendBeacon(url: string, data?: unknown): boolean {
      try {
        const category = blockedRequestCategory(state?.config ?? INITIAL_CONFIG, String(url));
        if (category) {
          emit("blocked", { url: String(url), via: "sendBeacon", at: now(), category });
          // Report success: a refused beacon must look delivered, or X's client retries it.
          return true;
        }
      } catch {
        // fall through to the original
      }
      return originalSendBeacon.call(target.navigator, url, data);
    };
    state.patchedSendBeacon = target.navigator.sendBeacon;
  }

  if (xhrProto && state.originalXhrOpen && state.originalXhrSend) {
    const originalOpen = state.originalXhrOpen;
    const originalSend = state.originalXhrSend;
    xhrProto.open = function patchedOpen(this: Record<string, unknown>, ...args: unknown[]): void {
      try {
        this.__aviaryUrl = requestUrl(String(args[1] ?? ""), target.location?.origin);
      } catch {
        // a frozen XHR instance is not worth failing the request over
      }
      return originalOpen.apply(this, args);
    };
    xhrProto.send = function patchedSend(this: Record<string, unknown>, ...args: unknown[]): void {
      try {
        const url = String(this.__aviaryUrl ?? "");
        const config = state?.config ?? INITIAL_CONFIG;
        const category = blockedRequestCategory(config, url);
        if (category) {
          emit("blocked", { url, via: "xhr", at: now(), category });
          completeAsNetworkError(this);
          // A refused request still has to finish. The fetch path answers 204 and the beacon path
          // returns true precisely so X's client sees a completed call; returning here left the
          // XHR in state OPENED forever, so any caller waiting on completion -- a retry queue, a
          // promise wrapper -- would wait for good. Present it the way an offline request does:
          // DONE with status 0, then error and loadend.
          return;
        }
        armXhrGraphqlCapture(this, url, config);
      } catch {
        // fall through to the original
      }
      return originalSend.apply(this, args);
    };
    state.patchedXhrOpen = xhrProto.open;
    state.patchedXhrSend = xhrProto.send;
  }

  return () => uninstallPageAgent();
}

/** Test seam: the configuration currently in force, or undefined when no agent is installed. */
export function readAgentConfig(): PageAgentConfig | undefined {
  return state ? { ...state.config } : undefined;
}

export function uninstallPageAgent(): void {
  if (!state) {
    return;
  }
  const current = state;
  state = undefined;

  // Close the private channel first: nothing should be able to reach a torn-down agent.
  if (current.controlPort) {
    current.controlPort.onmessage = null;
    try {
      current.controlPort.close();
    } catch {
      // a closed or neutered port is already what we wanted
    }
  }

  current.target.removeEventListener("message", current.messageListener);

  // Restore by assignment only while the current value is still the wrapper this agent installed.
  // If X's own instrumentation -- or another extension -- wrapped fetch *after* Aviary did, then
  // assigning the original back would delete that layer along with ours. In that case the honest
  // move is to leave the chain intact and make our own wrapper inert, which the config reset above
  // has already done: with no state, every hook falls through to the original it captured.
  const restore = (
    owner: Record<string, unknown> | undefined,
    key: string,
    patched: unknown,
    original: unknown
  ): string => {
    if (!owner || !original) {
      return "absent";
    }
    if (owner[key] !== patched) {
      return "wrapped-by-another";
    }
    owner[key] = original;
    return "restored";
  };

  const outcomes = {
    fetch: restore(
      current.target as unknown as Record<string, unknown>,
      "fetch",
      current.patchedFetch,
      current.originalFetch
    ),
    sendBeacon: restore(
      current.target.navigator as unknown as Record<string, unknown> | undefined,
      "sendBeacon",
      current.patchedSendBeacon,
      current.originalSendBeacon
    ),
    xhrOpen: restore(
      current.target.XMLHttpRequest?.prototype as Record<string, unknown> | undefined,
      "open",
      current.patchedXhrOpen,
      current.originalXhrOpen
    ),
    xhrSend: restore(
      current.target.XMLHttpRequest?.prototype as Record<string, unknown> | undefined,
      "send",
      current.patchedXhrSend,
      current.originalXhrSend
    )
  };
  lastUninstallOutcomes = outcomes;
}

/**
 * What the last teardown was able to restore, so a caller can say which path was taken rather than
 * assume the page was left exactly as found.
 */
let lastUninstallOutcomes: Record<string, string> | undefined;

export function getLastUninstallOutcomes(): Record<string, string> | undefined {
  return lastUninstallOutcomes ? { ...lastUninstallOutcomes } : undefined;
}

function makePatchedFetch(originalFetch: typeof fetch, baseOrigin?: string): typeof fetch {
  return async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let url = "";
    try {
      url = requestUrl(input, baseOrigin);
    } catch {
      return originalFetch(input, init);
    }

    const config = state?.config ?? INITIAL_CONFIG;

    const blockedCategory = blockedRequestCategory(config, url);
    if (blockedCategory) {
      emit("blocked", { url, via: "fetch", at: now(), category: blockedCategory });
      // 204 rather than a rejection: a thrown fetch surfaces in X's own error reporting, which is
      // both noisy and itself a telemetry call.
      return new Response(null, { status: 204, statusText: "No Content" });
    }

    const response = await originalFetch(input, init);

    if (config.forceVideoQuality && isPlaylistUrl(url) && response.ok) {
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        const rewritten = rewritePlaylistToBestVariant(text);
        if (rewritten) {
          emit("playlist", { url, variantsBefore: rewritten.variantsBefore, at: now() });
          return new Response(rewritten.playlist, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }
      } catch {
        // a playlist we cannot rewrite is served exactly as it arrived
      }
    }

    // The export feature and the media feature share this bounded response event. Media metadata
    // is page-local too, but it needs the page world's response because the isolated world only
    // sees X's MediaSource blob after the player has consumed the direct variants.
    if ((config.captureGraphql || config.captureMediaMetadata) && isGraphqlUrl(url)) {
      try {
        const cloned = response.clone();
        void cloned.text().then((body) => {
          emitCapturedGraphql(url, response.status, body);
        });
      } catch {
        // capture is best-effort and must never affect the response the page receives
      }
    }

    return response;
  } as typeof fetch;
}

/**
 * Arms a one-shot observer before an XHR is sent, then reads its already-buffered response after
 * the page has finished receiving it. X currently delivers HomeTimeline through XMLHttpRequest,
 * while older builds used fetch; supporting both transports keeps direct MP4 variants available
 * after the player replaces them with a MediaSource blob.
 */
function armXhrGraphqlCapture(
  xhr: Record<string, unknown>,
  url: string,
  config: PageAgentConfig
): void {
  if (!(config.captureGraphql || config.captureMediaMetadata) || !isGraphqlUrl(url)) {
    return;
  }
  const addEventListener = xhr.addEventListener;
  if (typeof addEventListener !== "function") {
    return;
  }

  const capture = (): void => {
    try {
      const responseType = String(xhr.responseType ?? "").toLowerCase();
      let body: string | undefined;
      if (responseType === "" || responseType === "text") {
        body = typeof xhr.responseText === "string"
          ? xhr.responseText
          : typeof xhr.response === "string"
            ? xhr.response
            : undefined;
      } else if (responseType === "json") {
        body = typeof xhr.response === "string"
          ? xhr.response
          : xhr.response === undefined
            ? undefined
            : JSON.stringify(xhr.response);
      }
      if (typeof body !== "string" || body.length === 0) {
        return;
      }
      const numericStatus = Number(xhr.status);
      const status = Number.isFinite(numericStatus) ? numericStatus : 0;
      emitCapturedGraphql(url, status, body);
    } catch {
      // Reading responseText can throw for an unsupported responseType; the page still proceeds.
    }
  };

  (addEventListener as (
    type: string,
    listener: () => void,
    options?: { once: boolean }
  ) => void).call(xhr, "loadend", capture, { once: true });
}

function emitCapturedGraphql(url: string, status: number, body: string): void {
  const bytes = new TextEncoder().encode(body).byteLength;
  // A response over the cap is Aviary's own limit, not a message to distrust. It used to be sent
  // with the real (over-cap) byte count and no body, which the isolated world's validator refused
  // on the bounds check and reported as an untrusted message -- a security-shaped warning for an
  // ordinary large timeline. Say what it is instead: the payload is dropped, the size is reported
  // honestly, and `truncated` is what tells the reader this was a cap rather than a refusal.
  const oversize = bytes > MAX_GRAPHQL_PAYLOAD_BYTES;
  emit("graphql", {
    url,
    operation: graphqlOperationName(url),
    status,
    bytes: oversize ? 0 : bytes,
    at: now(),
    body: oversize ? "" : body,
    ...(oversize ? { truncated: true, originalBytes: bytes } : {})
  });
}

function requestUrl(input: RequestInfo | URL, baseOrigin?: string): string {
  let raw = "";
  if (typeof input === "string") {
    raw = input;
  } else if (input instanceof URL) {
    raw = input.href;
  } else {
    raw = (input as Request).url ?? "";
  }
  try {
    return new URL(raw, baseOrigin ?? "https://x.com").href;
  } catch {
    return raw;
  }
}

function parseGraphqlRoute(
  rawUrl: string,
  expectedOrigin?: string
): { href: string; operation: string } | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4096) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(rawUrl, expectedOrigin ?? "https://x.com");
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !X_GRAPHQL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    return null;
  }
  if (expectedOrigin) {
    try {
      const origin = new URL(expectedOrigin);
      if (origin.protocol !== "https:" || url.origin !== origin.origin) {
        return null;
      }
    } catch {
      return null;
    }
  }
  const match = GRAPHQL_PATH_PATTERN.exec(url.pathname);
  if (!match || url.hash) {
    return null;
  }
  return { href: url.href, operation: match[2] ?? "" };
}

function normalizeConfig(payload: unknown): PageAgentConfig {
  const value = (payload ?? {}) as Partial<PageAgentConfig>;
  return {
    blockAds: value.blockAds === true,
    blockBeacons: value.blockBeacons === true,
    captureGraphql: value.captureGraphql === true,
    captureMediaMetadata: value.captureMediaMetadata === true,
    forceVideoQuality: value.forceVideoQuality === true
  };
}

function blockedRequestCategory(
  config: PageAgentConfig,
  url: string
): "ad" | "analytics" | null {
  if (config.blockAds && isAdRequestUrl(url)) {
    return "ad";
  }
  if (config.blockBeacons && isTelemetryUrl(url)) {
    return "analytics";
  }
  return null;
}

/** Applies a control envelope that arrived over a channel we trust. */
function handleControlEnvelope(data: PageAgentEnvelope): void {
  if (data.kind === "config") {
    if (state) {
      state.config = normalizeConfig(data.payload);
    }
    return;
  }
  if (data.kind === "teardown") {
    uninstallPageAgent();
  }
}

/** The port the isolated world transferred with its hello, if the host supports transferables. */
function readTransferredPort(message: { ports?: unknown }): MessagePort | undefined {
  const ports = message.ports;
  if (!Array.isArray(ports) && !(ports && typeof (ports as ArrayLike<unknown>).length === "number")) {
    return undefined;
  }
  const first = (ports as ArrayLike<unknown>)[0];
  return first && typeof (first as MessagePort).postMessage === "function"
    ? (first as MessagePort)
    : undefined;
}

function adoptControlPort(port: MessagePort): void {
  if (!state) {
    return;
  }
  state.controlPort = port;
  port.onmessage = (event: MessageEvent): void => {
    if (isPageAgentEnvelope(event.data)) {
      handleControlEnvelope(event.data);
    }
  };
  port.start?.();
}

function emit(kind: PageAgentKind, payload?: unknown): void {
  if (!state) {
    return;
  }
  try {
    const envelope: PageAgentEnvelope = {
      channel: PAGE_CHANNEL,
      kind,
      ...(state.peerNonce === undefined ? {} : { nonce: state.peerNonce }),
      payload
    };
    // Prefer the private channel: an observer on the page window learns nothing from traffic that
    // never goes there.
    if (state.controlPort) {
      state.controlPort.postMessage(envelope);
      return;
    }
    if (state.sink) {
      state.sink(envelope);
      return;
    }
    state.target.postMessage(envelope, state.target.location?.origin ?? "*");
  } catch {
    // a page that has torn down its own window is not an Aviary failure
  }
}

function now(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
