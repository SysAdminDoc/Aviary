import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Why a post was suppressed.
 *
 * The reason has to come out of the same evaluation that made the decision. Working it out
 * afterwards would be a second implementation of the filter, and the two would eventually disagree
 * about a post the reader is looking at -- which is the failure this feature exists to prevent.
 *
 * Nothing is stored: the sentence lives on the article as an attribute the stylesheet reads with
 * `attr()`, and it comes off with every other decoration on destroy.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

const FIXTURE = `
<main data-testid="primaryColumn">
  <div data-testid="cellInnerDiv">
    <article id="post-rule" data-testid="tweet">
      <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
      <div data-testid="tweetText">weekend sale starts now</div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article id="post-keyword" data-testid="tweet">
      <div data-testid="User-Name"><a href="/bob"><span>@bob</span></a></div>
      <div data-testid="tweetText">buy crypto today</div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article id="post-regex" data-testid="tweet">
      <div data-testid="User-Name"><a href="/carol"><span>@carol</span></a></div>
      <div data-testid="tweetText">buy now while stocks last</div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article id="post-quiet" data-testid="tweet">
      <div data-testid="User-Name"><a href="/dave"><span>@dave</span></a></div>
      <div data-testid="tweetText">nobody read this one</div>
      <button data-testid="like" aria-label="2 Likes. Like">2</button>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article id="post-photo" data-testid="tweet">
      <div data-testid="User-Name"><a href="/erin"><span>@erin</span></a></div>
      <div data-testid="tweetText">a picture</div>
      <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/x?format=jpg"></div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article id="post-plain" data-testid="tweet">
      <div data-testid="User-Name"><a href="/frank"><span>@frank</span></a></div>
      <div data-testid="tweetText">an ordinary post</div>
      <button data-testid="like" aria-label="900 Likes. Like">900</button>
    </article>
  </div>
</main>`;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-reason-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { filterEngineFeature } from ${JSON.stringify(abs("src/features/filtering/filter-engine.ts"))};`,
      `export { compileFilters, judge, decide } from ${JSON.stringify(abs("src/features/filtering/predicates.ts"))};`,
      `export { compileRules } from ${JSON.stringify(abs("src/features/filtering/rules.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryReason",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><body>${FIXTURE}</body>`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    /** Runs the engine and reports what each post says about itself. */
    window.run = (mutate) => {
      const settings = AviaryReason.cloneSettings(AviaryReason.DEFAULT_SETTINGS);
      settings.filter.enabled = true;
      mutate?.(settings);
      const ctx = {
        settings,
        route: { surface: "home", path: "/home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      AviaryReason.filterEngineFeature.init(ctx);

      const state = {};
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        const id = article.id.replace(/^post-/, "");
        const style = getComputedStyle(article);
        state[id] = {
          reason: article.getAttribute("data-av-filter-reason"),
          result: article.getAttribute("data-av-filter-result"),
          display: style.display,
          // What `::before` actually resolves to, which is what the reader sees.
          before: getComputedStyle(article, "::before").content,
          height: article.getBoundingClientRect().height
        };
      }
      AviaryReason.filterEngineFeature.destroy(ctx);
      const after = {};
      for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
        after[article.id.replace(/^post-/, "")] = article.getAttribute("data-av-filter-reason");
      }
      return { state, after };
    };

    window.everything = (settings) => {
      settings.filter.rules = ["[Weekend sales] dim: text contains sale"];
      settings.filter.keywordRules = ["crypto"];
      // Written without delimiters on purpose: `String(new RegExp("buy now", "i"))` is
      // "/buy now/i", so a reason built from the compiled object would not match what was typed.
      settings.filter.regexRules = ["buy now"];
      settings.filter.mediaTypes = { photo: true, video: false, gif: false };
      settings.filter.engagementRule = "hide";
      settings.filter.engagementMetric = "likes";
      settings.filter.engagementMin = 100;
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("each suppressed post names the thing that caught it", async () => {
  const { state } = await page.evaluate(() =>
    window.run((s) => {
      window.everything(s);
      s.filter.showReason = "all";
    })
  );

  assert.match(state.rule.reason, /Weekend sales/, "a rule names itself by its title");
  assert.match(state.keyword.reason, /crypto/, "a keyword names the word that matched");
  assert.ok(
    state.regex.reason.endsWith(": buy now"),
    `a pattern must quote what the user typed, not the compiled object: ${state.regex.reason}`
  );
  assert.match(state.quiet.reason, /100/, "an engagement floor names the number");
  assert.match(state.quiet.reason, /Likes/i, "and the metric it read");
  assert.equal(state.plain.reason, null, "a post nothing caught says nothing");
});

test("the reason is the sentence the reader sees, not just an attribute", async () => {
  const { state } = await page.evaluate(() =>
    window.run((s) => {
      window.everything(s);
      s.filter.showReason = "all";
    })
  );

  // `content: attr(...)` resolves to the same string, which is the only proof the stylesheet and
  // the attribute agree. An attribute nothing renders would satisfy a weaker test.
  assert.equal(state.rule.before, `"${state.rule.reason}"`);
  assert.equal(state.keyword.before, `"${state.keyword.reason}"`);
  // The structural half has no attribute -- its sentence is written into the stylesheet.
  assert.match(state.photo.before, /photo/i, `the photo rule said ${state.photo.before}`);
  assert.equal(state.photo.reason, null, "a structural hide has no JS decision to hang one off");
});

test("a hidden post becomes a strip that opens, rather than disappearing", async () => {
  const opened = await page.evaluate(async () => {
    const settings = AviaryReason.cloneSettings(AviaryReason.DEFAULT_SETTINGS);
    settings.filter.enabled = true;
    settings.filter.keywordRules = ["crypto"];
    settings.filter.showReason = "all";
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryReason.filterEngineFeature.init(ctx);

    const article = document.getElementById("post-keyword");
    const height = () => article.getBoundingClientRect().height;
    // A child that was in the tab order before the filter ran, so this measures whether the
    // collapse took it out -- which is what `display: none` on the children would have done.
    const focusable = document.createElement("button");
    focusable.textContent = "reply";
    article.append(focusable);

    const collapsed = { display: getComputedStyle(article).display, height: height() };
    const reachable = focusable.getBoundingClientRect().height > 0 ||
      getComputedStyle(focusable).display !== "none";

    // The reader tabs to it. `:focus-within` is what opens it, and it needs no click handler.
    focusable.focus();
    const revealed = height();
    const focused = article.matches(":focus-within");

    AviaryReason.filterEngineFeature.destroy(ctx);
    const natural = height();
    focusable.remove();
    return { collapsed, revealed, natural, reachable, focused };
  });

  assert.notEqual(opened.collapsed.display, "none", "the strip has to be on the page to be read");
  assert.ok(
    opened.collapsed.height < opened.natural,
    `the post was not collapsed (${opened.collapsed.height} of ${opened.natural})`
  );
  assert.equal(
    opened.reachable,
    true,
    "a collapsed post must keep its children in the tab order, or it can never be opened by keyboard"
  );
  assert.equal(opened.focused, true, "tabbing into the post must put focus inside it");
  assert.ok(
    opened.revealed > opened.collapsed.height,
    `focus did not open the post (${opened.revealed} vs ${opened.collapsed.height})`
  );
});

test("on the default setting a hidden post is still hidden, and only dimmed posts explain", async () => {
  const { state } = await page.evaluate(() =>
    window.run((s) => {
      window.everything(s);
      // The shipped default.
    })
  );

  assert.equal(state.keyword.display, "none", "the default must not change what hiding does");
  assert.equal(state.photo.display, "none");
  assert.match(state.rule.reason, /Weekend sales/, "a dimmed post still says why");
  assert.equal(state.rule.before, `"${state.rule.reason}"`, "and shows it");
  assert.notEqual(state.rule.display, "none");
});

test("turning reasons off leaves nothing behind on any post", async () => {
  const { state } = await page.evaluate(() =>
    window.run((s) => {
      window.everything(s);
      s.filter.showReason = "off";
    })
  );

  for (const [id, entry] of Object.entries(state)) {
    assert.equal(entry.reason, null, `${id} still carries a reason with the setting off`);
    assert.equal(entry.before, "none", `${id} still renders one`);
  }
  // And the filtering itself is untouched.
  assert.equal(state.keyword.display, "none");
  assert.equal(state.photo.display, "none");
});

test("changing the setting mid-session takes effect without a reload", async () => {
  const outcome = await page.evaluate(() => {
    const settings = AviaryReason.cloneSettings(AviaryReason.DEFAULT_SETTINGS);
    settings.filter.enabled = true;
    settings.filter.keywordRules = ["crypto"];
    settings.filter.showReason = "off";
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryReason.filterEngineFeature.init(ctx);
    const article = document.getElementById("post-keyword");
    const before = article.getAttribute("data-av-filter-reason");

    // The panel mutates the same object and asks for a re-apply. The articles were already
    // stamped, so this only works if the stamp is invalidated by the change.
    settings.filter.showReason = "all";
    AviaryReason.filterEngineFeature.apply(ctx, document);
    const after = article.getAttribute("data-av-filter-reason");

    AviaryReason.filterEngineFeature.destroy(ctx);
    return { before, after };
  });

  assert.equal(outcome.before, null);
  assert.match(outcome.after ?? "", /crypto/, "the setting must reach posts that were already judged");
});

test("a post that stops being filtered stops carrying a reason", async () => {
  // The attribute is written per article and the article is only revisited when the generation
  // stamp changes. A reason that is written but never removed outlives the rule that produced it.
  const outcome = await page.evaluate(() => {
    const settings = AviaryReason.cloneSettings(AviaryReason.DEFAULT_SETTINGS);
    settings.filter.enabled = true;
    settings.filter.showReason = "all";
    settings.filter.keywordRules = ["crypto"];
    const ctx = {
      settings,
      route: { surface: "home", path: "/home" },
      diagnostics: { info() {}, warn() {}, error() {} }
    };
    AviaryReason.filterEngineFeature.init(ctx);
    const article = document.getElementById("post-keyword");
    const before = article.getAttribute("data-av-filter-reason");

    // The user edits the keyword to something this post does not match.
    settings.filter.keywordRules = ["airdrop"];
    AviaryReason.filterEngineFeature.apply(ctx, document);
    const after = {
      reason: article.getAttribute("data-av-filter-reason"),
      result: article.getAttribute("data-av-filter-result"),
      display: getComputedStyle(article).display
    };

    AviaryReason.filterEngineFeature.destroy(ctx);
    return { before, after };
  });

  assert.match(outcome.before ?? "", /crypto/, "the post must start out filtered");
  assert.equal(outcome.after.result, null, "and end up unfiltered");
  assert.equal(
    outcome.after.reason,
    null,
    "a reason that outlives the rule that produced it is a sentence about nothing"
  );
  assert.notEqual(outcome.after.display, "none");
});

test("destroy takes every reason off the page", async () => {
  const { after } = await page.evaluate(() =>
    window.run((s) => {
      window.everything(s);
      s.filter.showReason = "all";
    })
  );

  for (const [id, reason] of Object.entries(after)) {
    assert.equal(reason, null, `${id} kept its reason after destroy`);
  }
});

test("the reason comes out of the decision rather than being worked out again", async () => {
  // `decide` is `judge().action` and nothing else, so the two can never disagree about what
  // happened to a post -- which is the whole claim this feature rests on.
  const rows = await page.evaluate(() => {
    const { rules } = AviaryReason.compileRules(["[Sales] dim: text contains sale"]);
    const filters = AviaryReason.compileFilters({
      rules,
      keywords: ["crypto"],
      regex: ["buy now"],
      whitelist: ["frank"],
      premium: "off",
      media: { photo: false, video: false, gif: false },
      engagement: { action: "hide", metric: "likes", min: 100 },
      generation: 1
    });
    const signals = [
      { text: "weekend sale", handle: "alice", premium: false, media: {}, engagement: {} },
      { text: "buy crypto", handle: "bob", premium: false, media: {}, engagement: {} },
      { text: "buy now please", handle: "carol", premium: false, media: {}, engagement: {} },
      {
        text: "quiet",
        handle: "dave",
        premium: false,
        media: {},
        engagement: { replies: 0, reposts: 0, likes: 2 }
      },
      { text: "buy crypto", handle: "frank", premium: false, media: {}, engagement: {} },
      { text: "ordinary", handle: "gina", premium: false, media: {}, engagement: {} }
    ];
    return signals.map((signal) => {
      const verdict = AviaryReason.judge(signal, filters);
      return {
        action: verdict.action,
        decided: AviaryReason.decide(signal, filters),
        cause: verdict.cause
      };
    });
  });

  for (const row of rows) {
    assert.equal(row.action, row.decided, "decide and judge must never disagree");
    if (row.action === "show") {
      assert.equal(row.cause, null, "a post that was shown has no cause");
    } else {
      assert.ok(row.cause, `a ${row.action} with no cause is a post that cannot say why`);
    }
  }
  assert.deepEqual(
    rows.map((row) => row.cause?.kind ?? null),
    ["rule", "keyword", "regex", "engagement", null, null],
    "each predicate must report itself, and the allowlisted post must report nothing"
  );
});

test("the reason mode survives normalization and defaults to the free half", async () => {
  const modes = await page.evaluate(() => ({
    bad: AviaryReason.normalizeSettings({ filter: { showReason: "loudly" } }).filter.showReason,
    all: AviaryReason.normalizeSettings({ filter: { showReason: "all" } }).filter.showReason,
    off: AviaryReason.normalizeSettings({ filter: { showReason: "off" } }).filter.showReason,
    fallback: AviaryReason.DEFAULT_SETTINGS.filter.showReason
  }));

  assert.equal(modes.bad, "dimmed");
  assert.equal(modes.all, "all");
  assert.equal(modes.off, "off");
  // "dimmed" changes no layout: a dimmed post is already visible, so naming its reason costs
  // nothing. Collapsing hidden posts into strips is a real change and stays opt-in.
  assert.equal(modes.fallback, "dimmed");
});

/**
 * The verb has to match what happened to the post.
 *
 * `describeCause` always said "Hidden by your ...", but the reason is attached to dimmed posts as
 * well as hidden ones -- and the default `showReason` value is "dimmed", so out of the box the only
 * posts carrying a reason were the ones the sentence described wrongly. The reader saw a post
 * plainly still on screen, captioned as hidden. The `[Weekend sales]` fixture rule is a `dim:` rule
 * and the keyword and pattern rules hide, so one run covers both verbs.
 */
test("a dimmed post says dimmed and a hidden post says hidden", async () => {
  const { state } = await page.evaluate(() =>
    window.run((s) => {
      window.everything(s);
      s.filter.showReason = "all";
    })
  );

  assert.equal(state.rule.result, "dim", "the fixture rule is a dim rule");
  assert.match(
    state.rule.reason,
    /^Dimmed by your rule/,
    `a dimmed post must not claim it was hidden: ${state.rule.reason}`
  );

  assert.equal(state.keyword.result, "hide");
  assert.match(state.keyword.reason, /^Hidden by your keyword/, `saw ${state.keyword.reason}`);
  assert.equal(state.regex.result, "hide");
  assert.match(state.regex.reason, /^Hidden by your pattern/, `saw ${state.regex.reason}`);

  // The sentence the reader actually sees agrees with the attribute.
  assert.equal(state.rule.before, `"${state.rule.reason}"`);
});
