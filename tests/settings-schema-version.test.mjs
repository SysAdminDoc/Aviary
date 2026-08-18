import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let mod;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-settings-version-"));
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
  mod = await import(pathToFileURL(outfile).href);
});

after(async () => {
  await rm(temp, { recursive: true, force: true });
});

test("every persisted payload is stamped with the current schema version", () => {
  assert.equal(mod.DEFAULT_SETTINGS.schemaVersion, mod.SETTINGS_SCHEMA_VERSION);
  assert.equal(mod.normalizeSettings({}).schemaVersion, mod.SETTINGS_SCHEMA_VERSION);
  // A payload claiming some other version is still written back at this build's version.
  assert.equal(mod.normalizeSettings({ schemaVersion: 99 }).schemaVersion, mod.SETTINGS_SCHEMA_VERSION);
});

test("an unversioned payload upgrades without losing settings", () => {
  const legacy = { appearance: { theme: "noir" }, layout: { hideTrends: true } };
  const envelope = mod.readSettingsEnvelope(legacy);
  assert.equal(envelope.fromVersion, null, "a pre-versioning payload declares nothing");
  assert.equal(envelope.fromFuture, false);
  assert.equal(envelope.settings.schemaVersion, mod.SETTINGS_SCHEMA_VERSION);
  assert.equal(envelope.settings.appearance.theme, "noir", "existing choices must survive");
  assert.equal(envelope.settings.layout.hideTrends, true);
});

test("a payload from a newer Aviary is flagged rather than silently downgraded", () => {
  const future = mod.readSettingsEnvelope({
    schemaVersion: mod.SETTINGS_SCHEMA_VERSION + 5,
    appearance: { theme: "noir" },
    somethingThisBuildHasNeverHeardOf: { enabled: true }
  });
  assert.equal(future.fromFuture, true, "a newer payload must be recognised as newer");
  assert.equal(future.fromVersion, mod.SETTINGS_SCHEMA_VERSION + 5);
  assert.deepEqual(future.applied, [], "no migration step may run against an unknown future shape");
  // Runtime still needs usable values.
  assert.equal(future.settings.appearance.theme, "noir");
});

test("the ladder is well formed: every step reaches the current version", () => {
  // A gap would silently stop the loop and leave a payload half-migrated.
  const envelope = mod.readSettingsEnvelope({ schemaVersion: 1 });
  assert.equal(envelope.settings.schemaVersion, mod.SETTINGS_SCHEMA_VERSION);
  assert.equal(envelope.fromFuture, false);
});

test("garbage payloads normalize to defaults instead of throwing", () => {
  for (const input of [null, undefined, 7, "settings", [], { schemaVersion: "one" }]) {
    const envelope = mod.readSettingsEnvelope(input);
    assert.equal(envelope.settings.schemaVersion, mod.SETTINGS_SCHEMA_VERSION);
    assert.equal(envelope.settings.appearance.theme, mod.DEFAULT_SETTINGS.appearance.theme);
  }
});

test("bumping the schema version requires a matching migration step", async () => {
  // The ladder is only useful if it is filled in. If a future change bumps the constant without
  // adding the step that performs it, an upgrade would leave settings at the older shape.
  const source = await readFile(path.join(root, "src/platform/settings.ts"), "utf8");
  const declared = Number(source.match(/SETTINGS_SCHEMA_VERSION = (\d+)/)?.[1]);
  assert.equal(declared, mod.SETTINGS_SCHEMA_VERSION);
  for (let version = 1; version < declared; version++) {
    assert.match(
      source,
      new RegExp(`SETTINGS_MIGRATIONS[\\s\\S]*?\\b${version}\\s*:`),
      `schema version ${declared} needs a SETTINGS_MIGRATIONS step for ${version}`
    );
  }
});

test("the v1 budget migration carries an unlimited budget instead of inverting it", () => {
  const { readSettingsEnvelope, INTEGRATION_BUDGET_CEILINGS } = mod;

  // v1 documented 0 as "no bound". v2 reads 0 as zero and blocks, so a stored 0 has to be carried
  // to the ceiling -- normalizing it unchanged would silently turn "unlimited" into "blocked".
  const stored = {
    schemaVersion: 1,
    integrations: {
      ai: { maxRequestBytes: 0, dailyRequestBytes: 0 },
      semanticSearch: { maxRecordBytes: 0, dailyRecordBytes: 12345 }
    }
  };

  const envelope = readSettingsEnvelope(stored);
  assert.deepEqual(envelope.applied, [1]);
  assert.equal(envelope.fromVersion, 1);
  assert.equal(envelope.fromFuture, false);

  const ai = envelope.settings.integrations.ai;
  assert.equal(ai.maxRequestBytes, INTEGRATION_BUDGET_CEILINGS.ai.maxRequestBytes);
  assert.equal(ai.dailyRequestBytes, INTEGRATION_BUDGET_CEILINGS.ai.dailyRequestBytes);

  const semantic = envelope.settings.integrations.semanticSearch;
  assert.equal(semantic.maxRecordBytes, INTEGRATION_BUDGET_CEILINGS.semanticSearch.maxRecordBytes);
  // A budget the user actually chose is left exactly alone.
  assert.equal(semantic.dailyRecordBytes, 12345);
});

test("an unversioned payload still runs the ladder rather than being assumed current", () => {
  const { readSettingsEnvelope, INTEGRATION_BUDGET_CEILINGS } = mod;

  // Defaulting an absent version to the *current* version skipped every step the moment the ladder
  // gained one -- which is precisely when an old payload most needs migrating.
  const envelope = readSettingsEnvelope({
    integrations: { ai: { maxRequestBytes: 0, dailyRequestBytes: 0 } }
  });

  assert.deepEqual(envelope.applied, [1]);
  assert.equal(
    envelope.settings.integrations.ai.dailyRequestBytes,
    INTEGRATION_BUDGET_CEILINGS.ai.dailyRequestBytes
  );
});
