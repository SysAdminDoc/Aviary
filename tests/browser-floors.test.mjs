import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The browser floors, and the rule that follows from them.
 *
 * The floor used to live in three places that did not know about each other: a number in each
 * manifest and a sentence in `docs/INSTALL.md`. That is not a formatting problem -- the floor is
 * what decides whether a platform feature can be used directly or needs a detection branch, so a
 * floor nobody can point at is one that gets rediscovered, differently, per feature.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function floors() {
  const { CHROME_FLOOR, FIREFOX_FLOOR, PLATFORM_FEATURE_FLOORS, isUnderFloor } =
    await importDeclaration();
  return { CHROME_FLOOR, FIREFOX_FLOOR, PLATFORM_FEATURE_FLOORS, isUnderFloor };
}

test("both shipped manifests declare exactly the floor the module declares", async () => {
  const { CHROME_FLOOR, FIREFOX_FLOOR } = await floors();
  const chrome = JSON.parse(
    await readFile(path.join(root, "src/extension/manifest.chrome.json"), "utf8")
  );
  const firefox = JSON.parse(
    await readFile(path.join(root, "src/extension/manifest.firefox.json"), "utf8")
  );

  assert.equal(chrome.minimum_chrome_version, CHROME_FLOOR);
  assert.equal(firefox.browser_specific_settings?.gecko?.strict_min_version, FIREFOX_FLOOR);
});

test("a feature is 'at both floors' only when both its versions are at or under them", async () => {
  const { CHROME_FLOOR, FIREFOX_FLOOR, PLATFORM_FEATURE_FLOORS } = await floors();
  const chromeFloor = Number.parseFloat(CHROME_FLOOR);
  const firefoxFloor = Number.parseFloat(FIREFOX_FLOOR);

  assert.ok(PLATFORM_FEATURE_FLOORS.length >= 8, "the table looks truncated");
  for (const entry of PLATFORM_FEATURE_FLOORS) {
    const available = entry.chrome <= chromeFloor && entry.firefox <= firefoxFloor;
    assert.equal(
      entry.underFloor,
      available,
      `${entry.feature} is marked ${entry.underFloor ? "available" : "unavailable"} at the floors ` +
        `but Chrome ${entry.chrome} / Firefox ${entry.firefox} against ${CHROME_FLOOR} / ${FIREFOX_FLOOR} says otherwise`
    );
  }
});

test("isUnderFloor answers for a listed feature and refuses an unlisted one", async () => {
  const { isUnderFloor } = await floors();
  // A caller asking about something nobody has recorded must get the cautious answer, so a new
  // platform feature defaults to needing a branch rather than to being assumed available.
  assert.equal(isUnderFloor(":has()"), true);
  assert.equal(isUnderFloor("@scope"), false);
  assert.equal(isUnderFloor("View Transitions"), false);
});

test("the install docs state the same floors and the same per-feature answers", async () => {
  const { CHROME_FLOOR, FIREFOX_FLOOR, PLATFORM_FEATURE_FLOORS } = await floors();
  const install = await readFile(path.join(root, "docs/INSTALL.md"), "utf8");

  assert.ok(
    install.includes(`| Chromium | **${CHROME_FLOOR}** |`),
    "docs/INSTALL.md does not state the Chromium floor the module declares"
  );
  assert.ok(
    install.includes(`| Firefox | **${Number.parseInt(FIREFOX_FLOOR, 10)}** |`),
    "docs/INSTALL.md does not state the Firefox floor the module declares"
  );

  for (const entry of PLATFORM_FEATURE_FLOORS) {
    const row = install
      .split("\n")
      .find((line) => line.startsWith("| ") && line.includes(entry.feature));
    assert.ok(row, `docs/INSTALL.md does not list ${entry.feature}`);
    assert.ok(
      row.includes(`| ${entry.chrome} | ${entry.firefox} |`),
      `${entry.feature}'s versions differ between the module and the docs: ${row}`
    );
    // "yes" vs "no — needs a branch": the docs must not tell a reader the opposite of the module.
    assert.equal(
      /\|\s*yes\s*\|/.test(row),
      entry.underFloor,
      `${entry.feature} is documented as the opposite of what the module says: ${row}`
    );
  }
});

test("the build gate refuses a manifest whose floor was changed on its own", async () => {
  const { browserFloorFailures, readBrowserFloors } = await import("../tools/browser-floors.mjs");
  const declared = await readBrowserFloors();
  const { CHROME_FLOOR, FIREFOX_FLOOR } = await floors();

  // The parse is the part that can rot: the tool reads the module's text rather than importing it,
  // so a rename of either constant would silently leave the gate with nothing to compare.
  assert.deepEqual(declared, { chrome: CHROME_FLOOR, firefox: FIREFOX_FLOOR });

  const chromeManifest = JSON.parse(
    await readFile(path.join(root, "src/extension/manifest.chrome.json"), "utf8")
  );
  assert.deepEqual(
    browserFloorFailures("extension-chrome", chromeManifest, declared),
    [],
    "the shipped Chromium manifest already disagrees with the declaration"
  );

  // One manifest moving on its own is exactly what the declaration exists to catch.
  const moved = { ...chromeManifest, minimum_chrome_version: "130" };
  assert.deepEqual(browserFloorFailures("extension-chrome", moved, declared), [
    `extension-chrome: declared browser floor 130 != browser-floors.ts (${CHROME_FLOOR})`
  ]);

  const removed = { ...chromeManifest };
  delete removed.minimum_chrome_version;
  assert.deepEqual(browserFloorFailures("extension-chrome", removed, declared), [
    `extension-chrome: manifest declares no browser floor (expected ${CHROME_FLOOR})`
  ]);

  // And a declaration that stopped declaring is a failure rather than a silently skipped check.
  assert.deepEqual(browserFloorFailures("extension-firefox", chromeManifest, { chrome: null, firefox: null }), [
    "src/extension/browser-floors.ts does not declare both browser floors"
  ]);
});

async function importDeclaration() {
  const { build } = await import("esbuild");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-floors-"));
  try {
    const outfile = path.join(temp, "floors.mjs");
    await build({
      entryPoints: [path.join(root, "src/extension/browser-floors.ts")],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      logLevel: "silent"
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
