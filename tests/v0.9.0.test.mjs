import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("user notes module follows the reversibility contract", async () => {
  const source = await readFile(
    path.join(root, "src/features/library/user-notes.ts"),
    "utf8"
  );

  for (const marker of [
    "av-note-badge",
    "data-av-note-badge",
    "data-av-note-processed",
    "normalizeHandle",
    "destroy",
    "av-user-notes",
    "[a-z0-9_]{1,15}"
  ]) {
    assert.ok(source.includes(marker), `user-notes source missing ${marker}`);
  }
  assert.ok(!/innerHTML/.test(source));
});

test("link unshorten module rewrites only t.co URLs and is reversible", async () => {
  const source = await readFile(
    path.join(root, "src/features/library/link-unshorten.ts"),
    "utf8"
  );

  for (const marker of [
    "av-link-clean",
    "expandTco",
    "data-av-link-clean",
    "avOriginalText",
    "destroy",
    "t\\.co"
  ]) {
    assert.ok(source.includes(marker), `link-unshorten missing ${marker}`);
  }
  assert.ok(!/innerHTML/.test(source));
});
