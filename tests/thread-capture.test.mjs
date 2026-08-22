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
