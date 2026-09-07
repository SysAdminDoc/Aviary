import { readFile } from "node:fs/promises";
import path from "node:path";

const MIN_RECONCILE_VERSION = "1.38.0";

/** Return the package versions that actually existed in git, with their exact commits. */
export async function discoverVersionCommits(_root, runGit) {
  const hashes = (await runGit(["log", "--format=%H", "--reverse", "--", "package.json"]))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const versions = new Map();
  for (const commit of hashes) {
    const source = await runGit(["show", `${commit}:package.json`]);
    try {
      const packageJson = JSON.parse(source);
      if (typeof packageJson.version === "string" && !versions.has(packageJson.version)) {
        versions.set(packageJson.version, commit);
      }
    } catch {
      // A historical commit may predate package.json. It cannot identify a release version.
    }
  }
  return Object.fromEntries(versions);
}

export function reconcileReleaseLedger(versionCommits, tagNames, releaseTags, currentVersion) {
  const tags = new Set(tagNames.map(normalizeTag).filter(Boolean));
  const releases = new Set(releaseTags.map(normalizeTag).filter(Boolean));
  const versions = Object.keys(versionCommits)
    .filter((version) => compareVersions(version, MIN_RECONCILE_VERSION) >= 0)
    .filter((version) => compareVersions(version, currentVersion) <= 0)
    .sort(compareVersions);
  return versions.map((version) => ({
    version,
    commit: versionCommits[version],
    tag: `v${version}`,
    tagPresent: tags.has(version),
    releasePresent: releases.has(version),
    status: tags.has(version) && releases.has(version)
      ? "published"
      : tags.has(version)
        ? "tagged-without-release"
        : releases.has(version)
          ? "release-without-local-tag"
          : "missing"
  }));
}

export function missingReleaseReport(ledger) {
  return ledger
    .filter((entry) => entry.status !== "published")
    .map(({ version, commit, tag, tagPresent, releasePresent, status }) => ({
      version,
      commit,
      tag,
      tagPresent,
      releasePresent,
      status
    }));
}

export async function loadRemoteReleaseTags(runGh) {
  const result = await runGh(["release", "list", "--limit", "200", "--json", "tagName"]);
  const parsed = JSON.parse(result);
  return Array.isArray(parsed) ? parsed.map((entry) => entry?.tagName).filter(Boolean) : [];
}

export async function buildReleaseLedger({ root: _root, runGit, runGh, currentVersion, tagNames }) {
  const versionCommits = await discoverVersionCommits(_root, runGit);
  let releaseTags = [];
  let remoteError = null;
  try {
    releaseTags = await loadRemoteReleaseTags(runGh);
  } catch (error) {
    remoteError = error.message;
  }
  const ledger = reconcileReleaseLedger(versionCommits, tagNames, releaseTags, currentVersion);
  return {
    format: 1,
    repository: "SysAdminDoc/Aviary",
    currentVersion,
    generatedFrom: "git package.json history and GitHub release tags",
    remoteError,
    entries: ledger,
    missing: missingReleaseReport(ledger)
  };
}

export function normalizeTag(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^v?(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

export function compareVersions(left, right) {
  const a = String(left).split(".").map(Number);
  const b = String(right).split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

export async function readPackageVersion(root) {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
    throw new Error(`package.json has an invalid release version: ${packageJson.version}`);
  }
  return packageJson.version;
}
