import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * What happens when the same profile is open in two X tabs.
 *
 * Every whole-state store loads once into memory and used to persist that snapshot wholesale. In
 * one tab that is correct and cheap. In two it is silently lossy: tab A and tab B each write the
 * list they happened to load, so whichever writes second erases the other's work. The failure is
 * invisible -- nothing errors, the entry is simply not there afterwards -- which is why it needs a
 * test that drives two writers rather than one that reads the code.
 *
 * The ledger is the sharper case: "read the counter, add to it, write it back" across two tabs is
 * a time-of-check-to-time-of-use race, and the counter it guards is the only promise Aviary makes
 * about what a provider is allowed to cost.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).split(path.sep).join("/");

/**
 * One backing store, two gateways over it.
 *
 * This is the shape that matters: two tabs share a browser profile's storage but hold their own
 * in-memory copies. `settleMs` puts a real await between the read and the write inside each
 * store's persist, which is the window a second writer used to slip through.
 */
const HARNESS = `
const shared = new Map();
let settleMs = 0;
export function setSettleDelay(ms) { settleMs = ms; }
export function resetShared() { shared.clear(); settleMs = 0; }
export function readShared(key) { return shared.get(key); }
export function tab() {
  return {
    async get(key, fallback) {
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      return shared.has(key) ? structuredClone(shared.get(key)) : fallback;
    },
    async set(key, value) {
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      shared.set(key, structuredClone(value));
    },
    async remove(key) { shared.delete(key); }
  };
}
`;

let bundle;
let cleanup;

/** A fresh shared store per test: these all write the same keys. */
async function load() {
  if (bundle) {
    bundle.resetShared();
    return bundle;
  }
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-cross-tab-"));
  const entry = path.join(temp, "entry.ts");
  const harness = path.join(temp, "harness.ts");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(harness, HARNESS, "utf8");
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(harness.split(path.sep).join("/"))};`,
      `export { HiddenPostStore, HIDDEN_POSTS_KEY } from ${JSON.stringify(abs("src/features/filtering/hidden-posts.ts"))};`,
      `export { SeenPostStore, SEEN_POSTS_KEY } from ${JSON.stringify(abs("src/features/filtering/seen-posts.ts"))};`,
      `export { MediaHistory, MEDIA_HISTORY_KEY } from ${JSON.stringify(abs("src/features/media/history.ts"))};`,
      `export { AuditLog, AUDIT_LOG_KEY } from ${JSON.stringify(abs("src/features/core/audit-log.ts"))};`,
      `export { BookmarkStore, BOOKMARKS_KEY } from ${JSON.stringify(abs("src/features/library/bookmarks.ts"))};`,
      `export { IntegrationUsageLedger, INTEGRATION_USAGE_KEY } from ${JSON.stringify(abs("src/features/integrations/usage.ts"))};`,
      `export { SnapshotStore, SNAPSHOTS_KEY } from ${JSON.stringify(abs("src/features/library/snapshots.ts"))};`,
      `export { CleanupQueue, CLEANUP_QUEUE_KEY } from ${JSON.stringify(abs("src/features/library/cleanup-queue.ts"))};`,
      `export { ArchiveLibraryStore, ARCHIVE_LIBRARY_KEY, ARCHIVE_COLLECTION_LIMIT } from ${JSON.stringify(abs("src/features/library/archive-library.ts"))};`,
      `export { DownloadQueue, MEDIA_QUEUE_KEY } from ${JSON.stringify(abs("src/features/media/queue.ts"))};`,
      `export { CheckpointStore, CHECKPOINT_KEY } from ${JSON.stringify(abs("src/features/export/jobs.ts"))};`,
      `export { DiagnosticsStore, DIAGNOSTICS_KEY } from ${JSON.stringify(abs("src/platform/diagnostics-store.ts"))};`,
      `export { ProfileManager, PROFILE_REGISTRY_KEY, DEFAULT_PROFILE_ID } from ${JSON.stringify(abs("src/platform/profile.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings, diffKnownSettings, applyKnownSettingsPatch } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
      `export { withStorageLock, withExclusiveStorageGate, mutateStored } from ${JSON.stringify(abs("src/platform/storage-lock.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const outfile = path.join(temp, "bundle.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  // A module namespace is frozen, so the cleanup handle lives beside it rather than on it.
  bundle = await import(pathToFileURL(outfile).href);
  cleanup = () => rm(temp, { recursive: true, force: true });
  return bundle;
}

test("a hide in one tab and a hide in the other both survive", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.HiddenPostStore(mod.tab());
  const b = new mod.HiddenPostStore(mod.tab());
  await a.load(500);
  await b.load(500);

  // Both tabs loaded the same empty store, then hide different posts at the same moment.
  await Promise.all([
    a.hide({ tweetId: "1900000000000001", handle: "alice", text: "one" }, 500),
    b.hide({ tweetId: "1900000000000002", handle: "bob", text: "two" }, 500)
  ]);

  const stored = mod.readShared(mod.HIDDEN_POSTS_KEY);
  const keys = stored.entries.map((entry) => entry.key).sort();
  assert.deepEqual(keys, ["id:1900000000000001", "id:1900000000000002"]);

  // Whichever tab wrote second adopted the merged result, so its next save carries both. The one
  // that wrote first cannot have seen an entry that did not exist yet -- there is no change
  // listener, and inventing one would be a different feature. What matters is that its next write
  // merges rather than overwrites, which is what this proves.
  assert.equal(Math.max(a.size(), b.size()), 2, "the later writer did not adopt the merged result");
  await a.hide({ tweetId: "1900000000000003", handle: "carol", text: "three" }, 500);
  assert.deepEqual(
    mod.readShared(mod.HIDDEN_POSTS_KEY).entries.map((entry) => entry.key).sort(),
    ["id:1900000000000001", "id:1900000000000002", "id:1900000000000003"]
  );
  assert.equal(a.size(), 3, "the first writer never caught up with the other tab");
});

test("an unhide is not undone by the other tab's stale copy of the entry", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.HiddenPostStore(mod.tab());
  const b = new mod.HiddenPostStore(mod.tab());
  await a.load(500);
  await b.load(500);

  await a.hide({ tweetId: "1900000000000010", handle: "alice", text: "shared" }, 500);
  await b.load(500);
  assert.equal(b.has("id:1900000000000010"), true, "tab B never saw the entry it must not resurrect");

  // A unhides it; B then saves for its own reasons while still holding the entry in memory.
  await a.unhide("id:1900000000000010");
  await b.hide({ tweetId: "1900000000000011", handle: "bob", text: "other" }, 500);

  const stored = mod.readShared(mod.HIDDEN_POSTS_KEY);
  const keys = stored.entries.map((entry) => entry.key);
  assert.ok(!keys.includes("id:1900000000000010"), "the unhidden post came back");
  assert.ok(keys.includes("id:1900000000000011"));
});

test("clearing hidden posts clears them, including the other tab's", async () => {
  const mod = await load();
  mod.setSettleDelay(0);
  const a = new mod.HiddenPostStore(mod.tab());
  const b = new mod.HiddenPostStore(mod.tab());
  await a.load(500);
  await b.load(500);
  await b.hide({ tweetId: "1900000000000020", handle: "bob", text: "b" }, 500);
  await a.load(500);

  await a.clear();

  // "Clear" is the one operation that must not merge -- it means what it says.
  assert.deepEqual(mod.readShared(mod.HIDDEN_POSTS_KEY).entries, []);
});

test("two timelines scrolling at once keep both sets of seen posts", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const now = Date.now();
  const a = new mod.SeenPostStore(mod.tab());
  const b = new mod.SeenPostStore(mod.tab());
  await a.load();
  await b.load();

  a.mark("1900000000000101", now);
  b.mark("1900000000000102", now);
  a.flush(now);
  b.flush(now);
  await Promise.all([a.settled(), b.settled()]);

  const stored = mod.readShared(mod.SEEN_POSTS_KEY);
  assert.deepEqual(Object.keys(stored.seen).sort(), ["1900000000000101", "1900000000000102"]);

  // The next flush from either tab starts from the union, so nothing is dropped on the way back.
  a.mark("1900000000000103", now);
  a.flush(now);
  await a.settled();
  assert.deepEqual(Object.keys(mod.readShared(mod.SEEN_POSTS_KEY).seen).sort(), [
    "1900000000000101",
    "1900000000000102",
    "1900000000000103"
  ]);
  assert.equal(a.has("1900000000000102"), true, "the other tab's sighting was not adopted");
});

test("two tabs saving media keep both dedup keys", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.MediaHistory(mod.tab());
  const b = new mod.MediaHistory(mod.tab());
  await a.load();
  await b.load();

  await Promise.all([a.record("alice:photo1"), b.record("bob:photo2")]);

  const stored = mod.readShared(mod.MEDIA_HISTORY_KEY);
  assert.equal(stored.schemaVersion, 3);
  assert.equal(stored.entries.length, 2);
  assert.ok(stored.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.identityHash)));
  assert.ok(stored.entries.every((entry) => !Object.hasOwn(entry, "key")));

  // The point of the index is recognising a file the other tab already saved. That happens on the
  // next write, which is when this tab next reads what is actually stored.
  await a.record("alice:photo3");
  assert.equal(a.has("bob:photo2"), true, "the other tab's dedup key was never adopted");
  assert.equal(mod.readShared(mod.MEDIA_HISTORY_KEY).entries.length, 3);
});

test("two tabs cannot reserve the same media fingerprint", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.MediaHistory(mod.tab());
  const b = new mod.MediaHistory(mod.tab());
  await a.load();
  await b.load();
  const fingerprint = {
    identityHash: "1".repeat(64),
    exactHash: "2".repeat(64)
  };

  const reservations = await Promise.all([
    a.reserve(fingerprint, false),
    b.reserve(fingerprint, false)
  ]);
  assert.equal(reservations.filter((entry) => entry.token).length, 1);
  assert.equal(reservations.filter((entry) => entry.match === "exact").length, 1);

  const owner = reservations.findIndex((entry) => entry.token);
  await (owner === 0 ? a : b).commit(reservations[owner].token, fingerprint);
  assert.equal(mod.readShared(mod.MEDIA_HISTORY_KEY).entries.length, 1);
});

test("an expired media reservation cannot block a retry", async () => {
  const mod = await load();
  const storage = mod.tab();
  const fingerprint = { identityHash: "5".repeat(64), exactHash: "6".repeat(64) };
  await storage.set(mod.MEDIA_HISTORY_KEY, {
    schemaVersion: 3,
    entries: [],
    reservations: [{
      ...fingerprint,
      token: "7".repeat(64),
      at: new Date(0).toISOString(),
      expiresAt: Date.now() - 1
    }],
    matches: { identity: 0, exact: 0, perceptual: 0 },
    lastMatch: null
  });

  const history = new mod.MediaHistory(storage);
  await history.load();
  const reservation = await history.reserve(fingerprint, false);

  assert.equal(reservation.match, null);
  assert.match(reservation.token, /^[0-9a-f]{64}$/);
  assert.equal(mod.readShared(mod.MEDIA_HISTORY_KEY).reservations.length, 1);
  assert.ok(mod.readShared(mod.MEDIA_HISTORY_KEY).reservations[0].expiresAt > Date.now());
});

test("two tabs recording the same fingerprint report one new entry", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.MediaHistory(mod.tab());
  const b = new mod.MediaHistory(mod.tab());
  await a.load();
  await b.load();
  const fingerprint = {
    identityHash: "3".repeat(64),
    exactHash: "4".repeat(64)
  };

  const results = await Promise.all([a.record(fingerprint), b.record(fingerprint)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(mod.readShared(mod.MEDIA_HISTORY_KEY).entries.length, 1);
});

test("the audit log records what both tabs did, without duplicating either", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.AuditLog(mod.tab(), 500, undefined, () => true);
  const b = new mod.AuditLog(mod.tab(), 500, undefined, () => true);
  await a.load();
  await b.load();

  await Promise.all([
    a.record("media.download", { filename: "a.jpg" }),
    b.record("media.download", { filename: "b.jpg" })
  ]);
  // A second write from the same tab must not re-add what is already there.
  await a.record("media.download", { filename: "c.jpg" });

  const stored = mod.readShared(mod.AUDIT_LOG_KEY);
  const files = stored.entries.map((entry) => entry.detail?.filename).sort();
  assert.deepEqual(files, ["a.jpg", "b.jpg", "c.jpg"]);
});

test("a bookmark saved in each tab survives, and a deletion is not resurrected", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.BookmarkStore(mod.tab());
  const b = new mod.BookmarkStore(mod.tab());
  await a.load();
  await b.load();

  const [first, second] = await Promise.all([
    a.upsert({ tweetId: "1900000000000201", handle: "alice", text: "one", url: "https://x.com/alice/status/1900000000000201" }),
    b.upsert({ tweetId: "1900000000000202", handle: "bob", text: "two", url: "https://x.com/bob/status/1900000000000202" })
  ]);
  // Two tabs saving in the same millisecond must not produce the same id, or the merge -- which
  // keys on id -- silently keeps one of the two bookmarks.
  assert.notEqual(first.id, second.id, "two tabs generated the same bookmark id");
  assert.equal(mod.readShared(mod.BOOKMARKS_KEY).entries.length, 2);

  // B still holds its stale copy of both; A deletes one and B then saves again.
  await b.load();
  await a.remove(first.id);
  await b.upsert({ tweetId: "1900000000000203", handle: "carol", text: "three", url: "https://x.com/carol/status/1900000000000203" });

  const ids = mod.readShared(mod.BOOKMARKS_KEY).entries.map((entry) => entry.id);
  assert.ok(!ids.includes(first.id), "the deleted bookmark came back from the other tab");
  assert.ok(ids.includes(second.id), "the other tab's bookmark was lost");
  assert.equal(ids.length, 2);
});

test("a clear in one tab is not undone by the other tab's next write", async () => {
  const mod = await load();
  mod.setSettleDelay(0);

  // Each of these merges on write, and each has a "forget all of this" action. Merging the whole
  // in-memory list rather than the change just made would put back everything the other tab was
  // told to forget -- which is the same defect as losing a write, pointed the other way.
  const historyA = new mod.MediaHistory(mod.tab());
  const historyB = new mod.MediaHistory(mod.tab());
  await historyA.load();
  await historyB.load();
  await historyA.record("alice:old1");
  await historyA.record("alice:old2");
  await historyB.load();
  await historyB.clear();
  await historyA.record("alice:new");
  assert.equal(mod.readShared(mod.MEDIA_HISTORY_KEY).entries.length, 1);
  const historyC = new mod.MediaHistory(mod.tab());
  await historyC.load();
  assert.equal(historyC.has("alice:new"), true);
  assert.equal(historyC.has("alice:old1"), false, "cleared download history came back");

  const logA = new mod.AuditLog(mod.tab(), 500, undefined, () => true);
  const logB = new mod.AuditLog(mod.tab(), 500, undefined, () => true);
  await logA.load();
  await logB.load();
  await logA.record("media.download", { filename: "old.jpg" });
  await logB.load();
  await logB.clear();
  await logA.record("media.download", { filename: "new.jpg" });
  assert.deepEqual(
    mod.readShared(mod.AUDIT_LOG_KEY).entries.map((entry) => entry.detail?.filename),
    ["new.jpg"],
    "a cleared audit log came back"
  );

  const seenA = new mod.SeenPostStore(mod.tab());
  const seenB = new mod.SeenPostStore(mod.tab());
  await seenA.load();
  await seenB.load();
  const now = Date.now();
  seenA.mark("1900000000000301", now);
  seenA.flush(now);
  await seenA.settled();
  await seenB.clear();
  seenA.mark("1900000000000302", now);
  seenA.flush(now);
  await seenA.settled();
  assert.deepEqual(
    Object.keys(mod.readShared(mod.SEEN_POSTS_KEY).seen),
    ["1900000000000302"],
    "cleared seen posts came back"
  );
});

test("a daily provider budget cannot be spent once per open tab", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.IntegrationUsageLedger(mod.tab());
  const b = new mod.IntegrationUsageLedger(mod.tab());
  await a.load();
  await b.load();

  // Both tabs see an empty ledger and ask for 8 bytes against a 10-byte daily budget at the same
  // moment. Exactly one of them may be allowed.
  const budget = { maxRequestBytes: 10, dailyBytes: 10 };
  const decisions = await Promise.all([a.reserveAi(8, budget), b.reserveAi(8, budget)]);

  const allowed = decisions.filter((decision) => decision.allowed);
  assert.equal(allowed.length, 1, `${allowed.length} of two writers were allowed to spend the same budget`);
  const stored = mod.readShared(mod.INTEGRATION_USAGE_KEY);
  const today = stored.days.at(-1);
  assert.equal(today.ai.bytes, 8, "the ledger recorded a total no single request could produce");
  assert.equal(today.ai.requests, 1);
});

test("the lock serializes, and releases when the work inside it throws", async () => {
  const mod = await load();
  const order = [];
  const slow = mod.withStorageLock("test.key", async () => {
    order.push("first-in");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("first-out");
    throw new Error("write failed");
  });
  const next = mod.withStorageLock("test.key", async () => {
    order.push("second-in");
    return "ok";
  });

  await assert.rejects(slow, /write failed/);
  assert.equal(await next, "ok");
  // A failure ahead in the queue releases the lock rather than blocking every later writer.
  assert.deepEqual(order, ["first-in", "first-out", "second-in"]);
});

test("browser locks receive shared writer gates and an exclusive restore gate", async () => {
  const mod = await load();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const calls = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        async request(name, options, callback) {
          if (typeof options === "function") {
            calls.push({ name, mode: "exclusive" });
            return options();
          }
          calls.push({ name, mode: options.mode });
          return callback();
        }
      }
    }
  });
  try {
    await mod.withStorageLock("bookmarks", async () => undefined);
    await mod.withExclusiveStorageGate(async () => undefined);
    await mod.withExclusiveStorageGate(() =>
      mod.withStorageLock("durable.pending", async () => undefined, { restoreGate: false })
    );
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  }
  assert.deepEqual(calls, [
    { name: "aviary.library.restore", mode: "shared" },
    { name: "aviary.bookmarks", mode: "exclusive" },
    { name: "aviary.library.restore", mode: "exclusive" },
    { name: "aviary.library.restore", mode: "exclusive" },
    { name: "aviary.durable.pending", mode: "exclusive" }
  ]);
});

test("mutateStored reads inside the lock, so the second writer sees the first's write", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const one = mod.tab();
  const two = mod.tab();
  const bump = (storage) =>
    mod.mutateStored(storage, "counter", { n: 0 }, (stored) => ({ n: stored.n + 1 }));

  await Promise.all([bump(one), bump(two), bump(one)]);

  assert.deepEqual(mod.readShared("counter"), { n: 3 });
});

test.after(async () => {
  await cleanup?.();
});

test("a capture in each tab survives, and clearing still clears", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.SnapshotStore(mod.tab());
  const b = new mod.SnapshotStore(mod.tab());
  await a.load();
  await b.load();

  await Promise.all([
    a.record({ kind: "followers", handle: "self", source: "dom", accounts: ["alpha", "beta"] }),
    b.record({ kind: "following", handle: "self", source: "dom", accounts: ["gamma"] })
  ]);

  const kinds = mod.readShared(mod.SNAPSHOTS_KEY).entries.map((entry) => entry.kind).sort();
  assert.deepEqual(kinds, ["followers", "following"], "one tab's capture erased the other's");

  // And a clear is a clear: the other tab's stale copy must not put the captures back.
  await a.clear();
  await b.record({ kind: "followers", handle: "self", source: "dom", accounts: ["delta"] });
  const after = mod.readShared(mod.SNAPSHOTS_KEY).entries;
  assert.equal(after.length, 1, "clearing was undone by the other tab's next write");
  assert.deepEqual(after[0].accounts, ["delta"]);
});

test("a cleanup queue review in one tab is not erased by an enqueue in the other", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.CleanupQueue(mod.tab());
  const b = new mod.CleanupQueue(mod.tab());
  await a.load();
  await b.load();

  const candidate = (tweetId, bucket) => ({
    tweetId,
    handle: "someone",
    text: `post ${tweetId}`,
    bucket,
    protected: false
  });

  await Promise.all([a.enqueue([candidate("1", "reply")]), b.enqueue([candidate("2", "repost")])]);

  const tweetIds = mod.readShared(mod.CLEANUP_QUEUE_KEY).items.map((item) => item.tweetId).sort();
  assert.deepEqual(tweetIds, ["1", "2"], "one tab's enqueue erased the other's");

  // A review in one tab and a fresh enqueue in the other keep both.
  const mine = a.list().find((item) => item.tweetId === "1");
  await a.setStatus(mine.id, "skipped", "not this one");
  await b.enqueue([candidate("3", "reply")]);

  const stored = mod.readShared(mod.CLEANUP_QUEUE_KEY).items;
  assert.equal(stored.length, 3);
  assert.equal(
    stored.find((item) => item.tweetId === "1").status,
    "skipped",
    "the review was overwritten by the other tab's stale copy"
  );
});

test("two archive imports in two tabs both land in the library", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.ArchiveLibraryStore(mod.tab());
  const b = new mod.ArchiveLibraryStore(mod.tab());
  await a.load();
  await b.load();

  const collections = (handle) => ({
    profile: null,
    account: null,
    directMessages: [],
    media: [],
    followers: [{ id: handle, handle, sourceFile: "follower.js" }],
    following: [],
    lists: []
  });

  await Promise.all([
    a.merge(collections("alice"), "job-a"),
    b.merge(collections("bob"), "job-b")
  ]);

  const stored = mod.readShared(mod.ARCHIVE_LIBRARY_KEY);
  assert.deepEqual(
    stored.followers.map((entry) => entry.handle).sort(),
    ["alice", "bob"],
    "one tab's import erased the other's"
  );
  assert.deepEqual(
    stored.importedJobs.slice().sort(),
    ["job-a", "job-b"],
    "and the record of which archives were already imported has to survive too"
  );

  await a.clear();
  assert.deepEqual(mod.readShared(mod.ARCHIVE_LIBRARY_KEY).followers, []);
});

/**
 * Two tabs capturing the same list in the same millisecond both survive.
 *
 * The merge keyed on kind, handle and an ISO timestamp with millisecond resolution, so two tabs
 * capturing at once collapsed to one -- and `record()` still returned the entry that had just been
 * dropped, so the panel reported a capture that no longer existed and the next diff had nothing to
 * compare against. The whole-state write this replaced kept both. The cleanup queue had already
 * been given a random suffix for exactly this collision; the snapshot key had not.
 */
test("two tabs capturing the same list in the same millisecond keep both captures", async () => {
  const mod = await load();
  mod.setSettleDelay(0);

  const a = new mod.SnapshotStore(mod.tab());
  const b = new mod.SnapshotStore(mod.tab());
  await a.load();
  await b.load();

  // Same kind, same handle, same instant, different scroll depth. Nothing but the accounts differs.
  const fixed = "2026-08-22T12:00:00.000Z";
  const realNow = Date;
  globalThis.Date = class extends realNow {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    toISOString() {
      return fixed;
    }
  };
  globalThis.Date.parse = realNow.parse;
  globalThis.Date.now = () => realNow.parse(fixed);

  let first;
  let second;
  try {
    [first, second] = await Promise.all([
      a.record({ kind: "followers", handle: "self", source: "dom", accounts: ["alpha", "beta"] }),
      b.record({ kind: "followers", handle: "self", source: "dom", accounts: ["alpha"] })
    ]);
  } finally {
    globalThis.Date = realNow;
  }

  assert.equal(first.capturedAt, second.capturedAt, "the collision this guards against must be real");

  const stored = mod.readShared(mod.SNAPSHOTS_KEY).entries;
  assert.equal(stored.length, 2, "one tab's capture was dropped by the merge");
  assert.deepEqual(
    stored.map((entry) => entry.accounts.length).sort(),
    [1, 2],
    "and both scroll depths must be the ones that survived"
  );

  // A capture identical in every respect is the same capture, and collapsing that is correct.
  const c = new mod.SnapshotStore(mod.tab());
  await c.load();
  const before = mod.readShared(mod.SNAPSHOTS_KEY).entries.length;
  await c.record({
    kind: "followers",
    handle: "self",
    source: "dom",
    accounts: stored[0].accounts
  });
  const after = mod.readShared(mod.SNAPSHOTS_KEY).entries;
  assert.ok(after.length >= before, "a genuinely new capture is still recorded");
});

/**
 * Clearing the cleanup queue is not undone by a review in the other tab.
 *
 * Merging only what a call touched stops one tab erasing another's work, but it cannot by itself
 * tell "this item is new" from "this item is one the other tab was told to forget and I still hold
 * in memory". Reviewing an item after another tab cleared put that item straight back.
 */
test("a cleared cleanup queue stays cleared when the other tab reviews an old item", async () => {
  const mod = await load();
  mod.setSettleDelay(0);

  const a = new mod.CleanupQueue(mod.tab());
  await a.load();
  await a.enqueue([
    { tweetId: "1", handle: "someone", text: "a post", bucket: "reply", protected: false }
  ]);

  // A second tab that opened after the enqueue, so it is holding the item when the clear lands.
  // `load()` is a no-op once a store has loaded, which is why this is a fresh instance.
  const b = new mod.CleanupQueue(mod.tab());
  await b.load();
  const item = b.list()[0];
  assert.ok(item, "the other tab has to be holding the item for this to mean anything");

  await a.clear();
  await b.setStatus(item.id, "skipped", "reviewed after the clear");

  const stored = mod.readShared(mod.CLEANUP_QUEUE_KEY).items;
  assert.deepEqual(stored, [], "the review resurrected an item that had been cleared");

  // And the queue is still usable afterwards: something enqueued after the clear stays.
  await b.enqueue([
    { tweetId: "2", handle: "someone", text: "a later post", bucket: "reply", protected: false }
  ]);
  assert.equal(mod.readShared(mod.CLEANUP_QUEUE_KEY).items.length, 1);
});

/**
 * Re-importing the same archive settles instead of rotating the store.
 *
 * Past the per-collection cap, an entry the cap had dropped was offered again by the same archive,
 * read as new, appended, and pushed another entry out. So every re-merge moved the retained window
 * forward by the size of the archive and the store never converged. `importedJobs` was recorded
 * and never consulted.
 */
test("merging the same archive twice changes nothing the second time", async () => {
  const mod = await load();
  mod.setSettleDelay(0);
  const { ARCHIVE_COLLECTION_LIMIT } = mod;
  assert.equal(typeof ARCHIVE_COLLECTION_LIMIT, "number");

  const store = new mod.ArchiveLibraryStore(mod.tab());
  await store.load();

  const followers = (from, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `f${from + index}`,
      handle: `handle${from + index}`,
      sourceFile: "follower.js"
    }));

  const collections = (entries) => ({
    profile: null,
    account: null,
    directMessages: [],
    media: [],
    followers: entries,
    following: [],
    lists: []
  });

  // Fill past the ceiling, so the cap is actually doing something.
  await store.merge(collections(followers(0, ARCHIVE_COLLECTION_LIMIT)), "job-fill");
  await store.merge(collections(followers(ARCHIVE_COLLECTION_LIMIT, 2_000)), "job-extra");

  const afterSecond = mod.readShared(mod.ARCHIVE_LIBRARY_KEY).followers.map((entry) => entry.id);
  assert.equal(afterSecond.length, ARCHIVE_COLLECTION_LIMIT, "the cap must still be a cap");

  // The same archive again, and again. Nothing may move.
  await store.merge(collections(followers(0, ARCHIVE_COLLECTION_LIMIT)), "job-fill");
  const afterRepeat = mod.readShared(mod.ARCHIVE_LIBRARY_KEY).followers.map((entry) => entry.id);
  assert.deepEqual(afterRepeat, afterSecond, "re-merging a recorded archive rotated the store");

  await store.merge(collections(followers(0, ARCHIVE_COLLECTION_LIMIT)), "job-fill");
  assert.deepEqual(
    mod.readShared(mod.ARCHIVE_LIBRARY_KEY).followers.map((entry) => entry.id),
    afterSecond,
    "and it must still be settled a third time"
  );

  // A genuinely new archive is still folded in.
  await store.merge(collections(followers(50_000, 10)), "job-new");
  const afterNew = mod.readShared(mod.ARCHIVE_LIBRARY_KEY).followers.map((entry) => entry.id);
  assert.ok(afterNew.includes("f50000"), "a new archive must still land");
  assert.equal(afterNew.length, ARCHIVE_COLLECTION_LIMIT);
});

/**
 * The shared lock register, driven rather than read.
 *
 * Web Locks is scoped per origin, and Aviary runs on three: x.com, twitter.com and pro.x.com all
 * share one extension or manager storage area but get three separate Web Locks namespaces, so two
 * tabs on different X hostnames were never actually serialized. The register replaces it with a
 * Lamport-style queue in that shared storage, which means the lock is now a *lease*: a tab that is
 * killed mid-transaction leaves its entry behind, and only expiry frees it. That makes the lease
 * duration load-bearing in a way a lock held by the browser never was.
 */
async function loadLockModule(store) {
  const { importSourceModule } = await import("./helpers/source-import.mjs");
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { id: "fixture-extension" },
    storage: {
      local: {
        async get(request) {
          if (request === null) return Object.fromEntries(store);
          return {};
        },
        async set(entry) {
          for (const [key, value] of Object.entries(entry)) store.set(key, structuredClone(value));
        },
        async remove(key) {
          store.delete(key);
        }
      }
    }
  };
  const mod = await importSourceModule("src/platform/storage-lock.ts", { fresh: true });
  return {
    mod,
    restore() {
      if (previousChrome) globalThis.chrome = previousChrome;
      else delete globalThis.chrome;
    }
  };
}

/**
 * The one register key a planted peer occupies.
 *
 * `runUnderBrowserLock` prefixes the caller's store key with `aviary.` before it reaches the
 * register, so a peer planted under the bare store name is invisible to the lock and the waiter
 * walks straight in. Deriving the key the same way the production path does is the difference
 * between this test proving mutual exclusion and proving nothing.
 */
function peerKey(name, owner) {
  return `aviary.lock.v1.${encodeURIComponent(`aviary.${name}`)}.${owner}`;
}

test("the lease, renew and poll intervals hold the contract the register depends on", async () => {
  const store = new Map();
  const { mod, restore } = await loadLockModule(store);
  try {
    // Pinned literals: each of these is a behavioural decision, not a tuning knob. Shortening the
    // lease makes a slow library restore lose its own lock; lengthening it makes a force-quit tab
    // wedge every other tab for that long.
    assert.equal(mod.SHARED_LOCK_LEASE_MS, 30_000, "the lease bounds how long a dead tab blocks");
    assert.equal(mod.SHARED_LOCK_RENEW_MS, 8_000, "renewal must be frequent enough to survive a miss");
    assert.equal(mod.SHARED_LOCK_POLL_MS, 12, "polling bounds handoff latency between tabs");

    assert.ok(
      mod.SHARED_LOCK_RENEW_MS * 3 <= mod.SHARED_LOCK_LEASE_MS,
      "a live holder must survive two missed renewals, or a busy tab loses a lock it still holds"
    );
    assert.ok(
      mod.SHARED_LOCK_POLL_MS < mod.SHARED_LOCK_RENEW_MS,
      "a waiter must re-read the register far more often than the holder renews"
    );
  } finally {
    restore();
  }
});

test("a live peer keeps the lock and an expired one loses it", async () => {
  const store = new Map();
  const { mod, restore } = await loadLockModule(store);
  try {
    const name = "aviary.media.history.v1";
    // A peer that is still renewing: earlier ticket, exclusive, lease well in the future.
    store.set(peerKey(name, "peer-live"), {
      version: 1,
      owner: "peer-live",
      phase: "waiting",
      ticket: 1,
      mode: "exclusive",
      expiresAt: Date.now() + mod.SHARED_LOCK_LEASE_MS
    });

    let entered = false;
    let released;
    const held = new Promise((resolve) => {
      released = resolve;
    });
    const pending = mod.withStorageLock(name, async () => {
      entered = true;
      await held;
      return "done";
    });

    try {
      // Comfortably more than the poll interval: if expiry were not required, this is where a
      // waiter would wrongly decide the lock was free.
      await new Promise((resolve) => setTimeout(resolve, mod.SHARED_LOCK_POLL_MS * 20));
      assert.equal(entered, false, "a peer whose lease is still valid must keep the lock");

      // The peer stops renewing. Its entry stays behind, exactly as a killed tab would leave it.
      store.set(peerKey(name, "peer-live"), {
        ...store.get(peerKey(name, "peer-live")),
        expiresAt: Date.now() - 1
      });
    } finally {
      // Always release, or a failed assertion above strands the pending lock and its renewal
      // timer, and the whole test file hangs instead of reporting the failure.
      released("released");
    }

    assert.equal(await pending, "done", "an expired lease must be reclaimed, not waited on forever");
    assert.equal(entered, true, "and the waiting transaction must actually run");
    assert.equal(
      store.has(peerKey(name, "peer-live")),
      false,
      "the dead peer's register entry must be swept, not left to be re-read every poll"
    );
  } finally {
    restore();
  }
});

test("the register releases its own entry even when the transaction throws", async () => {
  const store = new Map();
  const { mod, restore } = await loadLockModule(store);
  try {
    await assert.rejects(
      mod.withStorageLock("aviary.userNotes.v1", async () => {
        throw new Error("transaction failed");
      }),
      /transaction failed/
    );
    assert.deepEqual(
      [...store.keys()].filter((key) => key.startsWith("aviary.lock.v1.")),
      [],
      "a thrown transaction must not strand a contender for the whole lease"
    );
  } finally {
    restore();
  }
});

/**
 * A suspended background must not be able to lose the lock.
 *
 * The register's whole authority has to live in storage. If any part of it depended on an
 * in-memory owner id, a renewal timer, or a listener registered after an asynchronous boot, then
 * an MV3 service worker suspending between acquire and commit would drop it -- and the symptom
 * would not be an error, it would be two tabs both believing they hold an exclusive lock.
 *
 * A fresh module instance is the sharpest available version of that event: it has a new
 * `lockOwnerSequence`, an empty in-process chain map, and no timers, exactly like a worker that
 * just woke up. Only the shared store survives, which is the point.
 */
test("a lock survives losing every scrap of in-memory state", async () => {
  const store = new Map();
  const first = await loadLockModule(store);
  const name = "aviary.hiddenPosts.v1";
  try {
    // A holder that acquired the lock and then had its context torn down mid-transaction. Its
    // register entry is all that is left of it, and it is still inside its lease.
    store.set(peerKey(name, "worker-before-suspend"), {
      version: 1,
      owner: "worker-before-suspend",
      phase: "waiting",
      ticket: 4,
      mode: "exclusive",
      expiresAt: Date.now() + first.mod.SHARED_LOCK_LEASE_MS
    });
  } finally {
    first.restore();
  }

  // Everything in memory is gone. Storage is not.
  const second = await loadLockModule(store);
  try {
    let entered = false;
    const attempt = second.mod.withStorageLock(name, async () => {
      entered = true;
      return "ran";
    });
    await new Promise((resolve) => setTimeout(resolve, second.mod.SHARED_LOCK_POLL_MS * 20));
    assert.equal(
      entered,
      false,
      "a woken worker must read the lease out of storage, not assume the lock is free"
    );

    store.set(peerKey(name, "worker-before-suspend"), {
      ...store.get(peerKey(name, "worker-before-suspend")),
      expiresAt: Date.now() - 1
    });
    assert.equal(await attempt, "ran", "and must proceed once that lease actually expires");

    assert.deepEqual(
      [...store.keys()].filter((key) => key.startsWith("aviary.lock.v1.")),
      [],
      "with no entry left behind by either the dead holder or the new one"
    );
  } finally {
    second.restore();
  }
});

test("download queue merges additions and does not resurrect a cleared job", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.DownloadQueue(mod.tab());
  const b = new mod.DownloadQueue(mod.tab());
  await a.load();
  await b.load();

  const first = a.enqueue({ url: "https://cdn.test/a.mp4", filename: "a.mp4", kind: "video" });
  const second = b.enqueue({ url: "https://cdn.test/b.mp4", filename: "b.mp4", kind: "video" });
  assert.notEqual(first.id, second.id, "two tabs must not allocate the same queue id");
  await Promise.all([a.checkpoint(), b.checkpoint()]);
  assert.equal(mod.readShared(mod.MEDIA_QUEUE_KEY).jobs.length, 2);

  await a.clear();
  b.mark(first.id, "completed");
  await b.checkpoint();
  assert.deepEqual(mod.readShared(mod.MEDIA_QUEUE_KEY).jobs, [], "a stale update resurrected a cleared job");
});

test("download queue field updates keep independent target and lifecycle changes", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const seed = new mod.DownloadQueue(mod.tab());
  const job = seed.enqueue({ url: "https://cdn.test/low.mp4", filename: "video.mp4", kind: "video" });
  await seed.checkpoint();
  const a = new mod.DownloadQueue(mod.tab());
  const b = new mod.DownloadQueue(mod.tab());
  await Promise.all([a.load(), b.load()]);

  a.updateTarget(job.id, { url: "https://cdn.test/high.mp4", mediaId: "media-1" });
  b.mark(job.id, "running");
  await Promise.all([a.checkpoint(), b.checkpoint()]);
  const stored = mod.readShared(mod.MEDIA_QUEUE_KEY).jobs.find((entry) => entry.id === job.id);
  assert.equal(stored.url, "https://cdn.test/high.mp4");
  assert.equal(stored.status, "running");
  assert.equal(stored.mediaId, "media-1");
});

test("export checkpoints merge jobs and records while a stale append stays deleted", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.CheckpointStore(mod.tab());
  const b = new mod.CheckpointStore(mod.tab());
  await a.load();
  await b.load();

  await Promise.all([
    a.start("job-a", "home", ["json"], false),
    b.start("job-b", "home", ["json"], false)
  ]);
  await Promise.all([
    a.append("job-a", [{ tweetId: "a", handle: "alice", displayName: "Alice", text: "A", capturedAt: "2026-09-06T00:00:00Z", surface: "home", media: [], permalink: null }]),
    b.append("job-b", [{ tweetId: "b", handle: "bob", displayName: "Bob", text: "B", capturedAt: "2026-09-06T00:00:00Z", surface: "home", media: [], permalink: null }])
  ]);
  assert.deepEqual(Object.keys(mod.readShared(mod.CHECKPOINT_KEY).jobs).sort(), ["job-a", "job-b"]);
  assert.equal(mod.readShared(mod.CHECKPOINT_KEY).records["job-a"].length, 1);

  const stale = new mod.CheckpointStore(mod.tab());
  await stale.load();
  await a.remove("job-a");
  await stale.append("job-a", [{ tweetId: "late", handle: "late", displayName: "Late", text: "late", capturedAt: "2026-09-06T00:00:00Z", surface: "home", media: [], permalink: null }]);
  const stored = mod.readShared(mod.CHECKPOINT_KEY);
  assert.equal(stored.jobs["job-a"], undefined, "a stale append recreated a removed job");
  assert.equal(stored.jobs["job-b"].recordCount, 1, "the other tab's job was lost");
});

test("a stale checkpoint append preserves a newer progress total", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const current = new mod.CheckpointStore(mod.tab());
  await current.start("job-total", "home", ["posts"], false);
  const stale = new mod.CheckpointStore(mod.tab());
  await stale.load();
  await current.updateProgress("job-total", { completed: 0, total: 100 });
  await stale.append("job-total", [
    {
      tweetId: "stale",
      handle: "stale",
      displayName: "Stale",
      text: "stale",
      capturedAt: "2026-09-06T00:00:00Z",
      surface: "home",
      media: [],
      permalink: null
    }
  ]);
  assert.equal(
    mod.readShared(mod.CHECKPOINT_KEY).jobs["job-total"].progress.total,
    100,
    "a stale null total erased the newer progress metadata"
  );
});

test("diagnostic records merge by event and clear is authoritative", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.DiagnosticsStore(mod.tab());
  const b = new mod.DiagnosticsStore(mod.tab());
  await a.load();
  await b.load();

  a.record({ level: "error", message: "A", at: "2026-09-06T00:00:00.000Z", details: { source: "a" } });
  b.record({ level: "warn", message: "B", at: "2026-09-06T00:00:01.000Z", details: { source: "b" } });
  await Promise.all([a.flush(), b.flush()]);
  assert.deepEqual(mod.readShared(mod.DIAGNOSTICS_KEY).events.map((entry) => entry.message).sort(), ["A", "B"]);

  await a.clear();
  b.record({ level: "warn", message: "C", at: "2026-09-06T00:00:02.000Z", details: { source: "c" } });
  await b.flush();
  assert.deepEqual(mod.readShared(mod.DIAGNOSTICS_KEY).events.map((entry) => entry.message), ["C"]);
});

test("profile registry merges new profiles and preserves the install default", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const a = new mod.ProfileManager(mod.tab());
  const b = new mod.ProfileManager(mod.tab());
  await a.load();
  await b.load();
  const [one, two] = await Promise.all([a.create("One"), b.create("Two")]);
  const ids = mod.readShared(mod.PROFILE_REGISTRY_KEY).profiles.map((profile) => profile.id).sort();
  assert.deepEqual(ids, [mod.DEFAULT_PROFILE_ID, one.id, two.id].sort());
});

test("settings saves merge changed leaves and preserve an explicit clear", async () => {
  const mod = await load();
  mod.setSettleDelay(2);
  const storageA = mod.tab();
  const storageB = mod.tab();
  const baseline = mod.cloneSettings(mod.DEFAULT_SETTINGS);
  const settingsA = mod.cloneSettings(baseline);
  const settingsB = mod.cloneSettings(baseline);
  settingsA.appearance.theme = "noir";
  settingsA.filter.rules = ["text contains old"];
  settingsB.layout.hideRightSidebar = true;

  const save = (storage, before, current) => {
    const normalized = mod.normalizeSettings(mod.cloneSettings(current));
    const patch = mod.diffKnownSettings(before, normalized);
    return mod.mutateStored(storage, "aviary.settings.v1", baseline, (stored) =>
      mod.normalizeSettings(mod.applyKnownSettingsPatch(stored, patch))
    );
  };

  await Promise.all([save(storageA, baseline, settingsA), save(storageB, baseline, settingsB)]);
  const merged = mod.readShared("aviary.settings.v1");
  assert.equal(merged.appearance.theme, "noir");
  assert.equal(merged.layout.hideRightSidebar, true);

  const stale = mod.cloneSettings(settingsA);
  const cleared = mod.cloneSettings(settingsA);
  cleared.filter.rules = [];
  await save(storageA, settingsA, cleared);
  stale.appearance.denseMode = true;
  await save(storageB, settingsA, stale);
  const afterClear = mod.readShared("aviary.settings.v1");
  assert.deepEqual(afterClear.filter.rules, [], "a stale settings snapshot resurrected a cleared list");
  assert.equal(afterClear.appearance.denseMode, true);
});
