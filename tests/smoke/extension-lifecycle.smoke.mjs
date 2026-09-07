// Real packaged-extension lifecycle proof for Chrome and Firefox.
//
// This lane deliberately uses disposable profiles and the built extension. The browser must
// expose the actual background protocol, storage area, restart behavior, and page lifecycle. A
// missing browser, add-on, or lifecycle control is an error, never a fallback to a Map model.

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  WebDriverClient,
  findFirefoxBinary,
  stopProcess,
  waitForExtensionOrigin
} from "./dnr-firefox.smoke.mjs";
import { assertCurrentExtensionBuild } from "../../tools/settings-visual-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chromeBuild = path.join(root, "dist", "extension-chrome");
const firefoxBuild = path.join(root, "dist", "extension-firefox");
const REGISTER = "AVIARY_STORAGE_LOCK_REGISTER";
const FENCE = "AVIARY_STORAGE_FENCE";
const DURABLE = "AVIARY_DURABLE_STORAGE";
const LOCK_PREFIX = "aviary.lock.v1.aviary.lifecycle.smoke";
const LIFECYCLE_KEY = "aviary.lifecycle.smoke.value";

async function main() {
  await assertCurrentExtensionBuild(chromeBuild);
  await assertCurrentExtensionBuild(firefoxBuild);
  await runChromium();
  await runFirefox();
  console.log("[extension-lifecycle] Chrome and Firefox real-storage restart and stale-owner lanes passed.");
}

async function runChromium() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-lifecycle-chromium-"));
  const extensionDir = path.join(tempRoot, "extension");
  const profileDir = path.join(tempRoot, "profile");
  let context;
  try {
    await cp(chromeBuild, extensionDir, { recursive: true });
    context = await launchChromium(profileDir, extensionDir);
    const firstWorker = await waitForServiceWorker(context);
    const extensionId = new URL(firstWorker.url()).host;
    const page = await openChromiumOptions(context, extensionId);

    assert.deepEqual(await sendChromium(page, { type: "AVIARY_PING" }), {
      ok: true,
      product: "aviary"
    });

    const pendingWrite = {
      id: "lifecycle-restart-put",
      key: "aviary.lifecycle.smoke.pending",
      kind: "put",
      value: { phase: "staged-before-worker-stop" }
    };
    assert.deepEqual(
      await sendChromium(page, { type: DURABLE, operation: "stage-pending", write: pendingWrite }),
      { ok: true, result: null }
    );
    await page.close();
    await terminateServiceWorker(context, firstWorker);

    const restartedPage = await openChromiumOptions(context, extensionId);
    assert.deepEqual(await sendChromium(restartedPage, { type: "AVIARY_PING" }), {
      ok: true,
      product: "aviary"
    });
    await waitForServiceWorkerTarget(context, extensionId);
    const committed = await sendChromium(restartedPage, {
      type: DURABLE,
      operation: "commit-pending",
      write: pendingWrite
    });
    assert.equal(committed.ok, true, `the restarted worker could not commit: ${JSON.stringify(committed)}`);
    const replayed = await sendChromium(restartedPage, {
      type: DURABLE,
      operation: "commit-pending",
      write: pendingWrite
    });
    assert.equal(replayed.ok, true, "replaying the committed transaction was not idempotent");
    assert.deepEqual(
      await sendChromium(restartedPage, { type: DURABLE, operation: "get", key: pendingWrite.key }),
      { ok: true, result: { found: true, value: pendingWrite.value } }
    );
    assert.deepEqual(
      await sendChromium(restartedPage, { type: DURABLE, operation: "remove", key: pendingWrite.key }),
      { ok: true, result: null }
    );
    assert.deepEqual(
      await sendChromium(restartedPage, { type: DURABLE, operation: "get", key: pendingWrite.key }),
      { ok: true, result: { found: false } }
    );

    const rosterKey = `aviary.lock.v1.roster.${encodeURIComponent(LOCK_PREFIX)}`;
    const ownerA = await acquireChromiumOwner(restartedPage, "owner-a", Date.now() + 900);
    const renewedA = await sendChromium(restartedPage, {
      type: FENCE,
      operation: "renew",
      fence: { ...ownerA.fence, expiresAt: Date.now() + 1_500 }
    });
    assert.equal(renewedA.ok, true, `the live owner could not renew: ${JSON.stringify(renewedA)}`);
    ownerA.fence = renewedA.result;
    const roster = await readChromeStorage(restartedPage, rosterKey);
    assert.equal(
      roster?.entries?.some(([key]) => key === `${LOCK_PREFIX}.owner-a`),
      true,
      "the live packaged extension did not persist its lock roster"
    );
    await sendChromium(restartedPage, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "owner-a" },
      fence: ownerA.fence
    });
    await releaseChromiumOwner(restartedPage, ownerA);

    const holder = await openChromiumOptions(context, extensionId);
    const holderOwner = await acquireChromiumOwner(holder, "frozen-owner", Date.now() + 900);
    await sendChromium(holder, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "frozen-owner" },
      fence: holderOwner.fence
    });
    const cdp = await context.newCDPSession(holder);
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await delay(1_250);

    const newer = await openChromiumOptions(context, extensionId);
    const ownerB = await acquireChromiumOwner(newer, "owner-b", Date.now() + 30_000);
    const newerWrite = await sendChromium(newer, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "owner-b" },
      fence: ownerB.fence
    });
    assert.equal(newerWrite.ok, true, `the newer owner could not commit: ${JSON.stringify(newerWrite)}`);
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
    const stale = await sendChromium(holder, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "frozen-owner-stale" },
      fence: holderOwner.fence
    });
    assert.equal(stale.ok, false, "a frozen owner committed after a newer owner took over");
    assert.equal(stale.code, "storage-fence-lost");
    assert.deepEqual(
      await sendChromium(newer, { type: DURABLE, operation: "get", key: LIFECYCLE_KEY }),
      { ok: true, result: { found: true, value: { owner: "owner-b" } } }
    );

    await releaseChromiumOwner(newer, ownerB);
    await removeChromiumOwner(newer, "owner-a");
    await removeChromiumOwner(newer, "frozen-owner");
    await Promise.all([restartedPage.close(), holder.close(), newer.close()]);
  } finally {
    await context?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function runFirefox() {
  const firefoxBinary = findFirefoxBinary();
  if (!firefoxBinary) throw new Error("Firefox lifecycle lane cannot run: Mozilla Firefox is unavailable.");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-lifecycle-firefox-"));
  const extensionDir = path.join(tempRoot, "extension");
  const profileDir = path.join(tempRoot, "profile");
  const proxy = await startQuietProxy();
  let driver;
  try {
    await cp(firefoxBuild, extensionDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    driver = await WebDriverClient.start(firefoxBinary, tempRoot, proxy.port, { profileDir });
    const extensionId = await driver.installAddon(extensionDir);
    const extensionOrigin = await waitForExtensionOrigin(driver.profileDir, extensionId);
    await driver.openExtensionPage(`${extensionOrigin}/options.html`);
    const ping = await sendFirefox(driver, { type: "AVIARY_PING" });
    assert.deepEqual(ping, { ok: true, product: "aviary" });
    const write = {
      id: "firefox-lifecycle-put",
      key: "aviary.lifecycle.firefox.value",
      kind: "put",
      value: { phase: "before-browser-restart" }
    };
    assert.deepEqual(
      await sendFirefox(driver, { type: DURABLE, operation: "put", key: write.key, value: write.value }),
      { ok: true, result: null }
    );
    const roster = await acquireFirefoxOwner(driver, "firefox-owner", Date.now() + 1_000);
    const renewed = await sendFirefox(driver, {
      type: FENCE,
      operation: "renew",
      fence: { ...roster.fence, expiresAt: Date.now() + 2_000 }
    });
    assert.equal(renewed.ok, true, `Firefox could not renew its real fence: ${JSON.stringify(renewed)}`);
    roster.fence = renewed.result;
    await sendFirefox(driver, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "firefox-owner" },
      fence: roster.fence
    });
    await driver.end();
    await stopProcess(driver.process);
    driver = undefined;

    driver = await WebDriverClient.start(firefoxBinary, tempRoot, proxy.port, { profileDir });
    const restartedId = await driver.installAddon(extensionDir);
    assert.equal(restartedId, extensionId, "Firefox reinstalled Aviary under a different id");
    const restartedOrigin = await waitForExtensionOrigin(driver.profileDir, extensionId);
    await driver.openExtensionPage(`${restartedOrigin}/options.html`);
    assert.deepEqual(
      await sendFirefox(driver, { type: DURABLE, operation: "get", key: write.key }),
      { ok: true, result: { found: true, value: write.value } }
    );
    assert.deepEqual(
      await sendFirefox(driver, { type: DURABLE, operation: "get", key: LIFECYCLE_KEY }),
      { ok: true, result: { found: true, value: { owner: "firefox-owner" } } }
    );
    assert.deepEqual(
      await sendFirefox(driver, { type: DURABLE, operation: "remove", key: write.key }),
      { ok: true, result: null }
    );
    assert.deepEqual(
      await sendFirefox(driver, { type: DURABLE, operation: "get", key: write.key }),
      { ok: true, result: { found: false } }
    );
    await delay(2_200);

    const newer = await acquireFirefoxOwner(driver, "firefox-new-owner", Date.now() + 30_000);
    const committed = await sendFirefox(driver, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "firefox-new-owner" },
      fence: newer.fence
    });
    assert.equal(committed.ok, true, `Firefox could not reacquire its real fence: ${JSON.stringify(committed)}`);
    const stale = await sendFirefox(driver, {
      type: DURABLE,
      operation: "put",
      key: LIFECYCLE_KEY,
      value: { owner: "firefox-owner-stale" },
      fence: roster.fence
    });
    assert.equal(stale.ok, false, "Firefox accepted an old owner's stale commit after restart");
    assert.equal(stale.code, "storage-fence-lost");
    assert.deepEqual(
      await sendFirefox(driver, { type: DURABLE, operation: "get", key: LIFECYCLE_KEY }),
      { ok: true, result: { found: true, value: { owner: "firefox-new-owner" } } }
    );
  } finally {
    await driver?.end().catch(() => {});
    await stopProcess(driver?.process).catch(() => {});
    await proxy.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function launchChromium(profileDir, extensionDir) {
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--headless=new",
      "--no-sandbox"
    ]
  });
}

async function waitForServiceWorker(context) {
  const existing = context.serviceWorkers()[0];
  return existing ?? context.waitForEvent("serviceworker", { timeout: 15_000 });
}

async function terminateServiceWorker(context, worker) {
  await Promise.all(context.pages().map((page) => page.close()));
  const browser = context.browser();
  if (!browser || typeof browser.newBrowserCDPSession !== "function") {
    throw new Error("Chromium lifecycle control is unavailable: browser CDP target management is missing.");
  }
  const cdp = await browser.newBrowserCDPSession();
  const targets = await cdp.send("Target.getTargets");
  const target = targets.targetInfos.find((candidate) =>
    candidate.type === "service_worker" && candidate.url === worker.url()
  );
  if (!target) {
    await cdp.detach();
    throw new Error("Chromium lifecycle control could not find the packaged extension worker target.");
  }
  // Target.closeTarget terminates the worker without Target.attachToTarget, so this harness cannot
  // keep the worker alive through a debugger session while it claims to test termination.
  await cdp.send("Target.closeTarget", { targetId: target.targetId });
  await cdp.detach();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const probe = await browser.newBrowserCDPSession();
    const active = await probe.send("Target.getTargets");
    await probe.detach();
    if (!active.targetInfos.some((candidate) =>
      candidate.type === "service_worker" && candidate.url === worker.url()
    )) return target.targetId;
    await delay(250);
  }
  throw new Error("Chromium did not report the packaged extension worker as terminated.");
}

async function waitForServiceWorkerTarget(context, extensionId) {
  const browser = context.browser();
  if (!browser || typeof browser.newBrowserCDPSession !== "function") {
    throw new Error("Chromium lifecycle control is unavailable while checking worker restart.");
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const cdp = await browser.newBrowserCDPSession();
    const targets = await cdp.send("Target.getTargets");
    await cdp.detach();
    const worker = targets.targetInfos.find((candidate) =>
      candidate.type === "service_worker" &&
      candidate.url.includes(`chrome-extension://${extensionId}/`)
    );
    if (worker) return worker.targetId;
    await delay(100);
  }
  throw new Error("Chromium did not create a new packaged extension worker after termination.");
}

async function openChromiumOptions(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForLoadState("domcontentloaded");
  return page;
}

function sendChromium(page, message) {
  return page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
}

async function readChromeStorage(page, key) {
  return page.evaluate(async (storageKey) => (await chrome.storage.local.get(storageKey))[storageKey], key);
}

async function acquireChromiumOwner(page, owner, expiresAt) {
  const key = `${LOCK_PREFIX}.${owner}`;
  const contender = {
    version: 1,
    owner,
    phase: "waiting",
    ticket: owner === "owner-b" ? 3 : 1,
    mode: "exclusive",
    expiresAt
  };
  assert.equal(
    (await sendChromium(page, {
      type: REGISTER,
      version: 1,
      operation: "write",
      prefix: LOCK_PREFIX,
      key,
      value: contender
    })).ok,
    true
  );
  const response = await sendChromium(page, {
    type: FENCE,
    operation: "acquire",
    fence: { version: 1, name: "aviary.lifecycle.smoke", owner, generation: contender.ticket, expiresAt }
  });
  assert.equal(response.ok, true, `could not acquire ${owner}: ${JSON.stringify(response)}`);
  return { key, fence: response.result };
}

async function releaseChromiumOwner(page, owner) {
  await sendChromium(page, { type: FENCE, operation: "release", fence: owner.fence });
  await removeChromiumOwner(page, owner.key.split(".").at(-1));
}

async function removeChromiumOwner(page, owner) {
  await sendChromium(page, {
    type: REGISTER,
    version: 1,
    operation: "remove",
    prefix: LOCK_PREFIX,
    key: `${LOCK_PREFIX}.${owner}`
  });
}

async function acquireFirefoxOwner(driver, owner, expiresAt) {
  const response = await sendFirefox(driver, {
    type: FENCE,
    operation: "acquire",
    fence: { version: 1, name: "aviary.lifecycle.firefox", owner, generation: 1, expiresAt }
  });
  assert.equal(response.ok, true, `could not acquire Firefox owner ${owner}: ${JSON.stringify(response)}`);
  return { fence: response.result };
}

function sendFirefox(driver, message) {
  return driver.evaluate(null, (payload) => chrome.runtime.sendMessage(payload), message);
}

function startQuietProxy() {
  const server = http.createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    port: server.address().port,
    close: () => new Promise((done) => server.close(() => done()))
  })));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
