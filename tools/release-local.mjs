import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { artifactDigests, sourceFingerprint } from "./build-fingerprint.mjs";
import { packCrx3File, verifyCrx3 } from "./release-crx.mjs";
import {
  buildReleaseLedger,
  compareVersions,
  discoverVersionCommits,
  readPackageVersion
} from "./release-ledger.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? process.execPath : "npm";
const npmCli = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  : null;
const CURRENT_FORMAT = 1;
const RELEASE_ASSETS = (version) => [
  "aviary.user.js",
  "aviary.meta.js",
  "README.md",
  `extension-chrome-v${version}.zip`,
  `extension-firefox-v${version}.zip`,
  `aviary-source-v${version}.zip`
];

export function parseReleaseArgs(args) {
  const options = {
    plan: false,
    publish: false,
    historical: null,
    version: null,
    stateDir: defaultStateDir(),
    keyPath: defaultKeyPath()
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--plan") options.plan = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--historical") options.historical = args[++index];
    else if (arg === "--version") options.version = args[++index];
    else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
    else if (arg === "--state-dir") options.stateDir = path.resolve(args[++index]);
    else if (arg.startsWith("--state-dir=")) options.stateDir = path.resolve(arg.slice("--state-dir=".length));
    else if (arg === "--key") options.keyPath = path.resolve(args[++index]);
    else if (arg.startsWith("--key=")) options.keyPath = path.resolve(arg.slice("--key=".length));
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown release option: ${arg}`);
  }
  if (options.historical && !/^\d+\.\d+\.\d+$/.test(options.historical)) {
    throw new Error(`Historical release version is invalid: ${options.historical}`);
  }
  if (options.version && !/^\d+\.\d+\.\d+$/.test(options.version)) {
    throw new Error(`Release version is invalid: ${options.version}`);
  }
  return options;
}

export async function createReleasePlan({ projectRoot = root, version, run = defaultRun }) {
  const packageVersion = await readPackageVersion(projectRoot);
  if (version && version !== packageVersion && !version.startsWith("historical:")) {
    throw new Error(`Requested ${version}, but package.json is ${packageVersion}`);
  }
  const commit = (await runGit(["rev-parse", "HEAD"], { cwd: projectRoot, run })).trim();
  const status = await runGit(["status", "--porcelain=v1"], { cwd: projectRoot, run });
  const tagNames = (await runGit(["tag", "--list"], { cwd: projectRoot, run }))
    .split(/\r?\n/)
    .filter(Boolean);
  const ledger = await buildReleaseLedger({
    root: projectRoot,
    runGit: (args) => runGit(args, { cwd: projectRoot, run }),
    runGh: (args) => runGh(args, { cwd: projectRoot, run }),
    currentVersion: packageVersion,
    tagNames
  });
  return {
    format: CURRENT_FORMAT,
    version: packageVersion,
    commit,
    clean: status.trim().length === 0,
    stateFile: path.join(defaultStateDir(), `v${packageVersion}.json`),
    ledger
  };
}

export async function prepareReleaseArtifacts({
  buildRoot,
  releaseRoot = buildRoot,
  version,
  commit,
  keyPath,
  ledger,
  historical = false
}) {
  const dist = path.join(buildRoot, "dist");
  const releaseDir = path.join(releaseRoot, "dist", "release");
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  const baseNames = RELEASE_ASSETS(version);
  for (const name of baseNames) {
    const source = path.join(dist, name);
    await copyFile(source, path.join(releaseDir, name));
  }

  const chromeZip = path.join(releaseDir, `extension-chrome-v${version}.zip`);
  const crxName = `extension-chrome-v${version}.crx`;
  const crxPath = path.join(releaseDir, crxName);
  const crxResult = await packCrx3File(chromeZip, keyPath, crxPath);
  const ledgerName = `release-ledger-v${version}.json`;
  await writeFile(path.join(releaseDir, ledgerName), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  const signedAssets = [...baseNames, crxName, ledgerName];
  const digests = await artifactDigests(releaseDir, signedAssets);
  const manifestName = `release-manifest-v${version}.json`;
  const manifest = {
    format: CURRENT_FORMAT,
    product: "Aviary",
    version,
    commit,
    historical,
    sourceFingerprint: await sourceFingerprint(buildRoot),
    crx3: {
      asset: crxName,
      keyFingerprint: crxResult.keyFingerprint,
      signature: "RSA-SHA256"
    },
    artifacts: digests,
    checksumsFile: `SHA256SUMS-v${version}.txt`
  };
  await writeFile(path.join(releaseDir, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestDigest = await digestFile(path.join(releaseDir, manifestName));
  const checksumsName = `SHA256SUMS-v${version}.txt`;
  const checksums = Object.entries({ ...digests, [manifestName]: manifestDigest })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, digest]) => `${digest.slice("sha256:".length)}  ${name}`)
    .join("\n");
  await writeFile(path.join(releaseDir, checksumsName), `${checksums}\n`, "utf8");

  const assets = [...signedAssets, manifestName, checksumsName];
  const allDigests = await artifactDigests(releaseDir, assets);
  return {
    releaseDir,
    manifestName,
    checksumsName,
    assets,
    digests: allDigests,
    keyFingerprint: crxResult.keyFingerprint,
    manifest
  };
}

export async function verifyReleaseArtifacts(releaseDir, assets, expectedDigests) {
  for (const name of assets) {
    const digest = await digestFile(path.join(releaseDir, name));
    if (digest !== expectedDigests[name]) {
      throw new Error(`release artifact changed after packaging: ${name}`);
    }
  }
  const crx = assets.find((name) => name.endsWith(".crx"));
  if (crx) {
    const result = verifyCrx3(await readFile(path.join(releaseDir, crx)));
    if (!result.valid) throw new Error(`release CRX failed verification: ${result.reason}`);
  }
  return true;
}

export async function missingReleaseReport({ projectRoot = root, run = defaultRun, currentVersion }) {
  const versionCommits = await discoverVersionCommits(
    projectRoot,
    (args) => runGit(args, { cwd: projectRoot, run })
  );
  const tagNames = (await runGit(["tag", "--list"], { cwd: projectRoot, run }))
    .split(/\r?\n/)
    .filter(Boolean);
  const ledger = await buildReleaseLedger({
    root: projectRoot,
    runGit: (args) => runGit(args, { cwd: projectRoot, run }),
    runGh: (args) => runGh(args, { cwd: projectRoot, run }),
    currentVersion,
    tagNames
  });
  return { ...ledger, versionCommits };
}

async function main() {
  const options = parseReleaseArgs(process.argv.slice(2));
  if (options.help) {
    console.log([
      "Usage: npm run release:local -- --plan",
      "       npm run release:local -- --publish",
      "       npm run release:local -- --publish --historical 1.44.1",
      "",
      "--plan prints the version ledger without building or publishing.",
      "--publish runs the full release gate, signs a secondary CRX3, and resumes by phase."
    ].join("\n"));
    return;
  }
  if (!options.plan && !options.publish) {
    throw new Error("Choose --plan or --publish. Publishing is explicit so a verification run cannot create a release.");
  }

  const plan = await createReleasePlan({
    projectRoot: root,
    version: options.historical ? `historical:${options.historical}` : options.version
  });
  console.log(JSON.stringify(plan.ledger, null, 2));
  if (options.plan) return;
  if (!plan.clean) throw new Error("Release requires a clean git worktree.");
  if (options.historical) {
    await publishHistoricalRelease({ root, options, plan });
  } else {
    await publishCurrentRelease({ root, options, plan });
  }
}

async function publishCurrentRelease({ root: projectRoot, options, plan }) {
  const version = plan.version;
  const tag = `v${version}`;
  const statePath = path.join(options.stateDir, `${tag}.json`);
  let state = await readState(statePath);
  validateState(state, { version, commit: plan.commit });

  if (!state || !state.assets) {
    await runNpm(["run", "verify:release"], { cwd: projectRoot, inherit: true });
    if ((await gitStatus(projectRoot)).trim() !== "") {
      throw new Error("The release gate changed tracked files. Commit the generated build before publishing.");
    }
    const prepared = await prepareReleaseArtifacts({
      buildRoot: projectRoot,
      version,
      commit: plan.commit,
      keyPath: options.keyPath,
      ledger: plan.ledger
    });
    await verifyReleaseArtifacts(prepared.releaseDir, prepared.assets, prepared.digests);
    state = {
      format: CURRENT_FORMAT,
      version,
      tag,
      commit: plan.commit,
      phase: "verified",
      releaseDir: prepared.releaseDir,
      assets: prepared.assets,
      digests: prepared.digests,
      keyFingerprint: prepared.keyFingerprint
    };
    await writeState(statePath, state);
  } else {
    await verifyReleaseArtifacts(state.releaseDir, state.assets, state.digests);
  }

  await ensureTag(projectRoot, tag, plan.commit);
  state.phase = "tagged";
  await writeState(statePath, state);
  await ensureRemoteRelease(projectRoot, tag, version, state);
  state.phase = "published";
  await writeState(statePath, state);
  console.log(`[release:local] published ${tag} with ${state.assets.length} verified assets.`);
}

async function publishHistoricalRelease({ root: projectRoot, options, plan }) {
  const version = options.historical;
  const ledgerEntry = plan.ledger.entries.find((entry) => entry.version === version);
  if (!ledgerEntry) throw new Error(`No package.json commit was found for historical version ${version}.`);
  if (compareVersions(version, plan.version) >= 0) {
    throw new Error("--historical must target a version older than the current package.");
  }
  const tempParent = await mkdtemp(path.join(os.tmpdir(), "aviary-release-worktree-"));
  const worktree = path.join(tempParent, `v${version}`);
  const statePath = path.join(options.stateDir, `v${version}.json`);
  try {
    await runGit(["worktree", "add", "--detach", worktree, ledgerEntry.commit], { cwd: projectRoot, inherit: true });
    await runNpm(["ci", "--ignore-scripts"], { cwd: worktree, inherit: true });
    await runNpm(["run", "verify:release"], { cwd: worktree, inherit: true });
    const prepared = await prepareReleaseArtifacts({
      buildRoot: worktree,
      releaseRoot: projectRoot,
      version,
      commit: ledgerEntry.commit,
      keyPath: options.keyPath,
      ledger: plan.ledger,
      historical: true
    });
    await verifyReleaseArtifacts(prepared.releaseDir, prepared.assets, prepared.digests);
    const state = {
      format: CURRENT_FORMAT,
      version,
      tag: `v${version}`,
      commit: ledgerEntry.commit,
      phase: "verified",
      releaseDir: prepared.releaseDir,
      assets: prepared.assets,
      digests: prepared.digests,
      keyFingerprint: prepared.keyFingerprint,
      verifiedWorktree: worktree
    };
    await writeState(statePath, state);
    await ensureTag(projectRoot, `v${version}`, ledgerEntry.commit);
    state.phase = "tagged";
    await writeState(statePath, state);
    await ensureRemoteRelease(projectRoot, `v${version}`, version, state);
    state.phase = "published";
    await writeState(statePath, state);
    console.log(`[release:local] rebuilt ${version} in a temporary worktree and published it.`);
  } finally {
    await runGit(["worktree", "remove", "--force", worktree], { cwd: projectRoot, inherit: true, allowFailure: true });
    await rm(tempParent, { recursive: true, force: true });
  }
}

async function ensureTag(projectRoot, tag, commit) {
  const local = await runGit(["rev-parse", "--verify", `${tag}^{commit}`], { cwd: projectRoot, allowFailure: true });
  if (local.trim() && local.trim() !== commit) throw new Error(`${tag} already points at ${local.trim()}, expected ${commit}`);
  if (!local.trim()) await runGit(["tag", "-a", tag, commit, "-m", `Aviary ${tag}`], { cwd: projectRoot, inherit: true });
  await runGit(["push", "origin", tag], { cwd: projectRoot, inherit: true });
}

async function ensureRemoteRelease(projectRoot, tag, version, state) {
  let exists = false;
  try {
    await runGh(["release", "view", tag, "--json", "tagName"], { cwd: projectRoot });
    exists = true;
  } catch {
    await runGh([
      "release", "create", tag, "--verify-tag", "--title", `Aviary ${tag}`,
      "--notes", `Aviary ${version}. Download the ZIP for a self-hosted extension install.`
    ], { cwd: projectRoot, inherit: true });
  }
  if (!exists) state.phase = "release-created";
  for (const asset of state.assets) {
    await runGh(["release", "upload", tag, path.join(state.releaseDir, asset), "--clobber"], {
      cwd: projectRoot,
      inherit: true
    });
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aviary-release-remote-"));
  try {
    const remote = JSON.parse(await runGh(["release", "view", tag, "--json", "assets"], { cwd: projectRoot }));
    const remoteNames = new Set((remote.assets ?? []).map((asset) => asset.name));
    for (const asset of state.assets) {
      if (!remoteNames.has(asset)) throw new Error(`GitHub release ${tag} is missing ${asset}`);
      await runGh(["release", "download", tag, "--dir", tempDir, "--pattern", asset, "--clobber"], {
        cwd: projectRoot,
        inherit: true
      });
      const actual = await digestFile(path.join(tempDir, asset));
      if (actual !== state.digests[asset]) throw new Error(`Remote checksum mismatch for ${asset}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function validateState(state, expected) {
  if (!state) return;
  if (state.format !== CURRENT_FORMAT || state.version !== expected.version || state.commit !== expected.commit) {
    throw new Error("The saved release state belongs to a different version or commit.");
  }
}

async function readState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read release state ${file}: ${error.message}`);
  }
}

async function writeState(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function gitStatus(projectRoot) {
  return runGit(["status", "--porcelain=v1"], { cwd: projectRoot });
}

async function runNpm(args, options = {}) {
  return runCommand(npm, npmCli ? [npmCli, ...args] : args, options);
}

async function runGit(args, options = {}) {
  return runCommand("git", args, options);
}

async function runGh(args, options = {}) {
  return runCommand("gh", args, options);
}

async function runCommand(command, args, {
  cwd = root,
  inherit = false,
  allowFailure = false,
  run = defaultRun
} = {}) {
  const output = await run(command, args, { cwd, inherit, allowFailure });
  return typeof output === "string" ? output : output?.stdout ?? "";
}

async function defaultRun(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        const error = new Error(`${command} ${args.join(" ")} failed${signal ? ` with ${signal}` : ` with ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
        error.code = code;
        if (options.allowFailure) resolve("");
        else reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function digestFile(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

function defaultStateDir() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, "Aviary", "release-state");
}

function defaultKeyPath() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, "Aviary", "Aviary-selfhost.pem");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`[release:local] ${error.message}`);
    process.exitCode = 1;
  }
}
