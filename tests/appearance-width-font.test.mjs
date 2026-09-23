import assert from "node:assert/strict";
import { captureUrl } from "./helpers/synthetic-capture.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
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
  await page.goto(await captureUrl("home"));
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "av-theme-style";
    document.head.append(style);
  });

  // The same document with the column geometry the schema recorded from X's own stylesheets.
  //
  // This is a reduction, and it is worth being plain about: the lane used to attach the ~8,000
  // lines of stylesheet the capture carried, and it now attaches eleven rules built from thirteen
  // recorded numbers -- flex, max-width and column widths. What it still proves is that Aviary's
  // width tiers beat X's own flex declarations for the primary column, which is the claim the
  // feature makes. What it no longer proves is that nothing else in X's cascade interferes. That
  // trade bought the removal of a saved authenticated page; the numbers it rests on are recorded
  // in `_decoded/dom-schema.json` under `layout`, with the date they were measured.
  currentPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await currentPage.goto(await captureUrl("home-layout"));
  await currentPage.evaluate(() => {
    const primary = document.querySelector('[data-testid="primaryColumn"]');
    const region = primary?.querySelector('section[role="region"]');
    if (!primary || !region) throw new Error("timeline region missing from current-X fixture");
    const lane = document.createElement("div");
    lane.id = "current-x-stream-lane";
    lane.style.cssText =
      "display:flex;flex-direction:column;align-self:center;width:100%;max-width:600px;min-width:0";
    region.replaceWith(lane);
    const profileHeader = document.createElement("div");
    profileHeader.id = "current-x-profile-header";
    profileHeader.style.width = "100%";
    profileHeader.innerHTML = `
      <div style="width:100%;aspect-ratio:3/1;background:#333"></div>
      <a href="/fixture/photo" style="display:block;width:25%;aspect-ratio:1">
        <div data-testid="UserAvatar-Container-fixture" style="width:100%;height:100%"></div>
      </a>
      <div data-testid="UserProfileHeader_Items">Joined today</div>`;
    lane.append(profileHeader);
    lane.append(region);
  });
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
      const available = column.closest('main[role="main"]') ?? column.parentElement;
      const stream = document.querySelector("#current-x-stream-lane");
      const article = stream?.querySelector('article[data-testid="tweet"]');
      const profileHeader = document.querySelector("#current-x-profile-header");
      const profileAvatar = profileHeader?.querySelector('[data-testid^="UserAvatar-Container-"]');
      const columnRect = column.getBoundingClientRect();
      const availableRect = available.getBoundingClientRect();
      const profileHeaderRect = profileHeader.getBoundingClientRect();
      return {
        width: Math.round(columnRect.width),
        columnLeft: Math.round(columnRect.left),
        parentWidth: Math.round(column.parentElement.getBoundingClientRect().width),
        availableWidth: Math.round(availableRect.width),
        availableLeft: Math.round(availableRect.left),
        streamWidth: Math.round(stream.getBoundingClientRect().width),
        streamMaxWidth: getComputedStyle(stream).maxWidth,
        articleWidth: Math.round(article.getBoundingClientRect().width),
        profileHeaderWidth: Math.round(profileHeaderRect.width),
        profileHeaderLeft: Math.round(profileHeaderRect.left),
        profileAvatarWidth: Math.round(profileAvatar.getBoundingClientRect().width),
        flexBasis: getComputedStyle(column).flexBasis,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth
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
  assert.equal(wide.width, 1180, "wide fills ordinary desktop space without becoming an ultrawide wall");
});

test("timelineWidth controls the recorded X flex item when the sidebar is hidden", async () => {
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
  assert.ok(wide.width >= 1040, `current X wide should use at least 1040px, saw ${wide.width}px`);
  assert.equal(
    wide.flexBasis,
    "1180px",
    `current X flex basis should preserve the ultrawide ceiling, saw ${wide.flexBasis}`
  );
});

test("wide centers a bounded reading surface in spare ultrawide canvas", async () => {
  await currentPage.setViewportSize({ width: 1920, height: 1080 });
  const wide = await measureCurrent({ timelineWidth: "wide" });
  await currentPage.setViewportSize({ width: 1400, height: 900 });

  assert.ok(
    wide.availableWidth > 1200,
    `the fixture must expose spare desktop canvas, saw ${wide.availableWidth}px`
  );
  assert.ok(
    wide.width === 1180,
    `wide should stop at the reading ceiling, saw ${wide.width}px`
  );
  assert.ok(
    Math.abs(wide.columnLeft - wide.availableLeft - (wide.availableWidth - wide.width) / 2) <= 1,
    `wide was not centered in the available canvas: x=${wide.columnLeft}, available x=${wide.availableLeft}`
  );
  assert.equal(wide.scrollWidth, wide.viewportWidth, "full width introduced horizontal scrolling");
});

test("wide releases X's nested 600px stream lane instead of widening empty canvas", async () => {
  await currentPage.setViewportSize({ width: 1920, height: 1080 });
  const base = await measureCurrent({ timelineWidth: "default" });
  const wide = await measureCurrent({ timelineWidth: "wide" });
  await currentPage.setViewportSize({ width: 1400, height: 900 });

  assert.equal(base.streamWidth, 600, "the regression fixture must reproduce X's inner cap");
  assert.equal(wide.streamWidth, 1180, `wide left the post stream at ${wide.streamWidth}px`);
  assert.equal(wide.streamMaxWidth, "none", "wide did not release the inner max-width");
  assert.ok(
    Math.abs(wide.streamWidth - wide.width) <= 1,
    `the stream uses ${wide.streamWidth}px of a ${wide.width}px primary column`
  );
  assert.equal(wide.articleWidth, wide.streamWidth, "posts did not expand with the stream lane");
});

test("wide keeps the profile identity block and avatar at a readable size", async () => {
  await currentPage.setViewportSize({ width: 1920, height: 1080 });
  const wide = await measureCurrent({ timelineWidth: "wide" });
  await currentPage.setViewportSize({ width: 1400, height: 900 });

  assert.equal(wide.profileHeaderWidth, 960, "the profile banner grew past the media lane");
  assert.equal(wide.profileAvatarWidth, 160, "the profile avatar became a screen-sized portrait");
  assert.ok(
    Math.abs(wide.profileHeaderLeft - wide.columnLeft - (wide.width - wide.profileHeaderWidth) / 2) <= 1,
    "the profile identity block is not centered in the reading column"
  );
});

test("timelineWidth never overflows a viewport narrower than the tier", async () => {
  await page.setViewportSize({ width: 700, height: 900 });
  const narrow = await measure({ timelineWidth: "wide" });
  await page.setViewportSize({ width: 1400, height: 900 });

  assert.ok(
    narrow.width <= 700,
    `full width must clamp to the 700px viewport, measured ${narrow.width}px`
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
