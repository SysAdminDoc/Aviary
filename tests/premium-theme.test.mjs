import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests/smoke/current-x-home.html");

test("Noir gives the desktop shell a premium dark treatment and turns fully off", async () => {
  const { chromium } = await import("playwright");
  const { DEFAULT_SETTINGS, normalizeSettings } = await importSourceModule("src/platform/settings.ts");
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: "noir" }
  });
  assert.equal(settings.appearance.theme, "noir", "Noir must survive settings normalization");
  assert.equal(DEFAULT_SETTINGS.appearance.theme, "noir", "Noir must be the authored default");

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
      const collapsedChat = document.createElement("div");
      collapsedChat.dataset.testid = "chat-drawer-root";
      collapsedChat.style.cssText = "position:fixed;right:24px;bottom:24px;width:350px;height:55px";
      collapsedChat.append(document.createElement("button"));
      document.body.append(collapsedChat);
      const profileControls = document.createElement("div");
      profileControls.id = "fixture-profile-controls";
      profileControls.innerHTML = `
        <button data-testid="fixture-follow"><span>Follow</span></button>
        <button data-testid="editProfileButton"><span>Edit profile</span></button>`;
      document.querySelector('[data-testid="primaryColumn"]')?.prepend(profileControls);
      const action = document.querySelector('article[data-testid="tweet"] [role="group"] button');
      if (action) {
        action.innerHTML = '<div style="color:rgb(113, 118, 123)"><svg viewBox="0 0 24 24"><g style="color:rgb(113, 118, 123)"><path style="color:rgb(113, 118, 123)" fill="rgb(113, 118, 123)" d="M3 3h18v18H3z"></path></g></svg></div>';
      }
      document.querySelector('[data-testid="SideNav_NewTweet_Button"]').style.backgroundColor =
        "rgb(239, 243, 244)";
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
      const profileFixture = document.createElement("section");
      profileFixture.id = "fixture-profile-promo-wrapper";
      profileFixture.setAttribute("data-av-profile-header", "fixture");
      profileFixture.innerHTML = `
        <div id="fixture-profile-promo" style="background-color:rgb(0, 67, 41)">
          <button role="button">Close</button>
          <div><a href="/i/premium_sign_up">Get verified</a></div>
        </div>`;
      document.querySelector('[data-testid="primaryColumn"]')?.prepend(profileFixture);
    }, settings);

    const noir = await page.evaluate(() => {
      const styleOf = (selector) => getComputedStyle(document.querySelector(selector));
      const root = styleOf("html");
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
      const followButton = styleOf('[data-testid="fixture-follow"]');
      const editButton = styleOf('[data-testid="editProfileButton"]');
      const actionButton = styleOf('article[data-testid="tweet"] [role="group"] button');
      const actionIcon = styleOf('article[data-testid="tweet"] [role="group"] button path');
      const profilePromo = styleOf("#fixture-profile-promo");
      return {
        theme: document.documentElement.dataset.avTheme,
        className: document.documentElement.classList.contains("av-theme-noir"),
        accent: root.getPropertyValue("--av-accent").trim(),
        activeNav: document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.getAttribute("data-av-active-route"),
        rootBackground: root.backgroundImage,
        rootBackgroundColor: root.backgroundColor,
        bodyBackground: body.backgroundImage,
        bodyBackgroundColor: body.backgroundColor,
        navBackground: nav.backgroundImage,
        navBackgroundColor: nav.backgroundColor,
        activeNavBackground: activeNav.backgroundImage,
        activeNavBackgroundColor: activeNav.backgroundColor,
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
        buttonFill: postButton.backgroundColor,
        buttonColor: postButton.color,
        collapsedDrawerDisplay: styleOf('[data-testid="chat-drawer-root"]').display,
        followRadius: followButton.borderRadius,
        followFill: followButton.backgroundColor,
        followColor: followButton.color,
        editRadius: editButton.borderRadius,
        editFill: editButton.backgroundColor,
        actionHeight: actionButton.minHeight,
        actionRadius: actionButton.borderRadius,
        actionColor: actionButton.color,
        actionIconFill: actionIcon.fill,
        profilePromoBackground: profilePromo.backgroundColor,
        profilePromoBorder: profilePromo.borderTopWidth,
        profilePromoRadius: profilePromo.borderRadius,
        scrollWidth: document.documentElement.scrollWidth
      };
    });

    assert.equal(noir.theme, "noir");
    assert.equal(noir.className, true);
    assert.equal(noir.activeNav, "1", "Noir must mark the current route without relying on X's aria-current");
    assert.equal(noir.rootBackground, "none", "Noir uses flat surfaces rather than decorative gradients");
    assert.notEqual(noir.rootBackgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(noir.bodyBackground, "none", "the viewport-height body must not own the scrolling canvas");
    assert.equal(noir.bodyBackgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(noir.navBackground, "none");
    assert.notEqual(noir.navBackgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(noir.activeNavBackground, "none");
    assert.notEqual(noir.activeNavBackgroundColor, "rgba(0, 0, 0, 0)");
    assert.match(noir.primaryBackground, /rgba?\(/);
    assert.equal(noir.primaryShadow, "none", "the reading column must not float over the canvas");
    assert.equal(noir.articleBackground, "none", "posts belong to one continuous stream");
    assert.equal(noir.articleRadius, "0px");
    assert.equal(noir.mediaBorder, "1px");
    assert.notEqual(noir.mediaShadow, "none");
    assert.equal(noir.sidebarBackground, "none");
    assert.equal(noir.sidebarRadius, "10px");
    assert.equal(noir.currentNewsBackground, "none");
    assert.equal(noir.currentNewsMarkerBackground, "none", "the tiny live news marker is not painted as a card");
    assert.notEqual(noir.searchShellBackground, "rgba(0, 0, 0, 0)");
    assert.equal(noir.searchShellRadius, "10px");
    assert.equal(noir.searchInputBackground, "rgba(0, 0, 0, 0)");
    assert.equal(noir.searchInputBorder, "0px");
    assert.equal(noir.buttonBackground, "none");
    assert.equal(noir.buttonFill, noir.accent, "Noir must override X's inline Post button fill");
    assert.ok(contrast(parseRgb(noir.buttonColor), parseRgb(noir.accent)) >= 4.5);
    assert.equal(noir.collapsedDrawerDisplay, "none", "collapsed drawers must not cover wide posts");
    assert.equal(noir.followRadius, "8px", "native Follow should match Noir controls");
    assert.equal(noir.followFill, noir.accent);
    assert.ok(contrast(parseRgb(noir.followColor), parseRgb(noir.followFill)) >= 4.5);
    assert.equal(noir.editRadius, "8px", "native Edit profile should match Noir controls");
    assert.notEqual(noir.editFill, "rgba(0, 0, 0, 0)");
    assert.equal(noir.actionHeight, "36px", "post controls need a stable click target");
    assert.equal(noir.actionRadius, "6px");
    assert.equal(noir.actionIconFill, noir.actionColor, "post icons must inherit the themed control color");
    assert.notEqual(noir.profilePromoBackground, "rgb(0, 67, 41)");
    assert.equal(noir.profilePromoBorder, "1px");
    assert.equal(noir.profilePromoRadius, "10px");
    assert.ok(noir.scrollWidth <= beforeScrollWidth + 1, "the theme must not introduce horizontal overflow");

    await page.locator("#fixture-profile-promo-wrapper").evaluate((node) => node.remove());

    const stableMarkers = await page.evaluate(async (nextSettings) => {
      const records = [];
      const frame = document.querySelector("[data-av-media-frame]");
      const nativeRect = frame?.getBoundingClientRect;
      let mediaLayoutReads = 0;
      if (frame && nativeRect) {
        frame.getBoundingClientRect = () => {
          mediaLayoutReads += 1;
          return nativeRect.call(frame);
        };
      }
      const observer = new MutationObserver((mutations) => records.push(...mutations));
      observer.observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: [
          "data-av-active-route",
          "data-av-nav-item",
          "data-av-wide-stream",
          "data-av-profile-header",
          "data-av-media-frame",
          "data-av-media-context",
          "data-av-theme",
          "data-av-width",
          "data-av-surface",
          "data-av-color-scheme",
          "class",
          "style"
        ]
      });
      globalThis.__mod.applyTheme(nextSettings);
      await Promise.resolve();
      observer.disconnect();
      if (frame && nativeRect) frame.getBoundingClientRect = nativeRect;
      return {
        mediaLayoutReads,
        mutations: records.map((record) => record.attributeName)
      };
    }, settings);
    assert.deepEqual(
      stableMarkers.mutations,
      [],
      "an unchanged observer pass must not tear down and rebuild layout markers"
    );
    assert.equal(
      stableMarkers.mediaLayoutReads,
      0,
      "an unchanged observer pass must not remeasure settled media geometry"
    );

    const historyNavigation = await page.evaluate((nextSettings) => {
      history.pushState({}, "", "/i/history/likes");
      globalThis.__mod.applyTheme(nextSettings);
      const historyLink = document.querySelector('nav a[href="/i/history"]');
      const homeLink = document.querySelector('[data-testid="AppTabBar_Home_Link"]');
      return {
        historyMarker: historyLink?.getAttribute("data-av-active-route") ?? null,
        historyItem: historyLink?.getAttribute("data-av-nav-item") ?? null,
        homeMarker: homeLink?.getAttribute("data-av-active-route") ?? null
      };
    }, settings);
    assert.deepEqual(historyNavigation, {
      historyMarker: "1",
      historyItem: "1",
      homeMarker: null
    });

    const historyBeforeHover = await page.locator('nav a[href="/i/history"]').boundingBox();
    await page.hover('nav a[href="/i/history"]');
    const historyAfterHover = await page.locator('nav a[href="/i/history"]').boundingBox();
    const historyTransform = await page.$eval(
      'nav a[href="/i/history"]',
      (node) => getComputedStyle(node).transform
    );
    assert.equal(historyTransform, "none", "navigation hover must not slide the target sideways");
    assert.equal(historyAfterHover?.x, historyBeforeHover?.x);
    await page.mouse.move(0, 0);

    const scrolledCanvas = await page.evaluate(() => {
      const overflow = document.createElement("div");
      overflow.id = "av-noir-scroll-regression";
      overflow.setAttribute("aria-hidden", "true");
      overflow.style.cssText = "position:absolute;inset:0 auto auto 0;width:1px;height:2400px;pointer-events:none";
      document.body.append(overflow);
      window.scrollTo({ top: 800, behavior: "instant" });
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      return {
        scrollY: window.scrollY,
        bodyBottom: document.body.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
        rootBackground: root.backgroundImage,
        rootBackgroundColor: root.backgroundColor,
        bodyBackground: body.backgroundImage,
        bodyBackgroundColor: body.backgroundColor
      };
    });
    assert.ok(scrolledCanvas.scrollY > 0, "the fixture must exercise a real scrolling canvas");
    assert.ok(
      scrolledCanvas.bodyBottom > 0 && scrolledCanvas.bodyBottom < scrolledCanvas.viewportHeight,
      "the regression fixture must put X's viewport-height body edge inside the scrolled viewport"
    );
    assert.equal(scrolledCanvas.rootBackground, "none");
    assert.notEqual(scrolledCanvas.rootBackgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(scrolledCanvas.bodyBackground, "none");
    assert.equal(scrolledCanvas.bodyBackgroundColor, "rgba(0, 0, 0, 0)");

    await page.evaluate(
      (offSettings) => globalThis.__mod.applyTheme(offSettings),
      {
        ...DEFAULT_SETTINGS,
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          theme: "off",
          timelineWidth: "default"
        }
      }
    );
    const off = await page.evaluate(() => {
      const read = (selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow, borderRadius: style.borderRadius };
      };
      return {
        theme: document.documentElement.dataset.avTheme ?? null,
        className: document.documentElement.classList.contains("av-theme-noir"),
        activeNav: document.querySelector('[data-testid="AppTabBar_Home_Link"]')?.hasAttribute("data-av-active-route"),
        root: read("html"),
        body: read("body"),
        article: read('article[data-testid="tweet"]'),
        postButton: read('[data-testid="SideNav_NewTweet_Button"]')
      };
    });
    assert.equal(off.theme, null);
    assert.equal(off.className, false);
    assert.equal(off.activeNav, false);
    assert.equal(off.root.backgroundImage, "none");
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
