import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Filtering on the shape of a post rather than its words.
 *
 * Both halves are asserted against the saved captures, because both depend on markup this
 * repository does not control. A quote post is structural and became a `:has()` rule; an
 * engagement floor reads a number and compares it, which no selector can do, so it stayed in JS.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-shape-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { filterEngineFeature } from ${JSON.stringify(abs("src/features/filtering/filter-engine.ts"))};`,
      `export { extractTweetSignal, readEngagementCount, compileFilters, judge, STRUCTURAL_SELECTORS } from ${JSON.stringify(abs("src/features/filtering/predicates.ts"))};`,
      `export { quotedPost } from ${JSON.stringify(abs("src/features/media/extract.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryShape",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Loads a saved capture and installs the helpers each test drives the engine through. */
async function openCapture(name, surface) {
  await page.goto(`file://${abs(`_decoded/${name}.html`)}`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate((route) => {
    window.run = (mutate) => {
      const settings = AviaryShape.cloneSettings(AviaryShape.DEFAULT_SETTINGS);
      settings.filter.enabled = true;
      mutate?.(settings);
      const ctx = {
        settings,
        route: { surface: route, path: `/${route}` },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      AviaryShape.filterEngineFeature.init(ctx);
      const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
      const state = articles.map((article) => ({
        hidden: getComputedStyle(article).display === "none",
        opacity: Number(getComputedStyle(article).opacity)
      }));
      AviaryShape.filterEngineFeature.destroy(ctx);
      return state;
    };
  }, surface);
}

test("the quote predicate in CSS and quotedPost() in JS agree on the real capture", async () => {
  // Two implementations of the same question, and neither one can be checked against the other by
  // reading it: `quotedPost` qualifies a bare `role=link` by looking inside it, and the stylesheet
  // has to express that as a descendant because `:has()` cannot nest. If they ever disagree, one
  // of the two features is wrong about what a quote post is.
  for (const capture of ["home", "status"]) {
    await openCapture(capture, capture === "home" ? "home" : "status");
    const rows = await page.evaluate(() => {
      const selector = AviaryShape.STRUCTURAL_SELECTORS.quote.join(", ");
      return [...document.querySelectorAll('article[data-testid="tweet"]')].map((article) => ({
        css: article.querySelector(selector) !== null,
        js: AviaryShape.quotedPost(article) !== null
      }));
    });

    assert.ok(rows.length > 0, `${capture} must contain posts`);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.css, row.js, `${capture} post ${index}: CSS said ${row.css}, JS said ${row.js}`);
    }
    const quotes = rows.filter((row) => row.js).length;
    assert.ok(quotes > 0, `${capture} must contain at least one quote post to prove anything`);
  }
});

test("a role=link card inside a post is not a quote", async () => {
  // The captures cannot decide this one: every `div[role="link"][tabindex="0"]` that sits inside
  // an article in either capture *is* a quoted post, so the bare selector and the qualified one
  // agree there and the test above would pass without the qualifier. This is the case where they
  // disagree -- X uses the same role for cards, and a predicate that only looked for the role
  // would file a link preview as a quote.
  const outcome = await page.evaluate(() => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv">
        <article id="card" data-testid="tweet">
          <div data-testid="User-Name"><a href="/alice">@alice</a></div>
          <div data-testid="tweetText">read this</div>
          <div role="link" tabindex="0"><div data-testid="card.wrapper">example.com</div></div>
        </article>
      </div>
      <div data-testid="cellInnerDiv">
        <article id="quote" data-testid="tweet">
          <div data-testid="User-Name"><a href="/bob">@bob</a></div>
          <div data-testid="tweetText">look what they said</div>
          <div role="link" tabindex="0">
            <div data-testid="User-Name"><a href="/carol">@carol</a></div>
            <div data-testid="tweetText">the quoted post</div>
          </div>
        </article>
      </div>`;
    const selector = AviaryShape.STRUCTURAL_SELECTORS.quote.join(", ");
    const state = window.run((s) => {
      s.filter.quotePosts = "hide";
    });
    return {
      cardIsQuoteJs: AviaryShape.quotedPost(document.getElementById("card")) !== null,
      quoteIsQuoteJs: AviaryShape.quotedPost(document.getElementById("quote")) !== null,
      cardIsQuoteCss: document.getElementById("card").querySelector(selector) !== null,
      quoteIsQuoteCss: document.getElementById("quote").querySelector(selector) !== null,
      cardHidden: state[0].hidden,
      quoteHidden: state[1].hidden
    };
  });

  assert.equal(outcome.cardIsQuoteJs, false, "a link card is not a quoted post");
  assert.equal(outcome.cardIsQuoteCss, false, "and the stylesheet must not think it is either");
  assert.equal(outcome.quoteIsQuoteJs, true);
  assert.equal(outcome.quoteIsQuoteCss, true);
  assert.equal(outcome.cardHidden, false, "the post carrying a link card must survive");
  assert.equal(outcome.quoteHidden, true, "the post carrying a quote must not");
});

test("hiding quote posts hides exactly the post that quotes, on the real capture", async () => {
  await openCapture("status", "status");
  const { quoting, hidden, untouched } = await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const quoting = articles
      .map((article, index) => (AviaryShape.quotedPost(article) ? index : -1))
      .filter((index) => index >= 0);
    const state = window.run((s) => {
      s.filter.quotePosts = "hide";
    });
    const untouched = window.run(() => {});
    return {
      quoting,
      hidden: state.map((entry, index) => (entry.hidden ? index : -1)).filter((i) => i >= 0),
      untouched: untouched.filter((entry) => entry.hidden).length
    };
  });

  assert.deepEqual(hidden, quoting, "the quote filter must select the quoting posts and no others");
  assert.equal(untouched, 0, "control: with the filter off, nothing on this capture is hidden");
});

test("a count is read at full precision from the button, not from its abbreviated text", async () => {
  // X renders "11K" and puts "11636 Likes. Like" on the same button's aria-label. Reading the
  // visible text would round a floor of 11500 into the wrong answer.
  await openCapture("home", "home");
  const rows = await page.evaluate(() => {
    return [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, 4).map((article) => ({
      likes: AviaryShape.readEngagementCount(article, "likes"),
      replies: AviaryShape.readEngagementCount(article, "replies"),
      reposts: AviaryShape.readEngagementCount(article, "reposts"),
      visible: (article.querySelector('[data-testid="like"]')?.textContent ?? "").trim()
    }));
  });

  const abbreviated = rows.filter((row) => /[KM]/i.test(row.visible));
  assert.ok(abbreviated.length > 0, "the capture must contain an abbreviated count to prove this");
  for (const row of abbreviated) {
    assert.ok(Number.isInteger(row.likes), `likes came back as ${row.likes}`);
    // "11K" would parse to 11000; the label says 11636. Any exact count fails that rounding.
    assert.notEqual(row.likes % 1000, 0, `${row.likes} looks like it came from "${row.visible}"`);
  }
  for (const row of rows) {
    assert.ok(row.replies >= 0 && row.reposts >= 0 && row.likes >= 0);
  }
});

test("a zero count is read as zero, not as unreadable", async () => {
  // The button's text is empty at zero and its label says "0 Replies". Falling back to the text
  // would make a post with no replies indistinguishable from one whose count could not be read --
  // and the unreadable case is deliberately never filtered.
  await openCapture("status", "status");
  const counts = await page.evaluate(() =>
    [...document.querySelectorAll('article[data-testid="tweet"]')].map((article) => ({
      replies: AviaryShape.readEngagementCount(article, "replies"),
      text: (article.querySelector('[data-testid="reply"]')?.textContent ?? "").trim()
    }))
  );

  const blank = counts.filter((entry) => entry.text === "");
  assert.ok(blank.length > 0, "the status capture is known to contain posts with no replies");
  for (const entry of blank) {
    assert.equal(entry.replies, 0, "an empty reply button is zero replies, not unknown");
  }
});

test("an engagement floor hides the posts under it and leaves the rest", async () => {
  await openCapture("home", "home");
  const result = await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const likes = articles.map((article) => AviaryShape.readEngagementCount(article, "likes"));
    const sorted = [...likes].filter((value) => value !== null).sort((a, b) => a - b);
    // A floor between the smallest and largest count, so both outcomes are represented.
    const floor = sorted[Math.floor(sorted.length / 2)];
    const state = window.run((s) => {
      s.filter.engagementRule = "hide";
      s.filter.engagementMetric = "likes";
      s.filter.engagementMin = floor;
    });
    return {
      floor,
      likes,
      hidden: state.map((entry) => entry.hidden)
    };
  });

  assert.ok(result.floor > 0, "the capture must carry readable like counts");
  const expected = result.likes.map((count) => count !== null && count < result.floor);
  assert.deepEqual(result.hidden, expected, "the floor must select exactly the posts under it");
  assert.ok(expected.some(Boolean), "the floor must hide something");
  assert.ok(expected.some((value) => !value), "and must leave something alone");
});

test("the metric the floor reads is the one the setting names", async () => {
  await openCapture("home", "home");
  const result = await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const read = (metric) => articles.map((a) => AviaryShape.readEngagementCount(a, metric));
    const byMetric = {};
    for (const metric of ["replies", "reposts", "likes"]) {
      byMetric[metric] = {
        counts: read(metric),
        hidden: window
          .run((s) => {
            s.filter.engagementRule = "hide";
            s.filter.engagementMetric = metric;
            s.filter.engagementMin = 100;
          })
          .map((entry) => entry.hidden)
      };
    }
    return byMetric;
  });

  for (const [metric, data] of Object.entries(result)) {
    assert.deepEqual(
      data.hidden,
      data.counts.map((count) => count !== null && count < 100),
      `the ${metric} floor did not select on ${metric}`
    );
  }
  // The three metrics must actually differ on this capture, or the test above proves nothing.
  assert.notDeepEqual(
    result.replies.hidden,
    result.likes.hidden,
    "replies and likes selected the same posts; the metric setting is not being read"
  );
});

test("a post whose count cannot be read is never filtered on it", async () => {
  const outcome = await page.evaluate(() => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv">
        <article id="counted" data-testid="tweet">
          <div data-testid="User-Name"><a href="/alice">@alice</a></div>
          <div data-testid="tweetText">counted</div>
          <button data-testid="like" aria-label="3 Likes. Like">3</button>
        </article>
      </div>
      <div data-testid="cellInnerDiv">
        <article id="uncounted" data-testid="tweet">
          <div data-testid="User-Name"><a href="/bob">@bob</a></div>
          <div data-testid="tweetText">no action bar at all</div>
        </article>
      </div>`;
    const state = window.run((s) => {
      s.filter.engagementRule = "hide";
      s.filter.engagementMetric = "likes";
      s.filter.engagementMin = 50;
    });
    return {
      counted: state[0].hidden,
      uncounted: state[1].hidden,
      read: AviaryShape.readEngagementCount(document.getElementById("uncounted"), "likes")
    };
  });

  assert.equal(outcome.read, null, "a post with no like button has no count to read");
  assert.equal(outcome.counted, true, "control: a post under the floor is hidden");
  assert.equal(
    outcome.uncounted,
    false,
    "an unreadable count is not evidence of a low one and must not filter the post"
  );
});

test("a floor of zero filters nothing, and costs nothing to leave off", async () => {
  await openCapture("home", "home");
  const result = await page.evaluate(() => {
    const seen = [];
    const original = Element.prototype.querySelector;
    Element.prototype.querySelector = function patched(selector) {
      seen.push(selector);
      return original.call(this, selector);
    };
    const countsRead = (mutate) => {
      seen.length = 0;
      const state = window.run(mutate);
      return {
        hidden: state.filter((entry) => entry.hidden).length,
        // The engagement buttons are only ever queried by the count reader.
        queries: seen.filter((selector) => selector.includes('data-testid="like"')).length
      };
    };

    const off = countsRead((s) => {
      s.filter.engagementRule = "off";
      s.filter.engagementMin = 5000;
    });
    const zero = countsRead((s) => {
      s.filter.engagementRule = "hide";
      s.filter.engagementMin = 0;
    });
    const on = countsRead((s) => {
      s.filter.engagementRule = "hide";
      s.filter.engagementMin = 5000;
    });

    Element.prototype.querySelector = original;
    return { off, zero, on };
  });

  assert.equal(result.zero.hidden, 0, "zero is the off position for a minimum, not a floor");
  assert.equal(result.off.hidden, 0, "and the action switch must reach the engine");
  assert.ok(result.on.hidden > 0, "control: a real floor hides posts on this capture");
  // The counts are read lazily, so a floor nobody asked for must not walk every post looking for
  // buttons -- the same reason the media predicates left JS in the first place.
  assert.equal(result.off.queries, 0, "the action being off must skip the count reader entirely");
  assert.equal(result.zero.queries, 0, "and so must a minimum of zero");
  assert.ok(result.on.queries > 0, "control failed -- a live floor must read the counts");
});

test("both shape settings survive normalization and reject nonsense", async () => {
  const normalized = await page.evaluate(() => {
    const bad = AviaryShape.normalizeSettings({
      filter: { quotePosts: "obliterate", engagementMetric: "vibes", engagementMin: -40 }
    });
    const good = AviaryShape.normalizeSettings({
      filter: { quotePosts: "dim", engagementMetric: "reposts", engagementMin: 250 }
    });
    return {
      bad: {
        quotePosts: bad.filter.quotePosts,
        engagementMetric: bad.filter.engagementMetric,
        engagementMin: bad.filter.engagementMin
      },
      good: {
        quotePosts: good.filter.quotePosts,
        engagementMetric: good.filter.engagementMetric,
        engagementMin: good.filter.engagementMin
      },
      defaults: {
        quotePosts: AviaryShape.DEFAULT_SETTINGS.filter.quotePosts,
        engagementRule: AviaryShape.DEFAULT_SETTINGS.filter.engagementRule,
        engagementMin: AviaryShape.DEFAULT_SETTINGS.filter.engagementMin
      }
    };
  });

  assert.deepEqual(normalized.bad, { quotePosts: "off", engagementMetric: "likes", engagementMin: 0 });
  assert.deepEqual(normalized.good, {
    quotePosts: "dim",
    engagementMetric: "reposts",
    engagementMin: 250
  });
  // Nothing new may filter a timeline until it is asked to.
  assert.deepEqual(normalized.defaults, {
    quotePosts: "off",
    engagementRule: "off",
    engagementMin: 0
  });
});

/**
 * A post with no words matches no word rule.
 *
 * X renders no `tweetText` node for a media-only post, and the text reader used to fall back to
 * the whole article. That made the haystack the display name, the handle, the relative timestamp
 * and every engagement count, so a keyword rule hid a photo because its author is called
 * "Crypto Guy" -- and the reason line told the reader their keyword had done it. A numeric pattern
 * matched the like count and then stopped matching as the count ticked over.
 */
test("a post with no caption is not filtered on its author, timestamp or counts", async () => {
  const result = await page.evaluate(() => {
    document.body.replaceChildren();
    const build = (withCaption) => {
      const article = document.createElement("article");
      article.setAttribute("data-testid", "tweet");
      const name = document.createElement("div");
      name.setAttribute("data-testid", "User-Name");
      const displayName = document.createElement("span");
      displayName.textContent = "Crypto Guy";
      const handle = document.createElement("a");
      handle.setAttribute("href", "/cryptoguy");
      handle.textContent = "@cryptoguy";
      const time = document.createElement("time");
      time.textContent = "2h";
      name.append(displayName, handle, time);
      const status = document.createElement("a");
      status.setAttribute("href", "/cryptoguy/status/123");
      const group = document.createElement("div");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "actions");
      const likes = document.createElement("span");
      likes.textContent = "12";
      group.append(likes);
      const photo = document.createElement("div");
      photo.setAttribute("data-testid", "tweetPhoto");
      article.append(name, status, group, photo);
      if (withCaption) {
        const text = document.createElement("div");
        text.setAttribute("data-testid", "tweetText");
        text.textContent = "a crypto photo";
        article.append(text);
      }
      document.body.append(article);
      return article;
    };

    const filters = AviaryShape.compileFilters({
      keywords: ["crypto"],
      regex: [],
      whitelist: [],
      premium: "off",
      media: {},
      generation: 1
    });

    const mediaOnly = build(false);
    const captioned = build(true);
    return {
      mediaOnlyText: AviaryShape.extractTweetSignal(mediaOnly).text,
      mediaOnly: AviaryShape.judge(AviaryShape.extractTweetSignal(mediaOnly), filters).action,
      captioned: AviaryShape.judge(AviaryShape.extractTweetSignal(captioned), filters).action
    };
  });

  assert.equal(result.mediaOnlyText, "");
  assert.equal(result.mediaOnly, "show");
  // The control proves the rule still works: the same keyword in the post's own words hides it.
  assert.equal(result.captioned, "hide");
});
