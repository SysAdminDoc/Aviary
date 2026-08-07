import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Out of the box, Aviary must change nothing about X.
 *
 * Until v1.13.0 a fresh install hid the right sidebar, hid trends, hid Grok, repainted the page
 * with the "dim" theme, forced `color-scheme: dark` over X's own setting, added a Hide button and
 * two media buttons to every post, rewrote share buttons and paused video that scrolled offscreen.
 * None of that was asked for; it was simply what the defaults happened to be.
 *
 * The rule is now: anything that changes what X looks like or how it behaves is off until the
 * user turns it on. Local-only bookkeeping that nobody can see (the audit log, selector health,
 * the local-only network guard) stays on, because it changes nothing about the page.
 */
test("no default setting changes what X looks like or how it behaves", async () => {
  const { DEFAULT_SETTINGS } = await importBundledModule("src/platform/settings.ts");
  const s = DEFAULT_SETTINGS;

  // Appearance: X paints itself.
  assert.equal(s.appearance.theme, "off");
  assert.equal(s.appearance.denseMode, false);
  assert.equal(s.appearance.hideBorders, false);
  assert.equal(s.appearance.hideCounts, false);
  assert.equal(s.appearance.restoreChirp, false);
  assert.equal(s.appearance.timelineWidth, "default");

  // Layout: nothing hidden, nothing moved.
  assert.equal(s.layout.hideRightSidebar, false);
  assert.equal(s.layout.hideTrends, false);
  assert.equal(s.layout.hideGrok, false);
  assert.equal(s.layout.writerMode, false);
  assert.equal(s.layout.forceFollowing, false);
  assert.deepEqual(s.layout.hideNavItems, []);

  // Nothing injected into a post. The AI button and the snippet trigger were the two that a
  // schema-only check missed: both injected unconditionally, gated by no setting at all, and were
  // only caught by counting real elements in a real timeline.
  assert.equal(s.media.buttons, false);
  assert.equal(s.hidden.enabled, false);
  assert.equal(s.hidden.buttons, false);
  assert.equal(s.links.cleanShareButtons, false);
  assert.equal(s.links.expandTco, false);
  assert.equal(s.ai.commandMenu, false);
  assert.deepEqual(s.composer.snippets, [], "no snippets means no composer trigger");

  // Nothing filtered, nothing intercepted, no behaviour changed.
  assert.equal(s.filter.enabled, false);
  assert.equal(s.media.inlineOriginalImages, false);
  assert.equal(s.media.layout, "default");
  assert.equal(s.performance.pauseOffscreenVideo, false);
  assert.equal(s.performance.forceVideoQuality, false);
  assert.equal(s.privacy.blockAnalyticsBeacons, false);
  assert.equal(s.export.preserveRawPayloads, false);

  // Every integration stays off until it is given credentials.
  for (const [name, integration] of Object.entries(s.integrations)) {
    if ("enabled" in integration) {
      assert.equal(integration.enabled, false, `integration ${name} must be off by default`);
    }
  }

  // The invisible half stays on: it changes nothing a viewer can see.
  assert.equal(s.privacy.localOnly, true, "outbound requests stay blocked by default");
  assert.equal(s.privacy.auditLog, true);
  assert.equal(s.diagnostics.selectorHealth, true);
});

/**
 * The measurable half of the same claim: with default settings, the CSS Aviary injects must not
 * match anything in a real timeline. A default that is "off" in the schema but still paints
 * through an always-on selector would pass the test above and fail the user.
 */
test("with default settings, Aviary's own stylesheets change nothing in the timeline", async () => {
  const { chromium } = await import("playwright");
  const { DEFAULT_SETTINGS } = await importBundledModule("src/platform/settings.ts");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(root, "_decoded/home.html")).href, {
      waitUntil: "domcontentloaded"
    });

    const before = await snapshot(page);

    // Run the real applyTheme and inject the real stylesheets. An imitation of what the feature
    // "would" do is how the color-scheme bug survived the first version of this test: X sets
    // `color-scheme: dark` inline itself, and Aviary was clearing it.
    await page.addScriptTag({ content: await bundleToText("src/features/appearance/theme.ts") });
    await page.evaluate((settings) => {
      const mod = globalThis.__mod;
      const style = document.createElement("style");
      style.textContent = mod.THEME_CSS;
      document.head.append(style);
      mod.applyTheme(settings);
      document.documentElement.classList.add(`av-media-layout-${settings.media.layout}`);
    }, DEFAULT_SETTINGS);

    const after = await snapshot(page);
    assert.deepEqual(after, before, "default settings must leave the timeline exactly as X drew it");
  } finally {
    await browser.close();
  }
});

async function snapshot(page) {
  return page.evaluate(() => {
    const read = (element) => {
      const style = getComputedStyle(element);
      return [
        style.display,
        style.visibility,
        style.opacity,
        style.filter,
        style.backgroundColor,
        style.width,
        style.fontFamily,
        style.colorScheme
      ].join("|");
    };
    const targets = [
      "body",
      '[data-testid="primaryColumn"]',
      '[data-testid="sidebarColumn"]',
      'article[data-testid="tweet"]',
      '[data-testid="tweetPhoto"]',
      '[data-testid="like"]',
      '[data-testid="reply"]'
    ];
    const out = {};
    for (const selector of targets) {
      out[selector] = [...document.querySelectorAll(selector)].map(read);
    }
    return out;
  });
}

async function bundleToText(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-vanilla-src-"));
  const outfile = path.join(temp, "module.js");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "__mod",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    const { readFile } = await import("node:fs/promises");
    return readFile(outfile, "utf8");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-vanilla-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
