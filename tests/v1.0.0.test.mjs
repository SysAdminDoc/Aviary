import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("listPresets and applyPreset mutate the expected sections", async () => {
  const { listPresets, getPreset, applyPreset, describePresetDelta } = await importBundledModule(
    "src/features/core/presets.ts"
  );
  const { DEFAULT_SETTINGS } = await importBundledModule("src/platform/settings.ts");

  const presets = listPresets();
  assert.ok(presets.length >= 6);
  for (const preset of presets) {
    assert.ok(preset.label.length > 0);
    assert.ok(preset.description.length > 0);
  }

  const archivist = getPreset("media-archivist");
  assert.ok(archivist);
  const next = applyPreset(DEFAULT_SETTINGS, archivist);
  assert.equal(next.media.sensitive, "blur");
  assert.equal(next.media.layout, "stacked");
  assert.equal(next.appearance.theme, "lightsOut");

  const delta = describePresetDelta(DEFAULT_SETTINGS, archivist);
  assert.ok(delta.length > 0);
  assert.ok(delta.some((line) => line.includes("appearance.theme")));
});

test("i18n bundle exposes locales, translates with fallback, and reports direction", async () => {
  const { translate, supportedLocales, localeDirection } = await importBundledModule(
    "src/platform/i18n.ts"
  );

  const locales = supportedLocales();
  assert.ok(locales.length >= 7);
  assert.ok(locales.some((entry) => entry.direction === "rtl"));

  assert.equal(translate("en", "section.appearance"), "Appearance");
  assert.equal(translate("es", "section.appearance"), "Apariencia");
  assert.equal(translate("ja", "section.appearance"), "外観");
  // Missing key falls back to the English bundle.
  assert.equal(translate("ja", "ui.exportVisible"), "Export visible tweets");

  assert.equal(localeDirection("ar"), "rtl");
  assert.equal(localeDirection("en"), "ltr");
  assert.equal(localeDirection("xx"), "ltr");
});

test("CleanupQueue is read-only by policy and respects protected items", async () => {
  const { CleanupQueue } = await importBundledModule("src/features/library/cleanup-queue.ts");
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

  const queue = new CleanupQueue(storage);
  await queue.load();
  const added = await queue.enqueue([
    { bucket: "tweets", tweetId: "1", handle: "alpha", text: "ok", permalink: null, reason: "x", protected: false },
    { bucket: "tweets", tweetId: "2", handle: "beta", text: "skip", permalink: null, reason: "x", protected: true }
  ]);
  assert.equal(added, 1);
  assert.equal(queue.list().length, 1);
  assert.equal(queue.list("queued")[0].handle, "alpha");

  await queue.setStatus(queue.list()[0].id, "approved", "looks safe");
  assert.equal(queue.list("approved").length, 1);

  // Reload through a new instance to confirm persistence.
  const reloaded = new CleanupQueue(storage);
  await reloaded.load();
  assert.equal(reloaded.list("approved").length, 1);

  assert.equal(queue.destructiveAllowed(), false, "destructive action stays disabled by policy");

  await queue.clear();
  assert.equal(queue.size(), 0);
});

test("mobile-touch + i18n features ship with class invariants", async () => {
  const mobile = await import("node:fs/promises").then((fs) =>
    fs.readFile(path.join(root, "src/features/core/mobile-touch.ts"), "utf8")
  );
  for (const marker of ["av-touch", "av-mobile", "matchMedia", "destroy"]) {
    assert.ok(mobile.includes(marker), `mobile-touch missing ${marker}`);
  }

  const i18n = await import("node:fs/promises").then((fs) =>
    fs.readFile(path.join(root, "src/features/core/i18n-feature.ts"), "utf8")
  );
  for (const marker of ["av-rtl", "av-ltr", "avLocale", "destroy"]) {
    assert.ok(i18n.includes(marker), `i18n-feature missing ${marker}`);
  }
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v100-"));
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
