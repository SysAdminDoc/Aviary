import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * A rule's name and its lifetime.
 *
 * Both live in the rule text itself rather than beside it, because the rule set is a block of
 * plain lines that has to survive settings export, a paste into a second profile, and a user
 * editing it by hand. The window is stored as "for 7d from <instant>" rather than as a deadline so
 * that renewing is a matter of moving the start.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-08-19T10:00:00.000Z");

let browser;
let page;
let temp;

const FIXTURE = `
<main data-testid="primaryColumn">
  <div data-testid="cellInnerDiv">
    <article id="post-sale" data-testid="tweet">
      <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
      <div data-testid="tweetText">weekend sale starts now</div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article id="post-plain" data-testid="tweet">
      <div data-testid="User-Name"><a href="/bob"><span>@bob</span></a></div>
      <div data-testid="tweetText">an ordinary post</div>
    </article>
  </div>
</main>`;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-rule-life-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { compileRules, evaluateRules, renewRuleLine, withRuleWindow, windowEnd } from ${JSON.stringify(abs("src/features/filtering/rules.ts"))};`,
      `export { filterEngineFeature, filterExpiredRules } from ${JSON.stringify(abs("src/features/filtering/filter-engine.ts"))};`,
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
    globalName: "AviaryLife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent(`<!doctype html><meta charset=utf-8><body>${FIXTURE}</body>`);
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.realNow = Date.now;
    window.atTime = (instant, work) => {
      Date.now = () => instant;
      try {
        return work();
      } finally {
        Date.now = window.realNow;
      }
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const compile = (lines, now) =>
  page.evaluate(
    ({ lines: input, now: at }) => {
      const set = AviaryLife.compileRules(input, at);
      const describe = (rule) => ({
        source: rule.source,
        title: rule.title,
        action: rule.action,
        conditions: rule.conditions.length,
        expiresAt: rule.expiresAt,
        window: rule.window
      });
      return {
        rules: set.rules.map(describe),
        expired: set.expired.map(describe),
        errors: set.errors,
        nextExpiry: set.nextExpiry
      };
    },
    { lines, now }
  );

test("a rule written before any of this keeps parsing exactly as it did", async () => {
  const set = await compile(
    [
      "text contains crypto",
      "dim: handle is someaccount and media is video",
      "# a comment",
      "",
      "text matches /free .*airdrop/i or text contains giveaway"
    ],
    T0
  );

  assert.deepEqual(set.errors, []);
  assert.equal(set.rules.length, 3);
  assert.equal(set.nextExpiry, null, "nothing without a window may claim an expiry");
  for (const rule of set.rules) {
    assert.equal(rule.title, null, "an untitled rule must report no title, not an empty one");
    assert.equal(rule.expiresAt, null);
    assert.equal(rule.window, null);
  }
  assert.equal(set.rules[1].action, "dim", "the dim: prefix must still be read");
  assert.equal(set.rules[1].conditions, 2);
});

test("a title is read off the front of the line and does not disturb the conditions", async () => {
  const set = await compile(
    [
      "[Crypto noise] text contains crypto",
      "[Weekend sales] dim: text contains sale and media is photo"
    ],
    T0
  );

  assert.deepEqual(set.errors, []);
  assert.deepEqual(
    set.rules.map((rule) => [rule.title, rule.action, rule.conditions]),
    [
      ["Crypto noise", "hide", 1],
      ["Weekend sales", "dim", 2]
    ]
  );
});

test("a bracket that is part of a value is not mistaken for a title", async () => {
  // A condition always starts with a bare word, so only a line that *begins* with a bracket can be
  // carrying a title. A bracketed value sits after the operator and is untouched.
  const set = await compile(["text contains [ad]", "text matches /\\[sponsored\\]/"], T0);

  assert.deepEqual(set.errors, []);
  assert.equal(set.rules.length, 2);
  assert.deepEqual(set.rules.map((rule) => rule.title), [null, null]);
});

test("a rule with a window applies inside it and stops at the edge", async () => {
  const line = `[Weekend sales] hide for 7d from ${new Date(T0).toISOString()}: text contains sale`;

  const during = await compile([line], T0 + 6 * DAY);
  assert.equal(during.rules.length, 1, "a rule inside its window is in force");
  assert.deepEqual(during.expired, []);
  assert.equal(during.rules[0].expiresAt, T0 + 7 * DAY);
  assert.equal(during.nextExpiry, T0 + 7 * DAY);

  const after = await compile([line], T0 + 8 * DAY);
  assert.deepEqual(after.rules, [], "an expired rule is not in force");
  assert.equal(after.expired.length, 1, "and it is not thrown away either");
  assert.equal(after.expired[0].title, "Weekend sales");
  assert.equal(after.nextExpiry, null);

  // The boundary itself: a window that has just closed is closed.
  const exactly = await compile([line], T0 + 7 * DAY);
  assert.equal(exactly.rules.length, 0);
  assert.equal(exactly.expired.length, 1);
});

test("nextExpiry names the first window to close, not the last", async () => {
  const set = await compile(
    [
      `[Short] hide for 24h from ${new Date(T0).toISOString()}: text contains sale`,
      `[Long] hide for 30d from ${new Date(T0).toISOString()}: text contains crypto`,
      "text contains forever"
    ],
    T0
  );

  assert.equal(set.rules.length, 3);
  assert.equal(set.nextExpiry, T0 + DAY, "the engine must wake for the earliest of the windows");
});

test("renewing a rule moves its start and changes nothing else", async () => {
  const line = `[Weekend sales] dim for 7d from ${new Date(T0).toISOString()}: text contains sale and media is photo`;
  const renewedAt = T0 + 9 * DAY;

  const result = await page.evaluate(
    ({ source, now }) => {
      const renewed = AviaryLife.renewRuleLine(source, now);
      const before = AviaryLife.compileRules([source], now);
      const after = AviaryLife.compileRules([renewed], now);
      return {
        renewed,
        expiredBefore: before.expired.length,
        activeAfter: after.rules.length,
        rule: after.rules[0] ?? null
      };
    },
    { source: line, now: renewedAt }
  );

  assert.equal(result.expiredBefore, 1, "the rule must have been expired for this to prove anything");
  assert.equal(result.activeAfter, 1, "renewing must bring it back");
  assert.equal(result.rule.title, "Weekend sales", "the title must survive a renewal");
  assert.equal(result.rule.action, "dim", "and so must the action");
  assert.equal(result.rule.conditions.length, 2, "and the conditions");
  assert.equal(result.rule.window.amount, 7, "and the window the user originally chose");
  assert.equal(result.rule.expiresAt, renewedAt + 7 * DAY);
  assert.equal(
    AVIARY_ISO(renewedAt),
    result.renewed.match(/from (\S+):/)[1],
    "the renewed line must carry the new start"
  );
});

function AVIARY_ISO(instant) {
  return new Date(instant).toISOString();
}

test("renewing a rule that has no window leaves it exactly alone", async () => {
  const unchanged = await page.evaluate(() =>
    ["text contains crypto", "[Named] dim: handle is someone"].map((line) => ({
      line,
      renewed: AviaryLife.renewRuleLine(line, 1_600_000_000_000)
    }))
  );

  for (const entry of unchanged) {
    assert.equal(entry.renewed, entry.line, "a rule with no window has no start to move");
  }
});

test("giving a rule a window keeps its title and action", async () => {
  const written = await page.evaluate(
    ({ now }) => ({
      bare: AviaryLife.withRuleWindow("text contains sale", 24, "h", now),
      titled: AviaryLife.withRuleWindow("[Sales] text contains sale", 7, "d", now),
      dimmed: AviaryLife.withRuleWindow("[Sales] dim: text contains sale", 30, "d", now),
      replaced: AviaryLife.withRuleWindow(
        `[Sales] dim for 24h from ${new Date(now - 100).toISOString()}: text contains sale`,
        30,
        "d",
        now
      )
    }),
    { now: T0 }
  );

  const parsed = await compile(Object.values(written), T0);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.rules.map((rule) => [rule.title, rule.action, rule.window.amount, rule.window.unit]),
    [
      [null, "hide", 24, "h"],
      ["Sales", "hide", 7, "d"],
      ["Sales", "dim", 30, "d"],
      ["Sales", "dim", 30, "d"]
    ]
  );
  for (const rule of parsed.rules) {
    assert.equal(rule.window.startedAt, T0, "the window must start when it was written");
    assert.equal(rule.conditions, 1, "the conditions must be carried through untouched");
  }
});

test("a window Aviary cannot read is a parse error, not a rule that never matches", async () => {
  const set = await compile(
    [
      "[Bad] hide for 7x from 2026-08-19T10:00:00.000Z: text contains sale",
      "[Bad] hide for 7d from yesterday: text contains sale",
      "[Bad] hide for 0d from 2026-08-19T10:00:00.000Z: text contains sale",
      "[  ] text contains sale",
      "[Unclosed text contains sale"
    ],
    T0
  );

  assert.deepEqual(set.rules, [], "none of these may quietly become a live rule");
  assert.deepEqual(set.expired, [], "nor may they be filed as expired");
  assert.equal(set.errors.length, 5, `got ${JSON.stringify(set.errors)}`);
  assert.match(set.errors[1].message, /is not a date/);
  assert.match(set.errors[2].message, /duration/);
});

test("a rule stops filtering the timeline when its window closes, with no settings change", async () => {
  // The compiled set is cached against the settings, and a window closing is the one thing that
  // changes it without the settings changing. Nothing here touches the rule text between passes.
  const result = await page.evaluate(
    ({ start, day }) => {
      const settings = AviaryLife.cloneSettings(AviaryLife.DEFAULT_SETTINGS);
      settings.filter.enabled = true;
      settings.filter.rules = [
        `[Weekend sales] hide for 7d from ${new Date(start).toISOString()}: text contains sale`
      ];
      const ctx = {
        settings,
        route: { surface: "home", path: "/home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };

      const hidden = () =>
        getComputedStyle(document.getElementById("post-sale")).display === "none";

      const inside = window.atTime(start + day, () => {
        AviaryLife.filterEngineFeature.init(ctx);
        return { hidden: hidden(), expired: AviaryLife.filterExpiredRules().length };
      });
      const after = window.atTime(start + 8 * day, () => {
        AviaryLife.filterEngineFeature.apply(ctx, document);
        return { hidden: hidden(), expired: AviaryLife.filterExpiredRules().length };
      });
      AviaryLife.filterEngineFeature.destroy(ctx);

      return { inside, after, rules: settings.filter.rules };
    },
    { start: T0, day: DAY }
  );

  assert.equal(result.inside.hidden, true, "inside its window the rule must filter");
  assert.equal(result.inside.expired, 0);
  assert.equal(result.after.hidden, false, "past its window it must stop, on the next apply alone");
  assert.equal(result.after.expired, 1, "and the panel must be able to see that it expired");
  assert.equal(
    result.rules.length,
    1,
    "expiring must never delete the rule -- there would be nothing left to renew"
  );
});

test("a titled, windowed rule survives settings normalization intact", async () => {
  const line = `[Weekend sales in Europe] dim for 30d from ${new Date(T0).toISOString()}: text contains sale and media is photo`;
  const normalized = await page.evaluate(
    ({ source }) => AviaryLife.normalizeSettings({ filter: { rules: [source] } }).filter.rules,
    { source: line }
  );

  assert.deepEqual(normalized, [line], "the header must not be truncated by the length cap");
});
