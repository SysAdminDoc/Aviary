import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

test("profile storage forwards measurement without counting another profile's library", async () => {
  const { createProfileStorageGateway } = await importSourceModule("src/platform/profile.ts");
  const original = {
    totalBytes: 1100,
    usageDetails: { indexedDB: 8192 },
    collections: [
      { key: "aviary.profile.reader.library.bookmarks.v1", bytes: 100, records: 1 },
      { key: "aviary.profile.reader.userNotes.v1", bytes: 200, records: 1 },
      { key: "aviary.profile.reader-two.library.bookmarks.v1", bytes: 400, records: 1 },
      { key: "aviary.library.bookmarks.v1", bytes: 400, records: 1 }
    ]
  };
  const base = { async measureCollections() { assert.equal(this, base); return original; } };
  const scoped = createProfileStorageGateway(base, "reader");
  assert.equal(typeof scoped.measureCollections, "function", "a profile must not drop the measurement capability");
  assert.deepEqual(await scoped.measureCollections(), {
    totalBytes: 300,
    usageDetails: { indexedDB: 8192 },
    collections: [
      { key: "aviary.library.bookmarks.v1", bytes: 100, records: 1 },
      { key: "aviary.userNotes.v1", bytes: 200, records: 1 }
    ]
  });
  assert.equal(original.totalBytes, 1100, "reading a profile does not mutate the underlying measurement");
  assert.equal(original.collections.length, 4);
  const empty = await createProfileStorageGateway(base, "empty").measureCollections();
  assert.equal(empty.totalBytes, 0);
  assert.deepEqual(empty.collections, []);
});

test("an unmeasurable profile returns unknown rather than leaving its view pending", async () => {
  const { createProfileStorageGateway } = await importSourceModule("src/platform/profile.ts");
  assert.equal(await createProfileStorageGateway({}, "reader").measureCollections(), null);
  assert.equal(await createProfileStorageGateway({async measureCollections() {return null;}}, "reader").measureCollections(), null);
  const failed = createProfileStorageGateway({async measureCollections() {throw new Error("measurement refused");}}, "reader");
  await assert.rejects(() => failed.measureCollections(), /measurement refused/);
});
