import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * When the browser-owned request rule is told to turn on or off.
 *
 * This was a regex over `main.ts` with a 900-character window
 * (`/const settings = …[\s\S]{0,900}await reconcileExtensionAdRule\(…\)/`) plus a slice between
 * two method names checked for `await storage.set` and `await reconcileExtensionAdRule`. Both
 * describe the shape of a file. Neither can tell whether a message was sent, what `enabled` value
 * it carried, or whether the rule follows the setting after a save — which is the whole point:
 * a rule left on after the user turns ad protection off is Aviary blocking a request it was told
 * to stop blocking.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let context;
let page;
let temp;
let bundle;
let fixture;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-ad-rule-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(entry, `export { boot } from ${JSON.stringify(abs("src/main.ts"))};`, "utf8");
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryAdRule",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  fixture = await readFile(path.join(root, "tests/smoke/current-x-home.html"), "utf8");
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Boots Aviary as the extension against the X fixture, with a `chrome.runtime.sendMessage` that
 * records every ad-rule sync it is asked to perform.
 */
async function bootExtension() {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("https://x.com/home", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture })
  );
  await context.route("**/*", (route) =>
    route.request().url() === "https://x.com/home" ? route.fallback() : route.fulfill({ status: 204, body: "" })
  );
  page = await context.newPage();
  await page.goto("https://x.com/home");

  await page.evaluate(() => {
    window.__syncs = [];
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          if (message?.type) window.__syncs.push({ type: message.type, enabled: message.enabled });
          return { ok: true, enabled: message?.enabled };
        }
      }
    };
  });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(async () => {
    window.__app = await AviaryAdRule.boot({ source: "extension" });
  });
  await page.waitForTimeout(60);
}

const syncs = () => page.evaluate(() => window.__syncs.filter((entry) => /AD_RULE/i.test(entry.type)));

test("boot tells the background what the resolved settings actually say", async () => {
  await bootExtension();
  const sent = await syncs();

  // Default-on ad protection with the network shield on means the rule is requested at boot,
  // from the settings boot just resolved rather than from the defaults.
  assert.equal(sent.length, 1, `boot sent ${sent.length} ad-rule syncs`);
  assert.equal(sent[0].enabled, true);
});

test("the rule follows both halves of the setting, without a reload", async () => {
  await bootExtension();

  const observed = await page.evaluate(async () => {
    const settings = window.__app.context.settings;
    const out = [];
    for (const [blockAds, networkShield] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
      [true, true]
    ]) {
      settings.privacy.blockAds = blockAds;
      settings.privacy.networkShield = networkShield;
      const before = window.__syncs.length;
      await window.__app.context.saveSettings();
      const sent = window.__syncs.slice(before).filter((entry) => /AD_RULE/i.test(entry.type));
      out.push({ blockAds, networkShield, sent: sent.map((entry) => entry.enabled) });
    }
    return out;
  });

  // The master switch and the separable network shield both have to reach the rule. Following
  // only `blockAds` would keep refusing requests after the shield is turned off; following only
  // the shield would keep refusing them after ad protection is off entirely.
  for (const entry of observed) {
    assert.equal(entry.sent.length, 1, `saving with ${JSON.stringify(entry)} sent ${entry.sent.length} syncs`);
    assert.equal(
      entry.sent[0],
      entry.blockAds && entry.networkShield,
      `blockAds=${entry.blockAds} networkShield=${entry.networkShield} asked for ${entry.sent[0]}`
    );
  }
});

test("a save persists and reconciles, in that order, on the same call", async () => {
  await bootExtension();

  const order = await page.evaluate(async () => {
    const context = window.__app.context;
    const seen = [];
    const originalSet = context.storage.set.bind(context.storage);
    context.storage.set = async (key, value) => {
      seen.push(`store:${String(key).includes("settings") ? "settings" : "other"}`);
      return originalSet(key, value);
    };
    const originalSend = globalThis.chrome.runtime.sendMessage;
    globalThis.chrome.runtime.sendMessage = async (message) => {
      if (/AD_RULE/i.test(message?.type ?? "")) seen.push("reconcile");
      return originalSend(message);
    };

    context.settings.privacy.networkShield = false;
    await context.saveSettings();
    return seen;
  });

  // Reconciling before the write would leave the browser rule describing settings that were never
  // persisted if the write then failed.
  const store = order.indexOf("store:settings");
  const reconcile = order.indexOf("reconcile");
  assert.ok(store > -1, `the save did not persist settings: ${JSON.stringify(order)}`);
  assert.ok(reconcile > -1, `the save did not reconcile the rule: ${JSON.stringify(order)}`);
  assert.ok(store < reconcile, `the rule was reconciled before the write: ${JSON.stringify(order)}`);
});

test("a userscript install never asks the background for anything", async () => {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("https://x.com/home", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture })
  );
  await context.route("**/*", (route) =>
    route.request().url() === "https://x.com/home" ? route.fallback() : route.fulfill({ status: 204, body: "" })
  );
  page = await context.newPage();
  await page.goto("https://x.com/home");
  await page.evaluate(() => {
    window.__syncs = [];
    globalThis.chrome = {
      runtime: {
        async sendMessage(message) {
          window.__syncs.push({ type: message?.type });
          return { ok: true };
        }
      }
    };
  });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(async () => {
    window.__app = await AviaryAdRule.boot({ source: "userscript" });
    await window.__app.context.saveSettings();
  });
  await page.waitForTimeout(60);

  // A userscript has no background and no DNR. Messaging one would be a request to an extension
  // the user has not installed, and in a page that happens to define `chrome`, a message to
  // somebody else's.
  assert.deepEqual(await syncs(), []);
});
