import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Reads `tools/i18n-manifest.json`, generating it first if it is not there.
 *
 * The manifest is a build product and is gitignored, so a fresh clone has no file to read. Tests
 * used to work around that by skipping when it was absent, which turns the strongest assertion
 * they have into one that silently does nothing on exactly the checkout most likely to be broken.
 * Regenerating takes well under a second and is deterministic.
 */
export async function readI18nManifest(root) {
  const file = path.join(root, "tools/i18n-manifest.json");
  if (!existsSync(file)) {
    await run(process.execPath, [path.join(root, "tools/i18n-extract.mjs"), "--write"], { cwd: root });
  }
  return JSON.parse(await readFile(file, "utf8"));
}
