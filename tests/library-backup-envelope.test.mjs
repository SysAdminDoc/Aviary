import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("backup creation rejects an envelope that exceeds the parser limit across valid profiles", async () => {
  const { createLibraryBackup, LibraryBackupError } = await importSourceModule(
    "src/features/core/library-backup.ts"
  );
  const USER_NOTES_KEY = "aviary.userNotes.v1";
  const profiles = Array.from({ length: 22 }, (_, index) => ({
    id: `profile-${index + 1}`,
    label: `Profile ${index + 1}`
  }));
  const note = "x".repeat(4_900_000);
  const store = new Map(
    profiles.map((profile) => [
      `aviary.profile.${profile.id}.userNotes.v1`,
      { entries: [{ id: profile.id, text: note }] }
    ])
  );
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set() {},
    async remove() {}
  };

  await assert.rejects(
    () => createLibraryBackup(storage, {
      profiles,
      selectedKeys: [USER_NOTES_KEY],
      createdAt: "2026-09-06T00:00:00.000Z"
    }),
    (error) => error instanceof LibraryBackupError && error.code === "too-large"
  );
});
