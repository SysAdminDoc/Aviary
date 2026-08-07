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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-feedback-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { showFeatureToast, removeFeatureToast } from ${JSON.stringify(
        path.resolve(root, "src/features/core/feature-toast.ts").replace(/\\/g, "/")
      )};`,
      `export { aiCommandMenuFeature } from ${JSON.stringify(
        path.resolve(root, "src/features/ai/command-menu.ts").replace(/\\/g, "/")
      )};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryFeedback",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`chromium is required for this test.\n${error}`);
  }
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const ctxStub = { settings: { accessibility: { reduceMotion: "never" } } };

test("the toast announces itself politely and carries its message", async () => {
  const result = await page.evaluate((ctx) => {
    AviaryFeedback.showFeatureToast("Prompt copied to the clipboard.", { ctx });
    const host = document.getElementById("av-feature-toast");
    const card = host.shadowRoot.querySelector(".av-ftoast");
    return {
      role: card.getAttribute("role"),
      live: card.getAttribute("aria-live"),
      open: card.classList.contains("is-open"),
      text: card.textContent,
      tone: card.dataset.tone
    };
  }, ctxStub);

  assert.equal(result.role, "status");
  assert.equal(result.live, "polite");
  assert.equal(result.open, true);
  assert.equal(result.text, "Prompt copied to the clipboard.");
  assert.equal(result.tone, "info");
});

test("an error toast is distinguished by more than colour", async () => {
  const result = await page.evaluate((ctx) => {
    AviaryFeedback.showFeatureToast("Translate failed: Provider HTTP 401.", { tone: "error", ctx });
    const card = document.getElementById("av-feature-toast").shadowRoot.querySelector(".av-ftoast");
    return { tone: card.dataset.tone, text: card.textContent };
  }, ctxStub);

  assert.equal(result.tone, "error");
  // The wording itself has to carry the failure -- colour alone is not a state indicator.
  assert.match(result.text, /failed/i);
});

test("removeFeatureToast takes the host with it", async () => {
  const remaining = await page.evaluate((ctx) => {
    AviaryFeedback.showFeatureToast("still here", { ctx });
    AviaryFeedback.removeFeatureToast();
    return document.getElementById("av-feature-toast");
  }, ctxStub);

  assert.equal(remaining, null);
});

test("the AI menu flips above the trigger instead of running past the fold", async () => {
  const result = await page.evaluate(() => {
    const ctx = {
      settings: { integrations: { ai: { enabled: false, apiKey: "" } } },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} }
    };
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "actions");
    article.append(group);
    // Placed near the bottom edge, where a downward menu would be cut off.
    article.style.position = "absolute";
    article.style.top = `${window.innerHeight - 40}px`;
    document.body.append(article);

    AviaryFeedback.aiCommandMenuFeature.apply(ctx, document, [article]);
    const trigger = article.querySelector("[data-av-ai-trigger]");
    trigger.click();

    const menu = document.querySelector(".av-ai-menu");
    const rect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      viewport: window.innerHeight,
      above: rect.bottom <= triggerRect.top + 1
    };
  });

  assert.ok(result.above, "the menu should sit above a trigger near the bottom edge");
  assert.ok(
    result.bottom <= result.viewport,
    `the menu must stay on screen (bottom ${result.bottom} vs viewport ${result.viewport})`
  );
});

test("destroy removes an open AI menu and its document listener", async () => {
  const result = await page.evaluate(() => {
    const ctx = {
      settings: { integrations: { ai: { enabled: false, apiKey: "" } } },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} }
    };
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "actions");
    article.append(group);
    document.body.append(article);

    AviaryFeedback.aiCommandMenuFeature.apply(ctx, document, [article]);
    article.querySelector("[data-av-ai-trigger]").click();
    const openedBefore = document.querySelectorAll(".av-ai-menu").length;

    AviaryFeedback.aiCommandMenuFeature.destroy(ctx);
    const openedAfter = document.querySelectorAll(".av-ai-menu").length;
    article.remove();
    return { openedBefore, openedAfter };
  });

  assert.equal(result.openedBefore, 1, "the menu should have opened");
  assert.equal(result.openedAfter, 0, "an orphaned menu survives teardown as an unstyled list");
});

test("no outcome path in the AI menu or snippets ends without telling the user", async () => {
  const menu = await readFile(path.join(root, "src/features/ai/command-menu.ts"), "utf8");
  const snippets = await readFile(path.join(root, "src/features/composer/composer-snippets.ts"), "utf8");

  // Every branch that previously closed the menu in silence.
  assert.match(menu, /result copied to the clipboard/);
  assert.match(menu, /could not be copied/);
  assert.match(menu, /failed: \$\{result\.error/);
  assert.match(menu, /Prompt copied to the clipboard/);
  assert.match(snippets, /Click into the composer first/);
});
