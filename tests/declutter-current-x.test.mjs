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
  temp = await mkdtemp(path.join(tmpdir(), "aviary-current-declutter-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { layoutDeclutterFeature } from ${JSON.stringify(abs("src/features/layout/declutter.ts"))};
export { DEFAULT_SETTINGS, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryDeclutter",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("current Home declutter controls collapse complete modules and restore every surface", async () => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = `
      <nav aria-label="Primary">
        <a id="home" data-testid="AppTabBar_Home_Link" href="/home">Home</a>
        <a id="follow" data-testid="AppTabBar_Follow_Link" href="/i/connect_people">Follow</a>
        <a id="chat-nav" data-testid="AppTabBar_DirectMessage_Link" href="/i/chat">Chat</a>
        <a id="grok-nav" href="/i/grok">Grok</a>
        <a id="history" href="/i/history">History</a>
        <a id="studio" href="/i/jf/creators/studio">Creator Studio</a>
        <a id="premium" data-testid="premium-signup-tab" href="/i/premium_sign_up">Premium</a>
      </nav>
      <main data-testid="primaryColumn">
        <div aria-label="Home timeline">
          <div id="home-composer">
            <div data-testid="tweetTextarea_0" role="textbox"></div>
            <div data-testid="toolBar"><button data-testid="tweetButtonInline">Post</button></div>
          </div>
          <section id="organic-feed"><article data-testid="tweet">Organic post</article></section>
        </div>
      </main>
      <aside data-testid="sidebarColumn">
        <div id="news-module">
          <div data-testid="news_sidebar"></div>
          <div><div role="link" data-testid="news_sidebar_article_fixture">Synthetic news</div></div>
        </div>
        <section id="trends-module"><div role="link" data-testid="trend">Synthetic trend</div></section>
        <aside id="follow-suggestions" role="complementary">
          <a href="/i/connect_people?user_id=fixture">Show more</a>
        </aside>
        <aside id="grok-promo" role="complementary">
          <a href="https://grok.com/imagine?referrer=x_grok_sidebar">Try for free</a>
        </aside>
      </aside>
      <aside id="grok-drawer" data-testid="GrokDrawer"></aside>
      <aside id="chat-drawer" data-testid="chat-drawer-root"></aside>
      <button id="grok-action" aria-label="Grok actions">Grok</button>
    `;

    const settings = AviaryDeclutter.normalizeSettings({
      layout: {
        hideRightSidebar: false,
        hideTrends: true,
        hideFollowSuggestions: true,
        hideHomeComposer: true,
        hideGrok: true,
        hideNavItems: ["follow", "chat", "grok", "history", "studio", "premium"]
      }
    });
    const context = {
      route: { href: "https://x.com/home", path: "/home", surface: "home" },
      settings,
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    const feature = AviaryDeclutter.layoutDeclutterFeature;
    feature.init(context);

    const display = (id) => getComputedStyle(document.getElementById(id)).display;
    const hidden = Object.fromEntries(
      [
        "news-module",
        "trends-module",
        "follow-suggestions",
        "home-composer",
        "grok-promo",
        "grok-drawer",
        "chat-drawer",
        "grok-action",
        "follow",
        "chat-nav",
        "grok-nav",
        "history",
        "studio",
        "premium",
        "home",
        "organic-feed"
      ].map((id) => [id, display(id)])
    );

    context.route = { href: "https://x.com/fixture/status/1", path: "/fixture/status/1", surface: "status" };
    feature.apply(context, document);
    const composerOnStatus = display("home-composer");

    Object.assign(settings.layout, {
      hideTrends: false,
      hideFollowSuggestions: false,
      hideHomeComposer: false,
      hideGrok: false,
      hideNavItems: []
    });
    feature.apply(context, document);
    const restored = Object.fromEntries(
      [
        "news-module",
        "trends-module",
        "follow-suggestions",
        "home-composer",
        "grok-promo",
        "grok-drawer",
        "chat-drawer",
        "grok-action",
        "follow",
        "chat-nav",
        "grok-nav",
        "history",
        "studio",
        "premium"
      ].map((id) => [id, display(id)])
    );

    await feature.destroy(context);
    return {
      defaults: {
        hideFollowSuggestions: AviaryDeclutter.DEFAULT_SETTINGS.layout.hideFollowSuggestions,
        hideHomeComposer: AviaryDeclutter.DEFAULT_SETTINGS.layout.hideHomeComposer
      },
      hidden,
      composerOnStatus,
      restored,
      teardown: {
        style: document.getElementById("av-layout-declutter") !== null,
        classes: [...document.documentElement.classList].filter((name) => name.startsWith("av-hide-"))
      }
    };
  });

  assert.deepEqual(result.defaults, { hideFollowSuggestions: false, hideHomeComposer: false });
  for (const id of [
    "news-module",
    "trends-module",
    "follow-suggestions",
    "home-composer",
    "grok-promo",
    "grok-drawer",
    "chat-drawer",
    "grok-action",
    "follow",
    "chat-nav",
    "grok-nav",
    "history",
    "studio",
    "premium"
  ]) {
    assert.equal(result.hidden[id], "none", `${id} should be hidden`);
    assert.notEqual(result.restored[id], "none", `${id} should restore`);
  }
  assert.notEqual(result.hidden.home, "none", "essential Home navigation must remain");
  assert.notEqual(result.hidden["organic-feed"], "none", "declutter must not remove organic posts");
  assert.notEqual(result.composerOnStatus, "none", "the Home composer setting must not reach reply composers");
  assert.deepEqual(result.teardown, { style: false, classes: [] });
});
