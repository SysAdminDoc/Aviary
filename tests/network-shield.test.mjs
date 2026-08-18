import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let settings;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-network-shield-"));
  const outfile = path.join(temp, "settings.mjs");
  await build({
    entryPoints: [path.join(root, "src/platform/settings.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  settings = await import(pathToFileURL(outfile).href);
});

after(async () => {
  await rm(temp, { recursive: true, force: true });
});

test("the network shield ships on, so the default install is unchanged", () => {
  assert.equal(settings.DEFAULT_SETTINGS.privacy.blockAds, true);
  assert.equal(settings.DEFAULT_SETTINGS.privacy.networkShield, true);
});

test("an existing install keeps the shield when its payload predates the setting", () => {
  // Absent must mean "as before", never "off": a silent downgrade of ad protection on upgrade
  // would be a protection the user never chose to drop.
  const upgraded = settings.normalizeSettings({ privacy: { blockAds: true } });
  assert.equal(upgraded.privacy.networkShield, true);
});

test("the shield is separable from structural suppression in both directions", () => {
  const domOnly = settings.normalizeSettings({
    privacy: { blockAds: true, networkShield: false }
  });
  assert.equal(domOnly.privacy.blockAds, true, "posts must stay hidden");
  assert.equal(domOnly.privacy.networkShield, false, "no request may be refused");

  const off = settings.normalizeSettings({ privacy: { blockAds: false, networkShield: true } });
  assert.equal(off.privacy.blockAds, false);
});

