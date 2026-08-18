import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const SETTINGS_SECTIONS = [
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

export const SETTINGS_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
];

export const SETTINGS_HOST_THEMES = ["dark", "light"];

/**
 * Pixel antialiasing differs slightly across Chromium hosts. A channel delta up to 24 is ignored,
 * then no more than 1% of pixels may differ. That tolerates glyph-edge noise while a moved 120px
 * card, missing footer, changed palette, or clipped control fails by a wide margin.
 */
export const SETTINGS_VISUAL_THRESHOLD = {
  colorDelta: 24,
  maxDiffPixelRatio: 0.01
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "dist", "extension-chrome");
const fixturePath = path.join(root, "tests", "smoke", "current-x-home.html");

/**
 * Refuses to capture against a build that is not the current one.
 *
 * `dir` exists so the gate can be exercised without writing a stale version into the real
 * `dist/`, which other tests read concurrently.
 */
export async function assertCurrentExtensionBuild(dir = extensionDir) {
  if (!existsSync(dir)) {
    throw new Error("Build the extension first: `npm run build`.");
  }
  const [pkg, builtManifest] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(dir, "manifest.json"), "utf8").then(JSON.parse)
  ]);
  if (builtManifest.version !== pkg.version) {
    throw new Error(
      `The built extension is stale (${builtManifest.version ?? "unknown"}; expected ${pkg.version}). Run \`npm run build\` first.`
    );
  }
}

export async function launchSettingsVisualHarness(viewport, hostTheme = "dark") {
  await assertCurrentExtensionBuild();
  assertDesktopViewport(viewport);
  if (!SETTINGS_HOST_THEMES.includes(hostTheme)) {
    throw new Error(`Unknown host theme: ${hostTheme}`);
  }

  const fixtureHtml = await readFile(fixturePath, "utf8");
  const profileDir = await mkdtemp(path.join(tmpdir(), "aviary-settings-visual-"));
  let context;
  try {
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
    await page.setViewportSize(viewport);
    await installFixtureRoutes(page, fixtureHtml);
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.addStyleTag({ content: hostThemeCss(hostTheme) });
    await page.waitForFunction(() => document.documentElement.dataset.avReady === "true", null, {
      timeout: 15_000
    });
    await page.waitForFunction(
      () =>
        Boolean(
          document.querySelector("#av-control-center-nav")?.shadowRoot?.querySelector(".av-nav-launcher") ??
            document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher")
        ),
      null,
      { timeout: 15_000 }
    );
    await page.evaluate(() => {
      const launcher =
        document.querySelector("#av-control-center-nav")?.shadowRoot?.querySelector(".av-nav-launcher") ??
        document.querySelector("#av-control-center")?.shadowRoot?.querySelector(".av-launcher");
      if (!(launcher instanceof HTMLButtonElement)) throw new Error("Control Center launcher missing");
      launcher.click();
    });
    await settleVisuals(page);

    const comparisonPage = await context.newPage();
    await comparisonPage.goto("about:blank");

    return {
      context,
      page,
      comparisonPage,
      profileDir,
      async openOptionsPage() {
        const worker = context.serviceWorkers()[0]
          ?? (await context.waitForEvent("serviceworker", { timeout: 15_000 }));
        const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
        if (!extensionId) throw new Error("MV3 service worker did not expose an extension id");
        const options = await context.newPage();
        await options.setViewportSize(viewport);
        await options.goto(`chrome-extension://${extensionId}/options.html`);
        await options.waitForSelector("#downloads-state[data-granted]", { timeout: 15_000 });
        await options.waitForSelector("#media-state[data-granted]", { timeout: 15_000 });
        await settleVisuals(options);
        return options;
      },
      async close() {
        await context.close().catch(() => undefined);
        await removeProfileDir(profileDir);
      }
    };
  } catch (error) {
    await context?.close().catch(() => undefined);
    await removeProfileDir(profileDir);
    throw error;
  }
}

export async function selectSettingsSection(page, section) {
  if (!SETTINGS_SECTIONS.includes(section)) {
    throw new Error(`Unknown Control Center destination: ${section}`);
  }
  await page.evaluate((id) => {
    const button = document
      .querySelector("#av-control-center")
      ?.shadowRoot?.querySelector(`[data-av-section="${id}"]`);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Control Center section missing: ${id}`);
    }
    button.click();
  }, section);
  await settleVisuals(page);
}

export async function assertControlCenterLayout(page, section, viewport) {
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

  const viewportLabel = `${viewport.width}x${viewport.height}`;
  if (!metrics.panelInsideViewport) {
    throw new Error(`Control Center panel leaves the ${viewportLabel} viewport on ${section}`);
  }
  if (metrics.contentOverflow > 1 || metrics.navOverflow > 1 || metrics.clippedControls.length > 0) {
    throw new Error(`Control Center horizontal clipping on ${section}: ${JSON.stringify(metrics)}`);
  }
}

export async function assertOptionsLayout(page, viewport) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 1) {
    throw new Error(`Options page overflows ${viewport.width}x${viewport.height} horizontally by ${overflow}px`);
  }
}

export async function prepareSettingsScreenshot(page) {
  await normalizeDynamicText(page);
  await settleVisuals(page);
  return page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    scale: "css",
    type: "png"
  });
}

export async function comparePngBuffers(page, expected, actual) {
  return page.evaluate(async ({ expectedBase64, actualBase64, colorDelta }) => {
    const decode = async (base64) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      return createImageBitmap(await response.blob());
    };
    const [expectedImage, actualImage] = await Promise.all([
      decode(expectedBase64),
      decode(actualBase64)
    ]);
    if (expectedImage.width !== actualImage.width || expectedImage.height !== actualImage.height) {
      return {
        dimensionsMatch: false,
        expectedWidth: expectedImage.width,
        expectedHeight: expectedImage.height,
        actualWidth: actualImage.width,
        actualHeight: actualImage.height,
        diffPixels: Number.POSITIVE_INFINITY,
        diffPixelRatio: 1
      };
    }
    const canvas = new OffscreenCanvas(expectedImage.width, expectedImage.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(expectedImage, 0, 0);
    const expectedPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(actualImage, 0, 0);
    const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let diffPixels = 0;
    for (let index = 0; index < expectedPixels.length; index += 4) {
      const delta = Math.max(
        Math.abs(expectedPixels[index] - actualPixels[index]),
        Math.abs(expectedPixels[index + 1] - actualPixels[index + 1]),
        Math.abs(expectedPixels[index + 2] - actualPixels[index + 2]),
        Math.abs(expectedPixels[index + 3] - actualPixels[index + 3])
      );
      if (delta > colorDelta) diffPixels += 1;
    }
    expectedImage.close();
    actualImage.close();
    return {
      dimensionsMatch: true,
      expectedWidth: canvas.width,
      expectedHeight: canvas.height,
      actualWidth: canvas.width,
      actualHeight: canvas.height,
      diffPixels,
      diffPixelRatio: diffPixels / (canvas.width * canvas.height)
    };
  }, {
    expectedBase64: expected.toString("base64"),
    actualBase64: actual.toString("base64"),
    colorDelta: SETTINGS_VISUAL_THRESHOLD.colorDelta
  });
}

export async function setControlCenterMaterialState(page, state) {
  if (state === "keyboard-focus") {
    await selectSettingsSection(page, "appearance");
    await page.evaluate(() => {
      const panel = document
        .querySelector("#av-control-center")
        ?.shadowRoot?.querySelector(".av-panel");
      if (!(panel instanceof HTMLElement)) throw new Error("Control Center panel missing");
      panel.focus();
    });
    await page.keyboard.press("Tab");
    await settleVisuals(page);
    return;
  }

  if (state === "error") {
    await selectSettingsSection(page, "media");
    await setRowControl(page, "Concurrent downloads", "99");
    await clickTransaction(page, "save");
    const status = await readSaveState(page);
    if (status !== "error") throw new Error(`Expected error state, received ${status}`);
    return;
  }

  if (state === "saved") {
    await selectSettingsSection(page, "media");
    await clickTransaction(page, "revert");
    await setRowControl(page, "Concurrent downloads", "5");
    await clickTransaction(page, "save");
    await page.waitForFunction(() =>
      document.querySelector("#av-control-center")?.getAttribute("data-av-draft-state") === "clean"
    );
    const status = await readSaveState(page);
    if (status !== "saved") throw new Error(`Expected saved state, received ${status}`);
    return;
  }

  if (state === "reduced-motion") {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await selectSettingsSection(page, "appearance");
    await setRowControl(page, "Reduced motion", "always");
    await clickTransaction(page, "save");
    await page.waitForFunction(() => document.documentElement.classList.contains("av-reduce-motion"));
    const moving = await page.evaluate(() =>
      document.getAnimations({ subtree: true }).filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return typeof timing?.duration === "number" && timing.duration > 0;
      }).length
    );
    if (moving > 0) throw new Error(`Reduced-motion state retained ${moving} active animations`);
    return;
  }

  throw new Error(`Unknown material state: ${state}`);
}

async function setRowControl(page, label, value) {
  await page.evaluate(({ rowLabel, nextValue }) => {
    const shadow = document.querySelector("#av-control-center")?.shadowRoot;
    const row = Array.from(shadow?.querySelectorAll(".av-row") ?? [])
      .find((candidate) => candidate.getAttribute("data-av-label") === rowLabel);
    const control = row?.querySelector("input, select, textarea");
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
      throw new Error(`Control Center row control missing: ${rowLabel}`);
    }
    control.value = nextValue;
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true
    }));
  }, { rowLabel: label, nextValue: value });
  await settleVisuals(page);
}

async function clickTransaction(page, action) {
  await page.evaluate((kind) => {
    const button = document
      .querySelector("#av-control-center")
      ?.shadowRoot?.querySelector(`.av-transaction-${kind}`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Transaction ${kind} button missing`);
    button.click();
  }, action);
  await settleVisuals(page);
}

async function readSaveState(page) {
  return page.evaluate(() =>
    document.querySelector("#av-control-center")?.getAttribute("data-av-save-state") ?? "missing"
  );
}

async function installFixtureRoutes(page, fixtureHtml) {
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
      await route.fulfill({ status: 204, contentType: "image/x-icon", body: "" });
      return;
    }
    await route.fulfill({ status: 404, contentType: "text/plain", body: "fixture route unavailable" });
  });
}

async function normalizeDynamicText(page) {
  await page.evaluate(() => {
    const shadow = document.querySelector("#av-control-center")?.shadowRoot;
    if (!shadow) return;
    const fixedRows = new Map([
      ["Storage", "IndexedDB · schema v1 · 0 B used · quota available · 0 stores migrated"],
      ["Last selector transition", "healthy · home · 2026-08-13T12:00:00.000Z"],
      ["Ad observations", "home · 2026-08-13T12:00:00.000Z"],
      ["Retained ad observations", "1"]
    ]);
    for (const row of Array.from(shadow.querySelectorAll(".av-row"))) {
      const label = row.querySelector(".av-row-label")?.textContent ?? "";
      const value = fixedRows.get(label);
      const description = row.querySelector(".av-row-description");
      if (value && description) description.textContent = value;
    }
    const walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      walker.currentNode.textContent = (walker.currentNode.textContent ?? "")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, "2026-08-13T12:00:00.000Z");
    }
  });
}

async function settleVisuals(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations({ subtree: true })) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
  });
  await page.waitForTimeout(60);
}

function hostThemeCss(theme) {
  if (theme === "dark") {
    return ":root { color-scheme: dark; }";
  }
  return `
:root { color-scheme: light !important; }
html, body { background: #f7f9f9 !important; color: #0f1419 !important; }
nav { background: #ffffff !important; border-color: #cfd9de !important; }
nav a, [data-testid="User-Name"] a { color: #0f1419 !important; }
[data-testid="primaryColumn"] { background: #ffffff !important; border-color: #cfd9de !important; }
[data-testid="cellInnerDiv"] > div, [data-testid="toolBar"] { border-color: #cfd9de !important; }
[data-testid="tweetPhoto"], [data-testid="videoPlayer"] { background: #eff3f4 !important; }
[data-testid="sidebarColumn"] { background: #f7f9f9 !important; }
`;
}

function assertDesktopViewport(viewport) {
  if (
    !Number.isInteger(viewport?.width)
    || !Number.isInteger(viewport?.height)
    || viewport.width < 1000
    || viewport.height < 700
  ) {
    throw new Error("Settings visual coverage is desktop-only and requires at least 1000x700.");
  }
}

async function removeProfileDir(profileDir) {
  const allowedRoot = path.resolve(tmpdir());
  const resolved = path.resolve(profileDir);
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`) || !path.basename(resolved).startsWith("aviary-settings-visual-")) {
    throw new Error(`Refusing to remove unexpected visual profile path: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}
