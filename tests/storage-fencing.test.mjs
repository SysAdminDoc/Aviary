import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

function managerStore() {
  const values = new Map();
  return {
    values,
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    },
    async list() {
      return [...values.keys()];
    }
  };
}

test("userscript fenced writes keep a newer operation after an expired callback resumes", async () => {
  const store = managerStore();
  const previous = {
    GM_getValue: globalThis.GM_getValue,
    GM_setValue: globalThis.GM_setValue,
    GM_deleteValue: globalThis.GM_deleteValue,
    GM_listValues: globalThis.GM_listValues
  };
  let now = 1_000;
  const originalNow = Date.now;
  Date.now = () => now;
  globalThis.GM_getValue = store.get;
  globalThis.GM_setValue = store.set;
  globalThis.GM_deleteValue = store.remove;
  globalThis.GM_listValues = store.list;
  try {
    const { createStorageGateway } = await importSourceModule("src/platform/storage.ts", { fresh: true });
    const gateway = createStorageGateway("aviary", { mode: "userscript" });
    const oldFence = {
      version: 1,
      name: "aviary.aviary.userNotes.v1",
      owner: "old-owner",
      generation: 1,
      expiresAt: 1_300
    };
    await gateway.set("aviary.userNotes.v1", { value: "before takeover" }, oldFence);

    now = 1_400;
    const newFence = {
      ...oldFence,
      owner: "new-owner",
      generation: 2,
      expiresAt: 1_700
    };
    await gateway.set("aviary.userNotes.v1", { value: "newer commit" }, newFence);

    // This is the delayed callback. Its receipt is timestamped after its lease, so the immutable
    // operation is retained for forensics but cannot become the materialized value on read.
    await gateway.set("aviary.userNotes.v1", { value: "stale callback" }, oldFence);
    assert.deepEqual(
      await gateway.get("aviary.userNotes.v1", { value: "missing" }),
      { value: "newer commit" }
    );
  } finally {
    Date.now = originalNow;
    if (previous.GM_getValue) globalThis.GM_getValue = previous.GM_getValue;
    else delete globalThis.GM_getValue;
    if (previous.GM_setValue) globalThis.GM_setValue = previous.GM_setValue;
    else delete globalThis.GM_setValue;
    if (previous.GM_deleteValue) globalThis.GM_deleteValue = previous.GM_deleteValue;
    else delete globalThis.GM_deleteValue;
    if (previous.GM_listValues) globalThis.GM_listValues = previous.GM_listValues;
    else delete globalThis.GM_listValues;
  }
});

test("extension authority rejects an old generation after takeover, including after restart", async () => {
  const store = managerStore();
  const previousChrome = globalThis.chrome;
  const storage = {
    async get(key) {
      return store.values.has(key) ? { [key]: structuredClone(store.values.get(key)) } : {};
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) store.values.set(key, structuredClone(value));
    },
    async remove(key) {
      store.values.delete(key);
    }
  };
  globalThis.chrome = { storage: { local: storage } };
  let now = 1_000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    const { ExtensionStorageFenceAuthority } = await importSourceModule(
      "src/extension/storage-fence.ts",
      { fresh: true }
    );
    const first = new ExtensionStorageFenceAuthority(storage);
    const oldFence = await first.acquire({
      version: 1,
      name: "aviary.aviary.userNotes.v1",
      owner: "old-owner",
      generation: 1,
      expiresAt: 1_300
    });
    now = 1_400;
    const newFence = await first.acquire({
      version: 1,
      name: oldFence.name,
      owner: "new-owner",
      generation: 1,
      expiresAt: 1_700
    });
    assert.ok(newFence.generation > oldFence.generation);

    await assert.rejects(
      first.mutate(oldFence, async () => {
        await storage.set({ "aviary.userNotes.v1": "stale" });
      }),
      /expired|fence/i
    );
    await first.mutate(newFence, () => storage.set({ "aviary.userNotes.v1": "newer" }));
    assert.equal(store.values.get("aviary.userNotes.v1"), "newer");

    // A fresh service-worker instance still reads the persisted generation and rejects the old
    // message. The authority cannot regress merely because its in-memory map was lost.
    const afterRestart = new ExtensionStorageFenceAuthority(storage);
    await assert.rejects(
      afterRestart.mutate(oldFence, () => storage.set({ "aviary.userNotes.v1": "stale again" })),
      /expired|fence/i
    );
    assert.equal(store.values.get("aviary.userNotes.v1"), "newer");
  } finally {
    Date.now = originalNow;
    if (previousChrome) globalThis.chrome = previousChrome;
    else delete globalThis.chrome;
  }
});

test("extension authority cannot commit a paused old owner after a fresh authority takes over", async () => {
  const store = managerStore();
  const storage = {
    async get(key) {
      return store.values.has(key) ? { [key]: structuredClone(store.values.get(key)) } : {};
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) store.values.set(key, structuredClone(value));
    },
    async remove(key) {
      store.values.delete(key);
    }
  };
  const previousChrome = globalThis.chrome;
  const originalNow = Date.now;
  let now = 2_000;
  Date.now = () => now;
  globalThis.chrome = { storage: { local: storage } };
  try {
    const { ExtensionStorageFenceAuthority } = await importSourceModule(
      "src/extension/storage-fence.ts",
      { fresh: true }
    );
    const oldAuthority = new ExtensionStorageFenceAuthority(storage);
    const oldFence = await oldAuthority.acquire({
      version: 1,
      name: "aviary.aviary.userNotes.v1",
      owner: "paused-owner",
      generation: 1,
      expiresAt: 2_300
    });
    let release;
    const paused = oldAuthority.mutate(oldFence, async () => {
      await new Promise((resolve) => { release = resolve; });
      await storage.set({ "aviary.userNotes.v1": "stale" });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 2_400;
    const freshAuthority = new ExtensionStorageFenceAuthority(storage);
    const newFence = await freshAuthority.acquire({
      ...oldFence,
      owner: "replacement-owner",
      generation: 1,
      expiresAt: 2_700
    });
    assert.ok(newFence.generation > oldFence.generation);
    release();
    await assert.rejects(paused, /changed|expired|fence/i);
  } finally {
    Date.now = originalNow;
    if (previousChrome) globalThis.chrome = previousChrome;
    else delete globalThis.chrome;
  }
});
