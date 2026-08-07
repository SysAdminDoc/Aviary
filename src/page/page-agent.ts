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
 * Every hook is off until the isolated world asks for it, every hook falls through to the original
 * on any internal error, and `uninstallPageAgent` restores the exact references it replaced.
 */

export const PAGE_CHANNEL = "aviary.page.v1";

export type PageAgentKind =
  | "hello"
  | "ready"
  | "config"
  | "graphql"
  | "blocked"
  | "playlist"
  | "teardown";

export interface PageAgentConfig {
  blockBeacons: boolean;
  captureGraphql: boolean;
  forceVideoQuality: boolean;
}

export interface PageAgentEnvelope {
  channel: typeof PAGE_CHANNEL;
  kind: PageAgentKind;
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

export interface BlockedBeaconPayload {
  url: string;
  via: "fetch" | "xhr" | "sendBeacon";
  at: string;
}

export interface PlaylistRewritePayload {
  url: string;
  variantsBefore: number;
  at: string;
}

/** Mirrors the isolated-world cap so a hostile response cannot grow the message channel. */
const MAX_PAYLOAD_BYTES = 1_500_000;

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

const GRAPHQL_PATTERN = /\/i\/api\/graphql\/([^/?#]+)\/([^/?#]+)/i;

export function isTelemetryUrl(url: string): boolean {
  if (!url) {
    return false;
  }
  return TELEMETRY_PATTERNS.some((pattern) => pattern.test(url));
}

export function isGraphqlUrl(url: string): boolean {
  return GRAPHQL_PATTERN.test(url);
}

export function graphqlOperationName(url: string): string {
  const match = GRAPHQL_PATTERN.exec(url);
  return match?.[2] ?? "unknown";
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

const DISABLED: PageAgentConfig = {
  blockBeacons: false,
  captureGraphql: false,
  forceVideoQuality: false
};

interface AgentState {
  config: PageAgentConfig;
  target: PageAgentTarget;
  originalFetch: typeof fetch;
  originalSendBeacon: ((url: string, data?: unknown) => boolean) | undefined;
  originalXhrOpen: ((...args: unknown[]) => void) | undefined;
  originalXhrSend: ((...args: unknown[]) => void) | undefined;
  messageListener: (event: unknown) => void;
  sink: PageAgentSink | undefined;
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

let state: AgentState | undefined;

/**
 * Installs the agent on `target` and returns a teardown function.
 *
 * Installation alone patches nothing observable: every hook checks the current config first, and
 * the config starts fully disabled. The isolated world turns individual hooks on by posting a
 * `config` envelope, so a user who enables nothing pays only an extra function call per request.
 */
export function installPageAgent(target: PageAgentTarget, sink?: PageAgentSink): () => void {
  if (state) {
    return () => uninstallPageAgent();
  }

  const originalFetch = target.fetch;
  const originalSendBeacon = target.navigator?.sendBeacon;
  const xhrProto = target.XMLHttpRequest?.prototype;

  const messageListener = (event: unknown): void => {
    const data = (event as { data?: unknown })?.data as PageAgentEnvelope | undefined;
    if (!data || data.channel !== PAGE_CHANNEL) {
      return;
    }
    if (data.kind === "config") {
      state && (state.config = normalizeConfig(data.payload));
      return;
    }
    if (data.kind === "hello") {
      emit("ready");
      return;
    }
    if (data.kind === "teardown") {
      uninstallPageAgent();
    }
  };

  state = {
    config: { ...DISABLED },
    target,
    originalFetch,
    originalSendBeacon,
    originalXhrOpen: xhrProto?.open,
    originalXhrSend: xhrProto?.send,
    messageListener,
    sink
  };

  target.addEventListener("message", messageListener);
  target.fetch = makePatchedFetch(originalFetch);

  if (originalSendBeacon && target.navigator) {
    target.navigator.sendBeacon = function patchedSendBeacon(url: string, data?: unknown): boolean {
      try {
        if (state?.config.blockBeacons && isTelemetryUrl(String(url))) {
          emit("blocked", { url: String(url), via: "sendBeacon", at: now() });
          // Report success: a refused beacon must look delivered, or X's client retries it.
          return true;
        }
      } catch {
        // fall through to the original
      }
      return originalSendBeacon.call(target.navigator, url, data);
    };
  }

  if (xhrProto && state.originalXhrOpen && state.originalXhrSend) {
    const originalOpen = state.originalXhrOpen;
    const originalSend = state.originalXhrSend;
    xhrProto.open = function patchedOpen(this: Record<string, unknown>, ...args: unknown[]): void {
      try {
        this.__aviaryUrl = String(args[1] ?? "");
      } catch {
        // a frozen XHR instance is not worth failing the request over
      }
      return originalOpen.apply(this, args);
    };
    xhrProto.send = function patchedSend(this: Record<string, unknown>, ...args: unknown[]): void {
      try {
        const url = String(this.__aviaryUrl ?? "");
        if (state?.config.blockBeacons && isTelemetryUrl(url)) {
          emit("blocked", { url, via: "xhr", at: now() });
          return;
        }
      } catch {
        // fall through to the original
      }
      return originalSend.apply(this, args);
    };
  }

  emit("ready");
  return () => uninstallPageAgent();
}

export function uninstallPageAgent(): void {
  if (!state) {
    return;
  }
  const current = state;
  state = undefined;

  current.target.removeEventListener("message", current.messageListener);
  current.target.fetch = current.originalFetch;
  if (current.originalSendBeacon && current.target.navigator) {
    current.target.navigator.sendBeacon = current.originalSendBeacon;
  }
  const xhrProto = current.target.XMLHttpRequest?.prototype;
  if (xhrProto && current.originalXhrOpen && current.originalXhrSend) {
    xhrProto.open = current.originalXhrOpen;
    xhrProto.send = current.originalXhrSend;
  }
}

function makePatchedFetch(originalFetch: typeof fetch): typeof fetch {
  return async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let url = "";
    try {
      url = requestUrl(input);
    } catch {
      return originalFetch(input, init);
    }

    const config = state?.config ?? DISABLED;

    if (config.blockBeacons && isTelemetryUrl(url)) {
      emit("blocked", { url, via: "fetch", at: now() });
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

    if (config.captureGraphql && isGraphqlUrl(url)) {
      try {
        const cloned = response.clone();
        void cloned.text().then((body) => {
          const bytes = body.length;
          emit("graphql", {
            url,
            operation: graphqlOperationName(url),
            status: response.status,
            bytes,
            at: now(),
            body: bytes <= MAX_PAYLOAD_BYTES ? body : undefined
          });
        });
      } catch {
        // capture is best-effort and must never affect the response the page receives
      }
    }

    return response;
  } as typeof fetch;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return (input as Request).url ?? "";
}

function normalizeConfig(payload: unknown): PageAgentConfig {
  const value = (payload ?? {}) as Partial<PageAgentConfig>;
  return {
    blockBeacons: value.blockBeacons === true,
    captureGraphql: value.captureGraphql === true,
    forceVideoQuality: value.forceVideoQuality === true
  };
}

function emit(kind: PageAgentKind, payload?: unknown): void {
  if (!state) {
    return;
  }
  try {
    const envelope: PageAgentEnvelope = { channel: PAGE_CHANNEL, kind, payload };
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
