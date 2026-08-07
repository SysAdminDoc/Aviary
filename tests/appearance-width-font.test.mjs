import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let browser;
let page;
let temp;

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
  const bundle = path.join(temp, "bundle.js");
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
});

after(async () => {
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
