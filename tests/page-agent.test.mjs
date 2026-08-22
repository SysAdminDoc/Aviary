import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A stand-in for the page's window.
 *
 * The agent takes its target as a parameter precisely so it can be handed one of these: the same
 * code patches an extension's MAIN-world `window` and a userscript's `unsafeWindow`, and neither
 * of those exists here.
 */
function fakeWindow(fetchImpl) {
  const calls = { fetch: [], beacon: [], xhrSend: [] };
  const listeners = new Map();

  const target = {
    calls,
    fetch: fetchImpl ?? (async () => new Response("original", { status: 200 })),
    navigator: {
      sendBeacon(url, data) {
        calls.beacon.push({ url, data });
        return true;
      }
    },
    XMLHttpRequest: {
      prototype: {
        open(...args) {
          this.openedWith = args;
        },
        send(...args) {
          calls.xhrSend.push({ url: this.__aviaryUrl, args });
        }
      }
    },
    location: { origin: "https://x.com" },
    posted: [],
    postMessage(message) {
      target.posted.push(message);
      for (const handler of listeners.get("message") ?? []) {
        handler({ data: message });
      }
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    }
  };

  target.originals = {
    fetch: target.fetch,
    sendBeacon: target.navigator.sendBeacon,
    open: target.XMLHttpRequest.prototype.open,
    send: target.XMLHttpRequest.prototype.send
  };
  return target;
}

const MASTER_PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-STREAM-INF:BANDWIDTH=256000,RESOLUTION=320x180',
  "/low.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360',
  "/mid.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720',
  "/high.m3u8",
  ""
].join("\n");

test("request guards cannot match timeline, media, login, or action traffic", async () => {
  const { isTelemetryUrl, isAdRequestUrl, isGraphqlUrl } = await importSourceModule("src/page/page-agent.ts");

  // The direction that matters. A matcher one character too greedy would not fail loudly here --
  // it would blank the timeline on live X, where nothing in this repo can observe it.
  const timelineUrls = [
    "https://x.com/i/api/graphql/abc123/HomeTimeline",
    "https://x.com/i/api/graphql/xyz/TweetDetail?variables=%7B%7D",
    "https://x.com/i/api/graphql/q/UserByScreenName",
    "https://x.com/i/api/1.1/jot.json.notreally/graphql/Home",
    "https://x.com/i/api/2/notifications/all.json",
    "https://api.x.com/1.1/account/settings.json",
    "https://pbs.twimg.com/media/abc.jpg?name=orig",
    "https://video.twimg.com/ext_tw_video/1/pu/pl/x.m3u8"
  ];
  for (const url of timelineUrls) {
    assert.equal(isTelemetryUrl(url), false, `must not treat as telemetry: ${url}`);
    assert.equal(isAdRequestUrl(url), false, `must not treat as ad logging: ${url}`);
  }

  const telemetryUrls = [
    "https://x.com/i/api/1.1/jot/client_event.json",
    "https://x.com/i/api/1.1/jot/error_log.json",
    "https://x.com/i/api/2/jot/syndication.json",
    "https://analytics.twitter.com/i/adsct?p_id=1"
  ];
  for (const url of telemetryUrls) {
    assert.equal(isTelemetryUrl(url), true, `must treat as telemetry: ${url}`);
  }

  assert.equal(isGraphqlUrl("https://x.com/i/api/graphql/abc123/HomeTimeline"), true);
  assert.equal(isGraphqlUrl("https://x.com/i/api/1.1/jot/client_event.json"), false);
  assert.equal(isAdRequestUrl("https://x.com/i/api/1.1/promoted_content/log.json"), true);
  assert.equal(isAdRequestUrl("/i/api/1.1/promoted_content/log.json?event=impression"), true);
  assert.equal(isAdRequestUrl("https://evil.example/i/api/1.1/promoted_content/log.json"), false);
  assert.equal(isAdRequestUrl("https://x.com/i/api/1.1/promoted_content/content.json"), false);
});

test("the isolated GraphQL boundary rejects forged, inconsistent, oversized, and malformed events", async () => {
  const {
    MAX_GRAPHQL_PAYLOAD_BYTES,
    isPageAgentEnvelope,
    sanitizeCapturedGraphqlPayload,
    PAGE_CHANNEL
  } = await importSourceModule("src/page/page-agent.ts");
  const at = new Date().toISOString();
  const valid = {
    url: "/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D",
    operation: "HomeTimeline",
    status: 200,
    bytes: 2,
    at,
    body: "{}"
  };

  const accepted = sanitizeCapturedGraphqlPayload(valid, "https://x.com");
  assert.equal(accepted?.url, "https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D");
  assert.equal(accepted?.operation, "HomeTimeline");

  const rejected = [
    { ...valid, url: "https://evil.example/i/api/graphql/abc123/HomeTimeline" },
    { ...valid, operation: "TweetDetail" },
    { ...valid, status: 200.5 },
    { ...valid, bytes: 3 },
    { ...valid, body: undefined },
    { ...valid, bytes: MAX_GRAPHQL_PAYLOAD_BYTES + 1, body: "x" },
    { ...valid, at: "not-a-date" },
    { ...valid, body: "\ud800", bytes: 3 }
  ];
  for (const candidate of rejected) {
    assert.equal(
      sanitizeCapturedGraphqlPayload(candidate, "https://x.com"),
      null,
      `must reject ${JSON.stringify(candidate)}`
    );
  }

  assert.equal(
    isPageAgentEnvelope({ channel: PAGE_CHANNEL, kind: "graphql", nonce: "short", payload: valid }),
    false
  );
  assert.equal(
    isPageAgentEnvelope({ channel: PAGE_CHANNEL, kind: "unknown", nonce: "trusted-session-nonce-1234" }),
    false
  );
  assert.equal(
    isPageAgentEnvelope({ channel: PAGE_CHANNEL, kind: "graphql", nonce: "trusted-session-nonce-1234", payload: valid }),
    true
  );
});

test("startup captures direct video metadata while elective hooks remain off", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow();
  const events = [];

  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));
  try {
    // Analytics refusal remains elective: a telemetry call still reaches the original fetch.
    const response = await target.fetch("https://x.com/i/api/1.1/jot/client_event.json");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "original");

    assert.equal(target.navigator.sendBeacon("https://x.com/i/api/1.1/jot/client_event.json"), true);
    assert.equal(target.calls.beacon.length, 1, "the original sendBeacon must have run");

    const adLog = await target.fetch("https://x.com/i/api/1.1/promoted_content/log.json");
    assert.equal(adLog.status, 204, "the default-on guard must beat the first promoted log call");

    // Media controls are also default-on. Capture must beat the first timeline response because
    // X replaces its direct MP4 variants with a MediaSource blob in the mounted player.
    const nonce = "startup-media-nonce-1234";
    target.postMessage({ channel: PAGE_CHANNEL, kind: "hello", nonce });
    const timeline = await target.fetch("https://x.com/i/api/graphql/abc/HomeTimeline");
    assert.equal(await timeline.text(), "original");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const captured = events.filter((event) => event.kind === "graphql");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].payload.operation, "HomeTimeline");
    assert.equal(captured[0].payload.body, "original");
  } finally {
    uninstall();
  }
});

test("an enabled beacon hook refuses telemetry and reports it, without disturbing the timeline", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");

  const target = fakeWindow(async (input) => new Response(`served:${String(input)}`, { status: 200 }));
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockAds: false,
      blockBeacons: true,
      captureGraphql: false,
      forceVideoQuality: false
    });

    const blocked = await target.fetch("https://x.com/i/api/1.1/jot/client_event.json");
    assert.equal(blocked.status, 204, "a refused beacon is answered, not rejected");

    const timeline = await target.fetch("https://x.com/i/api/graphql/abc/HomeTimeline");
    assert.equal(await timeline.text(), "served:https://x.com/i/api/graphql/abc/HomeTimeline");

    // A refused beacon must look delivered or X's client retries it in a loop.
    assert.equal(
      target.navigator.sendBeacon("https://x.com/i/api/1.1/jot/client_event.json"),
      true
    );
    assert.equal(target.calls.beacon.length, 0, "the original sendBeacon must not have run");

    const blockedEvents = events.filter((event) => event.kind === "blocked");
    assert.equal(blockedEvents.length, 2);
    assert.deepEqual(
      blockedEvents.map((event) => event.payload.via).sort(),
      ["fetch", "sendBeacon"]
    );
    assert.ok(blockedEvents.every((event) => event.payload.category === "analytics"));
  } finally {
    uninstall();
  }
});

test("ad protection refuses promoted logging across fetch, XHR, and sendBeacon only", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow(async (input) => new Response(`served:${String(input)}`, { status: 200 }));
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockAds: true,
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: false,
      forceVideoQuality: false
    });

    assert.equal(
      (await target.fetch("https://x.com/i/api/1.1/promoted_content/log.json?event=impression")).status,
      204
    );
    assert.equal(
      await (await target.fetch("https://x.com/i/api/graphql/abc/HomeTimeline")).text(),
      "served:https://x.com/i/api/graphql/abc/HomeTimeline"
    );
    assert.equal(
      await (await target.fetch("https://x.com/i/api/1.1/promoted_content/content.json")).text(),
      "served:https://x.com/i/api/1.1/promoted_content/content.json"
    );

    const xhr = Object.create(target.XMLHttpRequest.prototype);
    xhr.open("POST", "https://x.com/i/api/1.1/promoted_content/log.json");
    xhr.send("payload");
    assert.equal(target.calls.xhrSend.length, 0);

    assert.equal(
      target.navigator.sendBeacon("https://x.com/i/api/1.1/promoted_content/log.json", "payload"),
      true
    );
    assert.equal(target.calls.beacon.length, 0);

    const blocked = events.filter((event) => event.kind === "blocked");
    assert.equal(blocked.length, 3);
    assert.ok(blocked.every((event) => event.payload.category === "ad"));
    assert.deepEqual(blocked.map((event) => event.payload.via).sort(), ["fetch", "sendBeacon", "xhr"]);
  } finally {
    uninstall();
  }
});

test("page-agent config and teardown require the negotiated session nonce", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow();
  const uninstall = installPageAgent(target);
  const nonce = "trusted-session-nonce-1234";

  try {
    target.postMessage({
      channel: PAGE_CHANNEL,
      kind: "config",
      nonce: "forged-session-nonce-1234",
      payload: { blockBeacons: true }
    });
    assert.equal(
      (await target.fetch("https://x.com/i/api/1.1/jot/client_event.json")).status,
      200,
      "a config without the negotiated nonce must be ignored"
    );

    target.postMessage({ channel: PAGE_CHANNEL, kind: "hello", nonce });
    target.postMessage({
      channel: PAGE_CHANNEL,
      kind: "config",
      nonce,
      payload: { blockBeacons: true }
    });
    assert.equal(
      (await target.fetch("https://x.com/i/api/1.1/jot/client_event.json")).status,
      204
    );

    target.postMessage({
      channel: PAGE_CHANNEL,
      kind: "teardown",
      nonce: "another-session-nonce-1234"
    });
    assert.notEqual(target.fetch, target.originals.fetch, "forged teardown must be ignored");
  } finally {
    uninstall();
  }
});

test("XHR telemetry is refused by URL captured at open()", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow();
  const uninstall = installPageAgent(target);

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockBeacons: true,
      captureGraphql: false,
      forceVideoQuality: false
    });

    const xhr = Object.create(target.XMLHttpRequest.prototype);
    xhr.open("POST", "https://x.com/i/api/1.1/jot/client_event.json");
    xhr.send("payload");
    assert.equal(target.calls.xhrSend.length, 0, "telemetry must not reach the original send");

    const real = Object.create(target.XMLHttpRequest.prototype);
    real.open("GET", "https://x.com/i/api/graphql/abc/HomeTimeline");
    real.send();
    assert.equal(target.calls.xhrSend.length, 1, "timeline traffic must pass through");
  } finally {
    uninstall();
  }
});

test("a master playlist is reduced to its highest-bandwidth rendition", async () => {
  const { rewritePlaylistToBestVariant } = await importSourceModule("src/page/page-agent.ts");

  const result = rewritePlaylistToBestVariant(MASTER_PLAYLIST);
  assert.ok(result, "a three-variant master playlist must be rewritten");
  assert.equal(result.variantsBefore, 3);
  assert.ok(result.playlist.includes("/high.m3u8"));
  assert.ok(!result.playlist.includes("/low.m3u8"));
  assert.ok(!result.playlist.includes("/mid.m3u8"));
  assert.ok(result.playlist.startsWith("#EXTM3U"));
  assert.ok(result.playlist.includes("#EXT-X-INDEPENDENT-SEGMENTS"), "header lines are preserved");

  // A media playlist carries segments, not renditions. Rewriting one would destroy the video.
  const media = ["#EXTM3U", "#EXTINF:3.0,", "/seg1.ts", "#EXTINF:3.0,", "/seg2.ts"].join("\n");
  assert.equal(rewritePlaylistToBestVariant(media), undefined);

  // Nothing to choose between means nothing to rewrite: pass the original response through.
  const single = ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=832000", "/only.m3u8"].join("\n");
  assert.equal(rewritePlaylistToBestVariant(single), undefined);
});

test("AVERAGE-BANDWIDTH is preferred and never confused with BANDWIDTH", async () => {
  const { rewritePlaylistToBestVariant } = await importSourceModule("src/page/page-agent.ts");

  // Peak bandwidth ranks these one way and sustained bandwidth the other. Picking the wrong
  // attribute silently selects the lower-quality rendition, which is the whole failure this
  // feature exists to prevent.
  const playlist = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=3000000,AVERAGE-BANDWIDTH=900000",
    "/bursty.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=1800000",
    "/steady.m3u8"
  ].join("\n");

  const result = rewritePlaylistToBestVariant(playlist);
  assert.ok(result);
  assert.ok(result.playlist.includes("/steady.m3u8"), "AVERAGE-BANDWIDTH decides");
  assert.ok(!result.playlist.includes("/bursty.m3u8"));
});

test("a fetched playlist is rewritten in flight and reported", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");

  const target = fakeWindow(async () => new Response(MASTER_PLAYLIST, { status: 200 }));
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockBeacons: false,
      captureGraphql: false,
      forceVideoQuality: true
    });

    const response = await target.fetch("https://video.twimg.com/x/pl/master.m3u8");
    const text = await response.text();
    assert.ok(text.includes("/high.m3u8"));
    assert.ok(!text.includes("/low.m3u8"));

    const playlistEvents = events.filter((event) => event.kind === "playlist");
    assert.equal(playlistEvents.length, 1);
    assert.equal(playlistEvents[0].payload.variantsBefore, 3);
  } finally {
    uninstall();
  }
});

test("GraphQL capture reads the body without consuming the page's response", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");

  const body = JSON.stringify({ data: { home: { instructions: [] } } });
  const target = fakeWindow(async () => new Response(body, { status: 200 }));
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockBeacons: false,
      captureGraphql: true,
      forceVideoQuality: false
    });

    const response = await target.fetch("https://x.com/i/api/graphql/abc123/HomeTimeline");
    // The page must still be able to read its own response; a consumed body breaks the timeline.
    assert.equal(await response.text(), body);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const captured = events.filter((event) => event.kind === "graphql");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].payload.operation, "HomeTimeline");
    assert.equal(captured[0].payload.body, body);
  } finally {
    uninstall();
  }
});

test("media metadata capture shares GraphQL delivery without enabling raw export capture", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");

  const body = JSON.stringify({ data: { tweet: { rest_id: "123" } } });
  const target = fakeWindow(async () => new Response(body, { status: 200 }));
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: true,
      forceVideoQuality: false
    });

    const response = await target.fetch("https://x.com/i/api/graphql/abc123/HomeTimeline");
    assert.equal(await response.text(), body);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captured = events.filter((event) => event.kind === "graphql");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].payload.body, body);
  } finally {
    uninstall();
  }
});

test("media metadata capture observes XHR GraphQL without changing the page response", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");

  const responseValue = { data: { tweet: { rest_id: "123", video_info: { variants: [] } } } };
  const body = JSON.stringify(responseValue);
  const target = fakeWindow();
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: true,
      forceVideoQuality: false
    });

    const listeners = new Map();
    const xhr = Object.create(target.XMLHttpRequest.prototype);
    xhr.status = 200;
    xhr.responseType = "json";
    xhr.response = responseValue;
    xhr.addEventListener = (type, listener) => {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    };

    xhr.open("POST", "https://x.com/i/api/graphql/live123/HomeTimeline");
    xhr.send("variables={}");
    for (const listener of listeners.get("loadend") ?? []) {
      listener.call(xhr, { type: "loadend", target: xhr });
    }

    assert.equal(target.calls.xhrSend.length, 1, "the page request must still reach X");
    assert.equal(xhr.response, responseValue, "capture must not replace or consume the page response");
    const captured = events.filter((event) => event.kind === "graphql");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].payload.operation, "HomeTimeline");
    assert.equal(captured[0].payload.status, 200);
    assert.equal(captured[0].payload.body, body);
  } finally {
    uninstall();
  }
});

test("XHR capture accepts text responses and ignores non-GraphQL API traffic", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");

  const body = JSON.stringify({ data: { tweet: { rest_id: "456" } } });
  const target = fakeWindow();
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockAds: true,
      blockBeacons: true,
      captureGraphql: false,
      captureMediaMetadata: true,
      forceVideoQuality: false
    });

    const complete = (url) => {
      const listeners = [];
      const xhr = Object.create(target.XMLHttpRequest.prototype);
      xhr.status = 200;
      xhr.responseType = "";
      xhr.responseText = body;
      xhr.response = body;
      xhr.addEventListener = (type, listener) => {
        if (type === "loadend") listeners.push(listener);
      };
      xhr.open("POST", url);
      xhr.send("payload");
      for (const listener of listeners) listener.call(xhr, { type: "loadend", target: xhr });
      return xhr;
    };

    const timeline = complete("https://x.com/i/api/graphql/live456/HomeTimeline");
    const viewer = complete("https://x.com/i/api/1.1/graphql/viewer_context.json");

    assert.equal(timeline.responseText, body);
    assert.equal(viewer.responseText, body);
    assert.equal(target.calls.xhrSend.length, 2, "both first-party requests must pass through");
    const captured = events.filter((event) => event.kind === "graphql");
    assert.equal(captured.length, 1, "viewer_context is not a timeline GraphQL route");
    assert.equal(captured[0].payload.body, body);
    assert.equal(events.filter((event) => event.kind === "blocked").length, 0);
  } finally {
    uninstall();
  }
});

test("teardown restores the exact references it replaced", async () => {
  const { installPageAgent } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow();

  const uninstall = installPageAgent(target);
  assert.notEqual(target.fetch, target.originals.fetch, "install must actually patch");
  assert.notEqual(target.navigator.sendBeacon, target.originals.sendBeacon);
  assert.notEqual(target.XMLHttpRequest.prototype.send, target.originals.send);

  uninstall();

  assert.equal(target.fetch, target.originals.fetch);
  assert.equal(target.navigator.sendBeacon, target.originals.sendBeacon);
  assert.equal(target.XMLHttpRequest.prototype.open, target.originals.open);
  assert.equal(target.XMLHttpRequest.prototype.send, target.originals.send);
});

function sendConfig(target, channel, config) {
  const nonce = "test-session-nonce-1234";
  target.postMessage({ channel, kind: "hello", nonce });
  target.postMessage({ channel, kind: "config", nonce, payload: config });
}

// A refused XHR used to just return: no readystatechange, no error, no loadend, readyState stuck
// at OPENED. The sibling paths deliberately fake benign completion — fetch answers 204, sendBeacon
// returns true — precisely so X's client does not sit waiting or retry. The XHR path did neither,
// so anything gating a retry queue on completion would have waited for good.

test("a refused XHR completes as a network error instead of hanging", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow(async (input) => new Response(`served:${String(input)}`, { status: 200 }));
  const uninstall = installPageAgent(target);

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockAds: true,
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: false,
      forceVideoQuality: false
    });

    const events = [];
    const xhr = Object.create(target.XMLHttpRequest.prototype);
    xhr.onreadystatechange = () => events.push(`readystatechange:${xhr.readyState}`);
    xhr.onerror = () => events.push("error");
    xhr.onloadend = () => events.push("loadend");

    xhr.open("POST", "https://x.com/i/api/1.1/promoted_content/log.json");
    xhr.send("event=impression");

    assert.equal(target.calls.xhrSend.length, 0, "the request itself must never leave");
    assert.equal(xhr.readyState, 4, "a refused request must reach DONE, not sit at OPENED");
    assert.equal(xhr.status, 0, "status 0 is how an offline request presents");
    assert.deepEqual(
      events,
      ["readystatechange:4", "error", "loadend"],
      "the completion sequence must match a failed network request"
    );
  } finally {
    uninstall();
  }
});

test("a listener throwing during refusal does not stop the remaining completion events", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow(async () => new Response("", { status: 200 }));
  const uninstall = installPageAgent(target);

  try {
    sendConfig(target, PAGE_CHANNEL, {
      blockAds: true,
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: false,
      forceVideoQuality: false
    });

    const seen = [];
    const xhr = Object.create(target.XMLHttpRequest.prototype);
    xhr.onreadystatechange = () => {
      throw new Error("a page handler that throws");
    };
    xhr.onerror = () => seen.push("error");
    xhr.onloadend = () => seen.push("loadend");

    xhr.open("POST", "https://x.com/i/api/1.1/promoted_content/log.json");
    assert.doesNotThrow(() => xhr.send("event=impression"), "the refusal must not surface as a throw");
    assert.deepEqual(seen, ["error", "loadend"], "later events still have to fire");
  } finally {
    uninstall();
  }
});

test("teardown leaves a wrapper installed after Aviary's alone", async () => {
  const { installPageAgent, uninstallPageAgent, getLastUninstallOutcomes } =
    await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow(async () => new Response("", { status: 200 }));
  const originalFetch = target.fetch;

  installPageAgent(target);
  const aviaryFetch = target.fetch;
  assert.notEqual(aviaryFetch, originalFetch, "the agent must have wrapped fetch");

  // Somebody else wraps fetch after we did — X's own instrumentation, or another extension.
  const laterCalls = [];
  const laterWrapper = async (input, init) => {
    laterCalls.push(String(input));
    return aviaryFetch(input, init);
  };
  target.fetch = laterWrapper;

  uninstallPageAgent();

  assert.equal(target.fetch, laterWrapper, "teardown must not delete a later wrapper");
  assert.equal(getLastUninstallOutcomes().fetch, "wrapped-by-another", "and must say so");
  await target.fetch("https://x.com/i/api/graphql/abc/HomeTimeline");
  assert.equal(laterCalls.length, 1, "the later wrapper must still be in the chain");
});

test("teardown restores fetch when it is still ours", async () => {
  const { installPageAgent, uninstallPageAgent, getLastUninstallOutcomes } =
    await importSourceModule("src/page/page-agent.ts");
  const target = fakeWindow(async () => new Response("", { status: 200 }));
  const originalFetch = target.fetch;

  installPageAgent(target);
  uninstallPageAgent();

  assert.equal(target.fetch, originalFetch, "the ordinary path must restore exactly");
  assert.equal(getLastUninstallOutcomes().fetch, "restored");
});
