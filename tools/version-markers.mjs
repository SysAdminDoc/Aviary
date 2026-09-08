import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Every place the repository writes its own version, and the text around it.
 *
 * Preflight's `checkReleaseMetadata` only ever asked whether a file mentions the current version.
 * That passes a file still carrying an older one, as long as some other line in it is current, and
 * it says nothing at all about a file nobody remembered to edit. The 1.48.0 bump left `1.47.2` in
 * the install and privacy docs, in `design-qa.md`, in `RESEARCH.md`, in the lockfile and in three
 * tests, and nothing failed.
 *
 * So each marker is written out with the version as a capture group. A marker that matches with
 * the wrong version fails, and a marker that has disappeared fails too, which is the half a
 * positive check cannot see.
 *
 * `history: true` names a file whose job is to hold old versions, so the changelog is declared
 * rather than exempt by accident. `optional: true` is for a file that is not in every checkout.
 */
export const VERSION_MARKERS = [
  { file: "README.md", label: "shields.io badge", pattern: /shields\.io\/badge\/version-(\d+\.\d+\.\d+)-/g },
  { file: "README.md", label: "generated facts sentence", pattern: /^Aviary (\d+\.\d+\.\d+) registers/gm },
  { file: "README.md", label: "source archive name", pattern: /aviary-source-v(\d+\.\d+\.\d+)\.zip/g },
  { file: "ROADMAP.md", label: "version line", pattern: /^Version: `(\d+\.\d+\.\d+)`/gm },
  { file: "CHANGELOG.md", label: "release headings", pattern: /^## (\d+\.\d+\.\d+) \(/gm, history: true },
  { file: "docs/INSTALL.md", label: "title", pattern: /^# Install Aviary (\d+\.\d+\.\d+)/gm },
  { file: "docs/INSTALL.md", label: "source archive name", pattern: /aviary-source-v(\d+\.\d+\.\d+)\.zip/g },
  { file: "docs/PRIVACY.md", label: "release marker", pattern: /release (\d+\.\d+\.\d+)/g },
  { file: "design-qa.md", label: "summary line", pattern: /^Aviary (\d+\.\d+\.\d+):/gm, optional: true },
  { file: "RESEARCH.md", label: "summary line", pattern: /^Aviary v(\d+\.\d+\.\d+) is/gm, optional: true },
  { file: "CLAUDE.md", label: "current version", pattern: /\*\*Current version:\*\* (\d+\.\d+\.\d+)/g, optional: true },
  // This one is a test rather than a document, and it is here for the same reason as the rest: it
  // pins the live tree to a literal version, so a bump that skips it fails the suite instead of the
  // declaration. The 1.48.1 bump found it that way.
  {
    file: "tests/local-release.test.mjs",
    label: "aligned-version assertion",
    pattern: /assertAlignedVersions\(process\.cwd\(\), "(\d+\.\d+\.\d+)"\)/g
  }
];

/**
 * Every way the tree can disagree with `package.json` about its own version, as failure strings.
 *
 * Separated from preflight so it can be driven against a tree that does disagree. Preflight only
 * ever sees the real one, which is the one that is supposed to be right.
 */
export async function versionMarkerFailures(root, version, markers = VERSION_MARKERS) {
  const failures = [];

  for (const marker of markers) {
    if (marker.history) continue;
    let text;
    try {
      text = await readFile(path.join(root, marker.file), "utf8");
    } catch (error) {
      if (marker.optional && error.code === "ENOENT") continue;
      failures.push(`${marker.file}: cannot be read to check its version marker (${error.message})`);
      continue;
    }
    // `matchAll` throws on a regex without `g`, and a marker is a readable declaration rather than
    // a call site, so the flag is added here instead of being something each entry has to remember.
    // (`matchAll` itself clones the regex, so a shared global pattern is not the hazard it looks
    // like -- `lastIndex` on the declared marker never moves.)
    const flags = marker.pattern.flags.includes("g") ? marker.pattern.flags : `${marker.pattern.flags}g`;
    const found = [...text.matchAll(new RegExp(marker.pattern.source, flags))].map((match) => match[1]);
    if (found.length === 0) {
      failures.push(`${marker.file}: the ${marker.label} version marker is missing entirely`);
      continue;
    }
    for (const seen of new Set(found)) {
      if (seen !== version) {
        failures.push(`${marker.file}: the ${marker.label} still says ${seen}, but package.json is ${version}`);
      }
    }
  }

  // The lockfile is read as JSON rather than matched as text, because its version lives in named
  // fields and a regex over JSON would also match every dependency's version.
  let lock;
  try {
    lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  } catch (error) {
    failures.push(`package-lock.json: unreadable (${error.message})`);
    return failures;
  }
  // Two fields, because npm writes the version in both and a hand edit reliably updates one.
  for (const [label, value] of [["version", lock.version], ['packages[""].version', lock.packages?.[""]?.version]]) {
    if (value !== version) {
      failures.push(`package-lock.json: ${label} is ${value}, but package.json is ${version}`);
    }
  }

  return failures;
}
