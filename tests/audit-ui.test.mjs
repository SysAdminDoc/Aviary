import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the visual harness refuses to capture against a stale extension build", async () => {
  const { assertCurrentExtensionBuild } = await import(
    pathToFileURL(path.join(root, "tools/settings-visual-harness.mjs")).href
  );
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  // A scratch build directory rather than the real dist/, which other tests read while this runs.
  const dir = await mkdtemp(path.join(tmpdir(), "aviary-stale-build-"));
  try {
    await assert.rejects(
      () => assertCurrentExtensionBuild(path.join(dir, "never-built")),
      /Build the extension first/
    );

    // Capturing from a stale build produces baselines for code nobody is running: the diff looks
    // clean and describes the previous release.
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ version: "0.0.1" }), "utf8");
    await assert.rejects(
      () => assertCurrentExtensionBuild(dir),
      /The built extension is stale \(0\.0\.1/
    );

    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ version: pkg.version }), "utf8");
    await assert.rejects(
      () => assertCurrentExtensionBuild(dir),
      /no matching artifact manifest/,
      "a version-only directory must not pass the gate"
    );

    const currentBuild = path.join(dir, "extension-chrome");
    await mkdir(currentBuild, { recursive: true });
    const { fileDigest, sourceFingerprint } = await import(
      pathToFileURL(path.join(root, "tools", "build-fingerprint.mjs")).href
    );
    const contentPath = path.join(currentBuild, "content.js");
    await writeFile(path.join(currentBuild, "manifest.json"), JSON.stringify({ version: pkg.version }), "utf8");
    await writeFile(contentPath, "fixture artifact\n", "utf8");
    const buildInfoPath = path.join(currentBuild, "build-info.json");
    const buildInfo = {
      format: 1,
      product: "Aviary",
      target: "extension-chrome",
      version: pkg.version,
      sourceFingerprint: await sourceFingerprint(root),
      artifacts: { "content.js": await fileDigest(contentPath) }
    };
    await writeFile(buildInfoPath, JSON.stringify(buildInfo), "utf8");
    await assert.doesNotReject(
      () => assertCurrentExtensionBuild(currentBuild),
      "a current artifact-matched build must pass the gate"
    );

    await writeFile(buildInfoPath, JSON.stringify({ ...buildInfo, sourceFingerprint: "sha256:stale" }), "utf8");
    await assert.rejects(
      () => assertCurrentExtensionBuild(currentBuild),
      /source fingerprint is stale/,
      "a same-version bundle from older source must not pass the gate"
    );
    await writeFile(buildInfoPath, JSON.stringify(buildInfo), "utf8");

    await writeFile(path.join(currentBuild, "content.js"), "\n", { flag: "a" });
    await assert.rejects(
      () => assertCurrentExtensionBuild(currentBuild),
      /artifact is modified: content\.js/,
      "a modified artifact must not pass the gate"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release verification keeps the fast and publication lanes explicit", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const gate = await readFile(path.join(root, "tools", "release-gate.mjs"), "utf8");
  assert.equal(packageJson.scripts["verify:fast"], "node tools/verify-fast.mjs");
  assert.equal(packageJson.scripts["verify:release"], "node tools/release-gate.mjs");
  assert.match(gate, /rejected artifacts were removed/);
  assert.match(gate, /tests\/visual\/reflow-visual-regression\.test\.mjs/);
  assert.match(gate, /"run", "smoke"/);
});

test("credential fields are masked and offer an explicit reveal", async () => {
  const source = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/advanced.ts",
      "src/ui/control-center/sections/data.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");

  assert.match(source, /function secretInputRow\(/);
  assert.match(source, /input\.type = "password"/);
  assert.match(source, /input\.autocomplete = "off"/);
  assert.match(source, /aria-pressed/);

  for (const label of [
    "Aria2 RPC secret",
    "Bluesky app password",
    "Mastodon access token",
    "AI API key",
    "Embedding API key"
  ]) {
    const index = source.indexOf(`"${label}"`);
    assert.ok(index > 0, `${label} row is missing`);
    const call = source.slice(Math.max(0, index - 80), index);
    assert.ok(
      call.includes("secretInputRow("),
      `${label} must render through secretInputRow, not a plain text field`
    );
  }
});

test("normalizeSettings still round-trips the reduce-motion values the new control emits", async () => {
  const { normalizeSettings } = await importSourceModule("src/platform/settings.ts");

  for (const mode of ["system", "always", "never"]) {
    assert.equal(normalizeSettings({ accessibility: { reduceMotion: mode } }).accessibility.reduceMotion, mode);
  }
  assert.equal(
    normalizeSettings({ accessibility: { reduceMotion: "sometimes" } }).accessibility.reduceMotion,
    "system"
  );
});
