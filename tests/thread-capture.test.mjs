import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";


test("thread capture parses root, parent, author, and creation metadata without fetching", async () => {
  const { parseCapturedThreadRecords } = await importSourceModule("src/features/export/thread-capture.ts");
  const body = JSON.stringify({
    data: {
      home: {
        instructions: [{ entries: [
          { content: { itemContent: { tweet_results: { result: tweet("101", "root", "alice", null, "Alice") } } } },
          { content: { itemContent: { tweet_results: { result: tweet("102", "reply", "bob", "101", "Bob") } } } }
        ] }] 
      }
    }
  });
  const records = parseCapturedThreadRecords(body, "HomeTimeline", "2026-08-22T12:05:00Z");
  assert.deepEqual(records.map((entry) => entry.tweetId), ["101", "102"]);
  assert.equal(records[1].conversationId, "101");
  assert.equal(records[1].rootId, "101");
  assert.equal(records[1].parentId, "101");
  assert.equal(records[1].authorId, "u2");
  assert.equal(records[1].handle, "bob");
  assert.equal(records[1].createdAt, "2026-08-22T12:02:00.000Z");
  assert.equal(records[1].capturedAt, "2026-08-22T12:05:00.000Z");
});

test("thread capture reads the July 2026 user shape and never mistakes a user for a post", async () => {
  const { parseCapturedThreadRecords } = await importSourceModule("src/features/export/thread-capture.ts");
  // X dropped the user's legacy object: name and handle live in `core`, protected in `privacy`.
  // Shape as documented by twitter-web-exporter's src/types/user.ts after its 2026-07-28 change.
  const user = (restId, handle, name, isProtected) => ({
    __typename: "User",
    rest_id: restId,
    core: { created_at: "Mon Jan 01 00:00:00 +0000 2024", name, screen_name: handle },
    privacy: { protected: isProtected },
    avatar: { image_url: "https://pbs.twimg.com/profile_images/1/a.jpg" },
    verification: { verified: false }
  });
  const post = (id, text, author) => ({
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: author } },
    legacy: {
      id_str: id,
      full_text: text,
      conversation_id_str: id,
      lang: "en",
      created_at: "Wed Aug 22 12:00:00 +0000 2026"
    }
  });
  const body = JSON.stringify({
    data: { home: { instructions: [{ entries: [
      { content: { itemContent: { tweet_results: { result: post("201", "open post", user("9009", "carol", "Carol", false)) } } } },
      { content: { itemContent: { tweet_results: { result: post("202", "locked post", user("9008", "dave", "Dave", true)) } } } },
      // A user module in the same timeline, as Who to follow and profile responses carry.
      { content: { itemContent: { user_results: { result: user("9007", "erin", "Erin", false) } } } }
    ] }] } }
  });

  const records = parseCapturedThreadRecords(body, "HomeTimeline", "2026-08-22T12:05:00Z");
  assert.deepEqual(records.map((entry) => entry.tweetId), ["201", "202"]);
  assert.equal(records[0].handle, "carol");
  assert.equal(records[0].displayName, "Carol");
  assert.equal(records[0].permalink, "https://x.com/carol/status/201");
  assert.equal(records[0].audience, "public");
  assert.equal(records[0].authorId, "9009");
  assert.equal(records[1].audience, "protected");
});

function tweet(id, text, handle, parentId, name) {
  return {
    rest_id: id,
    core: { user_results: { result: { rest_id: handle === "alice" ? "u1" : "u2", legacy: { screen_name: handle, name } } } },
    legacy: {
      id_str: id,
      full_text: text,
      conversation_id_str: "101",
      ...(parentId ? { in_reply_to_status_id_str: parentId } : {}),
      created_at: handle === "alice" ? "Wed Aug 22 12:00:00 +0000 2026" : "Wed Aug 22 12:02:00 +0000 2026"
    }
  };
}
