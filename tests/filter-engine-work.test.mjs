import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * How much work the filter engine does on a pass that changes nothing, and whether a settings
 * change takes effect.
 *
 * Both were asserted by slicing `filter-engine.ts` and comparing string offsets — "the early
 * return must come before the generation bump", and a list of field names that had to appear
 * inside `filterSignature`. Neither survives a rename, and neither notices a signature that lists
 * a field it then ignores. Here the engine runs against a fixture with a MutationObserver
 * watching, so an apply that re-stamps the whole timeline is visible as the mutations it causes.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const POSTS = 12;
const FIXTURE = `
<main data-testid="primaryColumn">
  ${Array.from({ length: POSTS }, (_, i) => `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <a href="/alice/status/19000000000000${String(i).padStart(2, "0")}"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
      <div data-testid="User-Name"><a href="/handle${i}"><span>@handle${i}</span></a>${
        i % 3 === 0 ? '<svg data-testid="icon-verified"></svg>' : ""
      }</div>
      <div data-testid="tweetText">post number ${i} about ${i % 2 === 0 ? "spam" : "kittens"}</div>
      ${i % 4 === 0 ? '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/x?format=jpg"></div>' : ""}
    </article>
  </div>`).join("")}
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-filter-work-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { filterEngineFeature } from ${JSON.stringify(abs("src/features/filtering/filter-engine.ts"))};`,
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
    globalName: "AviaryFilter",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><body>${FIXTURE}</body>`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.makeCtx = (mutate) => {
      const settings = AviaryFilter.cloneSettings(AviaryFilter.DEFAULT_SETTINGS);
      settings.filter.enabled = true;
      mutate?.(settings);
      return {
        settings,
        route: { surface: "home", path: "/home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
    /**
     * What the reader actually gets. Half the engine's decisions no longer exist as an attribute
     * -- the structural predicates are `:has()` rules -- so the outcome has to be read off
     * computed style, which is the one place both halves land.
     */
    window.outcome = () => {
      const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
      const style = (article) => getComputedStyle(article);
      return {
        hidden: articles.filter((article) => style(article).display === "none").length,
        dimmed: articles.filter(
          (article) => style(article).display !== "none" && Number(style(article).opacity) < 1
        ).length
      };
    };
    /** Counts attribute mutations the engine causes inside the timeline. */
    window.countMutations = async (work) => {
      const target = document.querySelector('[data-testid="primaryColumn"]');
      let count = 0;
      const observer = new MutationObserver((records) => {
        count += records.length;
      });
      observer.observe(target, { attributes: true, subtree: true, childList: true });
      await work();
      await new Promise((resolve) => setTimeout(resolve, 20));
      observer.disconnect();
      return count;
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("a second apply with unchanged settings does no work on an unchanged timeline", async () => {
  const counts = await page.evaluate(async (posts) => {
    const ctx = window.makeCtx((settings) => {
      settings.filter.keywordRules = ["spam"];
    });
    // init already scans and stamps, so that is the pass that does the work.
    const first = await window.countMutations(() => AviaryFilter.filterEngineFeature.init(ctx));
    const second = await window.countMutations(() => AviaryFilter.filterEngineFeature.apply(ctx, document));
    const third = await window.countMutations(() => AviaryFilter.filterEngineFeature.apply(ctx, document));

    const hidden = window.outcome().hidden;
    AviaryFilter.filterEngineFeature.destroy(ctx);
    return { first, second, third, hidden, posts };
  }, POSTS);

  assert.ok(counts.first > 0, "the first pass must actually stamp the timeline");
  assert.ok(counts.hidden > 0, "the fixture must contain posts the rule hides");
  // `generation` is both the compile id and the per-article stamp. Bumping it on every apply made
  // the stamp check unhittable, so the whole visible timeline was re-extracted on every mutation
  // batch — about 120ms of work per batch while scrolling.
  assert.equal(counts.second, 0, `an unchanged re-apply caused ${counts.second} mutations`);
  assert.equal(counts.third, 0, "and a third changes nothing either");
});

test("every input the filter reads takes effect without a reload", async () => {
  // Each case names a settings change and the outcome it must produce on the same fixture. If a
  // field were dropped from the recompile signature, its case here would stop changing anything.
  const cases = await page.evaluate(async () => {
    const run = async (mutate) => {
      const ctx = window.makeCtx(mutate);
      AviaryFilter.filterEngineFeature.init(ctx);
      await AviaryFilter.filterEngineFeature.apply(ctx, document);
      const result = window.outcome();
      AviaryFilter.filterEngineFeature.destroy(ctx);
      return result;
    };

    return {
      off: await run((s) => { s.filter.enabled = false; s.filter.keywordRules = ["spam"]; }),
      keyword: await run((s) => { s.filter.keywordRules = ["spam"]; }),
      regex: await run((s) => { s.filter.regexRules = ["number (1|3|5) "]; }),
      whitelisted: await run((s) => {
        s.filter.keywordRules = ["spam"];
        s.filter.whitelist = ["handle0", "handle2", "handle4"];
      }),
      premiumHide: await run((s) => { s.filter.premiumRule = "hide"; }),
      premiumDim: await run((s) => { s.filter.premiumRule = "dim"; }),
      media: await run((s) => { s.filter.mediaTypes = { photo: true, video: false, gif: false }; })
    };
  });

  assert.equal(cases.off.hidden, 0, "the enabled switch must reach the engine");
  assert.ok(cases.keyword.hidden > 0, "a keyword rule must hide the posts it matches");
  assert.ok(cases.regex.hidden > 0, "a regex rule must hide the posts it matches");
  assert.notEqual(cases.regex.hidden, cases.keyword.hidden, "the two rule kinds must select differently");
  assert.ok(
    cases.whitelisted.hidden < cases.keyword.hidden,
    `whitelisting three handles changed nothing (${cases.whitelisted.hidden} vs ${cases.keyword.hidden})`
  );
  assert.ok(cases.premiumHide.hidden > 0, "the premium rule must reach the engine");
  assert.equal(cases.premiumDim.hidden, 0, "set to dim, the premium rule must not hide");
  assert.ok(cases.premiumDim.dimmed > 0, "set to dim, it must dim");
  assert.ok(cases.media.hidden > 0, "a media-type rule must reach the engine");
});

test("changing a rule between applies re-evaluates the timeline that was already stamped", async () => {
  const result = await page.evaluate(async () => {
    const ctx = window.makeCtx((settings) => {
      settings.filter.keywordRules = ["spam"];
    });
    AviaryFilter.filterEngineFeature.init(ctx);
    await AviaryFilter.filterEngineFeature.apply(ctx, document);
    const before = window.outcome().hidden;

    // The same object the panel mutates, then a plain re-apply — no reload, no re-init.
    ctx.settings.filter.keywordRules = [];
    ctx.settings.filter.regexRules = ["number (1|3|5) "];
    const mutations = await window.countMutations(() => AviaryFilter.filterEngineFeature.apply(ctx, document));
    const after = window.outcome().hidden;

    AviaryFilter.filterEngineFeature.destroy(ctx);
    return { before, after, mutations };
  });

  assert.ok(result.before > 0);
  assert.ok(result.after > 0);
  assert.notEqual(result.after, result.before, "the new rule selects a different set of posts");
  assert.ok(result.mutations > 0, "a changed rule must invalidate the stamps it set earlier");
});

test("every signature input invalidates the compiled filter when it changes mid-session", async () => {
  // The recompile signature has to cover exactly the inputs the compiler consumes. If one is
  // missing, changing it leaves the previous compile in place and the setting silently stops
  // working until a reload -- which is what a re-apply without a re-init reproduces here.
  const changes = await page.evaluate(async () => {
    const snapshot = () => window.outcome();
    const same = (a, b) => a.hidden === b.hidden && a.dimmed === b.dimmed;

    const cases = {
      keywordRules: (s) => { s.filter.keywordRules = ["spam"]; },
      regexRules: (s) => { s.filter.regexRules = ["number (1|3|5) "]; },
      // Only the whitelist changes: the baseline rule hides handle0's post, so exempting that
      // handle must un-hide it. Changing a second field here would recompile for the wrong reason.
      whitelist: (s) => { s.filter.whitelist = ["handle0"]; },
      premiumRule: (s) => { s.filter.premiumRule = "hide"; },
      mediaTypes: (s) => { s.filter.mediaTypes = { photo: true, video: false, gif: false }; },
      // `enabled` also short-circuits before the compiled filter is consulted, so this passes
      // whether or not it is in the signature. It is here because the switch has to work.
      enabled: (s) => { s.filter.enabled = false; }
    };

    const unchanged = [];
    for (const [field, mutate] of Object.entries(cases)) {
      // A baseline that hides exactly one post, so any case that changes the set is visible.
      const ctx = window.makeCtx((s) => { s.filter.keywordRules = ["number 0 "]; });
      AviaryFilter.filterEngineFeature.init(ctx);
      await AviaryFilter.filterEngineFeature.apply(ctx, document);
      const before = snapshot();

      // Same context object, mutated the way the panel mutates it, then a plain re-apply.
      mutate(ctx.settings);
      await AviaryFilter.filterEngineFeature.apply(ctx, document);
      const after = snapshot();
      AviaryFilter.filterEngineFeature.destroy(ctx);

      if (same(before, after)) unchanged.push(`${field} (${before.hidden}/${before.dimmed})`);
    }
    return unchanged;
  });

  assert.deepEqual(changes, [], "these settings changed nothing without a reload");
});

test("destroy leaves no filter attribute behind on any post or cell", async () => {
  const leftovers = await page.evaluate(async () => {
    const ctx = window.makeCtx((settings) => {
      settings.filter.keywordRules = ["spam"];
    });
    AviaryFilter.filterEngineFeature.init(ctx);
    await AviaryFilter.filterEngineFeature.apply(ctx, document);
    const during = document.querySelectorAll(
      "[data-av-filter-processed], [data-av-filter-result], [data-av-filter-cell-hidden]"
    ).length;
    AviaryFilter.filterEngineFeature.destroy(ctx);
    return {
      during,
      after: document.querySelectorAll(
        "[data-av-filter-processed], [data-av-filter-result], [data-av-filter-cell-hidden]"
      ).length
    };
  });

  assert.ok(leftovers.during > 0, "the engine must have marked the timeline for this to prove anything");
  assert.equal(leftovers.after, 0, "every feature must reverse itself completely");
});

test("a filter action nothing reads cannot default to anything but off", async () => {
  // The old form sliced DEFAULT_SETTINGS out of settings.ts, pulled the action keys out with a
  // regex anchored on four-space indentation, and decided "is it read?" by grepping the features
  // directory for `settings.filter.<key>`. A key reached through a computed property, a helper,
  // or a destructure would read as unread and the test would demand it default to off for the
  // wrong reason. This asks the engine instead: set the action to "hide" and see whether the
  // timeline changes.
  const audit = await page.evaluate(async () => {
    // Computed display and opacity per post, in document order: the reader-visible outcome,
    // whichever half of the engine produced it.
    const snapshot = () =>
      [...document.querySelectorAll('article[data-testid="tweet"]')]
        .map((article) => {
          const style = getComputedStyle(article);
          return `${style.display}/${style.opacity}`;
        })
        .join(",");

    const render = (mutate) => {
      const ctx = window.makeCtx(mutate);
      AviaryFilter.filterEngineFeature.init(ctx);
      const shot = snapshot();
      AviaryFilter.filterEngineFeature.destroy(ctx);
      return shot;
    };

    const ACTIONS = ["off", "hide", "dim"];
    const keys = Object.entries(AviaryFilter.DEFAULT_SETTINGS.filter)
      .filter(([, value]) => typeof value === "string" && ACTIONS.includes(value))
      .map(([key, value]) => ({ key, declaredDefault: value }));

    const baseline = render(() => {});
    return keys.map((entry) => ({
      ...entry,
      // Every action the engine consults must be able to change the page from the same baseline.
      drivesSomething: ACTIONS.some((action) => action !== entry.declaredDefault && render((s) => {
        s.filter[entry.key] = action;
      }) !== baseline)
    }));
  });

  assert.ok(audit.length >= 3, `expected several filter actions, found ${audit.length}`);
  // Control: premiumRule is demonstrably consulted. Without this, a broken probe would report
  // every key as unread and the whole test would pass for the wrong reason.
  const premium = audit.find((entry) => entry.key === "premiumRule");
  assert.ok(premium, "premiumRule is no longer a filter action");
  assert.equal(premium.drivesSomething, true, "control failed — the engine does read premiumRule");

  for (const entry of audit) {
    if (entry.drivesSomething) continue;
    assert.equal(
      entry.declaredDefault,
      "off",
      `filter.${entry.key} defaults to "${entry.declaredDefault}" but changes nothing — ` +
        "the setting claims a filter the engine never applies"
    );
  }
});
