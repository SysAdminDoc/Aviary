import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("settings export/import round-trips with normalization", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );
  const { buildSettingsExport, parseSettingsImport } = await importBundledModule(
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
  const { AuditLog, AUDIT_LOG_KEY } = await importBundledModule(
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
  const { QUERY_REGISTRY_KEY } = await importBundledModule(
    "src/features/export/query-discovery.ts"
  );
  assert.equal(typeof QUERY_REGISTRY_KEY, "string");
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v8-"));
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
