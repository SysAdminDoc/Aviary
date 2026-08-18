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

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-inline-img-"));
  const bundle = path.join(temp, "bundle.js");
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { upgradeImage, restoreImage, inlineOriginalImagesFeature } from ${JSON.stringify(
        path.resolve(root, "src/features/media/inline-original-images.ts").split(path.sep).join("/")
      )}`,
      `export { DEFAULT_SETTINGS } from ${JSON.stringify(
        path.resolve(root, "src/platform/settings.ts").split(path.sep).join("/")
      )}`
    ].join(";\n"),
    "utf8"
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryImages",
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
  page = await browser.newPage();
  // Requests are blocked so the test never actually fetches from pbs.twimg.com; the assertions
  // are about the attribute the browser would fetch, not about the bytes.
  await page.route("**://pbs.twimg.com/**", (route) => route.abort());
  await page.goto(pathToFileURL(path.join(root, "_decoded/home.html")).href);
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the captured timeline still serves photos at a slot size, not orig", async () => {
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll('img[src*="pbs.twimg.com/media"]')].map((img) =>
      img.getAttribute("src")
    )
  );

  assert.ok(srcs.length > 0, "the capture has no timeline photos to upgrade");
  assert.ok(
    srcs.some((src) => /name=\d+x\d+|name=(small|medium|large)/.test(src)),
    `expected a slot-sized photo, saw ${JSON.stringify(srcs)}`
  );
});

test("upgradeImage rewrites a captured photo to name=orig and is reversible", async () => {
  const result = await page.evaluate(() => {
    const img = document.querySelector('img[src*="pbs.twimg.com/media"]');
    const before = img.getAttribute("src");
    const changed = AviaryImages.upgradeImage(img);
    const after = img.getAttribute("src");
    AviaryImages.restoreImage(img);
    return { before, changed, after, restored: img.getAttribute("src") };
  });

  assert.equal(result.changed, true);
  assert.match(result.after, /[?&]name=orig(&|$)/);
  assert.match(result.after, /[?&]format=jpg(&|$)/, "the served format must be kept");
  assert.equal(result.restored, result.before, "destroy must put the original URL back");
});

test("a srcset would out-rank the upgraded src, so it is removed and restored", async () => {
  const result = await page.evaluate(() => {
    const img = document.createElement("img");
    img.setAttribute("src", "https://pbs.twimg.com/media/ABC123def?format=jpg&name=900x900");
    img.setAttribute("srcset", "https://pbs.twimg.com/media/ABC123def?format=jpg&name=small 1x");
    AviaryImages.upgradeImage(img);
    const during = img.getAttribute("srcset");
    AviaryImages.restoreImage(img);
    return { during, after: img.getAttribute("srcset"), src: img.getAttribute("src") };
  });

  assert.equal(result.during, null, "srcset must be cleared or the browser ignores the new src");
  assert.equal(
    result.after,
    "https://pbs.twimg.com/media/ABC123def?format=jpg&name=small 1x",
    "the original srcset must come back"
  );
  assert.match(result.src, /name=900x900/);
});

test("an original-quality URL that fails to load reverts to the one X served", async () => {
  const result = await page.evaluate(async () => {
    const img = document.createElement("img");
    // Both URLs are aborted by the test's route handler, so the upgraded one fires `error`
    // exactly as a missing `orig` rendition would on the live site.
    const served = "https://pbs.twimg.com/media/FailMe404?format=jpg&name=900x900";
    img.setAttribute("src", served);
    document.body.append(img);

    AviaryImages.upgradeImage(img);
    const upgraded = img.getAttribute("src");

    await new Promise((resolve) => setTimeout(resolve, 250));
    const settled = img.getAttribute("src");
    img.remove();
    return { served, upgraded, settled };
  });

  assert.match(result.upgraded, /name=orig/, "the upgrade must have been attempted");
  assert.equal(
    result.settled,
    result.served,
    "a failed original-quality load must fall back, not leave a broken image"
  );
});

test("non-timeline images and already-original URLs are left alone", async () => {
  const results = await page.evaluate(() => {
    const make = (src) => {
      const img = document.createElement("img");
      img.setAttribute("src", src);
      return img;
    };
    const profile = make("https://pbs.twimg.com/profile_images/1/avatar_normal.jpg");
    const already = make("https://pbs.twimg.com/media/ABC123def?format=jpg&name=orig");
    const foreign = make("https://example.com/media/photo.jpg?name=small");
    return {
      profile: AviaryImages.upgradeImage(profile),
      already: AviaryImages.upgradeImage(already),
      foreign: AviaryImages.upgradeImage(foreign),
      foreignSrc: foreign.getAttribute("src")
    };
  });

  assert.equal(results.profile, false, "avatars are not under /media/ and must not be rewritten");
  assert.equal(results.already, false, "an already-original URL is not a change");
  assert.equal(results.foreign, false, "only pbs.twimg.com is ours to rewrite");
  assert.equal(results.foreignSrc, "https://example.com/media/photo.jpg?name=small");
});

test("mutation scans only media images and clears stale non-media markers", async () => {
  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    const make = (src) => {
      const img = document.createElement("img");
      img.setAttribute("src", src);
      return img;
    };
    const avatar = make("https://pbs.twimg.com/profile_images/1/avatar_normal.jpg");
    const emoji = make("https://abs.twimg.com/emoji/v2/72x72/1f600.png");
    const card = make("https://pbs.twimg.com/card-icon.png");
    const photo = make("https://pbs.twimg.com/media/MutationPhoto?format=jpg&name=small");
    const stale = make("https://pbs.twimg.com/profile_images/2/stale_normal.jpg?name=orig");
    stale.setAttribute("data-av-orig-image", "1");
    stale.dataset.avOriginalSrc = "https://pbs.twimg.com/profile_images/2/stale_normal.jpg";
    stale.dataset.avOriginalSrcset =
      "https://pbs.twimg.com/profile_images/2/stale_normal.jpg 1x";
    stale.removeAttribute("srcset");
    host.append(avatar, emoji, card, photo, stale);

    const ctx = {
      settings: { media: { inlineOriginalImages: true } },
      diagnostics: { info() {}, error() {} }
    };
    AviaryImages.inlineOriginalImagesFeature.apply(ctx, host, [
      avatar,
      emoji,
      card,
      photo,
      stale
    ]);

    const during = [...host.querySelectorAll("img")].map((img) => ({
      src: img.getAttribute("src"),
      srcset: img.getAttribute("srcset"),
      marker: img.getAttribute("data-av-orig-image")
    }));
    host.remove();
    return during;
  });

  assert.equal(result.length, 5);
  for (const index of [0, 1, 2]) {
    assert.equal(result[index].marker, null, "non-media images must not be marked");
  }
  assert.match(result[3].src, /name=orig/, "tweet media should be upgraded");
  assert.equal(result[3].marker, "1");
  assert.equal(result[4].src, "https://pbs.twimg.com/profile_images/2/stale_normal.jpg");
  assert.equal(
    result[4].srcset,
    "https://pbs.twimg.com/profile_images/2/stale_normal.jpg 1x",
    "stale state should be restored before the next scan"
  );
  assert.equal(result[4].marker, null, "stale non-media markers must be removed");
});

test("the feature is off by default and reverses every image it touched", async () => {
  // The default is a value, not a line: read it from the object every install starts with.
  const defaults = await page.evaluate(() => AviaryImages.DEFAULT_SETTINGS.media.inlineOriginalImages);
  assert.equal(
    defaults,
    false,
    "full-size images cost bandwidth on every scroll, so this has to be opt-in"
  );

  const result = await page.evaluate(() => {
    const host = document.createElement("div");
    for (const name of ["900x900", "small"]) {
      const img = document.createElement("img");
      img.setAttribute("src", `https://pbs.twimg.com/media/Zz${name}?format=jpg&name=${name}`);
      host.append(img);
    }
    document.body.append(host);

    const ctx = (on) => ({
      settings: { media: { inlineOriginalImages: on } },
      diagnostics: { info() {}, error() {} }
    });
    const feature = AviaryImages.inlineOriginalImagesFeature;
    feature.apply(ctx(true), host);
    const upgraded = [...host.querySelectorAll("img")].map((i) => i.getAttribute("src"));

    feature.destroy(ctx(true));
    const restored = [...host.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    const leftovers = [...host.querySelectorAll("img")].filter((i) =>
      [...i.attributes].some((a) => a.name.startsWith("data-av"))
    ).length;

    host.remove();
    return { upgraded, restored, leftovers };
  });

  assert.ok(
    result.upgraded.every((src) => /name=orig/.test(src)),
    `every photo should have been upgraded, saw ${JSON.stringify(result.upgraded)}`
  );
  assert.ok(
    result.restored.every((src) => !/name=orig/.test(src)),
    `every photo should have been restored, saw ${JSON.stringify(result.restored)}`
  );
  assert.equal(result.leftovers, 0, "no data-av-* attribute may survive destroy");
});
