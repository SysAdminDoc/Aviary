import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A preset's description is the only thing a user reads before applying it, and applying one
 * rewrites their timeline. Two of them described changes they did not make, and one made a change
 * it did not describe.
 */
test("preset descriptions account for the settings that visibly change the timeline", async () => {
  const { PRESETS } = await import(await bundlePresets());

  for (const preset of PRESETS) {
    const description = preset.description.toLowerCase();
    if (preset.overrides.appearance?.hideCounts === true) {
      assert.match(
        description,
        /count/,
        `${preset.id} hides engagement counts without saying so`
      );
    }
    // Nothing may claim to act on sensitive media specifically: the build cannot tell sensitive
    // media apart, so any such claim is one it cannot keep.
    assert.ok(
      !description.includes("sensitive"),
      `${preset.id} claims to act on sensitive media, which the build cannot identify`
    );
  }
});

async function bundlePresets() {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { build } = await import("esbuild");
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-presets-"));
  const outfile = path.join(temp, "presets.mjs");
  await build({
    entryPoints: [path.join(root, "src/features/core/presets.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  return `${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`;
}
