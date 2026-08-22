import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("library backup redacts credentials, preserves binary values, and supports dry-run", async () => {
  const {
    createLibraryBackup,
    parseLibraryBackup,
    previewLibraryRestore,
    restoreLibraryBackup
  } = await importSourceModule("src/features/core/library-backup.ts");
  const SETTINGS_KEY = "aviary.settings.v1";
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
  const MEDIA_QUEUE_KEY = "aviary.media.queue.v1";
  const { normalizeSettings } = await importSourceModule("src/platform/settings.ts");
  const settings = normalizeSettings({
    appearance: { theme: "midnight" },
    filter: {
      rules: ["[Weekend] dim for 7d from 2026-08-19T10:00:00.000Z: text contains sale"]
    },
    integrations: { ai: { apiKey: "do-not-export-this" } }
  });
  const store = new Map([
    [SETTINGS_KEY, settings],
    [BOOKMARKS_KEY, { entries: [{ id: "bm-1", text: "saved" }] }],
    [MEDIA_QUEUE_KEY, { sequence: 1, jobs: [{ id: "job-1", bytes: new Uint8Array([0, 1, 255]) }] }]
  ]);
  const storage = storageFrom(store);

  const { artifact } = await createLibraryBackup(storage, {
    selectedKeys: [SETTINGS_KEY, BOOKMARKS_KEY, MEDIA_QUEUE_KEY],
    profile: { id: "offline-1", label: "Offline library" },
    createdAt: "2026-08-12T12:00:00.000Z"
  });
  const text = new TextDecoder().decode(artifact.data);
  assert.equal(text.includes("do-not-export-this"), false);
  const backup = parseLibraryBackup(text);
  assert.equal(backup.includeCredentials, false);
  assert.equal(backup.profile?.id, "offline-1");
  assert.deepEqual(
    [...backup.collections.find((collection) => collection.key === MEDIA_QUEUE_KEY).value.jobs[0].bytes],
    [0, 1, 255]
  );

  store.set(BOOKMARKS_KEY, { entries: [{ id: "bm-2", text: "newer" }] });
  const preview = await previewLibraryRestore(storage, text, { profileId: "offline-1" });
  assert.equal(preview.credentialsRedacted, true);
  assert.ok(preview.conflictCount >= 2);

  const beforeDryRun = JSON.stringify(store.get(BOOKMARKS_KEY));
  const dryRun = await restoreLibraryBackup(storage, text, { dryRun: true, profileId: "offline-1" });
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.dryRun, true);
  assert.equal(JSON.stringify(store.get(BOOKMARKS_KEY)), beforeDryRun);

  const restored = await restoreLibraryBackup(storage, text, { profileId: "offline-1" });
  assert.equal(restored.applied, true);
  assert.equal(store.get(BOOKMARKS_KEY).entries[0].id, "bm-1");
  assert.equal(store.get(SETTINGS_KEY).integrations.ai.apiKey, "do-not-export-this");
  assert.deepEqual(store.get(SETTINGS_KEY).filter.rules, settings.filter.rules);
});

test("library backup rejects tampering and rolls back a failed collection write", async () => {
  const {
    createLibraryBackup,
    restoreLibraryBackup
  } = await importSourceModule("src/features/core/library-backup.ts");
  const SETTINGS_KEY = "aviary.settings.v1";
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
  const { normalizeSettings } = await importSourceModule("src/platform/settings.ts");
  const settings = normalizeSettings({ appearance: { theme: "dim" } });
  const source = storageFrom(new Map([
    [SETTINGS_KEY, settings],
    [BOOKMARKS_KEY, { entries: [{ id: "backup", text: "backup" }] }]
  ]));
  const { artifact } = await createLibraryBackup(source, {
    selectedKeys: [SETTINGS_KEY, BOOKMARKS_KEY],
    createdAt: "2026-08-12T13:00:00.000Z"
  });
  const tampered = new TextDecoder().decode(artifact.data).replace('"text": "backup"', '"text": "tampered"');
  await assert.rejects(() => importSourceModule("src/features/core/library-backup.ts").then(({ parseLibraryBackup }) => parseLibraryBackup(tampered)), /checksum/i);

  let failOnce = true;
  const currentSettings = normalizeSettings({ appearance: { theme: "plum" } });
  const currentBookmarks = { entries: [{ id: "current", text: "keep" }] };
  const target = storageFrom(
    new Map([
      [SETTINGS_KEY, currentSettings],
      [BOOKMARKS_KEY, currentBookmarks]
    ]),
    {
      async set(key, value) {
        if (key === BOOKMARKS_KEY && failOnce) {
          failOnce = false;
          throw new Error("simulated quota failure");
        }
        this.store.set(key, value);
      }
    }
  );
  const result = await restoreLibraryBackup(target, new TextDecoder().decode(artifact.data));
  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, true);
  assert.match(result.errors[0], /simulated quota failure/);
  assert.equal(target.store.get(SETTINGS_KEY).appearance.theme, "plum");
  assert.equal(target.store.get(BOOKMARKS_KEY).entries[0].id, "current");
});

test("library backup cancellation performs no writes", async () => {
  const { createLibraryBackup, restoreLibraryBackup } = await importSourceModule("src/features/core/library-backup.ts");
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
  const source = storageFrom(new Map([[BOOKMARKS_KEY, { entries: [{ id: "one" }] }]]));
  const { artifact } = await createLibraryBackup(source, { selectedKeys: [BOOKMARKS_KEY] });
  const target = storageFrom(new Map([[BOOKMARKS_KEY, { entries: [{ id: "current" }] }]]));
  const controller = new AbortController();
  controller.abort();
  const result = await restoreLibraryBackup(target, new TextDecoder().decode(artifact.data), {
    signal: controller.signal
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.applied, false);
  assert.equal(target.store.get(BOOKMARKS_KEY).entries[0].id, "current");
});

function storageFrom(store, overrides = {}) {
  const storage = {
    store,
    async get(key, fallback) {
      return this.store.has(key) ? this.store.get(key) : fallback;
    },
    async set(key, value) {
      this.store.set(key, value);
    },
    async remove(key) {
      this.store.delete(key);
    },
    ...overrides
  };
  return storage;
}
