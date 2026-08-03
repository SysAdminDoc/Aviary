// Playwright smoke spec for Aviary (F099).
//
// This file is intentionally NOT picked up by `npm test`. Run it through
// `npm run smoke` once you have:
//   1. `npm install --save-dev playwright@1.62.1`
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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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
    "Playwright is not installed. Run:\n  npm install --save-dev playwright@1.62.1\n  npx playwright install chromium"
  );
  process.exit(3);
}

const userDataDir = await mkdtemp(path.join(tmpdir(), "aviary-smoke-"));
let context;
const headless = process.env.AVIARY_SMOKE_HEADLESS === "1";

try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-sandbox",
      ...(headless ? ["--headless=new"] : [])
    ]
  });
  console.log(`[smoke] service workers: ${context.serviceWorkers().map((worker) => worker.url()).join(", ") || "none"}`);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[smoke] console: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.error(`[smoke] page error: ${error.message}`));
  await page.goto("https://x.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  const launcher = page.locator("#av-control-center").first();
  if (!(await launcher.count())) {
    const diagnostics = await page.evaluate(() => ({
      url: location.href,
      ready: document.documentElement.dataset.avReady ?? null,
      source: document.documentElement.dataset.avSource ?? null,
      title: document.title,
      body: document.body?.textContent?.slice(0, 300) ?? ""
    }));
    console.error(`[smoke] diagnostics: ${JSON.stringify(diagnostics)}`);
    throw new Error("Control Center host missing from the page.");
  }
  console.log("[smoke] Control Center host mounted.");

  const launcherPresent = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    return Boolean(host?.shadowRoot?.querySelector(".av-launcher"));
  });
  if (!launcherPresent) {
    throw new Error("Launcher button missing inside shadow root.");
  }

  await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const button = host?.shadowRoot?.querySelector(".av-launcher");
    button?.click();
  });
  await page.waitForTimeout(500);
  console.log("[smoke] Launcher activation did not throw.");

  const filterTogglePresent = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const rows = Array.from(host?.shadowRoot?.querySelectorAll("label.av-row") ?? []);
    return rows.some((row) => row.textContent?.includes("Enable filters"));
  });
  if (!filterTogglePresent) {
    throw new Error("Filter master toggle missing.");
  }

  await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const row = Array.from(host?.shadowRoot?.querySelectorAll("label.av-row") ?? [])
      .find((candidate) => candidate.textContent?.includes("Enable filters"));
    const checkbox = row?.querySelector("input[type=checkbox]");
    checkbox?.click();
  });
  await page.waitForTimeout(500);
  const filterProbe = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const row = Array.from(host?.shadowRoot?.querySelectorAll("label.av-row") ?? [])
      .find((candidate) => candidate.textContent?.includes("Enable filters"));
    const checkbox = row?.querySelector("input[type=checkbox]");
    return {
      checked: checkbox instanceof HTMLInputElement ? checkbox.checked : null,
      path: location.pathname,
      className: document.documentElement.className
    };
  });
  console.log(`[smoke] filter probe: ${JSON.stringify(filterProbe)}`);
  const filterClassAdded = filterProbe.className.split(/\s+/).includes("av-filter-enabled");
  if (!filterClassAdded) {
    throw new Error("Filter master toggle did not add av-filter-enabled.");
  }
  console.log("[smoke] Filter master toggle applied.");

  const integrationsPresent = await page.evaluate(() => {
    const host = document.querySelector("#av-control-center");
    const sectionTitles = Array.from(host?.shadowRoot?.querySelectorAll(".av-section-title") ?? [])
      .map((node) => node.textContent ?? "");
    return sectionTitles.includes("Integrations");
  });
  if (!integrationsPresent) {
    throw new Error("Integrations section did not render.");
  }
  console.log("[smoke] Integrations section rendered.");
} finally {
  await context?.close();
  await rm(userDataDir, { force: true, recursive: true });
}
console.log("[smoke] All assertions passed.");
