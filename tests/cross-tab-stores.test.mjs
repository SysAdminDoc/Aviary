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
      `export { withStorageLock, mutateStored } from ${JSON.stringify(abs("src/platform/storage-lock.ts"))};`
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
  assert.deepEqual(stored.entries.map((entry) => entry.key).sort(), ["alice:photo1", "bob:photo2"]);

  // The point of the index is recognising a file the other tab already saved. That happens on the
  // next write, which is when this tab next reads what is actually stored.
  await a.record("alice:photo3");
  assert.equal(a.has("bob:photo2"), true, "the other tab's dedup key was never adopted");
  assert.deepEqual(mod.readShared(mod.MEDIA_HISTORY_KEY).entries.map((entry) => entry.key).sort(), [
    "alice:photo1",
    "alice:photo3",
    "bob:photo2"
  ]);
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
  assert.deepEqual(
    mod.readShared(mod.MEDIA_HISTORY_KEY).entries.map((entry) => entry.key),
    ["alice:new"],
    "cleared download history came back"
  );

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
