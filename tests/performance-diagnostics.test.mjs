import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

function context() {
  return {
    settings: {},
    route: { surface: "home", path: "/home" },
    diagnostics: { info() {}, warn() {}, error() {} }
  };
}

test("feature apply timing records full and incremental passes without page content", async () => {
  const { FeatureRegistry } = await importSourceModule("src/features/registry.ts");
  const registry = new FeatureRegistry();
  registry.register({
    id: "test.slow",
    title: "Slow",
    category: "core",
    init() {},
    destroy() {},
    async apply() {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  });
  const ctx = context();
  await registry.initAll(ctx);
  await registry.applyAll(ctx, {}, undefined);
  await registry.applyAll(ctx, {}, [{ nodeName: "ARTICLE", textContent: "private post text" }]);

  const snapshot = registry.performanceMetrics();
  assert.equal(snapshot.features.length, 1);
  assert.deepEqual(snapshot.features[0], {
    featureId: "test.slow",
    invocationCount: 2,
    totalDurationMs: snapshot.features[0].totalDurationMs,
    maxDurationMs: snapshot.features[0].maxDurationMs,
    fullPasses: 1,
    incrementalPasses: 1,
    longFrameCount: 0
  });
  assert.ok(snapshot.features[0].totalDurationMs >= 0);
  assert.equal(snapshot.recentPasses.map((pass) => pass.passType).join(","), "full,incremental");
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("private post text"), false);
  assert.equal(serialized.includes("ARTICLE"), false);
  assert.equal(serialized.includes("/home"), false);
});

test("the empty batch used by a 400-node overflow is recorded as a full pass", async () => {
  const { FeatureRegistry } = await importSourceModule("src/features/registry.ts");
  const registry = new FeatureRegistry();
  registry.register({
    id: "test.overflow",
    title: "Overflow",
    category: "core",
    init() {},
    destroy() {},
    apply() {}
  });
  const ctx = context();
  await registry.initAll(ctx);
  await registry.applyAll(ctx, {}, []);
  const metric = registry.performanceMetrics().features[0];
  assert.equal(metric.featureId, "test.overflow");
  assert.equal(metric.fullPasses, 1);
  assert.equal(metric.incrementalPasses, 0);
});

test("Long Animation Frame timing is correlated when the browser reports it", async () => {
  const { FeaturePerformanceDiagnostics } = await importSourceModule(
    "src/platform/performance-diagnostics.ts"
  );
  let callback;
  let disconnected = false;
  const observerFactory = class {
    static supportedEntryTypes = ["long-animation-frame"];

    constructor(next) {
      callback = next;
    }

    observe(options) {
      assert.deepEqual(options, { type: "long-animation-frame", buffered: true });
    }

    disconnect() {
      disconnected = true;
    }
  };
  const diagnostics = new FeaturePerformanceDiagnostics({ observerFactory });
  diagnostics.record("media.buttons", "incremental", 12, 100, 112);
  callback({ getEntries: () => [{ startTime: 105, duration: 40 }] });
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.longFrames.supported, true);
  assert.equal(snapshot.longFrames.observed, 1);
  assert.equal(snapshot.longFrames.correlatedPasses, 1);
  assert.equal(snapshot.features[0].longFrameCount, 1);
  diagnostics.destroy();
  assert.equal(disconnected, true);
});

test("unsupported Long Animation Frame timing is reported without throwing", async () => {
  const { FeaturePerformanceDiagnostics } = await importSourceModule(
    "src/platform/performance-diagnostics.ts"
  );
  const diagnostics = new FeaturePerformanceDiagnostics({ observerFactory: null });
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.longFrames.supported, false);
  assert.equal(snapshot.longFrames.observed, 0);
  assert.match(snapshot.longFrames.reason, /unavailable/i);
});

test("timing rings remain bounded and reset immediately", async () => {
  const { FeaturePerformanceDiagnostics } = await importSourceModule(
    "src/platform/performance-diagnostics.ts"
  );
  const diagnostics = new FeaturePerformanceDiagnostics({ observerFactory: null });
  for (let index = 0; index < 300; index += 1) {
    diagnostics.record(`test.feature${index}`, "full", 1, index, index + 1);
  }
  let snapshot = diagnostics.snapshot();
  assert.equal(snapshot.recentPasses.length, 256);
  assert.equal(snapshot.features.length, 128);
  diagnostics.reset();
  snapshot = diagnostics.snapshot();
  assert.deepEqual(snapshot.features, []);
  assert.deepEqual(snapshot.recentPasses, []);
  assert.equal(snapshot.longFrames.observed, 0);
});

test("20-run fixed registry benchmark stays within the instrumentation allowance", async () => {
  const { FeatureRegistry } = await importSourceModule("src/features/registry.ts", { fresh: true });
  const feature = {
    id: "test.benchmark",
    title: "Benchmark",
    category: "core",
    init() {},
    destroy() {},
    apply() {
      let value = 0;
      for (let index = 0; index < 50_000; index += 1) value = (value + index) % 997;
      return value;
    }
  };
  const ctx = context();
  const runRegistry = async (instrumentation) => {
    const registry = new FeatureRegistry({ instrumentation });
    registry.register(feature);
    await registry.initAll(ctx);
    const samples = [];
    for (let run = 0; run < 20; run += 1) {
      const started = performance.now();
      await registry.applyAll(ctx, {});
      samples.push(performance.now() - started);
    }
    return samples;
  };
  const disabled = await runRegistry(false);
  const enabled = await runRegistry(true);
  const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  const disabledMedian = median(disabled);
  const enabledMedian = median(enabled);
  const allowance = Math.max(disabledMedian * 0.05, 0.25);
  assert.ok(
    enabledMedian - disabledMedian <= allowance,
    `enabled median ${enabledMedian.toFixed(3)} ms vs disabled ${disabledMedian.toFixed(3)} ms exceeds ${allowance.toFixed(3)} ms allowance`
  );
});
