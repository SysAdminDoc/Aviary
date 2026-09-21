import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceEntry } from "./helpers/source-import.mjs";

const source = await importSourceEntry([
  "src/features/account-cleanup/state.ts",
  "src/features/account-cleanup/runner.ts"
]);

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    async get(key, fallback) {
      return data.has(key) ? structuredClone(data.get(key)) : structuredClone(fallback);
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
    raw: data
  };
}

function sessionStorageStub() {
  const data = new Map();
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
}

function selected(category) {
  return Object.fromEntries(
    source.ACCOUNT_CLEANUP_CATEGORIES.map((entry) => [entry, entry === category])
  );
}

test("account cleanup runs references before authored content", () => {
  assert.deepEqual(source.ACCOUNT_CLEANUP_CATEGORIES, [
    "bookmarks",
    "likes",
    "reposts",
    "replies",
    "posts"
  ]);
  assert.equal(source.accountCleanupRouteFor("bookmarks", "alice"), "/i/history");
  assert.equal(source.accountCleanupRouteFor("likes", "alice"), "/i/history/likes");
  assert.equal(source.accountCleanupRouteFor("reposts", "alice"), "/alice/reposts");
  assert.equal(source.accountCleanupRouteMatches("likes", "Alice", "/alice/likes/"), true);
  assert.equal(source.accountCleanupRouteMatches("posts", "Alice", "/bob"), false);
});

test("stored cleanup state is bounded and rejects malformed identity", () => {
  assert.equal(source.normalizeAccountCleanupHandle("@valid_name"), "valid_name");
  assert.equal(source.normalizeAccountCleanupHandle("@home"), null);
  assert.equal(source.normalizeAccountCleanupHandle("bad-name"), null);

  const run = source.createAccountCleanupRun({
    account: "alice",
    ownerId: "tab-a",
    mode: "preview",
    options: {
      categories: selected("posts"),
      pacing: "careful",
      maxActions: 0
    },
    now: 100
  });
  run.processed.posts = Array.from({ length: 5_100 }, (_, index) => String(index + 1));
  run.failures = {
    "posts:44": 900,
    "other:55": 2,
    unsafe: 3
  };
  const normalized = source.normalizeAccountCleanupRun(run);

  assert.equal(normalized.processed.posts.length, 5_000);
  assert.equal(normalized.processed.posts[0], "101");
  assert.deepEqual(normalized.failures, { "posts:44": 20 });
});

test("cleanup starts directly without a preview", async () => {
  const storage = memoryStorage();
  const store = new source.AccountCleanupStore(storage, () => 1_000);
  const options = {
    categories: selected("likes"),
    pacing: "careful",
    maxActions: 0
  };
  const cleanup = await store.start("alice", "tab-a", "cleanup", options);
  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.run.settings.mode, "cleanup");
  assert.deepEqual(cleanup.run.plan, ["likes"]);
});

test("an unexpired cleanup lease cannot be stolen by another tab", async () => {
  const storage = memoryStorage();
  const store = new source.AccountCleanupStore(storage, () => 5_000);
  const started = await store.start("alice", "tab-a", "preview", {
    categories: selected("bookmarks"),
    pacing: "balanced",
    maxActions: 0
  });
  assert.equal(started.ok, true);

  const otherTab = await store.claim("tab-b");
  assert.deepEqual(otherTab, { ok: false, reason: "active_in_another_tab" });
  assert.equal((await store.load()).ownerId, "tab-a");
});

test("preview scans matching controls without invoking an account action", async () => {
  const storage = memoryStorage();
  const events = [];
  let calls = 0;
  let performed = 0;
  const runner = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: { pathname: "/i/history", assign() {} },
    sessionStorageObject: sessionStorageStub(),
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => {
        calls += 1;
        return [{
          category: "bookmarks",
          kind: "removeBookmark",
          article: {},
          control: {},
          author: "someone",
          id: "123"
        }];
      },
      performTarget: async () => {
        performed += 1;
        return { status: "success" };
      },
      scrollForMore: async () => ({ changed: false, visible: 1 }),
      sleep: async () => {}
    },
    onEvent: (event) => events.push(event.type)
  });

  const result = await runner.start("preview", "alice", {
    categories: selected("bookmarks"),
    pacing: "careful",
    maxActions: 0
  });
  assert.equal(result.ok, true);

  const deadline = Date.now() + 1_000;
  let run = await runner.load();
  while (run?.status !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    run = await runner.load();
  }

  assert.equal(run.status, "complete");
  assert.equal(run.stats.bookmarks.previewed, 1);
  assert.equal(performed, 0, "preview must never invoke the account action callback");
  assert.equal(run.processed.bookmarks.length, 0, "terminal state must not retain status IDs");
  assert.ok(calls > 1);
  assert.ok(events.includes("complete"));
  runner.teardown();
});

test("the owning tab resumes a preview after an X route navigation", async () => {
  const storage = memoryStorage();
  const session = sessionStorageStub();
  let navigatedTo = null;
  const sharedDependencies = {
    getActiveHandle: () => "alice",
    waitForValue: async (read) => read(),
    isChallengePresent: () => false,
    performTarget: async () => ({ status: "success" }),
    scrollForMore: async () => ({ changed: false, visible: 1 }),
    sleep: async () => {}
  };
  const beforeNavigation = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/home",
      assign(url) {
        navigatedTo = url;
      }
    },
    sessionStorageObject: session,
    dependencies: {
      ...sharedDependencies,
      findTargets: () => []
    }
  });

  assert.deepEqual(await beforeNavigation.start("preview", "alice", {
    categories: selected("likes"),
    pacing: "careful",
    maxActions: 0
  }), { ok: true });
  const navigationDeadline = Date.now() + 1_000;
  while (Date.now() < navigationDeadline) {
    if (navigatedTo) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(navigatedTo, "https://x.com/i/history/likes");
  assert.equal((await beforeNavigation.load()).phase, "navigating");
  beforeNavigation.teardown();

  const afterNavigation = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: { pathname: "/i/history/likes", assign() {} },
    sessionStorageObject: session,
    dependencies: {
      ...sharedDependencies,
      findTargets: () => [{
        category: "likes",
        kind: "unlike",
        article: {},
        control: {},
        author: "someone",
        id: "456"
      }]
    }
  });
  assert.deepEqual(await afterNavigation.resume({ automatic: true }), { ok: true });
  const completionDeadline = Date.now() + 1_000;
  let resumed = await afterNavigation.load();
  while (resumed?.status !== "complete" && Date.now() < completionDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    resumed = await afterNavigation.load();
  }
  assert.equal(resumed.status, "complete");
  assert.equal(resumed.stats.likes.previewed, 1);
  afterNavigation.teardown();
});

test("an account mismatch blocks before any target is scanned", async () => {
  const storage = memoryStorage();
  let scans = 0;
  const runner = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: { pathname: "/i/history", assign() {} },
    sessionStorageObject: sessionStorageStub(),
    dependencies: {
      getActiveHandle: () => "bob",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => {
        scans += 1;
        return [];
      },
      performTarget: async () => ({ status: "success" }),
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async () => {}
    }
  });
  assert.deepEqual(await runner.start("preview", "alice", {
    categories: selected("bookmarks"),
    pacing: "careful",
    maxActions: 0
  }), { ok: true });
  const deadline = Date.now() + 1_000;
  let run = await runner.load();
  while (run?.status !== "blocked" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    run = await runner.load();
  }
  assert.equal(run.status, "blocked");
  assert.equal(run.reason, "account_changed");
  assert.equal(scans, 0);
  runner.teardown();
});
