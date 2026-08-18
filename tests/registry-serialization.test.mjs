import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Boot, the mutation observer, route changes and `requestApply` all fire `void applyAll(...)` with
 * no coordination, and `applyAll` awaits each feature -- so two passes used to interleave at every
 * await boundary. Features guard their work with module-level markers, and one pass would set a
 * marker that made the other skip the rescan it had been started for.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function context() {
  return {
    settings: {},
    route: { surface: "home", path: "/home" },
    diagnostics: { info() {}, warn() {}, error() {} }
  };
}

/** A feature that yields mid-apply, which is where the interleaving happened. */
function slowFeature(log) {
  return {
    id: "test.slow",
    title: "Slow",
    category: "core",
    init() {},
    destroy() {},
    async apply(_ctx, _root, addedNodes) {
      const label = addedNodes ? addedNodes[0] : "full";
      log.push(`enter:${label}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push(`exit:${label}`);
    }
  };
}

test("a second pass cannot start before the first finishes", async () => {
  const { FeatureRegistry } = await importBundledModule("src/features/registry.ts");
  const log = [];
  const registry = new FeatureRegistry();
  registry.register(slowFeature(log));
  const ctx = context();
  await registry.initAll(ctx);
  log.length = 0;

  // Three overlapping passes with distinct node batches, fired without awaiting -- exactly what
  // the observer does under a timeline scroll.
  await Promise.all([
    registry.applyAll(ctx, {}, ["a"]),
    registry.applyAll(ctx, {}, ["b"]),
    registry.applyAll(ctx, {}, ["c"])
  ]);

  assert.deepEqual(log, [
    "enter:a",
    "exit:a",
    "enter:b",
    "exit:b",
    "enter:c",
    "exit:c"
  ]);
});

test("node batches are never dropped, because nothing else would process them", async () => {
  const { FeatureRegistry } = await importBundledModule("src/features/registry.ts");
  const log = [];
  const registry = new FeatureRegistry();
  registry.register(slowFeature(log));
  const ctx = context();
  await registry.initAll(ctx);
  log.length = 0;

  await Promise.all(
    ["a", "b", "c", "d"].map((node) => registry.applyAll(ctx, {}, [node]))
  );

  const seen = log.filter((entry) => entry.startsWith("enter:")).map((entry) => entry.slice(6));
  assert.deepEqual(seen, ["a", "b", "c", "d"]);
});

test("redundant whole-document passes collapse into one", async () => {
  const { FeatureRegistry } = await importBundledModule("src/features/registry.ts");
  const log = [];
  const registry = new FeatureRegistry();
  registry.register(slowFeature(log));
  const ctx = context();
  await registry.initAll(ctx);
  log.length = 0;

  // A full pass supersedes another full pass, so queueing four of them behind one running pass is
  // four times the work for the same result. Route changes and requestApply can burst like this.
  const first = registry.applyAll(ctx, {});
  const rest = [
    registry.applyAll(ctx, {}),
    registry.applyAll(ctx, {}),
    registry.applyAll(ctx, {})
  ];
  await Promise.all([first, ...rest]);

  const fullPasses = log.filter((entry) => entry === "enter:full").length;
  assert.ok(fullPasses <= 2, `expected the burst to collapse, ran ${fullPasses} full passes`);
});

test("a feature that throws does not poison later passes", async () => {
  const { FeatureRegistry } = await importBundledModule("src/features/registry.ts");
  const log = [];
  const registry = new FeatureRegistry();
  registry.register({
    id: "test.throws",
    title: "Throws",
    category: "core",
    init() {},
    destroy() {},
    apply() {
      log.push("attempt");
      throw new Error("boom");
    }
  });
  const ctx = context();
  await registry.initAll(ctx);
  log.length = 0;

  // The chain is shared, so a rejection escaping it would silently disable every later apply.
  await registry.applyAll(ctx, {}, ["a"]);
  await registry.applyAll(ctx, {}, ["b"]);
  assert.deepEqual(log, ["attempt", "attempt"]);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-registry-serial-"));
  try {
    const outfile = path.join(temp, "module.mjs");
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      logLevel: "silent"
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
