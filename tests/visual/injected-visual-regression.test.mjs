import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SETTINGS_HOST_THEMES,
  SETTINGS_VISUAL_THRESHOLD,
  closeControlCenter,
  comparePngBuffers,
  launchSettingsVisualHarness,
  prepareElementScreenshot,
  selectSettingsSection
} from "../../tools/settings-visual-harness.mjs";

/**
 * The other half of what this product draws.
 *
 * Every visual baseline was the Control Center or the options page. Nothing Aviary puts on X had
 * one: the media controls, the bookmark affordance, the launcher and the first-run notice all
 * render into somebody else's page, all carry their own stylesheet, and all were invisible here.
 * Those are the surfaces most exposed to X changing its markup underneath them, and the ones where
 * a cascade regression actually shows -- the closed-panel bug that shipped a full-screen settings
 * window over the timeline was exactly this kind, and no baseline could see it.
 *
 * One viewport rather than two. These are clipped to the element, so a wider window moves nothing
 * about them and a second lane would spend minutes photographing the same pixels. Both host themes
 * are kept, because the whole point of these surfaces is that they sit on a background this
 * repository does not control.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselineDir = path.join(root, "tests", "visual", "baselines", "injected");
const updateBaselines = process.env.AVIARY_UPDATE_VISUALS === "1";
const viewport = { width: 1440, height: 900 };
const expectedBaselines = new Set();

/** Each surface, and how to reach it once the panel is out of the way. */
const SURFACES = [
  {
    name: "post-controls",
    // The post Aviary decorated, not just the button: where the controls sit is as much of the
    // rendering as how they look.
    selector: '[data-testid="tweet"]:has([data-av-media-action])',
    async ready(page) {
      await page.waitForFunction(
        () => document.querySelector('[data-testid="tweet"] [data-av-media-action]') !== null,
        null,
        { timeout: 20_000 }
      );
    }
  },
  {
    name: "post-controls-copy",
    selector: '[data-testid="tweet"]:has([data-av-media-copy])',
    async ready(page) {
      await openControlCenter(page);
      await page.evaluate(() => {
        document.querySelector('[data-testid="tweet"] [data-testid="videoPlayer"]')?.remove();
      });
      await enableCopyMediaLinks(page);
      await closeControlCenter(page);
    }
  },
  {
    name: "launcher",
    selector: "#av-control-center-nav",
    async ready(page) {
      await page.waitForFunction(
        () => document.querySelector("#av-control-center-nav")?.shadowRoot?.querySelector(".av-nav-launcher") !== null,
        null,
        { timeout: 20_000 }
      );
    }
  },
  {
    name: "first-run",
    selector: "#av-first-run",
    async ready(page) {
      await page.waitForFunction(() => document.querySelector("#av-first-run") !== null, null, {
        timeout: 20_000
      });
      // The notice is hidden while the panel is open and shown again when it closes; wait for the
      // state a first-time reader actually sees.
      await page.waitForFunction(
        () => document.querySelector("#av-first-run")?.hidden === false,
        null,
        { timeout: 10_000 }
      );
    }
  }
];

test("injected timeline surfaces stay within the reviewed visual threshold", { timeout: 300_000 }, async (t) => {
  if (updateBaselines) await mkdir(baselineDir, { recursive: true });

  for (const hostTheme of SETTINGS_HOST_THEMES) {
    await t.test(`${hostTheme} X`, { timeout: 120_000 }, async () => {
      const harness = await launchSettingsVisualHarness(viewport, hostTheme);
      try {
        await closeControlCenter(harness.page);

        for (const surface of SURFACES) {
          await surface.ready(harness.page);
          await assertScreenshot(harness, hostTheme, surface.name, surface.selector);
        }
      } finally {
        await harness.close();
      }
    });
  }

  const actualBaselines = new Set(
    await readdir(baselineDir).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    })
  );
  assert.deepEqual(
    [...actualBaselines].sort(),
    [...expectedBaselines].sort(),
    "injected baseline set drifted; regenerate it intentionally with npm run test:visual:update"
  );
});

async function openControlCenter(page) {
  await page.evaluate(() => {
    const launcher = document
      .querySelector("#av-control-center-nav")
      ?.shadowRoot?.querySelector(".av-nav-launcher");
    if (!(launcher instanceof HTMLButtonElement)) throw new Error("Control Center launcher missing");
    launcher.click();
  });
  await page.waitForFunction(
    () => document.querySelector("#av-control-center-nav")?.shadowRoot
      ?.querySelector(".av-nav-launcher")?.getAttribute("aria-expanded") === "true",
    null,
    { timeout: 15_000 }
  );
}

async function enableCopyMediaLinks(page) {
  await selectSettingsSection(page, "media");
  await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center")?.shadowRoot;
    const row = Array.from(shadow?.querySelectorAll(".av-row") ?? [])
      .find((candidate) => candidate.getAttribute("data-av-label") === "Show Copy media links");
    const toggle = row?.querySelector('input[type="checkbox"]');
    if (!(toggle instanceof HTMLInputElement)) throw new Error("Copy media links toggle missing");
    if (!toggle.checked) toggle.click();
  });
  await page.waitForFunction(
    () => document.querySelector("#av-control-center")?.getAttribute("data-av-draft-state") === "dirty",
    null,
    { timeout: 10_000 }
  );
  await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center")?.shadowRoot;
    const save = shadow?.querySelector(".av-transaction-save");
    if (!(save instanceof HTMLButtonElement)) throw new Error("Control Center Save button missing");
    save.click();
  });
  await page.waitForFunction(
    () => document.querySelector("#av-control-center")?.getAttribute("data-av-draft-state") === "clean",
    null,
    { timeout: 10_000 }
  );
  const appeared = await page.waitForFunction(
    () => document.querySelector('[data-testid="tweet"] [data-av-media-copy]') !== null,
    null,
    { timeout: 15_000 }
  ).then(() => true, () => false);
  if (!appeared) {
    const state = await page.evaluate(() => {
      const shadow = document.querySelector("#av-control-center")?.shadowRoot;
      const row = Array.from(shadow?.querySelectorAll(".av-row") ?? [])
        .find((candidate) => candidate.getAttribute("data-av-label") === "Show Copy media links");
      return {
        toggle: row?.querySelector('input[type="checkbox"]')?.checked ?? null,
        rootClass: document.documentElement.className,
        action: document.querySelector('[data-testid="tweet"] [data-av-media-action-slot]')?.outerHTML ?? null
      };
    });
    assert.fail(`Copy media action did not appear after Save: ${JSON.stringify(state)}`);
  }
}

async function assertScreenshot(harness, hostTheme, name, selector) {
  const file = `injected-${name}-${hostTheme}-${viewport.width}x${viewport.height}.png`;
  expectedBaselines.add(file);
  const baselinePath = path.join(baselineDir, file);
  const actual = await prepareElementScreenshot(harness.page, selector);
  if (updateBaselines) {
    await writeFile(baselinePath, actual);
    return;
  }

  const expected = await readFile(baselinePath).catch((error) => {
    if (error?.code === "ENOENT") {
      assert.fail(`missing visual baseline ${file}; run npm run test:visual:update after review`);
    }
    throw error;
  });
  const comparison = await comparePngBuffers(harness.comparisonPage, expected, actual);
  assert.equal(
    comparison.dimensionsMatch,
    true,
    `${file}: expected ${comparison.expectedWidth}x${comparison.expectedHeight}, received ${comparison.actualWidth}x${comparison.actualHeight}`
  );
  assert.ok(
    comparison.diffPixelRatio <= SETTINGS_VISUAL_THRESHOLD.maxDiffPixelRatio,
    `${file}: ${(comparison.diffPixelRatio * 100).toFixed(3)}% pixels differ; reviewed limit is ${(SETTINGS_VISUAL_THRESHOLD.maxDiffPixelRatio * 100).toFixed(2)}%`
  );
}
