import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { userscriptUrls } from "./userscript-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const extensionIconSizes = [16, 32, 48, 128];
const expectedExtensionIcons = Object.fromEntries(
  extensionIconSizes.map((size) => [String(size), `icons/icon-${size}.png`])
);

const failures = [];
const warnings = [];

await checkManifests();
await checkBundles();
await checkPermissions();
await checkSourcePolicy();
await checkDependencyPolicy();
await checkReleaseMetadata();

if (failures.length > 0) {
  console.error("Preflight failed:");
  for (const issue of failures) {
    console.error(`  - ${issue}`);
  }
  if (warnings.length > 0) {
    console.error("Warnings:");
    for (const warning of warnings) {
      console.error(`  - ${warning}`);
    }
  }
  process.exit(1);
}

console.log(`Preflight passed for Aviary v${pkg.version}.`);
if (warnings.length > 0) {
  console.log("Warnings:");
  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
}

async function checkManifests() {
  for (const target of ["extension-chrome", "extension-firefox"]) {
    const manifestPath = path.join(root, "dist", target, "manifest.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      failures.push(`${target}: manifest missing or unreadable (${(error).message})`);
      continue;
    }
    if (manifest.manifest_version !== 3) {
      failures.push(`${target}: manifest_version must be 3`);
    }
    if (manifest.version !== pkg.version) {
      failures.push(`${target}: manifest.version (${manifest.version}) != package.json (${pkg.version})`);
    }
    const text = JSON.stringify(manifest);
    if (text.includes("<all_urls>")) {
      failures.push(`${target}: manifest must not request <all_urls>`);
    }
    if (/unsafe-eval|wasm-eval/.test(text)) {
      failures.push(`${target}: manifest must not enable unsafe-eval or wasm-eval`);
    }
    if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes("storage")) {
      failures.push(`${target}: missing required permission 'storage'`);
    }
    if (!manifest.permissions?.includes("declarativeNetRequestWithHostAccess")) {
      failures.push(`${target}: missing narrow declarativeNetRequestWithHostAccess permission`);
    }
    if (!manifest.permissions?.includes("contextMenus")) {
      failures.push(`${target}: missing contextMenus permission for right-click media downloads`);
    }
    if (manifest.permissions?.includes("declarativeNetRequestFeedback")) {
      failures.push(`${target}: test-only declarativeNetRequestFeedback must not ship`);
    }
    const optional = manifest.optional_permissions ?? [];
    if (!optional.includes("downloads")) {
      warnings.push(`${target}: optional permission 'downloads' missing (used by media buttons)`);
    }
    const hosts = manifest.host_permissions ?? [];
    if (hosts.length === 0) {
      failures.push(`${target}: host_permissions is empty`);
    }
    // The options page remains the durable grant/revoke surface even though the native media
    // context-menu click can request download access inline.
    const optionsPage = manifest.options_ui?.page;
    if (optionsPage !== "options.html") {
      failures.push(`${target}: options_ui.page must be options.html (optional permissions need a grant surface)`);
    }
    if (JSON.stringify(manifest.icons) !== JSON.stringify(expectedExtensionIcons)) {
      failures.push(`${target}: manifest icons must declare the complete Aviary size set`);
    }
    if (JSON.stringify(manifest.action?.default_icon) !== JSON.stringify(expectedExtensionIcons)) {
      failures.push(`${target}: action.default_icon must declare the complete Aviary size set`);
    }
    for (const size of extensionIconSizes) {
      const iconPath = path.join(root, "dist", target, expectedExtensionIcons[String(size)]);
      try {
        const png = await readFile(iconPath);
        const dimensions = readPngDimensions(png);
        if (dimensions.width !== size || dimensions.height !== size) {
          failures.push(
            `${target}: icon-${size}.png PNG dimensions are ${dimensions.width}x${dimensions.height}`
          );
        }
        if (dimensions.colorType !== 6) {
          failures.push(`${target}: icon-${size}.png must retain RGBA transparency`);
        }
      } catch (error) {
        failures.push(`${target}: icon-${size}.png missing or invalid (${error.message})`);
      }
    }
    if (target === "extension-chrome" && manifest.background?.service_worker !== "background.js") {
      failures.push(`${target}: MV3 background service worker is missing`);
    }
    if (target === "extension-firefox") {
      if (!manifest.background?.scripts?.includes("background.js")) {
        failures.push(`${target}: Firefox event-page background script is missing`);
      }
      const resources = manifest.declarative_net_request?.rule_resources ?? [];
      const compat = resources.find((resource) => resource.id === "aviary_dynamic_compat");
      if (!compat?.enabled || compat.path !== "dnr-empty-rules.json") {
        failures.push(`${target}: enabled dynamic-rule compatibility ruleset is missing`);
      } else {
        try {
          const rules = JSON.parse(
            await readFile(path.join(root, "dist", target, compat.path), "utf8")
          );
          if (!Array.isArray(rules) || rules.length !== 0) {
            failures.push(`${target}: compatibility ruleset must stay empty`);
          }
        } catch (error) {
          failures.push(`${target}: compatibility ruleset is unreadable (${error.message})`);
        }
      }
    }
  }
}

function readPngDimensions(data) {
  if (
    data.length < 26 ||
    data[0] !== 0x89 ||
    data.subarray(1, 4).toString("ascii") !== "PNG"
  ) {
    throw new Error("not a PNG file");
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25]
  };
}

function checkUserscriptUpdateUrls(source) {
  let expected;
  try {
    expected = userscriptUrls(pkg);
  } catch (error) {
    failures.push(`userscript update metadata: ${(error).message}`);
    return;
  }
  const read = (key) => source.match(new RegExp(`@${key}\\s+(\\S+)`))?.[1] ?? null;
  for (const key of ["updateURL", "downloadURL"]) {
    const value = read(key);
    if (value !== expected.script) {
      failures.push(
        `userscript @${key} is "${value ?? "missing"}" but package.json repository resolves to "${expected.script}"`
      );
    }
  }
  const namespace = read("namespace");
  if (namespace !== expected.namespace) {
    failures.push(`userscript @namespace is "${namespace ?? "missing"}" but should be "${expected.namespace}"`);
  }
}

async function checkBundles() {
  const userscriptPath = path.join(root, "dist", "aviary.user.js");
  let source;
  try {
    source = await readFile(userscriptPath, "utf8");
  } catch (error) {
    failures.push(`userscript bundle missing: ${(error).message}`);
    return;
  }
  if (!source.includes("==UserScript==")) {
    failures.push("userscript bundle missing metablock");
  }
  if (!source.includes(`@version      ${pkg.version}`)) {
    failures.push(`userscript bundle version banner != ${pkg.version}`);
  }
  if (/eval\s*\(/.test(source)) {
    failures.push("userscript bundle contains eval() — drop it before publishing");
  }
  checkUserscriptUpdateUrls(source);

  for (const target of ["extension-chrome", "extension-firefox"]) {
    const contentPath = path.join(root, "dist", target, "content.js");
    const bgPath = path.join(root, "dist", target, "background.js");
    const optionsPath = path.join(root, "dist", target, "options.js");
    for (const filePath of [contentPath, bgPath, optionsPath]) {
      try {
        const text = await readFile(filePath, "utf8");
        if (/\beval\s*\(/.test(text)) {
          failures.push(`${path.relative(root, filePath)} contains eval()`);
        }
        if (/new\s+Function\s*\(/.test(text)) {
          failures.push(`${path.relative(root, filePath)} constructs new Function() — MV3 forbids this`);
        }
      } catch (error) {
        failures.push(`${target}: ${path.basename(filePath)} missing (${(error).message})`);
      }
    }

    // MV3's page CSP rejects inline script; catch it here rather than at store review.
    const htmlPath = path.join(root, "dist", target, "options.html");
    try {
      const html = await readFile(htmlPath, "utf8");
      if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) {
        failures.push(`${target}: options.html contains inline script — MV3 page CSP blocks it`);
      }
      if (/\son[a-z]+\s*=/i.test(html)) {
        failures.push(`${target}: options.html uses an inline event handler attribute`);
      }
    } catch (error) {
      failures.push(`${target}: options.html missing (${(error).message})`);
    }
  }
}

async function checkPermissions() {
  // Confirm GitHub Actions release artifact ZIP filenames will match expected pattern.
  const expectedZip = `extension-chrome-v${pkg.version}.zip`;
  const distEntries = await readdir(path.join(root, "dist"));
  if (!distEntries.includes(expectedZip)) {
    warnings.push(`dist/${expectedZip} not yet produced (run npm run build first)`);
  }
}

async function checkSourcePolicy() {
  const files = await listFiles(path.join(root, "src"), ".ts");
  for (const file of files) {
    const rel = path.relative(root, file);
    if (rel.endsWith(path.join("platform", "trusted-types.ts"))) continue;
    const text = await readFile(file, "utf8");
    if (/innerHTML|insertAdjacentHTML/.test(text)) {
      failures.push(`${rel}: HTML injection sink — use TrustedTypes helper`);
    }
    if (/keydown|keyup|keypress/.test(text) && !isScopedKeyboardInteraction(rel, text)) {
      failures.push(`${rel}: keyboard shortcut handler detected — only scoped dialog/menu navigation is allowed`);
    }
    if (/backdrop-filter/.test(text)) {
      failures.push(`${rel}: backdrop-filter detected — banned for content scripts`);
    }
  }
}

function isScopedKeyboardInteraction(relative, text) {
  const allowed = new Set([
    path.join("src", "ui", "control-center.ts"),
    path.join("src", "features", "ai", "command-menu.ts"),
    path.join("src", "features", "composer", "composer-snippets.ts")
  ]);
  if (!allowed.has(relative)) return false;
  return /\.key\s*===\s*["'](?:Escape|Tab|Arrow(?:Up|Down|Left|Right)|Home|End|Enter|\s)["']/.test(text);
}

async function checkDependencyPolicy() {
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    if (/^[~^*]/.test(version)) {
      failures.push(`devDependency ${name} must be pinned to an exact version (saw ${version})`);
    }
  }
  if (Object.keys(pkg.dependencies ?? {}).length > 0) {
    warnings.push("runtime dependencies present — confirm they are reviewed for the MV3 supply-chain audit");
  }
}

async function checkReleaseMetadata() {
  const required = [
    ["README.md", "shields.io/badge/version-" + pkg.version + "-"],
    ["ROADMAP.md", "Version: " + String.fromCharCode(96) + pkg.version + String.fromCharCode(96)],
    ["CHANGELOG.md", "## " + pkg.version + " -"]
  ];
  const optional = [["CLAUDE.md", "**Current version:** " + pkg.version]];
  const contents = new Map();

  for (const [relative, expected] of [...required, ...optional]) {
    let text;
    try {
      text = await readFile(path.join(root, relative), "utf8");
    } catch (error) {
      if (optional.some(([candidate]) => candidate === relative) && error.code === "ENOENT") {
        continue;
      }
      failures.push(relative + ": release metadata is unreadable (" + error.message + ")");
      continue;
    }
    contents.set(relative, text);
    if (!text.includes(expected)) {
      failures.push(relative + ": does not advertise package version " + pkg.version);
    }
  }

  for (const relative of ["src/extension/manifest.chrome.json", "src/extension/manifest.firefox.json"]) {
    try {
      const manifest = JSON.parse(await readFile(path.join(root, relative), "utf8"));
      if (manifest.version !== pkg.version) {
        failures.push(relative + ": version (" + manifest.version + ") != package.json (" + pkg.version + ")");
      }
    } catch (error) {
      failures.push(relative + ": source manifest is unreadable (" + error.message + ")");
    }
  }

  const readme = contents.get("README.md") ?? "";
  if (/\*\*Sensitive content\*\*\s*[—-]/i.test(readme)) {
    failures.push("README.md: removed Sensitive content control is still advertised");
  }
  if (/insertion(?: into[^)]*)? lands? in a later release|insertion landing in a later release/i.test(readme)) {
    failures.push("README.md: shipped composer insertion is still described as future work");
  }
  if (/v1\.5\.0 closes the .*batch/i.test(readme)) {
    failures.push("README.md: roadmap paragraph still claims v1.5.0 is current");
  }

  const panel = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
  if (/insertion landing in a later release/i.test(panel)) {
    failures.push("src/ui/control-center.ts: composer insertion is still described as future work");
  }
  if (!panel.includes("__AVIARY_VERSION__") || !panel.includes("av-version")) {
    failures.push("src/ui/control-center.ts: Control Center version stamp contract is missing");
  }
  const userscript = await readFile(path.join(root, "dist", "aviary.user.js"), "utf8");
  if (!userscript.includes("AVIARY_VERSION") || !userscript.includes('"' + pkg.version + '"')) {
    failures.push("dist/aviary.user.js: Control Center/build version stamp " + pkg.version + " is missing");
  }
}

async function listFiles(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFiles(next, suffix)));
    } else if (entry.name.endsWith(suffix)) {
      results.push(next);
    }
  }
  return results;
}
