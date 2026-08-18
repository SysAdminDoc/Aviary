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
  const optionsCss = await readFile(path.join(root, "src/extension/options.css"), "utf8");
  // Both are loaded by relative path, which resolves to nothing under `setContent`. The script is
  // injected explicitly after the chrome stub is in place; the stylesheet is inlined, because
  // dropping it would leave every layout assertion measuring an unstyled document.
  optionsHtml = optionsHtml
    .replace(/<script[^>]*src="options\.js"[^>]*>\s*<\/script>/i, "")
    .replace(/<link[^>]*href="options\.css"[^>]*>/i, `<style>${optionsCss}</style>`);
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

test("a permission card announces its own state change to assistive technology", async () => {
  await mountOptions();

  const wiring = await page.evaluate(() => {
    const state = document.getElementById("downloads-state");
    const grant = document.getElementById("downloads-grant");
    const card = document.getElementById("downloads-card");
    return {
      live: state.getAttribute("aria-live"),
      atomic: state.getAttribute("aria-atomic"),
      describedBy: grant.getAttribute("aria-describedby"),
      describedByExists: Boolean(document.getElementById(grant.getAttribute("aria-describedby"))),
      priority: card.dataset.priority
    };
  });

  // The state label is the only thing that changes when a grant resolves; if it is not a live
  // region, a screen-reader user gets no confirmation that anything happened.
  assert.equal(wiring.live, "polite");
  assert.equal(wiring.atomic, "true");
  assert.equal(wiring.describedByExists, true, `aria-describedby points at ${wiring.describedBy}, which is not there`);
  assert.equal(wiring.priority, "recommended", "downloads is the card that makes media saving work");
});

test("the card marks itself busy while a grant is in flight, and clears it after", async () => {
  await page.setContent(optionsHtml);
  await page.evaluate(() => {
    window.__resolve = null;
    globalThis.chrome = {
      runtime: { getManifest: () => ({ version: "9.9.9" }) },
      permissions: {
        async contains() { return false; },
        request() {
          // Held open so the in-flight state is observable rather than a frame that never lands.
          return new Promise((resolve) => { window.__resolve = resolve; });
        },
        async remove() { return true; }
      }
    };
  });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForTimeout(60);

  await page.click("#downloads-grant");
  await page.waitForTimeout(30);
  const during = await cardState("downloads-state");

  await page.evaluate(() => window.__resolve(true));
  await page.waitForTimeout(60);
  const settled = await cardState("downloads-state");

  assert.equal(during.busy, "true", "an in-flight request must be announced as busy");
  assert.equal(settled.busy, "false", "and must stop being busy once it resolves");
});

test("a narrow window stacks the permission cards instead of clipping them", async () => {
  await page.setViewportSize({ width: 420, height: 900 });
  try {
    await mountOptions();
    const layout = await page.evaluate(() => {
      const card = document.querySelector(".permission-row");
      const style = getComputedStyle(card);
      return {
        columns: style.gridTemplateColumns.split(" ").length,
        overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
        buttonWidth: document.getElementById("downloads-grant").getBoundingClientRect().width
      };
    });

    assert.equal(layout.columns, 1, `a 420px window lays a card out in ${layout.columns} columns`);
    assert.equal(layout.overflows, false, "the page must not scroll sideways");
    assert.ok(layout.buttonWidth > 0, "the grant button must still be on screen");
  } finally {
    await page.setViewportSize({ width: 900, height: 900 });
  }
});

test("each card explains its own grant rather than borrowing the other's", async () => {
  const messages = {};
  for (const card of ["downloads", "media"]) {
    await mountOptions();
    await page.click(`#${card}-grant`);
    await page.waitForTimeout(60);
    messages[card] = await page.evaluate(() => document.getElementById("status").textContent);
  }

  // Host access has nothing to do with "media saves through the browser"; both cards used to
  // report the same sentence, so granting the wrong one looked like it had worked.
  assert.match(messages.downloads, /Media saves through the browser/);
  assert.match(messages.media, /full-size media directly/);
  assert.notEqual(messages.downloads, messages.media, "the two grants must not share one message");
});
