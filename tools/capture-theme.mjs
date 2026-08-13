import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const width = Number.parseInt(process.argv[3] ?? "1440", 10);
const height = Number.parseInt(process.argv[4] ?? "900", 10);
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1000 || height < 700) {
  console.error("Theme capture requires a desktop viewport of at least 1000x700.");
  process.exit(2);
}

const requestedPath = process.argv[2] ?? `docs/audit/noir-${width}x${height}.png`;
const outputPath = path.resolve(root, requestedPath);
const fixturePath = path.join(root, "tests/smoke/current-x-home.html");
const temp = await mkdtemp(path.join(tmpdir(), "aviary-theme-capture-"));
const bundlePath = path.join(temp, "theme.js");
let browser;

try {
  await build({
    entryPoints: [path.join(root, "src/features/appearance/theme.ts")],
    outfile: bundlePath,
    bundle: true,
    format: "iife",
    globalName: "AviaryTheme",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const fixtureHtml = await readFile(fixturePath, "utf8");
  await page.route("https://x.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml })
  );
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
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: await readFile(bundlePath, "utf8") });
  const baselineWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "av-theme-capture";
    style.textContent = AviaryTheme.THEME_CSS;
    document.head.append(style);
    AviaryTheme.applyTheme({
      appearance: {
        theme: "noir",
        denseMode: false,
        timelineWidth: "default",
        hideBorders: false,
        hideCounts: false,
        restoreChirp: true
      },
      accessibility: { highContrast: false, reduceMotion: "system" }
    });
  });
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => ({
    theme: document.documentElement.dataset.avTheme,
    activeNav: document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.getAttribute("data-av-active-route"),
    scrollWidth: document.documentElement.scrollWidth,
    bodyGradient: getComputedStyle(document.body).backgroundImage,
    articleGradient: getComputedStyle(document.querySelector('article[data-testid="tweet"]')).backgroundImage,
    actionGradient: getComputedStyle(document.querySelector('[data-testid="SideNav_NewTweet_Button"]')).backgroundImage
  }));
  if (metrics.theme !== "noir" || metrics.activeNav !== "1" || !metrics.bodyGradient.includes("gradient") ||
      !metrics.articleGradient.includes("gradient") || !metrics.actionGradient.includes("gradient")) {
    throw new Error(`Noir did not paint every required layer: ${JSON.stringify(metrics)}`);
  }
  if (metrics.scrollWidth > baselineWidth + 1) {
    throw new Error(`Noir introduced horizontal overflow: ${baselineWidth}px -> ${metrics.scrollWidth}px`);
  }
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`[theme-capture] Noir ${width}x${height} -> ${outputPath}`);
} finally {
  await browser?.close().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
