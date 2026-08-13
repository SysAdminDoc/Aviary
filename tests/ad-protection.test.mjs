import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-ads-"));
  const bundle = path.join(temp, "ads.js");
  await build({
    entryPoints: [path.join(root, "src/features/privacy/ad-protection.ts")],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryAds",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the early shield and runtime scanner remove current ad forms without hiding organic media", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    AviaryAds.installEarlyAdShield();

    const cell = (label, options = {}) => {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-testid", "cellInnerDiv");
      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      if (options.time) {
        const time = document.createElement("time");
        time.textContent = "10:30 AM";
        article.append(time);
      }
      if (options.placement) {
        const placement = document.createElement("div");
        placement.setAttribute("data-testid", "placementTracking");
        article.append(placement);
      }
      const text = document.createElement("span");
      text.textContent = label;
      article.append(text);
      if (options.href) {
        const link = document.createElement("a");
        link.href = options.href;
        link.textContent = "Learn more";
        article.append(link);
      }
      wrapper.append(article);
      document.body.append(wrapper);
      return { wrapper, article };
    };

    const organic = cell("Organic video", { time: true, placement: true });
    const nativeAd = cell("Ad", { placement: true });
    const partnership = cell("Paid partnership", {
      time: true,
      href: "https://help.x.com/en/rules-and-policies/paid-partnerships-policy"
    });

    const promotedTrend = document.createElement("div");
    promotedTrend.setAttribute("data-testid", "trend");
    promotedTrend.textContent = "Promoted by NFL";
    const organicTrend = document.createElement("div");
    organicTrend.setAttribute("data-testid", "trend");
    organicTrend.textContent = "Technology · Trending";
    document.body.append(promotedTrend, organicTrend);

    const housePromo = document.createElement("aside");
    housePromo.setAttribute("role", "complementary");
    housePromo.setAttribute("aria-label", "Introducing Image 2.0, from Grok");
    const grokLink = document.createElement("a");
    grokLink.href = "https://grok.com/imagine";
    housePromo.append(grokLink);
    document.body.append(housePromo);

    const video = document.createElement("div");
    video.setAttribute("data-testid", "videoPlayer");
    video.textContent = "Video will play after ad\nSkip Ad in 5 seconds";
    document.body.append(video);

    const early = {
      native: getComputedStyle(nativeAd.wrapper).display,
      partnership: getComputedStyle(partnership.wrapper).display,
      organic: getComputedStyle(organic.wrapper).display,
      house: getComputedStyle(housePromo).display
    };

    const settings = {
      privacy: { blockAds: true }
    };
    const context = {
      settings,
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryAds.adProtectionFeature.init(context);

    const runtime = {
      native: nativeAd.wrapper.getAttribute("data-av-ad-hidden"),
      partnership: partnership.wrapper.getAttribute("data-av-ad-hidden"),
      promotedTrend: promotedTrend.getAttribute("data-av-ad-hidden"),
      organicTrend: organicTrend.getAttribute("data-av-ad-hidden"),
      house: housePromo.getAttribute("data-av-ad-hidden"),
      video: video.getAttribute("data-av-ad-hidden"),
      organic: organic.wrapper.getAttribute("data-av-ad-hidden"),
      counters: AviaryAds.adProtectionCounters()
    };

    const dynamic = cell("Sponsored", { placement: true });
    AviaryAds.adProtectionFeature.apply(context, dynamic.wrapper, [dynamic.wrapper]);
    const afterSpa = {
      hidden: dynamic.wrapper.getAttribute("data-av-ad-hidden"),
      counters: AviaryAds.adProtectionCounters()
    };

    settings.privacy.blockAds = false;
    AviaryAds.adProtectionFeature.apply(context, document);
    const disabled = {
      rootClass: document.documentElement.classList.contains("av-block-ads"),
      marked: document.querySelectorAll("[data-av-ad-hidden]").length,
      native: getComputedStyle(nativeAd.wrapper).display,
      organic: getComputedStyle(organic.wrapper).display
    };

    settings.privacy.blockAds = true;
    video.textContent = "Organic video ready";
    AviaryAds.adProtectionFeature.apply(context, video, [video]);
    const recoveredVideo = video.getAttribute("data-av-ad-hidden");
    AviaryAds.adProtectionFeature.destroy(context);
    return { early, runtime, afterSpa, disabled, recoveredVideo };
  });

  assert.equal(result.early.native, "none", "structural native ads must lose the first paint");
  assert.equal(result.early.partnership, "none");
  assert.equal(result.early.house, "none");
  assert.notEqual(result.early.organic, "none", "placementTracking alone is not an ad signal");

  assert.equal(result.runtime.native, "post");
  assert.equal(result.runtime.partnership, "post");
  assert.equal(result.runtime.promotedTrend, "trend");
  assert.equal(result.runtime.organicTrend, null);
  assert.equal(result.runtime.house, "house");
  assert.equal(result.runtime.video, "video");
  assert.equal(result.runtime.organic, null);
  assert.deepEqual(result.runtime.counters, { hiddenPlacements: 4, suppressedVideoAds: 1 });

  assert.equal(result.afterSpa.hidden, "post");
  assert.deepEqual(result.afterSpa.counters, { hiddenPlacements: 5, suppressedVideoAds: 1 });
  assert.equal(result.disabled.rootClass, false);
  assert.equal(result.disabled.marked, 0);
  assert.notEqual(result.disabled.native, "none");
  assert.notEqual(result.disabled.organic, "none");
  assert.equal(result.recoveredVideo, null, "the organic video returns after the pre-roll marker leaves");
});
