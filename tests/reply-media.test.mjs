import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * A comment section under a popular post is mostly memes. This drops the replies whose whole
 * contribution is a picture, and nothing else: not the post being read, not the thread above it,
 * and not a reply that wrote something.
 *
 * Every assertion measures what the browser actually painted, because the rule is a `:has()`
 * selector against X's own markup. Asserting that an attribute was written would prove the stamp
 * ran, not that anything disappeared.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let temp;
let bundle;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-reply-media-filter-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { replyMediaFeature, replyMediaStamped } from ${JSON.stringify(abs("src/features/filtering/reply-media.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryReplyMedia",
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

const PHOTO = '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/meme?format=jpg" alt=""></div>';
const VIDEO = '<div data-testid="videoPlayer"></div>';
const GIF = '<div data-testid="videoComponent" aria-label="Embedded video GIF"></div>';
const QUOTE_WITH_PHOTO = `
  <div role="link" tabindex="0">
    <div data-testid="User-Name"><a href="/quoted">Quoted</a></div>
    <div data-testid="tweetText">the quoted post</div>
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quoted?format=jpg" alt=""></div>
  </div>`;

/** One conversation row. `id` doubles as the status id its permalink carries. */
const post = (id, body = "") => `
  <div data-testid="cellInnerDiv" id="cell-${id}">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/author${id}">@author${id}</a></div>
      <a href="/author${id}/status/${id}">2h</a>
      <div data-testid="tweetText">post ${id}</div>
      ${body}
    </article>
  </div>`;

/**
 * A parent, the post being read, then four replies. Two of the replies are memes, one wrote
 * something, and one quotes a post that has a picture of its own.
 */
const CONVERSATION = `<!doctype html><meta charset=utf-8>
<style>
  body { margin: 0; font: 15px system-ui, sans-serif; }
  [data-testid="primaryColumn"] { width: 600px; }
  [data-testid="cellInnerDiv"] { border-bottom: 1px solid #333; padding: 10px; }
  [data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"] {
    display: block; width: 300px; height: 160px; background: #222;
  }
</style>
<body>
  <div data-testid="primaryColumn">
    ${post("100", PHOTO)}
    ${post("200", PHOTO)}
    ${post("300", PHOTO)}
    ${post("400")}
    ${post("500", VIDEO)}
    ${post("600", GIF)}
    ${post("700", QUOTE_WITH_PHOTO)}
  </div>
</body>`;

/** Serves the conversation at a real x.com status URL and reports what is visible. */
async function measure(url, { hideMediaReplies }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route("https://x.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: CONVERSATION })
    );
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ path: bundle });
    await page.evaluate(async (enabled) => {
      const settings = AviaryReplyMedia.normalizeSettings({ filter: { hideMediaReplies: enabled } });
      const ctx = {
        settings,
        storage: { async get(_key, fallback) { return fallback; }, async set() {} },
        route: { href: location.href, path: location.pathname, surface: "status" },
        diagnostics: { info() {}, warn() {}, error() {} },
        auditLog: { record() {} },
        limiter: { take: () => true },
        saveSettings: async () => {},
        requestApply: () => {}
      };
      await AviaryReplyMedia.replyMediaFeature.init(ctx);
      await AviaryReplyMedia.replyMediaFeature.apply(ctx, document);
      window.__ctx = ctx;
    }, hideMediaReplies);

    return await page.evaluate(() => {
      const visible = (id) => {
        const cell = document.getElementById(id);
        return cell ? cell.getBoundingClientRect().height > 0 : null;
      };
      return {
        parent: visible("cell-100"),
        focal: visible("cell-200"),
        memePhoto: visible("cell-300"),
        textOnly: visible("cell-400"),
        memeVideo: visible("cell-500"),
        memeGif: visible("cell-600"),
        quoteOfPhoto: visible("cell-700"),
        stamped: AviaryReplyMedia.replyMediaStamped()
      };
    });
  } finally {
    await page.close();
  }
}

test("under the post you opened, the meme replies go and nothing else does", async () => {
  const seen = await measure("https://x.com/author200/status/200", { hideMediaReplies: true });

  // Every post in this fixture carries `tweetText`, so these three are captioned memes rather than
  // bare images. That is the normal shape, and a rule that spared captioned ones would leave most
  // of a comment section exactly as it was.
  assert.equal(seen.memePhoto, false, "a reply that is a photo is gone, caption and all");
  assert.equal(seen.memeVideo, false, "a reply that is a video is gone");
  assert.equal(seen.memeGif, false, "a reply that is a GIF is gone");

  assert.equal(seen.focal, true, "the post being read stays, picture and all");
  assert.equal(seen.parent, true, "so does the thread above it, picture and all");
  assert.equal(seen.textOnly, true, "and a reply that wrote something stays");
  assert.equal(
    seen.quoteOfPhoto,
    true,
    "a reply quoting a post with a picture wrote something, so it stays"
  );

  assert.equal(seen.stamped, 5, "the five rows after the subject are the ones considered");
});

/**
 * Opening a reply's permalink renders the parent chain above it, so the subject is not row one.
 * Getting this wrong would hide the post the reader came for and leave the memes in place.
 */
test("the subject is the post the URL names, wherever it renders", async () => {
  const seen = await measure("https://x.com/author400/status/400", { hideMediaReplies: true });

  assert.equal(seen.textOnly, true, "the post named by the route is the subject");
  assert.equal(seen.parent, true, "everything above it is the thread it belongs to");
  assert.equal(seen.focal, true, "including the post it replied to, picture and all");
  assert.equal(seen.memePhoto, true, "and that picture reply is above the subject, so it stays");

  assert.equal(seen.memeVideo, false, "the memes below it still go");
  assert.equal(seen.memeGif, false);
  assert.equal(seen.stamped, 3, "only the three rows after the subject are considered");
});

/** Off by default, and off means X's own conversation, untouched. */
test("with the setting off nothing is hidden or stamped", async () => {
  const seen = await measure("https://x.com/author200/status/200", { hideMediaReplies: false });

  for (const [name, value] of Object.entries(seen)) {
    if (name === "stamped") continue;
    assert.equal(value, true, `${name} must still be visible`);
  }
  assert.equal(seen.stamped, 0, "and no row is marked");
});
