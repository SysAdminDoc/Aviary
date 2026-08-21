import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SETTINGS_HOST_THEMES,
  SETTINGS_SECTIONS,
  SETTINGS_VIEWPORTS,
  SETTINGS_VISUAL_THRESHOLD,
  assertControlCenterLayout,
  assertOptionsLayout,
  comparePngBuffers,
  launchSettingsVisualHarness,
  prepareSettingsScreenshot,
  revealControlCenterRow,
  selectSettingsSection,
  setControlCenterMaterialState
} from "../../tools/settings-visual-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselineDir = path.join(root, "tests", "visual", "baselines", "settings");
const updateBaselines = process.env.AVIARY_UPDATE_VISUALS === "1";
const expectedBaselines = new Set();

test("desktop settings screenshots stay within the reviewed visual threshold", { timeout: 300_000 }, async (t) => {
  if (updateBaselines) await mkdir(baselineDir, { recursive: true });

  for (const viewport of SETTINGS_VIEWPORTS) {
    for (const hostTheme of SETTINGS_HOST_THEMES) {
      await t.test(`${hostTheme} X at ${viewport.width}x${viewport.height}`, { timeout: 90_000 }, async () => {
        const harness = await launchSettingsVisualHarness(viewport, hostTheme);
        try {
          for (const section of SETTINGS_SECTIONS) {
            await selectSettingsSection(harness.page, section);
            await assertControlCenterLayout(harness.page, section, viewport);
            await assertScreenshot(
              harness,
              harness.page,
              `control-center-${section}-${hostTheme}-${viewport.width}x${viewport.height}.png`
            );
          }

          if (hostTheme === "dark" && viewport.width === 1440) {
            await selectSettingsSection(harness.page, "export");
            await revealControlCenterRow(harness.page, "Preservation archive");
            await assertControlCenterLayout(harness.page, "export-preservation", viewport);
            await assertScreenshot(
              harness,
              harness.page,
              "control-center-export-preservation-dark-1440x900.png"
            );
          }

          const options = await harness.openOptionsPage();
          await assertOptionsLayout(options, viewport);
          const disabled = await options.evaluate(() => ({
            grantEnabled: Array.from(document.querySelectorAll("button:not(.ghost)"))
              .filter((button) => button instanceof HTMLButtonElement)
              .every((button) => !button.disabled),
            revokeDisabled: Array.from(document.querySelectorAll("button.ghost"))
              .filter((button) => button instanceof HTMLButtonElement)
              .every((button) => button.disabled)
          }));
          assert.deepEqual(disabled, { grantEnabled: true, revokeDisabled: true });
          await assertScreenshot(
            harness,
            options,
            `extension-options-disabled-${hostTheme}-${viewport.width}x${viewport.height}.png`
          );

          // Material states need one representative desktop lane, not another 4x Cartesian
          // product. Every destination above already covers both viewports and both host themes.
          if (hostTheme === "dark" && viewport.width === 1440) {
            for (const state of ["keyboard-focus", "error", "saved", "reduced-motion"]) {
              await setControlCenterMaterialState(harness.page, state);
              await assertControlCenterLayout(harness.page, `state-${state}`, viewport);
              await assertScreenshot(
                harness,
                harness.page,
                `control-center-state-${state}-dark-1440x900.png`
              );
            }
          }
        } finally {
          await harness.close();
        }
      });
    }
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
    "visual baseline set drifted; regenerate it intentionally with npm run test:visual:update"
  );
});

async function assertScreenshot(harness, page, name) {
  expectedBaselines.add(name);
  const baselinePath = path.join(baselineDir, name);
  const actual = await prepareSettingsScreenshot(page);
  if (updateBaselines) {
    await writeFile(baselinePath, actual);
    return;
  }

  const expected = await readFile(baselinePath).catch((error) => {
    if (error?.code === "ENOENT") {
      assert.fail(`missing visual baseline ${name}; run npm run test:visual:update after review`);
    }
    throw error;
  });
  const comparison = await comparePngBuffers(harness.comparisonPage, expected, actual);
  assert.equal(
    comparison.dimensionsMatch,
    true,
    `${name}: expected ${comparison.expectedWidth}x${comparison.expectedHeight}, received ${comparison.actualWidth}x${comparison.actualHeight}`
  );
  assert.ok(
    comparison.diffPixelRatio <= SETTINGS_VISUAL_THRESHOLD.maxDiffPixelRatio,
    `${name}: ${(comparison.diffPixelRatio * 100).toFixed(3)}% pixels differ; reviewed limit is ${(SETTINGS_VISUAL_THRESHOLD.maxDiffPixelRatio * 100).toFixed(2)}% at channel delta ${SETTINGS_VISUAL_THRESHOLD.colorDelta}`
  );
}
