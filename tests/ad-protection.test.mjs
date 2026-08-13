import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(root, "tests", "fixtures", "ad-corpus");
const fixtureNames = [
  "native-ad.html",
  "paid-partnership.html",
  "promoted-trend.html",
  "house-promos.html",
  "video-preroll.html"
];
const fixtureContracts = new Map([
  ["native-ad.html", [/data-testid="placementTracking"/, />Ad</, /data-fixture-item="organic-placement"/]],
  ["paid-partnership.html", [/Paid partnership/, /paid-partnerships-policy/]],
  ["promoted-trend.html", [/Promoted by Example Sponsor/, /data-fixture-item="organic-trend"/]],
  ["house-promos.html", [/href="https:\/\/grok\.com\/"/, /aria-label="Subscribe to Premium"/]],
  ["video-preroll.html", [/Video will play after ad/, /Skip Ad in 5 seconds/, /data-fixture-item="organic-video"/]]
]);

let browser;
let bundleSource;
let fixtures;
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
  bundleSource = await readFile(bundle, "utf8");
  fixtures = new Map(
    await Promise.all(
      fixtureNames.map(async (name) => [name, await readFile(path.join(fixtureRoot, name), "utf8")])
    )
  );
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the current-X ad corpus is minimal, synthetic, and contract-complete", () => {
  assert.deepEqual([...fixtures.keys()], fixtureNames);

  for (const [name, html] of fixtures) {
    assert.match(html, /data-fixture-corpus="aviary-ad-2026-08-13"/, name);
    assert.ok(Buffer.byteLength(html, "utf8") < 1_500, `${name} stopped being minimal`);
    assert.doesNotMatch(html, /<script|<style|\bsrc=|auth_token|\bct0\b|Bearer\s|@[A-Za-z0-9_]+/i, name);
    assert.doesNotMatch(html, /\b\d{15,}\b/, `${name} contains a tweet/account-shaped id`);

    const urls = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(
      urls.every((url) => [
        "https://help.x.com/en/rules-and-policies/paid-partnerships-policy",
        "https://grok.com/"
      ].includes(url)),
      `${name} contains a non-contract URL`
    );
    for (const contract of fixtureContracts.get(name) ?? []) {
      assert.match(html, contract, `${name} lost ${contract}`);
    }
  }
});

test("the document-start shield prevents native, partnership, and house-promo first paint", async () => {
  for (const [name, selectors] of [
    ["native-ad.html", ["native-ad"]],
    ["paid-partnership.html", ["paid-partnership"]],
    ["house-promos.html", ["grok-promo", "premium-promo"]]
  ]) {
    const page = await openFixture(name);
    try {
      const result = await page.evaluate((fixtureItems) => ({
        rootClass: document.documentElement.classList.contains("av-block-ads"),
        styleReady: document.getElementById("av-ad-protection") !== null,
        displays: fixtureItems.map((item) =>
          getComputedStyle(document.querySelector(`[data-fixture-item="${item}"]`)).display
        ),
        runtimeMarks: document.querySelectorAll("[data-av-ad-hidden]").length,
        organicPlacement: document.querySelector('[data-fixture-item="organic-placement"]')
          ? getComputedStyle(document.querySelector('[data-fixture-item="organic-placement"]')).display
          : null,
        organicAside: document.querySelector('[data-fixture-item="organic-aside"]')
          ? getComputedStyle(document.querySelector('[data-fixture-item="organic-aside"]')).display
          : null
      }), selectors);

      assert.equal(result.rootClass, true, `${name} did not arm at document start`);
      assert.equal(result.styleReady, true, `${name} had no first-paint style`);
      assert.ok(result.displays.every((display) => display === "none"), name);
      assert.equal(result.runtimeMarks, 0, `${name} should be hidden before the runtime scanner`);
      if (result.organicPlacement !== null) assert.notEqual(result.organicPlacement, "none");
      if (result.organicAside !== null) assert.notEqual(result.organicAside, "none");
    } finally {
      await page.close();
    }
  }
});

test("runtime scanning covers delayed, virtualized, toggle, recovery, and SPA reinsertion states", async () => {
  const page = await openFixture("native-ad.html");
  try {
    await page.evaluate(() => {
      const settings = { privacy: { blockAds: true } };
      const context = { settings, diagnostics: { info() {}, warn() {}, error() {} } };
      globalThis.adFixtureState = { settings, context };
      AviaryAds.adProtectionFeature.init(context);
    });

    for (const name of fixtureNames.slice(1)) {
      await appendFixture(page, fixtures.get(name));
    }

    const active = await page.evaluate(() => ({
      nativeCellMark: document.querySelector('[data-fixture-item="native-ad"]')
        ?.getAttribute("data-av-ad-hidden"),
      nativeArticleMark: document.querySelector('[data-fixture-item="native-ad"] article')
        ?.getAttribute("data-av-ad-hidden"),
      paidCellMark: document.querySelector('[data-fixture-item="paid-partnership"]')
        ?.getAttribute("data-av-ad-hidden"),
      promotedTrend: document.querySelector('[data-fixture-item="promoted-trend"]')
        ?.getAttribute("data-av-ad-hidden"),
      grok: document.querySelector('[data-fixture-item="grok-promo"]')
        ?.getAttribute("data-av-ad-hidden"),
      premium: document.querySelector('[data-fixture-item="premium-promo"]')
        ?.getAttribute("data-av-ad-hidden"),
      video: document.querySelector('[data-fixture-item="video-preroll"]')
        ?.getAttribute("data-av-ad-hidden"),
      organicPlacementDisplay: getComputedStyle(
        document.querySelector('[data-fixture-item="organic-placement"]')
      ).display,
      organicTrendMark: document.querySelector('[data-fixture-item="organic-trend"]')
        ?.getAttribute("data-av-ad-hidden"),
      organicAsideMark: document.querySelector('[data-fixture-item="organic-aside"]')
        ?.getAttribute("data-av-ad-hidden"),
      organicVideoMark: document.querySelector('[data-fixture-item="organic-video"]')
        ?.getAttribute("data-av-ad-hidden"),
      counters: AviaryAds.adProtectionCounters(),
      observations: AviaryAds.observeAdMarkers(document)
    }));

    assert.equal(active.nativeCellMark, "post", "the virtualizer cell must own the collapse");
    assert.equal(active.nativeArticleMark, null, "the article alone must not leave a feed gap");
    assert.equal(active.paidCellMark, "post");
    assert.equal(active.promotedTrend, "trend");
    assert.equal(active.grok, "house");
    assert.equal(active.premium, "house");
    assert.equal(active.video, "video");
    assert.notEqual(active.organicPlacementDisplay, "none");
    assert.equal(active.organicTrendMark, null);
    assert.equal(active.organicAsideMark, null);
    assert.equal(active.organicVideoMark, null);
    assert.deepEqual(active.counters, { hiddenPlacements: 5, suppressedVideoAds: 1 });
    assert.deepEqual(active.observations, { native: 2, trend: 1, housePromo: 2, video: 1 });

    const toggled = await page.evaluate(() => {
      const { settings, context } = globalThis.adFixtureState;
      settings.privacy.blockAds = false;
      AviaryAds.adProtectionFeature.apply(context, document);
      const disabled = {
        rootClass: document.documentElement.classList.contains("av-block-ads"),
        marks: document.querySelectorAll("[data-av-ad-hidden]").length,
        displays: [...document.querySelectorAll("[data-fixture-item]")]
          .map((node) => getComputedStyle(node).display)
      };

      settings.privacy.blockAds = true;
      AviaryAds.adProtectionFeature.apply(context, document);
      const reenabled = {
        rootClass: document.documentElement.classList.contains("av-block-ads"),
        marks: document.querySelectorAll("[data-av-ad-hidden]").length
      };

      const video = document.querySelector('[data-fixture-item="video-preroll"]');
      video.replaceChildren(Object.assign(document.createElement("span"), {
        textContent: "Synthetic organic video ready"
      }));
      AviaryAds.adProtectionFeature.apply(context, video, [video]);
      return {
        disabled,
        reenabled,
        recoveredVideo: video.getAttribute("data-av-ad-hidden")
      };
    });

    assert.equal(toggled.disabled.rootClass, false);
    assert.equal(toggled.disabled.marks, 0);
    assert.ok(toggled.disabled.displays.every((display) => display !== "none"));
    assert.equal(toggled.reenabled.rootClass, true);
    assert.equal(toggled.reenabled.marks, 6);
    assert.equal(toggled.recoveredVideo, null);

    const spa = await page.evaluate((nativeFixture) => {
      history.pushState({}, "", "#following");
      document.querySelector('[data-fixture-case="native-ad"]')?.remove();
      const parsed = new DOMParser().parseFromString(nativeFixture, "text/html");
      const replacement = document.importNode(parsed.body.firstElementChild, true);
      document.body.prepend(replacement);
      AviaryAds.adProtectionFeature.apply(
        globalThis.adFixtureState.context,
        replacement,
        [replacement]
      );
      return {
        route: location.hash,
        native: replacement.querySelector('[data-fixture-item="native-ad"]')
          ?.getAttribute("data-av-ad-hidden"),
        organic: replacement.querySelector('[data-fixture-item="organic-placement"]')
          ?.getAttribute("data-av-ad-hidden"),
        organicDisplay: getComputedStyle(
          replacement.querySelector('[data-fixture-item="organic-placement"]')
        ).display
      };
    }, fixtures.get("native-ad.html"));

    assert.equal(spa.route, "#following");
    assert.equal(spa.native, "post");
    assert.equal(spa.organic, null);
    assert.notEqual(spa.organicDisplay, "none");

    const destroyed = await page.evaluate(() => {
      AviaryAds.adProtectionFeature.destroy(globalThis.adFixtureState.context);
      return {
        rootClass: document.documentElement.classList.contains("av-block-ads"),
        marks: document.querySelectorAll("[data-av-ad-hidden]").length,
        style: document.getElementById("av-ad-protection")
      };
    });
    assert.deepEqual(destroyed, { rootClass: false, marks: 0, style: null });
  } finally {
    await page.close();
  }
});

async function openFixture(name) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript({
    content: `${bundleSource}
globalThis.AviaryAds = AviaryAds;
if (document.documentElement) {
  AviaryAds.installEarlyAdShield();
} else {
  const armAviaryAdShield = new MutationObserver(() => {
    if (!document.documentElement) return;
    armAviaryAdShield.disconnect();
    AviaryAds.installEarlyAdShield();
  });
  armAviaryAdShield.observe(document, { childList: true });
}`
  });
  await page.goto(pathToFileURL(path.join(fixtureRoot, name)).href, { waitUntil: "domcontentloaded" });
  return page;
}

async function appendFixture(page, html) {
  await page.evaluate((source) => {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    const added = document.importNode(parsed.body.firstElementChild, true);
    document.body.append(added);
    AviaryAds.adProtectionFeature.apply(globalThis.adFixtureState.context, added, [added]);
  }, html);
}
