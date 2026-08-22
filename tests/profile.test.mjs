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
  // Awaited rather than read straight off status(). The legacy sweep is 28 storage reads whose
  // only consumer is one optional panel row, so load() starts it and does not wait for it; a
  // caller that needs the answer now asks for it.
  assert.equal(await manager.legacyDataSettled(), true);

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
  // adoptLegacyIntoActive does wait for its own re-sweep, so this one is settled already.
  assert.equal(manager.status().legacyDataAvailable, false);
  assert.equal(await manager.legacyDataSettled(), false);
  assert.ok(PROFILE_MIGRATION_KEYS.includes("aviary.settings.v1"));
});

/**
 * Boot does not wait for a question only the panel asks.
 *
 * `load()` is awaited by main.ts before any feature initializes, and it used to end with a walk of
 * all 28 legacy keys, one await at a time. Twenty-five of those are durable keys, so each was a
 * separate IndexedDB transaction. On a fresh install none of them hit, so the whole walk always
 * ran to completion -- to decide whether to offer one row in a panel most sessions never open.
 */
test("loading a profile does not walk the legacy keys before boot continues", async () => {
  const { ProfileManager, PROFILE_MIGRATION_KEYS } = await importSourceModule(
    "src/platform/profile.ts"
  );

  const store = new Map();
  let reads = 0;
  const base = {
    async get(key, fallback) {
      reads += 1;
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const manager = new ProfileManager(base);
  await manager.load();
  const duringBoot = reads;

  assert.ok(
    duringBoot < PROFILE_MIGRATION_KEYS.length,
    `boot read ${duringBoot} keys; the legacy walk alone is ${PROFILE_MIGRATION_KEYS.length}`
  );
  assert.ok(duringBoot <= 4, `boot should read a small constant number of keys, read ${duringBoot}`);

  // The answer still arrives, and the walk still happens -- just not on the path features wait on.
  assert.equal(await manager.legacyDataSettled(), false);
  assert.ok(
    reads >= duringBoot + PROFILE_MIGRATION_KEYS.length,
    "the sweep must still cover every migration key"
  );
});
