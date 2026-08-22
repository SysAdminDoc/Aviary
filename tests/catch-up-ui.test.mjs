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

/**
 * The non-modal fallback still has to be usable rather than a trap.
 *
 * Without `showModal` a plain `open` attribute carries no dialog semantics, moves no focus, and
 * leaves the page behind it fully tabbable. Both manifest floors ship `showModal`, so this only
 * runs in an embedded host -- but a surface that opens and cannot be navigated is worse than one
 * that does not open. Escape is deliberately not handled: this project registers no keyboard
 * shortcuts, and native `showModal` is what supplies it everywhere it exists.
 */
test("without showModal the digest still declares itself, takes focus, and contains it", async () => {
  const now = Date.now();
  const entries = [
    {
      tweetId: "9500",
      handle: "alice",
      displayName: "Alice",
      text: "A local post",
      permalink: "https://x.com/alice/status/9500",
      articleUrl: null,
      capturedAt: new Date(now - 60_000).toISOString(),
      seenAt: now - 60_000,
      surface: "home",
      category: "original",
      filterReason: null,
      media: [],
      metrics: { replies: 0, likes: 0, reposts: 0 }
    }
  ];

  const state = await page.evaluate(async (items) => {
    document.querySelector("#av-catch-up-dialog")?.remove();
    // The harness page is otherwise empty, and "the page behind the dialog" is the thing under
    // test -- without something there, an inert sweep has nothing to prove.
    const behind = document.createElement("button");
    behind.id = "av-inert-probe";
    behind.textContent = "behind the dialog";
    document.body.append(behind);
    const realShowModal = HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.showModal;
    try {
      AviaryCatchUp.openCatchUpDigest(window.__ctx("en"), items);
      const dialog = document.querySelector("#av-catch-up-dialog");
      const close = dialog.querySelector(".av-catch-up-close");
      const siblingsInert = () =>
        [...document.body.children].filter(
          (node) => node !== dialog && node.hasAttribute("inert")
        ).length;
      const opened = {
        role: dialog.getAttribute("role"),
        modal: dialog.getAttribute("aria-modal"),
        focused: document.activeElement === close,
        // The dialog itself must stay live: a non-modal dialog is not exempt from an inert
        // ancestor, so inerting <body> would kill the very surface being opened.
        dialogInert: dialog.hasAttribute("inert"),
        siblingsInert: siblingsInert()
      };
      close.click();
      // `close()` removes the open attribute synchronously but queues the close event, and the
      // inert sweep is undone by that event's handler. Reading before the task runs measures the
      // moment in between, not the outcome.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { opened, closedSiblingsInert: siblingsInert() };
    } finally {
      HTMLDialogElement.prototype.showModal = realShowModal;
      document.querySelector("#av-catch-up-dialog")?.remove();
      for (const node of [...document.body.children]) node.removeAttribute("inert");
      behind.remove();
    }
  }, entries);

  assert.equal(state.opened.role, "dialog", "the fallback must say what the surface is");
  assert.equal(state.opened.modal, "true");
  assert.equal(state.opened.focused, true, "focus must land on the control that dismisses it");
  assert.equal(state.opened.dialogInert, false, "the dialog itself must stay interactive");
  assert.ok(state.opened.siblingsInert > 0, "Tab must not walk out behind it");
  assert.equal(state.closedSiblingsInert, 0, "and the page must be usable again after closing");
});
