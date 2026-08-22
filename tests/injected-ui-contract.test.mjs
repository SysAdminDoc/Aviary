import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

import { readI18nManifest } from "./helpers/i18n-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (p) => path.resolve(root, p).replace(/\\/g, "/");

let browser;
let page;
let temp;

/**
 * Mounts the real injected stylesheets in a real browser.
 *
 * Two defects shipped through a fully green suite because nothing here was measured: the
 * `font: … inherit` shorthand silently dropped ten declarations, and the media button's only
 * hover-reveal rules named `tweetPhoto`, so the button on a video player could never appear.
 * Source greps cannot catch either -- both are questions about what the browser computes.
 */
before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-injected-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mediaButtonsFeature } from ${JSON.stringify(abs("src/features/media/media-buttons.ts"))};`,
      `export { THEME_CSS } from ${JSON.stringify(abs("src/features/appearance/theme.ts"))};`,
      `export { aiCommandMenuFeature } from ${JSON.stringify(abs("src/features/ai/command-menu.ts"))};`,
      `export { composerSnippetsFeature } from ${JSON.stringify(abs("src/features/composer/composer-snippets.ts"))};`,
      `export { mobileTouchFeature } from ${JSON.stringify(abs("src/features/core/mobile-touch.ts"))};`,
      `export { showFeatureToast, removeFeatureToast } from ${JSON.stringify(abs("src/features/core/feature-toast.ts"))};`,
      `export { userNotesFeature } from ${JSON.stringify(abs("src/features/library/user-notes.ts"))};`,
      `export { hiddenPostsFeature } from ${JSON.stringify(abs("src/features/filtering/hidden-posts-feature.ts"))};`,
      `export { readComposerText } from ${JSON.stringify(abs("src/features/integrations/crosspost.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "Aviary",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`chromium is required for this test.\n${error}`);
  }
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(
    "<!doctype html><meta charset=utf-8><body style=\"font-family: Georgia\"></body>"
  );
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Built inside the page: a FeatureContext carries functions, and those cannot be serialised
 * across the evaluate boundary.
 */
const CTX_SETUP = () => {
  globalThis.__ctx = {
    settings: {
      media: {
        buttons: true,
        preferOriginalImages: true,
        filenameTemplate: "{handle}",
        downloadHistory: false
      },
      // The AI button is off by default since v1.13.0; this suite measures it, so it opts in.
      ai: { commandMenu: true },
      composer: { snippets: ["a snippet"] },
      integrations: { ai: { enabled: false, apiKey: "" } },
      i18n: { locale: "en" }
    },
    diagnostics: { info() {}, warn() {}, error() {} },
    auditLog: { record() {} }
  };
};

test("injected controls render at their declared size and inherit the page family", async () => {
  await page.evaluate(CTX_SETUP);
  const computed = await page.evaluate(() => {
    const context = globalThis.__ctx;
    Aviary.mediaButtonsFeature.apply(context, document);
    Aviary.aiCommandMenuFeature.apply(context, document);
    Aviary.userNotesFeature.apply(context, document);

    const host = document.createElement("div");
    host.style.fontFamily = "Georgia";
    document.body.append(host);

    const probe = (className) => {
      const node = document.createElement("button");
      node.className = className;
      host.append(node);
      const style = getComputedStyle(node);
      return { size: style.fontSize, weight: style.fontWeight, family: style.fontFamily };
    };

    const badge = document.createElement("span");
    badge.className = "av-note-badge";
    host.append(badge);
    const badgeStyle = getComputedStyle(badge);

    return {
      aiTrigger: probe("av-ai-trigger"),
      aiOption: probe("av-ai-option"),
      noteBadge: { size: badgeStyle.fontSize, weight: badgeStyle.fontWeight, family: badgeStyle.fontFamily }
    };
  });

  // Before the longhand conversion every one of these computed Arial 13.33px/400.
  assert.equal(computed.aiTrigger.size, "12px");
  assert.equal(computed.aiTrigger.weight, "700");
  assert.match(computed.aiTrigger.family, /Georgia/, "the family must inherit, not fall back to the UA font");

  assert.equal(computed.aiOption.size, "12px");
  assert.equal(computed.aiOption.weight, "600");

  assert.equal(computed.noteBadge.size, "10px");
  assert.equal(computed.noteBadge.weight, "700");
  assert.match(computed.noteBadge.family, /Georgia/);
});

test("AI and snippet popovers expose controlled menus and restore focus", async () => {
  const state = await page.evaluate(async () => {
    document.body.replaceChildren();
    const context = globalThis.__ctx;

    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "actions");
    const tweetText = document.createElement("div");
    tweetText.setAttribute("data-testid", "tweetText");
    tweetText.textContent = "A post for the menu test";
    article.append(tweetText, toolbar);

    const composerToolbar = document.createElement("div");
    composerToolbar.setAttribute("data-testid", "toolBar");
    document.body.append(article, composerToolbar);
    Aviary.aiCommandMenuFeature.apply(context, document);
    Aviary.composerSnippetsFeature.apply(context, document);

    const aiTrigger = document.querySelector("[data-av-ai-trigger]");
    const snippetTrigger = document.querySelector('[data-av-snippet-palette="trigger"]');
    if (!aiTrigger || !snippetTrigger) throw new Error("menu triggers did not render");

    aiTrigger.click();
    const aiMenu = document.getElementById(aiTrigger.getAttribute("aria-controls"));
    if (!aiMenu) throw new Error("AI menu did not render");
    const aiOpen = {
      expanded: aiTrigger.getAttribute("aria-expanded"),
      controls: aiMenu.id === aiTrigger.getAttribute("aria-controls"),
      role: aiMenu.getAttribute("role"),
      popover: aiMenu.getAttribute("popover"),
      focus: document.activeElement?.className
    };
    aiMenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const aiMoved = document.activeElement?.className;
    aiMenu.hidePopover();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const aiClosed = {
      menu: Boolean(document.getElementById(aiMenu.id)),
      expanded: aiTrigger.getAttribute("aria-expanded"),
      focus: document.activeElement === aiTrigger
    };

    snippetTrigger.click();
    const snippetMenu = document.getElementById(snippetTrigger.getAttribute("aria-controls"));
    if (!snippetMenu) throw new Error("snippet menu did not render");
    const snippetOpen = {
      expanded: snippetTrigger.getAttribute("aria-expanded"),
      controls: snippetMenu.id === snippetTrigger.getAttribute("aria-controls"),
      role: snippetMenu.getAttribute("role"),
      popover: snippetMenu.getAttribute("popover"),
      focus: document.activeElement?.className
    };
    snippetMenu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const snippetMoved = document.activeElement?.className;
    snippetMenu.hidePopover();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snippetClosed = {
      menu: Boolean(document.getElementById(snippetMenu.id)),
      expanded: snippetTrigger.getAttribute("aria-expanded"),
      focus: document.activeElement === snippetTrigger
    };

    Aviary.aiCommandMenuFeature.destroy(context);
    Aviary.composerSnippetsFeature.destroy(context);
    return { aiOpen, aiMoved, aiClosed, snippetOpen, snippetMoved, snippetClosed };
  });

  assert.deepEqual(state.aiOpen, {
    expanded: "true",
    controls: true,
    role: "menu",
    popover: "auto",
    focus: "av-ai-option"
  });
  assert.equal(state.aiMoved, "av-ai-option");
  assert.deepEqual(state.aiClosed, { menu: false, expanded: "false", focus: true });
  assert.deepEqual(state.snippetOpen, {
    expanded: "true",
    controls: true,
    role: "menu",
    popover: "auto",
    focus: "av-snippet-option"
  });
  assert.equal(state.snippetMoved, "av-snippet-option");
  assert.deepEqual(state.snippetClosed, { menu: false, expanded: "false", focus: true });
});

test("coarse-pointer page controls keep 44px hit targets and visible prompts", async () => {
  const measured = await page.evaluate(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove("av-touch", "av-mobile");
    const nativeMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; }
      })
    });

    const context = globalThis.__ctx;
    Aviary.mediaButtonsFeature.apply(context, document);
    Aviary.aiCommandMenuFeature.apply(context, document);
    Aviary.composerSnippetsFeature.apply(context, document);
    Aviary.mobileTouchFeature.init(context);

    const add = (tag, attrs, text) => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      node.textContent = text;
      document.body.append(node);
      return node;
    };
    add("button", { "data-av-hide-button": "1" }, "Hide");
    add("button", { "data-av-media-button": "video" }, "Video");
    add("button", { "data-av-local-bookmark": "1" }, "Save");
    add("button", { "data-av-ai-trigger": "1", class: "av-ai-trigger" }, "AI");
    add("button", { "data-av-snippet-palette": "trigger", class: "av-snippet-trigger" }, "Snippets");
    add("button", { class: "av-ai-option" }, "Explain");
    add("button", { class: "av-snippet-option" }, "Snippet");

    const selectors = [
      '[data-av-hide-button]',
      '[data-av-media-button]',
      '[data-av-local-bookmark]',
      '[data-av-ai-trigger]',
      '[data-av-snippet-palette="trigger"]',
      ".av-ai-option",
      ".av-snippet-option"
    ];
    const boxes = Object.fromEntries(
      selectors.map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, { width: rect.width, height: rect.height }];
      })
    );
    const aiOpacity = getComputedStyle(document.querySelector('[data-av-ai-trigger]')).opacity;
    Aviary.mobileTouchFeature.destroy(context);
    Aviary.aiCommandMenuFeature.destroy(context);
    Aviary.composerSnippetsFeature.destroy(context);
    Aviary.mediaButtonsFeature.destroy(context);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: nativeMatchMedia });
    return {
      coarse: window.matchMedia("(pointer: coarse)").matches,
      boxes,
      aiOpacity
    };
  });

  assert.equal(measured.coarse, false, "the native media query should be restored after the probe");
  for (const [selector, box] of Object.entries(measured.boxes)) {
    assert.ok(box.width >= 44, `${selector} width is ${box.width}px`);
    assert.ok(box.height >= 44, `${selector} height is ${box.height}px`);
  }
  assert.equal(measured.aiOpacity, "1", "AI must remain discoverable without hover");
});

test("injected toasts and hide spacing follow the document direction", async () => {
  const results = await page.evaluate(async () => {
    const results = {};
    for (const direction of ["ltr", "rtl"]) {
      document.body.replaceChildren();
      document.documentElement.dir = direction;
      Aviary.removeFeatureToast();

      const values = new Map();
      const context = {
        settings: {
          hidden: { enabled: true, buttons: true, surfaces: ["home"], maxEntries: 10 },
          i18n: { locale: direction === "rtl" ? "ar" : "en" },
          accessibility: { reduceMotion: "never" }
        },
        route: { surface: "home", href: "https://x.com/home", path: "/home" },
        storage: {
          get: async (key, fallback) => values.get(key) ?? fallback,
          set: async (key, value) => values.set(key, value)
        },
        diagnostics: { info() {}, warn() {}, error() {} },
        auditLog: { record() {} },
        requestApply() {}
      };

      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      const user = document.createElement("div");
      user.setAttribute("data-testid", "User-Name");
      const profile = document.createElement("a");
      profile.href = "/alice";
      user.append(profile);
      const caret = document.createElement("button");
      caret.setAttribute("data-testid", "caret");
      const status = document.createElement("a");
      status.href = "/alice/status/123";
      article.append(user, status, caret);
      document.body.append(article);

      await Aviary.hiddenPostsFeature.init(context);
      Aviary.showFeatureToast("Feature error", { tone: "error" });
      const hideButton = document.querySelector("[data-av-hide-button]");
      if (!hideButton) throw new Error("hide button did not render");
      const hideMargin = getComputedStyle(hideButton).marginInlineEnd;
      hideButton.click();
      await new Promise((resolve) => setTimeout(resolve, 25));

      const featureHost = document.getElementById("av-feature-toast");
      const hiddenHost = document.getElementById("av-hidden-toast");
      const featureCard = featureHost?.shadowRoot?.querySelector(".av-ftoast");
      const hiddenCard = hiddenHost?.shadowRoot?.querySelector(".av-toast");
      results[direction] = {
        featureHostDir: featureHost?.dir,
        hiddenHostDir: hiddenHost?.dir,
        feature: {
          popover: featureCard.getAttribute("popover"),
          insetInlineEnd: getComputedStyle(featureCard).insetInlineEnd,
          borderInlineStart: getComputedStyle(featureCard).borderInlineStartWidth,
          left: Math.round(featureCard.getBoundingClientRect().left),
          right: Math.round(window.innerWidth - featureCard.getBoundingClientRect().right)
        },
        hidden: {
          popover: hiddenCard.getAttribute("popover"),
          insetInlineEnd: getComputedStyle(hiddenCard).insetInlineEnd,
          left: Math.round(hiddenCard.getBoundingClientRect().left),
          right: Math.round(window.innerWidth - hiddenCard.getBoundingClientRect().right)
        },
        hideMargin
      };

      await Aviary.hiddenPostsFeature.destroy(context);
      Aviary.removeFeatureToast();
    }
    document.documentElement.dir = "";
    return results;
  });

  assert.equal(results.ltr.featureHostDir, "ltr");
  assert.equal(results.ltr.hiddenHostDir, "ltr");
  assert.equal(results.ltr.feature.popover, "manual");
  assert.equal(results.ltr.hidden.popover, "manual");
  assert.equal(results.ltr.feature.insetInlineEnd, "16px");
  assert.equal(results.ltr.hidden.insetInlineEnd, "16px");
  assert.equal(results.ltr.feature.right, 16);
  assert.equal(results.ltr.hidden.right, 16);
  assert.equal(results.ltr.feature.borderInlineStart, "3px");
  assert.equal(results.ltr.hideMargin, "4px");

  assert.equal(results.rtl.featureHostDir, "rtl");
  assert.equal(results.rtl.hiddenHostDir, "rtl");
  assert.equal(results.rtl.feature.popover, "manual");
  assert.equal(results.rtl.hidden.popover, "manual");
  assert.equal(results.rtl.feature.insetInlineEnd, "16px");
  assert.equal(results.rtl.hidden.insetInlineEnd, "16px");
  assert.equal(results.rtl.feature.left, 16);
  assert.equal(results.rtl.hidden.left, 16);
  assert.equal(results.rtl.feature.borderInlineStart, "3px");
  assert.equal(results.rtl.hideMargin, "4px");
});

test("media download buttons remain obvious without hover on every host container", async () => {
  await page.evaluate(CTX_SETUP);
  await page.evaluate(() => {
    // Cleared so nothing from an earlier test overlaps the hover target.
    document.body.replaceChildren();
    Aviary.mediaButtonsFeature.apply(globalThis.__ctx, document);
    document.documentElement.classList.add("av-media-buttons-enabled");

    for (const testid of ["tweetPhoto", "videoPlayer", "videoComponent"]) {
      const container = document.createElement("div");
      container.setAttribute("data-testid", testid);
      container.id = `host-${testid}`;
      container.style.width = "200px";
      container.style.height = "120px";
      // Deliberately no inline position: the stylesheet is what has to establish the
      // positioning context, and an inline value would beat it and hide the defect.
      const button = document.createElement("button");
      button.setAttribute("data-av-media-button", "video");
      button.textContent = "Video";
      container.append(button);
      document.body.append(container);
    }
  });

  for (const testid of ["tweetPhoto", "videoPlayer", "videoComponent"]) {
    const before = await page.evaluate(
      (id) => {
        const style = getComputedStyle(
          document.querySelector(`#host-${id} [data-av-media-button]`)
        );
        return {
          opacity: style.opacity,
          minHeight: Number.parseFloat(style.minHeight),
          background: style.backgroundColor,
          shadow: style.boxShadow
        };
      },
      testid
    );
    assert.equal(before.opacity, "1", `${testid}: the button must be visible without hover`);
    assert.ok(before.minHeight >= 34, `${testid}: the button is too small to discover`);
    assert.notEqual(before.background, "rgba(0, 0, 0, 0)", `${testid}: the button needs a solid surface`);
    assert.notEqual(before.shadow, "none", `${testid}: the button needs separation from media`);

    await page.hover(`#host-${testid}`);
    const after = await page.evaluate(
      (id) => getComputedStyle(document.querySelector(`#host-${id} [data-av-media-button]`)).opacity,
      testid
    );
    assert.equal(after, "1", `${testid}: hover must not hide the persistent button`);

    // And the stylesheet must NOT have made the container a positioning context. Doing so
    // collapsed X's photo to zero height, because X keeps that box at height 0 and hangs the
    // actual picture off it with position:absolute inset:0 -- see
    // tests/media-button-layout.test.mjs. positionButton() measures offsets instead.
    const positioned = await page.evaluate(
      (id) => getComputedStyle(document.querySelector(`#host-${id}`)).position,
      testid
    );
    assert.equal(
      positioned,
      "static",
      `${testid}: Aviary must not restyle X's media container`
    );
  }

  await page.evaluate(() => {
    const slot = document.createElement("div");
    slot.setAttribute("data-av-media-action-slot", "1");
    const action = document.createElement("button");
    action.setAttribute("data-av-media-action", "1");
    action.textContent = "↓ Download";
    slot.append(action);
    document.body.append(slot);
  });
  const action = await page.evaluate(() => {
    const button = document.querySelector("[data-av-media-action]");
    const style = getComputedStyle(button);
    return {
      display: style.display,
      minHeight: Number.parseFloat(style.minHeight),
      minWidth: Number.parseFloat(style.minWidth),
      borderRadius: Number.parseFloat(style.borderRadius),
      background: style.backgroundColor
    };
  });
  assert.equal(action.display, "flex");
  assert.ok(action.minHeight >= 36);
  assert.ok(action.minWidth >= 96);
  assert.ok(action.borderRadius <= 8, "the primary action must not become a pill");
  assert.notEqual(action.background, "rgba(0, 0, 0, 0)");
});

test("readComposerText preserves paragraph breaks in a Draft.js-shaped composer", async () => {
  const text = await page.evaluate(() => {
    // X's composer renders one element per paragraph; textContent joins them with no separator.
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "tweetTextarea_0");
    for (const line of ["first paragraph", "second paragraph"]) {
      const block = document.createElement("div");
      block.setAttribute("data-block", "true");
      block.textContent = line;
      composer.append(block);
    }
    document.body.append(composer);
    const result = Aviary.readComposerText();
    composer.remove();
    return result;
  });

  assert.equal(text, "first paragraph\n\nsecond paragraph");
  assert.equal(text.split(/\r?\n\s*\r?\n/).length, 2, "thread mode splits on exactly this break");
});

test("timeline controls render in the reader's locale, not English", async () => {
  const rendered = await page.evaluate(async () => {
    const results = {};
    for (const locale of ["en", "ja", "ar"]) {
      document.body.replaceChildren();
      const ctx = {
        settings: {
          media: { buttons: true, preferOriginalImages: true, filenameTemplate: "x", downloadHistory: false },
          hidden: { enabled: true, buttons: true, surfaces: ["home"], maxEntries: 10 },
          ai: { commandMenu: true },
          composer: { snippets: ["a snippet"] },
          integrations: { ai: { enabled: false, apiKey: "" } },
          i18n: { locale },
          accessibility: { reduceMotion: "never" }
        },
        route: { surface: "home", href: "https://x.com/home", path: "/home" },
        storage: { get: async (_key, fallback) => fallback, set: async () => {} },
        diagnostics: { info() {}, warn() {}, error() {} },
        auditLog: { record() {} },
        requestApply() {}
      };

      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      const name = document.createElement("div");
      name.setAttribute("data-testid", "User-Name");
      const handle = document.createElement("a");
      handle.setAttribute("href", "/someone");
      name.append(handle);
      const status = document.createElement("a");
      status.setAttribute("href", "/someone/status/123");
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "actions");
      const photo = document.createElement("div");
      photo.setAttribute("data-testid", "tweetPhoto");
      const img = document.createElement("img");
      img.src = "https://pbs.twimg.com/media/AbCdEf123?format=jpg&name=900x900";
      photo.append(img);
      article.append(name, status, group, photo);
      document.body.append(article);

      await Aviary.hiddenPostsFeature.init(ctx);
      Aviary.mediaButtonsFeature.apply(ctx, document, [article]);
      Aviary.aiCommandMenuFeature.apply(ctx, document, [article]);

      results[locale] = {
        hide: document.querySelector("[data-av-hide-button]")?.textContent ?? null,
        save: document.querySelector("[data-av-media-button]")?.textContent ?? null,
        ai: document.querySelector("[data-av-ai-trigger]")?.getAttribute("aria-label") ?? null
      };

      await Aviary.hiddenPostsFeature.destroy(ctx);
      Aviary.mediaButtonsFeature.destroy(ctx);
      Aviary.aiCommandMenuFeature.destroy(ctx);
    }
    return results;
  });

  assert.deepEqual(rendered.en, {
    hide: "Hide",
    save: "↓ Download",
    ai: "Open Aviary AI command menu"
  });

  // The panel has been fully localized since v1.8.0 while every control Aviary puts on the page
  // stayed English -- a translated settings panel next to an English Hide button on every post.
  for (const locale of ["ja", "ar"]) {
    for (const [key, value] of Object.entries(rendered[locale])) {
      assert.ok(value, `${locale}.${key} did not render`);
      assert.notEqual(value, rendered.en[key], `${locale}.${key} is still English`);
    }
  }
});

/**
 * The launcher must be readable on whatever X is showing, including light mode.
 *
 * It used to paint a translucent accent wash straight over the page, which only worked because
 * Aviary forced X dark. Once the default became "leave X alone", that wash sat on X's light mode
 * at 1.12:1 against its own near-white label. The launcher now mixes into an opaque surface, so
 * the page behind it stops mattering whether that surface resolves to a solid color or gradient.
 *
 * Compositing is done by the browser on a canvas rather than by parsing colour strings: Chromium
 * resolves color-mix() to `color(srgb ...)`, and a regex over that reads digits out of decimals
 * and reports nonsense ratios that pass every assertion.
 */
test("the launcher stays legible on a light page", async () => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent('<body style="background:#fff">x</body>');
    await page.addStyleTag({ content: await launcherCss() });
    await page.setContent(
      '<body style="background:#fff"><button class="av-launcher">Aviary</button></body>'
    );
    await page.addStyleTag({ content: await launcherCss() });

    const measured = await page.evaluate(() => {
      const launcher = document.querySelector(".av-launcher");
      const style = getComputedStyle(launcher);
      const stops = style.backgroundImage.match(/(?:color\(srgb[^)]*\)|rgba?\([^)]*\))/g) ?? [];

      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const g = canvas.getContext("2d");
      const composite = (over, base) => {
        g.fillStyle = base;
        g.fillRect(0, 0, 1, 1);
        g.fillStyle = over;
        g.fillRect(0, 0, 1, 1);
        return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const luminance = ([r, gr, b]) => {
        const channel = (v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(gr) + 0.0722 * channel(b);
      };
      const ratio = (a, b) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };

      // Every gradient stop, composited over WHITE -- the worst case for a light-coloured label.
      const text = composite(style.color, "#ffffff");
      const surfaces = stops.length > 0 ? stops : [style.backgroundColor];
      const ratios = surfaces.map((surface) => ratio(composite(surface, "#ffffff"), text));

      return {
        surfaces: surfaces.length,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        color: style.color,
        worst: Math.min(...ratios),
        // Control: a harness that cannot report a bad pair as bad is authorising everything.
        controlWhiteOnWhite: ratio(composite("#ffffff", "#ffffff"), composite("#ffffff", "#ffffff"))
      };
    });

    assert.ok(measured.surfaces >= 1, "expected a resolved launcher surface");
    assert.ok(
      measured.controlWhiteOnWhite < 1.05,
      `control failed — the harness reported ${measured.controlWhiteOnWhite}:1 for white on white`
    );
    assert.ok(
      measured.worst >= 4.5,
      `launcher label measures ${measured.worst.toFixed(2)}:1 against ${measured.backgroundColor} (${measured.backgroundImage}); text ${measured.color}`
    );
  } finally {
    await browser.close();
  }
});

async function launcherCss() {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
  const start = source.indexOf(".av-launcher {");
  const end = source.indexOf("}", start) + 1;
  // `position: fixed` would take it out of flow and give it a zero box in this harness.
  return source.slice(start, end).replace("position: fixed;", "position: static;");
}

test("the declared injection mode matches what the install guide promises", async () => {
  const install = await readFile(path.join(root, "docs/INSTALL.md"), "utf8");

  // Read from the shipped metablock rather than from the script that writes it: what a userscript
  // manager acts on is the banner in the delivered file, and a build that stopped emitting the
  // directive would still satisfy a regex over tools/build.mjs.
  const meta = await readFile(path.join(root, "dist/aviary.meta.js"), "utf8").catch(() => null);
  const userscript = await readFile(path.join(root, "dist/aviary.user.js"), "utf8").catch(() => null);
  for (const [name, source] of [["aviary.meta.js", meta], ["aviary.user.js", userscript]]) {
    if (!source) continue;
    const declared = /@inject-into\s+(\S+)/.exec(source)?.[1];
    assert.equal(declared, "content", `${name}: Aviary stays out of the page's own scope by design`);
  }

  // `content` is what makes unsafeWindow useless under Violentmonkey, so the page-world observer
  // cannot install there. That is a real difference between managers and the guide has to name it,
  // or a user reads "compatible manager" and expects the network half to work.
  assert.match(install, /@inject-into content/);
  assert.match(install, /unsafeWindow/);
  assert.match(install, /Violentmonkey/);

  // And the panel must own a sentence for the state, rather than leaving it to the docs. Taken
  // from the harvested copy, so it is a sentence that reached the translator and can be read in
  // every locale -- not a literal sitting in a branch nothing renders.
  const manifest = await readI18nManifest(root);
  assert.ok(
    manifest.manifest.some((line) => line.includes("does not give Aviary access to the page itself")),
    "the panel has no translatable sentence for the no-page-scope state"
  );
});

/**
 * A download's outcome has to be visible under the user's own theme.
 *
 * `theme.ts` styled every `[data-av-media-action]` and the feature styled its own state classes,
 * and both selectors were (0,2,1). A tie is broken by which stylesheet was appended last, and under
 * every Aviary theme that was the theme sheet -- so a finished download, a duplicate, an
 * opened-in-a-tab fallback and an outright failure all rendered exactly like a button nobody had
 * touched. Both sheet orders are driven here, because the ordering is what made the bug invisible.
 */
test("the media action's states stay distinct under every theme, whichever sheet loads first", async () => {
  const results = await page.evaluate(async (themeCss) => {
    const out = {};
    for (const themeFirst of [true, false]) {
      document.body.replaceChildren();
      for (const style of [...document.querySelectorAll("style")]) style.remove();

      const ctx = {
        settings: {
          media: { buttons: true, preferOriginalImages: true, filenameTemplate: "x", downloadHistory: false, layout: "default" },
          integrations: { aria2: { enabled: false, rpcUrl: "", secret: "" } },
          i18n: { locale: "en" },
          accessibility: { reduceMotion: "never" }
        },
        route: { surface: "home", href: "https://x.com/home", path: "/home" },
        storage: { get: async (_key, fallback) => fallback, set: async () => {} },
        diagnostics: { info() {}, warn() {}, error() {} },
        auditLog: { record() {} },
        requestApply() {}
      };

      const mountTheme = () => {
        const style = document.createElement("style");
        style.id = "av-theme-probe";
        style.textContent = themeCss;
        document.head.append(style);
      };

      if (themeFirst) mountTheme();
      await Aviary.mediaButtonsFeature.init?.(ctx);
      await Aviary.mediaButtonsFeature.apply?.(ctx, document, []);
      if (!themeFirst) mountTheme();

      const read = (theme, cls) => {
        if (theme) {
          document.documentElement.dataset.avTheme = theme;
          document.documentElement.className = `av-theme-${theme}`;
        } else {
          document.documentElement.removeAttribute("data-av-theme");
          document.documentElement.className = "";
        }
        const button = document.createElement("button");
        button.setAttribute("data-av-media-action", "");
        if (cls) button.className = cls;
        document.body.append(button);
        void button.offsetHeight;
        const style = getComputedStyle(button);
        const value = `${style.backgroundColor}|${style.color}`;
        button.remove();
        return value;
      };

      const perTheme = {};
      for (const theme of [null, "dim", "noir"]) {
        perTheme[theme ?? "off"] = {
          resting: read(theme, ""),
          success: read(theme, "is-success"),
          error: read(theme, "is-error")
        };
      }
      out[themeFirst ? "themeFirst" : "featureFirst"] = perTheme;
      Aviary.mediaButtonsFeature.destroy?.(ctx);
    }
    return out;
  }, await themeCssSource());

  for (const [order, themes] of Object.entries(results)) {
    for (const [theme, states] of Object.entries(themes)) {
      assert.notEqual(
        states.success,
        states.resting,
        `${order}/${theme}: a finished download must not look like an untouched button`
      );
      assert.notEqual(
        states.error,
        states.resting,
        `${order}/${theme}: a failed download must not look like an untouched button`
      );
      assert.notEqual(
        states.success,
        states.error,
        `${order}/${theme}: success and failure must not look the same`
      );
    }
  }
});

async function themeCssSource() {
  return page.evaluate(() => Aviary.THEME_CSS);
}
