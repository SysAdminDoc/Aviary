"use strict";
(() => {
  // src/page/page-agent.ts
  var PAGE_CHANNEL = "aviary.page.v1";
  var MAX_GRAPHQL_PAYLOAD_BYTES = 15e5;
  var PAGE_AGENT_KINDS = /* @__PURE__ */ new Set([
    "hello",
    "ready",
    "config",
    "graphql",
    "blocked",
    "playlist",
    "teardown"
  ]);
  var MAX_NONCE_LENGTH = 256;
  var X_GRAPHQL_HOSTNAMES = /* @__PURE__ */ new Set([
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
    "pro.x.com"
  ]);
  var GRAPHQL_PATH_PATTERN = /^\/i\/api\/graphql\/([A-Za-z0-9_-]{1,200})\/([A-Za-z0-9_-]{1,100})$/;
  function isPageAgentEnvelope(value) {
    if (!isRecord(value) || value.channel !== PAGE_CHANNEL || typeof value.kind !== "string") {
      return false;
    }
    if (!PAGE_AGENT_KINDS.has(value.kind)) {
      return false;
    }
    return value.nonce === void 0 || typeof value.nonce === "string" && value.nonce.length >= 16 && value.nonce.length <= MAX_NONCE_LENGTH;
  }
  var TELEMETRY_PATTERNS = [
    /\/i\/api\/[^/]+\/jot(?:\/|$)/i,
    /\/i\/api\/[^/]+\/jot\.json(?:$|\?)/i,
    /^https?:\/\/analytics\.twitter\.com\//i
  ];
  function isTelemetryUrl(url) {
    if (!url) {
      return false;
    }
    return TELEMETRY_PATTERNS.some((pattern) => pattern.test(url));
  }
  function isAdRequestUrl(rawUrl) {
    if (!rawUrl) {
      return false;
    }
    try {
      const url = new URL(rawUrl, "https://x.com");
      return X_GRAPHQL_HOSTNAMES.has(url.hostname.toLowerCase()) && url.pathname === "/i/api/1.1/promoted_content/log.json";
    } catch {
      return false;
    }
  }
  function completeAsNetworkError(xhr) {
    const define = (name, value) => {
      try {
        Object.defineProperty(xhr, name, { configurable: true, value });
      } catch {
      }
    };
    define("readyState", 4);
    define("status", 0);
    define("statusText", "");
    define("responseText", "");
    define("response", "");
    const dispatch = (type) => {
      try {
        const handler = xhr[`on${type}`];
        if (typeof handler === "function") {
          handler.call(xhr, { type, target: xhr });
        }
        const dispatchEvent = xhr.dispatchEvent;
        if (typeof dispatchEvent === "function" && typeof ProgressEvent === "function") {
          dispatchEvent.call(xhr, new ProgressEvent(type));
        }
      } catch {
      }
    };
    dispatch("readystatechange");
    dispatch("error");
    dispatch("loadend");
  }
  function isGraphqlUrl(url) {
    return parseGraphqlRoute(url) !== null;
  }
  function graphqlOperationName(url) {
    return parseGraphqlRoute(url)?.operation ?? "unknown";
  }
  function rewritePlaylistToBestVariant(text) {
    if (!text.includes("#EXT-X-STREAM-INF")) {
      return void 0;
    }
    const lines = text.split(/\r?\n/);
    const header = [];
    const variants = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line.startsWith("#EXT-X-STREAM-INF")) {
        if (variants.length === 0) {
          header.push(line);
        }
        continue;
      }
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
    const best = variants.reduce(
      (winner, variant) => winner && winner.bandwidth >= variant.bandwidth ? winner : variant,
      void 0
    );
    if (variants.length < 2 || !best) {
      return void 0;
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
  function nextUriIndex(lines, from) {
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
  function parseBandwidth(line) {
    const average = /AVERAGE-BANDWIDTH=(\d+)/i.exec(line);
    const peak = /[^-]BANDWIDTH=(\d+)/i.exec(` ${line}`);
    const value = average?.[1] ?? peak?.[1];
    return value ? Number.parseInt(value, 10) : 0;
  }
  function isPlaylistUrl(url) {
    return /\.m3u8(?:$|\?)/i.test(url);
  }
  var INITIAL_CONFIG = {
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
  var state;
  function installPageAgent(target, sink) {
    if (state) {
      return () => uninstallPageAgent();
    }
    const originalFetch = target.fetch;
    const originalSendBeacon = target.navigator?.sendBeacon;
    const xhrProto = target.XMLHttpRequest?.prototype;
    const messageListener = (event) => {
      const message = event;
      if (message.source !== void 0 && message.source !== target) {
        return;
      }
      const expectedOrigin = target.location?.origin;
      if (typeof message.origin === "string" && message.origin.length > 0 && message.origin !== "null" && expectedOrigin && message.origin !== expectedOrigin) {
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
        if (state?.controlPort) {
          return;
        }
        if (state?.peerNonce && state.peerNonce !== nonce) {
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
      peerNonce: void 0,
      controlPort: void 0,
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
      target.navigator.sendBeacon = function patchedSendBeacon(url, data) {
        try {
          const category = blockedRequestCategory(state?.config ?? INITIAL_CONFIG, String(url));
          if (category) {
            emit("blocked", { url: String(url), via: "sendBeacon", at: now(), category });
            return true;
          }
        } catch {
        }
        return originalSendBeacon.call(target.navigator, url, data);
      };
      state.patchedSendBeacon = target.navigator.sendBeacon;
    }
    if (xhrProto && state.originalXhrOpen && state.originalXhrSend) {
      const originalOpen = state.originalXhrOpen;
      const originalSend = state.originalXhrSend;
      xhrProto.open = function patchedOpen(...args) {
        try {
          this.__aviaryUrl = requestUrl(String(args[1] ?? ""), target.location?.origin);
        } catch {
        }
        return originalOpen.apply(this, args);
      };
      xhrProto.send = function patchedSend(...args) {
        try {
          const url = String(this.__aviaryUrl ?? "");
          const config = state?.config ?? INITIAL_CONFIG;
          const category = blockedRequestCategory(config, url);
          if (category) {
            emit("blocked", { url, via: "xhr", at: now(), category });
            completeAsNetworkError(this);
            return;
          }
          armXhrGraphqlCapture(this, url, config);
        } catch {
        }
        return originalSend.apply(this, args);
      };
      state.patchedXhrOpen = xhrProto.open;
      state.patchedXhrSend = xhrProto.send;
    }
    return () => uninstallPageAgent();
  }
  function uninstallPageAgent() {
    if (!state) {
      return;
    }
    const current = state;
    state = void 0;
    if (current.controlPort) {
      current.controlPort.onmessage = null;
      try {
        current.controlPort.close();
      } catch {
      }
    }
    current.target.removeEventListener("message", current.messageListener);
    const restore = (owner, key, patched, original) => {
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
        current.target,
        "fetch",
        current.patchedFetch,
        current.originalFetch
      ),
      sendBeacon: restore(
        current.target.navigator,
        "sendBeacon",
        current.patchedSendBeacon,
        current.originalSendBeacon
      ),
      xhrOpen: restore(
        current.target.XMLHttpRequest?.prototype,
        "open",
        current.patchedXhrOpen,
        current.originalXhrOpen
      ),
      xhrSend: restore(
        current.target.XMLHttpRequest?.prototype,
        "send",
        current.patchedXhrSend,
        current.originalXhrSend
      )
    };
    lastUninstallOutcomes = outcomes;
  }
  var lastUninstallOutcomes;
  function makePatchedFetch(originalFetch, baseOrigin) {
    return async function patchedFetch(input, init) {
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
        }
      }
      if ((config.captureGraphql || config.captureMediaMetadata) && isGraphqlUrl(url)) {
        try {
          const cloned = response.clone();
          void cloned.text().then((body) => {
            emitCapturedGraphql(url, response.status, body);
          });
        } catch {
        }
      }
      return response;
    };
  }
  function armXhrGraphqlCapture(xhr, url, config) {
    if (!(config.captureGraphql || config.captureMediaMetadata) || !isGraphqlUrl(url)) {
      return;
    }
    const addEventListener = xhr.addEventListener;
    if (typeof addEventListener !== "function") {
      return;
    }
    const capture = () => {
      try {
        const responseType = String(xhr.responseType ?? "").toLowerCase();
        let body;
        if (responseType === "" || responseType === "text") {
          body = typeof xhr.responseText === "string" ? xhr.responseText : typeof xhr.response === "string" ? xhr.response : void 0;
        } else if (responseType === "json") {
          body = typeof xhr.response === "string" ? xhr.response : xhr.response === void 0 ? void 0 : JSON.stringify(xhr.response);
        }
        if (typeof body !== "string" || body.length === 0) {
          return;
        }
        const numericStatus = Number(xhr.status);
        const status = Number.isFinite(numericStatus) ? numericStatus : 0;
        emitCapturedGraphql(url, status, body);
      } catch {
      }
    };
    addEventListener.call(xhr, "loadend", capture, { once: true });
  }
  function emitCapturedGraphql(url, status, body) {
    const bytes = new TextEncoder().encode(body).byteLength;
    emit("graphql", {
      url,
      operation: graphqlOperationName(url),
      status,
      bytes,
      at: now(),
      body: bytes <= MAX_GRAPHQL_PAYLOAD_BYTES ? body : void 0
    });
  }
  function requestUrl(input, baseOrigin) {
    let raw = "";
    if (typeof input === "string") {
      raw = input;
    } else if (input instanceof URL) {
      raw = input.href;
    } else {
      raw = input.url ?? "";
    }
    try {
      return new URL(raw, baseOrigin ?? "https://x.com").href;
    } catch {
      return raw;
    }
  }
  function parseGraphqlRoute(rawUrl, expectedOrigin) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 4096) {
      return null;
    }
    let url;
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
  function normalizeConfig(payload) {
    const value = payload ?? {};
    return {
      blockAds: value.blockAds === true,
      blockBeacons: value.blockBeacons === true,
      captureGraphql: value.captureGraphql === true,
      captureMediaMetadata: value.captureMediaMetadata === true,
      forceVideoQuality: value.forceVideoQuality === true
    };
  }
  function blockedRequestCategory(config, url) {
    if (config.blockAds && isAdRequestUrl(url)) {
      return "ad";
    }
    if (config.blockBeacons && isTelemetryUrl(url)) {
      return "analytics";
    }
    return null;
  }
  function handleControlEnvelope(data) {
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
  function readTransferredPort(message) {
    const ports = message.ports;
    if (!Array.isArray(ports) && !(ports && typeof ports.length === "number")) {
      return void 0;
    }
    const first = ports[0];
    return first && typeof first.postMessage === "function" ? first : void 0;
  }
  function adoptControlPort(port) {
    if (!state) {
      return;
    }
    state.controlPort = port;
    port.onmessage = (event) => {
      if (isPageAgentEnvelope(event.data)) {
        handleControlEnvelope(event.data);
      }
    };
    port.start?.();
  }
  function emit(kind, payload) {
    if (!state) {
      return;
    }
    try {
      const envelope = {
        channel: PAGE_CHANNEL,
        kind,
        ...state.peerNonce === void 0 ? {} : { nonce: state.peerNonce },
        payload
      };
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
    }
  }
  function now() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // src/entrypoints/extension-page.ts
  installPageAgent(globalThis);
})();
