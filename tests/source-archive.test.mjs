import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PRIVATE_SOURCE_PATHS,
  ignoredPaths,
  isPrivateSourcePath,
  zipEntryNames
} from "../tools/source-archive.mjs";

/**
 * `dist/aviary-source-v<version>.zip` is published beside the installable packages, and v1.48.1
 * shipped `CLAUDE.md` inside it. The build's file walk skipped a fixed list of directories and
 * never asked `.gitignore`, so the private working notes travelled with the release, along with a
 * generated `tools/i18n-manifest.json`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("git's ignore rules decide what may travel in the source archive", () => {
  // A list mixing real source with a file this repository really does ignore. The clean half is
  // the control: a check that answered "ignored" for everything would satisfy the other half.
  const answer = ignoredPaths(root, ["src/main.ts", "package.json", "CLAUDE.md"]);
  assert.equal(answer.checked, true, "git must be reachable from the repository itself");
  assert.deepEqual(answer.ignored, ["CLAUDE.md"]);

  const clean = ignoredPaths(root, ["src/main.ts", "package.json"]);
  assert.equal(clean.checked, true);
  assert.deepEqual(clean.ignored, [], "check-ignore exits 1 when nothing matches, which is not an error");
});

test("the private paths are refused by name where git cannot answer", () => {
  assert.ok(PRIVATE_SOURCE_PATHS.includes("CLAUDE.md"));
  assert.equal(isPrivateSourcePath("CLAUDE.md"), true);
  assert.equal(isPrivateSourcePath(".claude/settings.json"), true, "a declared directory covers what is under it");
  assert.equal(isPrivateSourcePath(".claude"), true);
  assert.equal(isPrivateSourcePath("src/main.ts"), false);
  assert.equal(isPrivateSourcePath("docs/CLAUDE.md"), false, "the rule is a path, not a filename anywhere");
});

test("a malformed central directory throws instead of reporting a short, clean listing", () => {
  assert.throws(() => zipEntryNames(new Uint8Array(64)), /no end-of-central-directory record/);

  // One entry promised, none written: a reader that returned what it found would report an empty
  // archive, and an empty archive passes every contents check there is.
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, 1, true);
  view.setUint32(16, 0, true);
  assert.throws(() => zipEntryNames(bytes), /central directory entry 0 is malformed/);
});

test("the built source archive carries checkout inputs and nothing git ignores", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const archive = path.join(root, "dist", `aviary-source-v${pkg.version}.zip`);
  let bytes;
  try {
    bytes = new Uint8Array(await readFile(archive));
  } catch {
    // A fresh clone has no dist/ until `npm run build`; preflight gates the same property there.
    return;
  }

  const names = zipEntryNames(bytes);
  assert.ok(names.includes("src/main.ts"), "the archive must still carry the source it exists for");
  assert.ok(names.includes("package.json"));

  const { checked, ignored } = ignoredPaths(root, names);
  assert.equal(checked, true);
  assert.deepEqual(ignored, [], `the published archive ships ignored files: ${ignored.join(", ")}`);
  for (const name of names) {
    assert.equal(isPrivateSourcePath(name), false, `the published archive ships ${name}`);
  }
});
