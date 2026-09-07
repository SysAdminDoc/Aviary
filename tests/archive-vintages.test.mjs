import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { test } from "node:test";

/**
 * X's archive has three shapes, and telling them apart is the whole job.
 *
 * The export changed by accretion rather than by version. Roughly 2020 and earlier ships
 * `data/tweet.js` and no direct-message files at all; before 2018 it is the Grailbird layout,
 * one `data/js/tweets/YYYY_MM.js` per month with everything else missing. Three separate
 * third-party importers had the same bug open in 2026: they read an older archive, found no
 * direct messages, and reported that the account had none.
 *
 * The Grailbird fixture below is shaped from a published Grailbird archive rather than from a
 * guess: `data/js/tweets/2011_08.js` opens with `Grailbird.data.tweets_2011_08 = ` and its tweet
 * objects carry `source`, `entities`, `geo`, `id_str`, `text`, `id`, `created_at` and `user`.
 */

function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    const stored = new Uint8Array(deflateRawSync(Buffer.from(content)));
    const crc = nodeCrc32(Buffer.from(content)) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, stored);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length + stored.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of central) {
    chunks.push(entry);
    centralSize += entry.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  chunks.push(eocd);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/** The current layout: `tweets.js` in parts, with the direct-message files beside it. */
function currentArchive() {
  return buildZip([
    {
      name: "data/tweets.js",
      content: `window.YTD.tweets.part0 = ${JSON.stringify([
        {
          tweet: {
            id_str: "1750000000000000001",
            full_text: "A post from the current archive layout.",
            created_at: "Tue Jan 16 12:00:00 +0000 2026",
            lang: "en"
          }
        },
        {
          tweet: {
            id_str: "1750000000000000002",
            full_text: "A second post from the current archive layout.",
            created_at: "Wed Jan 17 12:00:00 +0000 2026",
            lang: "en"
          }
        }
      ])}`
    },
    {
      name: "data/direct-messages.js",
      content: `window.YTD.direct_messages.part0 = ${JSON.stringify([
        {
          dmConversation: {
            conversationId: "111-222",
            messages: [
              { messageCreate: { id: "9001", senderId: "111", recipientId: "222", text: "hello", createdAt: "2026-01-16T12:00:00.000Z" } }
            ]
          }
        }
      ])}`
    }
  ]);
}

/** Roughly 2020 and earlier: one `tweet.js`, and nowhere for a direct message to live. */
function tweetJsArchive() {
  return buildZip([
    {
      name: "data/tweet.js",
      content: `window.YTD.tweet.part0 = ${JSON.stringify([
        {
          tweet: {
            id_str: "1150000000000000001",
            full_text: "A post from the tweet.js archive layout.",
            created_at: "Mon Jul 15 09:30:00 +0000 2019"
          }
        }
      ])}`
    }
  ]);
}

/** Pre-2018: a file per month, `Grailbird.data.tweets_YYYY_MM`, plus `user_details.js`. */
function grailbirdArchive() {
  const month = (name, tweets) => ({
    name: `data/js/tweets/${name}.js`,
    content: `Grailbird.data.tweets_${name} = \n ${JSON.stringify(tweets)}`
  });
  return buildZip([
    month("2011_08", [
      {
        source: "<a href=\"http://example.invalid\" rel=\"nofollow\">Fixture</a>",
        entities: { hashtags: [], urls: [], user_mentions: [] },
        geo: {},
        id_str: "100000000000000001",
        id: 100000000000000001,
        text: "A post from the Grailbird archive layout.",
        created_at: "2011-08-01 10:00:00 +0000",
        user: { name: "Fixture Alpha", screen_name: "fixture_alpha", id_str: "42" }
      }
    ]),
    month("2011_09", [
      {
        source: "<a href=\"http://example.invalid\" rel=\"nofollow\">Fixture</a>",
        entities: { hashtags: [], urls: [], user_mentions: [] },
        geo: {},
        id_str: "100000000000000002",
        id: 100000000000000002,
        text: "A second Grailbird post, in the next month's file.",
        created_at: "2011-09-02 11:00:00 +0000",
        user: { name: "Fixture Alpha", screen_name: "fixture_alpha", id_str: "42" }
      }
    ]),
    {
      name: "data/js/user_details.js",
      content: `var user_details = ${JSON.stringify({
        screen_name: "fixture_alpha",
        full_name: "Fixture Alpha",
        id: "42",
        created_at: "2009-03-01 00:00:00 +0000"
      })};`
    },
    {
      // A table of contents for the monthly files. It carries no posts, so it must be skipped
      // rather than parsed as a collection and reported as malformed.
      name: "data/js/tweet_index.js",
      content: `var tweet_index = ${JSON.stringify([
        { file_name: "data/js/tweets/2011_08.js", year: 2011, month: 8, tweet_count: 1 }
      ])};`
    }
  ]);
}

test("each archive vintage is recognised by name and imports its posts", async () => {
  const { importOfficialArchive } = await importSourceModule("src/features/library/archive-import.ts");

  const current = await importOfficialArchive(currentArchive(), "archive");
  assert.equal(current.vintage, "current");
  assert.deepEqual(current.errors, []);
  assert.equal(current.records.length, 2, "both current-layout posts must import");
  assert.equal(current.collections.directMessages.length, 1);
  assert.deepEqual(current.collectionsAbsent, [], "the current layout can carry everything");

  const older = await importOfficialArchive(tweetJsArchive(), "archive");
  assert.equal(older.vintage, "tweet-js");
  assert.deepEqual(older.errors, []);
  assert.equal(older.records.length, 1);
  assert.deepEqual(
    older.collectionsAbsent,
    ["direct-messages"],
    "a tweet.js archive has nowhere to put a direct message, and saying so is the point"
  );

  const grailbird = await importOfficialArchive(grailbirdArchive(), "archive");
  assert.equal(grailbird.vintage, "grailbird");
  assert.deepEqual(grailbird.errors, []);
  assert.equal(grailbird.records.length, 2, "one post from each monthly file");
  assert.deepEqual(
    grailbird.records.map((record) => record.text).sort(),
    [
      "A post from the Grailbird archive layout.",
      "A second Grailbird post, in the next month's file."
    ],
    "the Grailbird assignment prefix has to be stripped before the JSON is read"
  );
  assert.ok(
    grailbird.collectionsAbsent.includes("direct-messages") &&
      grailbird.collectionsAbsent.includes("likes"),
    "a Grailbird archive has no place for likes or direct messages"
  );
  // The index file is skipped, not read as a collection and not reported as malformed.
  assert.deepEqual(grailbird.malformedFiles, []);
  assert.ok(
    grailbird.skippedFiles.some((name) => name.endsWith("tweet_index.js")),
    "the table of contents is skipped rather than parsed"
  );
  // `var user_details = {…};` has to lose both its assignment and its trailing semicolon before
  // the JSON is readable, so this is what proves the older prefix form is handled.
  assert.equal(grailbird.collections.profile?.handle, "fixture_alpha");
  assert.equal(grailbird.collections.profile?.displayName, "Fixture Alpha");
});

test("every imported record says which vintage it came from", async () => {
  const { importOfficialArchive } = await importSourceModule("src/features/library/archive-import.ts");

  for (const [vintage, archive] of [
    ["current", currentArchive()],
    ["tweet-js", tweetJsArchive()],
    ["grailbird", grailbirdArchive()]
  ]) {
    const result = await importOfficialArchive(archive, "archive");
    assert.ok(result.records.length > 0, `${vintage} produced no records`);
    for (const record of result.records) {
      assert.equal(record.archiveVintage, vintage, "a record with no vintage cannot be superseded later");
    }
  }
});

test("a newer export supersedes an older one for the same post id", async () => {
  const { dedupeByCanonicalId, archiveVintageRank } = await importSourceModule(
    "src/features/library/archive-import.ts"
  );

  assert.ok(archiveVintageRank("current") > archiveVintageRank("tweet-js"));
  assert.ok(archiveVintageRank("tweet-js") > archiveVintageRank("grailbird"));

  const old = { tweetId: "100000000000000001", text: "old text", archiveVintage: "grailbird" };
  const fresh = { tweetId: "100000000000000001", text: "new text", archiveVintage: "current" };

  // Both orderings: whichever arrives second must not decide the outcome.
  for (const pair of [[old, fresh], [fresh, old]]) {
    const merged = dedupeByCanonicalId(pair);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "new text", "the newer vintage wins regardless of arrival order");
  }

  // A record with no id cannot be matched to anything, so it is kept rather than collapsed.
  const anonymous = [
    { tweetId: null, text: "one" },
    { tweetId: null, text: "two" }
  ];
  assert.equal(dedupeByCanonicalId(anonymous).length, 2);
});

test("an unrecognised layout is refused whole, and says what it did find", async () => {
  const { importOfficialArchive } = await importSourceModule("src/features/library/archive-import.ts");

  // A SQLite companion database is not the portable archive, and half-importing whatever JSON
  // happens to be beside it would build a library nobody can account for.
  const foreign = buildZip([
    { name: "scrollmark.sqlite3", content: "SQLite format 3 not really" },
    { name: "notes/readme.txt", content: "this is not an X archive" },
    { name: "data/likes.js", content: "window.YTD.like.part0 = []" }
  ]);

  const result = await importOfficialArchive(foreign, "archive");
  assert.equal(result.vintage, null);
  assert.equal(result.records.length, 0, "nothing may be imported from a layout nobody recognised");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /does not look like an X archive/);
  assert.match(result.errors[0], /scrollmark\.sqlite3/, "the refusal has to name what it did find");
  assert.match(result.errors[0], /data\/js\/tweets\/YYYY_MM\.js/, "and what it was looking for");

  // Control: the same likes file inside a recognised layout does import.
  const recognised = await importOfficialArchive(
    buildZip([
      { name: "data/tweet.js", content: "window.YTD.tweet.part0 = []" },
      {
        name: "data/likes.js",
        content: `window.YTD.like.part0 = ${JSON.stringify([
          { like: { tweetId: "1150000000000000009", fullText: "a liked post" } }
        ])}`
      }
    ]),
    "archive"
  );
  assert.equal(recognised.vintage, "tweet-js");
  assert.equal(recognised.records.length, 1, "control: a recognised layout imports its likes");
});

test("one malformed monthly file does not take the rest of the archive with it", async () => {
  const { importOfficialArchive } = await importSourceModule("src/features/library/archive-import.ts");

  const archive = buildZip([
    {
      name: "data/js/tweets/2011_08.js",
      content: `Grailbird.data.tweets_2011_08 = ${JSON.stringify([
        {
          id_str: "100000000000000001",
          text: "A good post.",
          created_at: "2011-08-01 10:00:00 +0000",
          user: { screen_name: "fixture_alpha" }
        }
      ])}`
    },
    { name: "data/js/tweets/2011_09.js", content: "Grailbird.data.tweets_2011_09 = [ {broken" }
  ]);

  const result = await importOfficialArchive(archive, "archive");
  assert.equal(result.vintage, "grailbird");
  assert.equal(result.records.length, 1, "the readable month still imports");
  assert.deepEqual(
    result.malformedFiles,
    ["data/js/tweets/2011_09.js"],
    "and the unreadable one is named rather than swallowed"
  );
  assert.ok(result.warnings.some((entry) => entry.includes("2011_09")));
});
