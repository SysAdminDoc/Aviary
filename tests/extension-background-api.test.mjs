import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";

/**
 * The background service worker's message surface, driven through a stubbed `chrome`.
 *
 * These claims were twelve regexes over `extension-background.ts` — `/AVIARY_DOWNLOAD_CAPABILITY/`,
 * `/openOptionsPage/`, `/action\?\.onClicked/`, `/\.\.\.\(message\.fallbackUrls \?\? \[\]\)/`. A
 * mention of an identifier is not a working handler: every one of them passes for a listener that
 * is registered but never answers, or answers with the wrong shape. Each test below registers the
 * listener the way Chrome does and sends it a message.
 */

/**
 * Loads the background worker against a stubbed `chrome`, returning the listeners it registered
 * and a `send` that drives the message listener the way `chrome.runtime.sendMessage` does.
 */
async function loadBackground(overrides = {}) {
  const registered = {
    message: null,
    action: null,
    contextMenu: null,
    installed: null,
    startup: null,
    tabRemoved: null,
    tabUpdated: null
  };
  const calls = { openOptions: 0, downloads: [], permissionQueries: [] };

  const chrome = {
    runtime: {
      onInstalled: { addListener(listener) { registered.installed = listener; } },
      onStartup: { addListener(listener) { registered.startup = listener; } },
      onMessage: { addListener(listener) { registered.message = listener; } },
      async openOptionsPage() { calls.openOptions++; },
      ...overrides.runtime
    },
    action: { onClicked: { addListener(listener) { registered.action = listener; } } },
    contextMenus: {
      create() { return "aviary-download-media"; },
      removeAll(callback) { callback?.(); },
      onClicked: { addListener(listener) { registered.contextMenu = listener; } }
    },
    permissions: {
      async contains(request) {
        calls.permissionQueries.push(request);
        return overrides.granted ?? true;
      },
      async request() { return overrides.granted ?? true; }
    },
    downloads: overrides.downloads ?? {
      async download(options) {
        calls.downloads.push(options);
        return calls.downloads.length;
      },
      onChanged: { addListener() {} }
    },
    tabs: overrides.tabs ?? {
      async query() { return []; },
      onRemoved: { addListener(listener) { registered.tabRemoved = listener; } },
      onUpdated: { addListener(listener) { registered.tabUpdated = listener; } }
    },
    storage: {
      local: {
        async get() { return {}; },
        async set() {},
        async remove() {}
      }
    },
    ...overrides.chrome
  };

  // Left installed for the life of the test: the worker reads `globalThis.chrome` at call time,
  // not at import time, so restoring it here would leave every handler talking to nothing --
  // which is exactly how a "permission missing" assertion passes without a permission check.
  globalThis.chrome = chrome;
  {
    const module = await importSourceModule("src/entrypoints/extension-background.ts", { fresh: true });
    assert.equal(typeof registered.message, "function", "the background registered no message listener");

    /** Resolves with whatever the listener passes to `sendResponse`. */
    const send = (message, sender = { id: "test" }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no response to ${JSON.stringify(message)}`)), 2000);
        const async = registered.message(message, sender, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        if (async === false) {
          clearTimeout(timer);
          resolve(undefined);
        }
      });

    return { module, registered, calls, send };
  }
}

after(() => {
  delete globalThis.chrome;
});

test("the capability probe answers with what the browser actually granted", async () => {
  const granted = await loadBackground({ granted: true });
  assert.deepEqual(await granted.send({ type: "AVIARY_DOWNLOAD_CAPABILITY" }), { ok: true, granted: true });
  assert.deepEqual(
    granted.calls.permissionQueries.at(-1),
    { permissions: ["downloads"] },
    "the probe must ask about the downloads permission specifically"
  );

  const refused = await loadBackground({ granted: false });
  assert.deepEqual(await refused.send({ type: "AVIARY_DOWNLOAD_CAPABILITY" }), { ok: true, granted: false });
});

test("the content script can open the options page, and the toolbar button does too", async () => {
  const background = await loadBackground();

  assert.deepEqual(await background.send({ type: "AVIARY_OPEN_OPTIONS" }), { ok: true });
  assert.equal(background.calls.openOptions, 1, "the grant surface must actually open");

  // No popup: the toolbar button is the durable route to the permission surface.
  assert.equal(typeof background.registered.action, "function", "the toolbar button does nothing");
  background.registered.action({ id: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(background.calls.openOptions, 2);
});

test("a download without the permission reports the shared code the content script reacts to", async () => {
  const background = await loadBackground({ granted: false });

  const response = await background.send({
    type: "AVIARY_DOWNLOAD",
    url: "https://pbs.twimg.com/media/a.jpg",
    filename: "a.jpg"
  });

  assert.equal(response.ok, false);
  assert.equal(
    response.code,
    background.module.DOWNLOAD_PERMISSION_CODE,
    "the content script keys its 'Allow' surface off this exact code"
  );
  assert.equal(background.calls.downloads.length, 0, "a refused permission must not reach downloads");
});

test("fallback candidates are walked in order, deduplicated, and filtered by scheme", async () => {
  const attempted = [];
  const background = await loadBackground({
    downloads: {
      async download(options) {
        attempted.push(options.url);
        // Every candidate but the last fails, so the walk down the list is observable.
        if (attempted.length < 2) throw new Error("404");
        return 7;
      },
      onChanged: { addListener() {} }
    }
  });

  const response = await background.send({
    type: "AVIARY_DOWNLOAD",
    url: "https://pbs.twimg.com/media/a?name=orig",
    fallbackUrls: [
      // A repeat of the primary, which must not be attempted twice.
      "https://pbs.twimg.com/media/a?name=orig",
      "https://pbs.twimg.com/media/a?name=4096x4096",
      "javascript:alert(1)"
    ],
    filename: "a.jpg"
  });

  // `pending` is the contract: the browser took the request, and nothing yet knows whether the
  // bytes arrive. The tab waits for the terminal state before it says Saved.
  assert.deepEqual(response, { ok: true, id: 7, pending: true });
  assert.deepEqual(attempted, [
    "https://pbs.twimg.com/media/a?name=orig",
    "https://pbs.twimg.com/media/a?name=4096x4096"
  ]);
  assert.ok(
    !attempted.some((url) => url.startsWith("javascript:")),
    "only http(s) candidates may reach the downloads API"
  );
});

test("an over-long fallback list is refused outright, not quietly trimmed", async () => {
  const background = await loadBackground();

  // A content script asking for more than three retries is not the content script this build
  // ships; the message is rejected rather than partially honoured.
  const response = await background.send({
    type: "AVIARY_DOWNLOAD",
    url: "https://pbs.twimg.com/media/a?name=orig",
    fallbackUrls: [
      "https://pbs.twimg.com/media/a?name=4096x4096",
      "https://pbs.twimg.com/media/a?name=large",
      "https://pbs.twimg.com/media/a?name=medium",
      "https://pbs.twimg.com/media/a?name=small"
    ],
    filename: "a.jpg"
  });

  assert.equal(response, undefined, "an unrecognised message must go unanswered");
  assert.equal(background.calls.downloads.length, 0, "and must not reach the downloads API");
});

test("a download that exhausts every candidate reports the last failure rather than success", async () => {
  const background = await loadBackground({
    downloads: {
      async download() { throw new Error("disk full"); },
      onChanged: { addListener() {} }
    }
  });

  const response = await background.send({
    type: "AVIARY_DOWNLOAD",
    url: "https://pbs.twimg.com/media/a.jpg",
    filename: "a.jpg"
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /disk full/);
});

/** A `chrome` stub that records tab-scoped session rule changes and legacy cleanup. */
function dnrStub({ sessionRules = [], dynamicRules = [] } = {}) {
  const state = { sessionRules: [...sessionRules], dynamicRules: [...dynamicRules], updates: [], legacyUpdates: [], removedStorageKeys: [] };
  return {
    state,
    declarativeNetRequest: {
      async getSessionRules() {
        return state.sessionRules;
      },
      async updateSessionRules(update) {
        state.updates.push({
          added: (update.addRules ?? []).map((rule) => rule.id),
          removed: update.removeRuleIds ?? [],
          rules: structuredClone(update.addRules ?? [])
        });
        const removed = new Set(update.removeRuleIds ?? []);
        state.sessionRules = [
          ...state.sessionRules.filter((rule) => !removed.has(rule.id)),
          ...(update.addRules ?? [])
        ];
      },
      async updateDynamicRules(update) {
        state.legacyUpdates.push(update);
        const removed = new Set(update.removeRuleIds ?? []);
        state.dynamicRules = [
          ...state.dynamicRules.filter((rule) => !removed.has(rule.id)),
          ...(update.addRules ?? [])
        ];
      }
    },
    storage: {
      local: {
        async remove(key) {
          state.removedStorageKeys.push(key);
        }
      }
    }
  };
}

test("install and update remove the legacy global rule without creating a cross-tab rule", async () => {
  const dnr = dnrStub();
  const background = await loadBackground({ chrome: dnr, tabs: { query: async () => [] } });

  assert.equal(typeof background.registered.installed, "function", "no onInstalled listener");
  background.registered.installed({ reason: "install" });
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(dnr.state.sessionRules, [], "install must wait for a tab's resolved settings");
  assert.equal(dnr.state.legacyUpdates.length, 1, "the legacy dynamic rule was not removed");
  assert.deepEqual(dnr.state.removedStorageKeys, ["aviary.runtime.adLoggerRule.v1"]);
});

test("two tabs can hold opposing rule states without changing each other", async () => {
  const dnr = dnrStub();
  const background = await loadBackground({ chrome: dnr });

  const on = await background.send(
    { type: "AVIARY_SYNC_AD_RULE", enabled: true },
    { tab: { id: 41 } }
  );
  assert.deepEqual(on, { ok: true, enabled: true });
  assert.deepEqual(dnr.state.sessionRules.map((rule) => rule.condition.tabIds), [[41]]);

  const off = await background.send(
    { type: "AVIARY_SYNC_AD_RULE", enabled: false },
    { tab: { id: 42 } }
  );
  assert.deepEqual(off, { ok: true, enabled: false });
  assert.deepEqual(dnr.state.sessionRules.map((rule) => rule.condition.tabIds), [[41]], "tab 41 was changed by tab 42");

  const tab41Off = await background.send(
    { type: "AVIARY_SYNC_AD_RULE", enabled: false },
    { tab: { id: 41 } }
  );
  assert.deepEqual(tab41Off, { ok: true, enabled: false });
  assert.deepEqual(dnr.state.sessionRules, []);
});

test("a rule is removed when its tab navigates away or closes", async () => {
  const dnr = dnrStub();
  const background = await loadBackground({ chrome: dnr });
  await background.send({ type: "AVIARY_SYNC_AD_RULE", enabled: true }, { tab: { id: 55 } });
  assert.equal(dnr.state.sessionRules.length, 1);

  assert.equal(typeof background.registered.tabUpdated, "function");
  background.registered.tabUpdated(55, { url: "https://example.com/" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(dnr.state.sessionRules, []);

  await background.send({ type: "AVIARY_SYNC_AD_RULE", enabled: true }, { tab: { id: 56 } });
  background.registered.tabRemoved(56, {});
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(dnr.state.sessionRules, []);
});

test("a privileged sender must name a target tab, while content senders use sender.tab", async () => {
  const dnr = dnrStub();
  const background = await loadBackground({ chrome: dnr });
  const missing = await background.send({ type: "AVIARY_SYNC_AD_RULE", enabled: true });
  assert.deepEqual(missing, { ok: false, enabled: true, error: "tab context unavailable" });

  const named = await background.send({ type: "AVIARY_SYNC_AD_RULE", enabled: true, tabId: 77 });
  assert.deepEqual(named, { ok: true, enabled: true });
  assert.deepEqual(dnr.state.sessionRules[0].condition.tabIds, [77]);
});

test("startup prunes closed tabs and clears the legacy global rule", async () => {
  const dnr = dnrStub({ sessionRules: [{ id: 21, priority: 1, action: { type: "block" }, condition: { ...dnrRuleCondition(), tabIds: [21] } }] });
  const background = await loadBackground({ chrome: dnr, tabs: { query: async () => [{ id: 22 }] } });
  background.registered.startup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(dnr.state.sessionRules, []);
  assert.equal(dnr.state.legacyUpdates.length, 1);
});

test("a service-worker start prunes stale session rules before any browser event", async () => {
  const dnr = dnrStub({ sessionRules: [
    { id: 31, priority: 1, action: { type: "block" }, condition: { ...dnrRuleCondition(), tabIds: [31] } }
  ] });
  await loadBackground({ chrome: dnr, tabs: { query: async () => [{ id: 32 }] } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(dnr.state.sessionRules, []);
  assert.equal(dnr.state.legacyUpdates.length, 1);
});

function dnrRuleCondition() {
  return {
    regexFilter: "^https://[^/]+/i/api/1[.]1/promoted_content/log[.]json([?].*)?$",
    requestDomains: ["x.com"],
    resourceTypes: ["xmlhttprequest"]
  };
}

test("a background with no declarativeNetRequest reports the failure instead of claiming success", async () => {
  const background = await loadBackground({ chrome: { declarativeNetRequest: undefined } });
  const response = await background.send({ type: "AVIARY_SYNC_AD_RULE", enabled: true });

  assert.equal(response.ok, false);
  assert.equal(response.enabled, true, "the answer must name the state that was asked for");
  assert.ok(response.error, "a refusal must carry a reason");
});
