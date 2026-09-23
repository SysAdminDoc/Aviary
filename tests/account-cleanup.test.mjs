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

async function finishEmptyCleanupVerification({ storage, session, category = "likes", events = [] }) {
  const stored = source.normalizeAccountCleanupRun(
    await storage.get(source.ACCOUNT_CLEANUP_KEY, null)
  );
  const runner = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: source.accountCleanupRouteFor(category, stored.account),
      assign() {}
    },
    sessionStorageObject: session,
    dependencies: {
      getActiveHandle: () => stored.account,
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => [],
      performTarget: async () => ({ status: "success" }),
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async () => {}
    },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(await runner.resume({ automatic: true }), { ok: true });
  const deadline = Date.now() + 1_000;
  let run = await runner.load();
  while (run?.status !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    run = await runner.load();
  }
  runner.teardown();
  return run;
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

test("deletion starts with nothing selected and a stored plan never gains a category", () => {
  const none = Object.fromEntries(source.ACCOUNT_CLEANUP_CATEGORIES.map((category) => [category, false]));
  assert.deepEqual(source.defaultAccountCleanupCategories(), none);
  assert.deepEqual(source.normalizeAccountCleanupSettings({}).categories, none);
  assert.deepEqual(source.normalizeAccountCleanupSettings(undefined).categories, none);

  // A stored run written without some keys keeps exactly what it named, and a truthy
  // non-boolean is not a selection either.
  const partial = source.normalizeAccountCleanupSettings({ categories: { posts: true, likes: 1 } });
  assert.deepEqual(partial.categories, { ...none, posts: true });

  const run = source.createAccountCleanupRun({
    account: "alice",
    ownerId: "tab-a",
    mode: "cleanup",
    options: { categories: { bookmarks: true }, pacing: "balanced", maxActions: 0 }
  });
  const reloaded = source.normalizeAccountCleanupRun(structuredClone(run));
  assert.deepEqual(reloaded.plan, ["bookmarks"]);
  assert.deepEqual(reloaded.settings.categories, { ...none, bookmarks: true });
});

test("stored cleanup state is bounded and rejects malformed identity", () => {
  assert.equal(source.normalizeAccountCleanupHandle("@valid_name"), "valid_name");
  assert.equal(source.normalizeAccountCleanupHandle("@home"), null);
  assert.equal(source.normalizeAccountCleanupHandle("bad-name"), null);
  assert.equal(source.normalizeAccountCleanupSettings({}).pacing, "balanced");

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
    "posts:45": 0,
    "other:55": 2,
    unsafe: 3
  };
  run.likeRateWindowStartedAt = 42;
  run.likeRateWindowActions = 900;
  run.categoryVerificationPasses = 900;
  const normalized = source.normalizeAccountCleanupRun(run);

  assert.equal(normalized.processed.posts.length, 5_000);
  assert.equal(normalized.processed.posts[0], "101");
  assert.deepEqual(normalized.failures, { "posts:44": 20 });
  assert.equal(normalized.likeRateWindowStartedAt, 42);
  assert.equal(
    normalized.likeRateWindowActions,
    source.ACCOUNT_CLEANUP_TIMING.likeRateWindowActionLimit
  );
  assert.equal(
    normalized.categoryVerificationPasses,
    source.ACCOUNT_CLEANUP_TIMING.requiredEmptyVerificationPasses
  );
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

test("automatic route resumes preserve the user's action limit progress", async () => {
  const storage = memoryStorage();
  let now = 5_000;
  const store = new source.AccountCleanupStore(storage, () => now);
  const started = await store.start("alice", "tab-a", "cleanup", {
    categories: selected("likes"),
    pacing: "balanced",
    maxActions: 25
  });
  started.run.actionsThisSession = 12;
  await store.save(started.run, "tab-a");

  now += source.ACCOUNT_CLEANUP_TIMING.leaseMs + 1;
  const automatic = await store.claim("tab-a");
  assert.equal(automatic.run.actionsThisSession, 12);

  const manual = await store.claim("tab-a", true);
  assert.equal(manual.run.actionsThisSession, 0);
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

test("cleanup keeps scanning while X is still extending the timeline", async () => {
  const storage = memoryStorage();
  let scrolls = 0;
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
      findTargets: () => [],
      performTarget: async () => ({ status: "success" }),
      scrollForMore: async () => ({
        changed: ++scrolls <= 20,
        visible: 0
      }),
      sleep: async () => {}
    }
  });

  assert.deepEqual(await runner.start("preview", "alice", {
    categories: selected("bookmarks"),
    pacing: "brisk",
    maxActions: 0
  }), { ok: true });

  const deadline = Date.now() + 1_000;
  let run = await runner.load();
  while (run?.status !== "complete" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    run = await runner.load();
  }

  assert.equal(run.status, "complete");
  assert.equal(
    scrolls,
    20 + source.ACCOUNT_CLEANUP_TIMING.idleScrollLimit,
    "timeline movement must reset the consecutive empty-scroll count"
  );
  runner.teardown();
});

test("cleanup reports automatic rests and resumes visibly", async () => {
  const storage = memoryStorage();
  const session = sessionStorageStub();
  const events = [];
  const sleeps = [];
  const pacing = source.ACCOUNT_CLEANUP_PACING.brisk;
  let performed = 0;
  let verificationUrl = null;
  const runner = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/i/history/likes",
      assign(url) {
        verificationUrl = url;
      }
    },
    sessionStorageObject: session,
    random: () => 0,
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => performed < pacing.batchSize
        ? [{
            category: "likes",
            kind: "unlike",
            article: {},
            control: {},
            author: "someone",
            id: String(performed + 1)
          }]
        : [],
      performTarget: async () => {
        performed += 1;
        return { status: "success" };
      },
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(await runner.start("cleanup", "alice", {
    categories: selected("likes"),
    pacing: "brisk",
    maxActions: 0
  }), { ok: true });

  const deadline = Date.now() + 3_000;
  let run = await runner.load();
  while (Date.now() < deadline) {
    if (verificationUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
    run = await runner.load();
  }
  runner.teardown();
  assert.equal(verificationUrl, "https://x.com/i/history/likes");
  run = await finishEmptyCleanupVerification({ storage, session, events });

  assert.equal(run.status, "complete");
  assert.equal(run.stats.likes.completed, pacing.batchSize);
  assert.equal(events.filter((event) => event.type === "action").length, pacing.batchSize);
  assert.equal(
    events.some((event) => / visible .* pending\.$/.test(event.message)),
    false,
    "the runner must not redraw progress immediately after every action"
  );
  assert.equal(sleeps.filter((milliseconds) => milliseconds === pacing.batchPauseMs).length, 1);
  assert.ok(events.some((event) => event.message ===
    `Resting for ${Math.ceil(pacing.batchPauseMs / 1_000)} seconds after ${pacing.batchSize} actions. Deletion continues automatically.`));
  assert.ok(events.some((event) => event.message === "Continuing Likes."));
  assert.ok(events.some((event) =>
    event.message === "Fresh verification found no more likes."));
});

test("cleanup reloads from the top until a fresh pass finds nothing", async () => {
  const storage = memoryStorage();
  const session = sessionStorageStub();
  const events = [];
  let performed = 0;
  let verificationUrl = null;
  const target = (id) => ({
    category: "likes",
    kind: "unlike",
    article: {},
    control: {},
    author: "someone",
    id
  });

  const first = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/i/history/likes",
      assign(url) {
        verificationUrl = url;
      }
    },
    sessionStorageObject: session,
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => performed === 0 ? [target("1")] : [],
      performTarget: async () => {
        performed += 1;
        return { status: "success" };
      },
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async () => {}
    },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(await first.start("cleanup", "alice", {
    categories: selected("likes"),
    pacing: "brisk",
    maxActions: 0
  }), { ok: true });
  const firstDeadline = Date.now() + 1_000;
  while (Date.now() < firstDeadline) {
    if (verificationUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  first.teardown();
  assert.equal(verificationUrl, "https://x.com/i/history/likes");

  verificationUrl = null;
  const second = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/i/history/likes",
      assign(url) {
        verificationUrl = url;
      }
    },
    sessionStorageObject: session,
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => performed === 1 ? [target("2")] : [],
      performTarget: async () => {
        performed += 1;
        return { status: "success" };
      },
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async () => {}
    },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(await second.resume({ automatic: true }), { ok: true });
  const secondDeadline = Date.now() + 1_000;
  while (Date.now() < secondDeadline) {
    if (verificationUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  second.teardown();
  assert.equal(verificationUrl, "https://x.com/i/history/likes");

  const completed = await finishEmptyCleanupVerification({ storage, session, events });
  assert.equal(completed.status, "complete");
  assert.equal(completed.stats.likes.completed, 2);
  assert.equal(performed, 2);
  assert.equal(
    events.filter((event) =>
      event.message === "Reloading Likes from the top to verify that nothing was missed.").length,
    2
  );
  assert.ok(events.some((event) =>
    event.message === "Fresh verification found no more likes."));
});

test("cleanup pacing avoids long silent pauses", () => {
  assert.deepEqual(source.ACCOUNT_CLEANUP_PACING, {
    careful: {
      label: "Careful",
      minDelayMs: 2_000,
      maxDelayMs: 3_500,
      batchSize: 40,
      batchPauseMs: 20_000
    },
    balanced: {
      label: "Balanced",
      minDelayMs: 1_000,
      maxDelayMs: 1_800,
      batchSize: 60,
      batchPauseMs: 12_000
    },
    brisk: {
      label: "Brisk",
      minDelayMs: 400,
      maxDelayMs: 900,
      batchSize: 80,
      batchPauseMs: 6_000
    }
  });
});

test("cleanup reloads an unresponsive X page and retries the same action", async () => {
  const storage = memoryStorage();
  const session = sessionStorageStub();
  const events = [];
  const sleeps = [];
  let navigatedTo = null;
  const target = {
    category: "likes",
    kind: "unlike",
    article: {},
    control: {},
    author: "someone",
    id: "909"
  };
  const stalled = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/i/history/likes",
      assign(url) {
        navigatedTo = url;
      }
    },
    sessionStorageObject: session,
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => [target],
      performTarget: async () => ({ status: "failed", reason: "action_not_applied" }),
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(await stalled.start("cleanup", "alice", {
    categories: selected("likes"),
    pacing: "brisk",
    maxActions: 0
  }), { ok: true });

  const reloadDeadline = Date.now() + 1_000;
  while (Date.now() < reloadDeadline) {
    if (navigatedTo) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const stalledRun = await stalled.load();
  assert.equal(navigatedTo, "https://x.com/i/history/likes");
  assert.equal(stalledRun.status, "running");
  assert.equal(stalledRun.phase, "recovering");
  assert.equal(stalledRun.pageRecoveryAttempts, 1);
  assert.deepEqual(stalledRun.processed.likes, []);
  assert.equal(stalledRun.failures["likes:909"], 2);
  assert.ok(sleeps.includes(source.ACCOUNT_CLEANUP_TIMING.recoveryPauseBaseMs));
  assert.ok(events.some((event) =>
    event.message === "X did not apply the action twice. Waiting 30 seconds before reloading Likes (1/5)."));
  assert.ok(events.some((event) =>
    event.message === "Reloading Likes now. Deletion continues automatically."));
  stalled.teardown();

  let performed = 0;
  let verificationUrl = null;
  const recovered = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/i/history/likes",
      assign(url) {
        verificationUrl = url;
      }
    },
    sessionStorageObject: session,
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => performed === 0 ? [target] : [],
      performTarget: async () => {
        performed += 1;
        return { status: "success" };
      },
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async () => {}
    }
  });

  assert.deepEqual(await recovered.resume({ automatic: true }), { ok: true });
  const completionDeadline = Date.now() + 1_000;
  let completed = await recovered.load();
  while (Date.now() < completionDeadline) {
    if (verificationUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed = await recovered.load();
  }
  completed = await recovered.load();
  assert.equal(completed.likeRateWindowActions, 1);
  assert.equal(typeof completed.likeRateWindowStartedAt, "number");
  recovered.teardown();
  assert.equal(verificationUrl, "https://x.com/i/history/likes");
  completed = await finishEmptyCleanupVerification({ storage, session });

  assert.equal(completed.status, "complete");
  assert.equal(completed.stats.likes.completed, 1);
  assert.equal(completed.stats.likes.failed, 2);
  assert.equal(completed.pageRecoveryAttempts, 0);
  assert.deepEqual(completed.failures, {});
});

test("cleanup waits for X's 500-action Like window before action 501", async () => {
  let now = 10 * 60_000;
  const ownerId = "tab-rate-window";
  const run = source.createAccountCleanupRun({
    account: "alice",
    ownerId,
    mode: "cleanup",
    options: {
      categories: selected("likes"),
      pacing: "brisk",
      maxActions: 0
    },
    now
  });
  run.likeRateWindowStartedAt = now - (5 * 60_000);
  run.likeRateWindowActions = source.ACCOUNT_CLEANUP_TIMING.likeRateWindowActionLimit;
  run.stats.likes.completed = source.ACCOUNT_CLEANUP_TIMING.likeRateWindowActionLimit;
  run.leaseUntil = 0;

  const storage = memoryStorage({ [source.ACCOUNT_CLEANUP_KEY]: run });
  const session = sessionStorageStub();
  source.writeAccountCleanupTabToken(ownerId, session);
  const sleeps = [];
  const events = [];
  let performed = 0;
  let navigatedTo = null;
  const runner = new source.AccountCleanupRunner({
    storage,
    documentObject: {},
    windowObject: {},
    locationObject: {
      pathname: "/i/history/likes",
      assign(url) {
        navigatedTo = url;
      }
    },
    sessionStorageObject: session,
    clock: () => now,
    dependencies: {
      getActiveHandle: () => "alice",
      waitForValue: async (read) => read(),
      isChallengePresent: () => false,
      findTargets: () => [{
        category: "likes",
        kind: "unlike",
        article: {},
        control: {},
        author: "someone",
        id: "501"
      }],
      performTarget: async () => {
        performed += 1;
        return { status: "success" };
      },
      scrollForMore: async () => ({ changed: false, visible: 0 }),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      }
    },
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(await runner.resume({ automatic: true }), { ok: true });
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (navigatedTo) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const waited = (10 * 60_000) + source.ACCOUNT_CLEANUP_TIMING.rateWindowGraceMs;
  const saved = await runner.load();
  assert.equal(performed, 0);
  assert.deepEqual(sleeps, [waited]);
  assert.equal(navigatedTo, "https://x.com/i/history/likes");
  assert.equal(saved.phase, "recovering");
  assert.equal(saved.likeRateWindowStartedAt, null);
  assert.equal(saved.likeRateWindowActions, 0);
  assert.ok(events.some((event) => event.message ===
    "X's 500-action Like limit was reached. Waiting 10 minutes for the next window. Deletion continues automatically."));
  assert.ok(events.some((event) =>
    event.message === "Reloading Likes for the next X rate window."));
  runner.teardown();
});
