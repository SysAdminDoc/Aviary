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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-following-"));

  // Bundled and evaluated in a real browser rather than stubbed: the point of this feature is
  // that it finds the right node in X's own captured markup, which no hand-written stub proves.
  const bundle = path.join(temp, "bundle.js");
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { findFollowingTab, shouldSelectFollowing, forceFollowingFeature } from ${JSON.stringify(
      path.resolve(root, "src/features/layout/force-following.ts").replace(/\\/g, "/")
    )};`,
    "utf8"
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryFollowing",
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
  await page.goto(pathToFileURL(path.join(root, "_decoded/home.html")).href);
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the captured home strip still has For you first and Following second", async () => {
  const labels = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"][data-testid="ScrollSnap-List"]');
    return [...list.querySelectorAll('[role="tab"]')].map((tab) => ({
      text: tab.textContent.trim(),
      selected: tab.getAttribute("aria-selected")
    }));
  });

  // The assumption the feature rests on. If X ever reorders these, this fails before the feature
  // starts clicking the wrong tab.
  assert.deepEqual(
    labels.map((entry) => entry.text),
    ["For you", "Following"]
  );
  assert.equal(labels[0].selected, "true", "the capture is on For you, so there is work to do");
});

test("findFollowingTab picks the Following tab out of the real capture", async () => {
  const found = await page.evaluate(() => {
    const tab = AviaryFollowing.findFollowingTab(document);
    return tab ? { text: tab.textContent.trim(), should: AviaryFollowing.shouldSelectFollowing(tab) } : null;
  });

  assert.ok(found, "no tab found in the captured home timeline");
  assert.equal(found.text, "Following");
  assert.equal(found.should, true, "an unselected tab must be reported as needing selection");
});

test("an already-selected Following tab is left alone", async () => {
  const should = await page.evaluate(() => {
    const tab = AviaryFollowing.findFollowingTab(document);
    const previous = tab.getAttribute("aria-selected");
    tab.setAttribute("aria-selected", "true");
    const result = AviaryFollowing.shouldSelectFollowing(tab);
    tab.setAttribute("aria-selected", previous);
    return result;
  });

  assert.equal(should, false, "re-clicking a selected tab would fight the viewer");
});

test("a tablist with fewer than two tabs is not treated as the home strip", async () => {
  const found = await page.evaluate(() => {
    const host = document.createElement("div");
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    list.dataset.testid = "ScrollSnap-List";
    const tab = document.createElement("div");
    tab.setAttribute("role", "tab");
    tab.textContent = "Only one";
    list.append(tab);
    host.append(list);
    return AviaryFollowing.findFollowingTab(host);
  });

  // Profile and search render tablists too; a one-tab strip is not the home timeline.
  assert.equal(found, null);
});

test("apply() selects Following once, then leaves a manual switch back alone", async () => {
  const result = await page.evaluate(async () => {
    // The captured fixture is frozen React output with no handlers, so the tab strip is rebuilt
    // here with the one behaviour that matters: clicking a tab moves aria-selected.
    const host = document.createElement("div");
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    list.dataset.testid = "ScrollSnap-List";
    const tabs = ["For you", "Following"].map((label) => {
      const tab = document.createElement("div");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", label === "For you" ? "true" : "false");
      tab.textContent = label;
      tab.addEventListener("click", () => {
        for (const other of tabs) other.setAttribute("aria-selected", "false");
        tab.setAttribute("aria-selected", "true");
      });
      list.append(tab);
      return tab;
    });
    host.append(list);
    document.body.append(host);

    const selected = () => tabs.find((tab) => tab.getAttribute("aria-selected") === "true").textContent;
    const ctx = (href) => ({
      settings: { layout: { forceFollowing: true } },
      route: { surface: "home", href },
      diagnostics: { info() {}, error() {} }
    });

    const feature = AviaryFollowing.forceFollowingFeature;
    feature.init(ctx("https://x.com/home"));

    feature.apply(ctx("https://x.com/home"), host);
    const afterFirst = selected();

    // The viewer deliberately goes back to For you; further mutation batches must not undo that.
    tabs[0].click();
    feature.apply(ctx("https://x.com/home"), host);
    feature.apply(ctx("https://x.com/home"), host);
    const afterManualSwitch = selected();

    // Leaving and returning to the timeline is a new visit, so the preference reasserts.
    feature.apply(ctx("https://x.com/home?src=nav"), host);
    const afterReturn = selected();

    // A non-home surface is never touched.
    tabs[0].click();
    feature.apply(
      { ...ctx("https://x.com/explore"), route: { surface: "search", href: "https://x.com/explore" } },
      host
    );
    const afterOtherSurface = selected();

    host.remove();
    return { afterFirst, afterManualSwitch, afterReturn, afterOtherSurface };
  });

  assert.equal(result.afterFirst, "Following", "apply() must select Following on arrival");
  assert.equal(result.afterManualSwitch, "For you", "a manual switch back must survive");
  assert.equal(result.afterReturn, "Following", "returning to the timeline reasserts");
  assert.equal(result.afterOtherSurface, "For you", "other surfaces are not touched");
});

test("the feature only acts on the home surface and only once per visit", async () => {
  const source = await readFileUtf8("src/features/layout/force-following.ts");

  assert.match(source, /ctx\.route\.surface !== "home"/);
  assert.match(source, /assertedForHref === ctx\.route\.href/);
  // Selecting a tab is not reversible by re-selecting the other one; destroy must not navigate.
  const destroy = source.slice(source.indexOf("destroy(ctx"));
  assert.ok(!/\.click\(\)/.test(destroy), "destroy must not click anything");
});

async function readFileUtf8(relativePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path.join(root, relativePath), "utf8");
}
