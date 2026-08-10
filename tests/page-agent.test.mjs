import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("the telemetry matcher cannot match a GraphQL request", async () => {
  const { isTelemetryUrl, isGraphqlUrl } = await importBundledModule("src/page/page-agent.ts");

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
});

test("installing the agent patches nothing until a config enables a hook", async () => {
  const { installPageAgent } = await importBundledModule("src/page/page-agent.ts");
  const target = fakeWindow();

  const uninstall = installPageAgent(target);
  try {
    // Installed, but every hook is off: a telemetry call still reaches the original fetch.
    const response = await target.fetch("https://x.com/i/api/1.1/jot/client_event.json");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "original");

    assert.equal(target.navigator.sendBeacon("https://x.com/i/api/1.1/jot/client_event.json"), true);
    assert.equal(target.calls.beacon.length, 1, "the original sendBeacon must have run");
  } finally {
    uninstall();
  }
});

test("an enabled beacon hook refuses telemetry and reports it, without disturbing the timeline", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importBundledModule("src/page/page-agent.ts");

  const target = fakeWindow(async (input) => new Response(`served:${String(input)}`, { status: 200 }));
  const events = [];
  const uninstall = installPageAgent(target, (envelope) => events.push(envelope));

  try {
    sendConfig(target, PAGE_CHANNEL, {
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
  } finally {
    uninstall();
  }
});

test("page-agent config and teardown require the negotiated session nonce", async () => {
  const { installPageAgent, PAGE_CHANNEL } = await importBundledModule("src/page/page-agent.ts");
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
  const { installPageAgent, PAGE_CHANNEL } = await importBundledModule("src/page/page-agent.ts");
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
  const { rewritePlaylistToBestVariant } = await importBundledModule("src/page/page-agent.ts");

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
  const { rewritePlaylistToBestVariant } = await importBundledModule("src/page/page-agent.ts");

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
  const { installPageAgent, PAGE_CHANNEL } = await importBundledModule("src/page/page-agent.ts");

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
  const { installPageAgent, PAGE_CHANNEL } = await importBundledModule("src/page/page-agent.ts");

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
  const { installPageAgent, PAGE_CHANNEL } = await importBundledModule("src/page/page-agent.ts");

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

test("teardown restores the exact references it replaced", async () => {
  const { installPageAgent } = await importBundledModule("src/page/page-agent.ts");
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

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-page-"));
  const outfile = path.join(temp, "module.mjs");

  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function sendConfig(target, channel, config) {
  const nonce = "test-session-nonce-1234";
  target.postMessage({ channel, kind: "hello", nonce });
  target.postMessage({ channel, kind: "config", nonce, payload: config });
}
