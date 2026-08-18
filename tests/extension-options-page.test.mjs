import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The options page, driven rather than read.
 *
 * `assert.match(controller, /permissions\.request\(/)` says the identifier appears somewhere in
 * the file. It cannot tell whether the grant button is wired to it, whether the card's state
 * label follows the answer, or whether a dismissed request is reported as a grant. This mounts
 * the shipped `options.html`, loads the compiled controller against a stubbed `chrome`, and
 * clicks the buttons.
 *
 * The static bans on the page itself — no inline script, no inline handler, no network call —
 * stay where they are, in tests/source-contracts.test.mjs, because a ban is the one claim a
 * source scan states exactly.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let browser;
let context;
let page;
let temp;
let bundlePath;
let optionsHtml;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-options-"));
  bundlePath = path.join(temp, "options.js");
  await build({
    entryPoints: [path.join(root, "src/entrypoints/extension-options.ts")],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  optionsHtml = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  // The page loads its own script and stylesheet by relative path; neither exists in the harness,
  // and the controller is injected explicitly after the chrome stub is in place.
  optionsHtml = optionsHtml
    .replace(/<script[^>]*src="options\.js"[^>]*>\s*<\/script>/i, "")
    .replace(/<link[^>]*href="options\.css"[^>]*>/i, "");
  await writeFile(path.join(temp, "options.html"), optionsHtml, "utf8");

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  page = await context.newPage();
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Loads the page with a permissions stub whose answers the test controls, and records every call
 * the controller makes.
 */
async function mountOptions({ granted = [], grantOutcome = true } = {}) {
  await page.setContent(optionsHtml);
  await page.evaluate(
    ({ initial, outcome }) => {
      const held = new Set(initial);
      window.__calls = { request: [], remove: [], contains: [] };
      const key = (request) => JSON.stringify(request.permissions ?? request.origins);
      globalThis.chrome = {
        runtime: { getManifest: () => ({ version: "9.9.9" }) },
        permissions: {
          async contains(request) {
            window.__calls.contains.push(request);
            return held.has(key(request));
          },
          async request(request) {
            window.__calls.request.push(request);
            if (outcome) held.add(key(request));
            return outcome;
          },
          async remove(request) {
            window.__calls.remove.push(request);
            return held.delete(key(request));
          }
        }
      };
    },
    { initial: granted, outcome: grantOutcome }
  );
  await page.addScriptTag({ path: bundlePath });
  await page.waitForTimeout(60);
}

const cardState = (id) =>
  page.evaluate((stateId) => {
    const state = document.getElementById(stateId);
    return {
      text: state?.textContent?.trim() ?? null,
      granted: state?.dataset.granted ?? null,
      busy: state?.getAttribute("aria-busy") ?? null
    };
  }, id);

test("each card reports what the browser currently holds, without being asked to change it", async () => {
  await mountOptions({ granted: ['["downloads"]'] });

  const downloads = await cardState("downloads-state");
  const media = await cardState("media-state");
  const calls = await page.evaluate(() => window.__calls);

  assert.equal(downloads.granted, "true", "a held permission must read as held");
  assert.equal(media.granted, "false");
  assert.equal(downloads.busy, "false", "the checking state must resolve");
  assert.deepEqual(calls.request, [], "reading the page must not request anything");
  assert.deepEqual(calls.remove, []);
  assert.ok(calls.contains.length >= 2, "every card must be queried");
});

test("granting asks the browser for exactly that permission and follows its answer", async () => {
  await mountOptions();

  await page.click("#downloads-grant");
  await page.waitForTimeout(60);

  const calls = await page.evaluate(() => window.__calls);
  const state = await cardState("downloads-state");
  const buttons = await page.evaluate(() => ({
    grant: document.getElementById("downloads-grant").disabled,
    revoke: document.getElementById("downloads-revoke").disabled
  }));

  assert.deepEqual(calls.request, [{ permissions: ["downloads"] }], "one request, for the named permission");
  assert.equal(state.granted, "true");
  assert.equal(buttons.grant, true, "a held permission cannot be granted again");
  assert.equal(buttons.revoke, false, "and must be revocable");
});

test("a dismissed request is reported as nothing changed, not as a grant", async () => {
  await mountOptions({ grantOutcome: false });

  await page.click("#downloads-grant");
  await page.waitForTimeout(60);

  const state = await cardState("downloads-state");
  const status = await page.evaluate(() => document.getElementById("status").textContent);

  assert.equal(state.granted, "false", "dismissing the browser prompt must leave the card ungranted");
  assert.match(status, /dismissed|nothing changed/i, "and must say so rather than claiming success");
});

test("revoking gives the permission back and re-enables the grant button", async () => {
  await mountOptions({ granted: ['["downloads"]'] });

  await page.click("#downloads-revoke");
  await page.waitForTimeout(60);

  const calls = await page.evaluate(() => window.__calls);
  const state = await cardState("downloads-state");
  const buttons = await page.evaluate(() => ({
    grant: document.getElementById("downloads-grant").disabled,
    revoke: document.getElementById("downloads-revoke").disabled
  }));

  assert.deepEqual(calls.remove, [{ permissions: ["downloads"] }]);
  assert.equal(state.granted, "false");
  assert.equal(buttons.grant, false, "a revoked permission must be grantable again");
  assert.equal(buttons.revoke, true);
});

test("the health summary counts what is actually held", async () => {
  await mountOptions();
  const empty = await page.evaluate(() => document.getElementById("granted-count").textContent);

  await page.click("#downloads-grant");
  await page.waitForTimeout(60);
  const afterGrant = await page.evaluate(() => ({
    count: document.getElementById("granted-count").textContent,
    message: document.getElementById("health-message").textContent
  }));

  assert.equal(empty, "0");
  assert.equal(afterGrant.count, "1");
  assert.match(afterGrant.message, /Media saves through the browser/);
});

test("a browser without the permissions API says so instead of failing silently", async () => {
  await page.setContent(optionsHtml);
  await page.evaluate(() => {
    globalThis.chrome = { runtime: { getManifest: () => ({ version: "9.9.9" }) } };
  });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForTimeout(60);

  await page.click("#downloads-grant");
  await page.waitForTimeout(30);
  const status = await page.evaluate(() => document.getElementById("status").textContent);

  assert.match(status, /permissions API/i);
});

test("the page shows the build it is part of", async () => {
  await mountOptions();
  const version = await page.evaluate(() => document.getElementById("version").textContent);
  assert.equal(version, "v9.9.9", "the version comes from the manifest, not from a hardcoded string");
});
