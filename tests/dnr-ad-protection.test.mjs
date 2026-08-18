import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the dynamic rule matches only the separable promoted-content logger", async () => {
  const mod = await importBundledModule("src/extension/ad-rule.ts");
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

test("enable, disable, and restart reconciliation own exactly one dynamic rule", async () => {
  const mod = await importBundledModule("src/extension/ad-rule.ts");
  const updates = [];
  const stored = new Map();
  const api = {
    declarativeNetRequest: {
      async updateDynamicRules(options) {
        updates.push(structuredClone(options));
      }
    },
    storage: {
      local: {
        async get(key) {
          return stored.has(key) ? { [key]: stored.get(key) } : {};
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) stored.set(key, value);
        }
      }
    }
  };

  await mod.syncDynamicAdRule(api, true);
  assert.deepEqual(updates[0], {
    removeRuleIds: [mod.AD_LOGGER_RULE_ID],
    addRules: [mod.AD_LOGGER_RULE]
  });
  assert.equal(stored.get(mod.AD_LOGGER_STATE_KEY), true);

  await mod.syncDynamicAdRule(api, false);
  assert.deepEqual(updates[1], {
    removeRuleIds: [mod.AD_LOGGER_RULE_ID],
    addRules: []
  });
  assert.equal(stored.get(mod.AD_LOGGER_STATE_KEY), false);

  stored.set(mod.AD_LOGGER_STATE_KEY, true);
  assert.equal(await mod.restoreDynamicAdRule(api), true);
  assert.deepEqual(updates[2].addRules, [mod.AD_LOGGER_RULE]);
  stored.delete(mod.AD_LOGGER_STATE_KEY);
  assert.equal(await mod.restoreDynamicAdRule(api), null, "an upgrade without a mirror must wait for content settings");
  assert.equal(updates.length, 3);
});

test("content-to-background synchronization is extension-only and validates the reply", async () => {
  const mod = await importBundledModule("src/extension/ad-rule.ts");
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
});

test("boot and every successful settings save synchronize the active profile choice", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  const background = await readFile(
    path.join(root, "src/entrypoints/extension-background.ts"),
    "utf8"
  );
  const buildSource = await readFile(path.join(root, "tools/build.mjs"), "utf8");

  // The rule must be reconciled from the settings boot just resolved, before anything can await
  // on a slower path. Schema-version reporting sits between the two reads, so allow for it while
  // still pinning the order and the source of the flag.
  assert.match(
    main,
    /const settings = (?:normalizeSettings|settingsEnvelope\.settings)[\s\S]{0,900}await reconcileExtensionAdRule\(options\.source, networkShieldActive\(settings\), diagnostics\)/
  );
  // The rule follows both halves of the ad setting: the master switch and the network shield.
  assert.match(
    main,
    /function networkShieldActive[\s\S]{0,240}settings\.privacy\.blockAds && settings\.privacy\.networkShield/
  );
  const saveBoundary = main.slice(main.indexOf("async saveSettings()"), main.indexOf("requestApply()"));
  assert.match(saveBoundary, /await storage\.set/);
  assert.match(saveBoundary, /await reconcileExtensionAdRule/);
  assert.match(background, /details\?\.reason === "install"/);
  assert.match(background, /restoreDynamicAdRule/);
  assert.match(background, /isAdRuleSyncMessage/);
  assert.match(buildSource, /dnr-empty-rules\.json/);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-dnr-unit-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

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
  const mod = await importBundledModule("src/extension/ad-rule.ts");
  const matcher = new RegExp(mod.AD_LOGGER_RULE.condition.regexFilter);
  const requestDomains = new Set(mod.AD_LOGGER_RULE.condition.requestDomains);
  for (const url of DETECTION_PROBES) {
    const matched = matcher.test(url) && requestDomains.has(new URL(url).hostname);
    assert.equal(matched, false, `the ad rule would block a detection probe: ${url}`);
  }
});

test("the page-world stub never refuses X's own detection probes", async () => {
  const mod = await importBundledModule("src/page/page-agent.ts");
  for (const url of DETECTION_PROBES) {
    assert.equal(mod.isAdRequestUrl(url), false, `the page agent would refuse a detection probe: ${url}`);
  }
  // The one request Aviary does refuse, so this pair states the whole boundary rather than half.
  assert.equal(mod.isAdRequestUrl("https://x.com/i/api/1.1/promoted_content/log.json"), true);
});

test("a failed mirror write cannot leave the rule and its record disagreeing", async () => {
  const { syncDynamicAdRule, restoreDynamicAdRule } =
    await importBundledModule("src/extension/ad-rule.ts");

  const applied = [];
  const mirror = new Map();
  const api = {
    declarativeNetRequest: {
      async updateDynamicRules(update) {
        applied.push(update.addRules.length > 0);
      }
    },
    storage: {
      local: {
        async set() {
          throw new Error("quota exceeded");
        },
        async get(key) {
          return mirror.has(key) ? { [key]: mirror.get(key) } : {};
        }
      }
    }
  };

  // Ad protection is on by default, so the failure direction matters. Committing the rule first and
  // then failing the write left the rule applied while the mirror still held the old value -- and
  // the next restore after a restart reverted a rule the user had actually enabled.
  await assert.rejects(() => syncDynamicAdRule(api, true), /quota exceeded/);
  assert.deepEqual(applied, [], "no rule may be committed once its record cannot be written");

  const restored = await restoreDynamicAdRule(api);
  assert.notEqual(restored, false, "a failed sync must not be recorded as a deliberate disable");
});
