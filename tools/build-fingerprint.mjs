import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SOURCE_DIRECTORIES = ["src"];
const SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "tools/build.mjs",
  "tools/build-fingerprint.mjs",
  "tools/userscript-meta.mjs"
];

/** Returns the source files that determine a browser artifact, in stable order. */
export async function listBuildInputs(root) {
  const files = [...SOURCE_FILES.map((relative) => path.join(root, relative))];
  for (const directory of SOURCE_DIRECTORIES) {
    await collectFiles(path.join(root, directory), files);
  }
  return files.sort((left, right) => path.relative(root, left).localeCompare(path.relative(root, right)));
}

/** Hashes relative names and bytes so a same-version stale bundle cannot pass as current. */
export async function sourceFingerprint(root) {
  const hash = createHash("sha256");
  for (const file of await listBuildInputs(root)) {
    hash.update(path.relative(root, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function fileDigest(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

export async function artifactDigests(root, relativeFiles) {
  const entries = {};
  for (const relative of [...relativeFiles].sort()) {
    entries[relative] = await fileDigest(path.join(root, relative));
  }
  return entries;
}

async function collectFiles(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(file, files);
    } else if ((await stat(file)).isFile()) {
      files.push(file);
    }
  }
}
