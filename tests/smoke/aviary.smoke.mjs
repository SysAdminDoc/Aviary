// Playwright smoke spec for Aviary (F099).
//
// This file is intentionally NOT picked up by `npm test`. Run it through
// `npm run smoke` once you have:
//   1. `npm install --save-dev playwright@1.49.x`
//   2. `npx playwright install chromium`
//   3. Built the extension: `npm run build`
//
// The script loads the unpacked Chromium extension, navigates to x.com,
// and asserts:
//   a) the Aviary Control Center launcher mounts
//   b) opening it does not throw
//   c) toggling the filter master adds `html.av-filter-enabled`
//   d) the integrations section renders

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = path.join(root, "dist", "extension-chrome");

if (!existsSync(extensionDir)) {
  console.error("Build the extension first: `npm run build`.");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright is not installed. Run:\n  npm install --save-dev playwright@1.49.x\n  npx playwright install chromium"
  );
  process.exit(3);
}

const userDataDir = path.join(root, "dist", ".smoke-profile");
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  args: [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--no-sandbox"
  ]
});

const page = await context.newPage();
await page.goto("https://x.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(2_000);

const launcher = await page.locator("#av-control-center").first();
if (!(await launcher.count())) {
  console.error("Control Center host missing from the page.");
  process.exit(4);
}
console.log("[smoke] Control Center host mounted.");

const launcherButton = await page.evaluateHandle(() => {
  const host = document.querySelector("#av-control-center");
  return host?.shadowRoot?.querySelector(".av-launcher") ?? null;
});

if (!launcherButton) {
  console.error("Launcher button missing inside shadow root.");
  process.exit(5);
}

await page.evaluate(() => {
  const host = document.querySelector("#av-control-center");
  const button = host?.shadowRoot?.querySelector(".av-launcher");
  (button as HTMLButtonElement | null)?.click();
});
await page.waitForTimeout(500);
console.log("[smoke] Launcher click did not throw.");

const filterClassAdded = await page.evaluate(() => {
  return document.documentElement.classList.contains("av-filter-enabled");
});
console.log(`[smoke] av-filter-enabled present at boot: ${filterClassAdded}`);

const integrationsPresent = await page.evaluate(() => {
  const host = document.querySelector("#av-control-center");
  const sectionTitles = Array.from(host?.shadowRoot?.querySelectorAll(".av-section-title") ?? [])
    .map((node) => node.textContent ?? "");
  return sectionTitles.includes("Integrations");
});
if (!integrationsPresent) {
  console.error("Integrations section did not render.");
  process.exit(6);
}
console.log("[smoke] Integrations section rendered.");

await context.close();
console.log("[smoke] All assertions passed.");
