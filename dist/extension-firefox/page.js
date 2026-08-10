"use strict";
(() => {
  // src/page/page-agent.ts
  var PAGE_CHANNEL = "aviary.page.v1";
  var MAX_PAYLOAD_BYTES = 15e5;
  var TELEMETRY_PATTERNS = [
    /\/i\/api\/[^/]+\/jot(?:\/|$)/i,
    /\/i\/api\/[^/]+\/jot\.json(?:$|\?)/i,
    /^https?:\/\/analytics\.twitter\.com\//i
  ];
  var GRAPHQL_PATTERN = /\/i\/api\/graphql\/([^/?#]+)\/([^/?#]+)/i;
  function isTelemetryUrl(url) {
    if (!url) {
      return false;
    }
    return TELEMETRY_PATTERNS.some((pattern) => pattern.test(url));
  }
  function isGraphqlUrl(url) {
    return GRAPHQL_PATTERN.test(url);
  }
  function graphqlOperationName(url) {
    const match = GRAPHQL_PATTERN.exec(url);
    return match?.[2] ?? "unknown";
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
  var DISABLED = {
    blockBeacons: false,
    captureGraphql: false,
    captureMediaMetadata: false,
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
      const data = event?.data;
      if (!data || data.channel !== PAGE_CHANNEL) {
        return;
      }
      if (data.kind === "hello") {
        const nonce = typeof data.nonce === "string" ? data.nonce : "";
        if (nonce.length < 16) {
          return;
        }
        if (state?.peerNonce && state.peerNonce !== nonce) {
          return;
        }
        if (state) {
          state.peerNonce = nonce;
        }
        emit("ready");
        return;
      }
      if (!state?.peerNonce || data.nonce !== state.peerNonce) {
        return;
      }
      if (data.kind === "config") {
        state && (state.config = normalizeConfig(data.payload));
        return;
      }
      if (data.kind === "teardown") {
        uninstallPageAgent();
      }
    };
    state = {
      config: { ...DISABLED },
      peerNonce: void 0,
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
      target.navigator.sendBeacon = function patchedSendBeacon(url, data) {
        try {
          if (state?.config.blockBeacons && isTelemetryUrl(String(url))) {
            emit("blocked", { url: String(url), via: "sendBeacon", at: now() });
            return true;
          }
        } catch {
        }
        return originalSendBeacon.call(target.navigator, url, data);
      };
    }
    if (xhrProto && state.originalXhrOpen && state.originalXhrSend) {
      const originalOpen = state.originalXhrOpen;
      const originalSend = state.originalXhrSend;
      xhrProto.open = function patchedOpen(...args) {
        try {
          this.__aviaryUrl = String(args[1] ?? "");
        } catch {
        }
        return originalOpen.apply(this, args);
      };
      xhrProto.send = function patchedSend(...args) {
        try {
          const url = String(this.__aviaryUrl ?? "");
          if (state?.config.blockBeacons && isTelemetryUrl(url)) {
            emit("blocked", { url, via: "xhr", at: now() });
            return;
          }
        } catch {
        }
        return originalSend.apply(this, args);
      };
    }
    return () => uninstallPageAgent();
  }
  function uninstallPageAgent() {
    if (!state) {
      return;
    }
    const current = state;
    state = void 0;
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
  function makePatchedFetch(originalFetch) {
    return async function patchedFetch(input, init) {
      let url = "";
      try {
        url = requestUrl(input);
      } catch {
        return originalFetch(input, init);
      }
      const config = state?.config ?? DISABLED;
      if (config.blockBeacons && isTelemetryUrl(url)) {
        emit("blocked", { url, via: "fetch", at: now() });
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
            const bytes = new TextEncoder().encode(body).byteLength;
            emit("graphql", {
              url,
              operation: graphqlOperationName(url),
              status: response.status,
              bytes,
              at: now(),
              body: bytes <= MAX_PAYLOAD_BYTES ? body : void 0
            });
          });
        } catch {
        }
      }
      return response;
    };
  }
  function requestUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input.url ?? "";
  }
  function normalizeConfig(payload) {
    const value = payload ?? {};
    return {
      blockBeacons: value.blockBeacons === true,
      captureGraphql: value.captureGraphql === true,
      captureMediaMetadata: value.captureMediaMetadata === true,
      forceVideoQuality: value.forceVideoQuality === true
    };
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

  // src/entrypoints/extension-page.ts
  installPageAgent(globalThis);
})();
