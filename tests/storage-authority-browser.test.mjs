import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { chromium, firefox } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PENDING_KEY = "aviary.durable.pending";
const SETTINGS_KEY = "aviary.settings.v1";
const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
const LOCK_PREFIX = "aviary.lock.v1.";
const CRASH_POINTS = [
  "legacy.get.pending.before",
  "legacy.get.pending.after",
  "backend.stage.before",
  "backend.stage.after",
  "backend.commit.before",
  "backend.commit.after",
  "legacy.remove.value.before",
  "legacy.remove.value.after",
  "legacy.remove.pending.before",
  "legacy.remove.pending.after"
];
const LANES = [
  { name: "Chrome extension", engine: "chromium", mode: "extension" },
  { name: "Firefox extension", engine: "firefox", mode: "extension" },
  { name: "Tampermonkey model adapter", engine: "chromium", mode: "userscript" },
  { name: "Violentmonkey model adapter", engine: "firefox", mode: "userscript" }
];

let temp;
let bundle;
let chromiumBrowser;
let firefoxBrowser;

before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "aviary-storage-authority-"));
  const entry = path.join(temp, "entry.ts");
  bundle = path.join(temp, "bundle.js");
  const source = (relative) => JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
  await writeFile(entry, [
    `export { createStorageGateway } from ${source("src/platform/storage.ts")};`,
    `export { createDurableStorageGateway } from ${source("src/platform/durable-storage.ts")};`,
    `export { replaceStored } from ${source("src/platform/storage-lock.ts")};`,
    `export { createLibraryBackup, restoreLibraryBackup } from ${source("src/features/core/library-backup.ts")};`,
    `export { normalizeSettings } from ${source("src/platform/settings.ts")};`,
    `export { migrateLegacyHostDurableStorage } from ${source("src/extension/durable-storage-api.ts")};`,
    `export { hashStorageValue } from ${source("src/platform/storage-value-hash.ts")};`
  ].join("\n"), "utf8");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryStorageAuthority",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  [chromiumBrowser, firefoxBrowser] = await Promise.all([
    chromium.launch({ headless: true }),
    firefox.launch({ headless: true })
  ]);
});

after(async () => {
  await Promise.allSettled([chromiumBrowser?.close(), firefoxBrowser?.close()]);
  if (temp) await rm(temp, { recursive: true, force: true });
});

/**
 * One top-level test per lane, not four subtests under a shared budget.
 *
 * These were subtests of a single 180s parent. Each lane drives a real browser through a ten-point
 * crash matrix plus restore and rollback, and node:test runs files in parallel, so on a loaded
 * machine the Firefox lane alone consumed the whole parent budget. What that produced was not one
 * honest timeout but four broken results: the parent timed out, the running lane was "cancelled
 * before its parent", the two lanes that had not started reported "could not be started because
 * its parent finished", and the browser tests in other files were starved into failing beside it.
 *
 * The lanes are already independent -- each builds and closes its own context -- so they get their
 * own budgets. A slow lane now reports as one slow lane.
 */
for (const lane of LANES) {
  test(`${lane.name} shares one storage lock authority across origins`, { timeout: 240_000 }, async () => {
    const session = await createLaneSession(lane);
    try {
      await verifyPendingWriteUnion(session);
      await verifyCrashMatrix(session);
      await verifyRestoreCommit(session);
      await verifyRestoreRollback(session);
    } finally {
      await session.context.close();
    }
  });
}

test("a verified host migration keeps booting while an old tab blocks deletion", { timeout: 30_000 }, async () => {
  const context = await chromiumBrowser.newContext();
  await context.route("**/*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><meta charset=utf-8><title>storage migration</title>"
  }));
  const oldTab = await context.newPage();
  const newTab = await context.newPage();
  try {
    await Promise.all([oldTab.goto("https://x.com/home"), newTab.goto("https://x.com/home")]);
    await newTab.addScriptTag({ path: bundle });
    await oldTab.evaluate(async () => {
      const request = indexedDB.open("aviary.durable.v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("values", { keyPath: "key" });
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("values", "readwrite");
      transaction.objectStore("values").put({
        key: "aviary.profile.inactive.userNotes.v1",
        value: { alice: "held by old tab" },
        updatedAt: new Date().toISOString()
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      window.__legacyDatabase = database;
    });

    const result = await newTab.evaluate(async () => {
      const copied = new Map();
      const backend = {
        async migrateHostEntries(entries) {
          const receipts = {};
          for (const entry of entries) {
            copied.set(entry.key, structuredClone(entry.value));
            receipts[entry.key] = await AviaryStorageAuthority.hashStorageValue(entry.value);
          }
          return receipts;
        }
      };
      const migration = await Promise.race([
        AviaryStorageAuthority.migrateLegacyHostDurableStorage(backend),
        new Promise((_, reject) => setTimeout(() => reject(new Error("migration blocked boot")), 2_000))
      ]);
      return {
        migration,
        copied: copied.get("aviary.profile.inactive.userNotes.v1")
      };
    });

    assert.deepEqual(result.migration, {
      databaseFound: true,
      recordsCopied: 1,
      databaseDeleted: false
    });
    assert.deepEqual(result.copied, { alice: "held by old tab" });

    await oldTab.evaluate(async () => {
      const transaction = window.__legacyDatabase.transaction("values", "readwrite");
      transaction.objectStore("values").put({
        key: "aviary.profile.inactive.userNotes.v1",
        value: { alice: "written after first copy" },
        updatedAt: new Date().toISOString()
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    });
    await oldTab.evaluate(() => window.__legacyDatabase.close());
    assert.equal(
      await newTab.evaluate(async () =>
        (await indexedDB.databases()).some((database) => database.name === "aviary.durable.v1")
      ),
      true,
      "the blocked delete request outlived its isolated realm"
    );

    const retried = await newTab.evaluate(async () => {
      const copied = new Map();
      const backend = {
        async migrateHostEntries(entries) {
          const receipts = {};
          for (const entry of entries) {
            copied.set(entry.key, structuredClone(entry.value));
            receipts[entry.key] = await AviaryStorageAuthority.hashStorageValue(entry.value);
          }
          return receipts;
        }
      };
      return {
        migration: await AviaryStorageAuthority.migrateLegacyHostDurableStorage(backend),
        copied: copied.get("aviary.profile.inactive.userNotes.v1")
      };
    });
    assert.deepEqual(retried.migration, {
      databaseFound: true,
      recordsCopied: 1,
      databaseDeleted: true
    });
    assert.deepEqual(retried.copied, { alice: "written after first copy" });
    await newTab.waitForFunction(async () => {
      const databases = await indexedDB.databases();
      return !databases.some((database) => database.name === "aviary.durable.v1");
    });
  } finally {
    await context.close();
  }
});

test("host migration copies a late write committed before the seal", { timeout: 30_000 }, async () => {
  const context = await chromiumBrowser.newContext();
  let copyStartedResolve;
  let releaseCopy;
  const copyStarted = new Promise((resolve) => { copyStartedResolve = resolve; });
  const copyGate = new Promise((resolve) => { releaseCopy = resolve; });
  await context.exposeBinding("__migrationCopyBarrier", () => {
    releaseCopy = releaseCopy ?? (() => {});
    copyStartedResolve();
    return copyGate;
  });
  await context.route("**/*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><meta charset=utf-8><title>storage migration final snapshot</title>"
  }));
  const oldTab = await context.newPage();
  const newTab = await context.newPage();
  try {
    await Promise.all([oldTab.goto("https://x.com/home"), newTab.goto("https://x.com/home")]);
    await newTab.addScriptTag({ path: bundle });
    await oldTab.evaluate(async () => {
      const request = indexedDB.open("aviary.durable.v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("values", { keyPath: "key" });
      const database = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("values", "readwrite");
      transaction.objectStore("values").put({
        key: "aviary.profile.inactive.userNotes.v1",
        value: { alice: "initial" },
        updatedAt: new Date().toISOString()
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      window.__legacyDatabase = database;
    });

    const migrating = newTab.evaluate(async () => {
      const copied = [];
      let paused = false;
      const backend = {
        async migrateHostEntries(entries) {
          if (!paused) {
            paused = true;
            await window.__migrationCopyBarrier();
          }
          copied.push(...entries.map((entry) => ({ key: entry.key, value: structuredClone(entry.value) })));
          const hashes = {};
          for (const entry of entries) hashes[entry.key] = await AviaryStorageAuthority.hashStorageValue(entry.value);
          return hashes;
        }
      };
      const migration = await AviaryStorageAuthority.migrateLegacyHostDurableStorage(backend);
      return { migration, copied };
    });
    await copyStarted;
    await oldTab.evaluate(async () => {
      const transaction = window.__legacyDatabase.transaction("values", "readwrite");
      transaction.objectStore("values").put({
        key: "aviary.profile.inactive.userNotes.v1",
        value: { alice: "late" },
        updatedAt: new Date().toISOString()
      });
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      window.__legacyDatabase.close();
    });
    releaseCopy();
    const result = await migrating;
    assert.deepEqual(result.migration, {
      databaseFound: true,
      recordsCopied: 1,
      databaseDeleted: true
    });
    assert.deepEqual(result.copied.at(-1), {
      key: "aviary.profile.inactive.userNotes.v1",
      value: { alice: "late" }
    });
  } finally {
    await context.close();
  }
});

async function createLaneSession(lane) {
  const browser = lane.engine === "chromium" ? chromiumBrowser : firefoxBrowser;
  const context = await browser.newContext();
  const state = new Map();
  const control = {
    faultTarget: null,
    faultTriggered: false,
    pause: null,
    order: [],
    registerChains: new Map(),
    fences: new Map()
  };
  await context.exposeBinding("__aviarySharedStore", async (_source, request) =>
    handleSharedStore(state, control, request)
  );
  await context.addInitScript(({ mode }) => {
    const call = (request) => globalThis.__aviarySharedStore(request);
    if (mode === "extension") {
      const local = {
        async get(keys) {
          if (keys === null) return call({ operation: "all" });
          const requested = Array.isArray(keys)
            ? keys
            : typeof keys === "string"
              ? [keys]
              : Object.keys(keys ?? {});
          const result = {};
          for (const key of requested) {
            const stored = await call({ operation: "get", key });
            if (stored.found) result[key] = stored.value;
            else if (keys && typeof keys === "object" && !Array.isArray(keys)) result[key] = keys[key];
          }
          return result;
        },
        async set(values) {
          await call({ operation: "set-many", values });
        },
        async remove(keys) {
          await call({ operation: "remove", keys: Array.isArray(keys) ? keys : [keys] });
        }
      };
      const runtime = {
        id: "aviary-storage-authority-test",
        getManifest: () => ({ manifest_version: 3 }),
        async sendMessage(message) {
          if (message?.type === "AVIARY_STORAGE_LOCK_REGISTER") {
            return call({ operation: "lock-register", request: message });
          }
          if (message?.type === "AVIARY_STORAGE_FENCE") {
            return call({ operation: "fence", request: message });
          }
          return { ok: false, error: "unsupported test message" };
        }
      };
      Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        value: { runtime, storage: { local } }
      });
      return;
    }
    globalThis.GM_getValue = async (key, fallback) => {
      const stored = await call({ operation: "get", key });
      return stored.found ? stored.value : fallback;
    };
    globalThis.GM_setValue = async (key, value) => {
      await call({ operation: "set-one", key, value });
    };
    globalThis.GM_deleteValue = async (key) => {
      await call({ operation: "remove", keys: [key] });
    };
    globalThis.GM_listValues = async () => call({ operation: "list" });
  }, { mode: lane.mode });
  await context.route("**/*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><meta charset=utf-8><title>storage authority</title>"
  }));
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("https://x.com/home"), second.goto("https://twitter.com/home")]);
  await Promise.all([first.addScriptTag({ path: bundle }), second.addScriptTag({ path: bundle })]);
  assert.notEqual(await first.evaluate(() => location.origin), await second.evaluate(() => location.origin));
  return { lane, context, pages: [first, second], state, control };
}

async function verifyPendingWriteUnion(session) {
  resetSession(session);
  const keys = ["aviary.userNotes.v1", "aviary.snapshots.v1"];
  await Promise.all(session.pages.map((page) => page.evaluate(async ({ mode, keys }) => {
    const backend = {
      async get() { return undefined; },
      async put() { throw new Error("backend unavailable"); },
      async remove() { throw new Error("backend unavailable"); },
      async getMeta() { return undefined; },
      async putMany() {},
      async stagePendingWrite() {},
      async commitPendingWrite() { throw new Error("not reached"); },
      async estimate() { return {}; }
    };
    const legacy = AviaryStorageAuthority.createStorageGateway("aviary", { mode });
    window.__fallbackGateway = AviaryStorageAuthority.createDurableStorageGateway(legacy, { backend });
    await window.__fallbackGateway.initialize(keys);
  }, { mode: session.lane.mode, keys })));

  await Promise.all([
    session.pages[0].evaluate((key) => window.__fallbackGateway.set(key, { alice: "one" }), keys[0]),
    session.pages[1].evaluate((key) => window.__fallbackGateway.remove(key), keys[1])
  ]);

  const ledger = session.state.get(PENDING_KEY);
  assert.equal(ledger.schemaVersion, 2, `${session.lane.name} did not persist the v2 journal`);
  assert.deepEqual(
    new Set(ledger.entries.map((entry) => entry.key)),
    new Set(keys),
    `${session.lane.name} lost a simultaneous pending operation`
  );
  assert.equal(ledger.entries.find((entry) => entry.key === keys[1]).kind, "remove");
  assertNoLockResidue(session);
}

async function verifyCrashMatrix(session) {
  const page = session.pages[0];
  const key = "aviary.userNotes.v1";
  for (const latestKind of ["put", "remove"]) {
    for (const crashPoint of CRASH_POINTS) {
      resetSession(session);
      const firstWrite = latestKind === "put"
        ? { id: "first-remove", key, kind: "remove" }
        : { id: "first-put", key, kind: "put", value: { version: "intermediate" } };
      const latestWrite = latestKind === "put"
        ? { id: "latest-put", key, kind: "put", value: { version: "latest" } }
        : { id: "latest-remove", key, kind: "remove" };
      session.state.set(PENDING_KEY, pendingLedger(firstWrite));
      session.control.faultTarget = crashPoint;

      const localFaultTriggered = await page.evaluate(async ({ mode, key, crashPoint }) => {
        const state = {
          values: new Map([[key, { version: "before" }]]),
          pending: new Map(),
          meta: undefined
        };
        const fault = { target: crashPoint, triggered: false };
        const hit = (point) => {
          if (!fault.triggered && fault.target === point) {
            fault.triggered = true;
            throw new Error(`simulated crash at ${point}`);
          }
        };
        window.__makeCrashBackend = (activeFault) => ({
          async get(storageKey) {
            return state.values.has(storageKey) ? structuredClone(state.values.get(storageKey)) : undefined;
          },
          async put(storageKey, value) { state.values.set(storageKey, structuredClone(value)); },
          async remove(storageKey) { state.values.delete(storageKey); },
          async getMeta() { return state.meta ? structuredClone(state.meta) : undefined; },
          async putMany(entries, meta) {
            for (const [storageKey, value] of entries) state.values.set(storageKey, structuredClone(value));
            state.meta = structuredClone(meta);
          },
          async stagePendingWrite(write) {
            activeFault?.("backend.stage.before");
            state.pending.set(write.key, structuredClone(write));
            activeFault?.("backend.stage.after");
          },
          async commitPendingWrite(expected) {
            activeFault?.("backend.commit.before");
            const write = state.pending.get(expected.key);
            if (!write || write.id !== expected.id) throw new Error("pending marker mismatch");
            if (write.kind === "put") state.values.set(write.key, structuredClone(write.value));
            else state.values.delete(write.key);
            state.pending.delete(write.key);
            activeFault?.("backend.commit.after");
            return {
              id: write.id,
              key: write.key,
              kind: write.kind,
              valueHash: write.kind === "put"
                ? await AviaryStorageAuthority.hashStorageValue(write.value)
                : null
            };
          },
          async estimate() { return {}; }
        });
        window.__crashBackendState = state;
        const legacy = AviaryStorageAuthority.createStorageGateway("aviary", { mode });
        const gateway = AviaryStorageAuthority.createDurableStorageGateway(legacy, {
          backend: window.__makeCrashBackend(hit)
        });
        await gateway.initialize([key]);
        return fault.triggered;
      }, { mode: session.lane.mode, key, crashPoint });

      assert.equal(
        localFaultTriggered || session.control.faultTriggered,
        true,
        `${session.lane.name} did not exercise ${crashPoint}`
      );
      session.control.faultTarget = null;
      session.state.set(PENDING_KEY, pendingLedger(latestWrite));

      const result = await page.evaluate(async ({ mode, key }) => {
        const legacy = AviaryStorageAuthority.createStorageGateway("aviary", { mode });
        const gateway = AviaryStorageAuthority.createDurableStorageGateway(legacy, {
          backend: window.__makeCrashBackend(undefined)
        });
        const status = await gateway.initialize([key]);
        return {
          status,
          value: await gateway.get(key, "absent"),
          staged: window.__crashBackendState.pending.size
        };
      }, { mode: session.lane.mode, key });

      assert.equal(result.status.backend, "indexeddb", `${session.lane.name} did not recover`);
      assert.equal(result.status.pendingWrites, 0);
      assert.equal(result.staged, 0);
      if (latestKind === "put") assert.deepEqual(result.value, { version: "latest" });
      else assert.equal(result.value, "absent");
      assert.equal(session.state.has(PENDING_KEY), false);
      assertNoLockResidue(session);
    }
  }
}

async function verifyRestoreCommit(session) {
  resetSession(session);
  const payload = await createBackupPayload(session.pages[0], {
    [BOOKMARKS_KEY]: { entries: [{ id: "backup", text: "restored" }] }
  });
  session.state.set(BOOKMARKS_KEY, { entries: [{ id: "before", text: "preflight" }] });
  const pause = pauseStoreWrite(session.control, "commit");
  const restoring = session.pages[0].evaluate(
    ({ mode, payload }) => AviaryStorageAuthority.restoreLibraryBackup(
      AviaryStorageAuthority.createStorageGateway("aviary", { mode }),
      payload
    ),
    { mode: session.lane.mode, payload }
  );
  await pause.entered;
  let writerSettled = false;
  const writer = session.pages[1].evaluate(
    ({ mode }) => AviaryStorageAuthority.replaceStored(
      AviaryStorageAuthority.createStorageGateway("aviary", { mode }),
      "aviary.library.bookmarks.v1",
      { entries: [{ id: "writer", text: "saved after restore" }] }
    ),
    { mode: session.lane.mode }
  ).then(() => { writerSettled = true; });
  await delay(75);
  assert.equal(writerSettled, false, `${session.lane.name} let a writer enter restore`);
  pause.release();
  assert.equal((await restoring).applied, true);
  await writer;
  assert.equal(session.state.get(BOOKMARKS_KEY).entries[0].id, "writer");
  assertNoLockResidue(session);
}

async function verifyRestoreRollback(session) {
  resetSession(session);
  const fixtures = await session.pages[0].evaluate(() => ({
    current: AviaryStorageAuthority.normalizeSettings({ appearance: { theme: "plum" } }),
    writer: AviaryStorageAuthority.normalizeSettings({ appearance: { theme: "noir" } })
  }));
  const payload = await createBackupPayload(session.pages[0], {
    [SETTINGS_KEY]: await session.pages[0].evaluate(() =>
      AviaryStorageAuthority.normalizeSettings({ appearance: { theme: "dim" } })
    ),
    [BOOKMARKS_KEY]: { entries: [{ id: "backup" }] }
  });
  session.state.set(SETTINGS_KEY, fixtures.current);
  session.state.set(BOOKMARKS_KEY, { entries: [{ id: "current" }] });
  const pause = pauseStoreWrite(session.control, "rollback");
  const restoring = session.pages[0].evaluate(
    ({ mode, payload }) => AviaryStorageAuthority.restoreLibraryBackup(
      AviaryStorageAuthority.createStorageGateway("aviary", { mode }),
      payload
    ),
    { mode: session.lane.mode, payload }
  );
  await pause.entered;
  let writerSettled = false;
  const writer = session.pages[1].evaluate(
    ({ mode, value }) => AviaryStorageAuthority.replaceStored(
      AviaryStorageAuthority.createStorageGateway("aviary", { mode }),
      "aviary.settings.v1",
      value
    ),
    { mode: session.lane.mode, value: fixtures.writer }
  ).then(() => { writerSettled = true; });
  await delay(75);
  assert.equal(writerSettled, false, `${session.lane.name} let a writer enter rollback`);
  pause.release();
  assert.equal((await restoring).applied, false);
  await writer;
  assert.equal(session.state.get(SETTINGS_KEY).appearance.theme, "noir");
  assert.equal(session.state.get(BOOKMARKS_KEY).entries[0].id, "current");
  assert.deepEqual(session.control.order, ["rollback", "writer"]);
  assertNoLockResidue(session);
}

async function createBackupPayload(page, values) {
  return page.evaluate(async (entries) => {
    const store = new Map(Object.entries(entries));
    const storage = {
      async get(key, fallback) { return store.has(key) ? structuredClone(store.get(key)) : fallback; },
      async set(key, value) { store.set(key, structuredClone(value)); },
      async remove(key) { store.delete(key); }
    };
    const { artifact } = await AviaryStorageAuthority.createLibraryBackup(storage, {
      selectedKeys: [...store.keys()]
    });
    return new TextDecoder().decode(artifact.data);
  }, values);
}

async function handleSharedStore(state, control, request) {
  switch (request.operation) {
    case "lock-register":
      return handleLockRegister(state, control, request.request);
    case "fence":
      return handleFence(state, control, request.request);
    case "all":
      return Object.fromEntries([...state].map(([key, value]) => [key, structuredClone(value)]));
    case "list":
      return [...state.keys()];
    case "get": {
      hitLegacyFault(control, request.key, "before");
      const result = state.has(request.key)
        ? { found: true, value: structuredClone(state.get(request.key)) }
        : { found: false };
      hitLegacyFault(control, request.key, "after");
      return result;
    }
    case "set-many":
      return Promise.all(Object.entries(request.values).map(([key, value]) =>
        setSharedValue(state, control, key, value)
      )).then(() => undefined);
    case "set-one":
      return setSharedValue(state, control, request.key, request.value);
    case "remove":
      for (const key of request.keys) removeSharedValue(state, control, key);
      return undefined;
    default:
      throw new Error(`unknown shared-store operation: ${request.operation}`);
  }
}

async function handleLockRegister(state, control, request) {
  const prefix = request?.prefix;
  if (typeof prefix !== "string" || prefix.length === 0) {
    return { ok: false, error: "malformed lock register request" };
  }
  const previous = control.registerChains.get(prefix) ?? Promise.resolve();
  const action = previous.then(async () => {
    const rosterKey = `aviary.lock.v1.roster.${encodeURIComponent(prefix)}`;
    const raw = state.get(rosterKey);
    const entries = new Map(
      Array.isArray(raw?.entries)
        ? raw.entries.filter((entry) => Array.isArray(entry) && entry.length === 2)
        : []
    );
    if (request.operation === "entries") {
      return { ok: true, entries: [...entries.entries()] };
    }
    if (request.operation === "remove") entries.delete(request.key);
    else entries.set(request.key, request.value);
    if (entries.size === 0) state.delete(rosterKey);
    else state.set(rosterKey, { version: 1, prefix, entries: [...entries.entries()] });
    return { ok: true };
  });
  const settled = action.then(() => undefined, () => undefined);
  control.registerChains.set(prefix, settled);
  return action;
}

async function handleFence(state, control, request) {
  const fence = request?.fence;
  if (!fence?.name || !fence.owner) return { ok: false, error: "malformed storage fence" };
  const current = control.fences.get(fence.name);
  if (request.operation === "acquire") {
    if (current && current.expiresAt > Date.now() && current.owner !== fence.owner) {
      return { ok: false, code: "storage-fence-lost", error: "Another owner still holds this storage fence." };
    }
    const next = { ...fence, generation: Math.max(current?.generation ?? 0, fence.generation) + 1 };
    control.fences.set(fence.name, next);
    return { ok: true, result: next };
  }
  if (!current || current.owner !== fence.owner || current.generation !== fence.generation || current.expiresAt <= Date.now()) {
    return { ok: false, code: "storage-fence-lost", error: "The storage lease changed." };
  }
  if (request.operation === "renew") {
    const next = { ...current, expiresAt: fence.expiresAt };
    control.fences.set(fence.name, next);
    return { ok: true, result: next };
  }
  if (request.operation === "release") {
    control.fences.delete(fence.name);
    return { ok: true, result: null };
  }
  if (request.operation === "set") {
    await setSharedValue(state, control, request.key, request.value);
    return { ok: true, result: null };
  }
  if (request.operation === "remove") {
    removeSharedValue(state, control, request.key);
    return { ok: true, result: null };
  }
  return { ok: false, error: "unknown storage fence operation" };
}

async function setSharedValue(state, control, key, value) {
  if (
    control.pause &&
    key === BOOKMARKS_KEY &&
    value?.entries?.[0]?.id === "backup" &&
    !control.pause.used
  ) {
    control.pause.used = true;
    control.pause.enter();
    await control.pause.wait;
    if (control.pause.kind === "rollback") throw new Error("simulated restore failure");
  }
  if (key === SETTINGS_KEY && value?.appearance?.theme === "plum") control.order.push("rollback");
  if (key === SETTINGS_KEY && value?.appearance?.theme === "noir") control.order.push("writer");
  state.set(key, structuredClone(value));
}

function removeSharedValue(state, control, key) {
  if (!key.startsWith(LOCK_PREFIX)) hitLegacyFault(control, key, "before", true);
  state.delete(key);
  if (!key.startsWith(LOCK_PREFIX)) hitLegacyFault(control, key, "after", true);
}

function hitLegacyFault(control, key, position, remove = false) {
  if (control.faultTriggered) return;
  let point;
  if (!remove && key === PENDING_KEY) point = `legacy.get.pending.${position}`;
  if (remove) {
    const label = key === PENDING_KEY ? "pending" : "value";
    point = `legacy.remove.${label}.${position}`;
  }
  if (point && control.faultTarget === point) {
    control.faultTriggered = true;
    throw new Error(`simulated crash at ${point}`);
  }
}

function pauseStoreWrite(control, kind) {
  let enter;
  let release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  control.pause = { kind, entered, wait, enter, release, used: false };
  return control.pause;
}

function pendingLedger(...entries) {
  return { schemaVersion: 2, entries: structuredClone(entries) };
}

function resetSession(session) {
  session.state.clear();
  session.control.faultTarget = null;
  session.control.faultTriggered = false;
  session.control.pause = null;
  session.control.order = [];
  session.control.registerChains.clear();
  session.control.fences.clear();
}

function assertNoLockResidue(session) {
  assert.deepEqual(
    [...session.state.keys()].filter((key) => key.startsWith(LOCK_PREFIX)),
    [],
    `${session.lane.name} left lock registers behind`
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
