import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Letting the timeline stop.
 *
 * The property that matters more than the counting is that the reading position never moves: an
 * intervention at the bottom of a feed the reader is part-way through would be worse than the
 * endless scroll it is meant to fix. Every test here measures scroll position across the change.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const POSTS = 40;
const FIXTURE = `
<main data-testid="primaryColumn">
  ${Array.from(
    { length: POSTS },
    (_, i) => `
  <div data-testid="cellInnerDiv" id="cell-${i}" style="height:120px">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/handle${i}"><span>@handle${i}</span></a></div>
      <div data-testid="tweetText">post number ${i}</div>
    </article>
  </div>`
  ).join("")}
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-pagination-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { timelinePaginationFeature } from ${JSON.stringify(abs("src/features/layout/timeline-pagination.ts"))};`,
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
    globalName: "AviaryPage",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.start = (mutate, surface = "home") => {
      document.body.innerHTML = window.FIXTURE;
      const settings = AviaryPage.cloneSettings(AviaryPage.DEFAULT_SETTINGS);
      mutate?.(settings);
      const ctx = {
        settings,
        route: { surface, path: `/${surface}`, href: `https://x.com/${surface}` },
        diagnostics: { info() {}, warn() {}, error() {} },
        requestApply: () => AviaryPage.timelinePaginationFeature.apply(ctx, document)
      };
      AviaryPage.timelinePaginationFeature.init(ctx);
      AviaryPage.timelinePaginationFeature.apply(ctx, document);
      return ctx;
    };
    window.visibleCells = () =>
      [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].filter(
        (cell) => getComputedStyle(cell).display !== "none"
      ).length;
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

async function load() {
  await page.evaluate((fixture) => {
    window.FIXTURE = fixture;
  }, FIXTURE);
}

test("the feed stops at the number the reader chose", async () => {
  await load();
  const counts = await page.evaluate(() => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 10;
    });
    const stopped = window.visibleCells();
    const control = document.getElementById("av-timeline-more");
    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return { stopped, all: window.visibleCells(), hasControl: control !== null };
  });

  assert.equal(counts.stopped, 10, "exactly the chosen number of posts may remain");
  assert.equal(counts.hasControl, true, "and there must be a way to continue");
  assert.equal(counts.all, 40, "turning it off restores every post");
});

test("zero leaves X's endless scroll exactly as it was", async () => {
  await load();
  const result = await page.evaluate(() => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 0;
    });
    const out = {
      visible: window.visibleCells(),
      control: document.getElementById("av-timeline-more") !== null,
      styled: document.getElementById("av-timeline-pagination") !== null
    };
    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return out;
  });

  assert.equal(result.visible, POSTS);
  assert.equal(result.control, false, "an off feature must add no control");
  assert.equal(result.styled, false, "and inject no stylesheet");
});

test("continuing releases another page and never moves the reading position", async () => {
  await load();
  const outcome = await page.evaluate(async () => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 10;
    });

    // The reader is part-way down what they can see.
    const anchor = document.getElementById("cell-4");
    window.scrollTo(0, 300);
    const beforeScroll = window.scrollY;
    const beforeAnchor = anchor.getBoundingClientRect().top;

    document.querySelector("#av-timeline-more button").click();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const out = {
      before: 10,
      after: window.visibleCells(),
      scrollMoved: window.scrollY - beforeScroll,
      anchorMoved: anchor.getBoundingClientRect().top - beforeAnchor,
      stillHasControl: document.getElementById("av-timeline-more") !== null
    };
    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return out;
  });

  assert.equal(outcome.after, 20, "continuing must release another page of the same size");
  assert.equal(outcome.scrollMoved, 0, `the page scrolled by ${outcome.scrollMoved}px`);
  assert.equal(
    outcome.anchorMoved,
    0,
    `a post the reader was looking at moved ${outcome.anchorMoved}px`
  );
  assert.equal(outcome.stillHasControl, true, "and there is still a way to go further");
});

test("the control sits after the last post shown, not before it", async () => {
  // Inserting it above the cut would push the read posts down the page, which is the one thing
  // this feature must never do.
  await load();
  const position = await page.evaluate(() => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 10;
    });
    const control = document.getElementById("av-timeline-more");
    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    const visible = cells.filter((cell) => getComputedStyle(cell).display !== "none");
    const last = visible[visible.length - 1];
    const out = {
      afterLastVisible:
        last.compareDocumentPosition(control) === Node.DOCUMENT_POSITION_FOLLOWING,
      beforeFirstHidden: control.nextElementSibling?.id ?? null
    };
    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return out;
  });

  assert.equal(position.afterLastVisible, true, "the control must follow the last visible post");
  assert.equal(position.beforeFirstHidden, "cell-10", "and sit exactly at the cut");
});

test("posts X adds later are held back too, without releasing the reader's allowance", async () => {
  await load();
  const outcome = await page.evaluate(async () => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 10;
    });
    const before = window.visibleCells();

    // X's loader appends more rows. The feature only sees them on the next apply.
    const timeline = document.querySelector('[data-testid="primaryColumn"]');
    for (let i = 0; i < 5; i += 1) {
      const cell = document.createElement("div");
      cell.setAttribute("data-testid", "cellInnerDiv");
      cell.id = `cell-late-${i}`;
      cell.style.height = "120px";
      cell.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText">late</div></article>';
      timeline.append(cell);
    }
    AviaryPage.timelinePaginationFeature.apply(ctx, document);
    const after = window.visibleCells();

    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return { before, after };
  });

  assert.equal(outcome.before, 10);
  assert.equal(outcome.after, 10, "a feed that keeps growing must not grow past the limit");
});

test("a conversation is left alone; only feeds that extend are stopped", async () => {
  await load();
  const bySurface = await page.evaluate(() => {
    const out = {};
    for (const surface of ["home", "profile", "search", "status", "notifications"]) {
      const ctx = window.start((s) => {
        s.layout.timelineStopAfter = 10;
      }, surface);
      out[surface] = window.visibleCells();
      AviaryPage.timelinePaginationFeature.destroy(ctx);
    }
    return out;
  });

  assert.deepEqual(bySurface, {
    home: 10,
    profile: 10,
    search: 10,
    // A thread is finite and reading it is not endless scrolling.
    status: 40,
    notifications: 40
  });
});

test("moving to another surface starts the allowance over", async () => {
  await load();
  const outcome = await page.evaluate(async () => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 10;
    });
    document.querySelector("#av-timeline-more button").click();
    const extended = window.visibleCells();

    // The reader navigates to a profile. A release granted on the home feed is not a release
    // granted on every feed after it.
    ctx.route = { surface: "profile", path: "/someone", href: "https://x.com/someone" };
    AviaryPage.timelinePaginationFeature.apply(ctx, document);
    const fresh = window.visibleCells();

    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return { extended, fresh };
  });

  assert.equal(outcome.extended, 20);
  assert.equal(outcome.fresh, 10, "a new feed starts at the reader's limit again");
});

test("destroy leaves no marker, no control, and no stylesheet", async () => {
  await load();
  const leftovers = await page.evaluate(() => {
    const ctx = window.start((s) => {
      s.layout.timelineStopAfter = 10;
    });
    const during = document.querySelectorAll("[data-av-past-limit]").length;
    AviaryPage.timelinePaginationFeature.destroy(ctx);
    return {
      during,
      marks: document.querySelectorAll("[data-av-past-limit]").length,
      control: document.getElementById("av-timeline-more") !== null,
      style: document.getElementById("av-timeline-pagination") !== null,
      visible: window.visibleCells()
    };
  });

  assert.ok(leftovers.during > 0, "the feature must have marked something for this to prove anything");
  assert.equal(leftovers.marks, 0);
  assert.equal(leftovers.control, false);
  assert.equal(leftovers.style, false);
  assert.equal(leftovers.visible, POSTS, "every post must come back");
});

test("the limit survives normalization and defaults to off", async () => {
  const values = await page.evaluate(() => ({
    negative: AviaryPage.normalizeSettings({ layout: { timelineStopAfter: -5 } }).layout
      .timelineStopAfter,
    huge: AviaryPage.normalizeSettings({ layout: { timelineStopAfter: 99999 } }).layout
      .timelineStopAfter,
    text: AviaryPage.normalizeSettings({ layout: { timelineStopAfter: "twenty" } }).layout
      .timelineStopAfter,
    good: AviaryPage.normalizeSettings({ layout: { timelineStopAfter: 25 } }).layout
      .timelineStopAfter,
    fallback: AviaryPage.DEFAULT_SETTINGS.layout.timelineStopAfter
  }));

  assert.equal(values.negative, 0);
  assert.equal(values.huge, 1000, "the cap has to hold, or a typo hides the whole timeline");
  assert.equal(values.text, 0);
  assert.equal(values.good, 25);
  assert.equal(values.fallback, 0, "nothing may stop a timeline until it is asked to");
});
