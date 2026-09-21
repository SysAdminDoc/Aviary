import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The themed full-width media rule reached posts it was never meant to reach.
 *
 * `inline-size: 100% !important; max-inline-size: none !important` is right for the post the
 * reader is looking at. Applied to every photo, video and GIF on the page it also caught the
 * replies under a conversation and the quoted post inside a tweet, whose media X deliberately
 * keeps small -- and since it removed X's own cap as well, each one grew to the full column and
 * pushed the thread off the screen.
 *
 * The fixture stands in for that cap with a plain 320px ceiling of its own, because the defect is
 * exactly that Aviary overrode the host's ceiling. A fixture without one could not tell the fixed
 * stylesheet from the broken one.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The ceiling the fixture stands X's own cap up as, plus the 1px border noir draws on each side. */
const CEILING_PX = 320;
const CEILING_WITH_BORDER_PX = CEILING_PX + 2;

const HOST_CSS = `
  body { margin: 0; background: #000; color: #fff; font: 15px system-ui, sans-serif; }
  [data-testid="primaryColumn"] { width: 600px; }
  [data-testid="cellInnerDiv"] { border-bottom: 1px solid #222; padding: 12px; }
  /* X's own ceiling on media, which Aviary must not lift for a post the reader is not on. */
  [data-testid="tweetPhoto"],
  [data-testid="videoComponent"] { display: block; max-width: 320px; height: 180px; background: #16181c; }
  [role="link"] { display: block; border: 1px solid #333; border-radius: 12px; padding: 8px; }
`;

const post = (id, extra = "") => `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <img data-testid="Tweet-User-Avatar" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
      <div data-testid="User-Name"><a href="/author">Author</a></div>
      <a href="/author/status/${id}">2h</a>
      <div data-testid="tweetText">post ${id}</div>
      <div data-testid="tweetPhoto" id="photo-${id}"></div>
      <div data-testid="videoComponent" id="video-${id}" aria-label="Embedded video"></div>
      ${extra}
    </article>
  </div>`;

const CONVERSATION = `<!doctype html><meta charset=utf-8><style>${HOST_CSS}</style>
<body><div data-testid="primaryColumn">${post("1")}${post("2")}${post("3")}</div></body>`;

const TIMELINE = `<!doctype html><meta charset=utf-8><style>${HOST_CSS}</style>
<body><div data-testid="primaryColumn">${post(
  "9",
  `<div role="link" tabindex="0">
     <div data-testid="User-Name"><a href="/quoted">Quoted</a></div>
     <div data-testid="tweetText">the quoted post</div>
     <div data-testid="tweetPhoto" id="photo-quote"></div>
   </div>`
)}</div></body>`;

const WIDE_MEDIA = `<!doctype html><meta charset=utf-8><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #000; color: #fff; font: 15px system-ui, sans-serif; }
  [data-testid="primaryColumn"] { width: 600px; }
  [data-testid="cellInnerDiv"] { width: 100%; }
  article[data-testid="tweet"] { width: 100%; padding: 24px 64px; }
  .media-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border: 1px solid #333; border-radius: 16px; }
  .media-frame > [data-testid="tweetPhoto"] { position: absolute; inset: 0; width: 100%; height: 100%; }
  [role="group"] { display: flex; width: 100%; max-width: 600px; }
  #quote { display: block; width: 100%; margin-top: 20px; border: 1px solid #333; padding: 12px; }
  #quote-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  #quote-grid [data-testid="tweetPhoto"] { aspect-ratio: 4 / 3; min-width: 0; background: #16181c; }
</style><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet">
  <div data-testid="User-Name"><a href="/author">Author</a></div>
  <a href="/author/status/55">2h</a>
  <div data-testid="tweetText">A wide post with bounded media.</div>
  <div class="media-frame" id="wide-media-frame"><div data-testid="tweetPhoto"></div></div>
  <div role="group" id="wide-actions"><button>Reply</button><button>Like</button></div>
  <div role="link" tabindex="0" id="quote">
    <div data-testid="User-Name"><a href="/quoted">Quoted author</a></div>
    <div id="quote-grid">
      <div data-testid="tweetPhoto"></div><div data-testid="tweetPhoto"></div>
      <div data-testid="tweetPhoto"></div><div data-testid="tweetPhoto"></div>
    </div>
  </div>
</article></div></div></body>`;

const STALE_HEIGHT_MEDIA = `<!doctype html><meta charset=utf-8><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #000; color: #fff; }
  [data-testid="primaryColumn"] { width: 600px; }
  article[data-testid="tweet"] { width: 100%; padding: 24px 64px; }
  #stale-height-frame {
    position: relative;
    width: 100%;
    height: 820px;
    overflow: hidden;
    border: 1px solid #333;
    border-radius: 16px;
  }
  #stale-height-frame > [data-testid="tweetPhoto"] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet">
  <div data-testid="User-Name"><a href="/author">Author</a></div>
  <a href="/author/status/88">2h</a>
  <div data-testid="tweetText">A host frame whose stale height must not take over the viewport.</div>
  <div id="stale-height-frame"><div data-testid="tweetPhoto"></div></div>
</article></div></div></body>`;

let browser;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-reply-media-"));
  bundle = path.join(temp, "theme.js");
  await build({
    entryPoints: [path.join(root, "src/features/appearance/theme.ts")],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryTheme",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Serves one of the fixtures above at a real x.com URL, themed, and measures what it drew. */
async function measure(url, body, selectors, viewportWidth = 1280) {
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: 900 } });
  try {
    await page.route("https://x.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body })
    );
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ path: bundle });
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = AviaryTheme.THEME_CSS;
      document.head.append(style);
      AviaryTheme.applyTheme({
        appearance: {
          theme: "noir",
          denseMode: false,
          timelineWidth: "wide",
          hideBorders: false,
          hideCounts: false,
          restoreChirp: false
        },
        accessibility: { highContrast: false, reduceMotion: "never" }
      });
    });
    return await page.evaluate((wanted) => {
      const out = { roles: {}, heights: {} };
      for (const [name, selector] of Object.entries(wanted)) {
        const node = document.querySelector(selector);
        out[name] = node ? Math.round(node.getBoundingClientRect().width) : null;
        out.heights[name] = node ? Math.round(node.getBoundingClientRect().height) : null;
      }
      out.roles.focal = document.querySelectorAll('article[data-av-conversation-role="focal"]').length;
      out.roles.reply = document.querySelectorAll('article[data-av-conversation-role="reply"]').length;
      out.declaredCeiling = AviaryTheme.PRIMARY_MEDIA_MAX_WIDTH_PX;
      out.contextCeiling = AviaryTheme.CONTEXT_MEDIA_MAX_WIDTH_PX;
      out.mediaFrames = document.querySelectorAll('[data-av-media-frame]').length;
      out.contexts = document.querySelectorAll('[data-av-media-context="embedded"]').length;
      out.scrollWidth = document.documentElement.scrollWidth;
      out.viewportWidth = document.documentElement.clientWidth;
      return out;
    }, selectors);
  } finally {
    await page.close();
  }
}

test("a reply's photo, video and GIF keep the size X gave them", async () => {
  const seen = await measure("https://x.com/author/status/1", CONVERSATION, {
    focalPhoto: "#photo-1",
    focalVideo: "#video-1",
    replyPhoto: "#photo-2",
    replyVideo: "#video-2",
    lastReplyPhoto: "#photo-3"
  });

  assert.equal(seen.roles.focal, 1, "the fixture must produce one focal post");
  assert.equal(seen.roles.reply, 2, "and two replies, or this proves nothing about replies");

  assert.ok(
    seen.focalPhoto > 500,
    `the post being read still fills the column, saw ${seen.focalPhoto}px`
  );
  assert.ok(seen.focalVideo > 500, `and so does its video, saw ${seen.focalVideo}px`);

  assert.ok(
    seen.replyPhoto <= CEILING_WITH_BORDER_PX,
    `a reply's photo keeps the host's ceiling, saw ${seen.replyPhoto}px`
  );
  assert.ok(
    seen.replyVideo <= CEILING_WITH_BORDER_PX,
    `and so does a reply's video or GIF, saw ${seen.replyVideo}px`
  );
  assert.ok(
    seen.lastReplyPhoto <= CEILING_WITH_BORDER_PX,
    `every reply, not just the first, saw ${seen.lastReplyPhoto}px`
  );
});

test("a quoted post's media is not stretched either", async () => {
  const seen = await measure("https://x.com/home", TIMELINE, {
    hostPhoto: "#photo-9",
    quotedPhoto: "#photo-quote"
  });

  assert.ok(
    seen.hostPhoto > 500,
    `the post's own photo still fills the column, saw ${seen.hostPhoto}px`
  );
  assert.ok(
    seen.quotedPhoto <= CEILING_WITH_BORDER_PX,
    `the quoted post's photo keeps the host's ceiling, saw ${seen.quotedPhoto}px`
  );
});

/**
 * Opening a reply's permalink renders the parent chain above it, so the post being read is not the
 * first cell on the page.
 *
 * The focal post was picked by DOM order, which made the parent focal and the post the reader
 * actually opened a "reply". That only shifted typography until media sizing started reading the
 * same marker; then the post being read had its media capped and the parent got the full-width
 * treatment, which is the acceptance criterion inverted.
 */
test("the post the route names is the focal one, not whichever renders first", async () => {
  const seen = await measure("https://x.com/author/status/2", CONVERSATION, {
    parentPhoto: "#photo-1",
    readPhoto: "#photo-2",
    replyPhoto: "#photo-3"
  });

  assert.equal(seen.roles.focal, 1, "exactly one post is the focal one");
  assert.ok(
    seen.readPhoto > 500,
    `the post the URL names must fill the column, saw ${seen.readPhoto}px`
  );
  assert.ok(
    seen.parentPhoto <= CEILING_WITH_BORDER_PX,
    `the parent above it is context, not the subject, saw ${seen.parentPhoto}px`
  );
  assert.ok(
    seen.replyPhoto <= CEILING_WITH_BORDER_PX,
    `and the reply below it keeps X's ceiling, saw ${seen.replyPhoto}px`
  );
});

/**
 * Filling the column is not the same as filling the browser window.
 *
 * The rule that lets the post being read use the whole column dropped X's ceiling and put nothing
 * in its place, so on a wide timeline, where the column is the viewport, one photo was as wide as
 * the screen: measured on this fixture before the ceiling existed, 1,258px at a 1280px viewport and
 * 2,538px at 2560px. That leaves the caption a screen away from the picture it belongs to.
 */
test("media on the post being read stops at a readable width instead of the whole screen", async () => {
  for (const viewportWidth of [1280, 1920, 2560]) {
    const seen = await measure(
      "https://x.com/home",
      TIMELINE,
      { photo: "#photo-9", video: "#video-9", column: '[data-testid="primaryColumn"]' },
      viewportWidth
    );
    const ceilingWithBorder = seen.declaredCeiling + 2;

    // The control: wide really does hand the column the whole window, so a small photo is the
    // ceiling doing its job and not the column having been narrow all along.
    assert.ok(
      seen.column >= viewportWidth - 2,
      `wide must hand the column the window, saw ${seen.column}px of ${viewportWidth}px`
    );
    assert.ok(
      seen.photo <= ceilingWithBorder,
      `a photo must stop at ${seen.declaredCeiling}px, saw ${seen.photo}px at ${viewportWidth}px`
    );
    assert.ok(
      seen.video <= ceilingWithBorder,
      `and so must a video, saw ${seen.video}px at ${viewportWidth}px`
    );
    // It must still be larger than the ceiling X itself would have given it, or the rule has been
    // undone rather than bounded.
    assert.ok(
      seen.photo > CEILING_WITH_BORDER_PX,
      `media on the post being read should still beat X's own cap, saw ${seen.photo}px`
    );
  }
});

test("true-wide posts bound the real media frame and keep quote galleries together", async () => {
  const seen = await measure(
    "https://x.com/home",
    WIDE_MEDIA,
    {
      column: '[data-testid="primaryColumn"]',
      article: 'article[data-testid="tweet"]',
      frame: "#wide-media-frame",
      actions: "#wide-actions",
      quote: "#quote",
      quoteTile: "#quote-grid [data-testid=\"tweetPhoto\"]"
    },
    1920
  );

  assert.ok(seen.column >= 1918, `wide column stayed narrow at ${seen.column}px`);
  assert.equal(seen.article, seen.column, "the post must use the true-wide column");
  assert.ok(
    seen.frame <= seen.declaredCeiling + 2,
    `the media frame exceeded ${seen.declaredCeiling}px: ${seen.frame}px`
  );
  assert.ok(seen.frame > 900, `wide media was needlessly shrunk to ${seen.frame}px`);
  assert.equal(seen.actions, seen.declaredCeiling, "the action row must align with wide media");
  assert.ok(
    seen.quote <= seen.contextCeiling + 2,
    `the quoted post exceeded ${seen.contextCeiling}px: ${seen.quote}px`
  );
  assert.ok(seen.quoteTile < seen.quote / 2, "quote gallery tiles were expanded independently");
  assert.equal(seen.mediaFrames, 1, "only the post's own media frame should be stamped");
  assert.equal(seen.contexts, 1, "the quote must be bounded as one component");
  assert.ok(seen.scrollWidth <= seen.viewportWidth + 1, "media created horizontal page overflow");
});

test("a stale host height cannot make wide media taller than the viewport ceiling", async () => {
  const seen = await measure(
    "https://x.com/home",
    STALE_HEIGHT_MEDIA,
    { frame: "#stale-height-frame" },
    1920
  );
  const viewportCeiling = Math.round((900 * 72) / 100);

  assert.ok(
    seen.heights.frame <= viewportCeiling,
    `the media frame exceeded the ${viewportCeiling}px viewport ceiling: ${seen.heights.frame}px`
  );
});
