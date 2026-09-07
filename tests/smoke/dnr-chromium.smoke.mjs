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

  // Eviction exemption and the storage figures, in a real packaged extension rather than against
  // a stubbed manager. Both halves have failed silently here before: `estimate` was invoked with
  // `navigator` instead of `navigator.storage`, which throws "Illegal invocation" and left Trust
  // with no usage or quota at all, and persistence cannot be read from `persisted()` because
  // Chrome leaves that false for extension origins while granting `unlimitedStorage`.
  //
  // Driven from the options page, not the worker: a service worker does not receive its own
  // `runtime.sendMessage`, and `navigator.storage.persist` does not exist in a worker at all.
  const persistence = await storagePage.evaluate(async () => {
    const estimate = await chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "estimate"
    });
    return {
      estimate,
      exempt: await chrome.permissions.contains({ permissions: ["unlimitedStorage"] }),
      standardBit: await navigator.storage.persisted()
    };
  });
  assert.equal(persistence.exempt, true, "the packaged extension lost its eviction exemption");
  assert.equal(persistence.estimate?.ok, true, "the background could not measure its own storage");
  assert.equal(
    persistence.estimate?.result?.persisted,
    true,
    "an exempt extension must not report its library as best effort"
  );
  assert.ok(
    Number.isFinite(persistence.estimate?.result?.quota) && persistence.estimate.result.quota > 0,
    `Trust would show no quota: ${JSON.stringify(persistence.estimate)}`
  );
  assert.equal(
    persistence.standardBit,
    false,
    "Chrome now sets the Storage Standard persistence bit for extensions; simplify the fallback"
  );

  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${extensionId}/options.html`);
  const xTabId = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const xTab = tabs.find((tab) => typeof tab.url === "string" && tab.url.startsWith("https://x.com/"));
    if (typeof xTab?.id !== "number") throw new Error("could not identify the X smoke tab");
    return xTab.id;
  });

  try {
    await waitFor(async () => {
      const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
      return rules.some((rule) => rule.condition?.tabIds?.includes(xTabId));
    }, "default-on tab session rule was not installed");
  } catch (error) {
    const diagnostics = await worker.evaluate(async () => ({
      rules: await chrome.declarativeNetRequest.getSessionRules(),
      regex: await chrome.declarativeNetRequest.isRegexSupported({
        regex: "^https://[^/]+/i/api/1[.]1/promoted_content/log[.]json([?].*)?$"
      })
    }));
    throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
  }

  const matched = await matchLogger(worker, xTabId);
  assert.equal(matched.matchedRules.length, 1);
  assert.equal(matched.matchedRules[0].ruleId, xTabId === 0 ? 1 : xTabId);

  for (const url of [
    "https://x.com/i/api/graphql/query/HomeTimeline",
    "https://x.com/i/api/1.1/promoted_content/content.json",
    "https://video.twimg.com/ext_tw_video/fixture.mp4",
    "https://evil.example/i/api/1.1/promoted_content/log.json"
  ]) {
    const outcome = await worker.evaluate(async ({ requestUrl, tabId }) =>
      chrome.declarativeNetRequest.testMatchOutcome({
        url: requestUrl,
        initiator: "https://x.com",
        method: "post",
        type: "xmlhttprequest",
        tabId
      }), { requestUrl: url, tabId: xTabId }
    );
    assert.deepEqual(outcome.matchedRules, [], `control request matched: ${url}`);
  }

  assert.equal((await matchLogger(worker, xTabId)).matchedRules.length, 1, "enabled DNR did not match the logger");

  const disabled = await extensionPage.evaluate((tabId) =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: false, tabId }), xTabId
  );
  assert.deepEqual(disabled, { ok: true, enabled: false });
  await waitFor(async () => (await worker.evaluate(() =>
    chrome.declarativeNetRequest.getSessionRules()
  )).every((rule) => !rule.condition?.tabIds?.includes(xTabId)), "tab session rule did not disable");

  assert.equal((await matchLogger(worker, xTabId)).matchedRules.length, 0, "disabled DNR still matched the logger");

  const enabled = await extensionPage.evaluate((tabId) =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: true, tabId }), xTabId
  );
  assert.deepEqual(enabled, { ok: true, enabled: true });
  await waitFor(async () => (await worker.evaluate(() =>
    chrome.declarativeNetRequest.getSessionRules()
  )).some((rule) => rule.condition?.tabIds?.includes(xTabId)), "tab session rule did not re-enable");

  assert.equal((await matchLogger(worker, xTabId)).matchedRules.length, 1, "re-enabled DNR did not match the logger");

  // A second tab can be explicitly disabled without changing the first tab's blocker.
  const secondPage = await context.newPage();
  await secondPage.goto("https://x.com/storage-smoke-second");
  await secondPage.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
    timeout: 15_000
  });
  const secondTabId = await extensionPage.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const candidates = tabs.filter((tab) => typeof tab.url === "string" && tab.url.startsWith("https://x.com/"));
    const tab = candidates.at(-1);
    if (typeof tab?.id !== "number") throw new Error("could not identify the second X smoke tab");
    return tab.id;
  });
  await extensionPage.evaluate((tabId) =>
    chrome.runtime.sendMessage({ type: "AVIARY_SYNC_AD_RULE", enabled: false, tabId }), secondTabId
  );
  await waitFor(async () => {
    const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    return rules.some((rule) => rule.condition?.tabIds?.includes(xTabId)) &&
      !rules.some((rule) => rule.condition?.tabIds?.includes(secondTabId));
  }, "opposing tab state raced");
  assert.equal((await matchLogger(worker, xTabId)).matchedRules.length, 1, "disabling the second tab changed the first tab");
  assert.equal((await matchLogger(worker, secondTabId)).matchedRules.length, 0, "the disabled second tab still matched the logger");
  await secondPage.close();
  await waitFor(async () => (await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()))
    .every((rule) => !rule.condition?.tabIds?.includes(secondTabId)), "tab close left a stale session rule");

  // Stop at the reconciliation await boundary after staging. The marker must survive a full
  // browser restart, then the next worker must commit the value and consume that marker together.
  const stagedWrite = {
    id: "smoke-restart-put",
    key: "aviary.profile.account-smoke.userNotes.v1",
    kind: "put",
    value: { alice: "survives restart" }
  };
  assert.deepEqual(
    await storagePage.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "AVIARY_DURABLE_STORAGE",
        operation: "stage-pending",
        write: {
          id: "smoke-restart-put",
          key: "aviary.profile.account-smoke.userNotes.v1",
          kind: "put",
          value: { alice: "survives restart" }
        }
      })
    ),
    { ok: true, result: null }
  );
  assert.equal(
    await storagePage.evaluate(async () => {
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
    true,
    "the staged reconciliation marker was not durable"
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
  const committed = await restartedPage.evaluate((write) =>
    chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "commit-pending",
      write
    }), stagedWrite
  );
  assert.equal(committed.ok, true);
  assert.deepEqual(
    {
      id: committed.result.id,
      key: committed.result.key,
      kind: committed.result.kind
    },
    { id: stagedWrite.id, key: stagedWrite.key, kind: stagedWrite.kind }
  );
  assert.match(committed.result.valueHash, /^[0-9a-f]{64}$/);
  assert.equal(
    await restartedPage.evaluate(async () => {
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
    false,
    "the committed reconciliation left its marker behind"
  );
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

  const tombstoneKey = "aviary.profile.account-smoke.reconcileScratch.v1";
  await restartedPage.evaluate((key) =>
    chrome.runtime.sendMessage({
      type: "AVIARY_DURABLE_STORAGE",
      operation: "put",
      key,
      value: "remove me"
    }), tombstoneKey
  );
  const tombstone = {
    id: "smoke-remove",
    key: tombstoneKey,
    kind: "remove",
    operationId: "smoke-remove-op",
    operationOrder: Number.MAX_SAFE_INTEGER
  };
  await restartedPage.evaluate((write) =>
    chrome.runtime.sendMessage({ type: "AVIARY_DURABLE_STORAGE", operation: "stage-pending", write }),
    tombstone
  );
  assert.deepEqual(
    await restartedPage.evaluate((write) =>
      chrome.runtime.sendMessage({ type: "AVIARY_DURABLE_STORAGE", operation: "commit-pending", write }),
      tombstone
    ),
    {
      ok: true,
      result: { id: tombstone.id, key: tombstone.key, kind: tombstone.kind, valueHash: null }
    }
  );
  assert.deepEqual(
    await restartedPage.evaluate((key) =>
      chrome.runtime.sendMessage({ type: "AVIARY_DURABLE_STORAGE", operation: "get", key }),
      tombstoneKey
    ),
    { ok: true, result: { found: false } }
  );

  console.log(
    "[dnr-chromium] atomic storage reconciliation/restart, migration, tab-scoped DNR controls, persistence, and request matching passed."
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

async function matchLogger(worker, tabId) {
  return worker.evaluate((targetTabId) => chrome.declarativeNetRequest.testMatchOutcome({
    url: "https://x.com/i/api/1.1/promoted_content/log.json?event=smoke",
    initiator: "https://x.com",
    method: "post",
    type: "xmlhttprequest",
    tabId: targetTabId
  }), tabId);
}

async function waitFor(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
