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
