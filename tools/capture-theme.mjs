import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themes = new Set(["dim", "lightsOut", "graphite", "plum", "midnight", "noir"]);
const width = Number.parseInt(process.argv[3] ?? "1440", 10);
const height = Number.parseInt(process.argv[4] ?? "900", 10);
const theme = process.argv[5] ?? "noir";
const timelineWidth = process.argv[6] ?? "default";
const surface = process.argv[7] ?? "home";
const timelineWidths = new Set(["default", "comfortable", "wide"]);
const surfaces = new Set(["home", "status"]);
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1000 || height < 700) {
  console.error("Theme capture requires a desktop viewport of at least 1000x700.");
  process.exit(2);
}
if (!themes.has(theme)) {
  console.error(`Unknown theme ${JSON.stringify(theme)}. Choose ${[...themes].join(", ")}.`);
  process.exit(2);
}
if (!timelineWidths.has(timelineWidth)) {
  console.error(`Unknown timeline width ${JSON.stringify(timelineWidth)}. Choose ${[...timelineWidths].join(", ")}.`);
  process.exit(2);
}
if (!surfaces.has(surface)) {
  console.error(`Unknown surface ${JSON.stringify(surface)}. Choose ${[...surfaces].join(", ")}.`);
  process.exit(2);
}

const requestedPath = process.argv[2] ?? `docs/audit/${theme}-${width}x${height}.png`;
const outputPath = path.resolve(root, requestedPath);
const fixturePath = path.join(root, `tests/smoke/current-x-${surface}.html`);
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
  const fixtureMedia = await readFile(path.join(root, "tests/fixtures/quiet-stream-landscape.png"));
  const fixtureAvatar = await readFile(path.join(root, "src/extension/icons/icon-128.png"));
  await page.route("https://x.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml })
  );
  await page.route("https://pbs.twimg.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: route.request().url().includes("profile_images") ? fixtureAvatar : fixtureMedia
    })
  );
  await page.goto(surface === "home" ? "https://x.com/home" : "https://x.com/fixture/status/1", {
    waitUntil: "domcontentloaded"
  });
  await page.addScriptTag({ content: await readFile(bundlePath, "utf8") });
  const baselineWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.evaluate(({ themeId, widthId }) => {
    const style = document.createElement("style");
    style.id = "av-theme-capture";
    style.textContent = AviaryTheme.THEME_CSS;
    document.head.append(style);
    AviaryTheme.applyTheme({
      appearance: {
        theme: themeId,
        denseMode: false,
        timelineWidth: widthId,
        hideBorders: false,
        hideCounts: false,
        restoreChirp: true
      },
      accessibility: { highContrast: false, reduceMotion: "system" }
    });
  }, { themeId: theme, widthId: timelineWidth });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  if (surface === "home") {
    await page.evaluate(() => {
      const article = document.querySelector('article[data-testid="tweet"]');
      if (article?.querySelector('[data-testid="videoPlayer"]')) {
        article.querySelector('[data-testid="tweetPhoto"]')?.remove();
      }
    });
  }
  const metrics = await page.evaluate(() => ({
    theme: document.documentElement.dataset.avTheme,
    themeClasses: [...document.documentElement.classList].filter((name) => name.startsWith("av-theme-")),
    activeNav: document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.getAttribute("data-av-active-route"),
    scrollWidth: document.documentElement.scrollWidth,
    rootGradient: getComputedStyle(document.documentElement).backgroundImage,
    bodyColor: getComputedStyle(document.body).color,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    bodyGradient: getComputedStyle(document.body).backgroundImage,
    primaryBackground: getComputedStyle(document.querySelector('[data-testid="primaryColumn"]')).backgroundColor,
    articleGradient: getComputedStyle(document.querySelector('article[data-testid="tweet"]')).backgroundImage,
    actionGradient: getComputedStyle(document.querySelector('[data-testid="SideNav_NewTweet_Button"]')).backgroundImage,
    actionBackground: getComputedStyle(document.querySelector('[data-testid="SideNav_NewTweet_Button"]')).backgroundColor,
    studioColor: getComputedStyle(document.querySelector('nav a[href="/i/jf/creators/studio"]')).color,
    actionColors: [...document.querySelectorAll('article[data-testid="tweet"] [role="group"] :is(button, a):not([data-av-media-action])')]
      .map((element) => getComputedStyle(element).color),
    mutedToken: getComputedStyle(document.documentElement).getPropertyValue("--av-muted").trim(),
    textToken: getComputedStyle(document.documentElement).getPropertyValue("--av-text").trim()
  }));
  if (metrics.theme !== theme || metrics.themeClasses.length !== 1 || metrics.themeClasses[0] !== `av-theme-${theme}` ||
      metrics.bodyColor !== metrics.textToken || metrics.studioColor !== metrics.textToken ||
      metrics.actionColors.some((color) => color !== metrics.mutedToken) ||
      metrics.primaryBackground === "rgba(0, 0, 0, 0)") {
    throw new Error(`${theme} did not paint the shared dark-theme foundation: ${JSON.stringify(metrics)}`);
  }
  if (theme === "noir" && ((surface === "home" && metrics.activeNav !== "1") ||
      metrics.rootGradient !== "none" || metrics.articleGradient !== "none" ||
      metrics.actionGradient !== "none" || metrics.actionBackground === "rgba(0, 0, 0, 0)")) {
    throw new Error(`Noir did not paint every premium layer: ${JSON.stringify(metrics)}`);
  }
  if (theme !== "noir" && metrics.activeNav !== null && metrics.activeNav !== undefined) {
    throw new Error(`${theme} retained Noir's active-route marker: ${JSON.stringify(metrics)}`);
  }
  if (metrics.scrollWidth > baselineWidth + 1) {
    throw new Error(`Noir introduced horizontal overflow: ${baselineWidth}px -> ${metrics.scrollWidth}px`);
  }
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`[theme-capture] ${theme}/${timelineWidth}/${surface} ${width}x${height} -> ${outputPath}`);
} finally {
  await browser?.close().catch(() => undefined);
  await rm(temp, { recursive: true, force: true });
}
