import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "dist", "extension-chrome");
const fixturePath = path.join(root, "tests", "smoke", "current-x-home.html");
const requestedOut = process.argv[2] ?? "docs/audit/settings";
const outputDir = path.resolve(root, requestedOut);
const viewportWidth = Number.parseInt(process.argv[3] ?? "1440", 10);
const viewportHeight = Number.parseInt(process.argv[4] ?? "900", 10);
if (!Number.isInteger(viewportWidth) || !Number.isInteger(viewportHeight) || viewportWidth < 800 || viewportHeight < 600) {
  console.error("Viewport must be integer width/height values of at least 800x600.");
  process.exit(4);
}
const viewportLabel = `${viewportWidth}x${viewportHeight}`;
const sections = [
  "presets",
  "appearance",
  "layout",
  "filtering",
  "hidden",
  "performance",
  "media",
  "export",
  "library",
  "snapshots",
  "integrations",
  "backup",
  "trust"
];

if (!existsSync(extensionDir)) {
  console.error("Build the extension first: `npm run build`.");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is required. Run `npm install` and `npx playwright install chromium`.");
  process.exit(3);
}

const fixtureHtml = await readFile(fixturePath, "utf8");
const profileDir = await mkdtemp(path.join(tmpdir(), "aviary-settings-capture-"));
let context;

try {
  await mkdir(outputDir, { recursive: true });
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--headless=new",
      "--no-sandbox"
    ]
  });

  const page = await context.newPage();
  await page.setViewportSize({ width: viewportWidth, height: viewportHeight });
  await page.route("https://pbs.twimg.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    })
  );
  await page.route("https://video.twimg.com/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "fixture media unavailable" })
  );
  await page.route("https://x.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/home") {
      await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml });
      return;
    }
    if (url.pathname === "/favicon.ico") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>'
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture route unavailable" });
  });

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
    timeout: 15_000
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")),
    null,
    { timeout: 15_000 }
  );
  await page.evaluate(() => {
    const launcher = document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher");
    if (!(launcher instanceof HTMLButtonElement)) throw new Error("Control Center launcher missing");
    launcher.click();
  });
  await page.waitForTimeout(250);

  for (const section of sections) {
    await page.evaluate((id) => {
      const button = document
        .querySelector("#av-control-center")
        ?.shadowRoot?.querySelector(`[data-av-section="${id}"]`);
      if (!(button instanceof HTMLButtonElement)) throw new Error(`Control Center section missing: ${id}`);
      button.click();
    }, section);
    await page.waitForTimeout(150);
    await assertControlCenterLayout(page, section);
    await page.screenshot({ path: path.join(outputDir, `control-center-${section}-${viewportLabel}.png`) });
  }

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
  const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
  if (!extensionId) throw new Error("MV3 service worker did not expose an extension id");

  const options = await context.newPage();
  await options.setViewportSize({ width: viewportWidth, height: viewportHeight });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForSelector("#downloads-state", { timeout: 15_000 });
  const optionOverflow = await options.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (optionOverflow > 1) {
    throw new Error(`Options page overflows ${viewportLabel} horizontally by ${optionOverflow}px`);
  }
  await options.screenshot({ path: path.join(outputDir, `extension-options-${viewportLabel}.png`) });

  console.log(
    `[settings-capture] captured ${sections.length + 1} settings destinations at ${viewportLabel} in ${outputDir}`
  );
} finally {
  await context?.close().catch(() => undefined);
  await rm(profileDir, { recursive: true, force: true });
}

async function assertControlCenterLayout(page, section) {
  const metrics = await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center")?.shadowRoot;
    const panel = shadow?.querySelector(".av-panel");
    const content = shadow?.querySelector(".av-content");
    const nav = shadow?.querySelector(".av-nav");
    if (!(panel instanceof HTMLElement) || !(content instanceof HTMLElement) || !(nav instanceof HTMLElement)) {
      throw new Error("Control Center layout roots are missing");
    }

    const panelRect = panel.getBoundingClientRect();
    const clippedControls = Array.from(
      shadow.querySelectorAll("button, input, select, textarea, [role='button']")
    )
      .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1;
      })
      .map((node) => node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 60) || node.tagName);

    return {
      panelInsideViewport:
        panelRect.left >= 0 &&
        panelRect.top >= 0 &&
        panelRect.right <= innerWidth + 1 &&
        panelRect.bottom <= innerHeight + 1,
      contentOverflow: content.scrollWidth - content.clientWidth,
      navOverflow: nav.scrollWidth - nav.clientWidth,
      clippedControls
    };
  });

  if (!metrics.panelInsideViewport) {
    throw new Error(`Control Center panel leaves the ${viewportLabel} viewport on ${section}`);
  }
  if (metrics.contentOverflow > 1 || metrics.navOverflow > 1 || metrics.clippedControls.length > 0) {
    throw new Error(
      `Control Center horizontal clipping on ${section}: ${JSON.stringify(metrics)}`
    );
  }
}
