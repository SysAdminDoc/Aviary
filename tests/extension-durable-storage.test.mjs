import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { importSourceEntry, importSourceModule } from "./helpers/source-import.mjs";

const savedGlobals = new Map();

afterEach(() => {
  for (const [name, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  savedGlobals.clear();
});

test("content and options share one background profile across a worker restart", async () => {
  const {
    DURABLE_STORAGE_MESSAGE,
    ExtensionDurableStorageBackend,
    handleDurableStorageRequest
  } = await importSourceModule("src/extension/durable-storage-api.ts");
  const backend = new MemoryBackend();
  const connect = () =>
    new ExtensionDurableStorageBackend((message) => {
      assert.equal(message.type, DURABLE_STORAGE_MESSAGE);
      return handleDurableStorageRequest(message, backend);
    });

  const content = connect();
  await content.put("aviary.profiles.v1", {
    profiles: [{ id: "account-a", label: "Account A", kind: "x-account" }]
  });
  await content.put("aviary.profile.active.v1", "account-a");
  await content.put("aviary.profile.account-a.settings.v1", {
    i18n: { locale: "ja" },
    media: { buttons: true }
  });

  const options = connect();
  assert.equal(await options.get("aviary.profile.active.v1"), "account-a");
  assert.deepEqual(await options.get("aviary.profile.account-a.settings.v1"), {
    i18n: { locale: "ja" },
    media: { buttons: true }
  });

  // A new client and handler represent a service worker with no retained module state. The
  // background database is the only shared authority and must still answer identically.
  const afterRestart = connect();
  assert.equal(await afterRestart.get("aviary.profile.active.v1"), "account-a");
  await afterRestart.put("aviary.profile.account-a.userNotes.v1", { alice: "kept" });
  assert.deepEqual(
    await content.get("aviary.profile.account-a.userNotes.v1"),
    { alice: "kept" }
  );
});

test("the runtime estimate keeps true, false, and unavailable persistence across the bridge", async () => {
  const api = await importSourceModule("src/extension/durable-storage-api.ts");
  for (const persisted of [true, false, undefined]) {
    const backend = new MemoryBackend();
    backend.persisted = persisted;
    const client = new api.ExtensionDurableStorageBackend((message) =>
      api.handleDurableStorageRequest(message, backend)
    );
    const estimate = await client.estimate();
    assert.deepEqual(
      estimate,
      persisted === undefined
        ? { usage: 0, quota: 1024 * 1024 }
        : { usage: 0, quota: 1024 * 1024, persisted },
      `persisted=${persisted} must cross the background bridge without coercion`
    );
  }
});

test("the background protocol stages and atomically commits fallback values and tombstones", async () => {
  const api = await importSourceModule("src/extension/durable-storage-api.ts");
  const backend = new MemoryBackend();
  const client = new api.ExtensionDurableStorageBackend((message) =>
    api.handleDurableStorageRequest(message, backend)
  );
  const put = {
    id: "put-operation",
    key: "aviary.userNotes.v1",
    kind: "put",
    value: { alice: "latest" }
  };

  await client.stagePendingWrite(put);
  assert.equal(backend.pending.has(put.key), true, "staging must survive a worker interruption");
  const putReceipt = await client.commitPendingWrite(put);
  assert.deepEqual(backend.values.get(put.key), put.value);
  assert.equal(backend.pending.has(put.key), false, "commit must consume its marker");
  assert.equal(putReceipt.id, put.id);
  assert.match(putReceipt.valueHash, /^[0-9a-f]{64}$/);

  const remove = { id: "remove-operation", key: put.key, kind: "remove" };
  await client.stagePendingWrite(remove);
  assert.deepEqual(await client.commitPendingWrite(remove), {
    id: remove.id,
    key: remove.key,
    kind: "remove",
    valueHash: null
  });
  assert.equal(backend.values.has(put.key), false);
  assert.equal(backend.pending.has(put.key), false);
  assert.equal(
    api.isDurableStorageRequest({
      type: api.DURABLE_STORAGE_MESSAGE,
      operation: "stage-pending",
      write: { id: "bad id with spaces", key: put.key, kind: "remove" }
    }),
    false,
    "malformed operation ids must not reach the background transaction"
  );
});

test("host migration refuses a bad receipt and returns readback hashes for every copied key", async () => {
  const api = await importSourceEntry([
    "src/extension/durable-storage-api.ts",
    "src/platform/storage-value-hash.ts"
  ]);
  const backend = new MemoryBackend();
  const settings = { schemaVersion: 8, media: { buttons: true } };
  const settingsHash = await api.hashStorageValue(settings);

  const copied = await api.handleDurableStorageRequest(
    {
      type: api.DURABLE_STORAGE_MESSAGE,
      operation: "migrate-host",
      entries: [
        { key: "aviary.profile.active.v1", value: "account-a", hash: await api.hashStorageValue("account-a") },
        { key: "aviary.profile.account-a.settings.v1", value: settings, hash: settingsHash }
      ]
    },
    backend
  );

  assert.equal(copied.ok, true);
  assert.deepEqual(copied.result.hashes, {
    "aviary.profile.active.v1": await api.hashStorageValue("account-a"),
    "aviary.profile.account-a.settings.v1": settingsHash
  });
  assert.deepEqual(backend.values.get("aviary.profile.account-a.settings.v1"), settings);

  const refused = await api.handleDurableStorageRequest(
    {
      type: api.DURABLE_STORAGE_MESSAGE,
      operation: "migrate-host",
      entries: [{ key: "aviary.userNotes.v1", value: { secret: "unchanged" }, hash: "0".repeat(64) }]
    },
    backend
  );
  assert.equal(refused.ok, false);
  assert.match(refused.error, /hash mismatch/i);
  assert.equal(backend.values.has("aviary.userNotes.v1"), false);
});

test("legacy values remain recoverable when durable readback does not match", async () => {
  const { createDurableStorageGateway } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );
  const legacy = memoryStorage({ "aviary.userNotes.v1": { alice: "source" } });
  const backend = new CorruptingBackend();
  const storage = createDurableStorageGateway(legacy, { backend });

  const status = await storage.initialize(["aviary.userNotes.v1"]);

  assert.equal(status.backend, "indexeddb-fallback");
  assert.deepEqual(legacy.values.get("aviary.userNotes.v1"), { alice: "source" });
  assert.deepEqual(backend.values.get("aviary.userNotes.v1"), { corrupted: true });
  assert.match(status.lastError, /hash mismatch/i);
});

test("legacy migration discovers inactive profile keys instead of relying on the base allow-list", async () => {
  const { createDurableStorageGateway } = await importSourceModule(
    "src/platform/durable-storage.ts"
  );
  const dynamicKey = "aviary.profile.inactive-account.userNotes.v1";
  const legacy = memoryStorage({ [dynamicKey]: { alice: "inactive profile note" } });
  const backend = new MemoryBackend();
  const storage = createDurableStorageGateway(legacy, { backend });

  const status = await storage.initialize([]);

  assert.equal(status.backend, "indexeddb");
  assert.deepEqual(backend.values.get(dynamicKey), { alice: "inactive profile note" });
  assert.equal(legacy.values.has(dynamicKey), false, "the verified dynamic source was not removed");
});

test("userscript mode never falls through to page storage and refuses an oversized value explicitly", async () => {
  rememberGlobal("GM_getValue");
  rememberGlobal("GM_setValue");
  rememberGlobal("GM_deleteValue");
  rememberGlobal("GM_listValues");
  rememberGlobal("chrome");
  rememberGlobal("localStorage");

  const manager = new Map();
  let pageWrites = 0;
  globalThis.GM_getValue = (key, fallback) => manager.has(key) ? manager.get(key) : fallback;
  globalThis.GM_setValue = (key, value) => { manager.set(key, structuredClone(value)); };
  globalThis.GM_deleteValue = (key) => { manager.delete(key); };
  globalThis.GM_listValues = () => [...manager.keys()];
  globalThis.chrome = {
    storage: { local: { async get() { return {}; }, async set() { pageWrites += 1; }, async remove() {} } }
  };
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() { pageWrites += 1; },
    removeItem() {}
  };

  const {
    createStorageGateway,
    UserscriptStorageCapacityError
  } = await importSourceModule("src/platform/storage.ts");
  const storage = createStorageGateway("aviary", {
    mode: "userscript",
    userscriptValueLimitBytes: 64
  });

  await storage.set("settings.v1", { compact: true });
  assert.deepEqual(manager.get("aviary.settings.v1"), { compact: true });
  await assert.rejects(
    storage.set("archive.v1", { bytes: "x".repeat(128) }),
    (error) => {
      assert.ok(error instanceof UserscriptStorageCapacityError);
      assert.equal(error.code, "userscript-storage-capacity");
      assert.ok(error.measuredBytes > error.limitBytes);
      assert.match(error.message, /userscript manager refused/i);
      return true;
    }
  );
  assert.equal(manager.has("aviary.archive.v1"), false);
  assert.equal(pageWrites, 0, "manager mode must not touch chrome.storage or localStorage");
});

test("userscript mode fails closed when its manager storage grant is missing", async () => {
  rememberGlobal("GM_getValue");
  rememberGlobal("GM_setValue");
  rememberGlobal("GM_deleteValue");
  rememberGlobal("GM_listValues");
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_deleteValue;
  delete globalThis.GM_listValues;

  const { createStorageGateway } = await importSourceModule("src/platform/storage.ts");
  assert.throws(
    () => createStorageGateway("aviary", { mode: "userscript" }),
    /manager did not expose its storage API/i
  );
});

class MemoryBackend {
  values = new Map();
  pending = new Map();
  meta = undefined;
  persisted = undefined;

  async get(key) {
    return this.values.has(key) ? structuredClone(this.values.get(key)) : undefined;
  }

  async put(key, value) {
    this.values.set(key, structuredClone(value));
  }

  async remove(key) {
    this.values.delete(key);
  }

  async getMeta() {
    return this.meta ? structuredClone(this.meta) : undefined;
  }

  async putMany(entries, meta) {
    for (const [key, value] of entries) this.values.set(key, structuredClone(value));
    this.meta = structuredClone(meta);
    this.values.set("__aviary_meta__", structuredClone(meta));
  }

  async stagePendingWrite(write) {
    this.pending.set(write.key, structuredClone(write));
  }

  async commitPendingWrite(expected) {
    const write = this.pending.get(expected.key);
    if (!write || write.id !== expected.id) throw new Error("pending marker mismatch");
    if (write.kind === "put") this.values.set(write.key, structuredClone(write.value));
    else this.values.delete(write.key);
    this.pending.delete(write.key);
    const { hashStorageValue } = await importSourceModule("src/platform/storage-value-hash.ts");
    return {
      id: write.id,
      key: write.key,
      kind: write.kind,
      valueHash: write.kind === "put" ? await hashStorageValue(write.value) : null
    };
  }

  async estimate() {
    return {
      usage: this.values.size * 128,
      quota: 1024 * 1024,
      ...(typeof this.persisted === "boolean" ? { persisted: this.persisted } : {})
    };
  }
}

class CorruptingBackend extends MemoryBackend {
  async putMany(entries, meta) {
    await super.putMany(entries, meta);
    for (const [key] of entries) this.values.set(key, { corrupted: true });
  }
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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
    async keys() {
      return [...values.keys()];
    }
  };
}

function rememberGlobal(name) {
  if (!savedGlobals.has(name)) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
}
