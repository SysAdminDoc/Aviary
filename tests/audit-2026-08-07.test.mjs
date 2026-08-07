import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("an unchanged apply does not invalidate every article's processed stamp", async () => {
  const source = await readFile(path.join(root, "src/features/filtering/filter-engine.ts"), "utf8");

  // `generation` is both the compile id and the per-article stamp. Bumping it on every apply
  // meant the stamp check could never hit, so the whole visible timeline was re-extracted on
  // every mutation batch (~120ms while scrolling).
  const refresh = source.slice(
    source.indexOf("function refreshCompiled"),
    source.indexOf("function filterSignature")
  );
  assert.match(refresh, /signature === compiledSignature/);
  assert.match(refresh, /return;/);
  const bumpIndex = refresh.indexOf("generation += 1");
  const guardIndex = refresh.indexOf("return;");
  assert.ok(guardIndex < bumpIndex, "the early return must come before the generation bump");
});

test("filter recompiles when the rules change and not when they do not", async () => {
  const { compileFilters, decide } = await importBundledModule(
    "src/features/filtering/predicates.ts"
  );

  // The signature covers exactly the inputs compileFilters consumes; if a new input is added to
  // one and not the other, a settings change would stop taking effect. This pins that pairing.
  const engine = await readFile(path.join(root, "src/features/filtering/filter-engine.ts"), "utf8");
  const signature = engine.slice(engine.indexOf("function filterSignature"), engine.indexOf("function scanRoot"));
  for (const field of ["keywordRules", "regexRules", "whitelist", "premiumRule", "mediaTypes", "enabled"]) {
    assert.match(signature, new RegExp(`filter\\.${field}\\b`), `${field} missing from the signature`);
  }

  const base = {
    keywords: [],
    regex: [],
    whitelist: [],
    premium: "off",
    media: { photo: false, video: false, gif: false },
    generation: 1
  };
  const before = compileFilters(base);
  const after = compileFilters({ ...base, keywords: ["spam"], generation: 2 });
  const signal = { text: "this is spam", handle: "someone", premium: false, media: { photo: false, video: false, gif: false } };
  assert.equal(decide(signal, before), "show");
  assert.equal(decide(signal, after), "hide");
});

test("a corrupted stored value is reported instead of silently reading as unset", async () => {
  const { createStorageGateway, setStorageErrorSink } = await importBundledModule(
    "src/platform/storage.ts"
  );

  const reports = [];
  setStorageErrorSink((key, error, op) => reports.push({ key, op, message: String(error) }));

  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => "{not json",
    setItem: () => undefined,
    removeItem: () => undefined
  };
  try {
    const gateway = createStorageGateway("aviary");
    const value = await gateway.get("aviary.settings.v1", { fallback: true });
    // Still non-throwing: a bad read must not take the boot down.
    assert.deepEqual(value, { fallback: true });
  } finally {
    globalThis.localStorage = original;
    setStorageErrorSink(undefined);
  }

  assert.equal(reports.length, 1, "a failed read must reach the sink exactly once");
  assert.equal(reports[0].op, "read");
  assert.equal(reports[0].key, "aviary.settings.v1");
});

test("settings persistence has a single choke point that normalizes", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  const panel = await readFile(path.join(root, "src/features/core/control-center.ts"), "utf8");

  // Panel toggles used to persist whatever was in memory while import/preset/locale persisted
  // normalized values -- two write paths with different guarantees.
  assert.match(main, /storage\.set\(SETTINGS_KEY, normalizeSettings\(cloneSettings\(settings\)\)\)/);
  assert.ok(
    !/storage\.set\(SETTINGS_KEY/.test(panel),
    "the panel must persist settings through ctx.saveSettings, not directly"
  );
  for (const handler of ["importSettings", "applyPreset", "setLocale"]) {
    // Anchored on the method definition -- the bare name also appears in the import list.
    const start = panel.indexOf(`async ${handler}(`);
    assert.ok(start > -1, `${handler} handler not found`);
    assert.match(panel.slice(start, start + 900), /ctx\.saveSettings\(\)/, `${handler} bypasses the choke point`);
  }
});

test("an out-of-range value cannot reach storage through saveSettings", async () => {
  const { normalizeSettings, DEFAULT_SETTINGS, cloneSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );

  // What saveSettings now does, with a value a future handler could plausibly set.
  const settings = cloneSettings(DEFAULT_SETTINGS);
  settings.media.zipChunkSize = 999999;
  settings.appearance.theme = "not-a-theme";

  const persisted = normalizeSettings(cloneSettings(settings));
  assert.ok(persisted.media.zipChunkSize <= 1000, "the chunk size must be clamped before it is stored");
  assert.equal(persisted.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit0807-"));
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
    await rm(temp, { recursive: true, force: true });
  }
}
