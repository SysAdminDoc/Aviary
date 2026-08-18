import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the visual harness refuses to capture against a stale extension build", async () => {
  const { assertCurrentExtensionBuild } = await import(
    pathToFileURL(path.join(root, "tools/settings-visual-harness.mjs")).href
  );
  const manifestPath = path.join(root, "dist", "extension-chrome", "manifest.json");
  if (!existsSync(manifestPath)) {
    // `npm run verify` builds after it tests, so a first-ever run has no dist to check against.
    // The gate is what matters, and it fires on the missing directory too.
    await assert.rejects(() => assertCurrentExtensionBuild(), /Build the extension first/);
    return;
  }

  const original = await readFile(manifestPath, "utf8");
  try {
    const stale = { ...JSON.parse(original), version: "0.0.1" };
    await writeFile(manifestPath, JSON.stringify(stale, null, 2), "utf8");
    // Capturing from a stale build produces baselines for code nobody is running, which is worse
    // than not capturing: the diff looks clean and describes the previous release.
    await assert.rejects(() => assertCurrentExtensionBuild(), /The built extension is stale \(0\.0\.1/);
  } finally {
    await writeFile(manifestPath, original, "utf8");
  }

  await assert.doesNotReject(() => assertCurrentExtensionBuild(), "a current build must pass the gate");
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
  const { normalizeSettings } = await importBundledModule("src/platform/settings.ts");

  for (const mode of ["system", "always", "never"]) {
    assert.equal(normalizeSettings({ accessibility: { reduceMotion: mode } }).accessibility.reduceMotion, mode);
  }
  assert.equal(
    normalizeSettings({ accessibility: { reduceMotion: "sometimes" } }).accessibility.reduceMotion,
    "system"
  );
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit-ui-"));
  const outfile = path.join(temp, "module.mjs");

  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
