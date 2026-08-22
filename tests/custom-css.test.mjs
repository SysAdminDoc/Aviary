import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-custom-css-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { DEFAULT_SETTINGS, normalizeSettings, sanitizeCustomCss } from ${JSON.stringify(path.join(root, "src/platform/settings.ts").replace(/\\/g, "/"))};`,
      `export { applyCustomCss, buildScopedCustomCss } from ${JSON.stringify(path.join(root, "src/features/appearance/custom-css.ts").replace(/\\/g, "/"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCustomCss",
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

test("custom CSS is normalized, scoped, and removed with the override", async () => {
  const result = await page.evaluate(() => {
    document.body.innerHTML = `
      <nav aria-label="Primary"><a>Home</a></nav>
      <main data-testid="primaryColumn">
        <article data-testid="tweet"><p>Post</p><button data-av-media-button>Save</button></article>
      </main>
      <aside data-testid="sidebarColumn">Side</aside>`;
    const rules = {
      posts: "article { color: rgb(255, 0, 0); }",
      media: ".av-media-button { border-radius: 16px; }",
      navigation: "a { text-decoration: none; }",
      sidebar: "{ broken",
      composer: ""
    };
    AviaryCustomCss.applyCustomCss(rules);
    const applied = {
      style: document.getElementById("av-custom-css")?.textContent ?? "",
      postScope: document.querySelector("article")?.getAttribute("data-av-custom-css-scope"),
      mediaScope: document.querySelector("[data-av-media-button]")?.getAttribute("data-av-custom-css-scope"),
      navScope: document.querySelector("nav")?.getAttribute("data-av-custom-css-scope"),
      sideScope: document.querySelector("aside")?.getAttribute("data-av-custom-css-scope")
    };
    AviaryCustomCss.applyCustomCss({ posts: "", media: "", navigation: "", sidebar: "", composer: "" });
    return {
      applied,
      removed: {
        style: document.getElementById("av-custom-css"),
        postScope: document.querySelector("article")?.getAttribute("data-av-custom-css-scope"),
        navScope: document.querySelector("nav")?.getAttribute("data-av-custom-css-scope")
      }
    };
  });
  assert.match(result.applied.style, /@scope \(\[data-av-custom-css-scope~="posts"\]\)/);
  assert.match(result.applied.style, /@scope \(\[data-av-custom-css-scope~="media"\]\)/);
  assert.match(result.applied.style, /@scope \(\[data-av-custom-css-scope~="navigation"\]\)/);
  assert.equal(result.applied.postScope, "posts");
  assert.equal(result.applied.mediaScope, "media");
  assert.equal(result.applied.navScope, "navigation");
  assert.equal(result.applied.sideScope, null, "malformed CSS must not get a scope marker");
  assert.equal(result.removed.style, null);
  assert.equal(result.removed.postScope, null);
  assert.equal(result.removed.navScope, null);
});

test("custom CSS sanitization refuses network and script-like hooks", async () => {
  const result = await page.evaluate(() => {
    const clean = AviaryCustomCss.sanitizeCustomCss(".x { background: url(https://example.test/x); }");
    const bounded = AviaryCustomCss.sanitizeCustomCss("a { color: red; }".repeat(2000));
    const settings = AviaryCustomCss.normalizeSettings({
      appearance: { customCss: { posts: "article { color: red; }", media: "@import url(x);" } }
    });
    return { clean, bounded: bounded.value.length, settings: settings.appearance.customCss };
  });
  assert.equal(result.clean.value, "");
  assert.equal(result.clean.changed, true);
  assert.ok(result.bounded <= 12_000);
  assert.equal(result.settings.posts, "article { color: red; }");
  assert.equal(result.settings.media, "");
});

test("custom CSS scopes follow posts and controls added after the first pass", async () => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = "<main></main>";
    AviaryCustomCss.applyCustomCss({
      posts: "article { color: red; }",
      media: "",
      navigation: "",
      sidebar: "",
      composer: ""
    });
    const article = document.createElement("article");
    article.dataset.testid = "tweet";
    document.querySelector("main").append(article);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return article.getAttribute("data-av-custom-css-scope");
  });
  assert.equal(result, "posts");
});

test("custom CSS has a selector fallback below the @scope browser floor", async () => {
  const fallback = await page.evaluate(() =>
    AviaryCustomCss.buildScopedCustomCss(
      {
        posts: "article, .card > p { color: red; }",
        navigation: "@media (min-width: 1px) { a { text-decoration: none; } }"
      },
      false
    )
  );
  assert.doesNotMatch(fallback, /@scope/);
  assert.match(fallback, /article\[data-av-custom-css-scope~="posts"\]/);
  assert.match(fallback, /data-av-custom-css-scope~="posts"\] \.card\) > p/);
  assert.match(fallback, /@media \(min-width: 1px\)/);
  assert.match(fallback, /a\[data-av-custom-css-scope~="navigation"\]/);
});

/**
 * The sanitizer is the only gate on custom CSS, and custom CSS is not only self-typed: it rides a
 * shared settings file verbatim through parseSettingsImport and through a library restore.
 *
 * Three shapes got past the old blocklist. image-set() and cross-fade() take a bare <string> as a
 * URL, so neither needs the url( token the regex looked for. A CSS identifier escape spells url
 * without the regex ever seeing it, because the tokenizer unescapes before it resolves the
 * function name. And balancedCss let a quoted string run across a newline while the real tokenizer
 * ends it there, so braces it counted as "inside a string" were real block-closing tokens and the
 * rule escaped its generated @scope block onto the whole page.
 *
 * The controls in the second half matter as much as the attacks: a gate that refuses everything is
 * not a fix.
 */
test("custom CSS sanitization refuses every route to a remote file or a wider scope", async () => {
  const result = await page.evaluate((backslash) => {
    const refuse = {
      imageSet: 'p { background-image: image-set("https://evil.example/x.png" 1x); }',
      webkitImageSet: 'p { background-image: -webkit-image-set("https://evil.example/x.png" 1x); }',
      crossFade: 'p { background-image: cross-fade(image-set("https://evil.example/x.png" 1x) 50%, red); }',
      escapedUrl: 'p { background-image: ' + backslash + '75 rl("https://evil.example/x.png"); }',
      srcDescriptor: 'p { src: "https://evil.example/x.woff2"; }',
      escapeInSelector: '.a' + backslash + '75 rl { color: red; }',
      escapeAfterAClosedString: '.a { content: "ok"; background-image: ' + backslash + '75 rl("https://evil.example/x.png"); }',
      paintWorklet: "p { background-image: paint(evil); }",
      newlineBraceEscape: '.a { content: "x' + String.fromCharCode(10) + '}' + String.fromCharCode(10) + '}' + String.fromCharCode(10) + '#outside { outline: 5px solid rgb(0,128,0); }' + String.fromCharCode(10) + '"; }'
    };
    const keep = {
      declaration: ".card { color: red; }",
      nestedMedia: "@media (min-width: 1px) { .card { color: red; } }",
      attributeSelector: '[data-x="1"] > p { color: red; }',
      quotedContent: '.a::after { content: "hello"; }',
      comment: "/* note */ .a { color: red; }",
      colorMix: ".a { background: color-mix(in srgb, red 50%, blue); }",
      selectorList: ".a, .b > .c { color: red; }",
      // Already-stored CSS: an escape inside a string can only ever produce a character, so
      // tightening the rules must not silently delete a user's existing rule on upgrade.
      unicodeEscapeInAString: '.a::before { content: "' + backslash + '2192"; }',
      escapedQuoteInAString: '.a::before { content: "say ' + backslash + '"hi' + backslash + '""; }'
    };
    const accepted = {};
    for (const [name, css] of Object.entries(refuse)) {
      accepted[name] = AviaryCustomCss.sanitizeCustomCss(css).value.length > 0;
    }
    const preserved = {};
    for (const [name, css] of Object.entries(keep)) {
      preserved[name] = AviaryCustomCss.sanitizeCustomCss(css).value === css;
    }
    return { accepted, preserved };
  }, String.fromCharCode(92));

  for (const [name, wasAccepted] of Object.entries(result.accepted)) {
    assert.equal(wasAccepted, false, `${name} must be refused`);
  }
  for (const [name, wasPreserved] of Object.entries(result.preserved)) {
    assert.equal(wasPreserved, true, `${name} is ordinary CSS and must survive unchanged`);
  }
});

/**
 * The scoped output must be one rule, whatever it was handed.
 *
 * Measuring the emitted sheet rather than the sanitizer's verdict is the half that would have
 * caught the escape: the payload was accepted, and the browser then parsed three top-level rules
 * where the author expected one, painting an element outside the scope root.
 */
test("scoped custom CSS never emits a rule outside its own scope block", async () => {
  const outsideStyle = await page.evaluate(() => {
    document.body.innerHTML = '<article data-testid="tweet"></article><div id="outside">out</div>';
    const payload = '.a { content: "x' + String.fromCharCode(10) + '}' + String.fromCharCode(10) + '}' + String.fromCharCode(10) + '#outside { outline: 7px solid rgb(0, 128, 0); }' + String.fromCharCode(10) + '"; }';
    AviaryCustomCss.applyCustomCss({
      posts: payload,
      media: "",
      navigation: "",
      sidebar: "",
      composer: ""
    });
    const outside = getComputedStyle(document.getElementById("outside"));
    const style = document.getElementById("av-custom-css");
    return {
      // outline-width computes to 3px (medium) even when nothing is painted, so the style is the
      // property that actually says whether the payload reached this element.
      outlineStyle: outside.outlineStyle,
      topLevelRules: style?.sheet ? style.sheet.cssRules.length : 0
    };
  });

  assert.equal(outsideStyle.outlineStyle, "none");
  assert.ok(
    outsideStyle.topLevelRules <= 1,
    `the payload must not add top-level rules, saw ${outsideStyle.topLevelRules}`
  );
});
