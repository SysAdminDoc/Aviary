import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * X makes an entire post row navigate, so a press on the text, on the gap beside a control, or a
 * few pixels off the one you meant opens a post nobody chose and takes your place in the feed with
 * it. With the guard on, the row is inert and the reply icon opens the post.
 *
 * Every assertion drives the real mouse against real layout: the rule is about which element was
 * pressed, and a synthesized event naming the element itself would prove nothing.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-open-guard-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { postOpenGuardFeature, postOpenGuardCounts } from ${JSON.stringify(abs("src/features/layout/post-open-guard.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryGuard",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(PAGE);
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * A stripped copy of the shape X ships: a row that navigates from its own handler, an action bar
 * whose reply control is a button, a quoted post as a focusable `role="link"`, and body text that
 * carries an inline link.
 */
const PAGE = `<!doctype html><meta charset=utf-8>
<style>
  body { margin: 0; font: 15px/1.3 system-ui, sans-serif; }
  [data-testid="cellInnerDiv"] { width: 600px; margin: 30px 0 0 40px; border: 1px solid #333; }
  article { display: block; padding: 12px; cursor: pointer; }
  .head { display: flex; align-items: center; gap: 6px; }
  [data-testid="tweetText"] { margin: 8px 0; }
  [role="group"] { display: flex; gap: 40px; margin-top: 10px; }
  [role="group"] button { padding: 6px 10px; }
  [role="link"] { display: block; margin-top: 8px; padding: 8px; border: 1px solid #444; }
  .filler { height: 30px; }
</style>
<body>
  <div data-testid="cellInnerDiv" id="post">
    <article data-testid="tweet">
      <div class="head">
        <div data-testid="User-Name"><a href="#/author1">@author1</a></div>
        <a href="/author1/status/1" data-role="timestamp">2h</a>
      </div>
      <div data-testid="tweetText">post one, with an <a href="#/hashtag" data-role="inline">inline link</a> in it</div>
      <div data-testid="tweetPhoto"><a href="/author1/status/1/photo/1" data-role="photo">photo</a></div>
      <div class="filler"></div>
      <div role="link" tabindex="0" data-role="quote">
        <div data-testid="User-Name"><a href="#/quoted">@quoted</a></div>
        <div data-testid="tweetText">the quoted post</div>
      </div>
      <div role="group" aria-label="Post actions">
        <button data-testid="reply" type="button" aria-label="42 Replies. Reply">42</button>
        <button data-testid="retweet" type="button" aria-label="Repost">128</button>
        <button data-testid="like" type="button" aria-label="Like">1.2K</button>
      </div>
    </article>
  </div>
  <div data-testid="cellInnerDiv" id="mediaonly">
    <article data-testid="tweet">
      <div class="head"><div data-testid="User-Name"><a href="#/author2">@author2</a></div></div>
      <div data-testid="tweetText">a post whose only status link is its photo</div>
      <div data-testid="tweetPhoto"><a href="/author2/status/2/photo/1" data-role="photo2">photo</a></div>
      <div role="group" aria-label="Post actions">
        <button data-testid="reply" type="button" aria-label="3 Replies. Reply">3</button>
      </div>
    </article>
  </div>
</body>`;

/** Boots the feature and wires the counters every assertion reads. */
async function boot(openFromReplyOnly) {
  await page.evaluate(async (enabled) => {
    if (window.__ctx) {
      await AviaryGuard.postOpenGuardFeature.destroy(window.__ctx);
    }
    const settings = AviaryGuard.normalizeSettings({ layout: { openFromReplyOnly: enabled } });
    const ctx = {
      settings,
      storage: { async get(_key, fallback) { return fallback; }, async set() {} },
      route: { href: "https://x.com/home", path: "/home", surface: "home" },
      diagnostics: { info() {}, warn() {}, error() {} },
      auditLog: { record() {} },
      limiter: { take: () => true },
      saveSettings: async () => {},
      requestApply: () => {}
    };

    await AviaryGuard.postOpenGuardFeature.init(ctx);
    window.__ctx = ctx;
    await AviaryGuard.postOpenGuardFeature.apply(ctx, document);

    window.__opened = 0;
    window.__replied = 0;
    window.__quoted = 0;
    window.__navigated = [];
    if (!window.__wired) {
      window.__wired = true;
      // X opens the post from a handler on the row, so that is where the counter goes.
      for (const article of document.querySelectorAll("article")) {
        article.addEventListener("click", () => {
          window.__opened += 1;
        });
      }
      for (const reply of document.querySelectorAll('[data-testid="reply"]')) {
        reply.addEventListener("click", () => {
          window.__replied += 1;
        });
      }
      document.querySelector('[data-role="quote"]').addEventListener("click", () => {
        window.__quoted += 1;
      });
      // The permalink is what the guard clicks to hand navigation to X's router. Recorded and
      // cancelled so the harness page stays put.
      document.addEventListener(
        "click",
        (event) => {
          const link = event.target.closest?.("a[href]");
          if (!link) return;
          window.__navigated.push(link.getAttribute("href"));
          event.preventDefault();
        },
        false
      );
    }
  }, openFromReplyOnly);
}

async function rectOf(selector) {
  return page.evaluate((sel) => {
    const rect = document.querySelector(sel).getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }, selector);
}

async function clickCenter(selector) {
  const box = await rectOf(selector);
  await page.mouse.click((box.left + box.right) / 2, (box.top + box.bottom) / 2);
}

/**
 * `rowOpened` is X's own row handler firing; `openedViaReply` is the feature reporting that it
 * took a press on the reply icon. Kept apart deliberately: naming both of them "opened" is how an
 * earlier version of this file silently asserted the feature's counter against the page's.
 */
async function counters() {
  return page.evaluate(() => {
    const counts = AviaryGuard.postOpenGuardCounts();
    return {
      rowOpened: window.__opened,
      replied: window.__replied,
      quoted: window.__quoted,
      navigated: [...window.__navigated],
      swallowed: counts.swallowed,
      openedViaReply: counts.opened
    };
  });
}

test("a press on the row itself no longer opens the post", async () => {
  await boot(true);
  const before = await counters();

  await clickCenter('#post [data-testid="tweetText"]');
  await clickCenter(".filler");
  const head = await rectOf(".head");
  await page.mouse.click(head.right - 8, (head.top + head.bottom) / 2);

  const after = await counters();
  assert.equal(after.rowOpened, before.rowOpened, "no press on the row may open the post");
  assert.deepEqual(after.navigated, [], "and none of them navigates anywhere");
  assert.equal(after.swallowed - before.swallowed, 3, "all three presses are accounted for");
});

test("the reply icon opens the post through its own permalink", async () => {
  await boot(true);
  await clickCenter('#post [data-testid="reply"]');

  const after = await counters();
  assert.deepEqual(after.navigated, ["/author1/status/1"], "the post's permalink is what was followed");
  assert.equal(after.openedViaReply, 1, "and the feature is what followed it");
  assert.equal(after.replied, 0, "X's inline composer never saw the press");
  // The synthesized press on the permalink bubbles, so X's row handler sees it too. That is the
  // price of handing navigation to X's own router rather than reloading the feed, and it is
  // harmless: the row would navigate to the post that is already being opened.
});

test("controls and links inside the post keep working", async () => {
  await boot(true);
  const before = await counters();

  await clickCenter('[data-role="timestamp"]');
  await clickCenter('[data-role="inline"]');
  await clickCenter('[data-testid="User-Name"] a');
  assert.deepEqual(
    (await counters()).navigated,
    ["/author1/status/1", "#/hashtag", "#/author1"],
    "every real link still navigates"
  );

  await clickCenter('[data-testid="like"]');
  await clickCenter('[data-role="quote"]');
  const after = await counters();
  assert.equal(after.quoted, 1, "a quoted post is its own link and still opens");
  assert.equal(after.swallowed, before.swallowed, "nothing here was absorbed");
});

test("the reply control says what it now does, and says what it did again afterwards", async () => {
  await boot(true);
  assert.equal(
    await page.evaluate(() => document.querySelector('#post [data-testid="reply"]').getAttribute("aria-label")),
    "Open post"
  );

  await page.evaluate(async () => {
    await AviaryGuard.postOpenGuardFeature.destroy(window.__ctx);
    window.__ctx = undefined;
  });
  assert.equal(
    await page.evaluate(() => document.querySelector('#post [data-testid="reply"]').getAttribute("aria-label")),
    "42 Replies. Reply",
    "turning the feature off puts X's own name back"
  );
});

/**
 * The setting ships off, so with it off the row must behave exactly as X built it. A guard that
 * swallowed everything unconditionally would satisfy every assertion above.
 */
test("with the setting off, the row opens the post and the reply icon replies", async () => {
  await boot(false);
  const before = await counters();

  await clickCenter('#post [data-testid="tweetText"]');
  await clickCenter('#post [data-testid="reply"]');

  const after = await counters();
  assert.equal(after.rowOpened, 2, "the row handler sees both presses, as X intends");
  assert.equal(after.replied, 1, "and the reply control is X's own again");
  assert.deepEqual(after.navigated, [], "nothing was opened through a permalink");
  assert.equal(after.swallowed, before.swallowed, "nothing was absorbed");
  assert.equal(after.openedViaReply, before.openedViaReply, "and the feature opened nothing");
  assert.equal(
    await page.evaluate(() => document.querySelector('#post [data-testid="reply"]').getAttribute("aria-label")),
    "42 Replies. Reply"
  );
});

/**
 * A post's media links are `/status/<id>` URLs with `/photo/1` on the end, and following one opens
 * the lightbox rather than the post. The second fixture post has no other status link at all, so a
 * match that merely looked for `/status/<digits>` would open the photo. Leaving the press to X is
 * the right answer: opening the wrong thing is the failure this whole feature exists to stop.
 */
test("a media link is never mistaken for the post's permalink", async () => {
  await boot(true);
  const before = await counters();

  await clickCenter('#mediaonly [data-testid="reply"]');

  const after = await counters();
  assert.deepEqual(after.navigated, [], "the photo URL was not followed");
  assert.equal(after.openedViaReply, before.openedViaReply, "and nothing was opened");
  assert.equal(after.replied, 1, "the press falls through to X, which still knows what to do");

  // The post that does carry a permalink is unaffected by any of that.
  await clickCenter('#post [data-testid="reply"]');
  assert.deepEqual((await counters()).navigated, ["/author1/status/1"]);
});
