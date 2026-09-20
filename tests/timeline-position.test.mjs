import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const HOME_FIXTURE = `
<main>
  ${Array.from({ length: 24 }, (_, index) => `
    <article data-testid="tweet" id="post-${index}" style="height:${150 + (index % 3) * 35}px;border:1px solid transparent">
      <a href="/alice/status/${1000 + index}"><time>now</time></a>
      <div data-testid="tweetText">post ${index}</div>
    </article>`).join("")}
</main>`;

const STATUS_FIXTURE = `
<main>
  <article data-testid="tweet" style="height:700px">
    <a href="/alice/status/9999"><time>now</time></a>
    <div data-testid="tweetText">opened post</div>
  </article>
</main>`;

let browser;
let page;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-timeline-position-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { timelinePositionFeature } from ${JSON.stringify(abs("src/features/layout/timeline-position.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryPosition",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
  await page.route("http://aviary.test/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><meta charset=utf-8><body></body>"
  }));
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function load(enabled = true) {
  await page.goto("http://aviary.test/home");
  await page.addScriptTag({ path: bundle });
  await page.evaluate(({ home, status, enabled }) => {
    history.scrollRestoration = "manual";
    sessionStorage.clear();
    document.body.innerHTML = home;
    // Registered before the feature so a popstate presents the destination DOM before its restore
    // session starts. X's router performs the equivalent swap in the real page.
    addEventListener("popstate", () => {
      document.body.innerHTML = location.pathname === "/home" ? home : status;
    }, true);
    const settings = AviaryPosition.cloneSettings(AviaryPosition.DEFAULT_SETTINGS);
    settings.layout.restoreTimelinePosition = enabled;
    globalThis.positionCtx = {
      settings,
      route: { surface: "home", path: "/home", href: location.href },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryPosition.timelinePositionFeature.init(globalThis.positionCtx);
  }, { home: HOME_FIXTURE, status: STATUS_FIXTURE, enabled });
}

test("Back returns the same post to the same viewport position", async () => {
  await load(true);
  const before = await page.evaluate(async () => {
    scrollTo(0, 1380);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const article = [...document.querySelectorAll('article[data-testid="tweet"]')]
      .find((entry) => {
        const rect = entry.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight;
      });
    const top = article.getBoundingClientRect().top;
    const id = article.id;
    article.querySelector("a").dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1
    }));
    history.pushState({}, "", "/alice/status/9999");
    // The route fixture is replaced explicitly because pushState itself does not render.
    document.body.innerHTML = `<main><article data-testid="tweet" style="height:700px"><a href="/alice/status/9999"><time>now</time></a><div data-testid="tweetText">opened post</div></article></main>`;
    scrollTo(0, 0);
    history.back();
    return { top, id };
  });

  await page.waitForURL("http://aviary.test/home");
  await page.waitForFunction(() =>
    document.documentElement.dataset.avTimelineRestore === undefined && scrollY > 500
  );
  const after = await page.evaluate((id) => ({
    top: document.getElementById(id).getBoundingClientRect().top,
    scrollY
  }), before.id);

  assert.ok(Math.abs(after.top - before.top) <= 3, `anchor moved ${after.top - before.top}px`);
  assert.ok(after.scrollY > 500, `restore stopped at ${after.scrollY}`);
  await page.evaluate(() => AviaryPosition.timelinePositionFeature.destroy(globalThis.positionCtx));
});

test("wheel input cancels an in-progress restore", async () => {
  await load(true);
  const result = await page.evaluate(async () => {
    scrollTo(0, 1250);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const article = document.elementFromPoint(300, 200).closest('article[data-testid="tweet"]');
    article.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    history.pushState({}, "", "/alice/status/9999");
    document.body.innerHTML = `<main><article data-testid="tweet" style="height:700px"><a href="/alice/status/9999"><time>now</time></a></article></main>`;
    scrollTo(0, 0);
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 5));
    dispatchEvent(new WheelEvent("wheel", { deltaY: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      scrollY,
      restoring: document.documentElement.dataset.avTimelineRestore ?? null
    };
  });

  assert.equal(result.restoring, null);
  assert.equal(result.scrollY, 0, "the cancelled restore still moved the page");
  await page.evaluate(() => AviaryPosition.timelinePositionFeature.destroy(globalThis.positionCtx));
});

test("a native scrolling key cancels an in-progress restore without becoming a shortcut", async () => {
  await load(true);
  const result = await page.evaluate(async () => {
    scrollTo(0, 1250);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const article = document.elementFromPoint(300, 200).closest('article[data-testid="tweet"]');
    article.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    history.pushState({}, "", "/alice/status/9999");
    document.body.innerHTML = `<main><article data-testid="tweet" style="height:700px"><a href="/alice/status/9999"><time>now</time></a></article></main>`;
    scrollTo(0, 0);
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 5));
    dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", code: "PageDown" }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      scrollY,
      restoring: document.documentElement.dataset.avTimelineRestore ?? null
    };
  });

  assert.equal(result.restoring, null);
  assert.equal(result.scrollY, 0, "the cancelled restore still moved the page");
  await page.evaluate(() => AviaryPosition.timelinePositionFeature.destroy(globalThis.positionCtx));
});

test("position restore remains opt-in and normalizes a saved choice", async () => {
  const values = await page.evaluate(() => ({
    defaultValue: AviaryPosition.DEFAULT_SETTINGS.layout.restoreTimelinePosition,
    normalized: AviaryPosition.normalizeSettings({ layout: { restoreTimelinePosition: true } })
      .layout.restoreTimelinePosition
  }));
  assert.deepEqual(values, { defaultValue: false, normalized: true });
});
