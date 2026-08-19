import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The structural half of the filter engine.
 *
 * "Does this post contain a photo?" and "does it carry the verified badge?" are questions about
 * the article's subtree and nothing else, so they are `:has()` rules in the stylesheet the engine
 * emits rather than five `querySelector` calls per article per mutation batch. Everything here is
 * asserted against computed style, because after the move that is the only place the outcome
 * exists -- there is no attribute to read.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const POSTS = [
  { id: "plain", handle: "alice", text: "an ordinary post" },
  { id: "photo", handle: "bob", text: "look at this", photo: true },
  { id: "video", handle: "carol", text: "a clip", video: true },
  { id: "gif", handle: "dave", text: "reaction", gif: true },
  { id: "verified", handle: "erin", text: "a paid post", verified: true },
  { id: "verified-allowed", handle: "frank", text: "a paid post from a friend", verified: true },
  { id: "photo-allowed", handle: "frank", text: "a photo from a friend", photo: true },
  { id: "photo-dimmed", handle: "grace", text: "dim me", photo: true }
];

const FIXTURE = `
<main data-testid="primaryColumn">
${POSTS.map(
  (post) => `
  <div id="cell-${post.id}" data-testid="cellInnerDiv">
    <article id="post-${post.id}" data-testid="tweet">
      <div data-testid="User-Name"><a href="/${post.handle}"><span>@${post.handle}</span></a>${
        post.verified ? '<svg data-testid="icon-verified"></svg>' : ""
      }</div>
      <div data-testid="tweetText">${post.text}</div>
      ${post.photo ? '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/x?format=jpg"></div>' : ""}
      ${post.video ? '<div data-testid="videoPlayer"></div>' : ""}
      ${post.gif ? '<div data-testid="videoComponent" aria-label="Embedded video GIF"></div>' : ""}
    </article>
  </div>`
).join("")}
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-structural-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { filterEngineFeature } from ${JSON.stringify(abs("src/features/filtering/filter-engine.ts"))};`,
      `export { STRUCTURAL_SELECTORS } from ${JSON.stringify(abs("src/features/filtering/predicates.ts"))};`,
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
    globalName: "AviaryStructural",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.render = (mutate) => {
      const settings = AviaryStructural.cloneSettings(AviaryStructural.DEFAULT_SETTINGS);
      settings.filter.enabled = true;
      mutate?.(settings);
      const ctx = {
        settings,
        route: { surface: "home", path: "/home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      AviaryStructural.filterEngineFeature.init(ctx);
      return ctx;
    };
    /** display and opacity per post id -- the reader-visible outcome, whichever half produced it. */
    window.report = () => {
      const out = {};
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        const cell = article.closest('[data-testid="cellInnerDiv"]');
        out[article.id.replace(/^post-/, "")] = {
          hidden: getComputedStyle(article).display === "none",
          cellHidden: getComputedStyle(cell).display === "none",
          opacity: Number(getComputedStyle(article).opacity)
        };
      }
      return out;
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function run(mutate, html = FIXTURE) {
  return page.evaluate(
    async ({ fixture, source }) => {
      document.body.innerHTML = fixture;
      // eslint-disable-next-line no-new-func
      const ctx = window.render(new Function(`return (${source})`)());
      const report = window.report();
      AviaryStructural.filterEngineFeature.destroy(ctx);
      return { report, afterDestroy: window.report() };
    },
    { fixture: html, source: mutate.toString() }
  );
}

test("a media setting hides the posts that carry that media, and collapses their rows", async () => {
  const { report } = await run((s) => {
    s.filter.mediaTypes = { photo: true, video: false, gif: false };
  });

  assert.equal(report.photo.hidden, true, "a photo post must hide when photos are filtered");
  assert.equal(
    report.photo.cellHidden,
    true,
    "the owning row must collapse too, or the virtualizer leaves a full-height gap"
  );
  assert.equal(report.plain.hidden, false, "a text-only post is untouched");
  assert.equal(report.video.hidden, false, "a video post is untouched by the photo setting");
  assert.equal(report.plain.cellHidden, false);
});

test("hiding video hides GIFs, because a GIF is a video player to X", async () => {
  const { report } = await run((s) => {
    s.filter.mediaTypes = { photo: false, video: true, gif: false };
  });

  assert.equal(report.video.hidden, true);
  assert.equal(report.gif.hidden, true, "the GIF implication survived the move to CSS");
  assert.equal(report.photo.hidden, false);
});

test("the verified setting hides or dims according to the action, and never both", async () => {
  const hide = await run((s) => {
    s.filter.premiumRule = "hide";
  });
  assert.equal(hide.report.verified.hidden, true);
  assert.equal(hide.report.verified.cellHidden, true);
  assert.equal(hide.report.plain.hidden, false);

  const dim = await run((s) => {
    s.filter.premiumRule = "dim";
  });
  assert.equal(dim.report.verified.hidden, false, "set to dim, it must not hide");
  assert.ok(dim.report.verified.opacity < 1, `dim left opacity at ${dim.report.verified.opacity}`);
  assert.equal(dim.report.verified.cellHidden, false, "a dimmed post must keep its row");
  assert.equal(dim.report.plain.opacity, 1);
});

test("an allowlisted author outranks a structural hide", async () => {
  // The whitelist is the one predicate that can override a structural rule, and it cannot be
  // expressed in CSS -- a selector cannot normalize a handle out of an href. So the JS half
  // publishes the exemption as a decision and every structural rule steps over it.
  const { report } = await run((s) => {
    s.filter.mediaTypes = { photo: true, video: false, gif: false };
    s.filter.premiumRule = "hide";
    s.filter.whitelist = ["frank"];
  });

  assert.equal(report["photo-allowed"].hidden, false, "frank's photo post must survive");
  assert.equal(report["photo-allowed"].cellHidden, false, "and so must its row");
  assert.equal(report["verified-allowed"].hidden, false, "frank's verified post must survive");
  // The control: the same two predicates still hide everyone else.
  assert.equal(report.photo.hidden, true);
  assert.equal(report.verified.hidden, true);
});

test("a rule that dims a post beats a structural rule that would hide it", async () => {
  // Precedence the JS engine had built in: rules run before media, so a dim rule won. Structural
  // rules are guarded on the article carrying no decision, which is what preserves that.
  const { report } = await run((s) => {
    s.filter.mediaTypes = { photo: true, video: false, gif: false };
    s.filter.rules = ["dim: handle is grace"];
  });

  assert.equal(report["photo-dimmed"].hidden, false, "the dim rule must win over the media hide");
  assert.ok(report["photo-dimmed"].opacity < 1, "and it must actually dim");
  assert.equal(report.photo.hidden, true, "control: an unruled photo post still hides");
});

test("media that arrives after the post was stamped is still caught", async () => {
  // The JS pass stamps an article with the current generation and never looks at it again, so a
  // photo that renders late was invisible to it for the life of the timeline. A `:has()` rule has
  // no stamp to go stale.
  const result = await page.evaluate(
    async ({ fixture }) => {
      document.body.innerHTML = fixture;
      const ctx = window.render((s) => {
        s.filter.mediaTypes = { photo: true, video: false, gif: false };
      });

      const article = document.getElementById("post-plain");
      const before = getComputedStyle(article).display;

      const photo = document.createElement("div");
      photo.setAttribute("data-testid", "tweetPhoto");
      photo.innerHTML = '<img src="https://pbs.twimg.com/media/late?format=jpg">';
      article.append(photo);
      // No re-apply: this is what the engine sees when X fills a post in place.
      const after = getComputedStyle(article).display;
      const cell = getComputedStyle(article.closest('[data-testid="cellInnerDiv"]')).display;

      AviaryStructural.filterEngineFeature.destroy(ctx);
      return { before, after, cell };
    },
    { fixture: FIXTURE }
  );

  assert.notEqual(result.before, "none", "the post must start visible");
  assert.equal(result.after, "none", "late media must be caught without another pass");
  assert.equal(result.cell, "none", "and the row must collapse with it");
});

test("a post the engine has not judged yet is not hidden by a structural rule", async () => {
  // The two halves have to agree on when a post has been looked at. A rule that fired on an
  // unstamped article would hide an allowlisted author's photo post for the window between X
  // rendering it and the engine judging it -- and the exemption is the one thing CSS cannot
  // express, so it would flash hidden and then come back.
  const result = await page.evaluate(
    async ({ fixture }) => {
      document.body.innerHTML = fixture;
      const ctx = window.render((s) => {
        s.filter.mediaTypes = { photo: true, video: false, gif: false };
        s.filter.whitelist = ["frank"];
      });

      const add = (id, handle) => {
        const cell = document.createElement("div");
        cell.setAttribute("data-testid", "cellInnerDiv");
        cell.innerHTML =
          `<article id="post-${id}" data-testid="tweet">` +
          `<div data-testid="User-Name"><a href="/${handle}"><span>@${handle}</span></a></div>` +
          `<div data-testid="tweetText">fresh</div>` +
          '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/n?format=jpg"></div>' +
          "</article>";
        document.querySelector('[data-testid="primaryColumn"]').append(cell);
        return document.getElementById(`post-${id}`);
      };

      const allowed = add("fresh-allowed", "frank");
      const other = add("fresh-other", "heidi");
      const before = {
        allowed: getComputedStyle(allowed).display,
        other: getComputedStyle(other).display
      };

      await AviaryStructural.filterEngineFeature.apply(ctx, document);
      const after = {
        allowed: getComputedStyle(allowed).display,
        other: getComputedStyle(other).display
      };

      AviaryStructural.filterEngineFeature.destroy(ctx);
      return { before, after };
    },
    { fixture: FIXTURE }
  );

  assert.notEqual(
    result.before.allowed,
    "none",
    "an unjudged post from an allowlisted author must not flash hidden"
  );
  assert.notEqual(result.before.other, "none", "nor must any other unjudged post");
  assert.notEqual(result.after.allowed, "none", "and the exemption must hold once judged");
  assert.equal(result.after.other, "none", "control: once judged, the photo rule hides the rest");
});

test("no structural selector is run against an article when nothing asks for one", async () => {
  // The point of the move: with a keyword filter configured, the engine must not touch the media
  // or verified selectors at all. The probe records every selector the engine passes to
  // querySelector/querySelectorAll and compares it against the same table the CSS is emitted from,
  // so reintroducing either query in JS fails this.
  const observed = await page.evaluate(
    async ({ fixture }) => {
      document.body.innerHTML = fixture;
      const table = AviaryStructural.STRUCTURAL_SELECTORS;
      const structural = Object.values(table).flat();

      const seen = [];
      const originals = {
        one: Element.prototype.querySelector,
        all: Element.prototype.querySelectorAll
      };
      Element.prototype.querySelector = function patched(selector) {
        seen.push(selector);
        return originals.one.call(this, selector);
      };
      Element.prototype.querySelectorAll = function patchedAll(selector) {
        seen.push(selector);
        return originals.all.call(this, selector);
      };

      const record = (mutate) => {
        seen.length = 0;
        const ctx = window.render(mutate);
        const hits = structural.filter((needle) => seen.some((used) => used.includes(needle)));
        AviaryStructural.filterEngineFeature.destroy(ctx);
        return hits;
      };

      const keywordOnly = record((s) => {
        s.filter.keywordRules = ["ordinary"];
      });
      const mediaSetting = record((s) => {
        s.filter.mediaTypes = { photo: true, video: false, gif: false };
      });
      // A rule naming `media` genuinely needs the signal, so it must still be read -- that is the
      // control proving the probe can see these queries when they happen.
      const mediaRule = record((s) => {
        s.filter.rules = ["media is photo"];
      });

      Element.prototype.querySelector = originals.one;
      Element.prototype.querySelectorAll = originals.all;
      return { keywordOnly, mediaSetting, mediaRule, structural };
    },
    { fixture: FIXTURE }
  );

  assert.ok(observed.structural.length >= 4, "the structural table must not be empty");
  assert.deepEqual(
    observed.keywordOnly,
    [],
    "a keyword filter ran structural selectors it has no use for"
  );
  assert.deepEqual(
    observed.mediaSetting,
    [],
    "the media setting is answered by the stylesheet; JS must not query for it as well"
  );
  assert.ok(
    observed.mediaRule.length > 0,
    "control failed -- a rule naming media must still read the media signal"
  );
});

test("destroy removes the structural rules along with everything else", async () => {
  const { afterDestroy } = await run((s) => {
    s.filter.mediaTypes = { photo: true, video: true, gif: true };
    s.filter.premiumRule = "dim";
  });

  for (const [id, state] of Object.entries(afterDestroy)) {
    assert.equal(state.hidden, false, `${id} is still hidden after destroy`);
    assert.equal(state.cellHidden, false, `${id}'s row is still collapsed after destroy`);
    assert.equal(state.opacity, 1, `${id} is still dimmed after destroy`);
  }
});
