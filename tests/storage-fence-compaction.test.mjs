import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

const OP_PREFIX = "aviary.fence.v1.op.";
const KEY = "aviary.profile.p1.accountCleanup.v1";
const FENCE_NAME = "aviary.aviary.accountCleanup.v1";

/** A chrome.storage.local double that records how it was read. */
function extensionArea({ withGetKeys = true } = {}) {
  const values = new Map();
  const calls = { fullReads: 0, keyLists: 0 };
  const area = {
    values,
    calls,
    async get(request) {
      if (request === null || request === undefined) {
        calls.fullReads += 1;
        return structuredClone(Object.fromEntries(values));
      }
      const keys = typeof request === "string" ? [request] : Array.isArray(request) ? request : Object.keys(request);
      return Object.fromEntries(
        keys.filter((key) => values.has(key)).map((key) => [key, structuredClone(values.get(key))])
      );
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    }
  };
  if (withGetKeys) {
    area.getKeys = async () => {
      calls.keyLists += 1;
      return [...values.keys()];
    };
  }
  return area;
}

function fenceRecordCount(values, storageKey = KEY) {
  const prefix = `${OP_PREFIX}${encodeURIComponent(storageKey)}.`;
  return [...values.keys()].filter((key) => key.startsWith(prefix)).length;
}

/** Plants one immutable operation and its receipt, the way an older build left them behind. */
function plantOperation(values, { storageKey = KEY, id, kind, value, generation = 2, committedAt, expiresAt }) {
  const operationKey = `${OP_PREFIX}${encodeURIComponent(storageKey)}.${id}`;
  values.set(operationKey, {
    version: 1,
    operationId: id,
    storageKey,
    kind,
    ...(kind === "set" ? { value } : {}),
    fence: { version: 1, name: FENCE_NAME, owner: `owner-${id}`, generation, expiresAt: expiresAt ?? committedAt + 30_000 }
  });
  values.set(`${operationKey}.receipt`, { version: 1, operationId: id, committedAt });
}

async function withChrome(area, run) {
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: area } };
  try {
    return await run();
  } finally {
    if (previous) globalThis.chrome = previous;
    else delete globalThis.chrome;
  }
}

test("an extension read does not load the whole store to find one key's fenced records", async () => {
  const area = extensionArea();
  // A store the size of a long-lived profile: thousands of records for other keys.
  for (let index = 0; index < 3_000; index += 1) {
    plantOperation(area.values, {
      storageKey: "aviary.profile.p1.diagnostics.v1",
      id: `d${index}`,
      kind: "remove",
      committedAt: 1_000 + index
    });
  }
  area.values.set("aviary.settings.v1", { theme: "dim" });
  await withChrome(area, async () => {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "extension" });
    assert.deepEqual(await gateway.get("aviary.settings.v1", null), { theme: "dim" });
    assert.equal(await gateway.get("aviary.missing.v1", "fallback"), "fallback");
    assert.deepEqual(await gateway.keys(), ["aviary.settings.v1"]);
  });
  assert.equal(area.calls.fullReads, 0, "a single-key read must not deserialize every stored value");
});

test("an extension read still falls back to a full read where getKeys is missing", async () => {
  const area = extensionArea({ withGetKeys: false });
  plantOperation(area.values, { id: "a", kind: "set", value: { run: 1 }, committedAt: 1_000 });
  area.values.set(KEY, { run: 1 });
  await withChrome(area, async () => {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "extension" });
    assert.deepEqual(await gateway.get(KEY, null), { run: 1 });
  });
});

test("the newest commit wins even when an older lease had a higher generation", async () => {
  // Generations restart after every release, so a contended write from last week can carry a
  // higher generation than every write since. Ranking by generation first would pin that value.
  const area = extensionArea();
  plantOperation(area.values, { id: "old", kind: "set", value: "contended", generation: 9, committedAt: 1_000 });
  plantOperation(area.values, { id: "new", kind: "set", value: "latest", generation: 2, committedAt: 5_000 });
  area.values.set(KEY, "latest");
  await withChrome(area, async () => {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "extension" });
    assert.equal(await gateway.get(KEY, null), "latest");
  });
});

async function backgroundFixture(area) {
  const { ExtensionStorageFenceAuthority, compactStorageFenceRecords } = await importSourceModule(
    "src/extension/storage-fence.ts",
    { fresh: true }
  );
  const authority = new ExtensionStorageFenceAuthority(area);
  const fence = await authority.acquire({
    version: 1,
    name: FENCE_NAME,
    owner: "tab-a",
    generation: 1,
    expiresAt: Date.now() + 30_000
  });
  return { authority, fence, compactStorageFenceRecords };
}

test("repeated fenced removes of an absent key leave one record pair, not one per write", async () => {
  const area = extensionArea();
  const { authority, fence } = await backgroundFixture(area);
  for (let index = 0; index < 40; index += 1) {
    const response = await authority.handle({ type: "AVIARY_STORAGE_FENCE", operation: "remove", key: KEY, fence });
    assert.equal(response.ok, true, response.error);
  }
  assert.ok(fenceRecordCount(area.values) <= 2, `expected at most 2 records, found ${fenceRecordCount(area.values)}`);
});

test("repeated fenced sets keep only the record a read still needs", async () => {
  const area = extensionArea();
  const { authority, fence } = await backgroundFixture(area);
  for (let index = 0; index < 40; index += 1) {
    const response = await authority.handle({
      type: "AVIARY_STORAGE_FENCE",
      operation: "set",
      key: KEY,
      value: { step: index },
      fence
    });
    assert.equal(response.ok, true, response.error);
  }
  assert.equal(fenceRecordCount(area.values), 2);
  await withChrome(area, async () => {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "extension" });
    assert.deepEqual(await gateway.get(KEY, null), { step: 39 });
  });
});

test("compaction trims a stored backlog without changing what any read returns", async () => {
  const area = extensionArea();
  const other = "aviary.profile.p1.media.queue.v1";
  const stale = "aviary.profile.p1.userNotes.v1";
  for (let index = 0; index < 500; index += 1) {
    plantOperation(area.values, { id: `r${index}`, kind: "remove", committedAt: 1_000 + index });
  }
  for (let index = 0; index < 200; index += 1) {
    plantOperation(area.values, { storageKey: other, id: `q${index}`, kind: "set", value: { n: index }, committedAt: 1_000 + index });
  }
  area.values.set(other, { n: 199 });
  // A stale owner's late callback materialized its snapshot after the newer commit. Its
  // operation is the evidence that keeps the raw copy from reading as a direct write.
  plantOperation(area.values, { storageKey: stale, id: "s1", kind: "set", value: "newer", committedAt: 2_000 });
  plantOperation(area.values, { storageKey: stale, id: "s0", kind: "set", value: "stale", committedAt: 3_000, expiresAt: 2_500 });
  area.values.set(stale, "stale");
  area.values.set("aviary.downloadTracking.v2", { entries: [] });

  const before = await withChrome(area, async () => {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "extension" });
    return [await gateway.get(KEY, "gone"), await gateway.get(other, null), await gateway.get(stale, null)];
  });
  assert.deepEqual(before, ["gone", { n: 199 }, "newer"]);

  const { compactStorageFenceRecords } = await backgroundFixture(area);
  const removed = await compactStorageFenceRecords(area);
  assert.equal(removed, 499 * 2 + 199 * 2);
  assert.equal(fenceRecordCount(area.values), 2);
  assert.equal(fenceRecordCount(area.values, other), 2);
  assert.equal(fenceRecordCount(area.values, stale), 4, "the late operation still explains the raw copy");
  assert.ok(area.values.has("aviary.downloadTracking.v2"), "unrelated keys are untouched");

  const after = await withChrome(area, async () => {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "extension" });
    return [await gateway.get(KEY, "gone"), await gateway.get(other, null), await gateway.get(stale, null)];
  });
  assert.deepEqual(after, before);
  assert.equal(await compactStorageFenceRecords(area), 0, "a compacted store has nothing left to trim");
});

test("userscript fenced writes stay bounded and still reject a late callback", async () => {
  const values = new Map();
  const previous = {
    GM_getValue: globalThis.GM_getValue,
    GM_setValue: globalThis.GM_setValue,
    GM_deleteValue: globalThis.GM_deleteValue,
    GM_listValues: globalThis.GM_listValues
  };
  let now = 1_000;
  const originalNow = Date.now;
  Date.now = () => now;
  globalThis.GM_getValue = async (key, fallback) => (values.has(key) ? structuredClone(values.get(key)) : fallback);
  globalThis.GM_setValue = async (key, value) => { values.set(key, structuredClone(value)); };
  globalThis.GM_deleteValue = async (key) => { values.delete(key); };
  globalThis.GM_listValues = async () => [...values.keys()];
  try {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "userscript" });
    const fence = { version: 1, name: FENCE_NAME, owner: "tab-a", generation: 2, expiresAt: 1_300 };
    for (let index = 0; index < 30; index += 1) {
      await gateway.set(KEY, { step: index }, fence);
      await gateway.remove(KEY, fence);
    }
    assert.ok(fenceRecordCount(values) <= 2, `expected at most 2 records, found ${fenceRecordCount(values)}`);

    await gateway.set(KEY, { step: "kept" }, fence);
    now = 1_400;
    const newer = { ...fence, owner: "tab-b", generation: 2, expiresAt: 1_700 };
    await gateway.set(KEY, { step: "newer" }, newer);
    // The first tab wakes after its lease and finishes an old write.
    await gateway.set(KEY, { step: "stale" }, fence);
    assert.deepEqual(await gateway.get(KEY, null), { step: "newer" });
    assert.ok(fenceRecordCount(values) <= 4);
  } finally {
    Date.now = originalNow;
    for (const [name, value] of Object.entries(previous)) {
      if (value) globalThis[name] = value;
      else delete globalThis[name];
    }
  }
});

test("a userscript read clears a backlog left by an older build", async () => {
  const values = new Map();
  const previous = {
    GM_getValue: globalThis.GM_getValue,
    GM_setValue: globalThis.GM_setValue,
    GM_deleteValue: globalThis.GM_deleteValue,
    GM_listValues: globalThis.GM_listValues
  };
  globalThis.GM_getValue = async (key, fallback) => (values.has(key) ? structuredClone(values.get(key)) : fallback);
  globalThis.GM_setValue = async (key, value) => { values.set(key, structuredClone(value)); };
  globalThis.GM_deleteValue = async (key) => { values.delete(key); };
  globalThis.GM_listValues = async () => [...values.keys()];
  try {
    for (let index = 0; index < 300; index += 1) {
      plantOperation(values, { id: `r${index}`, kind: "remove", committedAt: 1_000 + index });
    }
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "userscript" });
    assert.equal(await gateway.get(KEY, "gone"), "gone");
    assert.equal(fenceRecordCount(values), 2);
    assert.equal(await gateway.get(KEY, "gone"), "gone");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value) globalThis[name] = value;
      else delete globalThis[name];
    }
  }
});
