import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readControlCenterSource = async () =>
  (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/advanced.ts",
      "src/ui/control-center/sections/data.ts",
      "src/ui/control-center/sections/presets.ts",
      "src/ui/control-center/sections/reading.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");

test("exported settings redact credentials but keep every preference", async () => {
  const { buildSettingsExport, REDACTED_SECRET } = await importBundledModule(
    "src/features/core/settings-migration.ts"
  );
  const { normalizeSettings } = await importBundledModule("src/platform/settings.ts");

  const settings = normalizeSettings({
    appearance: { theme: "plum" },
    integrations: {
      aria2: { endpoint: "http://localhost:6800", secret: "aria-secret" },
      bluesky: { handle: "me.bsky.social", appPassword: "abcd-efgh-ijkl-mnop" },
      mastodon: { instance: "https://mastodon.social", token: "mastodon-token-value" },
      ai: { apiKey: "sk-ant-secret", model: "claude" },
      semanticSearch: { apiKey: "embed-key", endpoint: "https://api.example.com", model: "m" }
    }
  });

  const envelope = buildSettingsExport(settings);
  const serialized = JSON.stringify(envelope);

  for (const secret of [
    "aria-secret",
    "abcd-efgh-ijkl-mnop",
    "mastodon-token-value",
    "sk-ant-secret",
    "embed-key"
  ]) {
    assert.ok(!serialized.includes(secret), `${secret} must not appear in an exported settings file`);
  }

  assert.equal(envelope.secretsRedacted, true);
  assert.equal(envelope.settings.integrations.ai.apiKey, REDACTED_SECRET);
  // Non-secret configuration must survive so the file is still a useful backup.
  assert.equal(envelope.settings.appearance.theme, "plum");
  assert.equal(envelope.settings.integrations.bluesky.handle, "me.bsky.social");
  assert.equal(envelope.settings.integrations.aria2.endpoint, "http://localhost:6800");

  // Opt-in escape hatch still works for a full machine migration.
  const full = buildSettingsExport(settings, { includeSecrets: true });
  assert.equal(full.settings.integrations.ai.apiKey, "sk-ant-secret");
  assert.equal(full.secretsRedacted, false);
});

test("importing a redacted file keeps locally stored credentials", async () => {
  const { buildSettingsExport, parseSettingsImport, REDACTED_SECRET } = await importBundledModule(
    "src/features/core/settings-migration.ts"
  );
  const { normalizeSettings } = await importBundledModule("src/platform/settings.ts");

  const current = normalizeSettings({
    integrations: {
      ai: { apiKey: "sk-local-key", model: "claude" },
      bluesky: { appPassword: "local-app-password", handle: "me.bsky.social" }
    }
  });
  const envelope = buildSettingsExport(
    normalizeSettings({
      appearance: { theme: "midnight" },
      integrations: { ai: { apiKey: "sk-other-machine", model: "claude" } }
    })
  );

  const report = parseSettingsImport(JSON.stringify(envelope), current);
  assert.equal(report.applied, true);
  assert.equal(report.settings.appearance.theme, "midnight", "preferences still apply");
  assert.equal(report.settings.integrations.ai.apiKey, "sk-local-key", "local key is preserved");
  assert.notEqual(report.settings.integrations.ai.apiKey, REDACTED_SECRET);
  assert.ok(
    report.warnings.some((warning) => /redacted/i.test(warning)),
    "the user is told why credentials were not replaced"
  );

  // With no local settings to fall back on, the placeholder must not be stored verbatim.
  const blind = parseSettingsImport(JSON.stringify(envelope));
  assert.equal(blind.settings.integrations.ai.apiKey, "");
});

test("an export with nothing captured produces no file and says so", async () => {
  const source = await readFile(path.join(root, "src/features/export/export-feature.ts"), "utf8");
  const ui = await readControlCenterSource();

  // An export now yields a list of archives (media.zipChunkSize can split it), so "no file"
  // is an empty list rather than a null artifact.
  assert.match(source, /records\.length === 0\s*\?\s*\[\]/);
  assert.match(ui, /No posts found on this view/);
  // Long operations announce themselves before awaiting.
  assert.match(ui, /setStatus\("Collecting visible posts…"\)/);
  assert.match(ui, /setStatus\("Downloading media from this view…"\)/);
  assert.match(ui, /setStatus\("Building report…"\)/);
});

test("user-facing copy does not advertise shipped features as unavailable", async () => {
  const ui = await readControlCenterSource();
  const exportFeature = await readFile(path.join(root, "src/features/export/export-feature.ts"), "utf8");

  // xlsx is in the supported list and has a working writer.
  assert.match(exportFeature, /"xlsx"/);
  assert.ok(!/xlsx is deferred/.test(ui), "the xlsx format label was stale");
  assert.ok(!/off until F091 lands/.test(ui), "raw payload capture is implemented");
  assert.ok(!/Disabled by policy in v1\.0\.0/.test(ui), "policy copy must not pin a stale version");

  // Import affordance names its own action rather than another row's button.
  assert.ok(!/press Save list to apply/.test(ui));
  assert.match(ui, /"Import"\n?\s*\)/);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit-ux-"));
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
