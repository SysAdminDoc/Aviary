// Real userscript-manager storage and lifecycle proof for Tampermonkey and Violentmonkey.
//
// The model lanes in storage-authority-browser.test.mjs cover the storage protocol quickly. This
// lane is intentionally slower and less forgiving: it downloads pinned manager packages, verifies
// their published bytes, installs them into disposable profiles, installs the built Aviary script
// through each manager's editor, and drives the real GM_* APIs from two permitted X origins.
// Missing packages, browsers, editors, or lifecycle controls are errors. There is no Map-backed
// substitute in this file.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { build } from "esbuild";
import { chromium } from "playwright";
import {
  WebDriverClient,
  findFirefoxBinary,
  stopProcess,
  waitForExtensionOrigin
} from "./dnr-firefox.smoke.mjs";
import { sourceFingerprint } from "../../tools/build-fingerprint.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const userscriptPath = path.join(root, "dist", "aviary.user.js");
const buildInfoPath = path.join(root, "dist", "build-info.json");
const PACKAGE_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 10_000;
const TAMPERMONKEY = {
  name: "Tampermonkey",
  env: "AVIARY_TAMPERMONKEY_PACKAGE",
  url: "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0.7339.207&acceptformat=crx3&x=id%3Ddhdgffkkebhmkfjojejmpbldmpobfkfo%26uc",
  sha256: "bcaec082c439e11c4df683f43d07e9ac3d4439251d72b91c5b452f977dac15d5",
  version: "5.5.0",
  id: "dhdgffkkebhmkfjojejmpbldmpobfkfo",
  archive: "tampermonkey.crx"
};
const VIOLENTMONKEY = {
  name: "Violentmonkey",
  env: "AVIARY_VIOLENTMONKEY_PACKAGE",
  url: "https://github.com/violentmonkey/violentmonkey/releases/download/v2.47.0/Violentmonkey-webext-v2.47.0.zip",
  sha256: "97fc23ccc32ea7bd093d235221810cf9b012f6f00c6344e0bf6ec8fb66961219",
  version: "2.47.0",
  id: "{aecec67f-0d10-4fa7-b7c7-609a2db280cf}",
  archive: "violentmonkey.zip"
};

async function main() {
  const [builtUserscript, buildInfo] = await Promise.all([
    readFile(userscriptPath, "utf8"),
    readFile(buildInfoPath, "utf8").then(JSON.parse)
  ]);
  const expectedSource = await sourceFingerprint(root);
  if (buildInfo.sourceFingerprint !== expectedSource) {
    throw new Error("The userscript-manager lane found a stale source fingerprint. Run npm run build first.");
  }
  if (!/^\/\/ ==UserScript==/.test(builtUserscript)) {
    throw new Error("dist/aviary.user.js is missing its userscript metadata block.");
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-userscript-manager-"));
  let probeBundle;
  try {
    probeBundle = await buildManagerProbe(tempRoot);
    const tampermonkey = await materializeManager(TAMPERMONKEY, tempRoot);
    const violentmonkey = await materializeManager(VIOLENTMONKEY, tempRoot);
    const evidence = {
      sourceFingerprint: expectedSource,
      buildVersion: buildInfo.version,
      packages: {
        Tampermonkey: { version: tampermonkey.version, sha256: tampermonkey.sha256, url: tampermonkey.url },
        Violentmonkey: { version: violentmonkey.version, sha256: violentmonkey.sha256, url: violentmonkey.url }
      },
      results: {
        Tampermonkey: await runTampermonkey(tampermonkey, builtUserscript, probeBundle),
        Violentmonkey: await runViolentmonkey(violentmonkey, builtUserscript, probeBundle)
      }
    };
    console.log(`[userscript-manager] ${JSON.stringify(evidence)}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function materializeManager(spec, tempRoot) {
  const packagePath = process.env[spec.env]
    ? path.resolve(process.env[spec.env])
    : path.join(tempRoot, spec.archive);
  if (!process.env[spec.env]) {
    const response = await fetchWithTimeout(spec.url, PACKAGE_TIMEOUT_MS);
    await writeFile(packagePath, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = await readFile(packagePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    sha256,
    spec.sha256,
    `${spec.name} package provenance changed. Expected ${spec.sha256}, received ${sha256}.`
  );
  const archiveRoot = path.join(tempRoot, `${spec.name.toLowerCase()}-package`);
  await mkdir(archiveRoot, { recursive: true });
  const sevenZip = findSevenZip();
  if (!sevenZip) throw new Error("7-Zip is required to unpack the pinned userscript manager packages.");
  const extraction = spawnSync(sevenZip, ["x", "-y", `-o${archiveRoot}`, packagePath], {
    encoding: "utf8",
    windowsHide: true,
    timeout: PACKAGE_TIMEOUT_MS
  });
  if (extraction.error || extraction.status !== 0) {
    throw new Error(`${spec.name} package extraction failed: ${extraction.error?.message ?? extraction.stderr}`);
  }
  const manifestPath = await findFile(archiveRoot, "manifest.json");
  if (!manifestPath) throw new Error(`${spec.name} package did not contain manifest.json.`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, spec.version, `${spec.name} manifest version drifted`);
  if (spec === TAMPERMONKEY) {
    const localePath = await findFile(path.dirname(manifestPath), "messages.json");
    const locale = localePath ? JSON.parse(await readFile(localePath, "utf8")) : {};
    const localizedName = String(locale.extName?.message ?? manifest.name);
    assert.match(localizedName, /Tampermonkey/i);
    assert.ok(manifest.options_page || manifest.options_ui, "Tampermonkey options page is missing");
  } else {
    const localePath = await findFile(path.dirname(manifestPath), "messages.json");
    const locale = localePath ? JSON.parse(await readFile(localePath, "utf8")) : {};
    const localizedName = String(locale.extName?.message ?? manifest.name);
    assert.match(localizedName, /Violentmonkey/i);
    assert.equal(manifest.browser_specific_settings?.gecko?.id, spec.id);
    assert.ok(manifest.options_ui?.page, "Violentmonkey options page is missing");
  }
  return {
    ...spec,
    packagePath,
    archiveRoot,
    extensionDir: path.dirname(manifestPath),
    manifest,
    version: manifest.version,
    sha256
  };
}

async function buildManagerProbe(tempRoot) {
  const entry = path.join(tempRoot, "manager-probe.ts");
  const output = path.join(tempRoot, "manager-probe.user.js");
  const source = (relative) => JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
  const metadata = [
    "// ==UserScript==",
    "// @name         Aviary storage manager probe",
    "// @namespace    https://github.com/SysAdminDoc/Aviary",
    "// @version      1.48.0",
    "// @match        https://x.com/*",
    "// @match        https://twitter.com/*",
    "// @match        https://pro.x.com/*",
    "// @run-at       document-start",
    "// @inject-into  page",
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// @grant        GM_deleteValue",
    "// @grant        GM_listValues",
    "// @grant        GM_addValueChangeListener",
    "// @grant        GM_removeValueChangeListener",
    "// ==/UserScript==",
    ""
  ].join("\n");
  const probeSource = [
    `import { createStorageGateway } from ${source("src/platform/storage.ts")};`,
    `import { mutateStored, replaceStored, withStorageLock } from ${source("src/platform/storage-lock.ts")};`,
    "",
    "let storage;",
    "let storageInitError = null;",
    "try { storage = createStorageGateway(\"aviary\", { mode: \"userscript\" }); } catch (error) { storageInitError = String(error?.message ?? error); }",
    "const holds = new Map();",
    "const watches = new Map();",
    "let callbackCount = 0;",
    "const probeResults = new Map();",
    "window.__AVIARY_MANAGER_EVENTS = [];",
    "const scoped = (key) => key.startsWith(\"aviary.\") ? key : `aviary.${key}`;",
    "const emit = (payload) => document.dispatchEvent(new CustomEvent(\"AVIARY_MANAGER_EVENT\", { detail: JSON.stringify(payload) }));",
    "const probeEvents = [];",
    "const recordEvent = (payload) => { probeEvents.push(payload); emit(payload); };",
    "const result = (id, payload) => { probeResults.set(id, payload); emit({ type: \"AVIARY_MANAGER_PROBE_RESULT\", id, ...payload }); };",
    "async function run(command) {",
    "  const key = String(command.key ?? \"manager.smoke.v1\");",
    "  if (command.op === \"ping\") return { ready: true, origin: location.origin, storageInitError, managerApis: {",
    "    get: typeof GM_getValue === \"function\", set: typeof GM_setValue === \"function\",",
    "    list: typeof GM_listValues === \"function\", changes: typeof GM_addValueChangeListener === \"function\", injectInto: globalThis.GM_info?.injectInto ?? null } };",
    "  if (command.op === \"get\") return { value: await storage.get(key, command.fallback ?? null) };",
    "  if (command.op === \"put\") { await storage.set(key, command.value); return { ok: true }; }",
    "  if (command.op === \"remove\") { await storage.remove(key); return { ok: true }; }",
    "  if (command.op === \"keys\") return { keys: await storage.keys() };",
    "  if (command.op === \"replace\") { await replaceStored(storage, key, command.value); return { ok: true }; }",
    "  if (command.op === \"mutate\") {",
    "    const value = await mutateStored(storage, key, command.fallback ?? {}, (current) => ({",
    "      ...(current && typeof current === \"object\" ? current : {}), ...(command.patch ?? {}) }));",
    "    return { value };",
    "  }",
    "  if (command.op === \"watch\") {",
    "    if (typeof GM_addValueChangeListener !== \"function\") return { supported: false };",
    "    const watchId = String(command.watchId ?? crypto.randomUUID());",
    "    const onChange = (name, oldValue, newValue, remote) => { callbackCount += 1; recordEvent({ type: \"AVIARY_MANAGER_PROBE_EVENT\", event: \"change\", watchId, name, oldValue, newValue, remote }); }",
    "    const listeners = [GM_addValueChangeListener(scoped(key), onChange)];",
    "    if (key !== scoped(key)) listeners.push(GM_addValueChangeListener(key, onChange));",
    "    watches.set(watchId, listeners);",
    "    return { supported: true, watchId, listeners };",
    "  }",
    "  if (command.op === \"hasEvent\") return { matched: probeEvents.some((item) => item.event === command.event && (command.watchId === undefined || item.watchId === command.watchId) && (command.token === undefined || item.token === command.token)), callbackCount };",
    "  if (command.op === \"probeResult\") { const payload = probeResults.get(String(command.probeId)); return payload === undefined ? { done: false } : { done: true, payload }; }",
    "  if (command.op === \"unwatch\") {",
    "    const listeners = watches.get(String(command.watchId));",
    "    if (listeners !== undefined && typeof GM_removeValueChangeListener === \"function\") for (const listener of listeners) GM_removeValueChangeListener(listener);",
    "    watches.delete(String(command.watchId));",
    "    return { ok: true };",
    "  }",
    "  if (command.op === \"hold\" || command.op === \"startHold\") {",
    "    const token = String(command.token ?? crypto.randomUUID());",
    "    const pending = withStorageLock(key, async (fence) => {",
    "      recordEvent({ type: \"AVIARY_MANAGER_PROBE_EVENT\", event: \"hold-ready\", token, key });",
    "      await new Promise((resolve, reject) => holds.set(token, { resolve, reject }));",
    "      await storage.set(key, command.value, fence);",
    "      return { token };",
    "    }, { restoreGate: false });",
    "    if (command.op === \"startHold\") { void pending.then((value) => recordEvent({ type: \"AVIARY_MANAGER_PROBE_EVENT\", event: \"hold-done\", token, value }), (error) => recordEvent({ type: \"AVIARY_MANAGER_PROBE_EVENT\", event: \"hold-error\", token, message: String(error?.message ?? error) })); return { pending: true, token }; }",
    "    return await pending;",
    "  }",
    "  if (command.op === \"release\") {",
    "    const pending = holds.get(String(command.token));",
    "    if (!pending) throw new Error(`unknown hold ${command.token}`);",
    "    holds.delete(String(command.token)); pending.resolve(); return { ok: true };",
    "  }",
    "  if (command.op === \"throwingLock\") {",
    "    try { await withStorageLock(key, async () => { throw new Error(\"simulated interrupted restore\"); }, { restoreGate: false }); }",
    "    catch (error) { return { rejected: true, message: String(error?.message ?? error) }; }",
    "    throw new Error(\"interrupted restore unexpectedly resolved\");",
    "  }",
    "  if (command.op === \"fencedPut\") { await storage.set(key, command.value, command.fence); return { ok: true }; }",
    "  throw new Error(`unknown probe operation ${command.op}`);",
    "}",
    "document.addEventListener(\"AVIARY_MANAGER_COMMAND\", (event) => {",
    "  let data; try { data = JSON.parse(String(event.detail)); } catch { return; }",
    "  if (data?.type !== \"AVIARY_MANAGER_PROBE\") return;",
    "  const { id, ...command } = data;",
    "  Promise.resolve(run(command)).then((payload) => result(id, { ok: true, result: payload }),",
    "    (error) => result(id, { ok: false, error: String(error?.message ?? error) }));",
    "});",
    "window.__AVIARY_MANAGER_PROBE_READY = true;",
    "document.documentElement.dataset.aviaryProbeBoot = \"yes\";",
    "emit({ type: \"AVIARY_MANAGER_PROBE_READY\", origin: location.origin });"
  ].join("\n");
  await writeFile(entry, `${probeSource}\n`, "utf8");
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    banner: { js: metadata },
    logLevel: "silent"
  });
  return readFile(output, "utf8");
}

async function runTampermonkey(manager, builtUserscript, probeBundle) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-tampermonkey-run-"));
  let context;
  try {
    const profileDir = path.join(tempRoot, "profile");
    await mkdir(profileDir, { recursive: true });
    context = await launchChromiumManager(profileDir, manager.extensionDir);
    const extensionId = await waitForChromeExtension(context, /tampermonkey/i);
    await ensureChromeUserScriptsAllowed(context);
    await context.close();
    context = await launchChromiumManager(profileDir, manager.extensionDir);
    const restartedId = await waitForChromeExtension(context, /tampermonkey/i);
    assert.equal(restartedId, extensionId, "Tampermonkey changed id across the persistent-profile restart");
    await ensureChromeUserScriptsAllowed(context);
    await ensureChromeAllSiteAccess(context, restartedId);
    await configureChromiumRoutes(context);
    await ensureTampermonkeyDynamicApi(context, restartedId);
    await context.close();
    context = await launchChromiumManager(profileDir, manager.extensionDir);
    const apiRestartedId = await waitForChromeExtension(context, /tampermonkey/i);
    assert.equal(apiRestartedId, restartedId, "Tampermonkey changed id after the script API setting restart");
    await ensureChromeUserScriptsAllowed(context);
    await ensureChromeAllSiteAccess(context, apiRestartedId);
    await configureChromiumRoutes(context);
    await installTampermonkeyScript(context, restartedId, builtUserscript, "Aviary for X");
    await installTampermonkeyScript(context, restartedId, probeBundle, "Aviary storage manager probe");
    await installTampermonkeyScript(context, restartedId, [
      "// ==UserScript==",
      "// @name         Aviary manager sanity",
      "// @namespace    https://github.com/SysAdminDoc/Aviary",
      "// @version      1.48.0",
      "// @match        https://x.com/*",
      "// @match        https://twitter.com/*",
      "// @run-at       document-start",
      "// @grant        none",
      "// ==/UserScript==",
      "document.documentElement.dataset.aviaryManagerSanity = \"yes\";",
      "window.postMessage({ type: \"AVIARY_MANAGER_SANITY\" }, \"*\");"
    ].join("\n"), "Aviary manager sanity");
    const pages = await openChromiumOriginPair(context);
    await verifyManagerPair(pages, "Tampermonkey");
    const persisted = await exercisePair(pages, "Tampermonkey");
    await Promise.all(pages.map((page) => page.close()));
    await assertTampermonkeyScripts(context, restartedId);
    const worker = context.serviceWorkers().find((candidate) => candidate.url().includes(`chrome-extension://${extensionId}/`));
    if (!worker) throw new Error("Tampermonkey lifecycle control could not find its service worker.");
    await terminateChromiumServiceWorker(context, worker);
    await configureChromiumRoutes(context);
    const restartedPages = await openChromiumOriginPair(context);
    const finalId = await waitForChromeExtension(context, /tampermonkey/i);
    assert.equal(finalId, extensionId, "Tampermonkey id changed after the service-worker restart");
    const restartRead = await sendChromiumProbe(restartedPages[1], {
      op: "get",
      key: persisted.key,
      fallback: null
    });
    assert.deepEqual(restartRead, { value: persisted.finalValue });
    await Promise.all(restartedPages.map((page) => page.close()));
    return {
      browser: await context.browser().version(),
      manager: manager.version,
      origins: 2,
      valueChangeListener: true,
      lockContention: true,
      interruptedRestore: true,
      staleFence: true,
      serviceWorkerRestart: true,
      persisted: true
    };
  } finally {
    await context?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function terminateChromiumServiceWorker(context, worker) {
  const browser = context.browser();
  if (!browser || typeof browser.newBrowserCDPSession !== "function") {
    throw new Error("Chromium lifecycle control is unavailable for the userscript manager.");
  }
  const cdp = await browser.newBrowserCDPSession();
  const targets = await cdp.send("Target.getTargets");
  const target = targets.targetInfos.find((candidate) =>
    candidate.type === "service_worker" && candidate.url === worker.url()
  );
  if (!target) {
    await cdp.detach();
    throw new Error("Chromium lifecycle control could not find the userscript manager worker target.");
  }
  await cdp.send("Target.closeTarget", { targetId: target.targetId });
  await cdp.detach();
}

async function runViolentmonkey(manager, builtUserscript, probeBundle) {
  const firefoxBinary = findFirefoxBinary();
  if (!firefoxBinary) throw new Error("Violentmonkey lane cannot run: Mozilla Firefox is unavailable.");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "aviary-violentmonkey-run-"));
  const profileDir = path.join(tempRoot, "profile");
  const proxy = await startSyntheticHttpsProxy(tempRoot);
  let driver;
  try {
    await mkdir(profileDir, { recursive: true });
    driver = await WebDriverClient.start(firefoxBinary, tempRoot, proxy.port, { profileDir });
    const extensionId = await driver.installAddon(manager.extensionDir);
    assert.equal(extensionId, manager.id, "Firefox installed Violentmonkey under an unexpected id");
    const extensionOrigin = await waitForExtensionOrigin(driver.profileDir, manager.id);
    await installViolentmonkeyScript(driver, extensionOrigin, builtUserscript, "Aviary for X");
    await installViolentmonkeyScript(driver, extensionOrigin, probeBundle, "Aviary storage manager probe");
    await verifyFirefoxManagerDashboard(driver, extensionOrigin);
    const tabs = await openFirefoxOriginPair(driver);
    await verifyFirefoxManagerPair(driver, tabs);
    const persisted = await exerciseFirefoxPair(driver, tabs, "Violentmonkey");
    await driver.end();
    await stopProcess(driver.process);
    driver = undefined;

    driver = await WebDriverClient.start(firefoxBinary, tempRoot, proxy.port, { profileDir });
    const restartedId = await driver.installAddon(manager.extensionDir);
    assert.equal(restartedId, extensionId, "Violentmonkey changed id across the persistent-profile restart");
    const restartedOrigin = await waitForExtensionOrigin(driver.profileDir, manager.id);
    const restartedTabs = await openFirefoxOriginPair(driver);
    const restartRead = await sendFirefoxProbe(driver, restartedTabs[1], {
      op: "get",
      key: persisted.key,
      fallback: null
    });
    assert.deepEqual(restartRead, { value: persisted.finalValue });
    await verifyFirefoxManagerDashboard(driver, restartedOrigin);
    return {
      browser: driver.browserVersion,
      manager: manager.version,
      origins: 2,
      valueChangeListener: true,
      lockContention: true,
      interruptedRestore: true,
      staleFence: true,
      persisted: true
    };
  } finally {
    try { await driver?.end(); } catch {}
    try { await stopProcess(driver?.process); } catch {}
    await proxy.close();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

async function verifyManagerPair(pages, managerName) {
  for (const page of pages) {
    await page.evaluate(() => {
      globalThis.__AVIARY_MANAGER_EVENTS = [];
      document.addEventListener("AVIARY_MANAGER_EVENT", (event) => {
        try {
          const data = JSON.parse(String(event.detail));
          if (data?.type === "AVIARY_MANAGER_PROBE_EVENT") globalThis.__AVIARY_MANAGER_EVENTS.push(data);
        } catch {}
      });
      return true;
    });
    const ping = await sendChromiumProbe(page, { op: "ping" });
    assert.equal(ping.ready, true, `${managerName} probe did not run on ${new URL(page.url()).origin}`);
    assert.equal(ping.storageInitError, null, `${managerName} storage initialization failed: ${ping.storageInitError}`);
    assert.equal(ping.managerApis.get, true);
    assert.equal(ping.managerApis.set, true);
    assert.equal(ping.managerApis.list, true);
  }
  assert.notEqual(await pages[0].evaluate(() => location.origin), await pages[1].evaluate(() => location.origin));
}

async function verifyFirefoxManagerPair(driver, tabs) {
  for (const handle of tabs) {
    await switchFirefoxWindow(driver, handle);
    await driver.evaluate(null, () => {
      globalThis.__AVIARY_MANAGER_EVENTS = [];
      document.addEventListener("AVIARY_MANAGER_EVENT", (event) => {
        try {
          const data = JSON.parse(String(event.detail));
          if (data?.type === "AVIARY_MANAGER_PROBE_EVENT") globalThis.__AVIARY_MANAGER_EVENTS.push(data);
        } catch {}
      });
    });
    const ping = await sendFirefoxProbe(driver, handle, { op: "ping" });
    assert.equal(ping.ready, true);
    assert.equal(ping.managerApis.get, true);
    assert.equal(ping.managerApis.set, true);
    assert.equal(ping.managerApis.list, true);
  }
}

async function exercisePair(pages, managerName) {
  const key = `manager.smoke.${Date.now()}`;
  const initial = { manager: managerName, phase: "initial" };
  assert.deepEqual(await sendChromiumProbe(pages[0], { op: "put", key, value: initial }), { ok: true });
  await waitForSharedValue(
    () => sendChromiumProbe(pages[1], { op: "get", key, fallback: null }),
    initial,
    `${managerName} did not propagate the initial value across origins`
  );

  const watchId = `${managerName}-watch`;
  const watch = await sendChromiumProbe(pages[0], { op: "watch", key, watchId });
  assert.equal(watch.supported, true, `${managerName} did not expose GM_addValueChangeListener`);
  const changed = { manager: managerName, phase: "value-change" };
  await sendChromiumProbe(pages[1], { op: "put", key, value: changed });
  await waitForChromiumEvent(pages[0], { event: "change", watchId });
  await sendChromiumProbe(pages[0], { op: "unwatch", watchId });

  const contentionKey = `${key}.contention`;
  const holder = sendChromiumProbe(pages[0], {
    op: "hold",
    key: contentionKey,
    token: `${managerName}-hold`,
    value: { manager: managerName, phase: "holder" }
  });
  await waitForChromiumEvent(pages[0], { event: "hold-ready" });
  let writerSettled = false;
  const writer = sendChromiumProbe(pages[1], {
    op: "replace",
    key: contentionKey,
    value: { manager: managerName, phase: "writer" }
  }).then(() => { writerSettled = true; });
  await delay(100);
  assert.equal(writerSettled, false, `${managerName} did not serialize two origins through its manager store`);
  await sendChromiumProbe(pages[0], { op: "release", token: `${managerName}-hold` });
  await holder;
  await writer;
  const finalValue = { manager: managerName, phase: "writer" };
  assert.deepEqual(await sendChromiumProbe(pages[1], { op: "get", key: contentionKey, fallback: null }), { value: finalValue });

  const interruptedKey = `${key}.interrupted`;
  const interrupted = await sendChromiumProbe(pages[0], { op: "throwingLock", key: interruptedKey });
  assert.equal(interrupted.rejected, true);
  await sendChromiumProbe(pages[1], { op: "replace", key: interruptedKey, value: { recovered: true } });
  await waitForSharedValue(
    () => sendChromiumProbe(pages[0], { op: "get", key: interruptedKey, fallback: null }),
    { recovered: true },
    `${managerName} did not propagate the recovery write across origins`
  );

  const staleKey = `${key}.stale`;
  const fresh = { manager: managerName, phase: "fresh" };
  await sendChromiumProbe(pages[1], { op: "replace", key: staleKey, value: fresh });
  await sendChromiumProbe(pages[0], {
    op: "fencedPut",
    key: staleKey,
    value: { manager: managerName, phase: "expired-stale" },
    fence: { version: 1, name: `aviary.${staleKey}`, owner: "expired-owner", generation: 0, expiresAt: Date.now() - 1 }
  });
  assert.deepEqual(await sendChromiumProbe(pages[1], { op: "get", key: staleKey, fallback: null }), { value: fresh });
  await sendChromiumProbe(pages[0], { op: "remove", key });
  return { key: contentionKey, finalValue };
}

async function exerciseFirefoxPair(driver, tabs, managerName) {
  const key = `manager.smoke.${Date.now()}`;
  const initial = { manager: managerName, phase: "initial" };
  await switchFirefoxWindow(driver, tabs[0]);
  assert.deepEqual(await sendFirefoxProbe(driver, tabs[0], { op: "put", key, value: initial }), { ok: true });
  await waitForSharedValue(
    () => sendFirefoxProbe(driver, tabs[1], { op: "get", key, fallback: null }),
    initial,
    `${managerName} did not propagate the initial value across origins`
  );

  const watchId = `${managerName}-watch`;
  const watch = await sendFirefoxProbe(driver, tabs[0], { op: "watch", key, watchId });
  assert.equal(watch.supported, true, `${managerName} did not expose GM_addValueChangeListener`);
  await sendFirefoxProbe(driver, tabs[1], { op: "put", key, value: { manager: managerName, phase: "value-change" } });
  await waitForFirefoxEvent(driver, tabs[0], { event: "change", watchId });
  await sendFirefoxProbe(driver, tabs[0], { op: "unwatch", watchId });

  const contentionKey = `${key}.contention`;
  const holdToken = `${managerName}-hold`;
  await sendFirefoxProbe(driver, tabs[0], { op: "startHold", key: contentionKey, token: holdToken, value: { manager: managerName, phase: "holder" } });
  await waitForFirefoxEvent(driver, tabs[0], { event: "hold-ready" });
  const writerProbeId = await dispatchFirefoxProbe(driver, tabs[1], {
    op: "replace",
    key: contentionKey,
    value: { manager: managerName, phase: "writer" }
  });
  await delay(100);
  const writerBeforeRelease = await sendFirefoxProbe(driver, tabs[1], { op: "probeResult", probeId: writerProbeId });
  assert.equal(writerBeforeRelease.done, false, `${managerName} did not serialize two origins through its manager store`);
  await sendFirefoxProbe(driver, tabs[0], { op: "release", token: holdToken });
  await waitForFirefoxEvent(driver, tabs[0], { event: "hold-done", token: holdToken });
  const writerResult = await waitForFirefoxResult(driver, tabs[1], writerProbeId);
  assert.equal(writerResult.ok, true, `${managerName} writer failed: ${writerResult.error ?? "unknown error"}`);
  const finalValue = { manager: managerName, phase: "writer" };
  assert.deepEqual(await sendFirefoxProbe(driver, tabs[1], { op: "get", key: contentionKey, fallback: null }), { value: finalValue });

  const interruptedKey = `${key}.interrupted`;
  assert.equal((await sendFirefoxProbe(driver, tabs[0], { op: "throwingLock", key: interruptedKey })).rejected, true);
  await sendFirefoxProbe(driver, tabs[1], { op: "replace", key: interruptedKey, value: { recovered: true } });
  await waitForSharedValue(
    () => sendFirefoxProbe(driver, tabs[0], { op: "get", key: interruptedKey, fallback: null }),
    { recovered: true },
    `${managerName} did not propagate the recovery write across origins`
  );

  const staleKey = `${key}.stale`;
  const fresh = { manager: managerName, phase: "fresh" };
  await sendFirefoxProbe(driver, tabs[1], { op: "replace", key: staleKey, value: fresh });
  await sendFirefoxProbe(driver, tabs[0], {
    op: "fencedPut",
    key: staleKey,
    value: { manager: managerName, phase: "expired-stale" },
    fence: { version: 1, name: `aviary.${staleKey}`, owner: "expired-owner", generation: 0, expiresAt: Date.now() - 1 }
  });
  assert.deepEqual(await sendFirefoxProbe(driver, tabs[1], { op: "get", key: staleKey, fallback: null }), { value: fresh });
  await sendFirefoxProbe(driver, tabs[0], { op: "remove", key });
  return { key: contentionKey, finalValue };
}

async function waitForSharedValue(readValue, expectedValue, message) {
  const expected = { value: expectedValue };
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let actual = null;
  while (Date.now() < deadline) {
    actual = await readValue();
    if (isDeepStrictEqual(actual, expected)) return;
    await delay(100);
  }
  assert.deepEqual(actual, expected, message);
}

async function launchChromiumManager(profileDir, extensionDir) {
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

async function waitForChromeExtension(context, namePattern) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const targets = [...context.serviceWorkers(), ...context.backgroundPages()];
    const target = targets.find((candidate) => namePattern.test(candidate.url()));
    if (target) return new URL(target.url()).host;
    const anyExtension = targets.find((candidate) => candidate.url().startsWith("chrome-extension://"));
    if (anyExtension) return new URL(anyExtension.url()).host;
    await delay(100);
  }
  throw new Error("Chromium did not expose the installed userscript manager extension.");
}

async function ensureChromeUserScriptsAllowed(context) {
  const page = await context.newPage();
  try {
    await page.goto("chrome://extensions/");
    let state = "missing";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      state = await page.evaluate(() => {
        const find = (root, predicate) => {
          if (root?.nodeType === Node.ELEMENT_NODE && predicate(root)) return root;
          for (const element of root?.querySelectorAll?.("*") ?? []) {
            if (predicate(element)) return element;
            if (element.shadowRoot) {
              const nested = find(element.shadowRoot, predicate);
              if (nested) return nested;
            }
          }
          return null;
        };
        const developerMode = find(document, (element) => element.id === "devMode");
        const developerToggle = developerMode?.shadowRoot?.querySelector("#crToggle") ?? developerMode?.querySelector("#crToggle");
        if (developerToggle?.checked !== true) developerToggle?.click();
        const row = find(document, (element) => element.id === "allow-user-scripts");
        if (!row) {
          find(document, (element) => element.id === "detailsButton")?.click();
          return "expanded";
        }
        const toggle = row?.shadowRoot?.querySelector("#crToggle") ?? row?.querySelector("#crToggle");
        if (!toggle) return "missing-toggle";
        if (toggle.checked !== true) toggle.click();
        return toggle.checked === true ? "enabled" : "clicked";
      });
      if (state === "enabled" || state === "clicked") return;
      await page.waitForTimeout(250);
    }
    throw new Error(`Chrome did not expose the Allow User Scripts toggle (${state}).`);
  } finally {
    await page.close();
  }
}

async function installTampermonkeyScript(context, extensionId, script, expectedName) {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html#nav=new-user-script+editor`);
    await page.waitForFunction(() => Boolean(document.querySelector(".CodeMirror")?.CodeMirror), null, { timeout: 20_000 });
    await page.evaluate((value) => {
      const editor = document.querySelector(".CodeMirror")?.CodeMirror;
      if (!editor) throw new Error("Tampermonkey CodeMirror editor is unavailable");
      editor.setValue(value);
    }, script);
    await page.evaluate(() => {
      const save = document.querySelector('button[title="Save"]')
        ?? [...document.querySelectorAll("button")].find((button) => /^save$/i.test(button.textContent?.trim() ?? ""));
      if (!save) throw new Error("Tampermonkey Save control is unavailable");
      save.click();
    });
    await page.waitForTimeout(800);
    const dashboard = await page.evaluate(() => document.body?.innerText ?? "");
    assert.match(dashboard, new RegExp(expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Tampermonkey did not save ${expectedName}`);
  } finally {
    await page.close();
  }
}

async function ensureTampermonkeyDynamicApi(context, extensionId) {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html#nav=settings`);
    await page.waitForFunction(() => [...document.querySelectorAll("select")].some((select) =>
      [...select.options].some((option) => /UserScripts API Dynamic/i.test(option.textContent ?? ""))
    ), null, { timeout: 20_000 });
    await page.evaluate(() => {
      const select = [...document.querySelectorAll("select")].find((candidate) =>
        [...candidate.options].some((option) => /UserScripts API Dynamic/i.test(option.textContent ?? ""))
      );
      const option = [...select.options].find((candidate) => /UserScripts API Dynamic/i.test(candidate.textContent ?? ""));
      if (!select || !option) throw new Error("Tampermonkey UserScripts API setting is unavailable");
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
  } finally {
    await page.close();
  }
}

async function ensureChromeAllSiteAccess(context, extensionId) {
  const page = await context.newPage();
  try {
    await page.goto(`chrome://extensions/?id=${extensionId}`);
    await page.waitForFunction(() => {
      const find = (root, predicate) => {
        if (root?.nodeType === Node.ELEMENT_NODE && predicate(root)) return root;
        for (const element of root?.querySelectorAll?.("*") ?? []) {
          if (predicate(element)) return element;
          if (element.shadowRoot) {
            const nested = find(element.shadowRoot, predicate);
            if (nested) return nested;
          }
        }
        return null;
      };
      return Boolean(find(document, (element) => element.id === "hostAccess"));
    }, null, { timeout: 20_000 });
    await page.evaluate(() => {
      const find = (root, predicate) => {
        if (root?.nodeType === Node.ELEMENT_NODE && predicate(root)) return root;
        for (const element of root?.querySelectorAll?.("*") ?? []) {
          if (predicate(element)) return element;
          if (element.shadowRoot) {
            const nested = find(element.shadowRoot, predicate);
            if (nested) return nested;
          }
        }
        return null;
      };
      const select = find(document, (element) => element.id === "hostAccess");
      const option = [...select.options].find((candidate) => /On all sites/i.test(candidate.textContent ?? ""));
      if (!select || !option) throw new Error("Chrome did not expose the userscript manager site access control.");
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { value: select.value, label: select.selectedOptions[0]?.textContent?.trim() };
    });
    await page.locator("#hostAccess").selectOption({ label: "On all sites" });
    await page.waitForTimeout(250);
    await page.reload();
    await page.waitForTimeout(250);
    const persisted = await page.locator("#hostAccess").inputValue();
    if (!/all/i.test(persisted)) throw new Error(`Chrome did not persist userscript manager site access (${persisted}).`);
  } finally {
    await page.close();
  }
}

async function assertTampermonkeyScripts(context, extensionId) {
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html#nav=dashboard`);
    await page.waitForFunction(() => /Aviary for X/.test(document.body?.innerText ?? ""), null, { timeout: 20_000 });
    const body = await page.evaluate(() => document.body?.innerText ?? "");
    assert.match(body, /Aviary for X/);
    assert.match(body, /Aviary storage manager probe/);
  } finally {
    await page.close();
  }
}

async function configureChromiumRoutes(context) {
  for (const origin of ["https://x.com", "https://twitter.com", "https://pro.x.com"]) {
    await context.route(`${origin}/**`, (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><meta charset=utf-8><title>Aviary manager smoke</title><main>${origin}</main>`
    }));
  }
}

async function openChromiumOriginPair(context) {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("https://x.com/home"), second.goto("https://twitter.com/home")]);
  await delay(3_000);
  return [first, second];
}

function sendChromiumProbe(page, command) {
  return page.evaluate((payload) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      document.removeEventListener("AVIARY_MANAGER_EVENT", onEvent);
      reject(new Error(`userscript manager probe timed out: ${payload.op}`));
    }, 10_000);
    function onEvent(event) {
      let data;
      try { data = JSON.parse(String(event.detail)); } catch { return; }
      if (data?.type !== "AVIARY_MANAGER_PROBE_RESULT" || data.id !== id) return;
      clearTimeout(timer);
      document.removeEventListener("AVIARY_MANAGER_EVENT", onEvent);
      if (data.ok === false) reject(new Error(data.error));
      else resolve(data.result);
    }
    document.addEventListener("AVIARY_MANAGER_EVENT", onEvent);
    document.dispatchEvent(new CustomEvent("AVIARY_MANAGER_COMMAND", {
      detail: JSON.stringify({ type: "AVIARY_MANAGER_PROBE", id, ...payload })
    }));
  }), command);
}

async function waitForChromiumEvent(page, criteria) {
  await page.waitForFunction(({ event, watchId, token }) => {
    const events = globalThis.__AVIARY_MANAGER_EVENTS ?? [];
    return events.some((item) => item.event === event &&
      (watchId === undefined || item.watchId === watchId) &&
      (token === undefined || item.token === token));
  }, criteria, { timeout: PROBE_TIMEOUT_MS });
}

async function openFirefoxOriginPair(driver) {
  const first = await openFirefoxContentTab(driver, "https://x.com/home");
  const second = await openFirefoxContentTab(driver, "https://twitter.com/home");
  await delay(3_000);
  return [first, second];
}

async function openFirefoxContentTab(driver, url) {
  const before = await driver.request("GET", "/window/handles");
  await driver.setContext("chrome");
  try {
    await driver.executeSync(`
      const browserWindow = Services.wm.getMostRecentWindow("navigator:browser");
      const tab = browserWindow.gBrowser.addTab(arguments[0], {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
      browserWindow.gBrowser.selectedTab = tab;
      return true;
    `, [url]);
  } finally {
    await driver.setContext("content");
  }
  const handles = await driver.request("GET", "/window/handles");
  const handle = handles.find((candidate) => !before.includes(candidate));
  if (!handle) throw new Error(`Firefox did not open ${url}`);
  await switchFirefoxWindow(driver, handle);
  await waitForFirefox(driver, () => document.readyState === "complete", `Firefox did not load ${url}`);
  return handle;
}

async function installViolentmonkeyScript(driver, extensionOrigin, script, expectedName) {
  await driver.openExtensionPage(`${extensionOrigin}/options/index.html#scripts`);
  await waitForFirefox(driver, () => document.body?.innerText?.includes("Installed scripts"), "Violentmonkey scripts page did not load");
  await driver.evaluate(null, () => {
    const link = [...document.querySelectorAll("a")].find((element) => element.textContent?.trim() === "New");
    if (!link) throw new Error("Violentmonkey New script control is unavailable");
    link.click();
  });
  await waitForFirefox(driver, () => Boolean(document.querySelector(".CodeMirror")?.CodeMirror), "Violentmonkey CodeMirror editor is unavailable");
  await driver.evaluate(null, (value) => {
    const editor = document.querySelector(".CodeMirror")?.CodeMirror;
    if (!editor) throw new Error("Violentmonkey CodeMirror editor is unavailable");
    editor.setValue(value);
    const lastLine = editor.lineCount() - 1;
    editor.replaceRange("\n", { line: lastLine, ch: editor.getLine(lastLine).length });
  }, script);
  await delay(750);
  await driver.evaluate(null, () => {
    const save = [...document.querySelectorAll("button")].find((button) => /save\s*&?\s*close/i.test(button.textContent?.trim() ?? ""));
    if (!save) throw new Error("Violentmonkey Save & Close control is unavailable");
    save.click();
  });
  await delay(800);
  const body = await driver.evaluate(null, () => document.body?.innerText ?? "");
  assert.match(body, new RegExp(expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Violentmonkey did not save ${expectedName}`);
}

async function verifyFirefoxManagerDashboard(driver, extensionOrigin) {
  await driver.openExtensionPage(`${extensionOrigin}/options/index.html#scripts`);
  const body = await driver.evaluate(null, () => document.body?.innerText ?? "");
  assert.match(body, /Aviary for X/);
  assert.match(body, /Aviary storage manager probe/);
}

async function sendFirefoxProbe(driver, handle, command) {
  await switchFirefoxWindow(driver, handle);
  return driver.evaluate(null, (payload) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { document.removeEventListener("AVIARY_MANAGER_EVENT", onEvent); reject(new Error(`userscript manager probe timed out: ${payload.op}`)); }, 10_000);
    function onEvent(event) {
      let data;
      try { data = JSON.parse(String(event.detail)); } catch { return; }
      if (data?.type !== "AVIARY_MANAGER_PROBE_RESULT" || data.id !== id) return;
      clearTimeout(timer); document.removeEventListener("AVIARY_MANAGER_EVENT", onEvent);
      if (data.ok === false) reject(new Error(data.error)); else resolve(data.result);
    }
    document.addEventListener("AVIARY_MANAGER_EVENT", onEvent);
    document.dispatchEvent(new CustomEvent("AVIARY_MANAGER_COMMAND", {
      detail: JSON.stringify({ type: "AVIARY_MANAGER_PROBE", id, ...payload })
    }));
  }), command);
}

async function waitForFirefox(driver, predicate, message) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let lastNavigationError = null;
  while (Date.now() < deadline) {
    try {
      if (await driver.evaluate(null, predicate)) return;
      lastNavigationError = null;
    } catch (error) {
      // Firefox can replace about:blank while WebDriver has an async evaluation in flight.
      // Retry until the destination document settles, then preserve the last error on timeout.
      lastNavigationError = error;
    }
    await delay(100);
  }
  throw new Error(
    lastNavigationError ? `${message}: ${lastNavigationError.message}` : message,
    lastNavigationError ? { cause: lastNavigationError } : undefined
  );
}

async function waitForFirefoxEvent(driver, handle, criteria) {
  await switchFirefoxWindow(driver, handle);
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await sendFirefoxProbe(driver, handle, { op: "hasEvent", ...criteria });
    if (status.matched) return;
    await delay(100);
  }
  throw new Error("userscript manager probe did not report the expected event");
}

async function dispatchFirefoxProbe(driver, handle, command) {
  await switchFirefoxWindow(driver, handle);
  const id = randomUUID();
  await driver.executeSync(`
    const payload = arguments[0];
    document.dispatchEvent(new CustomEvent("AVIARY_MANAGER_COMMAND", {
      detail: JSON.stringify(payload)
    }));
    return true;
  `, [{ type: "AVIARY_MANAGER_PROBE", id, ...command }]);
  return id;
}

async function waitForFirefoxResult(driver, handle, probeId) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const outcome = await sendFirefoxProbe(driver, handle, { op: "probeResult", probeId });
    if (outcome.done) return outcome.payload;
    await delay(100);
  }
  throw new Error("userscript manager probe did not complete the dispatched operation");
}

async function switchFirefoxWindow(driver, handle) {
  await driver.request("POST", "/window", { handle });
  await driver.setContext("content");
}

async function startSyntheticHttpsProxy(tempRoot) {
  const keyPath = path.join(tempRoot, "proxy-key.pem");
  const certPath = path.join(tempRoot, "proxy-cert.pem");
  const opensslArgs = [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-subj", "/CN=x.com", "-addext", "subjectAltName=DNS:x.com,DNS:twitter.com,DNS:pro.x.com"
  ];
  const opensslBinaries = [
    process.env.OPENSSL_BINARY,
    "openssl",
    "C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe",
    "C:\\Program Files\\OpenSSL\\bin\\openssl.exe"
  ].filter(Boolean);
  let openssl;
  for (const candidate of opensslBinaries) {
    const result = spawnSync(candidate, opensslArgs, { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    if (!result.error && result.status === 0) {
      openssl = result;
      break;
    }
    openssl = result;
  }
  if (!openssl || openssl.error || openssl.status !== 0) {
    throw new Error(`OpenSSL is required for the Firefox userscript lane: ${openssl?.error?.message ?? openssl?.stderr ?? "not found"}`);
  }
  const tlsServer = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end("<!doctype html><meta charset=utf-8><title>Aviary manager smoke</title><main>synthetic X</main>");
  });
  await listen(tlsServer);
  const tlsPort = tlsServer.address().port;
  const proxy = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("synthetic userscript-manager proxy");
  });
  proxy.on("connect", (_request, clientSocket) => {
    const upstream = net.connect(tlsPort, "127.0.0.1");
    const close = () => { upstream.destroy(); clientSocket.destroy(); };
    upstream.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", close);
    clientSocket.on("error", close);
  });
  await listen(proxy);
  return {
    port: proxy.address().port,
    close: async () => {
      await Promise.all([closeServer(proxy), closeServer(tlsServer)]);
    }
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function findSevenZip() {
  const candidates = [process.env.AVIARY_7ZIP, "C:/Program Files/7-Zip/7z.exe", "7z"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["i"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

async function findFile(directory, wanted) {
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === wanted) return file;
    if (entry.isDirectory()) {
      const found = await findFile(file, wanted);
      if (found) return found;
    }
  }
  return null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
