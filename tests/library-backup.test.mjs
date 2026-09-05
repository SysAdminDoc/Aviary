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

test("a queued writer waits for restore commit and remains authoritative afterward", async () => {
  const { createLibraryBackup, restoreLibraryBackup } = await importSourceModule(
    "src/features/core/library-backup.ts"
  );
  const { replaceStored } = await importSourceModule("src/platform/storage-lock.ts");
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
  const source = storageFrom(new Map([
    [BOOKMARKS_KEY, { entries: [{ id: "backup", text: "restored" }] }]
  ]));
  const { artifact } = await createLibraryBackup(source, { selectedKeys: [BOOKMARKS_KEY] });
  const restoreEntered = deferred();
  const releaseRestore = deferred();
  const order = [];
  const target = storageFrom(
    new Map([[BOOKMARKS_KEY, { entries: [{ id: "before", text: "preflight" }] }]]),
    {
      async set(key, value) {
        if (key === BOOKMARKS_KEY && value.entries?.[0]?.id === "backup") {
          order.push("restore-write");
          restoreEntered.resolve();
          await releaseRestore.promise;
        }
        this.store.set(key, structuredClone(value));
      }
    }
  );

  const restoring = restoreLibraryBackup(target, new TextDecoder().decode(artifact.data)).then(
    (result) => {
      order.push("restore-done");
      return result;
    }
  );
  await restoreEntered.promise;
  let writerSettled = false;
  const writer = replaceStored(target, BOOKMARKS_KEY, {
    entries: [{ id: "writer", text: "saved after restore" }]
  }).then(() => {
    writerSettled = true;
    order.push("writer-done");
  });
  await Promise.resolve();
  assert.equal(writerSettled, false, "the queued writer ran inside the restore transaction");

  releaseRestore.resolve();
  assert.equal((await restoring).applied, true);
  await writer;
  assert.equal(target.store.get(BOOKMARKS_KEY).entries[0].id, "writer");
  assert.deepEqual(order, ["restore-write", "restore-done", "writer-done"]);
});

test("rollback restores its preflight snapshot before a later queued write proceeds", async () => {
  const { createLibraryBackup, restoreLibraryBackup } = await importSourceModule(
    "src/features/core/library-backup.ts"
  );
  const { replaceStored } = await importSourceModule("src/platform/storage-lock.ts");
  const { normalizeSettings } = await importSourceModule("src/platform/settings.ts");
  const SETTINGS_KEY = "aviary.settings.v1";
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
  const source = storageFrom(new Map([
    [SETTINGS_KEY, normalizeSettings({ appearance: { theme: "dim" } })],
    [BOOKMARKS_KEY, { entries: [{ id: "backup" }] }]
  ]));
  const { artifact } = await createLibraryBackup(source, {
    selectedKeys: [SETTINGS_KEY, BOOKMARKS_KEY]
  });
  const currentSettings = normalizeSettings({ appearance: { theme: "plum" } });
  const writerSettings = normalizeSettings({ appearance: { theme: "noir" } });
  const failureEntered = deferred();
  const releaseFailure = deferred();
  const order = [];
  let failBackupOnce = true;
  const target = storageFrom(
    new Map([
      [SETTINGS_KEY, currentSettings],
      [BOOKMARKS_KEY, { entries: [{ id: "current" }] }]
    ]),
    {
      async set(key, value) {
        if (key === BOOKMARKS_KEY && value.entries?.[0]?.id === "backup" && failBackupOnce) {
          failBackupOnce = false;
          failureEntered.resolve();
          await releaseFailure.promise;
          throw new Error("simulated restore failure");
        }
        if (key === SETTINGS_KEY && value.appearance?.theme === "plum") order.push("rollback");
        if (key === SETTINGS_KEY && value.appearance?.theme === "noir") order.push("writer");
        this.store.set(key, structuredClone(value));
      }
    }
  );

  const restoring = restoreLibraryBackup(target, new TextDecoder().decode(artifact.data));
  await failureEntered.promise;
  let writerSettled = false;
  const writer = replaceStored(target, SETTINGS_KEY, writerSettings).then(() => {
    writerSettled = true;
  });
  await Promise.resolve();
  assert.equal(writerSettled, false, "the queued writer bypassed a rollback in progress");

  releaseFailure.resolve();
  const result = await restoring;
  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, true);
  await writer;
  assert.equal(target.store.get(SETTINGS_KEY).appearance.theme, "noir");
  assert.equal(target.store.get(BOOKMARKS_KEY).entries[0].id, "current");
  assert.deepEqual(order, ["rollback", "writer"]);
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

function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/**
 * A backup that carries the whole install, not the profile that happened to be open.
 *
 * createLibraryBackup used to be handed the profile-scoped gateway, so it read exactly one
 * profile and its allow-list omitted the profile roster entirely. Restoring that on a fresh
 * browser produced an install holding one profile's data with no record the others existed,
 * and nothing said so.
 */
test("a backup of three profiles restores all three, their collections, and the active pointer", async () => {
  const {
    createLibraryBackup,
    parseLibraryBackup,
    previewLibraryRestore,
    restoreLibraryBackup
  } = await importSourceModule("src/features/core/library-backup.ts");
  const { PROFILE_REGISTRY_KEY, ACTIVE_PROFILE_KEY } =
    await importSourceModule("src/platform/profile.ts");
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";
  const NOTES_KEY = "aviary.userNotes.v1";

  const profiles = [
    { id: "work", label: "Work" },
    { id: "personal", label: "Personal" },
    { id: "archive", label: "Archive" }
  ];
  const store = new Map([
    [PROFILE_REGISTRY_KEY, { profiles: profiles.map((entry) => ({ ...entry, kind: "offline" })) }],
    [ACTIVE_PROFILE_KEY, "personal"],
    ["aviary.profile.work.library.bookmarks.v1", { entries: [{ id: "w1", text: "work" }] }],
    ["aviary.profile.personal.library.bookmarks.v1", { entries: [{ id: "p1", text: "personal" }] }],
    ["aviary.profile.archive.userNotes.v1", { entries: [{ id: "a1", text: "archive note" }] }]
  ]);
  const storage = storageFrom(store);

  const { artifact } = await createLibraryBackup(storage, {
    profiles,
    activeProfileId: "personal",
    profile: { id: "personal", label: "Personal" },
    selectedKeys: [BOOKMARKS_KEY, NOTES_KEY, PROFILE_REGISTRY_KEY, ACTIVE_PROFILE_KEY],
    createdAt: "2026-09-05T00:00:00.000Z"
  });
  const text = new TextDecoder().decode(artifact.data);
  const backup = parseLibraryBackup(text);

  assert.deepEqual(
    backup.profiles.map((entry) => entry.id).sort(),
    ["archive", "personal", "work"],
    "the backup must name every profile it carries"
  );
  assert.equal(backup.activeProfileId, "personal");
  assert.ok(
    backup.collections.some(
      (entry) => entry.key === PROFILE_REGISTRY_KEY && entry.profileId === null && entry.present
    ),
    "the profile roster must travel as an install-wide collection"
  );
  assert.deepEqual(
    backup.collections
      .filter((entry) => entry.key === BOOKMARKS_KEY && entry.present)
      .map((entry) => entry.profileId)
      .sort(),
    ["personal", "work"],
    "each profile's bookmarks must be carried under that profile"
  );

  const preview = await previewLibraryRestore(storage, text, { profileId: "personal" });
  assert.deepEqual(
    preview.profiles.map((entry) => entry.id).sort(),
    ["archive", "personal", "work"],
    "the preview must name every profile it will write"
  );

  const fresh = new Map();
  const restored = await restoreLibraryBackup(storageFrom(fresh), text, { profileId: "personal" });
  assert.equal(restored.applied, true, restored.errors.join("; "));
  assert.equal(fresh.get(ACTIVE_PROFILE_KEY), "personal", "the active-profile pointer was lost");
  assert.deepEqual(
    fresh.get(PROFILE_REGISTRY_KEY).profiles.map((entry) => entry.id).sort(),
    ["archive", "personal", "work"],
    "the profile roster was lost"
  );
  assert.equal(
    fresh.get("aviary.profile.work.library.bookmarks.v1").entries[0].id,
    "w1",
    "a non-active profile collection was lost"
  );
  assert.equal(fresh.get("aviary.profile.personal.library.bookmarks.v1").entries[0].id, "p1");
  assert.equal(fresh.get("aviary.profile.archive.userNotes.v1").entries[0].id, "a1");
});

/**
 * The signing identity is a private key, so it travels only on request and is never swapped
 * without one. A silent replacement would leave every package signed before the restore
 * unverifiable against the fingerprint the install now holds.
 */
test("the signing identity is withheld by default and never replaced silently", async () => {
  const {
    createLibraryBackup,
    previewLibraryRestore,
    restoreLibraryBackup
  } = await importSourceModule("src/features/core/library-backup.ts");
  const { WACZ_SIGNING_KEY } = await importSourceModule("src/features/export/wacz-signing.ts");

  const identity = (fingerprint) => ({
    schemaVersion: 1,
    algorithm: "ECDSA-P384-SHA256",
    createdAt: "2026-09-01T00:00:00.000Z",
    fingerprint,
    publicKey: "cHVi",
    privateKey: "cHJpdmF0ZQ=="
  });
  const source = new Map([[WACZ_SIGNING_KEY, identity("a".repeat(64))]]);

  const routine = await createLibraryBackup(storageFrom(source), {
    selectedKeys: [WACZ_SIGNING_KEY],
    createdAt: "2026-09-05T00:00:00.000Z"
  });
  const routineText = new TextDecoder().decode(routine.artifact.data);
  assert.equal(
    routineText.includes("cHJpdmF0ZQ=="),
    false,
    "a routine backup leaked the signing private key"
  );

  const target = new Map([[WACZ_SIGNING_KEY, identity("b".repeat(64))]]);
  const targetStorage = storageFrom(target);
  const withheldPreview = await previewLibraryRestore(targetStorage, routineText, {});
  assert.ok(
    withheldPreview.skipped.some((entry) => entry.key === WACZ_SIGNING_KEY),
    "a withheld credential must be reported as skipped, not as absent"
  );
  const kept = await restoreLibraryBackup(targetStorage, routineText, {});
  assert.equal(kept.applied, true, kept.errors.join("; "));
  assert.equal(
    target.get(WACZ_SIGNING_KEY).fingerprint,
    "b".repeat(64),
    "restoring a withheld credential deleted the identity already saved"
  );

  const opted = await createLibraryBackup(storageFrom(source), {
    selectedKeys: [WACZ_SIGNING_KEY],
    includeCredentials: true,
    createdAt: "2026-09-05T00:00:00.000Z"
  });
  const optedText = new TextDecoder().decode(opted.artifact.data);
  const refused = await restoreLibraryBackup(targetStorage, optedText, {});
  assert.equal(refused.applied, false, "a silent identity swap was allowed");
  assert.match(refused.errors.join(" "), /signing identity/i);
  assert.equal(
    target.get(WACZ_SIGNING_KEY).fingerprint,
    "b".repeat(64),
    "the refused restore still replaced the identity"
  );

  const allowed = await restoreLibraryBackup(targetStorage, optedText, {
    replaceSigningIdentity: true
  });
  assert.equal(allowed.applied, true, allowed.errors.join("; "));
  assert.equal(
    target.get(WACZ_SIGNING_KEY).fingerprint,
    "a".repeat(64),
    "an explicit replacement did not take effect"
  );
});

/**
 * Schema 1 predates per-collection profiles. Those files are what users already hold, so they must
 * still restore, and into the profile being restored into rather than as unscoped keys.
 */
test("a schema 1 backup still restores into the active profile", async () => {
  const { createLibraryBackup, parseLibraryBackup, restoreLibraryBackup } =
    await importSourceModule("src/features/core/library-backup.ts");
  const BOOKMARKS_KEY = "aviary.library.bookmarks.v1";

  // Build a genuine schema 1 file: no profileId on collections, version 1 throughout, and the
  // checksum recomputed over that older shape rather than patched in.
  const source = new Map([[BOOKMARKS_KEY, { entries: [{ id: "old-1", text: "legacy" }] }]]);
  const current = await createLibraryBackup(storageFrom(source), {
    selectedKeys: [BOOKMARKS_KEY],
    profile: { id: "offline-1", label: "Offline library" },
    createdAt: "2026-08-01T00:00:00.000Z"
  });
  const envelope = JSON.parse(new TextDecoder().decode(current.artifact.data));
  envelope.schemaVersion = 1;
  envelope.manifest.schemaVersion = 1;
  delete envelope.profiles;
  delete envelope.activeProfileId;
  for (const collection of envelope.collections) delete collection.profileId;
  envelope.manifest.sha256 = await legacyManifestChecksum(envelope);
  const legacyText = JSON.stringify(envelope);

  const parsed = parseLibraryBackup(legacyText);
  assert.equal(parsed.schemaVersion, 1, "a schema 1 backup must still parse");
  assert.deepEqual(parsed.profiles, [], "schema 1 carried no profile list");

  const store = new Map();
  const result = await restoreLibraryBackup(storageFrom(store), legacyText, {
    profileId: "offline-1"
  });
  assert.equal(result.applied, true, result.errors.join("; "));
  assert.equal(
    store.get("aviary.profile.offline-1.library.bookmarks.v1").entries[0].id,
    "old-1",
    "a schema 1 collection must land in the profile being restored into"
  );
});

/** The schema 1 checksum rule: version 1, and descriptors without a profile. */
async function legacyManifestChecksum(envelope) {
  const descriptors = envelope.collections.map(({ value: _value, ...descriptor }) => descriptor);
  const text = JSON.stringify({
    generator: "Aviary",
    schemaVersion: 1,
    createdAt: envelope.createdAt,
    includeCredentials: envelope.includeCredentials,
    profile: envelope.profile,
    collections: descriptors
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
