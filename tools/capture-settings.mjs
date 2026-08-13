import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETTINGS_SECTIONS,
  SETTINGS_HOST_THEMES,
  assertControlCenterLayout,
  assertOptionsLayout,
  launchSettingsVisualHarness,
  prepareSettingsScreenshot,
  selectSettingsSection
} from "./settings-visual-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedOut = process.argv[2] ?? "docs/audit/settings";
const outputDir = path.resolve(root, requestedOut);
const viewport = {
  width: Number.parseInt(process.argv[3] ?? "1440", 10),
  height: Number.parseInt(process.argv[4] ?? "900", 10)
};
const hostTheme = process.argv[5] ?? "dark";

if (!SETTINGS_HOST_THEMES.includes(hostTheme)) {
  console.error(`Host theme must be one of: ${SETTINGS_HOST_THEMES.join(", ")}.`);
  process.exit(4);
}

const viewportLabel = `${viewport.width}x${viewport.height}`;
const captureLabel = hostTheme === "dark" ? viewportLabel : `${hostTheme}-${viewportLabel}`;
let harness;

try {
  await mkdir(outputDir, { recursive: true });
  harness = await launchSettingsVisualHarness(viewport, hostTheme);

  for (const section of SETTINGS_SECTIONS) {
    await selectSettingsSection(harness.page, section);
    await assertControlCenterLayout(harness.page, section, viewport);
    await writeFile(
      path.join(outputDir, `control-center-${section}-${captureLabel}.png`),
      await prepareSettingsScreenshot(harness.page)
    );
  }

  const options = await harness.openOptionsPage();
  await assertOptionsLayout(options, viewport);
  await writeFile(
    path.join(outputDir, `extension-options-${captureLabel}.png`),
    await prepareSettingsScreenshot(options)
  );

  console.log(
    `[settings-capture] captured ${SETTINGS_SECTIONS.length + 1} settings destinations on ${hostTheme} X at ${viewportLabel} in ${outputDir}`
  );
} finally {
  await harness?.close();
}
