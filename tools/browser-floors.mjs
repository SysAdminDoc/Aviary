import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The declared browser floors, read out of the module that declares them.
 *
 * Parsed rather than imported because preflight runs as plain Node with no build step, and a
 * second copy of the numbers in a tool would be exactly the drift the declaration exists to
 * prevent.
 */
export async function readBrowserFloors(sourcePath = path.join(root, "src/extension/browser-floors.ts")) {
  const source = await readFile(sourcePath, "utf8");
  const read = (name) => new RegExp(`export const ${name} = "([^"]+)"`).exec(source)?.[1] ?? null;
  return { chrome: read("CHROME_FLOOR"), firefox: read("FIREFOX_FLOOR") };
}

/**
 * Every way a shipped manifest can disagree with the declaration, as failure strings.
 *
 * Separated from preflight so it can be driven against a manifest that does disagree. Preflight
 * itself only ever sees the one in `dist/`, which is the one that is supposed to be right.
 */
export function browserFloorFailures(target, manifest, floors) {
  const failures = [];
  if (!floors.chrome || !floors.firefox) {
    failures.push("src/extension/browser-floors.ts does not declare both browser floors");
    return failures;
  }
  const declared =
    target === "extension-chrome"
      ? manifest.minimum_chrome_version
      : manifest.browser_specific_settings?.gecko?.strict_min_version;
  const expected = target === "extension-chrome" ? floors.chrome : floors.firefox;
  if (declared === undefined) {
    failures.push(`${target}: manifest declares no browser floor (expected ${expected})`);
    return failures;
  }
  if (declared !== expected) {
    failures.push(
      `${target}: declared browser floor ${declared} != browser-floors.ts (${expected})`
    );
  }
  return failures;
}
