// The yt-dlp helper reached from the packaged extension's background worker, in real Chromium.
//
// Chrome 142+ denies or prompts before a public page such as x.com reaches a loopback address.
// The extension hands the helper call to its background worker instead. This lane starts the
// real helper on a random port and runs twice, with and without the optional loopback host
// access. Each run proves the x.com page's own loopback fetch is denied (the positive control),
// then sends the message the content script sends and checks the background reached the helper
// while the page issued no loopback request of its own.

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertCurrentExtensionBuild } from "../../tools/settings-visual-harness.mjs";
import { createYtDlpHelper } from "../../tools/yt-dlp-helper.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chromeBuild = path.join(root, "dist", "extension-chrome");
const fixtureHtml = await readFile(path.join(root, "tests", "smoke", "current-x-home.html"), "utf8");
const SECRET = "smoke-secret-smoke-secret";
const MANIFEST = "https://video.twimg.com/ext_tw_video/123/pu/pl/1280x720/manifest.m3u8";
const LOOPBACK_URL = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//;

async function main() {
  await assertCurrentExtensionBuild(chromeBuild);
  await runLane({ granted: false });
  await runLane({ granted: true });
}

async function runLane({ granted }) {
  const label = granted ? "loopback access granted" : "loopback access not granted";
  const jobs = [];
  const seen = [];
  const helper = createYtDlpHelper({
    token: SECRET,
    port: 0,
    outputDir: path.join(os.tmpdir(), "aviary-ytdlp-smoke-output"),
    spawnProcess(command, args) {
      jobs.push({ command, args });
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit("close", 0), 20);
      return child;
    }
  });
  helper.server.on("request", (request) => {
    seen.push({ origin: request.headers.origin ?? null, url: request.url });
  });
  const { port } = await helper.listen();
  const endpoint = `http://127.0.0.1:${port}`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-ytdlp-chromium-"));
  let context;
  try {
    const extensionDir = path.join(tempRoot, "extension");
    await cp(chromeBuild, extensionDir, { recursive: true });
    if (granted) await grantLoopbackAccess(extensionDir);
    context = await chromium.launchPersistentContext(path.join(tempRoot, "profile"), {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--headless=new",
        "--no-sandbox"
      ]
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;

    await context.route("https://x.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml })
    );
    const xPage = await context.newPage();
    const consoleErrors = [];
    xPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await xPage.goto("https://x.com/home");

    // Positive control: the page itself is refused, so a passing background call means something.
    const direct = await xPage.evaluate(async ({ url, secret }) => {
      try {
        const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } });
        return `HTTP ${response.status}`;
      } catch (error) {
        return `refused: ${error.message}`;
      }
    }, { url: `${endpoint}/v1/jobs/control_12345678901`, secret: SECRET });
    assert.match(direct, /^refused/, `the x.com page reached loopback directly (${direct}); this browser enforces no loopback gate`);
    assert.ok(
      consoleErrors.some((text) => /loopback/i.test(text)),
      `the direct refusal was not the loopback permission: ${JSON.stringify(consoleErrors)}`
    );
    assert.equal(seen.length, 0, "the refused page request still reached the helper");

    const pageLoopback = [];
    xPage.on("request", (request) => {
      if (LOOPBACK_URL.test(request.url())) pageLoopback.push(request.url());
    });

    const extensionPage = await context.newPage();
    await extensionPage.goto(`${extensionOrigin}/options.html`);
    await extensionPage.waitForLoadState("domcontentloaded");
    const send = (call) =>
      extensionPage.evaluate((message) => chrome.runtime.sendMessage(message), { type: "AVIARY_YTDLP_PROXY", call });

    const created = await send({
      method: "POST",
      url: `${endpoint}/v1/jobs`,
      secret: SECRET,
      body: JSON.stringify({ manifestUrl: MANIFEST, filename: "smoke_123.%(ext)s", formatPolicy: "bv*+ba/b" })
    });
    assert.equal(created?.ok, true, `${label}: the background did not reach the helper: ${JSON.stringify(created)}`);
    assert.equal(created.status, 202);
    assert.equal(created.payload?.state, "running");
    assert.equal(jobs.length, 1, "the helper must have started exactly one job");

    await new Promise((resolve) => setTimeout(resolve, 60));
    const read = await send({ method: "GET", url: `${endpoint}/v1/jobs/${created.payload.jobId}`, secret: SECRET });
    assert.deepEqual(read, { ok: true, status: 200, payload: { jobId: created.payload.jobId, state: "completed" } });

    const refused = await send({ method: "GET", url: `${endpoint}/admin`, secret: SECRET });
    assert.equal(refused?.ok, false, "the background must refuse a call that is not a job create or read");

    assert.equal(seen.length, 2, `${label}: the helper saw ${JSON.stringify(seen)}`);
    for (const entry of seen) {
      // With host access Chrome skips CORS and may send no Origin at all. Without it every call
      // is a CORS request from the extension. A page origin is never acceptable.
      const allowed = granted ? [extensionOrigin, null] : [extensionOrigin];
      assert.ok(allowed.includes(entry.origin), `${label}: a helper request came from ${entry.origin}`);
    }
    assert.deepEqual(pageLoopback, [], "the x.com page must not reach loopback itself");
    const browser = await extensionPage.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? "Chromium");
    console.log(`[ytdlp-helper-chromium] ${browser}, ${label}: x.com was refused loopback, the background reached the helper.`);
  } finally {
    await context?.close();
    await helper.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * The optional loopback access, granted the way an unpacked profile can be without a click.
 * Chrome treats a granted optional host permission the same as one listed at install.
 */
async function grantLoopbackAccess(extensionDir) {
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const loopback = manifest.optional_host_permissions.filter((origin) => origin.startsWith("http://"));
  assert.ok(loopback.length > 0, "the built manifest offers no loopback host access");
  manifest.host_permissions = [...manifest.host_permissions, ...loopback];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
