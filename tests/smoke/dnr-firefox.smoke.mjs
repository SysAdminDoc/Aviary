// Real Firefox MV3 event-page and declarativeNetRequest proof.
//
// Playwright cannot temporarily install an unpacked Firefox add-on, so this uses Mozilla's
// geckodriver to install it and evaluate a real extension page through WebDriver.
// All HTTPS traffic is pointed at a refusing loopback proxy: a blocked request never reaches it,
// while a disabled rule produces one observable CONNECT and cannot escape to the public network.

import assert from "node:assert/strict";
import fs from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertCurrentExtensionBuild } from "../../tools/settings-visual-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtExtension = path.join(root, "dist", "extension-firefox");
const extensionId = "aviary@example.local";
const WEBDRIVER_COMMAND_TIMEOUT_MS = 20_000;
async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-dnr-firefox-"));
  const extensionDir = path.join(tempRoot, "extension");
  let driver;
  let proxy;
  let runError;
  const cleanupErrors = [];

  try {
  await assertCurrentExtensionBuild(builtExtension);
  await cp(builtExtension, extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.permissions = [...manifest.permissions, "declarativeNetRequestFeedback"];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const binary = findFirefoxBinary();
  if (!binary) {
    throw new Error(
      "Mozilla Firefox is unavailable. Install Firefox or set AVIARY_FIREFOX_BINARY."
    );
  }

  proxy = await startRefusingProxy();
  driver = await WebDriverClient.start(binary, tempRoot, proxy.port);
  const installedExtensionId = await driver.installAddon(extensionDir);
  assert.equal(installedExtensionId, extensionId);
  const extensionOrigin = await waitForExtensionOrigin(driver.profileDir, extensionId);
  await driver.openExtensionPage(`${extensionOrigin}/options.html`);
  const extensionClient = driver;
  const extensionContext = null;
  const messageClient = driver;
  const extensionTabId = await extensionClient.evaluate(extensionContext, async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (typeof tab?.id !== "number") throw new Error("could not identify the Firefox extension tab");
    return tab.id;
  });

  // The eviction exemption, on the other engine. Firefox applies the IndexedDB quota to extension
  // storage and wants the same `unlimitedStorage` permission Chrome does, so the library is only
  // durable if this is actually granted in the installed add-on rather than merely written into
  // the manifest source.
  const persistence = await extensionClient.evaluate(extensionContext, async () => ({
    exempt: await chrome.permissions.contains({ permissions: ["unlimitedStorage"] }),
    estimate: await chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "estimate"
    })
  }));
  assert.equal(persistence.exempt, true, "the installed add-on lost its eviction exemption");
  assert.equal(persistence.estimate?.ok, true, "the background could not measure its own storage");
  assert.equal(
    persistence.estimate?.result?.persisted,
    true,
    "an exempt add-on must not report its library as best effort"
  );

  // The Firefox smoke surface is the extension page itself, so provide its tab target explicitly
  // to exercise the same background protocol a content script uses through sender.tab.
  assert.deepEqual(
    await messageClient.evaluate(extensionContext, (tabId) =>
      chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: true, tabId }), extensionTabId
    ),
    { ok: true, enabled: true }
  );

  await waitFor(
    extensionClient,
    extensionContext,
    () => chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) =>
      chrome.declarativeNetRequest.getSessionRules().then((rules) =>
        rules.some((rule) => rule.condition?.tabIds?.includes(tab.id))
      )
    ),
    "default-on tab session rule was not installed"
  );

  const outcomes = await extensionClient.evaluate(
    extensionContext,
    (tabId) => Promise.all([
      "https://x.com/i/api/1.1/promoted_content/log.json?event=impression",
      "https://x.com/i/api/graphql/query/HomeTimeline",
      "https://x.com/i/api/1.1/promoted_content/content.json",
      "https://video.twimg.com/ext_tw_video/fixture.mp4",
      "https://evil.example/i/api/1.1/promoted_content/log.json"
    ].map(async (url) => ({
      url,
      matches: (await chrome.declarativeNetRequest.testMatchOutcome({
        url,
        initiator: "https://x.com",
        method: "post",
        type: "xmlhttprequest",
        tabId
      })).matchedRules.map((rule) => rule.ruleId)
    }))),
    extensionTabId
  );
  assert.deepEqual(outcomes[0].matches, [extensionTabId === 0 ? 1 : extensionTabId]);
  for (const outcome of outcomes.slice(1)) {
    assert.deepEqual(outcome.matches, [], `control request matched: ${outcome.url}`);
  }

  const connectsBefore = xConnectCount(proxy.seen);
  const enabledRequest = await requestLogger(extensionClient, extensionContext);
  assert.equal(enabledRequest.ok, false);
  await delay(250);
  assert.equal(xConnectCount(proxy.seen), connectsBefore, "enabled logger reached the proxy");

  const disabled = await messageClient.evaluate(extensionContext, (tabId) =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: false, tabId }), extensionTabId
  );
  assert.deepEqual(disabled, { ok: true, enabled: false });
  await waitFor(
    extensionClient,
    extensionContext,
    () => chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) =>
      chrome.declarativeNetRequest.getSessionRules().then((rules) =>
        rules.every((rule) => !rule.condition?.tabIds?.includes(tab.id))
      )
    ),
    "tab session rule did not disable"
  );

  const disabledRequest = await requestLogger(extensionClient, extensionContext);
  assert.equal(disabledRequest.ok, false, "the refusing proxy should make the control request fail");
  await waitForValue(
    () => xConnectCount(proxy.seen) === connectsBefore + 1,
    "disabled logger never reached the loopback proxy"
  );

  const enabled = await messageClient.evaluate(extensionContext, (tabId) =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: true, tabId }), extensionTabId
  );
  assert.deepEqual(enabled, { ok: true, enabled: true });
  await waitFor(
    extensionClient,
    extensionContext,
    () => chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) =>
      chrome.declarativeNetRequest.getSessionRules().then((rules) =>
        rules.some((rule) => rule.condition?.tabIds?.includes(tab.id))
      )
    ),
    "tab session rule did not re-enable"
  );

  const reenabledRequest = await requestLogger(extensionClient, extensionContext);
  assert.equal(reenabledRequest.ok, false);
  await delay(250);
  assert.equal(
    xConnectCount(proxy.seen),
    connectsBefore + 1,
    "re-enabled logger escaped to the proxy"
  );
  const pendingWrite = {
    id: "firefox-smoke-put",
    key: "aviary.firefox.reconcileScratch.v1",
    kind: "put",
    value: { state: "committed" }
  };
  assert.deepEqual(
    await messageClient.evaluate(extensionContext, (write) =>
      chrome.runtime.sendMessage({
        type: "AVIARY_DURABLE_STORAGE",
        operation: "stage-pending",
        write
      }), pendingWrite
    ),
    { ok: true, result: null }
  );
  assert.equal(
    await extensionClient.evaluate(extensionContext, async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("aviary.durable.v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const keys = await new Promise((resolve, reject) => {
        const request = database.transaction("values", "readonly").objectStore("values").getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return keys.some((key) => String(key).startsWith("__aviary_pending__:"));
    }),
    true
  );
  const committed = await messageClient.evaluate(extensionContext, (write) =>
    chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "commit-pending",
      write
    }), pendingWrite
  );
  assert.equal(committed.ok, true);
  assert.equal(committed.result.id, pendingWrite.id);
  assert.match(committed.result.valueHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    await messageClient.evaluate(extensionContext, (key) =>
      chrome.runtime.sendMessage({ type: "AVIARY_DURABLE_STORAGE", operation: "get", key }),
      pendingWrite.key
    ),
    { ok: true, result: { found: true, value: pendingWrite.value } }
  );
  const tombstone = { id: "firefox-smoke-remove", key: pendingWrite.key, kind: "remove" };
  await messageClient.evaluate(extensionContext, (write) =>
    chrome.runtime.sendMessage({ type: "AVIARY_DURABLE_STORAGE", operation: "stage-pending", write }),
    tombstone
  );
  assert.deepEqual(
    await messageClient.evaluate(extensionContext, (write) =>
      chrome.runtime.sendMessage({ type: "AVIARY_DURABLE_STORAGE", operation: "commit-pending", write }),
      tombstone
    ),
    { ok: true, result: { ...tombstone, valueHash: null } }
  );

  console.log(
    `[dnr-firefox] Firefox ${driver.browserVersion}: atomic storage reconciliation, event page, DNR controls, persistence, and loopback blocking passed.`
  );
  } catch (error) {
    runError = error;
  } finally {
    try {
      await driver?.end();
    } catch {
      // A failed smoke assertion can close the WebDriver session first.
    }
    try {
      await stopProcess(driver?.process);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await closeServer(proxy?.server);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (runError) throw runError;
  if (cleanupErrors.length > 0) throw cleanupErrors[0];
}

function findFirefoxBinary() {
  const candidates = [
    process.env.AVIARY_FIREFOX_BINARY,
    process.env.FIREFOX_BINARY,
    "C:/Program Files/Mozilla Firefox/firefox.exe",
    "C:/Program Files (x86)/Mozilla Firefox/firefox.exe",
    path.join(os.homedir(), "AppData/Local/Microsoft/WindowsApps/firefox.exe"),
    "/usr/bin/firefox",
    "/usr/local/bin/firefox",
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    "firefox"
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 20_000 });
    if (!probe.error && /Mozilla Firefox/.test(`${probe.stdout}\n${probe.stderr}`)) {
      return candidate;
    }
  }
  return null;
}

function startRefusingProxy() {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((request, response) => {
      seen.push(request.url ?? "");
      response.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      response.end();
    });
    server.on("connect", (request, socket) => {
      seen.push(`CONNECT ${request.url}`);
      socket.on("error", () => {});
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, seen });
    });
  });
}

function reservePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function firefoxPreferences() {
  return {
    "extensions.dnr.feedback": true,
    "network.captive-portal-service.enabled": false,
    "network.connectivity-service.enabled": false,
    "browser.region.network.url": "",
    "services.settings.server": "",
    "extensions.getAddons.cache.enabled": false,
    "browser.shell.checkDefaultBrowser": false,
    "datareporting.policy.dataSubmissionEnabled": false,
    "datareporting.healthreport.uploadEnabled": false,
    "toolkit.telemetry.enabled": false,
    "browser.aboutwelcome.enabled": false,
    "browser.startup.homepage_override.mstone": "ignore",
    "app.update.auto": false,
    "extensions.update.enabled": false,
    "browser.safebrowsing.malware.enabled": false,
    "browser.safebrowsing.phishing.enabled": false
  };
}

function findGeckodriverBinary() {
  const candidates = [process.env.GECKODRIVER_BINARY, "geckodriver"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 20_000 });
    if (!probe.error && /geckodriver/i.test(`${probe.stdout}\n${probe.stderr}`)) return candidate;
  }
  return null;
}

class WebDriverClient {
  constructor(baseUrl, process, sessionId, capabilities) {
    this.baseUrl = baseUrl;
    this.process = process;
    this.sessionId = sessionId;
    this.capabilities = capabilities;
    this.profileDir = capabilities["moz:profile"];
    this.browserVersion = capabilities.browserVersion;
  }

  static async start(firefoxBinary, profileRoot, proxyPort) {
    const geckodriver = findGeckodriverBinary();
    if (!geckodriver) {
      throw new Error("geckodriver is unavailable. Install Mozilla geckodriver or set GECKODRIVER_BINARY.");
    }
    const port = await reservePort();
    const process = spawn(geckodriver, [
      "--port",
      String(port),
      "--binary",
      firefoxBinary,
      "--allow-system-access",
      "--profile-root",
      profileRoot,
      "--log",
      "error"
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    const remember = (chunk) => {
      output = `${output}${String(chunk)}`.slice(-50_000);
    };
    process.stdout.on("data", remember);
    process.stderr.on("data", remember);
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (process.exitCode !== null) {
        throw new Error(`geckodriver exited before startup (${process.exitCode}).\n${output}`);
      }
      try {
        await webdriverJson(baseUrl, "/status", { method: "GET" }, 1_000);
        break;
      } catch {
        await delay(100);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`geckodriver did not become ready.\n${output}`);
    }
    let session;
    try {
      session = await webdriverJson(baseUrl, "/session", {
        method: "POST",
        body: {
          capabilities: {
            alwaysMatch: {
              browserName: "firefox",
              acceptInsecureCerts: true,
              proxy: {
                proxyType: "manual",
                httpProxy: `127.0.0.1:${proxyPort}`,
                sslProxy: `127.0.0.1:${proxyPort}`
              },
              "moz:firefoxOptions": {
                args: ["-headless"],
                prefs: firefoxPreferences()
              }
            }
          }
        }
      }, 60_000);
    } catch (error) {
      await stopProcess(process);
      throw error;
    }
    const client = new WebDriverClient(baseUrl, process, session.sessionId, session.capabilities);
    await client.request("POST", "/timeouts", {
      script: WEBDRIVER_COMMAND_TIMEOUT_MS,
      pageLoad: WEBDRIVER_COMMAND_TIMEOUT_MS,
      implicit: 0
    });
    return client;
  }

  async request(method, suffix, body, timeoutMs = WEBDRIVER_COMMAND_TIMEOUT_MS) {
    if (!this.sessionId) throw new Error("Firefox WebDriver session is closed.");
    return webdriverJson(
      this.baseUrl,
      `/session/${this.sessionId}${suffix}`,
      { method, ...(body === undefined ? {} : { body }) },
      timeoutMs
    );
  }

  async installAddon(extensionDir) {
    return this.request("POST", "/moz/addon/install", {
      path: extensionDir,
      temporary: true
    });
  }

  async setContext(context) {
    await this.request("POST", "/moz/context", { context });
  }

  async executeSync(script, args = []) {
    return this.request("POST", "/execute/sync", { script, args });
  }

  async openExtensionPage(url) {
    const before = await this.request("GET", "/window/handles");
    await this.setContext("chrome");
    try {
      await this.executeSync(`
        const browserWindow = Services.wm.getMostRecentWindow("navigator:browser");
        const tab = browserWindow.gBrowser.addTab(arguments[0], {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
        browserWindow.gBrowser.selectedTab = tab;
        return true;
      `, [url]);
    } finally {
      await this.setContext("content");
    }
    const handles = await this.request("GET", "/window/handles");
    const handle = handles.find((candidate) => !before.includes(candidate)) ?? handles.at(-1);
    if (!handle) throw new Error("Firefox did not open Aviary's options tab.");
    await this.request("POST", "/window", { handle });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        if (await this.executeSync("return document.readyState === 'complete';")) return;
      } catch {
        // The new extension document can replace its initial about:blank context once.
      }
      await delay(50);
    }
    throw new Error("Firefox did not finish loading Aviary's options page.");
  }

  async evaluate(_context, fn, argument = null) {
    const script = `const done = arguments[arguments.length - 1]; Promise.resolve((${String(fn)})(arguments[0])).then(`
      + `(value) => done({ ok: true, value }), `
      + `(error) => done({ ok: false, error: String(error) }));`;
    const envelope = await this.request("POST", "/execute/async", { script, args: [argument] });
    if (!envelope?.ok) throw new Error(envelope?.error ?? "Firefox extension evaluation failed.");
    return envelope.value;
  }

  async end() {
    if (!this.sessionId) return;
    const sessionId = this.sessionId;
    this.sessionId = null;
    await webdriverJson(
      this.baseUrl,
      `/session/${sessionId}`,
      { method: "DELETE" },
      5_000
    );
  }
}

export async function webdriverJson(
  baseUrl,
  pathname,
  init,
  timeoutMs = WEBDRIVER_COMMAND_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
) {
  const timeout = Math.max(1, Math.trunc(timeoutMs));
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`WebDriver request timed out after ${timeout} ms.`));
    }, timeout);
  });
  const request = Promise.resolve().then(async () => {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      method: init.method,
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
    });
    const payload = await response.json();
    if (!response.ok || payload?.value?.error) {
      throw new Error(payload?.value?.message ?? `WebDriver returned HTTP ${response.status}.`);
    }
    return payload?.value;
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForExtensionOrigin(profileDir, expectedId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const uuid = readExtensionUuid(profileDir, expectedId);
    if (uuid) return `moz-extension://${uuid}`;
    await delay(100);
  }
  throw new Error("Firefox did not load Aviary's preinstalled extension.");
}

function readExtensionUuid(profileDir, expectedId) {
  try {
    const prefs = fs.readFileSync(path.join(profileDir, "prefs.js"), "utf8");
    const line = prefs.split(/\r?\n/).find((entry) =>
      entry.startsWith('user_pref("extensions.webextensions.uuids", ')
    );
    if (!line) return null;
    const encoded = /^user_pref\("extensions[.]webextensions[.]uuids", (.+)\);$/.exec(line)?.[1];
    if (!encoded) return null;
    const mapping = JSON.parse(JSON.parse(encoded));
    return typeof mapping?.[expectedId] === "string" ? mapping[expectedId] : null;
  } catch {
    return null;
  }
}

async function requestLogger(client, context) {
  return client.evaluate(context, () => fetch(
    "https://x.com/i/api/1.1/promoted_content/log.json?event=smoke",
    { method: "POST", body: "fixture", signal: AbortSignal.timeout(5_000) }
  ).then((response) => ({ ok: true, status: response.status }))
    .catch((error) => ({ ok: false, error: String(error) })));
}

async function waitFor(client, context, fn, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(context, fn)) return;
    } catch {
      // the event page can be waking up
    }
    await delay(150);
  }
  throw new Error(message);
}

async function waitForValue(check, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(100);
  }
  throw new Error(message);
}

function xConnectCount(seen) {
  return seen.filter((entry) => entry === "CONNECT x.com:443").length;
}

async function closeServer(server, timeoutMs = 3_000) {
  if (!server?.listening) return;
  const closed = new Promise((resolve) => server.close(() => resolve(true)));
  if (await Promise.race([closed, delay(timeoutMs).then(() => false)])) return;
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  if (await Promise.race([closed, delay(1_000).then(() => false)])) return;
  throw new Error("Firefox smoke proxy did not close.");
}

export async function stopProcess(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const graceMs = Math.max(1, Math.trunc(options.graceMs ?? 5_000));
  const forceMs = Math.max(1, Math.trunc(options.forceMs ?? 5_000));
  const gracefulAccepted = child.kill();
  if (gracefulAccepted && await waitForProcessExit(child, graceMs)) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  let forceAccepted = false;
  if (typeof options.force === "function") {
    forceAccepted = await options.force(child);
  } else if (process.platform === "win32" && Number.isInteger(child.pid)) {
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true
    });
    forceAccepted = !result.error;
  } else {
    forceAccepted = child.kill("SIGKILL");
  }
  if (forceAccepted && await waitForProcessExit(child, forceMs)) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  throw new Error(`Firefox process ${child.pid ?? "unknown"} did not exit after forced cleanup.`);
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
