import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("listPresets and applyPreset mutate the expected sections", async () => {
  const { listPresets, getPreset, applyPreset, describePresetDelta } = await importSourceModule(
    "src/features/core/presets.ts"
  );
  const { DEFAULT_SETTINGS } = await importSourceModule("src/platform/settings.ts");

  const presets = listPresets();
  assert.ok(presets.length >= 6);
  for (const preset of presets) {
    assert.ok(preset.label.length > 0);
    assert.ok(preset.description.length > 0);
  }

  const archivist = getPreset("media-archivist");
  assert.ok(archivist);
  const next = applyPreset(DEFAULT_SETTINGS, archivist);
  // Media Archivist set media.sensitive to "blur" and described it as "sensitive blur". Those
  // rules reached every photo and video, not only sensitive ones, so the preset blurred the whole
  // timeline. The mode was removed outright in v1.13.0 — Aviary leaves sensitive media to X.
  assert.equal("sensitive" in next.media, false, "the sensitive mode must stay gone");
  assert.equal(next.media.layout, "stacked");
  assert.equal(next.appearance.theme, "lightsOut");

  const delta = describePresetDelta(DEFAULT_SETTINGS, archivist);
  assert.ok(delta.length > 0);
  assert.ok(delta.some((line) => line.includes("appearance.theme")));
});

test("i18n bundle exposes locales, translates with fallback, and reports direction", async () => {
  const { translate, supportedLocales, localeDirection } = await importSourceModule(
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
  const { CleanupQueue } = await importSourceModule("src/features/library/cleanup-queue.ts");
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
