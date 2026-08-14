import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundleSettings() {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-readme-"));
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
  return pathToFileURL(outfile).href;
}

// A README sentence describing a setting's default is a claim about DEFAULT_SETTINGS.
// Guard the class rather than the instance: any elective capability that is off by
// default must not be described as unconditionally present, and any capability the
// README calls default-on must actually be enabled in the schema.
const DEFAULT_ON = [
  ["privacy.blockAds", (settings) => settings.privacy.blockAds],
  ["media.buttons", (settings) => settings.media.buttons]
];

const DEFAULT_OFF = [
  ["ai.commandMenu", (settings) => settings.ai.commandMenu],
  ["appearance.theme", (settings) => settings.appearance.theme !== "off"],
  ["export.preserveRawPayloads", (settings) => settings.export.preserveRawPayloads],
  ["performance.pauseOffscreenVideo", (settings) => settings.performance.pauseOffscreenVideo]
];

test("README default-state claims match DEFAULT_SETTINGS", async () => {
  const { DEFAULT_SETTINGS } = await import(await bundleSettings());
  const readme = await readFile(path.join(root, "README.md"), "utf8");

  for (const [key, read] of DEFAULT_ON) {
    assert.equal(read(DEFAULT_SETTINGS), true, `${key} is documented as default-on but ships disabled`);
  }
  for (const [key, read] of DEFAULT_OFF) {
    assert.equal(read(DEFAULT_SETTINGS), false, `${key} ships enabled but the README documents it as elective`);
  }

  // The AI command menu is default-off and its provider runner does make requests.
  // Both facts have been wrong in this file before; keep them stated together.
  const aiLine = readme.split("\n").find((line) => line.includes("Local AI command menu"));
  assert.ok(aiLine, "README no longer documents the AI command menu");
  assert.match(aiLine, /off by default/i, "the AI command menu must be described as off by default");
  assert.doesNotMatch(
    aiLine,
    /each tweet's action row gets an AI button\./,
    "the AI button is not unconditionally present; it requires enabling the feature"
  );

  // "No network calls" may only describe the prompt-builder, never the whole feature,
  // because the provider runner POSTs to Anthropic/OpenAI once configured.
  const noNetworkClaims = readme
    .split("\n")
    .filter((line) => /no network calls/i.test(line) && /AI/.test(line));
  for (const line of noNetworkClaims) {
    assert.match(
      line,
      /on its own|prompt builder|without a key|no api key/i,
      `unqualified "no network calls" AI claim: ${line.trim()}`
    );
  }
});

test("README does not claim a store presence Aviary does not have", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const firefoxManifest = JSON.parse(
    await readFile(path.join(root, "src/extension/manifest.firefox.json"), "utf8")
  );
  const addonId = firefoxManifest.browser_specific_settings?.gecko?.id ?? "";
  const placeholderId = addonId.endsWith(".local") || addonId.includes("example");

  if (placeholderId) {
    assert.doesNotMatch(
      readme,
      /store-ready archives\.$/m,
      "the Firefox manifest still carries a placeholder id, so archives are not store-ready"
    );
    assert.match(
      readme,
      /placeholder add-on id/i,
      "README must disclose the placeholder Firefox id while one is shipped"
    );
  }
});
