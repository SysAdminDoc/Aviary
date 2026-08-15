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

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-rules-fixture-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { compileRules, evaluateRules } from ${JSON.stringify(abs("src/features/filtering/rules.ts"))};
export { extractTweetSignal } from ${JSON.stringify(abs("src/features/filtering/predicates.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryRules",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  // The captured home timeline is the only ground truth for X's DOM in this repository.
  await page.goto(`file://${abs("_decoded/home.html")}`);
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("signals extracted from the real capture carry every field the rules can read", async () => {
  const summary = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const signals = articles.map((article) => AviaryRules.extractTweetSignal(article));
    return {
      posts: signals.length,
      withHandle: signals.filter((signal) => signal.handle !== null).length,
      withText: signals.filter((signal) => signal.text.trim().length > 0).length,
      withPhoto: signals.filter((signal) => signal.media.photo).length,
      withVideo: signals.filter((signal) => signal.media.video).length,
      withLink: signals.filter((signal) => signal.hasLink).length,
      verified: signals.filter((signal) => signal.premium).length
    };
  });

  assert.ok(summary.posts > 0, "the capture must contain posts to filter");
  assert.ok(summary.withHandle > 0, "handles must be readable from the capture");
  assert.ok(summary.withText > 0, "post text must be readable from the capture");
  assert.ok(summary.withPhoto > 0, "the capture is known to contain photos");
});

test("a rule written against the capture hides exactly the posts it names", async () => {
  const result = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const signals = articles.map((article) => AviaryRules.extractTweetSignal(article));
    const target = signals.find((signal) => signal.handle !== null);
    if (!target) return { ok: false };

    const { rules, errors } = AviaryRules.compileRules([`handle is ${target.handle}`]);
    const decisions = signals.map((signal) => AviaryRules.evaluateRules(signal, rules));
    return {
      ok: true,
      errors,
      handle: target.handle,
      hidden: decisions.filter((decision) => decision === "hide").length,
      expected: signals.filter((signal) => signal.handle === target.handle).length,
      shown: decisions.filter((decision) => decision === "show").length
    };
  });

  assert.equal(result.ok, true, "the capture must expose at least one readable handle");
  assert.deepEqual(result.errors, []);
  assert.equal(result.hidden, result.expected, "only that author's posts may be hidden");
  assert.ok(result.shown > 0, "other posts in the capture must survive");
});

test("a media rule matches the capture's photo posts and leaves text-only posts alone", async () => {
  const result = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const signals = articles.map((article) => AviaryRules.extractTweetSignal(article));
    const { rules } = AviaryRules.compileRules(["media is photo"]);
    const decisions = signals.map((signal) => AviaryRules.evaluateRules(signal, rules));
    return {
      hidden: decisions.filter((decision) => decision === "hide").length,
      photos: signals.filter((signal) => signal.media.photo).length
    };
  });

  assert.equal(result.hidden, result.photos);
  assert.ok(result.photos > 0, "the capture is known to contain photo posts");
});
