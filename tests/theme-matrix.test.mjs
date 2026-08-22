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
                rootBackground: rootStyle.backgroundColor,
                rootImage: rootStyle.backgroundImage,
                rootAttachment: rootStyle.backgroundAttachment,
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
          assert.ok(
            hasPaint(state.paint.bodyBackground, state.paint.bodyImage) ||
              hasPaint(state.paint.rootBackground, state.paint.rootImage),
            `${label}: scrolling canvas is transparent`
          );
          if (theme === "noir") {
            assert.equal(state.paint.rootImage, "none", `${label}: root retained decorative texture`);
            assert.equal(state.paint.bodyImage, "none", `${label}: body retained decorative texture`);
            assert.equal(state.paint.navImage, "none", `${label}: navigation retained decorative texture`);
            assert.equal(state.paint.sidebarImage, "none", `${label}: sidebar retained decorative texture`);
            assert.equal(state.paint.rootBackground, state.tokens.bg, `${label}: root missed the flat canvas token`);
            assert.equal(state.paint.bodyBackground, "rgba(0, 0, 0, 0)", `${label}: body masks the root canvas`);
          }
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
    root: read("html"),
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

/**
 * A token a stylesheet reads must be a token a theme can set.
 *
 * Five names were referenced and defined nowhere -- `--av-danger` and the four `--av-media-*` --
 * so their hard-coded fallback painted in every palette and no theme could change them. The
 * default theme is "off", which defines no custom properties at all, which is exactly why an
 * undefined token looks like it works.
 */

/**
 * A token a stylesheet reads must be a token something sets, and a palette token must be set by
 * every palette.
 *
 * Five names were referenced and defined nowhere -- `--av-danger` and the four `--av-media-*` --
 * so their hard-coded fallback painted in every palette and no theme could change them. A sixth,
 * `--av-accent-secondary`, was defined by `noir` alone, which is the other half of the same
 * problem: a rule reading it outside that palette resolves to nothing. The default theme is "off"
 * and defines no custom properties at all, which is exactly why either mistake looks like it works.
 */
test("every --av-* token is set somewhere, and every palette token is set by all six", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const repo = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");

  const walk = async (directory) => {
    const out = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = nodePath.join(directory, entry.name);
      if (entry.isDirectory()) out.push(...(await walk(full)));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".css")) out.push(full);
    }
    return out;
  };

  const read = new Set();
  const assigned = new Set();
  for (const file of await walk(nodePath.join(repo, "src"))) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/var\(\s*(--av-[\w-]+)/g)) read.add(match[1]);
    for (const match of text.matchAll(/(--av-[\w-]+)\s*:/g)) assigned.add(match[1]);
    // Some tokens are set per element from JS rather than declared in a stylesheet.
    for (const match of text.matchAll(/setProperty\(\s*"(--av-[\w-]+)"/g)) assigned.add(match[1]);
  }

  const never = [...read].filter((token) => !assigned.has(token)).sort();
  assert.deepEqual(
    never,
    [],
    `these tokens are read and never set anywhere, so only their fallback ever paints: ${never.join(", ")}`
  );

  // The palette half: whatever one palette sets, all of them must set.
  const themeSource = await readFile(nodePath.join(repo, "src/features/appearance/theme.ts"), "utf8");
  const palettes = ["dim", "lightsOut", "graphite", "plum", "midnight", "noir"];
  const perPalette = new Map();
  for (const palette of palettes) {
    const marker = `  ${palette}: \``;
    const from = themeSource.indexOf(marker);
    assert.ok(from >= 0, `palette ${palette} not found in themeVars`);
    const bodyStart = from + marker.length;
    const bodyEnd = themeSource.indexOf("`", bodyStart);
    assert.ok(bodyEnd > bodyStart, `palette ${palette} block is not terminated`);
    const body = themeSource.slice(bodyStart, bodyEnd);
    perPalette.set(palette, new Set([...body.matchAll(/(--av-[\w-]+)\s*:/g)].map((m) => m[1])));
  }

  const union = new Set([...perPalette.values()].flatMap((set) => [...set]));
  const gaps = [];
  for (const [palette, set] of perPalette) {
    for (const token of union) {
      if (!set.has(token)) gaps.push(`${palette} ${token}`);
    }
  }
  assert.deepEqual(
    gaps.sort(),
    [],
    `these palettes are missing a token the others define, so a rule reading it there resolves to ` +
      `its fallback instead of the palette: ${gaps.join(", ")}`
  );
});
