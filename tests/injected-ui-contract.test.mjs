import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

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
      `export { aiCommandMenuFeature } from ${JSON.stringify(abs("src/features/ai/command-menu.ts"))};`,
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
  assert.equal(computed.aiTrigger.size, "10px");
  assert.equal(computed.aiTrigger.weight, "700");
  assert.match(computed.aiTrigger.family, /Georgia/, "the family must inherit, not fall back to the UA font");

  assert.equal(computed.aiOption.size, "12px");
  assert.equal(computed.aiOption.weight, "600");

  assert.equal(computed.noteBadge.size, "10px");
  assert.equal(computed.noteBadge.weight, "700");
  assert.match(computed.noteBadge.family, /Georgia/);
});

test("a media button becomes visible on hover over every container that can host one", async () => {
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
      (id) => getComputedStyle(document.querySelector(`#host-${id} [data-av-media-button]`)).opacity,
      testid
    );
    assert.equal(before, "0", `${testid}: the button should rest hidden`);

    await page.hover(`#host-${testid}`);
    // The reveal is a 120ms transition, so an immediate read catches it mid-animation.
    await page
      .waitForFunction(
        (id) => getComputedStyle(document.querySelector(`#host-${id} [data-av-media-button]`)).opacity === "1",
        testid,
        { timeout: 2000 }
      )
      .catch(() => undefined);
    const after = await page.evaluate(
      (id) => getComputedStyle(document.querySelector(`#host-${id} [data-av-media-button]`)).opacity,
      testid
    );
    assert.equal(after, "1", `${testid}: hovering the container must reveal the button`);

    // And the container must be the positioning context, or the button lands somewhere else.
    const positioned = await page.evaluate(
      (id) => getComputedStyle(document.querySelector(`#host-${id}`)).position,
      testid
    );
    assert.equal(positioned, "relative", `${testid}: must anchor its own absolutely-placed button`);
  }
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
    save: "Save",
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
 * at 1.12:1 against its own near-white label. The gradient now mixes into an opaque surface, so
 * the page behind it stops mattering.
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
      const ratios = stops.map((stop) => ratio(composite(stop, "#ffffff"), text));

      return {
        stops: stops.length,
        worst: Math.min(...ratios),
        // Control: a harness that cannot report a bad pair as bad is authorising everything.
        controlWhiteOnWhite: ratio(composite("#ffffff", "#ffffff"), composite("#ffffff", "#ffffff"))
      };
    });

    assert.ok(measured.stops >= 2, `expected gradient stops, found ${measured.stops}`);
    assert.ok(
      measured.controlWhiteOnWhite < 1.05,
      `control failed — the harness reported ${measured.controlWhiteOnWhite}:1 for white on white`
    );
    assert.ok(
      measured.worst >= 4.5,
      `launcher label measures ${measured.worst.toFixed(2)}:1 against its own background`
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
