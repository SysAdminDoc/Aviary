import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests/smoke/current-x-home.html");

test("Noir gives the desktop shell a premium dark treatment and turns fully off", async () => {
  const { chromium } = await import("playwright");
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule("src/platform/settings.ts");
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: "noir" }
  });
  assert.equal(settings.appearance.theme, "noir", "Noir must survive settings normalization");
  assert.equal(DEFAULT_SETTINGS.appearance.theme, "off", "the authored skin stays opt-in");

  const source = await readFile(path.join(root, "src/features/appearance/theme.ts"), "utf8");
  assert.doesNotMatch(source, /[.#]r-[a-z0-9-]{5,}/, "Noir must not depend on generated X classes");
  assert.doesNotMatch(source, /backdrop-filter/, "the infinite timeline must not use compositor blur");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fixtureHtml = await readFile(fixture, "utf8");
    await page.route("https://x.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml })
    );
    await page.route("https://pbs.twimg.com/**", (route) => route.abort());
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
      const search = document.createElement("form");
      search.id = "current-search-shell";
      search.setAttribute("role", "search");
      search.innerHTML = '<input data-testid="SearchBox_Search_Input" aria-label="Search query">';

      const news = document.createElement("div");
      news.id = "current-news-card";
      news.innerHTML = '<div id="current-news-marker" data-testid="news_sidebar"></div><span>Today’s News</span>';
      sidebar?.prepend(search, news);
    });
    const beforeScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.addScriptTag({ content: await bundleToText("src/features/appearance/theme.ts") });
    await page.evaluate((nextSettings) => {
      const style = document.createElement("style");
      style.dataset.avNoirTest = "1";
      style.textContent = globalThis.__mod.THEME_CSS;
      document.head.append(style);
      globalThis.__mod.applyTheme(nextSettings);
    }, settings);

    const noir = await page.evaluate(() => {
      const styleOf = (selector) => getComputedStyle(document.querySelector(selector));
      const body = styleOf("body");
      const nav = styleOf('nav:has([data-testid="AppTabBar_Home_Link"])');
      const activeNav = styleOf('[data-testid="AppTabBar_Home_Link"]');
      const primary = styleOf('[data-testid="primaryColumn"]');
      const article = styleOf('article[data-testid="tweet"]');
      const media = styleOf('[data-testid="tweetPhoto"]');
      const sidebar = styleOf('section[data-testid="news_sidebar"]');
      const currentNews = styleOf("#current-news-card");
      const currentNewsMarker = styleOf("#current-news-marker");
      const searchShell = styleOf("#current-search-shell");
      const searchInput = styleOf('[data-testid="SearchBox_Search_Input"]');
      const postButton = styleOf('[data-testid="SideNav_NewTweet_Button"]');
      return {
        theme: document.documentElement.dataset.avTheme,
        className: document.documentElement.classList.contains("av-theme-noir"),
        activeNav: document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.getAttribute("data-av-active-route"),
        bodyBackground: body.backgroundImage,
        navBackground: nav.backgroundImage,
        activeNavBackground: activeNav.backgroundImage,
        primaryBackground: primary.backgroundColor,
        primaryShadow: primary.boxShadow,
        articleBackground: article.backgroundImage,
        articleRadius: article.borderRadius,
        mediaBorder: media.borderTopWidth,
        mediaShadow: media.boxShadow,
        sidebarBackground: sidebar.backgroundImage,
        sidebarRadius: sidebar.borderRadius,
        currentNewsBackground: currentNews.backgroundImage,
        currentNewsMarkerBackground: currentNewsMarker.backgroundImage,
        searchShellBackground: searchShell.backgroundColor,
        searchShellRadius: searchShell.borderRadius,
        searchInputBackground: searchInput.backgroundColor,
        searchInputBorder: searchInput.borderTopWidth,
        buttonBackground: postButton.backgroundImage,
        buttonColor: postButton.color,
        scrollWidth: document.documentElement.scrollWidth
      };
    });

    assert.equal(noir.theme, "noir");
    assert.equal(noir.className, true);
    assert.equal(noir.activeNav, "1", "Noir must mark the current route without relying on X's aria-current");
    assert.match(noir.bodyBackground, /radial-gradient/);
    assert.match(noir.navBackground, /linear-gradient/);
    assert.match(noir.activeNavBackground, /linear-gradient/);
    assert.match(noir.primaryBackground, /rgba?\(/);
    assert.notEqual(noir.primaryShadow, "none");
    assert.match(noir.articleBackground, /linear-gradient/);
    assert.equal(noir.articleRadius, "12px");
    assert.equal(noir.mediaBorder, "1px");
    assert.notEqual(noir.mediaShadow, "none");
    assert.match(noir.sidebarBackground, /linear-gradient/);
    assert.equal(noir.sidebarRadius, "12px");
    assert.match(noir.currentNewsBackground, /linear-gradient/);
    assert.equal(noir.currentNewsMarkerBackground, "none", "the tiny live news marker is not painted as a card");
    assert.notEqual(noir.searchShellBackground, "rgba(0, 0, 0, 0)");
    assert.equal(noir.searchShellRadius, "999px");
    assert.equal(noir.searchInputBackground, "rgba(0, 0, 0, 0)");
    assert.equal(noir.searchInputBorder, "0px");
    assert.match(noir.buttonBackground, /linear-gradient/);
    assert.ok(contrast(parseRgb(noir.buttonColor), [92, 211, 255]) >= 4.5);
    assert.ok(noir.scrollWidth <= beforeScrollWidth + 1, "the theme must not introduce horizontal overflow");

    await page.evaluate((offSettings) => globalThis.__mod.applyTheme(offSettings), DEFAULT_SETTINGS);
    const off = await page.evaluate(() => {
      const read = (selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, borderRadius: style.borderRadius };
      };
      return {
        theme: document.documentElement.dataset.avTheme ?? null,
        className: document.documentElement.classList.contains("av-theme-noir"),
        activeNav: document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.hasAttribute("data-av-active-route"),
        body: read("body"),
        article: read('article[data-testid="tweet"]'),
        postButton: read('[data-testid="SideNav_NewTweet_Button"]')
      };
    });
    assert.equal(off.theme, null);
    assert.equal(off.className, false);
    assert.equal(off.activeNav, false);
    assert.equal(off.body.backgroundImage, "none");
    assert.equal(off.article.backgroundImage, "none");
    assert.equal(off.article.boxShadow, "none");
    assert.equal(off.postButton.backgroundImage, "none");
  } finally {
    await browser.close();
  }
});

function parseRgb(value) {
  return [...value.matchAll(/[\d.]+/g)].slice(0, 3).map((match) => Number(match[0]));
}

function contrast(left, right) {
  const luminance = (rgb) => {
    const linear = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [high, low] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

async function bundleToText(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-noir-test-"));
  const outfile = path.join(temp, "module.js");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "__mod",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await readFile(outfile, "utf8");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-noir-module-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
