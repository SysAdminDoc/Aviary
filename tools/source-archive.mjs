import { execFileSync } from "node:child_process";

/**
 * What may travel in `dist/aviary-source-v<version>.zip`, and how to read what did.
 *
 * The archive is published beside the installable packages, so its contents are as public as the
 * repository is. `walkSource` in `tools/build.mjs` decided them by skipping a fixed list of
 * directories and image extensions, which knew nothing about `.gitignore`: v1.48.1 shipped
 * `CLAUDE.md`, the private working notes, and `tools/i18n-manifest.json`, a generated file. The
 * working notes are the worse half. They are the one file the repository's own rules let carry
 * anything, precisely because they are never published.
 *
 * Git owns the answer to "is this file part of the source", so it is asked rather than
 * re-implemented here. `PRIVATE_SOURCE_PATHS` is the floor for a checkout with no git available,
 * which is what extracting this very archive and building from it looks like.
 */
export const PRIVATE_SOURCE_PATHS = ["CLAUDE.md", "CODEX_CHANGELOG.md", ".claude/"];

/** True when a path is one the fallback list keeps out, directory prefixes included. */
export function isPrivateSourcePath(name) {
  return PRIVATE_SOURCE_PATHS.some((entry) =>
    entry.endsWith("/") ? name === entry.slice(0, -1) || name.startsWith(entry) : name === entry
  );
}

/**
 * Which of `names` git ignores, and whether git could answer at all.
 *
 * `git check-ignore` exits 1 when nothing matches, which is the good case and not an error. Any
 * other failure means no answer was obtained, and the caller decides whether that is a warning or
 * a fallback rather than being handed an empty list that looks like a clean result.
 */
export function ignoredPaths(root, names) {
  if (names.length === 0) return { checked: true, ignored: [] };
  try {
    const output = execFileSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      input: `${names.join("\n")}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    return { checked: true, ignored: output.split(/\r?\n/).filter(Boolean) };
  } catch (error) {
    if (error.status === 1) return { checked: true, ignored: [] };
    return { checked: false, ignored: [] };
  }
}

/**
 * Entry names read out of a store ZIP's central directory.
 *
 * The archive is written by this repository with no compression and no ZIP64 records, so the
 * central directory is walked directly instead of adding a dependency to read six megabytes of
 * names. A malformed record throws rather than returning the entries found so far: a truncated
 * listing would report a clean archive.
 */
export function zipEntryNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("no end-of-central-directory record");

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const names = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error(`central directory entry ${index} is malformed`);
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    names.push(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}
