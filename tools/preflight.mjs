import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureAgeReport, readCaptureManifest } from "./capture-manifest.mjs";
import { browserFloorFailures, readBrowserFloors } from "./browser-floors.mjs";
import { repositoryUrl, userscriptUrls } from "./userscript-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const extensionIconSizes = [16, 32, 48, 128];
const expectedExtensionIcons = Object.fromEntries(
  extensionIconSizes.map((size) => [String(size), `icons/icon-${size}.png`])
);

/**
 * Delivery size is a shipped contract, so it gets a gate like every other one.
 *
 * Nothing here measured it. The userscript grew 27 KB across two days in August 2026 with no
 * signal, and it is the artifact most sensitive to growth: a userscript manager re-downloads the
 * whole file on every update, and Tampermonkey has a reported ceiling on the update path that a
 * fresh install does not hit. The ceilings below are deliberately close to current size -- the
 * point is to make growth a decision someone makes on purpose, not a thing that happens.
 *
 * Raising one is fine. Raising one without saying why in the commit is not.
 */
const DELIVERY_BUDGETS = [
  { file: "aviary.user.js", maxBytes: 2_155_000 },
  { file: "aviary.meta.js", maxBytes: 4_000 },
  { file: "extension-chrome/content.js", maxBytes: 2_155_000 },
  { file: "extension-firefox/content.js", maxBytes: 2_155_000 }
];

const failures = [];
const warnings = [];

checkDeclaredRepository();
await checkCaptureFreshness();
await checkManifests();
await checkBundles();
await checkPermissions();
await checkSourcePolicy();
await checkDependencyPolicy();
await checkReleaseMetadata();
await checkDeliverySize();

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
  const floors = await readBrowserFloors();
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
    // The floor decides whether a platform feature needs a detection branch, so it cannot be
    // changed by editing one manifest. src/extension/browser-floors.ts is the declaration.
    failures.push(...browserFloorFailures(target, manifest, floors));
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

/**
 * Every selector this project ships is proved against a captured DOM, which makes the capture the
 * authority — and an authority with no expiry is how "measured: 0 hits, blocked" quietly turns into
 * a statement about a version of X that no longer exists. The ceiling and the waiver both live in
 * `_decoded/captures.json`, so the repository states its own tolerance instead of drifting into one.
 */
async function checkCaptureFreshness() {
  let manifest;
  try {
    manifest = await readCaptureManifest();
  } catch (error) {
    failures.push(`capture manifest: ${(error).message}`);
    return;
  }
  const report = captureAgeReport(manifest);
  // Name the captures that are actually stale rather than only the newest -- one fresh capture
  // used to mask an arbitrarily old sibling, and a selector proved against the old one is exactly
  // as speculative as one proved against nothing.
  const describe = (items) =>
    items.map((item) => `${item.file} ${item.ageDays}d (captured ${item.capturedOn})`).join(", ");
  const age = report.stale.length > 0 ? describe(report.stale) : describe([report.newest]);
  if (report.blocking) {
    failures.push(
      `stale DOM captures: ${age}, past the ${manifest.ceilingDays}-day ceiling this ` +
        "repository declares. Refresh it — save an authenticated X page as MHTML, then " +
        "`npm run capture:decode -- \"<saved.mhtml>\" <name>` — or record a dated " +
        "acknowledgedStaleUntil in _decoded/captures.json saying why not."
    );
    return;
  }
  if (report.overCeiling) {
    warnings.push(
      `stale DOM captures: ${age}, past the ${manifest.ceilingDays}-day ceiling; ` +
        `waived until ${report.waiverUntil}, after which preflight fails`
    );
  } else if (report.overWarn) {
    warnings.push(
      `ageing DOM captures: ${describe(report.ages.filter((item) => item.overWarn))}; ` +
        `the ceiling is ${manifest.ceilingDays} days`
    );
  }
}

/**
 * The userscript's `@updateURL` is derived from package.json's `repository`, and it resolves through
 * `raw.githubusercontent.com` -- which, unlike github.com, does not follow a repository rename. So a
 * rename that nobody carried into package.json leaves every installed copy polling a path that will
 * never answer, and the only local signal is git printing "This repository moved" during a push.
 *
 * Comparing the declared repository against the `origin` remote catches the divergence, which is
 * what a rename actually produces once either side is updated. It cannot catch a rename that nobody
 * has reflected anywhere yet -- the two would still agree -- so the message says which question was
 * answered rather than implying the URL was proved reachable.
 */
function checkDeclaredRepository() {
  let declared;
  try {
    declared = repositoryUrl(pkg);
  } catch (error) {
    failures.push(`package.json repository: ${(error).message}`);
    return;
  }
  let origin;
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    // A source archive or a checkout with no remote cannot answer this. Say so rather than pass.
    warnings.push(
      "repository identity unchecked: no `origin` remote here, so a rename could not be compared against package.json"
    );
    return;
  }
  const normalized = origin
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (normalized !== declared) {
    failures.push(
      `package.json declares repository "${declared}" but the origin remote is "${normalized}" — ` +
        "the userscript's @updateURL follows package.json, and raw.githubusercontent.com does not " +
        "redirect after a rename"
    );
  }
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
  // @updateURL is polled on a schedule and must resolve to the metadata-only companion; @downloadURL
  // is fetched only once a newer version is seen and must resolve to the full script. Pointing both
  // at the full script made every poll pull the entire bundle to read one line.
  for (const [key, want] of [["updateURL", expected.meta], ["downloadURL", expected.script]]) {
    const value = read(key);
    if (value !== want) {
      failures.push(
        `userscript @${key} is "${value ?? "missing"}" but package.json repository resolves to "${want}"`
      );
    }
  }
  const namespace = read("namespace");
  if (namespace !== expected.namespace) {
    failures.push(`userscript @namespace is "${namespace ?? "missing"}" but should be "${expected.namespace}"`);
  }
}

/**
 * A userscript manager reads `@version` from the poll target and again from the download target. If
 * they disagree it either re-installs in a loop or never updates at all, so the two files have to
 * carry the same metablock byte for byte -- not merely the same version number.
 */
async function checkUserscriptMetaCompanion(fullSource) {
  const metaPath = path.join(root, "dist", "aviary.meta.js");
  let meta;
  try {
    meta = await readFile(metaPath, "utf8");
  } catch {
    failures.push("dist/aviary.meta.js: missing, so @updateURL polls a file that does not exist");
    return;
  }
  const block = (source) => source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0] ?? null;
  const fullBlock = block(fullSource);
  const metaBlock = block(meta);
  if (!metaBlock) {
    failures.push("dist/aviary.meta.js: no userscript metablock");
    return;
  }
  if (metaBlock !== fullBlock) {
    failures.push("dist/aviary.meta.js: metablock differs from dist/aviary.user.js");
  }
  if (meta.trim() !== metaBlock.trim()) {
    failures.push("dist/aviary.meta.js: must contain the metablock and nothing else");
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
  await checkUserscriptMetaCompanion(source);

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
    ["CHANGELOG.md", "## " + pkg.version + " ("]
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


async function checkDeliverySize() {
  const sizes = [];
  for (const budget of DELIVERY_BUDGETS) {
    const target = path.join(root, "dist", budget.file);
    let bytes;
    try {
      bytes = (await stat(target)).size;
    } catch {
      failures.push(`dist/${budget.file}: missing, so its size budget cannot be checked`);
      continue;
    }
    sizes.push(`${budget.file} ${formatBytes(bytes)}`);
    if (bytes > budget.maxBytes) {
      failures.push(
        `dist/${budget.file} is ${formatBytes(bytes)}, over its ${formatBytes(budget.maxBytes)} budget. ` +
          "Shrink it, or raise the budget in tools/preflight.mjs and say why."
      );
    }
  }
  if (sizes.length > 0) {
    console.log(`Delivery size: ${sizes.join(" · ")}`);
  }
}

function formatBytes(bytes) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(2)} MB`
    : `${(bytes / 1_000).toFixed(1)} kB`;
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
