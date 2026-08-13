import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests/smoke/current-x-home.html");
const themes = ["dim", "lightsOut", "graphite", "plum", "midnight", "noir"];
const viewports = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 }
];

test("every authored dark theme survives dark and light X hosts at both desktop sizes", async () => {
  const browser = await chromium.launch({ headless: true });
  const fixtureHtml = await readFile(fixture, "utf8");
  const themeBundle = await bundleToText("src/features/appearance/theme.ts");

  try {
    for (const viewport of viewports) {
      for (const hostTheme of ["dark", "light"]) {
        const page = await browser.newPage({ viewport });
        await page.route("https://x.com/**", (route) =>
          route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml })
        );
        await page.route("https://pbs.twimg.com/**", (route) => route.abort());
        await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
        await page.addStyleTag({ content: hostCss(hostTheme) });
        await page.addScriptTag({ content: themeBundle });
        await page.evaluate(() => {
          const style = document.createElement("style");
          style.id = "av-theme-matrix";
          style.textContent = globalThis.__themeMatrix.THEME_CSS;
          document.head.append(style);
        });

        const baseline = await page.evaluate(readOffState);
        const baselineWidth = await page.evaluate(() => document.documentElement.scrollWidth);

        for (const theme of themes) {
          await page.evaluate((themeId) => {
            globalThis.__themeMatrix.applyTheme({
              appearance: {
                theme: themeId,
                denseMode: false,
                timelineWidth: "default",
                hideBorders: false,
                hideCounts: false,
                restoreChirp: false
              },
              accessibility: { highContrast: false, reduceMotion: "never" }
            });
          }, theme);
          await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));

          const state = await page.evaluate(() => {
            const rootStyle = getComputedStyle(document.documentElement);
            const body = getComputedStyle(document.body);
            const nav = getComputedStyle(document.querySelector("nav"));
            const primary = getComputedStyle(document.querySelector('[data-testid="primaryColumn"]'));
            const article = getComputedStyle(document.querySelector('article[data-testid="tweet"]'));
            const sidebarCard = getComputedStyle(document.querySelector('[data-testid="news_sidebar"]'));
            const semanticText = (selector) => getComputedStyle(document.querySelector(selector)).color;
            const themeClasses = [...document.documentElement.classList].filter((name) =>
              name.startsWith("av-theme-")
            );
            const token = (name) => rootStyle.getPropertyValue(name).trim();
            return {
              id: document.documentElement.dataset.avTheme,
              themeClasses,
              colorScheme: document.documentElement.style.colorScheme,
              activeNav: document
                .querySelector('[data-testid="AppTabBar_Home_Link"]')
                ?.getAttribute("data-av-active-route"),
              tokens: {
                bg: token("--av-bg"),
                surface: token("--av-surface"),
                text: token("--av-text"),
                muted: token("--av-muted")
              },
              paint: {
                bodyColor: body.color,
                bodyBackground: body.backgroundColor,
                bodyImage: body.backgroundImage,
                navBackground: nav.backgroundColor,
                navImage: nav.backgroundImage,
                primaryBackground: primary.backgroundColor,
                articleColor: article.color,
                sidebarBackground: sidebarCard.backgroundColor,
                sidebarImage: sidebarCard.backgroundImage
              },
              semanticText: {
                studio: semanticText('nav a[href="/i/jf/creators/studio"]'),
                repost: semanticText('[data-testid="retweet"]'),
                analytics: semanticText('article[data-testid="tweet"] a[href$="/analytics"]'),
                grokAction: semanticText('article[data-testid="tweet"] [aria-label="Grok actions"]')
              },
              scrollWidth: document.documentElement.scrollWidth
            };
          });

          const label = `${theme}/${hostTheme}/${viewport.width}x${viewport.height}`;
          assert.equal(state.id, theme, `${label}: dataset drifted`);
          assert.deepEqual(state.themeClasses, [`av-theme-${theme}`], `${label}: stale theme class`);
          assert.equal(state.colorScheme, "dark", `${label}: native controls are not dark`);
          assert.equal(state.activeNav, theme === "noir" ? "1" : null, `${label}: active-route marker drifted`);
          assert.equal(state.paint.bodyColor, state.tokens.text, `${label}: host text colour leaked through`);
          assert.equal(state.paint.articleColor, state.tokens.text, `${label}: post text colour leaked through`);
          assert.ok(hasPaint(state.paint.bodyBackground, state.paint.bodyImage), `${label}: body is transparent`);
          assert.ok(hasPaint(state.paint.navBackground, state.paint.navImage), `${label}: navigation is transparent`);
          assert.notEqual(state.paint.primaryBackground, "rgba(0, 0, 0, 0)", `${label}: timeline is transparent`);
          assert.ok(
            hasPaint(state.paint.sidebarBackground, state.paint.sidebarImage),
            `${label}: sidebar card is transparent`
          );
          assert.ok(state.scrollWidth <= baselineWidth + 1, `${label}: horizontal overflow was introduced`);
          assert.ok(
            contrast(parseRgb(state.tokens.text), parseRgb(state.tokens.bg)) >= 7,
            `${label}: primary text misses the 7:1 premium-theme target`
          );
          assert.ok(
            contrast(parseRgb(state.tokens.muted), parseRgb(state.tokens.surface)) >= 4.5,
            `${label}: muted text misses WCAG AA`
          );
          assert.equal(state.semanticText.studio, state.tokens.text, `${label}: current nav text is unreadable`);
          for (const [control, color] of Object.entries(state.semanticText).slice(1)) {
            assert.equal(color, state.tokens.muted, `${label}: ${control} action text is unreadable`);
          }
        }

        await page.evaluate(() => {
          globalThis.__themeMatrix.applyTheme({
            appearance: {
              theme: "off",
              denseMode: false,
              timelineWidth: "default",
              hideBorders: false,
              hideCounts: false,
              restoreChirp: false
            },
            accessibility: { highContrast: false, reduceMotion: "never" }
          });
        });
        assert.deepEqual(await page.evaluate(readOffState), baseline, `${hostTheme} host did not restore`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});

function hostCss(theme) {
  const light = theme === "light";
  const background = light ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";
  const surface = light ? "rgb(247, 249, 249)" : "rgb(22, 24, 28)";
  const text = light ? "rgb(15, 20, 25)" : "rgb(231, 233, 234)";
  return `
    html { color-scheme: ${theme}; }
    body, nav, [data-testid="primaryColumn"], [data-testid="sidebarColumn"] {
      background: ${background};
      color: ${text};
    }
    nav a, article[data-testid="tweet"], article[data-testid="tweet"] a,
    article[data-testid="tweet"] [data-testid="tweetText"] { color: ${text}; }
    [data-testid="news_sidebar"], [data-testid="toolBar"] { background: ${surface}; color: ${text}; }
  `;
}

function readOffState() {
  const read = (selector) => {
    const style = getComputedStyle(document.querySelector(selector));
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: style.color
    };
  };
  return {
    theme: document.documentElement.dataset.avTheme ?? null,
    themeClasses: [...document.documentElement.classList].filter((name) => name.startsWith("av-theme-")),
    inlineColorScheme: document.documentElement.style.colorScheme,
    marker: document.documentElement.dataset.avColorScheme ?? null,
    activeNav: document
      .querySelector('[data-testid="AppTabBar_Home_Link"]')
      ?.getAttribute("data-av-active-route") ?? null,
    body: read("body"),
    nav: read("nav"),
    primary: read('[data-testid="primaryColumn"]'),
    article: read('article[data-testid="tweet"]')
  };
}

function hasPaint(color, image) {
  return color !== "rgba(0, 0, 0, 0)" || image !== "none";
}

function parseRgb(value) {
  const channels = [...value.matchAll(/[\d.]+/g)].slice(0, 3).map((match) => Number(match[0]));
  assert.equal(channels.length, 3, `could not parse RGB token ${JSON.stringify(value)}`);
  return channels;
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
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-theme-matrix-"));
  const outfile = path.join(temp, "theme.js");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "__themeMatrix",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await readFile(outfile, "utf8");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
