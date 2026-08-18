import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function bundleSettings() {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-claims-"));
  const outfile = path.join(temp, "settings.mjs");
  await build({
    entryPoints: [path.join(root, "src/platform/settings.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  return `${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`;
}

// The "a filter action nothing reads must default to off" rule moved to
// tests/filter-engine-work.test.mjs, where the engine can be asked whether it reads one instead of
// the features directory being grepped for the key.

/**
 * `privacy.encryptVault` was removed in v1.12.0 rather than implemented. Settings files exported
 * by any earlier build still carry it, and importing one must neither throw nor smuggle the key
 * back into the live settings object.
 */
test("a settings file from an older build imports without its removed keys", async () => {
  const { normalizeSettings } = await import(await bundleSettings());
  const legacy = {
    privacy: { localOnly: false, telemetry: false, encryptVault: true, auditLog: false }
  };
  const normalized = normalizeSettings(legacy);

  assert.equal("encryptVault" in normalized.privacy, false, "the removed key must not survive");
  assert.equal(normalized.privacy.localOnly, false, "surrounding values must still be honoured");
  assert.equal(normalized.privacy.auditLog, false);
});

test("a credentialed endpoint must be https, except on loopback", async () => {
  const { normalizeSettings } = await import(await bundleSettings());

  const withEndpoints = (ai, semantic) =>
    normalizeSettings({
      integrations: {
        ai: { endpoint: ai, apiKey: "sk-secret" },
        semanticSearch: { endpoint: semantic, apiKey: "sk-secret" }
      }
    }).integrations;

  // Aviary redacts these keys on export, so accepting a destination that puts one on the wire in
  // the clear is the wrong place to stop caring. A typo'd http:// is the realistic case.
  const plaintext = withEndpoints("http://provider.example/v1/chat", "http://provider.example/v1/embed");
  assert.notEqual(plaintext.ai.endpoint, "http://provider.example/v1/chat");
  assert.notEqual(plaintext.semanticSearch.endpoint, "http://provider.example/v1/embed");

  const secure = withEndpoints("https://provider.example/v1/chat", "https://provider.example/v1/embed");
  assert.equal(secure.ai.endpoint, "https://provider.example/v1/chat");
  assert.equal(secure.semanticSearch.endpoint, "https://provider.example/v1/embed");

  // A self-hosted provider on loopback never puts the key on a network, and refusing it would
  // break exactly the local-first setup this project exists to serve.
  for (const host of ["http://localhost:11434/v1/chat", "http://127.0.0.1:8080/v1/chat"]) {
    assert.equal(withEndpoints(host, "https://provider.example/e").ai.endpoint, host);
  }
});
