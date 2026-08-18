import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Which half of ad protection the network shield controls.
 *
 * `privacy.blockAds` hides sponsored content structurally. `privacy.networkShield` is the
 * separable half a site can observe: refusing X's promoted-content logger. The two must be wired
 * differently on purpose — gating structural suppression on the shield would unhide every ad the
 * moment someone turned the observable half off, which is the opposite of what they asked for.
 *
 * This was three regexes over `main.ts`, `page-hooks.ts` and `ad-protection.ts`, one of them a
 * `doesNotMatch(/networkShield/)` over a whole file. That last one is the only shape a scan
 * states exactly, and even it cannot tell whether the ads are still hidden.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

/** A sponsored cell and an organic one, in the shape the structural rules look for. */
const FIXTURE = `
<main data-testid="primaryColumn">
  <div data-testid="cellInnerDiv" id="sponsored">
    <article data-testid="tweet">
      <div data-testid="placementTracking"></div>
      <div data-testid="tweetText">buy this</div>
    </article>
  </div>
  <div data-testid="cellInnerDiv" id="organic">
    <article data-testid="tweet"><div data-testid="tweetText">a real post</div></article>
  </div>
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-shield-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { adProtectionFeature } from ${JSON.stringify(abs("src/features/privacy/ad-protection.ts"))}`,
      `export { pageHooksFeature } from ${JSON.stringify(abs("src/features/privacy/page-hooks.ts"))}`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))}`
    ].join(";\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryShield",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><body>${FIXTURE}</body>`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.shieldCtx = (blockAds, networkShield, bridge) => {
      const settings = AviaryShield.cloneSettings(AviaryShield.DEFAULT_SETTINGS);
      settings.privacy.blockAds = blockAds;
      settings.privacy.networkShield = networkShield;
      return {
        settings,
        route: { surface: "home", path: "/home" },
        pageBridge: bridge,
        storage: { async get(_key, fallback) { return fallback; }, async set() {}, async remove() {} },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
    window.fakeBridge = () => {
      const configs = [];
      return {
        configs,
        status: () => "connected",
        reason: () => "",
        configure(config) { configs.push({ ...config }); },
        on() {},
        off() {}
      };
    };
    window.adHidden = () => {
      const cell = document.getElementById("sponsored");
      const style = getComputedStyle(cell);
      return style.display === "none" || cell.getBoundingClientRect().height === 0;
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("turning the network shield off leaves ads hidden", async () => {
  const states = await page.evaluate(async () => {
    const run = async (blockAds, networkShield) => {
      const ctx = window.shieldCtx(blockAds, networkShield);
      await AviaryShield.adProtectionFeature.init(ctx);
      await AviaryShield.adProtectionFeature.apply(ctx, document);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const hidden = window.adHidden();
      const organicHidden = getComputedStyle(document.getElementById("organic")).display === "none";
      await AviaryShield.adProtectionFeature.destroy(ctx);
      return { hidden, organicHidden };
    };
    return {
      both: await run(true, true),
      shieldOff: await run(true, false),
      adsOff: await run(false, true)
    };
  });

  assert.equal(states.both.hidden, true, "the sponsored cell must be hidden with everything on");
  assert.equal(states.both.organicHidden, false, "an organic post must never be hidden");
  // The point of the split: the shield governs a request, not the page.
  assert.equal(states.shieldOff.hidden, true, "turning the shield off unhid the ads");
  assert.equal(states.adsOff.hidden, false, "turning ad protection off must actually show them again");
});

test("the page-world logger stub is refused only when both halves are on", async () => {
  const configs = await page.evaluate(async () => {
    const run = async (blockAds, networkShield) => {
      const bridge = window.fakeBridge();
      const ctx = window.shieldCtx(blockAds, networkShield, bridge);
      await AviaryShield.pageHooksFeature.init(ctx);
      await AviaryShield.pageHooksFeature.apply(ctx, document);
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Read before teardown: `destroy` deliberately pushes a final all-off config, so anything
      // sampled after it reports false whatever the settings said.
      const live = bridge.configs.map((config) => config.blockAds);
      await AviaryShield.pageHooksFeature.destroy(ctx);
      return { live, afterDestroy: bridge.configs.at(-1).blockAds };
    };
    return {
      both: await run(true, true),
      shieldOff: await run(true, false),
      adsOff: await run(false, true),
      neither: await run(false, false)
    };
  });

  // Whatever else the feature sends, the last live word is the state the page agent keeps.
  const settled = (entry) => entry.live.at(-1);
  assert.ok(configs.both.live.length > 0, "the feature never configured the bridge");
  assert.equal(settled(configs.both), true, "with both halves on, the logger must be refused");
  assert.equal(settled(configs.shieldOff), false, "the shield alone must be able to stop the refusal");
  assert.equal(settled(configs.adsOff), false, "ad protection off means the refusal stops too");
  assert.equal(settled(configs.neither), false);

  // Reversibility: whatever was on, teardown turns the page-world hook off.
  assert.equal(configs.both.afterDestroy, false, "destroy must leave the page agent refusing nothing");
});
