import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("profile storage isolates values and adopts legacy data only explicitly", async () => {
  const {
    ProfileManager,
    PROFILE_MIGRATION_KEYS,
    createProfileStorageGateway
  } = await importSourceModule("src/platform/profile.ts");
  const store = new Map([["aviary.settings.v1", { legacy: true }]]);
  const base = {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const manager = new ProfileManager(base);
  await manager.load();
  assert.equal(manager.status().activeId, "offline-default");
  assert.equal(manager.status().legacyDataAvailable, true);

  const first = createProfileStorageGateway(base, manager.activeId);
  await first.set("aviary.settings.v1", { first: true });
  const secondProfile = await manager.create("Second account", "x-account");
  const second = createProfileStorageGateway(base, secondProfile.id);
  assert.deepEqual(await second.get("aviary.settings.v1", null), null);
  assert.deepEqual(await first.get("aviary.settings.v1", null), { first: true });

  assert.deepEqual(await manager.adoptLegacyIntoActive(), { moved: 0, skipped: 1 });
  assert.equal(store.has("aviary.settings.v1"), true, "existing profile data must not consume legacy data");

  await manager.switchTo(secondProfile.id);
  assert.deepEqual(await manager.adoptLegacyIntoActive(), { moved: 1, skipped: 0 });
  assert.equal(store.has("aviary.settings.v1"), false);
  assert.deepEqual(await second.get("aviary.settings.v1", null), { legacy: true });
  assert.equal(manager.status().legacyDataAvailable, false);
  assert.ok(PROFILE_MIGRATION_KEYS.includes("aviary.settings.v1"));
});
