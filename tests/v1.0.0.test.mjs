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

/**
 * This used to cover `translate(locale, key)` as well.
 *
 * That was a second, symbolic-key translation system that nothing in `src/` called: the panel and
 * every feature go through `translateText` and the gettext-style catalog, whose coverage the suite
 * holds at 100% per locale. It was not merely unused but misleading -- visibly incomplete beside
 * the one that ships, and preserving product language the live UI no longer uses. esbuild had
 * already tree-shaken it out of the bundle, so this test was the only thing keeping it alive.
 *
 * The parts that are real -- the locale list and the direction lookup -- are still covered here,
 * and `tests/i18n.test.mjs` covers the lookup that actually renders.
 */
test("i18n bundle exposes locales and reports direction", async () => {
  const { supportedLocales, localeDirection, translateText } = await importSourceModule(
    "src/platform/i18n.ts"
  );

  const locales = supportedLocales();
  assert.ok(locales.length >= 7);
  assert.ok(locales.some((entry) => entry.direction === "rtl"));

  // The lookup that does ship: the English source string is the key, and an unknown one degrades
  // to itself rather than to an empty box.
  assert.equal(translateText("en", "Appearance"), "Appearance");
  assert.equal(translateText("es", "Appearance"), "Apariencia");
  assert.equal(translateText("ja", "no such string in any catalog"), "no such string in any catalog");

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
