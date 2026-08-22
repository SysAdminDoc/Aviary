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
    window.__ctx = (locale) => ({
      settings: { i18n: { locale } },
      route: { surface: "home", href: "https://x.com/home", path: "/home" },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      requestApply() {}
    });
    window.__catchUp = AviaryCatchUp.openCatchUpDigest(window.__ctx("en"), items);
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

/**
 * Filtering the digest must not take focus away from the control being used.
 *
 * Every change rebuilt the whole dialog with `replaceChildren`, which removed the select, checkbox
 * or chip the reader had just operated. Focus fell back to the dialog root and the next Tab
 * restarted from the top of the modal, so filtering was effectively mouse-only.
 */
test("changing a filter keeps focus on the control that changed it", async () => {
  const now = Date.now();
  const entries = [
    {
      tweetId: "8001",
      handle: "alice",
      displayName: "Alice",
      text: "A local post",
      permalink: "https://x.com/alice/status/8001",
      articleUrl: null,
      capturedAt: new Date(now - 5 * 60 * 1000).toISOString(),
      seenAt: now - 5 * 60 * 1000,
      surface: "home",
      category: "original",
      filterReason: null,
      media: [],
      metrics: { replies: 0, likes: 0, reposts: 0 }
    }
  ];

  const focus = await page.evaluate((items) => {
    document.querySelector("#av-catch-up-dialog")?.remove();
    AviaryCatchUp.openCatchUpDigest(window.__ctx("en"), items);
    const dialog = document.querySelector("#av-catch-up-dialog");

    const sort = dialog.querySelector('select[aria-label="Sort"]');
    sort.focus();
    sort.value = "oldest";
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    const afterSort = document.activeElement === sort && sort.isConnected;

    const chip = [...dialog.querySelectorAll(".av-catch-up-filter")].find((node) =>
      node.textContent.startsWith("Replies")
    );
    chip.focus();
    chip.click();
    const afterChip = document.activeElement === chip && chip.isConnected;

    const summaryRole = dialog.querySelector(".av-catch-up-summary")?.getAttribute("role") ?? null;
    const pressed = chip.getAttribute("aria-pressed");
    dialog.remove();
    return { afterSort, afterChip, summaryRole, pressed };
  }, entries);

  assert.equal(focus.afterSort, true, "the Sort select must survive its own change");
  assert.equal(focus.afterChip, true, "a category chip must survive its own click");
  assert.equal(focus.pressed, "true", "and still report itself pressed");
  assert.equal(focus.summaryRole, "status", "the changing count must be announced");
});

/**
 * The digest was the only injected surface with no translation at all: it assigned every string
 * straight to `textContent`, so it rendered in English beside a fully translated Control Center.
 */
test("the digest renders in the reader's locale", async () => {
  const now = Date.now();
  const entries = [
    {
      tweetId: "9001",
      handle: "alice",
      displayName: "Alice",
      text: "A local post",
      permalink: "https://x.com/alice/status/9001",
      articleUrl: null,
      capturedAt: new Date(now - 5 * 60 * 1000).toISOString(),
      seenAt: now - 5 * 60 * 1000,
      surface: "home",
      category: "original",
      filterReason: null,
      media: [],
      metrics: { replies: 0, likes: 0, reposts: 0 }
    }
  ];

  const rendered = await page.evaluate((items) => {
    const out = {};
    for (const locale of ["en", "ja", "ar"]) {
      document.querySelector("#av-catch-up-dialog")?.remove();
      AviaryCatchUp.openCatchUpDigest(window.__ctx(locale), items);
      const dialog = document.querySelector("#av-catch-up-dialog");
      out[locale] = {
        title: dialog.querySelector("#av-catch-up-title")?.textContent ?? "",
        close: dialog.querySelector(".av-catch-up-close")?.getAttribute("aria-label") ?? "",
        firstChip: dialog.querySelector(".av-catch-up-filter")?.textContent ?? ""
      };
      dialog.remove();
    }
    return out;
  }, entries);

  for (const locale of ["ja", "ar"]) {
    for (const [key, value] of Object.entries(rendered[locale])) {
      assert.ok(value, `${locale}.${key} did not render`);
      assert.notEqual(
        value,
        rendered.en[key],
        `${locale}.${key} is still English: ${value}`
      );
    }
  }
});
