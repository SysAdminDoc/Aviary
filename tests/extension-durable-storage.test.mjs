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

test("userscript mode never falls through to page storage and refuses an oversized value explicitly", async () => {
  rememberGlobal("GM_getValue");
  rememberGlobal("GM_setValue");
  rememberGlobal("GM_deleteValue");
  rememberGlobal("chrome");
  rememberGlobal("localStorage");

  const manager = new Map();
  let pageWrites = 0;
  globalThis.GM_getValue = (key, fallback) => manager.has(key) ? manager.get(key) : fallback;
  globalThis.GM_setValue = (key, value) => { manager.set(key, structuredClone(value)); };
  globalThis.GM_deleteValue = (key) => { manager.delete(key); };
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
  delete globalThis.GM_getValue;
  delete globalThis.GM_setValue;
  delete globalThis.GM_deleteValue;

  const { createStorageGateway } = await importSourceModule("src/platform/storage.ts");
  assert.throws(
    () => createStorageGateway("aviary", { mode: "userscript" }),
    /manager did not expose its storage API/i
  );
});

class MemoryBackend {
  values = new Map();
  meta = undefined;

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

  async estimate() {
    return { usage: this.values.size * 128, quota: 1024 * 1024 };
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
    }
  };
}

function rememberGlobal(name) {
  if (!savedGlobals.has(name)) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
}
