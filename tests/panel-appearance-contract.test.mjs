import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * What the Control Center actually looks like once the browser has resolved it.
 *
 * These claims were regexes over `theme.ts` and `control-center.ts` that pulled `rgb(...)` triples
 * out of template literals and recomputed the `color-mix` chain by hand in the test — a second
 * copy of the stylesheet's arithmetic, free to drift from it. `@media (pointer: coarse)` and
 * `min-height: 44px` appearing in the same file said nothing about whether the rule applied to a
 * row. Everything here mounts the panel and reads resolved computed styles.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const BUILD_VERSION = "9.9.9-panel";

/** The six painted themes. `off` leaves X's appearance alone and has no tokens of its own. */
const THEMES = ["dim", "lightsOut", "graphite", "plum", "midnight", "noir"];

let browser;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-appearance-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { mountControlCenter, renderedPanelStrings } from ${JSON.stringify(abs("src/ui/control-center.ts"))};`,
      `export { themeFeature } from ${JSON.stringify(abs("src/features/appearance/theme.ts"))};`,
      `export { controlCenterFeature } from ${JSON.stringify(abs("src/features/core/control-center.ts"))};`,
      `export { hiddenPostsFeature } from ${JSON.stringify(abs("src/features/filtering/hidden-posts-feature.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryLook",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    // The same define the real build applies. Without it the version reads "dev" and the stamp
    // assertion below would be checking the fallback rather than the build.
    define: { __AVIARY_VERSION__: JSON.stringify(BUILD_VERSION) }
  });

  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Colour helpers installed in the page. `effectiveBackground` composites the resolved background of an
 * element over its ancestors until it reaches an opaque layer, which is what the eye sees and
 * what a hand-written `color-mix` reimplementation in a test could only approximate.
 */
const COLOUR_HELPERS = `
  window.parseColor = (value) => {
    const match = /rgba?\\(([^)]+)\\)/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[,/]/).map((piece) => piece.trim());
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const a = parts.length > 3 ? Number(parts[3]) : 1;
    return { r, g, b, a };
  };
  window.over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1
  });
  window.effectiveBackground = (node) => {
    const layers = [];
    let current = node;
    while (current) {
      const colour = window.parseColor(getComputedStyle(current).backgroundColor);
      if (colour && colour.a > 0) {
        layers.push(colour);
        if (colour.a === 1) break;
      }
      current = current.parentElement ?? current.getRootNode()?.host ?? null;
    }
    if (layers.length === 0 || layers[layers.length - 1].a < 1) layers.push({ r: 0, g: 0, b: 0, a: 1 });
    return layers.reduceRight((bottom, top) => window.over(top, bottom));
  };
  window.contrast = (fg, bg) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (colour) =>
      0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
    const a = lum(fg);
    const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
`;

/** Opens a page with the bundle and colour helpers loaded. */
async function openPage({ viewport = { width: 1280, height: 900 }, ...options } = {}) {
  const context = await browser.newContext({ viewport, ...options });
  const page = await context.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.addScriptTag({ content: COLOUR_HELPERS });
  return { context, page };
}

/** Mounts the theme feature and the panel with the given settings mutation applied. */
const MOUNT = (mutate) => `
  (() => {
    const settings = AviaryLook.cloneSettings(AviaryLook.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    (${mutate})(settings);
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryLook.themeFeature.init(ctx);
    window.__panel = AviaryLook.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    return shadow;
  })()
`;

/**
 * Mounts the panel through the Control Center *feature* rather than `mountControlCenter` directly.
 * The preset board only exists when the feature supplies `listPresets`/`applyPreset`, so a bare
 * mount renders "Preset packs unavailable in this build" and would pass a card test vacuously.
 */
const MOUNT_FEATURE = `
  (async () => {
    document.getElementById("av-control-center")?.remove();
    const settings = AviaryLook.cloneSettings(AviaryLook.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    settings.appearance.theme = "dim";
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      storage: { async get(_k, fallback) { return fallback; }, async set() {}, async remove() {} },
      auditLog: { snapshot: () => ({ entries: [] }), async record() {} },
      diagnostics: { info() {}, warn() {}, error() {} },
      saveSettings: async () => {},
      requestApply: () => {}
    };
    AviaryLook.themeFeature.init(ctx);
    await AviaryLook.controlCenterFeature.init(ctx);
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    return shadow;
  })()
`;

test("every painted theme keeps secondary row text above the AA floor", async () => {
  const { context, page } = await openPage();
  try {
    const results = await page.evaluate(
      ({ themes, mount }) => {
        const out = [];
        for (const theme of themes) {
          document.getElementById("av-control-center")?.remove();
          document.documentElement.className = "";
          const shadow = eval(mount.replace("__THEME__", theme));
          const row = shadow.querySelector(".av-row .av-row-description");
          const style = getComputedStyle(row);
          out.push({
            theme,
            ratio: window.contrast(window.parseColor(style.color), window.effectiveBackground(row)),
            colour: style.color
          });
        }
        return out;
      },
      {
        themes: THEMES,
        mount: MOUNT('(settings) => { settings.appearance.theme = "__THEME__"; }')
      }
    );

    assert.equal(results.length, THEMES.length, "every painted theme must be measured");
    for (const result of results) {
      assert.ok(
        result.ratio >= 4.5,
        `${result.theme}: row description is ${result.ratio.toFixed(2)}:1, below the 4.5:1 AA floor`
      );
    }
    // Distinct themes must actually paint differently, or the loop above measured one theme six
    // times and passed for the wrong reason.
    assert.ok(new Set(results.map((r) => r.colour)).size > 1, "the themes did not change anything");
  } finally {
    await context.close();
  }
});

test("a coarse pointer gets rows big enough to hit", async () => {
  const { context, page } = await openPage({
    viewport: { width: 1280, height: 900 },
    hasTouch: true,
    isMobile: false
  });
  try {
    const sizes = await page.evaluate((mount) => {
      const shadow = eval(mount);
      return {
        coarse: matchMedia("(pointer: coarse)").matches,
        rows: [...shadow.querySelectorAll(".av-row")].slice(0, 8).map((row) => row.getBoundingClientRect().height),
        controls: [...shadow.querySelectorAll(".av-row button, .av-row select, .av-row input[type='text']")]
          .slice(0, 8)
          .map((node) => node.getBoundingClientRect().height)
      };
    }, MOUNT("(settings) => { settings.appearance.theme = 'dim'; }"));

    assert.equal(sizes.coarse, true, "the harness must actually present a coarse pointer");
    for (const height of sizes.rows) {
      assert.ok(height >= 44, `a settings row is ${height}px tall, below the 44px touch target floor`);
    }
    for (const height of sizes.controls) {
      assert.ok(height >= 44, `a control is ${height}px tall, below the 44px touch target floor`);
    }
  } finally {
    await context.close();
  }
});

test("a narrow window still fits the panel on screen", async () => {
  const { context, page } = await openPage({ viewport: { width: 700, height: 720 } });
  try {
    const layout = await page.evaluate((mount) => {
      const shadow = eval(mount);
      const panel = shadow.querySelector(".av-panel").getBoundingClientRect();
      return {
        narrow: matchMedia("(max-width: 760px)").matches,
        width: panel.width,
        viewport: window.innerWidth,
        overflowsRight: panel.right > window.innerWidth + 1,
        overflowsLeft: panel.left < -1
      };
    }, MOUNT("(settings) => { settings.appearance.theme = 'dim'; }"));

    assert.equal(layout.narrow, true, "the narrow breakpoint must be in effect");
    assert.ok(layout.width <= layout.viewport, `panel is ${layout.width}px in a ${layout.viewport}px window`);
    assert.equal(layout.overflowsRight, false, "the panel must not run off the right edge");
    assert.equal(layout.overflowsLeft, false);
  } finally {
    await context.close();
  }
});

test("reduced motion reaches inside the shadow root, where a page class cannot", async () => {
  const { context, page } = await openPage();
  try {
    const motion = await page.evaluate(
      ({ reduce, system }) => {
        const read = (mount) => {
          document.getElementById("av-control-center")?.remove();
          const shadow = eval(mount);
          const host = document.getElementById("av-control-center");
          const launcher = shadow.querySelector(".av-nav-launcher-pill") ?? shadow.querySelector(".av-launcher");
          return {
            hostState: host.dataset.avMotion,
            duration: getComputedStyle(launcher).transitionDuration
          };
        };
        return { reduced: read(reduce), normal: read(system) };
      },
      {
        reduce: MOUNT("(settings) => { settings.accessibility.reduceMotion = 'always'; }"),
        system: MOUNT("(settings) => { settings.accessibility.reduceMotion = 'never'; }")
      }
    );

    // The host attribute is the whole mechanism: `html.av-reduce-motion` cannot style a shadow
    // descendant, so the state has to be carried onto the host element itself.
    assert.equal(motion.reduced.hostState, "reduce");
    assert.equal(motion.normal.hostState, "full");
    assert.equal(
      motion.reduced.duration,
      "0s",
      `reduced motion left a ${motion.reduced.duration} transition running inside the shadow root`
    );
    assert.notEqual(motion.normal.duration, "0s", "without it, the panel still animates");
  } finally {
    await context.close();
  }
});

test("reduced motion is reachable from the panel, in all three states", async () => {
  const { context, page } = await openPage();
  try {
    const options = await page.evaluate((mount) => {
      const shadow = eval(mount);
      shadow.querySelector('.av-nav-item[data-av-section="appearance"]').click();
      const row = [...shadow.querySelectorAll(".av-row")].find(
        (candidate) => candidate.dataset.avLabel === "Reduced motion"
      );
      if (!row) return null;
      return [...row.querySelectorAll("option")].map((option) => option.textContent.trim());
    }, MOUNT("(settings) => { settings.appearance.theme = 'dim'; }"));

    // The setting shipped for a while with no way to change it from the panel.
    assert.ok(options, "the panel offers no way to change reduced motion");
    assert.deepEqual(options, ["Follow system setting", "Always reduce", "Never reduce"]);
  } finally {
    await context.close();
  }
});

test("the panel's chrome follows the theme accent rather than a pinned blue", async () => {
  const { context, page } = await openPage();
  try {
    const accents = await page.evaluate(
      ({ mounts }) => {
        const read = (mount) => {
          document.getElementById("av-control-center")?.remove();
          document.documentElement.className = "";
          const shadow = eval(mount);
          const launcher = shadow.querySelector(".av-nav-launcher-pill") ?? shadow.querySelector(".av-launcher");
          return {
            background: getComputedStyle(launcher).backgroundImage || getComputedStyle(launcher).backgroundColor,
            accent: getComputedStyle(document.documentElement).getPropertyValue("--av-accent").trim()
          };
        };
        return mounts.map(read);
      },
      { mounts: THEMES.map((theme) => MOUNT(`(settings) => { settings.appearance.theme = "${theme}"; }`)) }
    );

    const accentValues = accents.map((entry) => entry.accent).filter(Boolean);
    assert.ok(accentValues.length >= 2, "themes must define their own accent");
    assert.ok(
      new Set(accents.map((entry) => entry.background)).size > 1,
      "the launcher paints identically under every theme — it is not following --av-accent"
    );
    assert.ok(
      !accents.some((entry) => /rgba?\(29, 155, 240/.test(entry.background)),
      "the launcher must not fall back to X's fixed blue"
    );
  } finally {
    await context.close();
  }
});

test("the hide control is legible at rest, not only on hover", async () => {
  const { context, page } = await openPage();
  try {
    const legibility = await page.evaluate(
      (mount) => {
        eval(mount);
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div data-testid="cellInnerDiv"><article data-testid="tweet">
             <a href="/alice/status/1900000000000000"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
             <div data-testid="User-Name"><a href="/alice">@alice</a></div>
           </article></div>`
        );
        const settings = AviaryLook.cloneSettings(AviaryLook.DEFAULT_SETTINGS);
        settings.i18n.locale = "en";
        settings.hidden.enabled = true;
        const ctx = {
          settings,
          route: { surface: "home", path: "/home" },
          storage: { async get(_k, f) { return f; }, async set() {}, async remove() {} },
          diagnostics: { info() {}, warn() {}, error() {} }
        };
        return Promise.resolve(AviaryLook.hiddenPostsFeature.init(ctx))
          .then(() => AviaryLook.hiddenPostsFeature.apply(ctx, document))
          .then(() => new Promise((resolve) => setTimeout(resolve, 30)))
          .then(() => {
            const button = document.querySelector(".av-hide-button");
            if (!button) return { missing: true };
            const style = getComputedStyle(button);
            const opacity = Number(style.opacity);
            const text = window.parseColor(style.color);
            // Opacity multiplies the text against whatever is behind it.
            const faded = {
              r: text.r * opacity,
              g: text.g * opacity,
              b: text.b * opacity,
              a: 1
            };
            return {
              opacity,
              ratio: window.contrast(faded, window.effectiveBackground(button)),
              focusVisible: Boolean(
                [...document.styleSheets].some((sheet) => {
                  try {
                    return [...sheet.cssRules].some((rule) =>
                      rule.selectorText?.includes(".av-hide-button:focus-visible")
                    );
                  } catch {
                    return false;
                  }
                })
              )
            };
          });
      },
      MOUNT("(settings) => { settings.appearance.theme = 'dim'; }")
    );

    assert.ok(!legibility.missing, "the hide control was not drawn on a timeline post");
    assert.ok(legibility.opacity >= 0.7, `resting opacity ${legibility.opacity} is too faint to discover`);
    assert.ok(
      legibility.ratio >= 3,
      `the hide label renders at ${legibility.ratio.toFixed(2)}:1 against the timeline`
    );
    assert.equal(legibility.focusVisible, true, "a keyboard user needs a visible focus ring");
  } finally {
    await context.close();
  }
});

test("every rail destination carries its own icon, accent and page summary", async () => {
  const { context, page } = await openPage();
  try {
    const pages = await page.evaluate(async (mount) => {
      const shadow = eval(mount);
      const ids = [...shadow.querySelectorAll(".av-nav-item")].map((item) => item.dataset.avSection);
      const seen = [];
      for (const id of ids) {
        shadow.querySelector(`.av-nav-item[data-av-section="${id}"]`).click();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const section = shadow.querySelector(".av-content .av-section");
        seen.push({
          id,
          icon: Boolean(section.querySelector(".av-page-icon")),
          accent: section.style.getPropertyValue("--av-page-accent").trim(),
          kicker: section.querySelector(".av-page-kicker")?.textContent?.trim() ?? "",
          title: section.querySelector(".av-section-title")?.textContent?.trim() ?? "",
          summary: section.querySelector(".av-page-summary")?.textContent?.trim() ?? ""
        });
      }
      return seen;
    }, MOUNT("(settings) => { settings.appearance.theme = 'dim'; }"));

    assert.ok(pages.length >= 13, `expected at least 13 destinations, found ${pages.length}`);
    for (const entry of pages) {
      assert.equal(entry.icon, true, `${entry.id} renders no page icon`);
      assert.match(entry.accent, /^rgb/, `${entry.id} has no accent of its own`);
      assert.ok(entry.summary.length > 0, `${entry.id} has no page summary`);
      assert.ok(entry.title.length > 0, `${entry.id} has no title`);
      assert.ok(entry.kicker.length > 0, `${entry.id} does not say which group it belongs to`);
    }
    // Distinct accents are the point of the system; one shared colour is the thing it replaced.
    assert.ok(new Set(pages.map((entry) => entry.accent)).size >= 8, "destinations share too many accents");
    assert.equal(new Set(pages.map((entry) => entry.summary)).size, pages.length, "summaries must be distinct");
  } finally {
    await context.close();
  }
});

test("preset cards are illustrated and say what they change", async () => {
  const { context, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  try {
    const board = await page.evaluate(async (mount) => {
      const shadow = await eval(mount);
      shadow.querySelector('.av-nav-item[data-av-section="presets"]').click();
      const grid = shadow.querySelector('.av-section[data-av-section="presets"] .av-page-grid');
      const cards = [...grid.querySelectorAll(".av-preset-card")];
      return {
        unavailable: Boolean(
          [...grid.querySelectorAll(".av-row-label")].some((node) => node.textContent === "Presets") &&
            cards.length === 0
        ),
        cards: cards.length,
        withIcon: cards.filter((card) => card.querySelector(".av-preset-header svg")).length,
        withHighlights: cards.filter((card) => card.querySelector(".av-preset-highlights")).length,
        withApply: cards.filter((card) => card.querySelector("button")).length
      };
    }, MOUNT_FEATURE);

    assert.equal(board.unavailable, false, "the panel fell back to 'Preset packs unavailable'");
    assert.ok(board.cards >= 3, `the preset board offers ${board.cards} presets`);
    assert.equal(board.withIcon, board.cards, "every preset card needs its own illustration");
    assert.equal(board.withHighlights, board.cards, "every preset card must say what it changes");
    assert.equal(board.withApply, board.cards, "and must be applicable");
  } finally {
    await context.close();
  }
});

test("row-heavy destinations use a two-column board, and collapse when narrow", async () => {
  const read = async (width) => {
    const { context, page } = await openPage({ viewport: { width, height: 900 } });
    try {
      return await page.evaluate(
        ({ mount, sections }) => {
          const shadow = eval(mount);
          const out = {};
          for (const id of sections) {
            shadow.querySelector(`.av-nav-item[data-av-section="${id}"]`).click();
            const grid = shadow.querySelector(`.av-section[data-av-section="${id}"] .av-page-grid`);
            out[id] = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
          }
          return out;
        },
        {
          mount: MOUNT("(settings) => { settings.appearance.theme = 'dim'; }"),
          sections: ["appearance", "hidden", "performance"]
        }
      );
    } finally {
      await context.close();
    }
  };

  const wide = await read(1440);
  const narrow = await read(700);

  for (const [id, columns] of Object.entries(wide)) {
    assert.equal(columns, 2, `${id} renders in ${columns} column(s) on a wide window`);
  }
  for (const [id, columns] of Object.entries(narrow)) {
    assert.equal(columns, 1, `${id} still renders in ${columns} columns at 700px`);
  }
});

test("a nav rail that overflows says so, and can still be scrolled", async () => {
  // Thirteen destinations overflow a short viewport. The last item rendered used to cut through
  // its own baseline with nothing to say there was more below it.
  const { context, page } = await openPage({ viewport: { width: 1280, height: 420 } });
  try {
    const rail = await page.evaluate((mount) => {
      const shadow = eval(mount);
      const nav = shadow.querySelector(".av-nav");
      const style = getComputedStyle(nav);
      const before = nav.scrollTop;
      nav.scrollTop = nav.scrollHeight;
      return {
        overflows: nav.scrollHeight > nav.clientHeight + 1,
        overflowY: style.overflowY,
        mask: style.maskImage || style.webkitMaskImage,
        gutter: style.scrollbarGutter,
        scrolledFrom: before,
        scrolledTo: nav.scrollTop
      };
    }, MOUNT("(settings) => { settings.appearance.theme = 'dim'; }"));

    assert.equal(rail.overflows, true, "the rail must actually overflow at this height");
    assert.equal(rail.overflowY, "auto", "an overflowing rail that cannot scroll strands its last items");
    assert.match(rail.mask, /linear-gradient/, "a fade is what tells the reader there is more below");
    assert.equal(rail.gutter, "stable", "the rail must not reflow the moment it becomes scrollable");
    assert.ok(rail.scrolledTo > rail.scrolledFrom, "the rail did not scroll");
  } finally {
    await context.close();
  }
});

test("the panel says which build it is running, as data rather than copy", async () => {
  const { context, page } = await openPage();
  try {
    const stamp = await page.evaluate(
      ({ english, japanese }) => {
        const read = (mount) => {
          document.getElementById("av-control-center")?.remove();
          const shadow = eval(mount);
          return shadow.querySelector(".av-version")?.textContent ?? null;
        };
        return { en: read(english), ja: read(japanese) };
      },
      {
        english: MOUNT('(settings) => { settings.i18n.locale = "en"; }'),
        japanese: MOUNT('(settings) => { settings.i18n.locale = "ja"; }')
      }
    );

    // Reloading an unpacked extension gives no signal about which build took effect unless the
    // running code says so.
    assert.equal(stamp.en, `v${BUILD_VERSION}`, `the panel shows "${stamp.en}" instead of the build version`);
    // A version number is data. Routing it through the translator would put it in the coverage
    // tally and invite a locale to "translate" it.
    assert.equal(stamp.ja, stamp.en, "the version must not change with the panel language");
  } finally {
    await context.close();
  }
});

test("no rendered copy advertises a shipped feature as unavailable", async () => {
  const { context, page } = await openPage();
  try {
    const copy = await page.evaluate(async (mount) => {
      const shadow = await eval(mount);
      // The tally resets on every render, so the strings have to be collected per destination
      // and unioned; reading it once at the end would only ever see the last section's copy.
      const seen = new Set();
      for (const id of [...shadow.querySelectorAll(".av-nav-item")].map((item) => item.dataset.avSection)) {
        shadow.querySelector(`.av-nav-item[data-av-section="${id}"]`).click();
        await new Promise((resolve) => setTimeout(resolve, 5));
        for (const line of AviaryLook.renderedPanelStrings()) seen.add(line);
      }
      return [...seen];
    }, MOUNT_FEATURE);

    assert.ok(copy.length > 50, `only ${copy.length} strings were rendered; the sweep did not run`);

    // Each of these described a state that stopped being true. Copy that names a version or an
    // unfinished item goes stale silently — the feature ships and the label keeps apologising.
    const stale = [
      /xlsx is deferred/i,
      /off until F\d+ lands/i,
      /Disabled by policy in v\d+\.\d+\.\d+/i,
      /press Save list to apply/i,
      /coming soon/i,
      /not (?:yet )?implemented/i,
      /nothing implements it yet/i,
      // Aviary can only rewrite a playlist it actually sees; a player fetching one inside a worker
      // never reaches it, so promising every video is an outcome the build cannot guarantee.
      /Always play video at the highest quality/i
    ];
    const offenders = copy.filter((line) => stale.some((pattern) => pattern.test(line)));
    assert.deepEqual(offenders, [], "the panel is advertising shipped features as unavailable");

    // Copy that describes a bounded effect has to be there in place of the promise it replaced.
    assert.ok(
      copy.some((line) => line.includes("Pin video playlists to their best rendition")),
      "the bounded video-quality label is gone"
    );

    // A version number anywhere in translated copy is the same failure in a different shape: it
    // gets counted for locale coverage and invites a translator to change it.
    const versioned = copy.filter((line) => /\bv\d+\.\d+\.\d+\b/.test(line));
    assert.deepEqual(versioned, [], "a version number reached translated copy");
  } finally {
    await context.close();
  }
});

test("turning on video quality reports what it actually rewrote", async () => {
  const { context, page } = await openPage();
  try {
    const row = await page.evaluate(() => {
      const settings = AviaryLook.cloneSettings(AviaryLook.DEFAULT_SETTINGS);
      settings.i18n.locale = "en";
      settings.performance.forceVideoQuality = true;
      AviaryLook.mountControlCenter({
        settings,
        diagnostics: () => [],
        onChange: async () => {},
        onError: () => {},
        getPageHooks: () => ({ rewrittenPlaylists: 3, blockedBeacons: 0, blockedAdRequests: 0 })
      });
      const shadow = document.getElementById("av-control-center").shadowRoot;
      shadow.querySelector(".av-launcher").click();
      shadow.querySelector('.av-nav-item[data-av-section="performance"]').click();
      const found = [...shadow.querySelectorAll(".av-row")].find(
        (candidate) => candidate.dataset.avLabel === "Playlists rewritten"
      );
      return found?.querySelector(".av-row-description")?.textContent ?? null;
    });

    // The setting used to promise every video would play at its best quality. Aviary can only
    // rewrite a playlist it actually sees, and a player fetching one inside a worker never
    // reaches it -- so the panel reports the count instead of asserting the outcome.
    assert.ok(row, "the panel does not report how many playlists were rewritten");
    assert.match(row, /3/, `the count is not the one the page hooks reported: ${row}`);
  } finally {
    await context.close();
  }
});
