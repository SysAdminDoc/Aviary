import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Three features whose contract is "apply changes the page, destroy puts it back", driven rather
 * than read.
 *
 * These were asserted as regexes over their own source — `/root\.classList\.toggle\("av-hide-
 * borders", settings\.appearance\.hideBorders\)/`, `/setAttribute\("href", original\)/`. A regex
 * over the line that performs an effect cannot tell whether the effect happened: it survives a
 * feature that toggles the class and then throws, or one that restores an href it never recorded.
 * Each test below applies the feature to a fixture, checks the page, destroys it, and checks the
 * page is back where it started.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-lifecycle-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { themeFeature, THEME_CSS } from ${JSON.stringify(abs("src/features/appearance/theme.ts"))};`,
      `export { layoutDeclutterFeature } from ${JSON.stringify(abs("src/features/layout/declutter.ts"))};`,
      `export { cleanShareLinksFeature, cleanUrl } from ${JSON.stringify(abs("src/features/library/clean-share-links.ts"))};`,
      `export { linkUnshortenFeature } from ${JSON.stringify(abs("src/features/library/link-unshorten.ts"))};`,
      `export { PRESETS } from ${JSON.stringify(abs("src/features/core/presets.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryLifecycle",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.ctx = (mutate) => {
      const settings = AviaryLifecycle.cloneSettings(AviaryLifecycle.DEFAULT_SETTINGS);
      mutate?.(settings);
      return {
        settings,
        route: { surface: "home", path: "/home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
    window.reset = () => {
      document.documentElement.className = "";
      document.body.replaceChildren();
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("hideBorders adds a class the stylesheet targets, and destroy takes it away", async () => {
  const result = await page.evaluate(() => {
    window.reset();
    const html = document.documentElement;
    const off = window.ctx();
    const on = window.ctx((settings) => {
      settings.appearance.hideBorders = true;
    });

    AviaryLifecycle.themeFeature.init(off);
    const whenOff = html.classList.contains("av-hide-borders");

    AviaryLifecycle.themeFeature.apply(on);
    const whenOn = html.classList.contains("av-hide-borders");

    // Turning the setting back off must be enough; the user should not have to reload.
    AviaryLifecycle.themeFeature.apply(off);
    const afterOff = html.classList.contains("av-hide-borders");

    AviaryLifecycle.themeFeature.apply(on);
    AviaryLifecycle.themeFeature.destroy(on);
    return {
      whenOff,
      whenOn,
      afterOff,
      afterDestroy: html.classList.contains("av-hide-borders"),
      styleAfterDestroy: Boolean(document.getElementById("av-theme-foundation"))
    };
  });

  assert.equal(result.whenOff, false, "off by default, like every appearance control");
  assert.equal(result.whenOn, true);
  assert.equal(result.afterOff, false, "the class must follow the setting both ways");
  assert.equal(result.afterDestroy, false, "destroy must leave no trace on the page");
  assert.equal(result.styleAfterDestroy, false, "and must take its stylesheet with it");
});

test("the hide-borders rules select X's structure, never its generated class names", async () => {
  const css = await page.evaluate(() => AviaryLifecycle.THEME_CSS);

  // Structural selectors survive X shipping a new build; `.r-1kihuf0` does not.
  assert.match(css, /html\.av-hide-borders \[data-testid="cellInnerDiv"\]/);
  assert.match(css, /html\.av-hide-borders \[data-testid="primaryColumn"\]/);
  assert.ok(
    !/\.r-[a-z0-9]{5,}/.test(css),
    "the stylesheet must not depend on X's generated atomic class names"
  );
});

test("hide-borders actually flattens the timeline it targets", async () => {
  const borders = await page.evaluate(() => {
    window.reset();
    document.body.innerHTML = `
      <main data-testid="primaryColumn" style="border: 1px solid rgb(200, 0, 0)">
        <div data-testid="cellInnerDiv"><div style="border-bottom: 1px solid rgb(200, 0, 0)">post</div></div>
      </main>`;
    const cell = document.querySelector('[data-testid="cellInnerDiv"] > div');
    const column = document.querySelector('[data-testid="primaryColumn"]');
    const ctx = window.ctx((settings) => {
      settings.appearance.hideBorders = true;
    });

    AviaryLifecycle.themeFeature.init(window.ctx());
    const before = {
      cell: getComputedStyle(cell).borderBottomWidth,
      column: getComputedStyle(column).borderLeftWidth
    };
    AviaryLifecycle.themeFeature.apply(ctx);
    const after = {
      cell: getComputedStyle(cell).borderBottomWidth,
      column: getComputedStyle(column).borderLeftWidth
    };
    AviaryLifecycle.themeFeature.destroy(ctx);
    return { before, after };
  });

  assert.equal(borders.before.cell, "1px", "the fixture must start with the border this removes");
  assert.equal(borders.after.cell, "0px", "the timeline separator must actually go");
  assert.equal(borders.after.column, "0px", "and so must the column edge");
});

test("writer mode follows focus into and out of the composer, with no key handler", async () => {
  const result = await page.evaluate(async () => {
    window.reset();
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <div data-testid="tweetTextarea_0RichTextInputContainer">
          <div contenteditable="true" data-testid="tweetTextarea_0" tabindex="0"></div>
        </div>
      </div>
      <aside data-testid="sidebarColumn">trends</aside>
      <button id="elsewhere">elsewhere</button>`;

    const html = document.documentElement;
    const composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    const elsewhere = document.getElementById("elsewhere");
    const ctx = window.ctx((settings) => {
      settings.layout.writerMode = true;
    });

    // Any key event reaching the document would be a hotkey; Aviary registers none.
    let keyEvents = 0;
    for (const type of ["keydown", "keyup", "keypress"]) {
      document.addEventListener(type, () => keyEvents++, true);
    }

    AviaryLifecycle.layoutDeclutterFeature.init(ctx);
    const armed = { mode: html.classList.contains("av-writer-mode"), writing: html.classList.contains("av-writing") };

    composer.focus();
    // The surroundings recede over a 160ms transition rather than snapping, so sampling the
    // computed opacity any sooner reads the value mid-animation.
    await new Promise((resolve) => setTimeout(resolve, 260));
    const typing = {
      writing: html.classList.contains("av-writing"),
      sidebar: getComputedStyle(document.querySelector('[data-testid="sidebarColumn"]')).opacity
    };

    elsewhere.focus();
    // focusout fires before focus lands, so the feature re-reads on the next frame.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 10)));
    const away = html.classList.contains("av-writing");

    composer.focus();
    await new Promise((resolve) => setTimeout(resolve, 10));
    AviaryLifecycle.layoutDeclutterFeature.destroy(ctx);

    // If destroy left the listeners bound, this focus would put the class straight back.
    elsewhere.focus();
    composer.focus();
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 10)));

    return {
      armed,
      typing,
      away,
      afterDestroy: {
        mode: html.classList.contains("av-writer-mode"),
        writing: html.classList.contains("av-writing")
      },
      keyEvents
    };
  });

  assert.equal(result.armed.mode, true, "the setting must arm writer mode");
  assert.equal(result.armed.writing, false, "arming it is not the same as writing");
  assert.equal(result.typing.writing, true, "focusing the composer must enter writing");
  assert.notEqual(result.typing.sidebar, "1", "and must actually dim what surrounds it");
  assert.equal(result.away, false, "leaving the composer must leave writing");
  assert.equal(result.afterDestroy.mode, false, "destroy must drop both classes");
  assert.equal(result.afterDestroy.writing, false);
  assert.equal(result.keyEvents, 0, "focus is the signal — Aviary registers no key handlers");
});

test("clean share links strips tracking parameters and puts the original href back", async () => {
  const result = await page.evaluate(() => {
    window.reset();
    document.body.innerHTML = `
      <a id="tracked" href="https://x.com/user/status/1?t=abc123&s=20">post</a>
      <a id="plain" href="https://x.com/user/status/2">plain</a>
      <a id="foreign" href="https://example.com/a?utm_source=x&keep=1">foreign</a>`;
    const read = () => ({
      tracked: document.getElementById("tracked").getAttribute("href"),
      plain: document.getElementById("plain").getAttribute("href"),
      foreign: document.getElementById("foreign").getAttribute("href")
    });

    const off = window.ctx((settings) => {
      settings.links.cleanShareButtons = false;
    });
    const on = window.ctx((settings) => {
      settings.links.cleanShareButtons = true;
    });

    AviaryLifecycle.cleanShareLinksFeature.init(off);
    const whenOff = read();

    AviaryLifecycle.cleanShareLinksFeature.apply(on, document);
    const whenOn = read();

    // Turning the setting off has to undo the rewrite, not merely stop doing more of it.
    AviaryLifecycle.cleanShareLinksFeature.apply(off, document);
    const afterOff = read();

    AviaryLifecycle.cleanShareLinksFeature.apply(on, document);
    AviaryLifecycle.cleanShareLinksFeature.destroy(on);
    return { whenOff, whenOn, afterOff, afterDestroy: read() };
  });

  assert.equal(result.whenOff.tracked, "https://x.com/user/status/1?t=abc123&s=20", "off means untouched");
  assert.equal(result.whenOn.tracked, "https://x.com/user/status/1", "t and s are X's share tracking");
  assert.equal(result.whenOn.plain, "https://x.com/user/status/2", "a clean link must be left alone");
  assert.equal(result.afterOff.tracked, "https://x.com/user/status/1?t=abc123&s=20", "turning it off restores");
  assert.equal(result.afterDestroy.tracked, "https://x.com/user/status/1?t=abc123&s=20", "destroy restores");
});

test("each declutter switch adds only its own class, and destroy removes them all", async () => {
  const result = await page.evaluate(() => {
    window.reset();
    document.body.innerHTML = `
      <main data-testid="primaryColumn"><div data-testid="cellInnerDiv">post</div></main>
      <aside data-testid="sidebarColumn">
        <div data-testid="trend">trend</div>
        <div data-testid="sidebarColumn-grok">grok</div>
      </aside>`;
    const html = document.documentElement;
    const avClasses = () => [...html.classList].filter((name) => name.startsWith("av-"));

    const cases = {
      hideRightSidebar: "av-hide-right-sidebar",
      hideTrends: "av-hide-trends",
      hideGrok: "av-hide-grok",
      hideFollowSuggestions: "av-hide-follow-suggestions"
    };

    const seen = {};
    for (const [setting, className] of Object.entries(cases)) {
      const ctx = window.ctx((settings) => {
        settings.layout[setting] = true;
      });
      AviaryLifecycle.layoutDeclutterFeature.init(ctx);
      seen[setting] = { classes: avClasses(), expected: className };
      AviaryLifecycle.layoutDeclutterFeature.destroy(ctx);
      seen[setting].afterDestroy = avClasses();
    }

    // A nav item name is user input; it becomes part of a class name, so it has to be sanitised.
    const navCtx = window.ctx((settings) => {
      settings.layout.hideNavItems = ["Messages", 'evil"><script>', "Explore"];
    });
    AviaryLifecycle.layoutDeclutterFeature.init(navCtx);
    const nav = avClasses().filter((name) => name.startsWith("av-hide-nav-"));
    AviaryLifecycle.layoutDeclutterFeature.destroy(navCtx);

    return { seen, nav, afterNavDestroy: avClasses() };
  });

  for (const [setting, entry] of Object.entries(result.seen)) {
    assert.deepEqual(
      entry.classes,
      [entry.expected],
      `${setting} added ${JSON.stringify(entry.classes)} instead of only ${entry.expected}`
    );
    assert.deepEqual(entry.afterDestroy, [], `${setting} left classes behind after destroy`);
  }

  assert.ok(
    result.nav.includes("av-hide-nav-messages") && result.nav.includes("av-hide-nav-explore"),
    `the two real nav items must be hidden: ${JSON.stringify(result.nav)}`
  );
  // The hostile entry is not rejected, it is stripped to the characters a class name may hold —
  // which is the point: nothing from the settings file can close the attribute or open a tag.
  assert.ok(
    !result.nav.some((name) => /[^a-z0-9-]/.test(name)),
    `a nav item name reached the class list unsanitised: ${JSON.stringify(result.nav)}`
  );
  assert.deepEqual(result.afterNavDestroy, [], "per-item nav classes must be removed too");
});

test("link unshortening restores the title and class it replaced", async () => {
  const result = await page.evaluate(async () => {
    window.reset();
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText">
          <a href="https://t.co/abcd1234" title="t.co/abcd1234"
             aria-label="https://example.com/article">https://t.co/abcd1234</a>
          <a href="https://example.org/plain" title="original title">plain</a>
        </div>
      </article>`;
    const read = () =>
      [...document.querySelectorAll("a")].map((anchor) => ({
        title: anchor.getAttribute("title"),
        clean: anchor.classList.contains("av-link-clean"),
        classes: anchor.className
      }));

    const before = read();
    const ctx = window.ctx((settings) => {
      settings.links.expandTco = true;
    });
    await AviaryLifecycle.linkUnshortenFeature.init(ctx);
    await AviaryLifecycle.linkUnshortenFeature.apply(ctx, document);
    const during = read();

    await AviaryLifecycle.linkUnshortenFeature.destroy(ctx);
    return { before, during, after: read() };
  });

  assert.ok(
    result.during.some((entry) => entry.clean),
    "the feature marked nothing — the fixture no longer matches what it looks for"
  );
  // Reversibility is the whole contract: the class goes, and a title the page set itself comes
  // back exactly, rather than being left as whatever the feature wrote over it.
  assert.deepEqual(
    result.after.map((entry) => entry.title),
    result.before.map((entry) => entry.title),
    "destroy did not restore the original titles"
  );
  assert.ok(!result.after.some((entry) => entry.clean), "destroy left the av-link-clean class behind");
  assert.deepEqual(
    result.after.map((entry) => entry.classes),
    result.before.map((entry) => entry.classes),
    "destroy left a class list the page did not start with"
  );
});

test("hiding engagement counts hides the numbers and keeps the buttons", async () => {
  const result = await page.evaluate(() => {
    window.reset();
    document.body.innerHTML = `
      <article data-testid="tweet">
        <button data-testid="reply"><span data-testid="app-text-transition-container">12</span></button>
        <button data-testid="retweet"><span data-testid="app-text-transition-container">34</span></button>
        <button data-testid="like"><span data-testid="app-text-transition-container">56</span></button>
        <a href="/alice/status/1/analytics"><span data-testid="app-text-transition-container">78</span></a>
      </article>`;
    const shown = (selector) => {
      const node = document.querySelector(selector);
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
    };
    const snapshot = () => ({
      replyButton: shown('[data-testid="reply"]'),
      replyCount: shown('[data-testid="reply"] [data-testid="app-text-transition-container"]'),
      likeCount: shown('[data-testid="like"] [data-testid="app-text-transition-container"]'),
      analyticsCount: shown('a[href$="/analytics"] [data-testid="app-text-transition-container"]')
    });

    const off = window.ctx();
    const on = window.ctx((settings) => {
      settings.appearance.hideCounts = true;
    });

    AviaryLifecycle.themeFeature.init(off);
    const before = snapshot();
    AviaryLifecycle.themeFeature.apply(on);
    const during = snapshot();
    AviaryLifecycle.themeFeature.destroy(on);
    return { before, during, after: snapshot() };
  });

  assert.equal(result.before.replyCount, true, "the fixture must start with visible counts");
  assert.equal(result.during.replyCount, false, "the reply count must go");
  assert.equal(result.during.likeCount, false);
  assert.equal(result.during.analyticsCount, false, "the analytics count is a count too");
  // Hiding the button as well would remove the ability to reply, which is not what was asked for.
  assert.equal(result.during.replyButton, true, "the action button itself must stay usable");
  assert.equal(result.after.replyCount, true, "destroy must bring the counts back");
});

test("every appearance and layout key a preset writes changes the page", async () => {
  const unimplemented = await page.evaluate(() => {
    window.reset();
    // A fixture carrying every surface the appearance and layout features target, so a key that
    // drives nothing is visible as a page that did not change.
    document.body.innerHTML = `
      <main data-testid="primaryColumn">
        <div data-testid="cellInnerDiv"><article data-testid="tweet">
          <button data-testid="reply"><span data-testid="app-text-transition-container">12</span></button>
        </article></div>
        <div data-testid="tweetTextarea_0RichTextInputContainer">
          <div contenteditable="true" data-testid="tweetTextarea_0" tabindex="0"></div>
        </div>
      </main>
      <aside data-testid="sidebarColumn">
        <div data-testid="trend">trend</div>
        <div data-testid="sidebarColumn-grok">grok</div>
        <div data-testid="UserCell">who to follow</div>
      </aside>
      <nav>
        <a data-testid="AppTabBar_Home_Link">home</a>
        <a data-testid="AppTabBar_Explore_Link">explore</a>
      </nav>`;

    const fingerprint = () =>
      JSON.stringify([
        [...document.documentElement.classList].sort(),
        document.documentElement.dataset.avTheme ?? null,
        document.documentElement.dataset.avWidth ?? null,
        [...document.querySelectorAll("[data-testid]")].map((node) => {
          const style = getComputedStyle(node);
          return [style.display, style.visibility, style.opacity, style.width];
        })
      ]);

    const misses = [];
    for (const preset of AviaryLifecycle.PRESETS) {
      for (const group of ["appearance", "layout"]) {
        for (const [key, value] of Object.entries(preset.overrides[group] ?? {})) {
          // The question is whether the key drives anything, not whether this preset's value
          // happens to differ from the default — several presets set a boolean to false that is
          // already false, which is a no-op by design rather than an unimplemented key.
          const other = typeof value === "boolean" ? !value : AviaryLifecycle.DEFAULT_SETTINGS[group][key];
          if (other === value) continue;

          const render = (setting) => {
            const ctx = window.ctx((settings) => {
              settings[group][key] = setting;
            });
            AviaryLifecycle.themeFeature.init(ctx);
            AviaryLifecycle.layoutDeclutterFeature.init(ctx);
            const shot = fingerprint();
            AviaryLifecycle.themeFeature.destroy(ctx);
            AviaryLifecycle.layoutDeclutterFeature.destroy(ctx);
            return shot;
          };

          if (render(value) === render(other)) {
            misses.push(`${group}.${key} (${JSON.stringify(value)} vs ${JSON.stringify(other)})`);
          }
        }
      }
    }
    return [...new Set(misses)];
  });

  // A preset that flips a key nothing reads reports a change it cannot deliver.
  assert.deepEqual(unimplemented, [], "these preset keys changed nothing on the page");
});
