import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
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

async function featureSources() {
  const sources = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".ts")) sources.push(await readFile(full, "utf8"));
    }
  };
  await walk(path.join(root, "src/features"));
  await walk(path.join(root, "src/ui"));
  return sources.join("\n");
}

/**
 * A filter action that nothing reads must default to "off".
 *
 * `filter.blockedAccounts` defaulted to "hide" while no predicate consulted it, so every install
 * carried a setting that claimed an active filter and every settings export published that claim.
 * This is the same class as the settings that only normalized: the defect is not the missing
 * feature, it is the default asserting a behaviour the build does not have.
 */
test("a filter action nothing reads cannot default to anything but off", async () => {
  const settingsSource = await readFile(path.join(root, "src/platform/settings.ts"), "utf8");
  const features = await featureSources();

  const block = settingsSource.slice(
    settingsSource.indexOf("  filter: {", settingsSource.indexOf("DEFAULT_SETTINGS")),
    settingsSource.indexOf("  hidden: {", settingsSource.indexOf("DEFAULT_SETTINGS"))
  );
  assert.ok(block.includes("premiumRule"), "failed to locate the default filter block");

  const actions = [...block.matchAll(/^\s{4}(\w+):\s*"(off|hide|dim)"/gm)].map((match) => ({
    key: match[1],
    value: match[2]
  }));
  assert.ok(actions.length >= 3, `expected several filter actions, found ${actions.length}`);

  const isRead = (key) => features.includes(`settings.filter.${key}`);

  // Control: a rule the engine demonstrably consults must register as read. Without this, a
  // typo in the probe above would report every key as unread and pass the whole test vacuously.
  assert.ok(isRead("premiumRule"), "control failed — premiumRule is read by the filter engine");

  for (const action of actions) {
    if (!isRead(action.key)) {
      assert.equal(
        action.value,
        "off",
        `filter.${action.key} defaults to "${action.value}" but nothing reads it — ` +
          `the setting claims a filter the engine never applies`
      );
    }
  }
});

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
