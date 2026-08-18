import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { readI18nManifest } from "./helpers/i18n-manifest.mjs";
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
      )};`,
      `export { setLocalOnlyPolicy, resetLocalOnlyPolicy } from ${JSON.stringify(
        path.resolve(root, "src/features/integrations/network-policy.ts").replace(/\\/g, "/")
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
      settings: {
        ai: { commandMenu: true },
        integrations: { ai: { enabled: false, apiKey: "" } },
        i18n: { locale: "en" }
      },
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
      settings: {
        ai: { commandMenu: true },
        integrations: { ai: { enabled: false, apiKey: "" } },
        i18n: { locale: "en" }
      },
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

test("a local-only AI refusal closes cleanly and restores the command item", async () => {
  const result = await page.evaluate(async () => {
    const ctx = {
      settings: {
        ai: { commandMenu: true },
        integrations: {
          ai: { enabled: true, apiKey: "key", model: "model", provider: "openai", endpoint: "" }
        },
        i18n: { locale: "en" },
        accessibility: { reduceMotion: "never" }
      },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} }
    };
    AviaryFeedback.setLocalOnlyPolicy(() => true);
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const text = document.createElement("div");
    text.setAttribute("data-testid", "tweetText");
    text.textContent = "A local-only test post";
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "actions");
    article.append(text, group);
    document.body.append(article);
    AviaryFeedback.aiCommandMenuFeature.apply(ctx, document, [article]);
    article.querySelector("[data-av-ai-trigger]").click();
    const item = document.querySelector(".av-ai-option");
    item.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const toast = document.querySelector("#av-feature-toast")?.shadowRoot?.querySelector(".av-ftoast-text")?.textContent ?? "";
    const state = { menuCount: document.querySelectorAll(".av-ai-menu").length, disabled: item.disabled, text: item.textContent, toast };
    AviaryFeedback.aiCommandMenuFeature.destroy(ctx);
    article.remove();
    AviaryFeedback.resetLocalOnlyPolicy();
    return state;
  });

  assert.equal(result.menuCount, 0);
  assert.equal(result.disabled, false);
  assert.match(result.text, /Run with provider/);
  assert.match(result.toast, /local-only mode/i);
});

test("an external AI request shows its disclosure before the first fetch", async () => {
  const result = await page.evaluate(async () => {
    const ctx = {
      settings: {
        ai: { commandMenu: true },
        integrations: {
          ai: {
            enabled: true,
            apiKey: "key",
            model: "model",
            provider: "openai",
            endpoint: "https://provider.example.test/v1/chat/completions",
            maxRequestBytes: 32000,
            dailyRequestBytes: 1000000
          }
        },
        i18n: { locale: "en" },
        accessibility: { reduceMotion: "never" }
      },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      integrationUsage: {
        snapshot() {
          return {
            day: "2026-08-12",
            historyDays: 31,
            ai: { requests: 0, bytes: 0 },
            embedding: { requests: 0, records: 0, bytes: 0 }
          };
        },
        async reserveAi(requestBytes) {
          return {
            allowed: true,
            kind: "ai",
            requestBytes,
            usedBytes: requestBytes,
            dailyLimitBytes: 1000000
          };
        }
      }
    };
    AviaryFeedback.setLocalOnlyPolicy(() => false);
    let fetchCalls = 0;
    const originalFetch = window.fetch;
    window.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: "done" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const text = document.createElement("div");
    text.setAttribute("data-testid", "tweetText");
    text.textContent = "A disclosure test post";
    const group = document.createElement("div");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "actions");
    article.append(text, group);
    document.body.append(article);
    AviaryFeedback.aiCommandMenuFeature.apply(ctx, document, [article]);
    article.querySelector("[data-av-ai-trigger]").click();
    document.querySelector(".av-ai-option").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const review = document.querySelector(".av-ai-review");
    const beforeSend = {
      fetchCalls,
      text: review.textContent,
      sendDisabled: review.querySelector(".av-ai-review-send").disabled
    };
    review.querySelector(".av-ai-review-send").click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const afterSend = fetchCalls;
    window.fetch = originalFetch;
    AviaryFeedback.aiCommandMenuFeature.destroy(ctx);
    article.remove();
    AviaryFeedback.resetLocalOnlyPolicy();
    return { beforeSend, afterSend };
  });

  assert.equal(result.beforeSend.fetchCalls, 0);
  assert.equal(result.beforeSend.sendDisabled, false);
  assert.match(result.beforeSend.text, /provider\.example\.test/);
  assert.match(result.beforeSend.text, /user prompt/i);
  assert.equal(result.afterSend, 1);
});

test("every outcome the AI menu and snippets can reach is copy the user will actually see", async () => {
  // These were `assert.match(source, /result copied to the clipboard\./)`. A literal in a file is
  // not a sentence anyone sees: it can sit in a branch nothing reaches, or in a string the
  // translator never receives, in which case it ships in English for every locale. The extractor
  // walks the rendered surfaces and records what reached `ft()`, so requiring each outcome to be
  // in its manifest is the claim that matters -- reachable, translatable copy.
  const manifest = await readI18nManifest(root);

  const OUTCOMES = [
    "result copied to the clipboard.",
    "could not be copied",
    "the provider did not respond",
    "Prompt copied to the clipboard",
    "Click into the composer first"
  ];

  const missing = OUTCOMES.filter((outcome) => !manifest.manifest.some((line) => line.includes(outcome)));
  assert.deepEqual(missing, [], "these outcomes end without copy the user can read in their language");
});
