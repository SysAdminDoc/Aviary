import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REFLOW_VIEWPORTS,
  REFLOW_ZOOMS,
  assertControlCenterLayout,
  assertFocusedControlVisible,
  closeControlCenter,
  launchSettingsVisualHarness,
  selectSettingsSection,
  setVisualZoom
} from "../../tools/settings-visual-harness.mjs";

const ROUTES = [
  { name: "home", path: "/home", section: "presets" },
  { name: "search", path: "/search?q=aviary", section: "filtering" },
  { name: "profile", path: "/alice_fixture", section: "appearance" },
  { name: "bookmarks", path: "/i/bookmarks", section: "library" },
  { name: "status", path: "/alice_fixture/status/123456789/with_replies", section: "media" },
  { name: "messages", path: "/messages", section: "integrations" },
  { name: "compose", path: "/compose/post", section: "layout" },
  { name: "settings", path: "/settings/account", section: "trust" },
  { name: "media", path: "/i/media_viewer?url=https%3A%2F%2Fpbs.twimg.com%2Fmedia%2F456789", section: "media" }
];

const LANES = [
  ...REFLOW_VIEWPORTS.map((viewport) => ({ viewport, zoom: 1 })),
  ...REFLOW_ZOOMS.filter((zoom) => zoom > 1).map((zoom) => ({
    viewport: { width: 1280, height: 900 },
    zoom
  }))
];

test("X surfaces and Control Center reflow at narrow widths and zoom", { timeout: 600_000 }, async (t) => {
  for (const lane of LANES) {
    await t.test(`${lane.viewport.width}x${lane.viewport.height} at ${lane.zoom * 100}%`, { timeout: 120_000 }, async () => {
      const harness = await launchSettingsVisualHarness(lane.viewport, "dark");
      const cssViewport = {
        width: Math.floor(lane.viewport.width / lane.zoom),
        height: Math.floor(lane.viewport.height / lane.zoom)
      };

      try {
        for (const route of ROUTES) {
          await harness.page.goto(`https://x.com${route.path}`, {
            waitUntil: "domcontentloaded",
            timeout: 60_000
          });
          await setVisualZoom(harness.page, lane.zoom);
          await waitForExtension(harness.page);
          await ensureControlCenterOpen(harness.page);
          await selectSettingsSection(harness.page, route.section);
          await assertControlCenterLayout(harness.page, route.name, cssViewport);
          await assertFocusedControlVisible(harness.page, `${route.name} focused control`);

          const controlCenterShot = await harness.page.screenshot({
            animations: "disabled",
            caret: "hide",
            fullPage: false,
            scale: "css",
            type: "png"
          });
          assert.ok(controlCenterShot.length > 1_000, `${route.name}: Control Center screenshot was empty`);
          // Playwright restores its base viewport after a screenshot. Reapply the emulated browser
          // zoom before checking the page underneath the panel.
          await setVisualZoom(harness.page, lane.zoom);

          await closeControlCenter(harness.page);
          const metrics = await readPageMetrics(harness.page);
          assert.equal(metrics.viewport.width, cssViewport.width, `${route.name}: CSS width drifted`);
          assert.equal(metrics.viewport.height, cssViewport.height, `${route.name}: CSS height drifted`);
          assert.ok(metrics.documentOverflow <= 1, `${route.name}: page overflows horizontally: ${JSON.stringify(metrics)}`);
          assert.ok(metrics.primaryWidth <= cssViewport.width + 1, `${route.name}: post column exceeds viewport`);
          assert.ok(metrics.toolbarOverflow <= 1, `${route.name}: compose controls overflow: ${JSON.stringify(metrics)}`);

          if (metrics.mediaAction) {
            assert.equal(metrics.mediaAction.disabled, false, `${route.name}: download control is disabled`);
            assert.ok(metrics.mediaAction.visible, `${route.name}: download control is not visible`);
            assert.ok(metrics.mediaAction.withinViewport, `${route.name}: download control is clipped`);
          }
        }
      } finally {
        await harness.close();
      }
    });
  }
});

async function waitForExtension(page) {
  await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
    timeout: 15_000
  });
  await page.waitForFunction(
    () => Boolean(
      document.querySelector("#av-control-center")?.shadowRoot
      || document.querySelector("#av-control-center-nav")?.shadowRoot
    ),
    null,
    { timeout: 15_000 }
  );
}

async function ensureControlCenterOpen(page) {
  const isOpen = await page.evaluate(() => {
    const panel = document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-panel");
    return panel instanceof HTMLElement && getComputedStyle(panel).display !== "none";
  });
  if (!isOpen) {
    await page.evaluate(() => {
      const launcher =
        document.querySelector("#av-control-center-nav")?.shadowRoot?.querySelector(".av-nav-launcher")
        ?? document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher");
      if (!(launcher instanceof HTMLElement)) throw new Error("Control Center launcher missing after navigation");
      launcher.click();
    });
  }
  await page.waitForFunction(
    () => {
      const panel = document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-panel");
      return panel instanceof HTMLElement && getComputedStyle(panel).display !== "none";
    },
    null,
    // Generous because it waits for a state, not for a duration. Three browser-driving lanes share
    // one machine under npm run test:visual, and at 10s this timed out on a different viewport each
    // run while the lane passed on its own.
    { timeout: 30_000 }
  );
}

async function readPageMetrics(page) {
  return page.evaluate(() => {
    const primary = document.querySelector('[data-testid="primaryColumn"]');
    const toolbar = document.querySelector('[data-testid="toolBar"]');
    const media = document.querySelector("[data-av-media-action]");
    const mediaRect = media?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - innerWidth,
      primaryWidth: primary instanceof HTMLElement ? primary.getBoundingClientRect().width : 0,
      toolbarOverflow: toolbar instanceof HTMLElement ? toolbar.scrollWidth - toolbar.clientWidth : 0,
      mediaAction: media instanceof HTMLButtonElement && mediaRect
        ? {
            disabled: media.disabled,
            visible: getComputedStyle(media).display !== "none" && mediaRect.width > 0 && mediaRect.height > 0,
            withinViewport: mediaRect.left >= 0 && mediaRect.right <= innerWidth + 1
              && mediaRect.top >= -1 && mediaRect.bottom <= document.documentElement.scrollHeight + 1
          }
        : null
    };
  });
}
