import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

/** An in-memory stand-in for the storage gateway, so nothing here touches a real backend. */
function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    async get(key, fallback) {
      return data.has(key) ? data.get(key) : fallback;
    },
    async set(key, value) {
      // Serialised on the way in, like a real backend, so a test cannot pass by sharing a
      // reference with the object still held in the queue.
      data.set(key, JSON.parse(JSON.stringify(value)));
    },
    raw: data
  };
}

const candidate = (bucket, extra = {}) => ({ bucket, protected: false, ...extra });

test("the destructive gate fails closed instead of merely reporting false", async () => {
  const { CleanupQueue, DestructiveActionBlockedError } = await importSourceModule(
    "src/features/library/cleanup-queue.ts"
  );
  const queue = new CleanupQueue(memoryStorage());

  assert.equal(queue.destructiveAllowed(), false);
  // The point of the change: consulting the flag is no longer optional for a caller that wants
  // to do something destructive -- the gate throws rather than returning a boolean to ignore.
  assert.throws(
    () => queue.assertDestructiveAllowed("delete 12 posts"),
    (error) =>
      error instanceof DestructiveActionBlockedError && /delete 12 posts/.test(error.message)
  );
});

/**
 * Fills the queue past its limit with the clock frozen.
 *
 * The freeze is the whole point. The old id was `item-${Date.now()}-${items.length}-${added}`,
 * and once the queue is trimming, every call starts from the same length -- so ids only collide
 * when two calls land in the same millisecond. Left on the real clock this test passed with the
 * bug still in place, which is worse than no test. Pinning `Date.now` makes the collision certain
 * rather than lucky.
 */
async function fillPastLimit(queue, calls = 12, perCall = 5) {
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    for (let i = 0; i < calls; i++) {
      await queue.enqueue(Array.from({ length: perCall }, () => candidate("media")));
    }
  } finally {
    Date.now = realNow;
  }
}

test("queue ids stay unique once the queue is trimming at its limit", async () => {
  const { CleanupQueue } = await importSourceModule("src/features/library/cleanup-queue.ts");
  const queue = new CleanupQueue(memoryStorage(), 50);

  await fillPastLimit(queue);

  const ids = queue.list().map((item) => item.id);
  assert.equal(ids.length, 50, "the queue must have trimmed to its limit");
  assert.equal(new Set(ids).size, ids.length, "a duplicate id makes setStatus review the wrong item");
});

test("setStatus reaches the intended item after trimming", async () => {
  const { CleanupQueue } = await importSourceModule("src/features/library/cleanup-queue.ts");
  const queue = new CleanupQueue(memoryStorage(), 50);
  await fillPastLimit(queue);

  const target = queue.list()[7];
  await queue.setStatus(target.id, "approved", "looks right");

  const approved = queue.list("approved");
  assert.equal(approved.length, 1, "exactly one item may be approved");
  assert.equal(approved[0].id, target.id);
  assert.equal(approved[0].reviewerNote, "looks right");
});

test("a stored item with an unknown status is rejected, not carried forever", async () => {
  const { CleanupQueue, CLEANUP_QUEUE_KEY } = await importSourceModule(
    "src/features/library/cleanup-queue.ts"
  );
  const storage = memoryStorage({
    [CLEANUP_QUEUE_KEY]: {
      items: [
        { id: "a", enqueuedAt: "2026-01-01T00:00:00.000Z", status: "queued", bucket: "media" },
        { id: "b", enqueuedAt: "2026-01-01T00:00:00.000Z", status: "deleted", bucket: "media" }
      ],
      destructiveExecuted: false
    }
  });

  const queue = new CleanupQueue(storage);
  await queue.load();

  // "deleted" matches no filter, so it would never surface in the UI while still counting
  // against the limit and round-tripping back to storage on every write.
  assert.deepEqual(queue.list().map((item) => item.id), ["a"]);
});

test("clear preserves the stored destructive flag instead of resetting it", async () => {
  const { CleanupQueue, CLEANUP_QUEUE_KEY } = await importSourceModule(
    "src/features/library/cleanup-queue.ts"
  );
  const storage = memoryStorage({
    [CLEANUP_QUEUE_KEY]: {
      items: [{ id: "a", enqueuedAt: "2026-01-01T00:00:00.000Z", status: "queued", bucket: "media" }],
      destructiveExecuted: true
    }
  });

  const queue = new CleanupQueue(storage);
  // Cleared without loading first -- the order that used to write `destructiveExecuted: false`
  // over a stored `true`, erasing the record that a destructive action had once run.
  await queue.clear();

  assert.equal(queue.size(), 0);
  assert.equal(
    storage.raw.get(CLEANUP_QUEUE_KEY).destructiveExecuted,
    true,
    "clearing the review queue must not erase the destructive-execution record"
  );
});

test("two queues do not share one items array", async () => {
  const { CleanupQueue } = await importSourceModule("src/features/library/cleanup-queue.ts");

  const first = new CleanupQueue(memoryStorage());
  const second = new CleanupQueue(memoryStorage());
  await first.enqueue([candidate("media")]);

  assert.equal(first.size(), 1);
  assert.equal(second.size(), 0, "a module-level default state would leak between instances");
});

test("protected candidates are never enqueued", async () => {
  const { CleanupQueue } = await importSourceModule("src/features/library/cleanup-queue.ts");
  const queue = new CleanupQueue(memoryStorage());

  const added = await queue.enqueue([
    candidate("media"),
    { bucket: "media", protected: true },
    candidate("links")
  ]);

  assert.equal(added, 2);
  assert.equal(queue.size(), 2);
});


test("removing one bookmark cannot take a second with it", async () => {
  const { BookmarkStore } = await importSourceModule("src/features/library/bookmarks.ts");
  const store = new BookmarkStore(memoryStorage(), 64);

  // Clock frozen and the store trimming at its limit: the shape in which the old
  // `bm-${Date.now()}-${entries.length}` id repeated. `remove()` filters by id, so a duplicate
  // deleted the other bookmark too -- silent loss of saved data.
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    for (let i = 0; i < 80; i++) {
      await store.upsert({ text: `note ${i}` });
    }
  } finally {
    Date.now = realNow;
  }

  const ids = store.list().map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "bookmark ids must be unique");

  const before = store.size();
  await store.remove(store.list()[10].id);
  assert.equal(store.size(), before - 1, "exactly one bookmark may be removed");
});

test("two bookmark stores do not share one entries array", async () => {
  const { BookmarkStore } = await importSourceModule("src/features/library/bookmarks.ts");
  const first = new BookmarkStore(memoryStorage());
  const second = new BookmarkStore(memoryStorage());
  await first.upsert({ text: "only mine" });

  assert.equal(first.size(), 1);
  assert.equal(second.size(), 0);
});
