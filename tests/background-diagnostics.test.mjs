import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

const mod = await importSourceModule("src/extension/background-diagnostics.ts");

function memoryBackend(seed = undefined) {
  let value = seed;
  return {
    async get() {
      return value;
    },
    async put(_key, next) {
      value = structuredClone(next);
    },
    read() {
      return value;
    }
  };
}

test("the worker ring stores operation, severity, and time only", async () => {
  const backend = memoryBackend();
  mod.recordBackgroundDiagnostic(backend, "download-fallback", "error", "SECRET-URL https://x.com/private/video.mp4");
  await mod.flushBackgroundDiagnostics();

  const raw = JSON.stringify(backend.read());
  assert.equal(raw.includes("SECRET-URL"), false);
  assert.equal(raw.includes("private/video.mp4"), false);
  assert.deepEqual(Object.keys(backend.read().events[0]).sort(), ["at", "operation", "severity"]);
  assert.match(backend.read().events[0].at, /^\d{4}-\d\d-\d\dT/);
});

test("invalid worker values are rejected or replaced without retaining sentinels", async () => {
  const backend = memoryBackend();
  mod.recordBackgroundDiagnostic(backend, "SECRET-provider-message", "error", "SECRET-exception");
  mod.recordBackgroundDiagnostic(backend, "context-menu-download", "error", "SECRET-filename.mp4");
  await mod.flushBackgroundDiagnostics();

  const raw = JSON.stringify(backend.read());
  for (const secret of ["SECRET-provider-message", "SECRET-exception", "SECRET-filename.mp4"]) {
    assert.equal(raw.includes(secret), false, `worker diagnostics leaked ${secret}`);
  }
  assert.equal(backend.read().events.length, 1);
  assert.equal(backend.read().events[0].operation, "context-menu-download");
});

test("the worker ring is bounded and parser drops malformed records", async () => {
  const backend = memoryBackend();
  for (let index = 0; index < mod.BACKGROUND_DIAGNOSTICS_LIMIT + 8; index += 1) {
    mod.recordBackgroundDiagnostic(backend, "download-completion", "warn", new Date(2026, 0, 1, 0, index).toISOString());
  }
  await mod.flushBackgroundDiagnostics();
  const parsed = mod.parseBackgroundDiagnostics({
    version: 1,
    events: [
      ...backend.read().events,
      { operation: "bad value", severity: "error", at: "SECRET" },
      { operation: "download-fallback", severity: "error", at: "2026-01-01T00:00:00.000Z" }
    ]
  });
  assert.equal(parsed.length, mod.BACKGROUND_DIAGNOSTICS_LIMIT);
  assert.equal(parsed.some((entry) => entry.at === "SECRET"), false);
  assert.equal(parsed.at(-1).operation, "download-fallback");
});
