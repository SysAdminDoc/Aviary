import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a long post is chunked, not truncated", async () => {
  const { chunkToLimit, segmentsForTarget, TARGET_LIMITS } = await importSourceModule(
    "src/features/integrations/crosspost.ts"
  );

  const words = Array.from({ length: 140 }, (_, i) => `word${i}`).join(" ");
  assert.ok(words.length > 700);

  const chunks = chunkToLimit(words, TARGET_LIMITS.bluesky);
  assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= TARGET_LIMITS.bluesky, `chunk over the limit: ${chunk.length}`);
  }

  // Nothing may be dropped: the old code sliced to 300 and posted the rest nowhere.
  const rejoined = chunks.join(" ");
  for (const word of ["word0", "word70", "word139"]) {
    assert.ok(rejoined.includes(word), `${word} was lost in chunking`);
  }

  // Words are not cut in half at the boundary.
  for (const chunk of chunks) {
    assert.ok(!/^ord\d/.test(chunk), `chunk starts mid-word: ${chunk.slice(0, 20)}`);
  }

  const mastodon = segmentsForTarget(words, "mastodon", false);
  for (const segment of mastodon) {
    assert.ok(segment.length <= TARGET_LIMITS.mastodon, "Mastodon segments were never chunked at all");
  }
});

test("the limit counts graphemes, so emoji are not miscounted", async () => {
  const { chunkToLimit } = await importSourceModule("src/features/integrations/crosspost.ts");

  // Each family emoji is one grapheme but several UTF-16 units; counting units would chunk far
  // too early and could split a sequence into replacement characters.
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
  const text = Array.from({ length: 40 }, () => family).join("");
  const chunks = chunkToLimit(text, 50);

  assert.equal(chunks.length, 1, "40 graphemes fit in a 50-grapheme limit");
  assert.equal(chunks[0], text, "the sequence must survive intact");
});

test("thread mode splits on blank lines and then chunks each block", async () => {
  const { segmentsForTarget } = await importSourceModule("src/features/integrations/crosspost.ts");

  const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ");
  const segments = segmentsForTarget(`first paragraph\n\n${long}`, "bluesky", true);

  assert.equal(segments[0], "first paragraph");
  assert.ok(segments.length > 2, "the long block must be chunked as well as split");
});

test("a thread that fails halfway reports what was already posted", async () => {
  const { crosspost } = await importSourceModule("src/features/integrations/crosspost.ts");

  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("createSession")) {
      return { ok: true, json: async () => ({ accessJwt: "jwt", did: "did:plc:abc" }) };
    }
    calls += 1;
    // First post succeeds, the second fails: the shape that used to return a bare ok:false and
    // invite a retry that double-posts.
    if (calls === 1) {
      return { ok: true, json: async () => ({ uri: "at://did:plc:abc/app.bsky.feed.post/one", cid: "cid1" }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  try {
    const result = await crosspost(
      {
        bluesky: { enabled: true, service: "https://bsky.social", handle: "me.bsky.social", appPassword: "pw" },
        mastodon: { enabled: false, instance: "", token: "", visibility: "public" }
      },
      { text: "first\n\nsecond", target: "bluesky", asThread: true }
    );

    assert.equal(result.ok, false);
    assert.equal(result.posts, 1, "the count of already-published posts must come back");
    assert.match(result.error, /1 of the thread was already posted/);
    assert.ok(result.url, "the first post's URL must come back so it can be found");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readComposerText keeps the paragraph breaks thread mode splits on", async () => {
  // Asserted before by slicing the function out of the source and matching `/data-block="true"/`
  // and `/join\("\n\n"\)/`. Both survive a reader that finds the blocks and then returns
  // `textContent` anyway -- which is the bug: Draft.js renders one element per paragraph and
  // `textContent` concatenates them with no separator, so a two-paragraph draft arrived as a
  // single run and the blank-line split that drives thread mode could never fire.
  const { chromium } = await import("playwright");
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-composer-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const outfile = path.join(temp, "module.js");
    await build({
      entryPoints: [path.join(root, "src/features/integrations/crosspost.ts")],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "AviaryCrosspost",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });

    const page = await browser.newPage();
    // X's real composer: one `data-block` element per paragraph, no newline characters anywhere.
    await page.setContent(`<!doctype html><meta charset=utf-8><body>
      <div data-testid="tweetTextarea_0"><div data-block="true"><span>first paragraph</span></div><div data-block="true"><span>second paragraph</span></div><div data-block="true"><span>third</span></div></div>
    </body>`);
    await page.addScriptTag({ path: outfile });

    const read = await page.evaluate(() => ({
      text: AviaryCrosspost.readComposerText(),
      naive: document.querySelector('[data-testid="tweetTextarea_0"]').textContent,
      segments: AviaryCrosspost.splitForThread(AviaryCrosspost.readComposerText()).length
    }));

    assert.equal(read.text, "first paragraph\n\nsecond paragraph\n\nthird");
    assert.ok(
      !read.naive.includes("\n"),
      "the fixture must reproduce the shape where textContent loses the breaks"
    );
    // The whole reason the breaks matter: thread mode splits on them.
    assert.equal(read.segments, 3, "each paragraph must become its own post in thread mode");

    const empty = await page.evaluate(() => {
      document.querySelector('[data-testid="tweetTextarea_0"]').remove();
      return AviaryCrosspost.readComposerText();
    });
    assert.equal(empty, "", "no composer means no text, not a throw");
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
