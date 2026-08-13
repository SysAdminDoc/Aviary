import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let browser;
let page;
let currentPage;
let temp;
let bundle;

/** Settings shaped enough for applyTheme, which reads appearance + accessibility. */
const settings = (appearance) => ({
  appearance: {
    theme: "dim",
    denseMode: false,
    timelineWidth: "default",
    hideBorders: false,
    hideCounts: false,
    restoreChirp: false,
    ...appearance
  },
  accessibility: { reduceMotion: "never", highContrast: false }
});

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-appearance-"));
  bundle = path.join(temp, "bundle.js");
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { applyTheme, themeFeature } from ${JSON.stringify(
      path.resolve(root, "src/features/appearance/theme.ts").replace(/\\/g, "/")
    )};`,
    "utf8"
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryTheme",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(
      `chromium is required for this test -- run "npx playwright install chromium".\n${error}`
    );
  }
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route("**://pbs.twimg.com/**", (route) => route.abort());
  await page.route("**://abs.twimg.com/**", (route) => route.abort());
  await page.goto(pathToFileURL(path.join(root, "_decoded/home.html")).href);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "av-theme-style";
    document.head.append(style);
  });

  currentPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const currentCapture = decodeMhtml(await readFile(path.join(root, "Home _ X.mhtml"), "utf8"));
  await currentPage.setContent(currentCapture.html);
  for (const css of currentCapture.css) {
    await currentPage.addStyleTag({ content: css });
  }
  await currentPage.addScriptTag({ path: bundle });
});

after(async () => {
  await currentPage?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Installs the feature's real stylesheet, then measures the captured primary column. */
async function measure(appearance) {
  // The settings object is plain JSON, so it is built here and handed over as an argument --
  // no function source crosses the boundary.
  return page.evaluate(
    (nextSettings) => {
      document.getElementById("av-theme-style")?.remove();
      AviaryTheme.themeFeature.init({
        settings: nextSettings,
        diagnostics: { info() {}, error() {} }
      });
      const column = document.querySelector('[data-testid="primaryColumn"]');
      const article = document.querySelector('article[data-testid="tweet"]');
      return {
        width: Math.round(column.getBoundingClientRect().width),
        font: article ? getComputedStyle(article).fontFamily : null,
        dataWidth: document.documentElement.dataset.avWidth,
        chirpClass: document.documentElement.classList.contains("av-chirp")
      };
    },
    settings(appearance)
  );
}

async function measureCurrent(appearance) {
  return currentPage.evaluate(
    (nextSettings) => {
      document.getElementById("av-theme-foundation")?.remove();
      AviaryTheme.themeFeature.init({
        settings: nextSettings,
        diagnostics: { info() {}, error() {} }
      });
      const column = document.querySelector('[data-testid="primaryColumn"]');
      return {
        width: Math.round(column.getBoundingClientRect().width),
        flexBasis: getComputedStyle(column).flexBasis
      };
    },
    settings(appearance)
  );
}

test("timelineWidth actually widens the captured primary column", async () => {
  const base = await measure({ timelineWidth: "default" });
  const comfortable = await measure({ timelineWidth: "comfortable" });
  const wide = await measure({ timelineWidth: "wide" });

  assert.equal(base.dataWidth, "default");
  // The setting round-tripped through normalizeSettings for two releases while nothing read it.
  // These are the numbers that prove it is wired to something now.
  assert.ok(
    comfortable.width > base.width,
    `comfortable (${comfortable.width}px) must exceed default (${base.width}px)`
  );
  assert.ok(
    wide.width > comfortable.width,
    `wide (${wide.width}px) must exceed comfortable (${comfortable.width}px)`
  );
  assert.equal(wide.width, 1040, "wide is capped at its declared width on a 1400px viewport");
});

test("timelineWidth controls the current X flex item when the sidebar is hidden", async () => {
  await currentPage.evaluate(() => {
    document.querySelector('[data-testid="sidebarColumn"]')?.remove();
  });

  const base = await measureCurrent({ timelineWidth: "default" });
  const comfortable = await measureCurrent({ timelineWidth: "comfortable" });
  const wide = await measureCurrent({ timelineWidth: "wide" });

  assert.ok(
    comfortable.width > base.width,
    `current X comfortable (${comfortable.width}px) must exceed default (${base.width}px)`
  );
  assert.ok(
    wide.width > comfortable.width,
    `current X wide (${wide.width}px) must exceed comfortable (${comfortable.width}px)`
  );
  assert.equal(wide.width, 1040);
  assert.ok(wide.flexBasis.includes("1040px"), `current X flex basis should be pinned, saw ${wide.flexBasis}`);
});

test("timelineWidth never overflows a viewport narrower than the tier", async () => {
  await page.setViewportSize({ width: 700, height: 900 });
  const narrow = await measure({ timelineWidth: "wide" });
  await page.setViewportSize({ width: 1400, height: 900 });

  assert.ok(
    narrow.width <= 700,
    `a 1040px tier must clamp to the 700px viewport, measured ${narrow.width}px`
  );
});

test("restoreChirp applies the family name X actually registers", async () => {
  const off = await measure({ restoreChirp: false });
  const on = await measure({ restoreChirp: true });

  assert.equal(off.chirpClass, false);
  assert.equal(on.chirpClass, true);
  assert.match(on.font, /^TwitterChirp/, `expected the Chirp stack, saw ${on.font}`);
  assert.notEqual(on.font, off.font, "the rule must change the computed font, not just a class");
});

test("hideCounts removes the view number without removing its accessible analytics link", async () => {
  const result = await page.evaluate((nextSettings) => {
    const article = document.createElement("article");
    article.dataset.testid = "tweet";
    const analytics = document.createElement("a");
    analytics.href = "/fixture/status/1/analytics";
    analytics.setAttribute("aria-label", "4200 views. View post analytics");
    const count = document.createElement("span");
    count.dataset.testid = "app-text-transition-container";
    count.textContent = "4.2K";
    analytics.append(count);
    article.append(analytics);
    document.body.append(article);

    AviaryTheme.applyTheme(nextSettings);
    const measured = {
      count: getComputedStyle(count).display,
      link: getComputedStyle(analytics).display,
      label: analytics.getAttribute("aria-label")
    };
    article.remove();
    return measured;
  }, settings({ hideCounts: true }));

  assert.deepEqual(result, {
    count: "none",
    link: "inline",
    label: "4200 views. View post analytics"
  });
});

test("destroy clears both new hooks off the document element", async () => {
  const after = await page.evaluate(() => {
    AviaryTheme.themeFeature.destroy({ diagnostics: { info() {}, error() {} } });
    return {
      dataWidth: document.documentElement.dataset.avWidth ?? null,
      chirpClass: document.documentElement.classList.contains("av-chirp")
    };
  });

  assert.equal(after.dataWidth, null);
  assert.equal(after.chirpClass, false);
});

function decodeMhtml(source) {
  const boundary = /boundary="([^"]+)"/.exec(source)?.[1];
  assert.ok(boundary, "current X capture has no MIME boundary");
  const parts = source
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "--")
    .map((part) => {
      const divider = part.indexOf("\n\n");
      const headers = (divider >= 0 ? part.slice(0, divider) : part).toLowerCase();
      const body = divider >= 0 ? part.slice(divider + 2) : "";
      return { headers, body: decodeQuotedPrintable(body) };
    });
  const html = parts.find((part) => part.headers.includes("content-type: text/html"))?.body;
  assert.ok(html, "current X capture has no HTML part");
  const css = parts
    .filter((part) => part.headers.includes("content-type: text/css"))
    .map((part) => part.body)
    .filter((body) => body.length > 0);
  return { html, css };
}

function decodeQuotedPrintable(value) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}
