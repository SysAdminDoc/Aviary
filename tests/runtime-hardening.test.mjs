import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("normalizeSettings rejects corrupted and oversized persisted values", async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await importBundledModule("src/platform/settings.ts");
  const oversizedRules = Array.from({ length: 260 }, (_, index) => `  keyword-${index}\u0000  `);
  const normalized = normalizeSettings({
    appearance: {
      theme: "light",
      denseMode: "yes",
      timelineWidth: "cinema"
    },
    layout: {
      hideNavItems: ["home", "home", "premium", "x".repeat(90)]
    },
    filter: {
      keywordRules: oversizedRules,
      regexRules: oversizedRules,
      mediaTypes: {
        photo: true,
        gif: false,
        "__proto__": true,
        "bad key": true
      }
    },
    media: {
      filenameTemplate: `  ${"x".repeat(220)}  `,
      zipChunkSize: 5000
    },
    jobs: {
      concurrentDownloads: 20,
      rateLimitMode: "turbo"
    },
    export: {
      formats: ["json", "exe", "json", "xlsx"]
    },
    privacy: {
      telemetry: true
    }
  });

  assert.equal(normalized.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
  assert.equal(normalized.appearance.denseMode, DEFAULT_SETTINGS.appearance.denseMode);
  assert.equal(normalized.appearance.timelineWidth, DEFAULT_SETTINGS.appearance.timelineWidth);
  assert.deepEqual(normalized.layout.hideNavItems, ["home", "premium", "x".repeat(48)]);
  assert.equal(normalized.filter.keywordRules.length, 200);
  assert.equal(normalized.filter.regexRules.length, 100);
  assert.ok(normalized.filter.keywordRules.every((rule) => !rule.includes("\u0000")));
  assert.deepEqual(normalized.filter.mediaTypes, { photo: true, video: false, gif: false });
  assert.equal(Object.hasOwn(normalized.filter.mediaTypes, "__proto__"), false);
  assert.deepEqual(normalized.filter.surfaces, DEFAULT_SETTINGS.filter.surfaces);
  assert.equal(normalized.filter.selfRepost, DEFAULT_SETTINGS.filter.selfRepost);
  assert.equal(normalized.media.filenameTemplate.length, 160);
  assert.equal(normalized.media.zipChunkSize, 1000);
  assert.equal(normalized.jobs.concurrentDownloads, 6);
  assert.equal(normalized.jobs.rateLimitMode, DEFAULT_SETTINGS.jobs.rateLimitMode);
  assert.deepEqual(normalized.export.formats, ["json", "xlsx"]);
  assert.equal(normalized.privacy.telemetry, false);
});

test("storage reads fall back safely but writes fail loudly without a backend", async () => {
  const restore = [
    overrideGlobal("GM_getValue", undefined),
    overrideGlobal("GM_setValue", undefined),
    overrideGlobal("GM_deleteValue", undefined),
    overrideGlobal("chrome", undefined),
    overrideGlobal("localStorage", undefined)
  ];

  try {
    const { createStorageGateway } = await importBundledModule("src/platform/storage.ts");
    const storage = createStorageGateway("test");
    const fallback = { ok: true };

    assert.deepEqual(await storage.get("settings", fallback), fallback);
    await assert.rejects(() => storage.set("settings", { ok: false }), /No storage backend is available/);
    await assert.rejects(() => storage.remove("settings"), /No storage backend is available/);
  } finally {
    for (const restoreGlobal of restore.reverse()) {
      restoreGlobal();
    }
  }
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-runtime-"));
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

function overrideGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete globalThis[name];
    }
  };
}
