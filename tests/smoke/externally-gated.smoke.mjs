// Side-effect-free headed MV3 coverage for Control Center actions that normally need a browser
// permission, a local service, a user file, or a provider credential. Every provider is a local
// HTTP stub, the archive is generated in memory, and the browser profile is temporary. Chromium's
// new headless mode keeps the MV3 service worker loaded without opening a physical window.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

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

const TWEETS_JS = `window.YTD.tweets.part0 = ${JSON.stringify([
  {
    tweet: {
      id_str: "1750000000000000001",
      full_text: "An imported archive fixture record.",
      created_at: "Tue Jan 16 12:00:00 +0000 2026"
    }
  }
])}`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const masterPlaylist = [
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=256000",
  "/low.m3u8",
  "#EXT-X-STREAM-INF:BANDWIDTH=2176000",
  "/high.m3u8",
  ""
].join("\n");

function expect(condition, message) {
  assert.equal(Boolean(condition), true, message);
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const localBlocks = [];
  const centralBlocks = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(14, crc32(data), true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    localBlocks.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc32(data), true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralBlocks.push(central);
    offset += local.length + data.length;
  }

  const centralStart = offset;
  const centralSize = centralBlocks.reduce((total, block) => total + block.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralStart, true);

  const total = [...localBlocks, ...centralBlocks, end].reduce((sum, block) => sum + block.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const block of [...localBlocks, ...centralBlocks, end]) {
    output.set(block, cursor);
    cursor += block.length;
  }
  return output;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      let json;
      try {
        json = JSON.parse(body.toString("utf8"));
      } catch {
        json = undefined;
      }
      resolve({ body, json });
    });
    request.on("error", reject);
  });
}

async function startProviderServer() {
  const state = {
    requests: [],
    fail: { aria2: false, ai: false, embedding: false, mastodon: false },
    nextId: 1,
    aria2Gid: "fixture-gid-1"
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const { body, json } = await readRequestBody(request);
    state.requests.push({ method: request.method ?? "GET", path: url.pathname, body, json });
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type, authorization");
    response.setHeader("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/media/fixture.png") {
      response.writeHead(200, { "content-type": "image/png", "content-length": PNG.length }).end(PNG);
      return;
    }
    if (url.pathname.endsWith("/jsonrpc")) {
      if (state.fail.aria2) {
        response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: "fixture aria2 failure" }));
        return;
      }
      const method = json?.method;
      if (method === "aria2.getVersion") {
        sendJson(response, { result: { version: "1.37.0-fixture" } });
        return;
      }
      if (method === "aria2.addUri") {
        sendJson(response, { result: state.aria2Gid });
        return;
      }
      if (method === "aria2.tellActive") {
        sendJson(response, {
          result: [{ gid: state.aria2Gid, status: "active", totalLength: "128", completedLength: "64", files: [{ path: "fixture.png" }] }]
        });
        return;
      }
      if (method === "aria2.remove") {
        sendJson(response, { result: json?.params?.at(-1) ?? state.aria2Gid });
        return;
      }
      if (method === "aria2.tellStatus") {
        sendJson(response, { result: { status: "complete" } });
        return;
      }
      sendJson(response, { error: { code: -32601, message: "unknown fixture method" } }, 400);
      return;
    }
    if (url.pathname === "/ai/chat") {
      if (state.fail.ai) {
        sendJson(response, { error: { message: "fixture AI failure" } }, 503);
        return;
      }
      sendJson(response, { choices: [{ message: { content: "Fixture AI response copied locally." } }] });
      return;
    }
    if (url.pathname === "/embeddings") {
      if (state.fail.embedding) {
        sendJson(response, { error: { message: "fixture embedding failure" } }, 503);
        return;
      }
      sendJson(response, { data: [{ embedding: [1, 0, 0] }] });
      return;
    }
    if (url.pathname === "/bsky/xrpc/com.atproto.server.createSession") {
      sendJson(response, { accessJwt: "fixture-bsky-jwt", did: "did:plc:fixture" });
      return;
    }
    if (url.pathname === "/bsky/xrpc/com.atproto.repo.uploadBlob") {
      sendJson(response, { blob: { $type: "blob", ref: { $link: "fixture-blob" }, mimeType: "image/png", size: PNG.length } });
      return;
    }
    if (url.pathname === "/bsky/xrpc/com.atproto.repo.createRecord") {
      const rkey = `fixture-${state.nextId++}`;
      sendJson(response, { uri: `at://did:plc:fixture/app.bsky.feed.post/${rkey}`, cid: `cid-${rkey}` });
      return;
    }
    if (url.pathname === "/mastodon/api/v1/media") {
      sendJson(response, { id: "fixture-media-1" });
      return;
    }
    if (url.pathname === "/mastodon/api/v1/statuses") {
      if (state.fail.mastodon) {
        sendJson(response, { error: "fixture Mastodon failure" }, 503);
        return;
      }
      const id = `fixture-status-${state.nextId++}`;
      sendJson(response, { id, url: `http://127.0.0.1/fixture/${id}` });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" }).end("fixture route not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return {
    state,
    server,
    base: `http://localhost:${address.port}`,
    browserBase: "https://x.com/aviary-fixture"
  };
}

function sendJson(response, payload, status = 200) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) }).end(body);
}

function calls(state, path, method = "POST") {
  return state.requests.filter((request) => request.path === path && request.method === method);
}

function statusText(page) {
  return page.evaluate(() => document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-status")?.textContent ?? "");
}

async function openSection(page, section) {
  await page.evaluate((id) => {
    const host = document.querySelector("#av-control-center");
    const button = host?.shadowRoot?.querySelector(`[data-av-section="${id}"]`);
    if (!(button instanceof HTMLElement)) throw new Error(`Control Center section missing: ${id}`);
    button.click();
  }, section);
  await page.waitForTimeout(100);
}

async function setToggle(page, section, label, checked) {
  await openSection(page, section);
  await page.evaluate(({ label, checked }) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const input = row?.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) throw new Error(`Toggle missing: ${label}`);
    if (input.checked !== checked) {
      input.click();
      input.blur();
    }
  }, { label, checked });
  await page.waitForTimeout(500);
}

async function setField(page, section, label, value) {
  await openSection(page, section);
  await page.evaluate(({ label, value }) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const input = row?.querySelector("input, textarea");
    const save = [...(row?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Save");
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !(save instanceof HTMLElement)) {
      throw new Error(`Field missing: ${label}`);
    }
    input.value = value;
    save.click();
  }, { label, value });
  await page.waitForTimeout(500);
}

async function selectValue(page, section, label, value) {
  await openSection(page, section);
  await page.evaluate(({ label, value }) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const select = row?.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) throw new Error(`Select missing: ${label}`);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, { label, value });
  await page.waitForTimeout(500);
}

async function clickAction(page, section, label) {
  await openSection(page, section);
  await page.evaluate((label) => {
    const host = document.querySelector("#av-control-center");
    const row = [...(host?.shadowRoot?.querySelectorAll(".av-row") ?? [])].find(
      (candidate) => candidate.querySelector(".av-row-label")?.textContent === label
    );
    const button = row?.querySelector("button");
    if (!(button instanceof HTMLElement)) throw new Error(`Action missing: ${label}`);
    button.click();
  }, label);
}

async function waitStatus(page, text) {
  try {
    await page.waitForFunction((needle) => {
      const value = document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-status")?.textContent ?? "";
      return value.includes(needle);
    }, text, { timeout: 15_000 });
  } catch (error) {
    throw new Error(`${error.message}; expected ${JSON.stringify(text)}, current status ${JSON.stringify(await statusText(page))}; local calls ${JSON.stringify(provider?.state?.requests?.slice(-5).map((request) => ({ path: request.path, method: request.method, json: request.json })))}`);
  }
}

async function fillFileInput(page, section, label, file) {
  await openSection(page, section);
  const input = page.locator("#av-control-center input[type=file]");
  assert.equal(await input.count(), 1, `${label} file input missing`);
  await input.setInputFiles(file);
}

async function setComposerThread(page, text) {
  await page.evaluate((text) => {
    const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (!(composer instanceof HTMLElement)) throw new Error("composer fixture missing");
    composer.innerHTML = text.split("\n\n").map((part) => `<div data-block="true">${part}</div>`).join("");
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }, text);
}

async function clickCrosspost(page, label) {
  await openSection(page, "integrations");
  await page.evaluate(() => {
    const row = [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-row") ?? [])]
      .find((candidate) => candidate.querySelector(".av-row-label")?.textContent === "Crosspost as thread");
    const checkbox = row?.querySelector('input[type="checkbox"]');
    if (!(checkbox instanceof HTMLInputElement)) throw new Error("thread checkbox missing");
    if (!checkbox.checked) checkbox.click();
  });
  await page.evaluate((label) => {
    const row = [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-row") ?? [])]
      .find((candidate) => candidate.querySelector(".av-row-label")?.textContent === label);
    const button = row?.querySelector("button");
    if (!(button instanceof HTMLElement)) throw new Error(`Crosspost action missing: ${label}`);
    button.click();
  }, label);
}

async function readClipboard(page) {
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  });
}

const tempProfile = await mkdtemp(path.join(tmpdir(), "aviary-external-smoke-"));
const tempDownloads = await mkdtemp(path.join(tmpdir(), "aviary-external-downloads-"));
const provider = await startProviderServer();
let context;
let optionsPage;
const pageErrors = [];
const consoleErrors = [];
const browserHttpRequests = [];

try {
  context = await chromium.launchPersistentContext(tempProfile, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--headless=new",
      "--no-sandbox"
    ]
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://x.com" });
  context.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http://") || url.startsWith("https://")) browserHttpRequests.push(url);
  });

  await context.route("https://pbs.twimg.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  await context.route("https://video.twimg.com/**", async (route) => {
    if (route.request().url().includes(".m3u8")) {
      await route.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: masterPlaylist });
      return;
    }
    await route.fulfill({ status: 200, contentType: "video/mp4", body: Buffer.from("fixture-video") });
  });
  await context.route("https://x.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/aviary-fixture/")) {
      const forwardedHeaders = {};
      for (const name of ["accept", "authorization", "content-type"]) {
        const value = route.request().headers()[name];
        if (value) forwardedHeaders[name] = value;
      }
      const method = route.request().method();
      const upstream = await fetch(`${provider.base}${url.pathname.slice("/aviary-fixture".length)}${url.search}`, {
        method,
        headers: forwardedHeaders,
        body: method === "GET" || method === "HEAD" ? undefined : route.request().postDataBuffer() ?? undefined
      });
      await route.fulfill({
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
        body: Buffer.from(await upstream.arrayBuffer())
      });
      return;
    }
    if (url.pathname === "/home") {
      await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml });
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
    await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture route not found" });
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, { timeout: 15_000 });
  await page.waitForFunction(
    () => Boolean(document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")),
    null,
    { timeout: 15_000 }
  );
  await setToggle(page, "trust", "Local-only mode", false);

  const worker = await waitForServiceWorker(context);
  const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  assert.ok(extensionId, "MV3 service worker did not expose an extension id");
  optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
  await optionsPage.waitForSelector("#downloads-state");
  expect((await optionsPage.locator("#downloads-state").textContent()) === "not granted", "downloads permission started granted");
  expect((await optionsPage.locator("#media-state").textContent()) === "not granted", "media host permission started granted");
  const missingPermission = await optionsPage.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "AVIARY_DOWNLOAD", url: "https://pbs.twimg.com/media/fixture", filename: "fixture.png" }, resolve);
  }));
  expect(missingPermission?.code === "downloads-permission-missing", "background refused download without the optional permission");
  await optionsPage.locator("#downloads-grant").click();
  await optionsPage.waitForTimeout(500);
  expect((await optionsPage.locator("#downloads-state").textContent()) === "not granted", "permission refusal changed the profile");

  const archive = buildStoreZip([{ name: "data/tweets.js", content: TWEETS_JS }]);
  await fillFileInput(page, "snapshots", "Import official X archive", {
    name: "fixture-archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(archive)
  });
  await waitStatus(page, "Imported 1 record");
  await openSection(page, "snapshots");
  await page.evaluate(() => {
    const row = [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-row") ?? [])]
      .find((candidate) => candidate.querySelector(".av-row-label")?.textContent === "Search captured records");
    const input = row?.querySelector('input[type="search"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("archive search input missing");
    input.value = "imported archive";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(
    () => [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-search-hit") ?? [])]
      .some((hit) => hit.textContent?.includes("An imported archive fixture record.")),
    null,
    { timeout: 8_000 }
  );

  await setField(page, "integrations", "Embedding endpoint", `${provider.browserBase}/embeddings`);
  await setField(page, "integrations", "Embedding model", "fixture-embedding");
  await setField(page, "integrations", "Embedding API key", "embedding-secret");
  await setToggle(page, "integrations", "Semantic search", true);
  await setToggle(page, "trust", "Local-only mode", false);
  await clickAction(page, "integrations", "Rebuild semantic index");
  await waitStatus(page, "Indexed: +1 new");
  const embeddingCall = calls(provider.state, "/embeddings")[0];
  assert.ok(embeddingCall?.json?.input?.includes("imported archive"), "embedding request did not contain the archive text");
  await openSection(page, "integrations");
  await page.evaluate(() => {
    const row = [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-row") ?? [])]
      .filter((candidate) => candidate.querySelector("input[type=search]"));
    const input = row.at(-1)?.querySelector('input[type="search"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("semantic search input missing");
    input.value = "archive";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(
    () => [...(document.querySelector("#av-control-center")?.shadowRoot?.querySelectorAll(".av-search-hit") ?? [])]
      .some((hit) => hit.textContent?.includes("An imported archive fixture record.")),
    null,
    { timeout: 8_000 }
  );
  await clickAction(page, "integrations", "Clear semantic index");
  await waitStatus(page, "Semantic index cleared");
  await setToggle(page, "trust", "Local-only mode", true);
  const embeddingsBeforeRefusal = calls(provider.state, "/embeddings").length;
  await clickAction(page, "integrations", "Rebuild semantic index");
  await waitStatus(page, "Embedding failed.");
  assert.equal(calls(provider.state, "/embeddings").length, embeddingsBeforeRefusal, "local-only semantic rebuild contacted the provider");
  await setToggle(page, "trust", "Local-only mode", false);

  await setField(page, "integrations", "AI endpoint (optional)", `${provider.browserBase}/ai/chat`);
  await setField(page, "integrations", "AI model", "fixture-model");
  await setField(page, "integrations", "AI API key", "ai-secret");
  await selectValue(page, "integrations", "AI provider", "openai");
  await setToggle(page, "integrations", "AI provider runs", true);
  await setToggle(page, "library", "Show the AI button on posts", true);
  await setToggle(page, "trust", "Local-only mode", false);
  await page.waitForSelector('[data-av-ai-trigger="1"]');
  await page.evaluate(() => document.querySelector('[data-av-ai-trigger="1"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForSelector(".av-ai-menu");
  await page.evaluate(() => {
    const option = [...document.querySelectorAll(".av-ai-option")].find((candidate) => candidate.textContent?.includes("Summarize"));
    if (!(option instanceof HTMLElement)) throw new Error("AI summarize option missing");
    option.click();
  });
  try {
    await page.waitForFunction(
      () => document.querySelector("#av-feature-toast")?.shadowRoot?.querySelector(".av-ftoast-text")?.textContent?.includes("result copied"),
      null,
      { timeout: 15_000 }
    );
  } catch (error) {
    throw new Error(`${error.message}; AI calls ${JSON.stringify(calls(provider.state, "/ai/chat"))}; toast ${JSON.stringify(await page.evaluate(() => document.querySelector("#av-feature-toast")?.shadowRoot?.querySelector(".av-ftoast-text")?.textContent ?? ""))}`);
  }
  const aiCall = calls(provider.state, "/ai/chat").at(-1);
  assert.equal(aiCall?.json?.model, "fixture-model");
  assert.equal(aiCall?.json?.messages?.[0]?.role, "user");
  assert.ok(aiCall?.json?.messages?.[0]?.content?.includes("A sanitized current-X media post."));
  expect((await readClipboard(page)).includes("Fixture AI response"), "AI result did not reach the browser-scoped clipboard");
  provider.state.fail.ai = true;
  await page.evaluate(() => document.querySelector('[data-av-ai-trigger="1"]')?.click());
  await page.waitForSelector(".av-ai-menu");
  await page.evaluate(() => document.querySelector(".av-ai-option")?.click());
  await page.waitForFunction(
    () => document.querySelector("#av-feature-toast")?.shadowRoot?.querySelector(".av-ftoast-text")?.textContent?.includes("Provider HTTP 503"),
    null,
    { timeout: 15_000 }
  );
  provider.state.fail.ai = false;

  await setField(page, "integrations", "Aria2 endpoint", `${provider.browserBase}/aria2`);
  await setField(page, "integrations", "Aria2 RPC secret", "aria-secret");
  await setField(page, "integrations", "Hand off files larger than (MB)", "0");
  await setToggle(page, "integrations", "Aria2 handoff", true);
  await setToggle(page, "trust", "Local-only mode", false);
  await clickAction(page, "integrations", "Test Aria2 connection");
  await waitStatus(page, "Aria2 reachable.");
  await clickAction(page, "media", "Download all visible media");
  await waitStatus(page, "Batch finished:");
  const addUriCalls = calls(provider.state, "/aria2/jsonrpc").filter((request) => request.json?.method === "aria2.addUri");
  expect(addUriCalls.length > 0, "media batch did not hand any media to the local Aria2 stub");
  expect(addUriCalls.every((request) => request.json?.params?.[0] === "token:aria-secret"), "Aria2 token was not sent in the RPC params");
  provider.state.fail.aria2 = true;
  await clickAction(page, "integrations", "Test Aria2 connection");
  await waitStatus(page, "Aria2 unreachable: Aria2 HTTP 503");
  provider.state.fail.aria2 = false;

  await optionsPage.evaluate(async (base) => {
    const active = await chrome.storage.local.get("aviary.profile.active.v1");
    const profileId = typeof active["aviary.profile.active.v1"] === "string"
      ? active["aviary.profile.active.v1"]
      : "offline-default";
    await chrome.storage.local.set({
      [`aviary.profile.${profileId}.media.last-download.v1`]: {
        url: `${base}/media/fixture.png`,
        filename: "fixture.png",
        kind: "photo",
        downloadedAt: new Date().toISOString()
      }
    });
  }, `${provider.browserBase}`);
  await setField(page, "integrations", "Bluesky service URL", `${provider.browserBase}/bsky`);
  await setField(page, "integrations", "Bluesky handle", "fixture.test");
  await setField(page, "integrations", "Bluesky app password", "bsky-secret");
  await setToggle(page, "integrations", "Bluesky crosspost", true);
  await setField(page, "integrations", "Mastodon instance", `${provider.browserBase}/mastodon`);
  await setField(page, "integrations", "Mastodon access token", "mastodon-secret");
  await setToggle(page, "integrations", "Mastodon crosspost", true);
  await setToggle(page, "integrations", "Attach last download", true);
  await setToggle(page, "trust", "Local-only mode", false);
  await setComposerThread(page, "First fixture crosspost segment.\n\nSecond fixture crosspost segment.");
  await clickCrosspost(page, "Crosspost composer → Bluesky");
  await waitStatus(page, "Posted 2 to Bluesky.");
  const bskyRecords = calls(provider.state, "/bsky/xrpc/com.atproto.repo.createRecord");
  assert.equal(bskyRecords.length, 2);
  assert.ok(bskyRecords[0]?.json?.record?.embed, "Bluesky did not attach the local fixture media");
  assert.ok(bskyRecords[1]?.json?.record?.reply?.parent, "Bluesky thread did not reply to its parent");
  await clickCrosspost(page, "Crosspost composer → Mastodon");
  await waitStatus(page, "Posted 2 to Mastodon.");
  const mastodonStatuses = calls(provider.state, "/mastodon/api/v1/statuses");
  assert.equal(mastodonStatuses.length, 2);
  assert.deepEqual(mastodonStatuses[0]?.json?.media_ids, ["fixture-media-1"]);
  assert.equal(mastodonStatuses[1]?.json?.in_reply_to_id, "fixture-status-3");
  provider.state.fail.mastodon = true;
  await clickCrosspost(page, "Crosspost composer → Mastodon");
  await waitStatus(page, "Mastodon failed: Mastodon HTTP 503");
  provider.state.fail.mastodon = false;

  await clickAction(page, "export", "Copy diagnostics");
  await waitStatus(page, "Diagnostics copied to clipboard.");
  expect((await readClipboard(page)).includes("aviary"), "diagnostics copy did not reach the browser-scoped clipboard");
  await clickAction(page, "export", "Copy as Markdown");
  await waitStatus(page, "Copied 1 records to clipboard.");
  expect((await readClipboard(page)).includes("An imported archive fixture record."), "Markdown export did not reach the clipboard");

  const exportDownload = page.waitForEvent("download", { timeout: 15_000 });
  await clickAction(page, "export", "Export visible tweets");
  const exportArtifact = await exportDownload;
  const exportPath = path.join(tempDownloads, exportArtifact.suggestedFilename());
  await exportArtifact.saveAs(exportPath);
  expect((await stat(exportPath)).size > 0, "visible-tweet export produced an empty file");
  const warcDownload = page.waitForEvent("download", { timeout: 15_000 });
  await clickAction(page, "snapshots", "Download Markdown report");
  const reportArtifact = await warcDownload;
  await reportArtifact.saveAs(path.join(tempDownloads, reportArtifact.suggestedFilename()));

  await optionsPage.close();
  optionsPage = undefined;
  await setToggle(page, "integrations", "Aria2 handoff", false);
  await setField(page, "integrations", "Aria2 endpoint", "");
  await clickAction(page, "media", "Clear download history");
  await waitStatus(page, "History cleared");
  await clickAction(page, "media", "Download all visible media");
  await waitStatus(page, "Batch finished:");
  const permissionPage = await waitForOptionsPage(context, extensionId);
  await permissionPage.waitForSelector("#downloads-state");
  expect((await permissionPage.locator("#downloads-state").textContent()) === "not granted", "batch changed download permission without user approval");
  await permissionPage.close();

  const allowedOrigins = new Set(["https://x.com", "https://pbs.twimg.com", "https://video.twimg.com", provider.base]);
  const thirdParty = browserHttpRequests.filter((url) => {
    try {
      const parsed = new URL(url);
      return !allowedOrigins.has(parsed.origin);
    } catch {
      return false;
    }
  });
  assert.deepEqual(thirdParty, [], `third-party network traffic escaped the local harness: ${thirdParty.join(", ")}`);
  assert.deepEqual(pageErrors, [], `uncaught page errors: ${pageErrors.join(" | ")}`);
  const expectedConsoleErrors = consoleErrors.filter(
    (message) => message.includes("503") || message.includes("net::ERR_FILE_NOT_FOUND")
  );
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !expectedConsoleErrors.includes(message));
  assert.equal(expectedConsoleErrors.filter((message) => message.includes("503")).length, 3);
  assert.deepEqual(unexpectedConsoleErrors, [], `unexpected browser console errors: ${unexpectedConsoleErrors.join(" | ")}`);
  console.log(`[external-smoke] archive, clipboard, local providers, Aria2, download refusal, options permissions, and cleanup passed (${provider.state.requests.length} local requests).`);
} finally {
  await optionsPage?.close().catch(() => {});
  await context?.close().catch(() => {});
  await new Promise((resolve) => provider.server.close(resolve));
  await rm(tempDownloads, { recursive: true, force: true });
  await rm(tempProfile, { recursive: true, force: true });
}

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return await context.waitForEvent("serviceworker", { timeout: 15_000 });
}

async function waitForOptionsPage(context, extensionId, excluded) {
  const find = () => context.pages().find(
    (page) => page !== excluded && page.url() === `chrome-extension://${extensionId}/options.html`
  );
  const existing = find();
  if (existing) return existing;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("download permission surface did not open")), 15_000);
    const onPage = (page) => {
      if (page.url() !== `chrome-extension://${extensionId}/options.html`) return;
      clearTimeout(timer);
      context.off("page", onPage);
      resolve(page);
    };
    context.on("page", onPage);
  });
}
