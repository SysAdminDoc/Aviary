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
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-inline-img-"));
  const bundle = path.join(temp, "bundle.js");
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { upgradeImage, restoreImage, inlineOriginalImagesFeature } from ${JSON.stringify(
      path.resolve(root, "src/features/media/inline-original-images.ts").replace(/\\/g, "/")
    )};`,
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

test("the feature is off by default and reverses every image it touched", async () => {
  const settings = await readFile(path.join(root, "src/platform/settings.ts"), "utf8");
  assert.match(settings, /inlineOriginalImages: false/, "full-size images cost bandwidth: opt in");

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
