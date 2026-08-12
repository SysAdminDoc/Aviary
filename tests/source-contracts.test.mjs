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
    if (/keydown|keyup|keypress/.test(text) && !isScopedKeyboardInteraction(rel, text)) {
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

function isScopedKeyboardInteraction(relative, text) {
  const allowed = new Set([
    path.join("src", "ui", "control-center.ts"),
    path.join("src", "features", "ai", "command-menu.ts"),
    path.join("src", "features", "composer", "composer-snippets.ts")
  ]);
  if (!allowed.has(relative)) return false;
  return /event\.key|\.key\s*===\s*["'](Escape|Tab|Arrow(?:Up|Down|Left|Right))["']/.test(text);
}

test("Control Center follows overlay accessibility and shape rules", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  assert.match(source, /pointer-events:\s*none/);
  assert.match(source, /aria-controls/);
  assert.match(source, /role", "status"/);
  assert.match(source, /aria-live/);
  assert.ok(!/border-radius:\s*(999|9999)px/.test(source));
  assert.match(source, /aria-modal", "true"/);
  assert.match(source, /document\.body\?\.setAttribute\("inert", ""\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /focusables\[0\]!\.focus/);
  const openCss = source.slice(source.indexOf(".av-overlay.is-open"), source.indexOf(".av-panel {"));
  assert.match(openCss, /pointer-events: auto/);
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

test("release metadata and removed UI claims stay synchronized", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const [readme, roadmap, changelog, panel] = await Promise.all(
    ["README.md", "ROADMAP.md", "CHANGELOG.md", "src/ui/control-center.ts"].map((relative) =>
      readFile(path.join(root, relative), "utf8")
    )
  );
  const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  assert.ok(
    readme.includes("shields.io/badge/version-" + pkg.version + "-"),
    "README version badge is out of sync"
  );
  if (claude) {
    assert.ok(
      claude.includes("**Current version:** " + pkg.version),
      "CLAUDE current version is out of sync"
    );
  }
  assert.ok(
    roadmap.includes("Version: " + String.fromCharCode(96) + pkg.version + String.fromCharCode(96)),
    "ROADMAP version is out of sync"
  );
  assert.ok(changelog.includes("## " + pkg.version + " -"), "CHANGELOG has no current release heading");
  assert.doesNotMatch(readme, /\*\*Sensitive content\*\*\s*[—-]/i);
  assert.doesNotMatch(readme, /insertion(?: into[^)]*)? lands? in a later release/i);
  assert.doesNotMatch(readme, /v1\.5\.0 closes the .*batch/i);
  assert.doesNotMatch(panel, /insertion landing in a later release/i);
  assert.match(panel, /declare const __AVIARY_VERSION__/);
  assert.match(panel, /av-version/);
});

test("layout declutter is class-scoped and reversible", async () => {
  const source = await readFile(path.join(root, "src/features/layout/declutter.ts"), "utf8");

  assert.match(source, /av-hide-right-sidebar/);
  assert.match(source, /av-hide-trends/);
  assert.match(source, /av-hide-grok/);
  assert.match(source, /destroy/);
  assert.ok(!/querySelectorAll\(['"]\*\s*['"]\)/.test(source));
});

test("no stylesheet uses the font shorthand with an inherited family", async () => {
  // `font: 700 10px/1.2 inherit` is invalid: the shorthand cannot take a CSS-wide keyword as
  // its family, so the whole declaration is dropped and the control falls back to the UA font.
  // Measured before the fix: the Control Center launcher and every nav item rendered Arial
  // 13.33px/400 instead of the declared 13px/600-700 panel type. Buttons do not inherit font,
  // so this silently hit ten declarations across five files.
  const files = await listFiles(path.join(root, "src"), ".ts");
  const offenders = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    source.split("\n").forEach((line, index) => {
      if (/\bfont:\s*[^;]*\binherit\b/.test(line)) {
        offenders.push(`${path.relative(root, file)}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `use font-size/font-weight/line-height longhands with font-family: inherit instead:\n${offenders.join("\n")}`
  );
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
