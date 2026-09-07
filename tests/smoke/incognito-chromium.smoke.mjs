// Isolated Chromium proof for the extension's private-window policy.
//
// Playwright's isolated non-persistent context models a private window. With
// incognito: not_allowed, Chrome leaves the extension unavailable in that window, so the page
// must not receive Aviary's document-start marker or create any Aviary storage keys.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionDir = path.join(root, "dist", "extension-chrome");
const fixturePath = path.join(root, "tests", "smoke", "current-x-home.html");

if (!existsSync(extensionDir)) {
  console.error("Build the extension first: `npm run build`.");
  process.exit(2);
}

const fixtureHtml = await readFile(fixturePath, "utf8");
const browserArgs = [
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  "--no-sandbox"
];
let browser;
let context;

try {
  browser = await chromium.launch({ headless: false, args: ["--headless=new", ...browserArgs] });
  // Playwright's non-persistent context is an isolated private browser context. Chromium does not
  // attach extensions to it, which is the runtime shape required by incognito: not_allowed.
  context = await browser.newContext();
  await context.route("https://x.com/incognito-smoke**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: fixtureHtml
    })
  );
  const page = await context.newPage();
  await page.goto("https://x.com/incognito-smoke");
  await page.waitForTimeout(750);
  const state = await page.evaluate(async () => ({
    ready: document.documentElement.dataset.avReady ?? null,
    local: Object.keys(localStorage).filter((key) => key.startsWith("aviary.")),
    session: Object.keys(sessionStorage).filter((key) => key.startsWith("aviary.")),
    databases: (await indexedDB.databases())
      .map((database) => database.name ?? "")
      .filter((name) => name.startsWith("aviary."))
  }));
  assert.notEqual(state.ready, "true", "Aviary booted in a private window");
  assert.deepEqual(context.serviceWorkers(), [], "the extension started a private-window worker");
  assert.deepEqual(state.local, [], "private-window localStorage contains Aviary keys");
  assert.deepEqual(state.session, [], "private-window sessionStorage contains Aviary keys");
  assert.deepEqual(state.databases, [], "private-window IndexedDB contains Aviary databases");
  console.log("[incognito-smoke] extension unavailable and no Aviary page storage changed.");
} finally {
  await context?.close();
  await browser?.close();
}
