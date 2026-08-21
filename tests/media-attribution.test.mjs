import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Whose media is it?
 *
 * A timeline post can hold three kinds of media in one `article` subtree: its own, a quoted
 * post's, and a link card's preview. The extractor walked the whole subtree and filed every one
 * of them under the outer post's handle and id, so saving a photo out of a quote wrote it as if
 * the quoting account had published it. That is the complaint filed against every feed downloader
 * in this lineage, and it is not visible in a filename unless you know whose photo it was.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

/**
 * X's current Home shape for a quote: a focusable `div[role="link"]` with no test id, carrying a
 * second author header and no permalink of its own -- the whole card is the link.
 */
const QUOTE_FIXTURE = `
<main data-testid="primaryColumn">
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/outer"><span>@outer</span></a></div>
      <a href="/outer/status/1900000000000001"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
      <div data-testid="tweetText">what the outer account said</div>
      <div data-testid="tweetPhoto" style="width: 400px; height: 240px;">
        <img src="https://pbs.twimg.com/media/OuterPhoto?format=jpg&name=small" style="width:100%;height:100%" alt="">
      </div>
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><a href="/quoted"><span>@quoted</span></a></div>
        <div data-testid="tweetText">what the quoted account said</div>
        <div data-testid="tweetPhoto" style="width: 400px; height: 240px;">
          <img src="https://pbs.twimg.com/media/QuotedPhoto?format=jpg&name=small" style="width:100%;height:100%" alt="">
        </div>
      </div>
      <div role="group"><button data-testid="reply">Reply</button></div>
    </article>
  </div>
</main>`;

/** A post whose only permalink lives inside the quote it carries. */
const NO_PERMALINK_FIXTURE = `
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/outer"><span>@outer</span></a></div>
  <div role="link" tabindex="0">
    <div data-testid="User-Name"><a href="/quoted"><span>@quoted</span></a></div>
    <a href="/quoted/status/1900000000000999"><time datetime="2026-08-18T09:00:00.000Z">1h</time></a>
    <div data-testid="tweetText">the quoted text</div>
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/QuoteOnly?format=jpg&name=small" alt=""></div>
  </div>
</article>`;

/** A link card: its preview belongs to the page linked, not to the account that linked it. */
const CARD_FIXTURE = `
<article data-testid="tweet">
  <div data-testid="User-Name"><a href="/outer"><span>@outer</span></a></div>
  <a href="/outer/status/1900000000000002"><time datetime="2026-08-18T10:00:00.000Z">now</time></a>
  <div data-testid="tweetText">read this</div>
  <div data-testid="card.wrapper">
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/CardPreview?format=jpg&name=small" alt=""></div>
  </div>
</article>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-attribution-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { extractTweet, mediaIdentity, quotedPost } from ${JSON.stringify(abs("src/features/media/extract.ts"))};`,
      `export { mediaButtonsFeature } from ${JSON.stringify(abs("src/features/media/media-buttons.ts"))};`,
      `export { collectExportRecords } from ${JSON.stringify(abs("src/features/export/collector.ts"))};`,
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
    globalName: "AviaryAttribution",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("https://pbs.twimg.com/**", (route) => route.fulfill({
    status: 200,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "image/jpeg"
    },
    body: Buffer.from(route.request().url().includes("QuotedPhoto")
      ? [0xff, 0xd8, 2, 0xff, 0xd9]
      : [0xff, 0xd8, 1, 0xff, 0xd9])
  }));
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.evaluate(() => {
    window.mediaCtx = (mutate) => {
      const settings = AviaryAttribution.cloneSettings(AviaryAttribution.DEFAULT_SETTINGS);
      mutate?.(settings);
      return {
        settings,
        route: { surface: "home", path: "/home" },
        storage: {
          async get(_key, fallback) {
            return fallback;
          },
          async set() {},
          async remove() {}
        },
        auditLog: { async record() {} },
        limiter: { async waitForToken() {} },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
  });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("a quoted post's photo is the quoted account's, not the account that quoted it", async () => {
  const read = await page.evaluate((fixture) => {
    document.body.innerHTML = fixture;
    const article = document.querySelector('article[data-testid="tweet"]');
    const tweet = AviaryAttribution.extractTweet(article);
    return {
      tweetId: tweet.tweetId,
      handle: tweet.handle,
      text: tweet.text,
      media: tweet.media.map((media) => ({
        url: media.image?.url ?? null,
        owner: media.owner,
        identity: AviaryAttribution.mediaIdentity(tweet, media)
      }))
    };
  }, QUOTE_FIXTURE);

  // The outer post keeps its own identity even though the quote carries a second author header.
  assert.equal(read.handle, "outer");
  assert.equal(read.tweetId, "1900000000000001");
  assert.equal(read.text, "what the outer account said");

  assert.equal(read.media.length, 2, "the fixture must offer both photos or this proves nothing");
  const [own, quoted] = read.media;
  assert.match(own.url, /OuterPhoto/);
  assert.deepEqual(own.owner, {
    scope: "post",
    tweetId: "1900000000000001",
    handle: "outer",
    text: "what the outer account said"
  });

  assert.match(quoted.url, /QuotedPhoto/);
  assert.equal(quoted.owner.scope, "quote");
  assert.equal(quoted.owner.handle, "quoted");
  assert.equal(quoted.owner.text, "what the quoted account said");
  // No permalink inside the card, so the quoted post's own id is genuinely unknown here.
  assert.equal(quoted.owner.tweetId, null);

  // The handle is the ownership claim, and it must be the quoted account's.
  assert.equal(quoted.identity.handle, "quoted");
  assert.equal(quoted.identity.text, "what the quoted account said");
  // The id falls back to where the asset was found, which keeps names unique without ever
  // attributing the photo to @outer.
  assert.equal(quoted.identity.tweetId, "1900000000000001");
});

test("a post with no permalink of its own does not adopt the quoted post's id", async () => {
  const read = await page.evaluate((fixture) => {
    document.body.innerHTML = fixture;
    const article = document.querySelector('article[data-testid="tweet"]');
    const tweet = AviaryAttribution.extractTweet(article);
    return {
      tweetId: tweet.tweetId,
      handle: tweet.handle,
      text: tweet.text,
      owner: tweet.media[0]?.owner ?? null,
      quoteFound: Boolean(AviaryAttribution.quotedPost(article))
    };
  }, NO_PERMALINK_FIXTURE);

  assert.equal(read.quoteFound, true, "the fixture must contain a quote or this proves nothing");
  assert.equal(read.tweetId, null, "the outer post has no permalink; the quoted one is not its own");
  assert.equal(read.handle, "outer");
  assert.equal(read.text, "", "the quoted post's text is not the outer post's text");
  // The quote does render a permalink here, so the media can be filed under the post it belongs to.
  assert.equal(read.owner.tweetId, "1900000000000999");
  assert.equal(read.owner.handle, "quoted");
});

test("a link card's preview is marked as the card's, not as the post's own media", async () => {
  const read = await page.evaluate((fixture) => {
    document.body.innerHTML = fixture;
    const article = document.querySelector('article[data-testid="tweet"]');
    const tweet = AviaryAttribution.extractTweet(article);
    return tweet.media.map((media) => media.owner);
  }, CARD_FIXTURE);

  assert.equal(read.length, 1);
  assert.equal(read[0].scope, "card");
  // The account that posted the link is still the right one to file it under; what changes is
  // that nothing now treats it as media that account published.
  assert.equal(read[0].handle, "outer");
});

test("the post-level Download saves only the post's own media", async () => {
  const observed = await page.evaluate(async (fixture) => {
    document.body.innerHTML = fixture;
    const filenames = [];
    window.GM_download = (options) => {
      // GM_download's option is `name`, not `filename`.
      filenames.push({ filename: options.name, url: options.url });
      options.onload?.();
    };
    const ctx = window.mediaCtx();
    await AviaryAttribution.mediaButtonsFeature.init(ctx);
    await AviaryAttribution.mediaButtonsFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const action = document.querySelector("[data-av-media-action]");
    const label = action?.getAttribute("aria-label") ?? null;
    const perAsset = document.querySelectorAll("[data-av-media-button]").length;
    action?.click();
    await new Promise((resolve) => setTimeout(resolve, 200));

    await AviaryAttribution.mediaButtonsFeature.destroy(ctx);
    delete window.GM_download;
    return { filenames, label, perAsset };
  }, QUOTE_FIXTURE);

  assert.equal(observed.perAsset, 2, "both photos must carry their own Save control");
  assert.equal(observed.filenames.length, 1, `the post action saved ${JSON.stringify(observed.filenames)}`);
  assert.match(observed.filenames[0].url, /OuterPhoto/);
  assert.match(observed.filenames[0].filename, /^outer_/);
  // Saying so is what makes this a decision rather than a silently smaller download.
  assert.match(observed.label, /own media/);
});

test("the quoted photo's own Save button files it under the quoted account", async () => {
  const observed = await page.evaluate(async (fixture) => {
    document.body.innerHTML = fixture;
    const filenames = [];
    window.GM_download = (options) => {
      // GM_download's option is `name`, not `filename`.
      filenames.push({ filename: options.name, url: options.url });
      options.onload?.();
    };
    const ctx = window.mediaCtx();
    await AviaryAttribution.mediaButtonsFeature.init(ctx);
    await AviaryAttribution.mediaButtonsFeature.apply(ctx, document);
    await new Promise((resolve) => setTimeout(resolve, 40));

    const quotePhoto = [...document.querySelectorAll('[data-testid="tweetPhoto"]')].find((node) =>
      node.querySelector('img[src*="QuotedPhoto"]')
    );
    const button = quotePhoto.querySelector("[data-av-media-button]");
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 200));

    await AviaryAttribution.mediaButtonsFeature.destroy(ctx);
    delete window.GM_download;
    return filenames;
  }, QUOTE_FIXTURE);

  assert.equal(observed.length, 1, `expected one save, saw ${JSON.stringify(observed)}`);
  assert.match(observed[0].url, /QuotedPhoto/);
  assert.match(
    observed[0].filename,
    /^quoted_/,
    `the quoted account's photo was saved as ${observed[0].filename}`
  );
  assert.doesNotMatch(observed[0].filename, /^outer_/);
});

test("an export record says whose the quoted media is instead of listing it as its own", async () => {
  const record = await page.evaluate((fixture) => {
    document.body.innerHTML = fixture;
    const records = AviaryAttribution.collectExportRecords(document, "home");
    return records[0] ?? null;
  }, QUOTE_FIXTURE);

  assert.ok(record, "no export record was collected");
  assert.equal(record.handle, "outer");
  assert.equal(record.media.length, 2);
  assert.equal(record.media[0].attribution, undefined, "the post's own photo needs no attribution");
  assert.deepEqual(record.media[1].attribution, { scope: "quote", handle: "quoted" });
  // The quote summary and the media attribution now come from one definition of "this is a quote";
  // they used to use different selectors, and this fixture matched only one of them.
  assert.deepEqual(record.quote, { handle: "quoted", text: "what the quoted account said" });
});
