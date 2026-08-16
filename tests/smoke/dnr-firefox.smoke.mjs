// Real Firefox MV3 event-page and declarativeNetRequest proof.
//
// Playwright cannot temporarily install an unpacked Firefox add-on, so this uses WebDriver BiDi's
// extension installer with Firefox's DevTools protocol as a compatibility fallback and runtime.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtExtension = path.join(root, "dist", "extension-firefox");
const extensionId = "aviary@example.local";
async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-dnr-firefox-"));
  const extensionDir = path.join(tempRoot, "extension");
  const profileDir = path.join(tempRoot, "profile");
  let firefoxProcess;
  let bidi;
  let extensionRdp;
  let proxy;

  try {
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
  const rdpPort = await reservePort();
  fs.mkdirSync(profileDir, { recursive: true });
  writeFirefoxProfile(profileDir, proxy.port, rdpPort);

  const launched = await launchFirefox(binary, profileDir, rdpPort);
  firefoxProcess = launched.child;
  bidi = await Bidi.connect(launched.bidiUrl);
  const capabilities = await bidi.must("session.new", { capabilities: {} });

  let installedExtensionId;
  try {
    const installed = await bidi.must("webExtension.install", {
      extensionData: { type: "path", path: extensionDir }
    });
    installedExtensionId = installed.extension;
  } catch (error) {
    if (!/unknown command|unsupported operation/i.test(String(error))) throw error;
    const rdp = await Rdp.connect(rdpPort);
    await rdp.next();
    const rootActor = await rdp.request({ to: "root", type: "getRoot" });
    const installed = await rdp.request({
      to: rootActor.addonsActor,
      type: "installTemporaryAddon",
      addonPath: extensionDir,
      openDevTools: false
    });
    rdp.close();
    assert.equal(installed.error, undefined, installed.message ?? "Firefox refused the add-on");
    installedExtensionId = installed.addon?.id;
  }
  assert.equal(installedExtensionId, extensionId);
  extensionRdp = await Rdp.connect(rdpPort);
  await extensionRdp.next();
  const backgroundTarget = await findExtensionBackground(extensionRdp);
  const extensionClient = new RdpExtensionContext(extensionRdp, backgroundTarget.consoleActor);
  const extensionContext = null;
  await extensionClient.evaluate(extensionContext, () =>
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") }).then((tab) => tab.id)
  );
  const optionsTarget = await waitForExtensionTarget(
    extensionRdp,
    (target) => target.url?.endsWith("/options.html"),
    "Firefox did not open Aviary's options page"
  );
  const messageClient = new RdpExtensionContext(extensionRdp, optionsTarget.consoleActor);

  await waitFor(
    extensionClient,
    extensionContext,
    () => chrome.declarativeNetRequest.getDynamicRules().then((rules) =>
      rules.some((rule) => rule.id === 73001)
    ),
    "default-on dynamic rule was not installed"
  );

  const outcomes = await extensionClient.evaluate(extensionContext, () => Promise.all([
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
      type: "xmlhttprequest"
    })).matchedRules.map((rule) => rule.ruleId)
  }))));
  assert.deepEqual(outcomes[0].matches, [73001]);
  for (const outcome of outcomes.slice(1)) {
    assert.deepEqual(outcome.matches, [], `control request matched: ${outcome.url}`);
  }

  const connectsBefore = xConnectCount(proxy.seen);
  const enabledRequest = await requestLogger(extensionClient, extensionContext);
  assert.equal(enabledRequest.ok, false);
  await delay(250);
  assert.equal(xConnectCount(proxy.seen), connectsBefore, "enabled logger reached the proxy");

  const disabled = await messageClient.evaluate(extensionContext, () =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: false })
  );
  assert.deepEqual(disabled, { ok: true, enabled: false });
  await waitFor(
    extensionClient,
    extensionContext,
    () => chrome.declarativeNetRequest.getDynamicRules().then((rules) =>
      rules.every((rule) => rule.id !== 73001)
    ),
    "dynamic rule did not disable"
  );

  const disabledRequest = await requestLogger(extensionClient, extensionContext);
  assert.equal(disabledRequest.ok, false, "the refusing proxy should make the control request fail");
  await waitForValue(
    () => xConnectCount(proxy.seen) === connectsBefore + 1,
    "disabled logger never reached the loopback proxy"
  );

  const enabled = await messageClient.evaluate(extensionContext, () =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: true })
  );
  assert.deepEqual(enabled, { ok: true, enabled: true });
  await waitFor(
    extensionClient,
    extensionContext,
    () => chrome.declarativeNetRequest.getDynamicRules().then((rules) =>
      rules.some((rule) => rule.id === 73001)
    ),
    "dynamic rule did not re-enable"
  );

  const reenabledRequest = await requestLogger(extensionClient, extensionContext);
  assert.equal(reenabledRequest.ok, false);
  await delay(250);
  assert.equal(
    xConnectCount(proxy.seen),
    connectsBefore + 1,
    "re-enabled logger escaped to the proxy"
  );
  assert.equal(
    await extensionClient.evaluate(extensionContext, () =>
      chrome.storage.local.get("aviary.runtime.adLoggerRule.v1").then((state) =>
        state["aviary.runtime.adLoggerRule.v1"]
      )
    ),
    true
  );

  console.log(
    `[dnr-firefox] Firefox ${capabilities.capabilities.browserVersion}: event page, exact match, four negative controls, enable/disable persistence, and pre-network loopback blocking passed.`
  );
  } finally {
    try {
      extensionRdp?.close();
    } catch {
      // process cleanup below is authoritative
    }
    try {
      bidi?.socket.close();
    } catch {
      // already closed
    }
    firefoxProcess?.kill();
    await closeServer(proxy?.server);
    await delay(350);
    await rm(tempRoot, { recursive: true, force: true });
  }
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

function writeFirefoxProfile(directory, proxyPort, rdpPort) {
  const prefs = [
    ["devtools.debugger.remote-enabled", true],
    ["devtools.debugger.prompt-connection", false],
    ["devtools.chrome.enabled", true],
    ["devtools.debugger.remote-port", rdpPort],
    ["extensions.dnr.feedback", true],
    ["network.proxy.type", 1],
    ["network.proxy.http", '"127.0.0.1"'],
    ["network.proxy.http_port", proxyPort],
    ["network.proxy.ssl", '"127.0.0.1"'],
    ["network.proxy.ssl_port", proxyPort],
    ["network.proxy.allow_hijacking_localhost", true],
    ["network.proxy.no_proxies_on", '""'],
    ["network.captive-portal-service.enabled", false],
    ["network.connectivity-service.enabled", false],
    ["browser.region.network.url", '""'],
    ["services.settings.server", '""'],
    ["extensions.getAddons.cache.enabled", false],
    ["browser.shell.checkDefaultBrowser", false],
    ["datareporting.policy.dataSubmissionEnabled", false],
    ["datareporting.healthreport.uploadEnabled", false],
    ["toolkit.telemetry.enabled", false],
    ["browser.aboutwelcome.enabled", false],
    ["browser.startup.homepage_override.mstone", '"ignore"'],
    ["app.update.auto", false],
    ["extensions.update.enabled", false],
    ["browser.safebrowsing.malware.enabled", false],
    ["browser.safebrowsing.phishing.enabled", false]
  ];
  fs.writeFileSync(
    path.join(directory, "user.js"),
    `${prefs.map(([key, value]) => `user_pref("${key}", ${value});`).join("\n")}\n`
  );
}

function launchFirefox(binary, profile, rdpPort) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      "--profile",
      profile,
      "--remote-debugging-port",
      "0",
      "--start-debugger-server",
      String(rdpPort),
      "--no-remote",
      "--headless",
      "about:blank"
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let buffered = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Firefox never opened BiDi:\n${buffered}`));
      }
    }, 60_000);
    const scan = (chunk) => {
      buffered += String(chunk);
      const match = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(buffered);
      if (!settled && match) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, bidiUrl: `${match[1].replace(/\/$/, "")}/session` });
      }
    };
    child.stdout.on("data", scan);
    child.stderr.on("data", scan);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`Firefox exited (${code}) before BiDi:\n${buffered}`));
    });
  });
}

async function findExtensionBackground(rdp) {
  const addons = await rdp.request({ to: "root", type: "listAddons" });
  const aviaryAddon = addons.addons?.find((addon) => addon.id === extensionId);
  assert.ok(aviaryAddon?.actor, "Firefox did not expose Aviary's extension descriptor");
  const watcher = await rdp.request({ to: aviaryAddon.actor, type: "getWatcher" });
  const packets = [];
  await rdp.request(
    { to: watcher.actor, type: "watchTargets", targetType: "frame" },
    packets
  );
  const hasBackground = () => packets.some(
    (packet) => packet.target?.url?.includes("_generated_background_page.html")
  );
  while (!hasBackground()) packets.push(await rdp.next());
  return packets.find(
    (packet) => packet.target?.url?.includes("_generated_background_page.html")
  ).target;
}

async function waitForExtensionTarget(rdp, predicate, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const index = rdp.events.findIndex((packet) => predicate(packet.target ?? {}));
    if (index >= 0) return rdp.events.splice(index, 1)[0].target;
    const remaining = deadline - Date.now();
    const packet = await Promise.race([
      rdp.next(),
      delay(remaining).then(() => null)
    ]);
    if (!packet) break;
    if (predicate(packet.target ?? {})) return packet.target;
    rdp.events.push(packet);
  }
  throw new Error(message);
}

class RdpExtensionContext {
  constructor(rdp, consoleActor) {
    this.rdp = rdp;
    this.consoleActor = consoleActor;
    this.evaluationId = 0;
  }

  async evaluate(_context, fn) {
    const key = `__aviarySmokeResult${++this.evaluationId}`;
    const encodedKey = JSON.stringify(key);
    const text = `globalThis[${encodedKey}] = undefined; Promise.resolve((${String(fn)})()).then(`
      + `(value) => { globalThis[${encodedKey}] = JSON.stringify({ ok: true, value }); }, `
      + `(error) => { globalThis[${encodedKey}] = JSON.stringify({ ok: false, error: String(error) }); })`;
    await this.#evaluateRaw(text);
    const deadline = Date.now() + 15_000;
    let result;
    while (Date.now() < deadline) {
      result = await this.#evaluateRaw(`globalThis[${encodedKey}]`);
      if (typeof result === "string") break;
      await delay(25);
    }
    await this.#evaluateRaw(`delete globalThis[${encodedKey}]`);
    if (typeof result !== "string") throw new Error("Firefox extension evaluation timed out");
    const envelope = JSON.parse(result);
    if (!envelope.ok) throw new Error(envelope.error);
    return envelope.value;
  }

  async #evaluateRaw(text) {
    const started = await this.rdp.request({
      to: this.consoleActor,
      type: "evaluateJSAsync",
      text
    });
    if (started.error) throw new Error(started.message ?? started.error);
    let completed;
    do {
      completed = await this.rdp.next();
      if (completed.type !== "evaluationResult" || completed.resultID !== started.resultID) {
        this.rdp.events.push(completed);
      }
    } while (completed.type !== "evaluationResult" || completed.resultID !== started.resultID);
    if (completed.hasException) {
      throw new Error(completed.exceptionMessage ?? "Firefox extension evaluation failed");
    }
    return completed.result;
  }
}

class Rdp {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.events = [];
    this.inbox = [];
    this.waiters = [];
    this.error = null;
    this.closed = false;
    socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.drain();
    });
    socket.on("error", (error) => {
      if (this.closed) return;
      this.error = error;
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    });
  }

  drain() {
    for (;;) {
      const colon = this.buffer.indexOf(0x3a);
      if (colon < 0) return;
      const length = Number.parseInt(this.buffer.subarray(0, colon).toString("ascii"), 10);
      if (!Number.isFinite(length) || this.buffer.length < colon + 1 + length) return;
      const packet = JSON.parse(
        this.buffer.subarray(colon + 1, colon + 1 + length).toString("utf8")
      );
      this.buffer = this.buffer.subarray(colon + 1 + length);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(packet);
      else this.inbox.push(packet);
    }
  }

  next() {
    if (this.error) return Promise.reject(this.error);
    if (this.inbox.length > 0) return Promise.resolve(this.inbox.shift());
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  close() {
    this.closed = true;
    this.socket.destroy();
  }

  async request(packet, events = this.events) {
    const body = JSON.stringify(packet);
    this.socket.write(`${Buffer.byteLength(body)}:${body}`);
    for (;;) {
      const response = await this.next();
      if (response.from === packet.to && !response.type) return response;
      events.push(response);
    }
  }

  static connect(port, timeout = 45_000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const attempt = () => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(new Rdp(socket)));
        socket.once("error", () => {
          socket.destroy();
          if (Date.now() > deadline) reject(new Error("Firefox never opened the add-on port"));
          else setTimeout(attempt, 300);
        });
      };
      attempt();
    });
  }
}

class Bidi {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id != null && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    };
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error(`Could not open Firefox BiDi at ${url}`));
    });
    return new Bidi(socket);
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async must(method, params) {
    const response = await this.send(method, params);
    if (response.type === "error") {
      throw new Error(`${method}: ${response.error} - ${response.message}`);
    }
    return response.result;
  }

  async evaluate(context, fn) {
    const response = await this.send("script.callFunction", {
      functionDeclaration: String(fn),
      awaitPromise: true,
      target: { context },
      arguments: []
    });
    if (response.type === "error") {
      throw new Error(`script.callFunction: ${response.message}`);
    }
    if (response.result.type === "exception") {
      throw new Error(`Firefox page threw: ${response.result.exceptionDetails?.text ?? "unknown"}`);
    }
    return deserialize(response.result.result);
  }
}

function deserialize(value) {
  if (!value || typeof value !== "object") return value;
  switch (value.type) {
    case "undefined":
    case "null":
      return null;
    case "string":
    case "boolean":
    case "number":
      return value.value;
    case "array":
    case "set":
      return (value.value ?? []).map(deserialize);
    case "object":
    case "map":
      return Object.fromEntries(
        (value.value ?? []).map(([key, entry]) => [deserialize(key), deserialize(entry)])
      );
    default:
      return value.value ?? null;
  }
}

async function requestLogger(client, context) {
  return client.evaluate(context, () => fetch(
    "https://x.com/i/api/1.1/promoted_content/log.json?event=smoke",
    { method: "POST", body: "fixture" }
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

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(resolve);
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await main();
