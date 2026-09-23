import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { VERSION_MARKERS, versionMarkerFailures } from "../tools/version-markers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A tree carrying one declared marker per file, all at the same version. */
async function buildTree(version, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aviary-version-markers-"));
  const files = {
    "README.md": [
      `![Version](https://img.shields.io/badge/version-${version}-2f81f7)`,
      `Aviary ${version} registers 30 feature modules.`,
      `sha256sum dist/aviary-source-v${version}.zip`,
      `[Download v${version}](https://github.com/SysAdminDoc/Aviary/releases/tag/v${version})`,
      `[Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v${version}/extension-chrome-v${version}.zip)`
    ].join("\n"),
    "ROADMAP.md": `# ROADMAP\n\nVersion: \`${version}\`\n`,
    "CHANGELOG.md": `# Changelog\n\n## ${version} (2026-09-07)\n\n## 1.0.0 (2020-01-01)\n`,
    "docs/INSTALL.md": [
      `# Install Aviary ${version}`,
      `sha256sum dist/aviary-source-v${version}.zip`,
      `Start with the [v${version} release downloads](https://github.com/SysAdminDoc/Aviary/releases/tag/v${version}).`,
      `[Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v${version}/extension-chrome-v${version}.zip)`
    ].join("\n\n"),
    "docs/PRIVACY.md": `Updated: 2026-09-07 · release ${version}\n`,
    "design-qa.md": `Aviary ${version}: 14 destinations.\n`,
    "RESEARCH.md": `Aviary v${version} is a local-first X enhancement.\n`,
    "CLAUDE.md": `**Current version:** ${version}\n`,
    "package-lock.json": JSON.stringify({ version, packages: { "": { version } } }, null, 2),
    "tests/local-release.test.mjs": `assertAlignedVersions(process.cwd(), "${version}")
`,
    ...overrides
  };
  for (const [relative, contents] of Object.entries(files)) {
    if (contents === null) continue;
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return root;
}

test("an aligned tree produces no version failures", async () => {
  const root = await buildTree("1.48.0");
  try {
    assert.deepEqual(await versionMarkerFailures(root, "1.48.0"), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a marker left at the previous version fails and names the file, the marker and the value", async () => {
  // This is the case that shipped: the bump updated some markers and left others behind, and the
  // positive check passed because each file still mentioned the new version somewhere.
  const root = await buildTree("1.48.0", {
    "docs/PRIVACY.md": "Updated: 2026-09-07 · release 1.47.2\n",
    // A download link left behind is the 1.52.2 install guide's actual defect.
    "docs/INSTALL.md": "# Install Aviary 1.48.0\n\nsha256sum dist/aviary-source-v1.47.2.zip\n\n" +
      "Start with the [v1.48.0 release downloads](https://github.com/SysAdminDoc/Aviary/releases/tag/v1.48.0).\n\n" +
      "[Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.46.0/extension-chrome-v1.46.0.zip)\n"
  });
  try {
    const failures = await versionMarkerFailures(root, "1.48.0");
    assert.deepEqual(failures.sort(), [
      "docs/INSTALL.md: the release asset name still says 1.46.0, but package.json is 1.48.0",
      "docs/INSTALL.md: the release link still says 1.46.0, but package.json is 1.48.0",
      "docs/INSTALL.md: the source archive name still says 1.47.2, but package.json is 1.48.0",
      "docs/PRIVACY.md: the release marker still says 1.47.2, but package.json is 1.48.0"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a current tag cannot hide a stale asset name or label, and other projects' releases are ignored", async () => {
  const root = await buildTree("1.48.0", {
    "docs/INSTALL.md": [
      "# Install Aviary 1.48.0",
      "sha256sum dist/aviary-source-v1.48.0.zip",
      // The tag is current; the words and the file name behind it are not.
      "Start with the [v1.47.2 release downloads](https://github.com/SysAdminDoc/Aviary/releases/tag/v1.48.0).",
      "[Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.48.0/extension-chrome-v1.47.2.zip)",
      // A userscript manager's own release is someone else's version.
      "[Violentmonkey](https://github.com/violentmonkey/violentmonkey/releases/download/v2.47.0/Violentmonkey-webext-v2.47.0.zip)"
    ].join("\n\n")
  });
  try {
    assert.deepEqual((await versionMarkerFailures(root, "1.48.0")).sort(), [
      "docs/INSTALL.md: the release asset name still says 1.47.2, but package.json is 1.48.0",
      "docs/INSTALL.md: the release link text still says 1.47.2, but package.json is 1.48.0"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a marker that has disappeared fails rather than passing silently", async () => {
  // The half a positive check cannot see: a file that stops advertising the version at all.
  const root = await buildTree("1.48.0", { "ROADMAP.md": "# ROADMAP\n\nNo version line here.\n" });
  try {
    assert.deepEqual(await versionMarkerFailures(root, "1.48.0"), [
      "ROADMAP.md: the version line version marker is missing entirely"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the changelog keeps its history and the lockfile is checked field by field", async () => {
  const root = await buildTree("1.48.0", {
    // Two old headings, which is what a changelog is for.
    "CHANGELOG.md": "# Changelog\n\n## 1.48.0 (2026-09-07)\n\n## 1.47.2 (2026-09-05)\n\n## 1.0.0 (2020-01-01)\n",
    // npm writes the version twice, and a hand edit reliably updates one of them.
    "package-lock.json": JSON.stringify({ version: "1.48.0", packages: { "": { version: "1.47.2" } } }, null, 2)
  });
  try {
    assert.deepEqual(await versionMarkerFailures(root, "1.48.0"), [
      'package-lock.json: packages[""].version is 1.47.2, but package.json is 1.48.0'
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an optional file is skipped when absent and checked when present", async () => {
  const absent = await buildTree("1.48.0", { "design-qa.md": null, "RESEARCH.md": null, "CLAUDE.md": null });
  try {
    assert.deepEqual(await versionMarkerFailures(absent, "1.48.0"), []);
  } finally {
    await rm(absent, { recursive: true, force: true });
  }

  const stale = await buildTree("1.48.0", { "design-qa.md": "Aviary 1.47.2: 14 destinations.\n" });
  try {
    assert.deepEqual(await versionMarkerFailures(stale, "1.48.0"), [
      "design-qa.md: the summary line still says 1.47.2, but package.json is 1.48.0"
    ]);
  } finally {
    await rm(stale, { recursive: true, force: true });
  }
});

test("a required file that cannot be read is a failure, not a skip", async () => {
  const root = await buildTree("1.48.0", { "docs/PRIVACY.md": null });
  try {
    const failures = await versionMarkerFailures(root, "1.48.0");
    assert.equal(failures.length, 1, failures.join("; "));
    assert.match(failures[0], /^docs\/PRIVACY\.md: cannot be read to check its version marker/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a marker declared without the global flag still matches", async () => {
  // A marker is a readable declaration, not a call site, so `g` is added for it. Without that,
  // `matchAll` throws a TypeError and the whole check dies instead of reporting anything.
  const root = await buildTree("1.48.0", { "docs/PRIVACY.md": "release 1.47.2\n" });
  try {
    const failures = await versionMarkerFailures(root, "1.48.0", [
      { file: "docs/PRIVACY.md", label: "release marker", pattern: /release (\d+\.\d+\.\d+)/ }
    ]);
    assert.deepEqual(failures, [
      "docs/PRIVACY.md: the release marker still says 1.47.2, but package.json is 1.48.0"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the same marker table gives the same answer twice", async () => {
  // The markers are module-level constants shared by every call, so a check that accumulated state
  // in them would report a stale marker once and then go quiet.
  const root = await buildTree("1.48.0", { "docs/PRIVACY.md": "release 1.47.2\n" });
  try {
    const first = await versionMarkerFailures(root, "1.48.0");
    const second = await versionMarkerFailures(root, "1.48.0");
    assert.deepEqual(second, first);
    assert.equal(first.length, 1, first.join("; "));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every declared marker matches the real repository at its real version", async () => {
  // The table is only worth anything if it describes this tree. A marker whose pattern no longer
  // matches the file it names would otherwise sit there proving nothing.
  const version = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")).version;
  assert.deepEqual(await versionMarkerFailures(repoRoot, version), []);

  for (const marker of VERSION_MARKERS) {
    let text;
    try {
      text = await readFile(path.join(repoRoot, marker.file), "utf8");
    } catch (error) {
      assert.ok(marker.optional, `${marker.file} is declared required but is not in the tree (${error.message})`);
      continue;
    }
    const flags = marker.pattern.flags.includes("g") ? marker.pattern.flags : `${marker.pattern.flags}g`;
    const found = [...text.matchAll(new RegExp(marker.pattern.source, flags))].map((match) => match[1]);
    assert.ok(found.length > 0, `${marker.file}: the ${marker.label} pattern matches nothing in the real file`);
    if (!marker.history) {
      assert.deepEqual([...new Set(found)], [version], `${marker.file}: ${marker.label}`);
    }
  }
});
