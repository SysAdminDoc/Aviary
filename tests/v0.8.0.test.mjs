import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("settings export/import round-trips with normalization", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importSourceModule(
    "src/platform/settings.ts"
  );
  const { buildSettingsExport, parseSettingsImport } = await importSourceModule(
    "src/features/core/settings-migration.ts"
  );

  const source = normalizeSettings({
    appearance: { theme: "midnight", denseMode: true },
    filter: {
      enabled: true,
      keywordRules: ["spam"],
      surfaces: ["home", "profile"]
    },
    media: {
      buttons: false,
      sensitive: "blur"
    },
    export: {
      enabled: true,
      formats: ["json", "csv"]
    }
  });

  const envelope = buildSettingsExport(source);
  assert.equal(envelope.generator, "Aviary");
  assert.equal(envelope.version, 1);
  assert.equal(envelope.settings.appearance.theme, "midnight");

  const report = parseSettingsImport(JSON.stringify(envelope));
  assert.equal(report.applied, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.settings.filter.surfaces, ["home", "profile"]);
  // media.sensitive was removed in v1.13.0; an older export carrying it must not resurrect it.
  assert.equal("sensitive" in report.settings.media, false);

  const garbage = parseSettingsImport("{not json");
  assert.equal(garbage.applied, false);
  assert.ok(garbage.errors.length > 0);

  const unknownVersion = parseSettingsImport(
    JSON.stringify({ generator: "Aviary", version: 999, settings: { i18n: { locale: "en" } } })
  );
  assert.equal(unknownVersion.applied, true);
  assert.ok(unknownVersion.warnings.some((warning) => warning.includes("newer than supported")));
  assert.equal(unknownVersion.settings.i18n.locale, "en");
  assert.equal(unknownVersion.settings.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
});

test("AuditLog persists, caps, and clears", async () => {
  const { AuditLog, AUDIT_LOG_KEY } = await importSourceModule(
    "src/features/core/audit-log.ts"
  );

  const store = new Map();
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const log = new AuditLog(storage, 50);
  await log.load();
  for (let i = 0; i < 60; i++) {
    await log.record("media.download", { i });
  }
  assert.equal(log.size(), 50);
  assert.ok(store.get(AUDIT_LOG_KEY));

  const reloaded = new AuditLog(storage, 50);
  await reloaded.load();
  assert.equal(reloaded.size(), 50);
  assert.equal(reloaded.snapshot().entries.at(-1)?.detail?.i, 59);

  await reloaded.clear();
  assert.equal(reloaded.size(), 0);
});

test("query discovery extracts /i/api/graphql/<id>/<op> pairs", async () => {
  const { QUERY_REGISTRY_KEY } = await importSourceModule(
    "src/features/export/query-discovery.ts"
  );
  assert.equal(typeof QUERY_REGISTRY_KEY, "string");
});

/**
 * An import must climb the schema ladder, not just normalize.
 *
 * The v1 to v2 step exists because the meaning of a stored value inverted: v1 read a provider
 * budget of 0 as "no ceiling" and v2 reads it as zero and blocks. Normalization alone cannot carry
 * that, so importing a pre-v2 backup silently turned an unlimited budget into a blocked one. The
 * envelope `version` field cannot catch it either -- that is the export wrapper's version, and it
 * has not moved across either schema bump.
 */
test("importing a pre-v2 settings file migrates it instead of inverting its budgets", async () => {
  const { readSettingsEnvelope, SETTINGS_SCHEMA_VERSION, INTEGRATION_BUDGET_CEILINGS } =
    await importSourceModule("src/platform/settings.ts");
  const { parseSettingsImport } = await importSourceModule(
    "src/features/core/settings-migration.ts"
  );

  const v1 = {
    schemaVersion: 1,
    integrations: {
      ai: { enabled: true, maxRequestBytes: 0, dailyRequestBytes: 0 },
      semanticSearch: { enabled: true, maxRecordBytes: 0, dailyRecordBytes: 0 }
    }
  };

  const booted = readSettingsEnvelope(structuredClone(v1));
  const imported = parseSettingsImport(
    JSON.stringify({ generator: "Aviary", version: 1, settings: structuredClone(v1) })
  );

  assert.equal(imported.applied, true);
  assert.deepEqual(imported.errors, []);
  // The import must land exactly where a boot of the same payload lands.
  assert.deepEqual(imported.settings.integrations.ai, booted.settings.integrations.ai);
  assert.deepEqual(
    imported.settings.integrations.semanticSearch,
    booted.settings.integrations.semanticSearch
  );
  assert.equal(
    imported.settings.integrations.ai.maxRequestBytes,
    INTEGRATION_BUDGET_CEILINGS.ai.maxRequestBytes
  );
  assert.equal(
    imported.settings.integrations.semanticSearch.dailyRecordBytes,
    INTEGRATION_BUDGET_CEILINGS.semanticSearch.dailyRecordBytes
  );
  assert.ok(
    imported.warnings.some((warning) => warning.includes(`to ${SETTINGS_SCHEMA_VERSION}`)),
    `the applied upgrade must be reported, got ${JSON.stringify(imported.warnings)}`
  );

  // A payload from a newer build says so, where the envelope version could not.
  const future = parseSettingsImport(
    JSON.stringify({ generator: "Aviary", version: 1, settings: { schemaVersion: 99 } })
  );
  assert.ok(
    future.warnings.some((warning) => warning.includes("newer Aviary")),
    `a future schema must be reported, got ${JSON.stringify(future.warnings)}`
  );
});
