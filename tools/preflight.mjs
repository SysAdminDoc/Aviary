import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

const failures = [];
const warnings = [];

await checkManifests();
await checkBundles();
await checkPermissions();
await checkSourcePolicy();
await checkDependencyPolicy();

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
    const optional = manifest.optional_permissions ?? [];
    if (!optional.includes("downloads")) {
      warnings.push(`${target}: optional permission 'downloads' missing (used by media buttons)`);
    }
    const hosts = manifest.host_permissions ?? [];
    if (hosts.length === 0) {
      failures.push(`${target}: host_permissions is empty`);
    }
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

  for (const target of ["extension-chrome", "extension-firefox"]) {
    const contentPath = path.join(root, "dist", target, "content.js");
    const bgPath = path.join(root, "dist", target, "background.js");
    for (const filePath of [contentPath, bgPath]) {
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
    if (/keydown|keyup|keypress/.test(text)) {
      failures.push(`${rel}: keyboard shortcut handler detected — Aviary forbids hotkeys`);
    }
    if (/backdrop-filter/.test(text)) {
      failures.push(`${rel}: backdrop-filter detected — banned for content scripts`);
    }
  }
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
