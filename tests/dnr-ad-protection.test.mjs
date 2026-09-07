import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the promoted-logger rule matches only the separable endpoint", async () => {
  const mod = await importSourceModule("src/extension/ad-rule.ts");
  const matcher = new RegExp(mod.AD_LOGGER_RULE.condition.regexFilter);
  const requestDomains = new Set(mod.AD_LOGGER_RULE.condition.requestDomains);
  const matches = (url) => matcher.test(url) && requestDomains.has(new URL(url).hostname);

  for (const url of [
    "https://x.com/i/api/1.1/promoted_content/log.json",
    "https://www.x.com/i/api/1.1/promoted_content/log.json?event=impression",
    "https://twitter.com/i/api/1.1/promoted_content/log.json?event=click&item=1",
    "https://pro.x.com/i/api/1.1/promoted_content/log.json"
  ]) {
    assert.equal(matches(url), true, url);
  }

  for (const url of [
    "http://x.com/i/api/1.1/promoted_content/log.json",
    "https://evil.example/i/api/1.1/promoted_content/log.json",
    "https://notx.com/i/api/1.1/promoted_content/log.json",
    "https://x.com/i/api/1.1/promoted_content/log.json.bak",
    "https://x.com/i/api/1.1/promoted_content/content.json",
    "https://x.com/i/api/graphql/query/HomeTimeline",
    "https://video.twimg.com/ext_tw_video/fixture.mp4",
    // Retired by X in 2023: both are redirect-only hosts that never serve a document, so a
    // rule naming them widens the install prompt for a request that cannot happen.
    "https://mobile.twitter.com/i/api/1.1/promoted_content/log.json",
    "https://tweetdeck.twitter.com/i/api/1.1/promoted_content/log.json"
  ]) {
    assert.equal(matches(url), false, url);
  }

  assert.deepEqual(mod.AD_LOGGER_RULE.condition.resourceTypes, ["xmlhttprequest", "ping", "other"]);
  assert.deepEqual(mod.AD_LOGGER_RULE.condition.requestDomains, [
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
    "pro.x.com"
  ]);
});

test("session rules are tab-scoped and use one deterministic id per tab", async () => {
  const mod = await importSourceModule("src/extension/ad-rule.ts");
  const first = mod.createAdLoggerSessionRule(41);
  const second = mod.createAdLoggerSessionRule(42);

  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.condition.tabIds, [41]);
  assert.deepEqual(second.condition.tabIds, [42]);
  assert.equal(first.condition.regexFilter, mod.AD_LOGGER_RULE.condition.regexFilter);
  assert.equal(mod.adLoggerRuleIdForTab(0), 1, "DNR rule ids cannot be zero");
  assert.throws(() => mod.adLoggerRuleIdForTab(-1), /tab id/);
  assert.equal(mod.isAdRuleSyncMessage({ type: mod.AD_RULE_SYNC_MESSAGE, enabled: true, tabId: 41 }), true);
  assert.equal(mod.isAdRuleSyncMessage({ type: mod.AD_RULE_SYNC_MESSAGE, enabled: true, tabId: -1 }), false);
});

test("enable and disable replace only the requested tab session rule", async () => {
  const mod = await importSourceModule("src/extension/ad-rule.ts");
  const updates = [];
  const state = new Map();
  const api = {
    declarativeNetRequest: {
      async updateSessionRules(options) {
        updates.push(structuredClone(options));
        for (const id of options.removeRuleIds ?? []) state.delete(id);
        for (const rule of options.addRules ?? []) state.set(rule.id, rule);
      },
      async getSessionRules() {
        return [...state.values()];
      }
    }
  };

  await mod.syncSessionAdRule(api, 17, true);
  assert.deepEqual(updates[0], {
    removeRuleIds: [17],
    addRules: [mod.createAdLoggerSessionRule(17)]
  });
  assert.deepEqual([...state.values()].map((rule) => rule.condition.tabIds), [[17]]);

  await mod.syncSessionAdRule(api, 18, true);
  assert.deepEqual([...state.values()].map((rule) => rule.condition.tabIds), [[17], [18]]);

  await mod.syncSessionAdRule(api, 17, false);
  assert.deepEqual(updates[1], {
    removeRuleIds: [18],
    addRules: [mod.createAdLoggerSessionRule(18)]
  });
  assert.deepEqual(updates[2], {
    removeRuleIds: [17],
    addRules: []
  });
  assert.deepEqual([...state.values()].map((rule) => rule.condition.tabIds), [[18]]);
});

test("pruning removes only stale owned session rules and legacy migration clears the global rule", async () => {
  const mod = await importSourceModule("src/extension/ad-rule.ts");
  const state = new Map([
    [11, mod.createAdLoggerSessionRule(11)],
    [12, mod.createAdLoggerSessionRule(12)],
    [999, { id: 999, priority: 1, action: { type: "block" }, condition: { regexFilter: "other", requestDomains: [], resourceTypes: [] } }]
  ]);
  const updates = [];
  const legacy = [];
  const api = {
    declarativeNetRequest: {
      async getSessionRules() { return [...state.values()]; },
      async updateSessionRules(options) {
        updates.push(options);
        for (const id of options.removeRuleIds ?? []) state.delete(id);
      },
      async updateDynamicRules(options) { legacy.push(options); }
    },
    storage: { local: { async remove(key) { legacy.push({ key }); } } }
  };

  assert.equal(await mod.pruneSessionAdRules(api, [12]), 1);
  assert.deepEqual(updates[0].removeRuleIds, [11]);
  assert.ok(state.has(12));
  assert.ok(state.has(999), "unrelated session rules must not be pruned");
  await mod.removeLegacyDynamicAdRule(api);
  assert.deepEqual(legacy[0], { removeRuleIds: [mod.AD_LOGGER_RULE_ID], addRules: [] });
  assert.deepEqual(legacy[1], { key: mod.AD_LOGGER_STATE_KEY });
});

test("content-to-background synchronization is extension-only and validates the reply", async () => {
  const mod = await importSourceModule("src/extension/ad-rule.ts");
  const originalChrome = globalThis.chrome;
  const messages = [];

  try {
    delete globalThis.chrome;
    assert.deepEqual(await mod.requestExtensionAdRuleSync("userscript", true), {
      ok: true,
      enabled: true,
      skipped: true
    });

    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          messages.push(message);
          return { ok: true, enabled: message.enabled };
        }
      }
    };
    assert.deepEqual(await mod.requestExtensionAdRuleSync("extension", false), {
      ok: true,
      enabled: false
    });
    assert.deepEqual(messages, [{ type: mod.AD_RULE_SYNC_MESSAGE, enabled: false }]);

    globalThis.chrome.runtime.sendMessage = async () => ({ ok: true, enabled: true });
    const mismatch = await mod.requestExtensionAdRuleSync("extension", false);
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error, /rejected/);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("both extension packages request only host-scoped DNR and Firefox has a real event page", async () => {
  const chromeManifest = JSON.parse(
    await readFile(path.join(root, "src/extension/manifest.chrome.json"), "utf8")
  );
  const firefoxManifest = JSON.parse(
    await readFile(path.join(root, "src/extension/manifest.firefox.json"), "utf8")
  );

  for (const [name, manifest] of [
    ["Chrome", chromeManifest],
    ["Firefox", firefoxManifest]
  ]) {
    assert.ok(manifest.permissions.includes("declarativeNetRequestWithHostAccess"), name);
    assert.ok(!manifest.permissions.includes("declarativeNetRequest"), name);
    assert.ok(!manifest.permissions.includes("declarativeNetRequestFeedback"), name);
  }

  assert.equal(chromeManifest.background.service_worker, "background.js");
  assert.deepEqual(firefoxManifest.background.scripts, ["background.js"]);
  assert.equal(firefoxManifest.background.service_worker, undefined);
  assert.deepEqual(firefoxManifest.declarative_net_request.rule_resources, [
    {
      id: "aviary_dynamic_compat",
      enabled: true,
      path: "dnr-empty-rules.json"
    }
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "src/extension/dnr-empty-rules.json"), "utf8")),
    []
  );

  // Firefox refuses to load an extension whose declared rule_resources path is missing, so the
  // file has to be in the package and not only in src/. Asserting that tools/build.mjs mentions
  // the filename says nothing about whether it arrived.
  for (const target of ["extension-chrome", "extension-firefox"]) {
    const packaged = path.join(root, "dist", target, "dnr-empty-rules.json");
    if (!existsSync(packaged)) continue;
    assert.deepEqual(JSON.parse(await readFile(packaged, "utf8")), [], `${target} shipped a non-empty rule set`);
  }
  const packagedFirefox = path.join(root, "dist", "extension-firefox", "manifest.json");
  if (existsSync(packagedFirefox)) {
    const manifest = JSON.parse(await readFile(packagedFirefox, "utf8"));
    for (const resource of manifest.declarative_net_request?.rule_resources ?? []) {
      assert.ok(
        existsSync(path.join(root, "dist", "extension-firefox", resource.path)),
        `the Firefox package declares ${resource.path} and does not contain it`
      );
    }
  }
});

// X's ad-blocker notice appears to key on a *failed probe* rather than a rendered ad: the community
// remedy that propagated through the July 2026 reports allowlists two XHRs instead of hiding
// anything, and reports describe the symptom as "An error has occurred but it's not your fault", a
// blank feed, or empty search — read by users as an X outage. Aviary refuses exactly one request,
// so it should be provably clear of both probes. Asserting that is the difference between safe by
// design and safe by luck.
const DETECTION_PROBES = [
  "https://x.com/i/api/1.1/flow/viewer.json",
  "https://x.com/i/api/1.1/flow/viewer.json?flow_name=login",
  "https://x.com/i/api/2/viewer_context.json",
  "https://x.com/i/api/1.1/viewer_context.json?include_ext_sharing=true",
  "https://x.com/i/api/1.1/graphql/viewer_context.json",
  "https://twitter.com/i/api/2/viewer_context.json"
];

test("the request rule never matches X's own detection probes", async () => {
  const mod = await importSourceModule("src/extension/ad-rule.ts");
  const matcher = new RegExp(mod.AD_LOGGER_RULE.condition.regexFilter);
  const requestDomains = new Set(mod.AD_LOGGER_RULE.condition.requestDomains);
  for (const url of DETECTION_PROBES) {
    const matched = matcher.test(url) && requestDomains.has(new URL(url).hostname);
    assert.equal(matched, false, `the ad rule would block a detection probe: ${url}`);
  }
});

test("the page-world stub never refuses X's own detection probes", async () => {
  const mod = await importSourceModule("src/page/page-agent.ts");
  for (const url of DETECTION_PROBES) {
    assert.equal(mod.isAdRequestUrl(url), false, `the page agent would refuse a detection probe: ${url}`);
  }
  // The one request Aviary does refuse, so this pair states the whole boundary rather than half.
  assert.equal(mod.isAdRequestUrl("https://x.com/i/api/1.1/promoted_content/log.json"), true);
});

test("a failed session-rule update is reported without falling back to a global rule", async () => {
  const { syncSessionAdRule } = await importSourceModule("src/extension/ad-rule.ts");
  const api = {
    declarativeNetRequest: {
      async updateSessionRules() { throw new Error("session quota exceeded"); }
    }
  };

  await assert.rejects(() => syncSessionAdRule(api, 7, true), /session quota exceeded/);
});
