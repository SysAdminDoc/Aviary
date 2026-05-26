import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("source avoids unsafe injection and shortcut patterns", async () => {
  const files = await listFiles(path.join(root, "src"), ".ts");
  const unsafe = [];
  const shortcuts = [];
  const blur = [];

  for (const file of files) {
    const rel = path.relative(root, file);
    const text = await readFile(file, "utf8");

    if (!rel.endsWith(path.join("platform", "trusted-types.ts")) && /innerHTML|insertAdjacentHTML/.test(text)) {
      unsafe.push(rel);
    }
    if (/keydown|keyup|keypress/.test(text)) {
      shortcuts.push(rel);
    }
    if (/backdrop-filter/.test(text)) {
      blur.push(rel);
    }
  }

  assert.deepEqual(unsafe, [], "HTML injection must route through TrustedTypes helpers");
  assert.deepEqual(shortcuts, [], "Aviary does not register custom keyboard shortcuts");
  assert.deepEqual(blur, [], "content scripts must not use backdrop-filter");
});

test("Control Center follows overlay accessibility and shape rules", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  assert.match(source, /pointer-events:\s*none/);
  assert.match(source, /aria-controls/);
  assert.match(source, /role", "status"/);
  assert.match(source, /aria-live/);
  assert.ok(!/border-radius:\s*(999|9999)px/.test(source));
});

test("runtime hardening contracts stay in place", async () => {
  const settings = await readFile(path.join(root, "src/platform/settings.ts"), "utf8");
  const storage = await readFile(path.join(root, "src/platform/storage.ts"), "utf8");
  const selectors = await readFile(path.join(root, "src/platform/selectors.ts"), "utf8");
  const selectorHealth = await readFile(path.join(root, "src/features/core/selector-health.ts"), "utf8");
  const route = await readFile(path.join(root, "src/platform/route.ts"), "utf8");
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");

  assert.match(settings, /BLOCKED_OBJECT_KEYS/);
  assert.match(settings, /telemetry:\s*false/);
  assert.match(storage, /No storage backend is available/);
  assert.match(selectors, /root instanceof Element && root\.matches/);
  assert.match(selectorHealth, /CRITICAL_SURFACES/);
  assert.match(selectorHealth, /MIN_LOG_INTERVAL_MS/);
  assert.match(route, /history\.pushState = originalPush/);
  assert.match(main, /cloneSettings\(settings\)/);
});

test("MV3 manifests keep permissions narrow", async () => {
  const manifests = [
    "src/extension/manifest.chrome.json",
    "src/extension/manifest.firefox.json"
  ];

  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.deepEqual(manifest.optional_permissions, ["downloads"]);
    assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
    assert.ok(!JSON.stringify(manifest).includes("tabs"));
  }
});

test("development dependencies are pinned for reproducible builds", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    assert.ok(!/^[~^*]/.test(version), `${name} must use an exact version`);
  }
});

test("layout declutter is class-scoped and reversible", async () => {
  const source = await readFile(path.join(root, "src/features/layout/declutter.ts"), "utf8");

  assert.match(source, /av-hide-right-sidebar/);
  assert.match(source, /av-hide-trends/);
  assert.match(source, /av-hide-grok/);
  assert.match(source, /destroy/);
  assert.ok(!/querySelectorAll\(['"]\*\s*['"]\)/.test(source));
});

async function listFiles(dir, suffix) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, suffix)));
    } else if (entry.name.endsWith(suffix)) {
      files.push(full);
    }
  }

  return files;
}
