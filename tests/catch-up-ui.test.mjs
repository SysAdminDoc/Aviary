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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-catch-up-ui-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(entry, `export { openCatchUpDigest } from ${JSON.stringify(abs("src/features/filtering/catch-up-ui.ts"))};\n`, "utf8");
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCatchUp",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("catch-up dialog exposes local records and filters without a page request", async () => {
  const now = Date.now();
  const entries = [
    {
      tweetId: "7001",
      handle: "alice",
      displayName: "Alice",
      text: "A visible local post",
      permalink: "https://x.com/alice/status/7001",
      articleUrl: null,
      capturedAt: new Date(now - 10 * 60 * 1000).toISOString(),
      seenAt: now - 10 * 60 * 1000,
      surface: "home",
      category: "original",
      filterReason: null,
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/catchup-ui-test?format=jpg", altText: "preview" }],
      metrics: { replies: 0, likes: 0, reposts: 0 }
    },
    {
      tweetId: "7002",
      handle: "bob",
      displayName: "Bob",
      text: "A filtered local post",
      permalink: "https://x.com/bob/status/7002",
      articleUrl: null,
      capturedAt: new Date(now - 12 * 60 * 1000).toISOString(),
      seenAt: now - 12 * 60 * 1000,
      surface: "home",
      category: "filtered",
      filterReason: "Hidden by your keyword: crypto",
      media: [],
      metrics: { replies: 0, likes: 0, reposts: 0 }
    }
  ];
  const result = await page.evaluate((items) => {
    const baselineRequests = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("graphql")).length;
    const baselineMediaRequests = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("pbs.twimg.com")).length;
    window.__catchUp = AviaryCatchUp.openCatchUpDigest(items);
    const dialog = document.querySelector("#av-catch-up-dialog");
    return {
      count: window.__catchUp.count,
      open: dialog?.hasAttribute("open") ?? false,
      text: dialog?.textContent ?? "",
      requests: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("graphql")).length - baselineRequests,
      mediaRequests: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("pbs.twimg.com")).length - baselineMediaRequests
    };
  }, entries);

  assert.equal(result.count, 1, "all view excludes filtered posts by default");
  assert.equal(result.open, true);
  assert.match(result.text, /A visible local post/);
  assert.doesNotMatch(result.text, /A filtered local post/);
  assert.equal(result.requests, 0, "opening the digest must not originate an X request");
  assert.equal(result.mediaRequests, 0, "opening the digest must not fetch remote media");

  await page.getByRole("button", { name: "Filtered 1" }).click();
  const filtered = await page.locator("#av-catch-up-dialog").textContent();
  assert.match(filtered, /A filtered local post/);
  assert.match(filtered, /Hidden by your keyword: crypto/);
  assert.doesNotMatch(filtered, /A visible local post/);

  await page.getByRole("button", { name: "Close catch-up" }).click();
  await page.locator("#av-catch-up-dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator("#av-catch-up-dialog").count(), 0);
});
