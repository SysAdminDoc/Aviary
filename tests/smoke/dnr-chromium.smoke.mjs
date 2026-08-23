// Browser-owned request blocking proof for the packaged Chromium extension.
//
// `declarativeNetRequestFeedback` is added only to a temporary copy so the unpacked build can use
// testMatchOutcome. The shipped manifest is separately required to omit that warning-bearing
// permission; every runtime file and production rule exercised here still comes from dist/.

import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtExtension = path.join(root, "dist", "extension-chrome");
const tempRoot = await mkdtemp(path.join(tmpdir(), "aviary-dnr-chromium-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
let context;
let seedContext;

try {
  seedContext = await seedLegacyHostDatabase(profileDir);
  await seedContext.close();
  seedContext = undefined;

  await cp(builtExtension, extensionDir, { recursive: true });
  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.permissions = [...manifest.permissions, "declarativeNetRequestFeedback"];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--headless=new",
      "--no-sandbox"
    ]
  });

  const worker = context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const extensionId = new URL(worker.url()).host;

  // The previous release opened this database in x.com's origin. The first packaged content boot
  // must copy it into the background origin, verify it, and leave no page-enumerable database.
  await context.route("https://x.com/storage-smoke**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html lang=\"en\"><head><title>Storage smoke</title></head><body><main></main></body></html>"
    })
  );
  const xPage = await context.newPage();
  await xPage.goto("https://x.com/storage-smoke");
  await xPage.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
    timeout: 15_000
  });
  assert.equal(
    await xPage.evaluate(async () =>
      (await indexedDB.databases()).some((database) => database.name === "aviary.durable.v1")
    ),
    false,
    "x.com can still enumerate Aviary's migrated database"
  );

  const storagePage = await context.newPage();
  await storagePage.goto(`chrome-extension://${extensionId}/options.html`);
  await storagePage.waitForFunction(() => document.documentElement.lang === "ja");
  const activeProfile = await storagePage.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "get",
      key: "aviary.profile.active.v1"
    })
  );
  assert.deepEqual(activeProfile, {
    ok: true,
    result: { found: true, value: "account-smoke" }
  });

  try {
    await waitFor(async () => {
      const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
      return rules.some((rule) => rule.id === 73001);
    }, "default-on dynamic rule was not installed");
  } catch (error) {
    const diagnostics = await worker.evaluate(async () => ({
      rules: await chrome.declarativeNetRequest.getDynamicRules(),
      state: await chrome.storage.local.get("aviary.runtime.adLoggerRule.v1"),
      regex: await chrome.declarativeNetRequest.isRegexSupported({
        regex: "^https://[^/]+/i/api/1[.]1/promoted_content/log[.]json([?].*)?$"
      })
    }));
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
  }

  const matched = await worker.evaluate(async () =>
    chrome.declarativeNetRequest.testMatchOutcome({
      url: "https://x.com/i/api/1.1/promoted_content/log.json?event=impression",
      initiator: "https://x.com",
      method: "post",
      type: "xmlhttprequest"
    })
  );
  assert.deepEqual(matched.matchedRules.map((rule) => rule.ruleId), [73001]);

  for (const url of [
    "https://x.com/i/api/graphql/query/HomeTimeline",
    "https://x.com/i/api/1.1/promoted_content/content.json",
    "https://video.twimg.com/ext_tw_video/fixture.mp4",
    "https://evil.example/i/api/1.1/promoted_content/log.json"
  ]) {
    const outcome = await worker.evaluate(async (requestUrl) =>
      chrome.declarativeNetRequest.testMatchOutcome({
        url: requestUrl,
        initiator: "https://x.com",
        method: "post",
        type: "xmlhttprequest"
      }), url
    );
    assert.deepEqual(outcome.matchedRules, [], `control request matched: ${url}`);
  }

  let routeHits = 0;
  await context.route("https://x.com/i/api/1.1/promoted_content/log.json**", async (route) => {
    routeHits += 1;
    await route.fulfill({
      status: 204,
      headers: { "access-control-allow-origin": "*" },
      body: ""
    });
  });

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);

  const enabledRequest = await requestLogger(extensionPage);
  assert.equal(enabledRequest.ok, false, "enabled DNR allowed the logger request");
  assert.equal(routeHits, 0, "enabled logger reached the loopback route");

  const disabled = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: false })
  );
  assert.deepEqual(disabled, { ok: true, enabled: false });
  await waitFor(async () => (await worker.evaluate(() =>
    chrome.declarativeNetRequest.getDynamicRules()
  )).every((rule) => rule.id !== 73001), "dynamic rule did not disable");

  const disabledRequest = await requestLogger(extensionPage);
  assert.deepEqual(disabledRequest, { ok: true, status: 204 });
  assert.equal(routeHits, 1, "disabled logger did not reach the loopback route exactly once");

  const enabled = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: true })
  );
  assert.deepEqual(enabled, { ok: true, enabled: true });
  await waitFor(async () => (await worker.evaluate(() =>
    chrome.declarativeNetRequest.getDynamicRules()
  )).some((rule) => rule.id === 73001), "dynamic rule did not re-enable");

  const reenabledRequest = await requestLogger(extensionPage);
  assert.equal(reenabledRequest.ok, false, "re-enabled DNR allowed the logger request");
  assert.equal(routeHits, 1, "re-enabled logger escaped to the loopback route");
  assert.equal(
    await worker.evaluate(async () =>
      (await chrome.storage.local.get("aviary.runtime.adLoggerRule.v1"))["aviary.runtime.adLoggerRule.v1"]
    ),
    true
  );

  // Write through the public client, close the isolated browser to discard its worker, then
  // read through a newly-started worker. IndexedDB, not module memory, must carry the value.
  assert.deepEqual(
    await storagePage.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "AVIARY_DURABLE_STORAGE",
        operation: "put",
        key: "aviary.profile.account-smoke.userNotes.v1",
        value: { alice: "survives restart" }
      })
    ),
    { ok: true, result: null }
  );
  await context.close();
  context = undefined;
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--headless=new",
      "--no-sandbox"
    ]
  });
  const restartedWorker = context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  assert.equal(new URL(restartedWorker.url()).host, extensionId);
  const restartedPage = await context.newPage();
  await restartedPage.goto(`chrome-extension://${extensionId}/options.html`);
  const afterRestart = await restartedPage.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "get",
      key: "aviary.profile.account-smoke.userNotes.v1"
    })
  );
  assert.deepEqual(afterRestart, {
    ok: true,
    result: { found: true, value: { alice: "survives restart" } }
  });

  console.log(
    "[dnr-chromium] background storage migration/restart, exact DNR match, negative controls, persistence, and loopback blocking passed."
  );
} finally {
  await seedContext?.close().catch(() => {});
  await context?.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}

async function seedLegacyHostDatabase(profile) {
  const seeded = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ["--no-sandbox"]
  });
  await seeded.route("https://x.com/storage-seed**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>legacy storage seed</body></html>"
    })
  );
  const page = await seeded.newPage();
  await page.goto("https://x.com/storage-seed");
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("aviary.durable.v1", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("values", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("values", "readwrite");
      const store = transaction.objectStore("values");
      const now = new Date().toISOString();
      store.put({
        key: "aviary.profiles.v1",
        value: {
          profiles: [{
            id: "account-smoke",
            label: "Smoke profile",
            kind: "x-account",
            createdAt: now,
            lastUsedAt: now
          }]
        },
        updatedAt: now
      });
      store.put({ key: "aviary.profile.active.v1", value: "account-smoke", updatedAt: now });
      store.put({
        key: "aviary.profile.account-smoke.settings.v1",
        value: { schemaVersion: 8, i18n: { locale: "ja" } },
        updatedAt: now
      });
      store.put({
        key: "__aviary_meta__",
        value: {
          schemaVersion: 1,
          migratedKeys: ["aviary.profiles.v1", "aviary.profile.active.v1"],
          migratedAt: now
        },
        updatedAt: now
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  return seeded;
}

async function requestLogger(page) {
  return page.evaluate(async () => {
    try {
      const response = await fetch(
        "https://x.com/i/api/1.1/promoted_content/log.json?event=smoke",
        { method: "POST", body: "fixture" }
      );
      return { ok: true, status: response.status };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}

async function waitFor(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
