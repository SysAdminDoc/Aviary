import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * What the isolated world sees when something else answers the page agent first.
 *
 * A later `hello` cannot displace a standing channel -- that half landed with the transferred
 * `MessagePort`. What was left is the case the port cannot fix: a script that wins the *very first*
 * `hello` owns the agent, and the real bridge then sat out a three-second timeout and reported
 * `agent-absent`, which reads as "this browser did not load Aviary's page script". That is the one
 * thing that is definitely not true, and it hides the part that matters -- the default-on ad guard
 * is answering to somebody else.
 *
 * `page.evaluate` runs in the page's own world, which is exactly the squatter's position.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-squatter-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { installPageAgent, uninstallPageAgent, PAGE_CHANNEL } from ${JSON.stringify(abs("src/page/page-agent.ts"))};`,
      `export { createPageBridge } from ${JSON.stringify(abs("src/platform/page-bridge.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviarySquatter",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  // A real origin, not about:blank: the bridge posts its `hello` with `location.origin` as the
  // target origin, and an opaque origin serializes to "null", which postMessage rejects outright.
  const context = await browser.newContext();
  await context.route("https://x.com/home", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><meta charset=utf-8><body></body>" })
  );
  page = await context.newPage();
  await page.goto("https://x.com/home");
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.diagnosticsStub = () => {
      const events = [];
      return {
        events,
        sink: {
          info: (message, details) => events.push({ level: "info", message, details }),
          warn: (message, details) => events.push({ level: "warn", message, details }),
          error: (message, details) => events.push({ level: "error", message, details })
        }
      };
    };
    /** Takes the agent the way another extension's MAIN-world script would. */
    window.squat = (nonce) => {
      const channel = new MessageChannel();
      const seen = [];
      channel.port1.onmessage = (event) => seen.push(event.data);
      channel.port1.start();
      window.postMessage(
        { channel: AviarySquatter.PAGE_CHANNEL, kind: "hello", nonce, payload: undefined },
        "*",
        [channel.port2]
      );
      return seen;
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("a bridge that arrives after a squatter is told an agent is here, not that none is", async () => {
  const observed = await page.evaluate(async () => {
    AviarySquatter.uninstallPageAgent();
    AviarySquatter.installPageAgent(window);
    const squatterSaw = window.squat("squatter-nonce-0123456789");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const diagnostics = window.diagnosticsStub();
    const started = performance.now();
    const bridge = AviarySquatter.createPageBridge({ source: "extension", diagnostics: diagnostics.sink });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const settled = {
      status: bridge.status(),
      reason: bridge.reason(),
      elapsed: performance.now() - started,
      warned: diagnostics.events.filter((event) => event.level === "warn").map((event) => event.message)
    };
    bridge.destroy();
    AviarySquatter.uninstallPageAgent();
    return { settled, squatterAdopted: squatterSaw.length > 0 };
  });

  // The guard: if the squatter never actually took the channel, the refusal below proves nothing.
  assert.equal(observed.squatterAdopted, true, "the squatter never got a control channel");

  assert.equal(observed.settled.status, "unavailable");
  assert.equal(
    observed.settled.reason,
    "agent-taken",
    "the bridge reported the wrong reason for an agent it could not reach"
  );
  // And says so at once rather than after the three-second handshake timeout.
  assert.ok(
    observed.settled.elapsed < 1000,
    `the bridge waited ${Math.round(observed.settled.elapsed)}ms before reporting`
  );
  assert.ok(
    observed.settled.warned.some((message) => /already bound/i.test(message)),
    `diagnostics recorded ${JSON.stringify(observed.settled.warned)}`
  );
});

test("media metadata observed before feature startup replays once without buffering responses", async () => {
  const body = JSON.stringify({
    data: {
      home: {
        instructions: [
          {
            entries: [
              {
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: "early-media-1",
                        legacy: {
                          extended_entities: {
                            media: [
                              {
                                type: "video",
                                media_key: "7_early-media-1",
                                preview_image_url_https:
                                  "https://pbs.twimg.com/media/EarlyMedia1?format=jpg&name=small",
                                video_info: {
                                  variants: [
                                    {
                                      content_type: "video/mp4",
                                      url: "https://video.twimg.com/ext_tw_video/early/pu/vid/1280x720/direct.mp4",
                                      bitrate: 2176000
                                    }
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        ]
      }
    }
  });
  let served = 0;
  const routeHandler = async (route) => {
    served += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body
    });
  };
  await page.route("https://x.com/i/api/graphql/**", routeHandler);

  const observed = await page.evaluate(async () => {
    AviarySquatter.uninstallPageAgent();
    const originalFetch = window.fetch;
    const diagnostics = {
      info() {},
      warn() {},
      error() {}
    };
    AviarySquatter.installPageAgent(window);
    const bridge = AviarySquatter.createPageBridge({ source: "extension", diagnostics });
    bridge.configure({
      blockAds: false,
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata: true,
      forceVideoQuality: false
    });
    const deadline = performance.now() + 1_000;
    while (bridge.status() !== "connected" && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const url = "https://x.com/i/api/graphql/early/HomeTimeline";
    await (await fetch(url)).text();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const xhr = new XMLHttpRequest();
    const xhrDone = new Promise((resolve) => {
      xhr.addEventListener("loadend", resolve, { once: true });
    });
    xhr.open("POST", url);
    xhr.send("{}");
    await xhrDone;
    await new Promise((resolve) => setTimeout(resolve, 30));

    const replayed = [];
    bridge.onMediaMetadata((metadata) => replayed.push(metadata));
    const afterFirstSubscription = replayed.length;
    const secondSubscriber = [];
    bridge.onMediaMetadata((metadata) => secondSubscriber.push(metadata));
    const afterSecondSubscription = secondSubscriber.length;

    bridge.destroy();
    AviarySquatter.uninstallPageAgent();
    window.fetch = originalFetch;
    return {
      status: bridge.status(),
      afterFirstSubscription,
      afterSecondSubscription,
      replayed: replayed.map((metadata) => ({
      keys: Object.keys(metadata).sort(),
      tweetId: metadata.tweetId,
      variant: metadata.variants[0]?.url,
        hasBody: Object.hasOwn(metadata, "body")
      }))
    };
  });

  await page.unroute("https://x.com/i/api/graphql/**", routeHandler);
  assert.equal(served, 2, "the first fetch and XHR should be the only network responses");
  assert.equal(observed.status, "unavailable", "destroy must tear the bridge down");
  assert.equal(observed.afterFirstSubscription, 1, "duplicate early observations replay once");
  assert.equal(observed.afterSecondSubscription, 0, "a drained replay must not replay again");
  assert.deepEqual(observed.replayed, [
    {
      keys: ["audioVariants", "isGif", "mediaId", "poster", "subtitleTracks", "tweetId", "variants"],
      tweetId: "early-media-1",
      variant:
        "https://video.twimg.com/ext_tw_video/early/pu/vid/1280x720/direct.mp4",
      hasBody: false
    }
  ]);
});

test("media replay has explicit record and byte bounds and clears when capture is disabled", async () => {
  const body = JSON.stringify({
    data: {
      timeline: Array.from({ length: 80 }, (_, index) => ({
        rest_id: `bounded-tweet-${index}`,
        legacy: {
          private_token: "should-never-be-replayed",
          extended_entities: {
            media: [
              {
                type: "video",
                media_key: `7_bounded-${index}`,
                preview_image_url_https:
                  `https://pbs.twimg.com/media/Bounded${index}?format=jpg&name=small`,
                video_info: {
                  variants: [
                    {
                      content_type: "video/mp4",
                      url: `https://video.twimg.com/ext_tw_video/bounded/${index}/pu/vid/640x360/direct.mp4`,
                      bitrate: 832000
                    }
                  ]
                }
              }
            ]
          }
        }
      }))
    }
  });
  const routeHandler = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body
    });
  };
  await page.route("https://x.com/i/api/graphql/**", routeHandler);

  const observed = await page.evaluate(async () => {
    AviarySquatter.uninstallPageAgent();
    const diagnostics = { warnings: [], info() {}, warn(message, details) {
      this.warnings.push({ message, details });
    }, error() {} };
    AviarySquatter.installPageAgent(window);
    const bridge = AviarySquatter.createPageBridge({ source: "extension", diagnostics });
    const config = (captureMediaMetadata) => bridge.configure({
      blockAds: false,
      blockBeacons: false,
      captureGraphql: false,
      captureMediaMetadata,
      forceVideoQuality: false
    });
    config(true);
    const deadline = performance.now() + 1_000;
    while (bridge.status() !== "connected" && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await (await fetch("https://x.com/i/api/graphql/bounded/HomeTimeline")).text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const bounded = [];
    const boundedHandler = (metadata) => bounded.push(metadata);
    bridge.onMediaMetadata(boundedHandler);
    bridge.offMediaMetadata(boundedHandler);

    config(true);
    await (await fetch("https://x.com/i/api/graphql/bounded/HomeTimeline")).text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    config(false);
    const replayed = [];
    bridge.onMediaMetadata((metadata) => replayed.push(metadata));
    const serialized = JSON.stringify(bounded);
    const warningCodes = diagnostics.warnings
      .map((entry) => entry.details?.code)
      .filter(Boolean);
    bridge.destroy();
    AviarySquatter.uninstallPageAgent();
    return {
      bounded: bounded.length,
      replayed: replayed.length,
      serialized,
      warningCodes
    };
  });

  await page.unroute("https://x.com/i/api/graphql/**", routeHandler);
  assert.equal(observed.bounded, 64, "record retention must stop at the documented bound");
  assert.equal(observed.replayed, 0, "disabling capture must clear the queued metadata");
  assert.equal(observed.serialized.includes("should-never-be-replayed"), false);
  assert.deepEqual(observed.warningCodes, [
    "media-metadata-replay-overflow",
    "media-metadata-replay-overflow"
  ]);
});

test("with no agent at all the reason is still agent-absent, after the timeout", async () => {
  const observed = await page.evaluate(async () => {
    AviarySquatter.uninstallPageAgent();
    const diagnostics = window.diagnosticsStub();
    const bridge = AviarySquatter.createPageBridge({ source: "extension", diagnostics: diagnostics.sink });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const early = { status: bridge.status(), reason: bridge.reason() };
    // Past the three-second handshake timeout, which is what an absent agent looks like.
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const late = { status: bridge.status(), reason: bridge.reason() };
    bridge.destroy();
    return { early, late };
  });

  // Nothing answered, so the bridge is still waiting: an absent agent is a timeout, a taken one is
  // immediate, and the two must not collapse into one message.
  assert.deepEqual(observed.early, { status: "connecting", reason: "" });
  assert.deepEqual(observed.late, { status: "unavailable", reason: "agent-absent" });
});

test("the squatter keeps the channel; the refusal changes nothing about who holds it", async () => {
  const observed = await page.evaluate(async () => {
    AviarySquatter.uninstallPageAgent();
    AviarySquatter.installPageAgent(window);
    const squatterSaw = window.squat("squatter-nonce-0123456789");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const diagnostics = window.diagnosticsStub();
    const bridge = AviarySquatter.createPageBridge({ source: "extension", diagnostics: diagnostics.sink });
    bridge.configure({
      blockAds: true,
      blockBeacons: true,
      captureGraphql: false,
      captureMediaMetadata: false,
      forceVideoQuality: false
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    const result = {
      // A refused bridge must not keep pushing configuration at an agent it does not hold.
      squatterEnvelopes: squatterSaw.map((envelope) => envelope.kind),
      status: bridge.status()
    };
    bridge.destroy();
    AviarySquatter.uninstallPageAgent();
    return result;
  });

  assert.equal(observed.status, "unavailable");
  assert.ok(
    !observed.squatterEnvelopes.includes("config"),
    `the refused bridge sent ${JSON.stringify(observed.squatterEnvelopes)} to the squatter's port`
  );
});

test("a refusal for somebody else's nonce is ignored", async () => {
  const observed = await page.evaluate(async () => {
    AviarySquatter.uninstallPageAgent();
    const diagnostics = window.diagnosticsStub();
    const bridge = AviarySquatter.createPageBridge({ source: "extension", diagnostics: diagnostics.sink });
    // A page script inventing a refusal it did not receive. The nonce is not the bridge's, so the
    // bridge is not the one being answered.
    window.postMessage(
      {
        channel: AviarySquatter.PAGE_CHANNEL,
        kind: "refused",
        nonce: "not-this-bridges-nonce-000",
        payload: undefined
      },
      "*"
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    const settled = { status: bridge.status(), reason: bridge.reason() };
    bridge.destroy();
    return settled;
  });

  assert.equal(observed.status, "connecting");
  assert.equal(observed.reason, "");
});
