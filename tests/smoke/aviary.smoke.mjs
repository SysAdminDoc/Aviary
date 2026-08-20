// Playwright smoke spec for Aviary (F099).
//
// The page is served at the x.com origin so the production MV3 match patterns, page-world
// handshake, storage backend, and isolated content script all run unchanged. Playwright fulfills
// that navigation with the checked-in sanitized current-X fixture, so this lane never needs a
// signed-in profile or sends a request to a third-party account.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = path.join(root, "dist", "extension-chrome");
const fixturePath = path.join(root, "tests", "smoke", "current-x-home.html");

if (!existsSync(extensionDir)) {
  console.error("Build the extension first: `npm run build`.");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not installed. Run:\n  npm install --save-dev playwright@1.62.1\n  npx playwright install chromium"
  );
  process.exit(3);
}

const fixtureHtml = await readFile(fixturePath, "utf8");
const fixtureDocumentPaths = new Set([
  "/home",
  "/alice_fixture",
  "/alice_fixture/followers",
  "/alice_fixture/following",
  "/alice_fixture/verified_followers",
  "/search",
  "/notifications",
  "/messages",
  "/alice_fixture/status/123456789",
  "/i/media_viewer",
  "/selector-degraded"
]);
const degradedFixtureHtml = fixtureHtml.replace(/<main data-testid="primaryColumn">[\s\S]*?<\/main>/, "");
const mseMetadata = JSON.stringify({
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
                      rest_id: "123456789",
                      legacy: {
                        extended_entities: {
                          media: [
                            {
                              type: "video",
                              media_key: "7_456789",
                              preview_image_url_https:
                                "https://pbs.twimg.com/media/456789?format=jpg&name=small",
                              video_info: {
                                variants: [
                                  {
                                    content_type: "video/mp4",
                                    url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4",
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
const masterPlaylist = [
  "#EXTM3U",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  "#EXT-X-STREAM-INF:BANDWIDTH=256000,RESOLUTION=320x180",
  "/low.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360",
  "/mid.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720",
  "/high.m3u8",
  ""
].join("\n");

const userDataDir = await mkdtemp(path.join(tmpdir(), "aviary-smoke-"));
let context;
const pageErrors = [];
const consoleErrors = [];

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function openSection(page, section) {
  await page.evaluate((id) => {
    const host = document.querySelector("#av-control-center");
    const button = host?.shadowRoot?.querySelector(`[data-av-section="${id}"]`);
    if (!(button instanceof HTMLElement)) {
      throw new Error(`Control Center section missing: ${id}`);
    }
    button.click();
  }, section);
  await page.waitForTimeout(100);
}

async function commitSettings(page) {
  const committed = await page.evaluate(() => {
    const save = document
      .querySelector("#av-control-center")
      ?.shadowRoot?.querySelector(".av-transaction-save");
    if (!(save instanceof HTMLElement) || save.hasAttribute("disabled")) return false;
    save.click();
    return true;
  });
  if (!committed) return;
  await page.waitForFunction(
    () => document.querySelector("#av-control-center")?.getAttribute("data-av-draft-state") === "clean",
    null,
    { timeout: 5_000 }
  );
}

async function setToggle(page, section, label, checked, settleMs = 350) {
  await openSection(page, section);
  const changed = await page.evaluate(({ label, checked }) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const input = row?.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Toggle missing: ${label}`);
    }
    if (input.checked !== checked) {
      input.click();
      input.blur();
      return true;
    }
    return false;
  }, { label, checked });
  if (changed) {
    await commitSettings(page);
  }
  await page.waitForTimeout(settleMs);
}

const pageHookControls = [
  { section: "trust", label: "Refuse X's analytics beacons", key: "blockBeacons" },
  { section: "export", label: "Preserve raw payloads", key: "captureGraphql" },
  { section: "media", label: "Show download buttons", key: "captureMediaMetadata" },
  { section: "performance", label: "Pin video playlists to their best rendition", key: "forceVideoQuality" }
];

async function setPageHookConfiguration(page, config) {
  for (const control of pageHookControls) {
    await setToggle(page, control.section, control.label, Boolean(config[control.key]), 180);
  }
}

async function navigateSmokeRoute(page, nextPath) {
  await page.goto(`https://x.com${nextPath}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
    timeout: 15_000
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")),
    null,
    { timeout: 15_000 }
  );
  await page.waitForTimeout(120);
}

async function runFixtureRouteMatrix(page) {
  const routes = [
    "/home",
    "/home?tab=following",
    "/alice_fixture",
    "/alice_fixture/followers",
    "/alice_fixture/following",
    "/alice_fixture/verified_followers",
    "/notifications",
    "/messages",
    "/search?q=aviary",
    "/alice_fixture/status/123456789",
    "/i/media_viewer?url=https%3A%2F%2Fpbs.twimg.com%2Fmedia%2Ffixture"
  ];
  for (const route of routes) {
    await navigateSmokeRoute(page, route);
    const anchors = await page.evaluate(() => ({
      ready: document.documentElement.dataset.avReady === "true",
      panel: Boolean(document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")),
      primary: Boolean(document.querySelector('[data-testid="primaryColumn"]'))
    }));
    expect(Object.values(anchors).every(Boolean), `fixture route did not boot: ${route} ${JSON.stringify(anchors)}`);
  }
  await navigateSmokeRoute(page, "/home");
  console.log(`[smoke] deterministic fixture route matrix passed (${routes.length} routes, including profile subroutes, Notifications, Messages, Search, status, and media viewer).`);
}

async function runPageHookMatrix(page) {
  const routes = [
    "/home",
    "/home?tab=following",
    "/alice_fixture",
    "/search?q=aviary",
    "/alice_fixture/status/123456789"
  ];
  const configs = Array.from({ length: 16 }, (_, mask) => ({
    blockBeacons: Boolean(mask & 1),
    captureGraphql: Boolean(mask & 2),
    captureMediaMetadata: Boolean(mask & 4),
    forceVideoQuality: Boolean(mask & 8)
  }));
  const matrixErrors = pageErrors.length;

  for (const [index, config] of configs.entries()) {
    const beforeErrors = pageErrors.length;
    await setPageHookConfiguration(page, config);
    const probe = await page.evaluate(async () => {
      const telemetry = await fetch("/i/api/1.1/jot/client_event.json", {
        method: "POST",
        body: "fixture telemetry"
      });
      const graphql = await fetch("/i/api/graphql/fixture/PageHookProbe");
      const playlist = await fetch("https://video.twimg.com/fixture/master.m3u8");
      const graphqlBody = await graphql.text();
      const playlistBody = await playlist.text();
      const beaconAccepted = navigator.sendBeacon(
        "/i/api/1.1/jot/client_event.json",
        "fixture beacon"
      );
      return {
        telemetryStatus: telemetry.status,
        graphqlStatus: graphql.status,
        graphqlBody,
        playlistStatus: playlist.status,
        playlistBody,
        beaconAccepted
      };
    });

    expect(
      probe.telemetryStatus === (config.blockBeacons ? 204 : 200),
      "analytics hook response drifted for config " + JSON.stringify(config)
    );
    expect(
      probe.graphqlStatus === 200 && probe.graphqlBody.includes("\"data\""),
      "GraphQL probe failed for config " + JSON.stringify(config)
    );
    expect(
      probe.playlistStatus === 200 && probe.playlistBody.includes("/high.m3u8"),
      "playlist probe failed for config " + JSON.stringify(config)
    );
    expect(
      config.forceVideoQuality
        ? !probe.playlistBody.includes("/low.m3u8") && !probe.playlistBody.includes("/mid.m3u8")
        : probe.playlistBody.includes("/low.m3u8") && probe.playlistBody.includes("/mid.m3u8"),
      "playlist hook response drifted for config " + JSON.stringify(config)
    );
    expect(probe.beaconAccepted === true, "beacon probe was not acknowledged");

    await navigateSmokeRoute(page, routes[index % routes.length]);
    expect(
      pageErrors.length === beforeErrors,
      "route/config produced an uncaught page error for " + JSON.stringify(config)
    );
  }

  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const route of routes) {
      await navigateSmokeRoute(page, route);
    }
  }
  await setPageHookConfiguration(page, {
    blockBeacons: false,
    captureGraphql: false,
    captureMediaMetadata: false,
    forceVideoQuality: false
  });
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
    timeout: 15_000
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")),
    null,
    { timeout: 15_000 }
  );
  expect(pageErrors.length === matrixErrors, "page-hook matrix added uncaught page errors");
  console.log("[smoke] 16 page-hook configurations and 3 repeated Home/Following/profile route cycles passed.");
}

async function selectValue(page, section, label, value) {
  await openSection(page, section);
  const changed = await page.evaluate(({ label, value }) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const select = row?.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error(`Select missing: ${label}`);
    }
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }, { label, value });
  if (changed) await commitSettings(page);
  await page.waitForTimeout(450);
}

async function setText(page, section, label, value) {
  await openSection(page, section);
  await page.evaluate(({ label, value }) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const input = row?.querySelector('input[type="text"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Text editor missing: ${label}`);
    }
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, { label, value });
  await commitSettings(page);
  await page.waitForTimeout(450);
}

async function selectLocale(page, value) {
  await openSection(page, "presets");
  const changed = await page.evaluate((value) => {
    const host = document.querySelector("#av-control-center");
    const select = [...(host?.shadowRoot?.querySelectorAll("select") ?? [])].find((candidate) =>
      [...candidate.options].some((option) => option.value === value)
    );
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error(`Locale select missing: ${value}`);
    }
    if (select.value === value) return false;
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  if (changed) await commitSettings(page);
  await page.waitForTimeout(450);
}

async function clickAction(page, section, label) {
  await openSection(page, section);
  await page.evaluate((label) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const button = row?.querySelector("button");
    if (!(button instanceof HTMLElement)) {
      throw new Error(`Action missing: ${label}`);
    }
    button.click();
  }, label);
}

async function rowText(page, section, label) {
  await openSection(page, section);
  return page.evaluate((label) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    return row?.textContent ?? "";
  }, label);
}

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    // Classic headless skips MV3, while Chromium's new headless mode keeps the extension loaded
    // without opening a physical window for local runs or CI.
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--headless=new",
      "--no-sandbox"
    ]
  });
  console.log(`[smoke] service workers: ${context.serviceWorkers().map((worker) => worker.url()).join(", ") || "none"}`);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(`${message.text()} @ ${message.location().url}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.route("https://pbs.twimg.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    });
  });
  await page.route("https://video.twimg.com/**", async (route) => {
    if (route.request().url().includes(".m3u8")) {
      await route.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: masterPlaylist });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture video route not found" });
  });
  await page.route("https://x.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/home" || (route.request().resourceType() === "document" && fixtureDocumentPaths.has(url.pathname))) {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: url.pathname === "/selector-degraded" ? degradedFixtureHtml : fixtureHtml
      });
      return;
    }
    if (url.pathname === "/favicon.ico") {
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>" });
      return;
    }
    if (url.pathname.startsWith("/i/api/graphql/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: mseMetadata });
      return;
    }
    if (url.pathname.includes("/jot/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    if (url.pathname === "/aria2-failure/jsonrpc") {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"fixture failure"}' });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture route not found" });
  });

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, { timeout: 15_000 });
  await page.waitForSelector("#av-control-center", { state: "attached", timeout: 15_000 });
  await page.waitForFunction(
    () => Boolean(document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")),
    null,
    { timeout: 15_000 }
  );
  console.log("[smoke] isolated current-X fixture booted through the MV3 content script.");

  const anchors = await page.evaluate(() => ({
    root: Boolean(document.querySelector("#react-root")),
    primary: Boolean(document.querySelector('[data-testid="primaryColumn"]')),
    navigation: Boolean(document.querySelector('[data-testid^="AppTabBar_"]')),
    article: Boolean(document.querySelector('article[data-testid="tweet"]')),
    composer: Boolean(document.querySelector('[data-testid="tweetTextarea_0"]')),
    grok: Boolean(document.querySelector('a[href="/i/grok"]'))
  }));
  expect(Object.values(anchors).every(Boolean), `current-X fixture anchors missing: ${JSON.stringify(anchors)}`);

  await runFixtureRouteMatrix(page);

  await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const button = host?.shadowRoot?.querySelector(".av-launcher");
    if (!(button instanceof HTMLElement)) throw new Error("Launcher button missing");
    button.click();
  });
  await page.waitForTimeout(250);
  console.log("[smoke] Control Center launcher mounted and opened.");
  await runPageHookMatrix(page);

  // Width tiers must remain distinct after current X's flex item consumes the available row.
  await selectValue(page, "appearance", "Timeline width", "comfortable");
  const comfortable = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="primaryColumn"]');
    const style = node ? getComputedStyle(node) : null;
    return {
      width: style?.width ?? "",
      flexBasis: style?.flexBasis ?? "",
      rect: node?.getBoundingClientRect().width ?? 0,
      setting: document.documentElement.dataset.avWidth ?? ""
    };
  });
  await selectValue(page, "appearance", "Timeline width", "wide");
  const wide = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="primaryColumn"]');
    const style = node ? getComputedStyle(node) : null;
    return {
      width: style?.width ?? "",
      flexBasis: style?.flexBasis ?? "",
      rect: node?.getBoundingClientRect().width ?? 0,
      setting: document.documentElement.dataset.avWidth ?? ""
    };
  });
  expect(comfortable.setting === "comfortable" && wide.setting === "wide", "width settings did not settle");
  expect(comfortable.flexBasis !== wide.flexBasis, `width flex tiers collapsed: ${JSON.stringify({ comfortable, wide })}`);
  expect(comfortable.width !== wide.width, `width computed tiers collapsed: ${JSON.stringify({ comfortable, wide })}`);
  console.log(`[smoke] width tiers: ${JSON.stringify({ comfortable, wide })}`);

  // Current Grok surfaces all share the hide switch and return when it is reversed.
  await setToggle(page, "layout", "Hide Grok surfaces", true);
  const grokHidden = await page.evaluate(() =>
    [
      '[data-testid="GrokDrawer"]',
      '[data-testid="grokImgGen"]',
      'a[href="/i/grok"]',
      'button[aria-label="Grok actions"]'
    ].map((selector) => getComputedStyle(document.querySelector(selector)).display)
  );
  expect(grokHidden.every((display) => display === "none"), `Grok surfaces remained visible: ${grokHidden.join(",")}`);
  await setToggle(page, "layout", "Hide Grok surfaces", false);
  const grokRestored = await page.evaluate(() =>
    [
      '[data-testid="GrokDrawer"]',
      '[data-testid="grokImgGen"]',
      'a[href="/i/grok"]',
      'button[aria-label="Grok actions"]'
    ].every((selector) => getComputedStyle(document.querySelector(selector)).display !== "none")
  );
  expect(grokRestored, "Grok surfaces did not return after the toggle was reversed");
  console.log("[smoke] current Grok drawer, image-generation, nav, and action anchors toggle cleanly.");

  // MediaSource players begin with a blob URL and only gain a Video control after page-world
  // GraphQL metadata arrives. Current X delivers HomeTimeline through XHR, so this must exercise
  // that transport rather than the older fetch-only path. The same setting is cycled off and back
  // on to catch stale buttons.
  await setToggle(page, "media", "Show download buttons", true);
  await page.waitForFunction(
    () => document.querySelectorAll("[data-av-media-button]").length >= 2,
    null,
    { timeout: 8_000 }
  );
  const beforeMetadata = await page.evaluate(() =>
    [...document.querySelectorAll("[data-av-media-button]")].map((button) => button.getAttribute("data-av-media-button")).sort()
  );
  const beforePostAction = await page.evaluate(() => {
    const button = document.querySelector("[data-av-media-action]");
    return button && "disabled" in button ? Boolean(button.disabled) : null;
  });
  await page.evaluate(() => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/i/api/graphql/fixture/HomeTimeline");
      xhr.responseType = "json";
      xhr.onload = () => xhr.status === 200
        ? resolve(xhr.response)
        : reject(new Error(`fixture GraphQL failed: ${xhr.status}`));
      xhr.onerror = () => reject(new Error("fixture GraphQL XHR failed"));
      xhr.send("variables={}");
    });
  });
  await page.waitForFunction(
    () => {
      const video = document.querySelector('[data-av-media-button="video"]');
      const action = document.querySelector('[data-av-media-action]:not(:disabled)');
      return Boolean(video && action);
    },
    null,
    { timeout: 8_000 }
  );
  const afterMetadata = await page.evaluate(() =>
    [...document.querySelectorAll("[data-av-media-button]")].map((button) => button.getAttribute("data-av-media-button")).sort()
  );
  expect(beforeMetadata.includes("thumbnail") && !beforeMetadata.includes("video"), `blob player exposed an invalid control: ${beforeMetadata}`);
  expect(beforePostAction === false, `blob player action was not initially actionable: ${beforePostAction}`);
  expect(afterMetadata.includes("thumbnail") && afterMetadata.includes("video"), `MSE metadata did not add Video: ${afterMetadata}`);
  await setToggle(page, "media", "Show download buttons", false);
  await page.waitForFunction(() => document.querySelectorAll("[data-av-media-button]").length === 0, null, { timeout: 8_000 });
  await setToggle(page, "media", "Show download buttons", true);
  await page.waitForFunction(() => Boolean(document.querySelector('[data-av-media-button="video"]')), null, { timeout: 8_000 });
  await setToggle(page, "media", "Show download buttons", false);
  await page.waitForFunction(() => document.querySelectorAll("[data-av-media-button]").length === 0, null, { timeout: 8_000 });
  console.log(`[smoke] MSE media controls settled from ${JSON.stringify(beforeMetadata)} to ${JSON.stringify(afterMetadata)} and cleaned up on off cycles.`);

  // Locale changes must reach both the shadow host and current X's primary column.
  await selectLocale(page, "he");
  const rtl = await page.evaluate(() => ({
    host: document.querySelector("#av-control-center")?.getAttribute("dir") ?? "",
    page: getComputedStyle(document.documentElement).direction,
    primary: getComputedStyle(document.querySelector('[data-testid="primaryColumn"]')).direction,
    marker: document.documentElement.classList.contains("av-rtl")
  }));
  expect(rtl.host === "rtl" && rtl.primary === "rtl" && rtl.marker, `RTL direction did not settle: ${JSON.stringify(rtl)}`);
  await selectLocale(page, "en");
  const ltr = await page.evaluate(() => ({
    host: document.querySelector("#av-control-center")?.getAttribute("dir") ?? "",
    primary: getComputedStyle(document.querySelector('[data-testid="primaryColumn"]')).direction
  }));
  expect(ltr.host === "ltr" && ltr.primary === "ltr", `LTR restoration failed: ${JSON.stringify(ltr)}`);
  console.log(`[smoke] RTL direction mirrored and restored: ${JSON.stringify({ rtl, ltr })}`);

  // A local snapshot mutation must repaint its count while the panel stays open.
  await clickAction(page, "snapshots", "Capture followers from this view");
  await page.waitForFunction(
    () => [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-row") ?? [])]
      .some((row) => row.querySelector(".av-row-label")?.textContent === "Snapshots stored" && row.textContent?.includes("1 entries")),
    null,
    { timeout: 8_000 }
  );
  const snapshotAfterCapture = await rowText(page, "snapshots", "Snapshots stored");
  await clickAction(page, "snapshots", "Clear all snapshots");
  await page.waitForFunction(
    () => [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-row") ?? [])]
      .some((row) => row.querySelector(".av-row-label")?.textContent === "Snapshots stored" && row.textContent?.includes("0 entries")),
    null,
    { timeout: 8_000 }
  );
  const snapshotAfterClear = await rowText(page, "snapshots", "Snapshots stored");
  console.log(`[smoke] snapshot readout refreshed: ${JSON.stringify({ snapshotAfterCapture, snapshotAfterClear })}`);

  // The Integrations section is exercised against a same-origin fixture failure below.
  // The action path is exercised against a same-origin fixture failure: no real service is
  // contacted, but the real integration callback must surface the failure and re-enable itself.
  await setToggle(page, "trust", "Local-only mode", false);
  await setText(page, "integrations", "Aria2 endpoint", "https://x.com/aria2-failure");
  await clickAction(page, "integrations", "Test Aria2 connection");
  await page.waitForFunction(
    () => document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-status")?.textContent?.includes("Aria2 unreachable"),
    null,
    { timeout: 8_000 }
  );
  const actionProbe = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === "Test Aria2 connection"
    );
    return {
      status: host?.shadowRoot?.querySelector(".av-status")?.textContent ?? "",
      disabled: row?.querySelector("button")?.disabled ?? null
    };
  });
  expect(actionProbe.disabled === false && actionProbe.status.includes("Aria2 unreachable"), `rejected action did not settle visibly: ${JSON.stringify(actionProbe)}`);
  console.log(`[smoke] rejected integration action reported and recovered: ${JSON.stringify(actionProbe)}`);

  // Selector health is a live state machine: disabled, healthy, degraded, then healthy again.
  await setToggle(page, "trust", "Monitor selector health", false);
  const disabledHealth = await rowText(page, "trust", "Selector health");
  expect(disabledHealth.includes("Disabled"), `selector health did not disable: ${disabledHealth}`);
  await setToggle(page, "trust", "Monitor selector health", true);
  const healthyHealth = await rowText(page, "trust", "Selector health");
  expect(healthyHealth.includes("Healthy"), `selector health did not recover: ${healthyHealth}`);
  await navigateSmokeRoute(page, "/selector-degraded");
  const degradedHealth = await rowText(page, "trust", "Selector health");
  expect(degradedHealth.includes("Degraded"), `selector health did not degrade: ${degradedHealth}`);
  await navigateSmokeRoute(page, "/home");
  const recoveredHealth = await rowText(page, "trust", "Selector health");
  expect(recoveredHealth.includes("Healthy"), `selector health did not recover after navigation: ${recoveredHealth}`);
  console.log(`[smoke] selector health transitions settled: ${JSON.stringify({ disabledHealth, healthyHealth, degradedHealth, recoveredHealth })}`);

  expect(pageErrors.length === 0, `uncaught page errors: ${pageErrors.join(" | ")}`);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !message.includes("net::ERR_FILE_NOT_FOUND") &&
      !message.includes("the server responded with a status of 503 (Service Unavailable)")
  );
  expect(unexpectedConsoleErrors.length === 0, `browser console errors: ${unexpectedConsoleErrors.join(" | ")}`);
} finally {
  await context?.close();
  await rm(userDataDir, { force: true, recursive: true });
}

console.log("[smoke] All current-X compatibility assertions passed.");
