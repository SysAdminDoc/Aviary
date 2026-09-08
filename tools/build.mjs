import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

import { artifactDigests, sourceFingerprint } from "./build-fingerprint.mjs";
import { ignoredPaths, isExcludedSourcePath } from "./source-archive.mjs";
import { repositoryUrl, userscriptUrls } from "./userscript-meta.mjs";

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const STORE_ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");
const extensionIconSizes = [16, 32, 48, 128];
const matchLines = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://pro.x.com/*",
];

const extensionI18nRuntimePlugin = {
  name: "aviary-extension-i18n-runtime",
  setup(build) {
    build.onResolve({ filter: /platform[\\/]i18n\.ts$/ }, (args) => {
      const requested = path.resolve(args.resolveDir, args.path);
      const fullCatalog = path.join(root, "src/platform/i18n.ts");
      if (requested !== fullCatalog) return undefined;
      return { path: path.join(root, "src/platform/i18n-runtime.ts") };
    });
    build.onResolve({ filter: /features[\\/]core[\\/](control-center|optional-features)\.ts$/ }, (args) => {
      const requested = path.resolve(args.resolveDir, args.path);
      const lazyModules = new Set([
        path.join(root, "src/features/core/control-center.ts"),
        path.join(root, "src/features/core/optional-features.ts")
      ]);
      if (!lazyModules.has(requested)) return undefined;
      return { path: path.join(root, "src/extension/lazy-stubs.ts") };
    });
  }
};

/**
 * The translations the options page actually uses, pulled out of the one catalog.
 *
 * The page is a separate document and cannot reach a FeatureContext, so it gets its strings
 * defined in at build time instead of importing PANEL_CATALOG -- which would put roughly 240KB
 * of translations into a page that otherwise ships a few KB. The key list comes from the
 * `data-i18n` attributes in options.html plus the runtime status strings, so adding a string to
 * the page is enough to carry its translations across.
 */
async function loadPanelCatalog() {
  const catalogSource = await readFile(path.join(root, "src/platform/i18n-catalog.ts"), "utf8");
  const outfile = path.join(dist, ".panel-catalog.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, "src/platform/i18n-catalog.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent"
  });
  const module = await import(`${pathToFileURL(outfile).href}?v=${catalogSource.length}`);
  await rm(outfile, { force: true });
  return module.panelCatalog();
}

async function loadNativeI18nCopy() {
  const outfile = path.join(dist, ".native-i18n.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, "src/extension/native-i18n.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    logLevel: "silent"
  });
  const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  await rm(outfile, { force: true });
  return module.NATIVE_I18N_COPY;
}

async function optionsCatalogSubset() {
  const html = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  const controller = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");

  const keys = new Set();
  for (const match of html.matchAll(/data-i18n="((?:[^"\\]|\\.)*)"/g)) {
    keys.add(decodeHtmlEntities(match[1]));
  }
  for (const match of controller.matchAll(/\btranslate\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    keys.add(JSON.parse(`"${match[1]}"`));
  }
  for (const match of controller.matchAll(/\b(?:grantedLabel|missingLabel|grantedMessage):\s*"((?:[^"\\]|\\.)*)"/g)) {
    keys.add(JSON.parse(`"${match[1]}"`));
  }

  const catalog = await loadPanelCatalog();

  const subset = {};
  const missing = [];
  for (const [locale, entries] of Object.entries(catalog)) {
    subset[locale] = {};
    for (const key of keys) {
      const translated = entries[key];
      if (translated === undefined) {
        missing.push(`${locale}: ${key}`);
        continue;
      }
      subset[locale][key] = translated;
    }
  }
  if (missing.length > 0) {
    // Loud rather than silently shipping an English options page in a translated build.
    console.warn(`options page missing ${missing.length} translations:\n  ${missing.slice(0, 5).join("\n  ")}`);
  }
  return subset;
}

function nativeLocaleMessages(copy, catalog, locale) {
  const entries = {};
  for (const [key, english] of Object.entries(copy)) {
    entries[key] = {
      message: locale === "en" ? english : catalog[locale]?.[english] ?? english
    };
  }
  return entries;
}

async function writeNativeLocaleBundles(targetDir, copy, catalog) {
  const locales = ["en", "es", "pt", "fr", "de", "ja", "ko", "ar", "he"];
  for (const locale of locales) {
    const localeDir = path.join(targetDir, "_locales", locale);
    await mkdir(localeDir, { recursive: true });
    await writeFile(
      path.join(localeDir, "messages.json"),
      `${JSON.stringify(nativeLocaleMessages(copy, catalog, locale), null, 2)}\n`
    );
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

await rm(dist, { force: true, recursive: true });
await mkdir(dist, { recursive: true });
const nativeI18nCopy = await loadNativeI18nCopy();
const panelCatalog = await loadPanelCatalog();

// WACZ assembly hashes and copies every captured byte. Inline a dedicated worker into both
// delivery targets so the export never needs a hosted script and never runs that work on X's UI
// thread. The source is minified only to avoid duplicating a large readable bundle inside another.
const waczWorkerBuild = await esbuild.build({
  entryPoints: [path.join(root, "src/entrypoints/wacz-worker.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  platform: "browser",
  minify: true,
  legalComments: "none"
});
const waczWorkerSource = waczWorkerBuild.outputFiles[0]?.text;
if (!waczWorkerSource) {
  throw new Error("WACZ worker build produced no JavaScript");
}
const contentDefines = {
  __AVIARY_VERSION__: JSON.stringify(pkg.version),
  __AVIARY_WACZ_WORKER_SOURCE__: JSON.stringify(waczWorkerSource),
  __AVIARY_EXTENSION_LAZY__: "false"
};

await esbuild.build({
  entryPoints: [path.join(root, "src/entrypoints/userscript.ts")],
  outfile: path.join(dist, "aviary.user.js"),
  bundle: true,
  format: "iife",
  globalName: "Aviary",
  define: contentDefines,
  target: "es2022",
  platform: "browser",
  minify: false,
  legalComments: "inline",
  banner: {
    js: userscriptBanner(pkg.version)
  }
});

// The metadata-only companion userscript managers poll. Byte-identical to the banner the full
// script carries, so a manager cannot see one version here and another there.
await writeFile(path.join(dist, "aviary.meta.js"), userscriptBanner(pkg.version));

for (const target of ["extension-chrome", "extension-firefox"]) {
  const targetDir = path.join(dist, target);
  await mkdir(targetDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(root, "src/entrypoints/extension-content.ts")],
    outfile: path.join(targetDir, "content.js"),
    bundle: true,
    format: "iife",
    define: { ...contentDefines, __AVIARY_EXTENSION_LAZY__: "true" },
    target: "es2022",
    platform: "browser",
    minify: false,
    legalComments: "inline",
    plugins: [extensionI18nRuntimePlugin]
  });

  const chunksDir = path.join(targetDir, "chunks");
  await mkdir(chunksDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, "src/entrypoints/extension-panel.ts")],
    outfile: path.join(chunksDir, "extension-panel.js"),
    bundle: true,
    format: "iife",
    globalName: "AviaryExtensionPanelChunk",
    define: contentDefines,
    target: "es2022",
    platform: "browser",
    minify: false,
    legalComments: "inline"
  });

  // The page-world agent. Declared in both manifests with "world": "MAIN", which is the only
  // place X's own fetch is visible; see src/page/page-agent.ts.
  await esbuild.build({
    entryPoints: [path.join(root, "src/entrypoints/extension-page.ts")],
    outfile: path.join(targetDir, "page.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    minify: false,
    legalComments: "inline"
  });

  await esbuild.build({
    entryPoints: [path.join(root, "src/entrypoints/extension-background.ts")],
    outfile: path.join(targetDir, "background.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    minify: false,
    legalComments: "inline"
  });

  await esbuild.build({
    entryPoints: [path.join(root, "src/entrypoints/extension-options.ts")],
    outfile: path.join(targetDir, "options.js"),
    define: { __AVIARY_OPTIONS_I18N__: JSON.stringify(await optionsCatalogSubset()) },
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    minify: false,
    legalComments: "inline"
  });

  for (const asset of ["options.html", "options.css"]) {
    await copyFile(path.join(root, "src/extension", asset), path.join(targetDir, asset));
  }
  await writeNativeLocaleBundles(targetDir, nativeI18nCopy, panelCatalog);
  const targetIcons = path.join(targetDir, "icons");
  await mkdir(targetIcons, { recursive: true });
  for (const size of extensionIconSizes) {
    await copyFile(
      path.join(root, "src/extension/icons", `icon-${size}.png`),
      path.join(targetIcons, `icon-${size}.png`)
    );
  }
  if (target === "extension-firefox") {
    // Keep the empty enabled ruleset as a compatibility anchor for the older Firefox dynamic-rule
    // restart path. The setting-controlled promoted-content rule remains dynamic in background.js.
    await copyFile(
      path.join(root, "src/extension/dnr-empty-rules.json"),
      path.join(targetDir, "dnr-empty-rules.json")
    );
  }

  const manifestName = target === "extension-chrome" ? "manifest.chrome.json" : "manifest.firefox.json";
  const manifest = JSON.parse(await readFile(path.join(root, "src/extension", manifestName), "utf8"));
  manifest.version = pkg.version;
  await writeFile(path.join(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

await copyFile(path.join(root, "README.md"), path.join(dist, "README.md"));

const builtSourceFingerprint = await sourceFingerprint(root);
for (const target of ["extension-chrome", "extension-firefox"]) {
  const targetDir = path.join(dist, target);
  const artifactFiles = [];
  for await (const filePath of walk(targetDir)) {
    artifactFiles.push(path.relative(targetDir, filePath).replace(/\\/g, "/"));
  }
  const buildInfo = {
    format: 1,
    product: "Aviary",
    target,
    version: pkg.version,
    sourceFingerprint: builtSourceFingerprint,
    artifacts: await artifactDigests(targetDir, artifactFiles)
  };
  await writeFile(path.join(targetDir, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
  const zipPath = path.join(dist, `${target}-v${pkg.version}.zip`);
  await packDirectoryAsStoreZip(targetDir, zipPath);
}

await writeFile(
  path.join(dist, "build-info.json"),
  `${JSON.stringify({
    format: 1,
    product: "Aviary",
    target: "userscript",
    version: pkg.version,
    sourceFingerprint: builtSourceFingerprint,
    artifacts: await artifactDigests(dist, ["aviary.user.js", "aviary.meta.js", "README.md"])
  }, null, 2)}\n`
);

// Keep a small, deterministic source artifact beside the installable packages. It contains the
// checkout inputs needed to reproduce the build, never generated dist/ output or dependencies.
const sourceCandidates = [];
for await (const filePath of walkSource(root)) {
  sourceCandidates.push(path.relative(root, filePath).replace(/\\/g, "/"));
}

// The archive is published, so anything git ignores stays out of it: private working notes and
// generated files are not checkout inputs. Git owns that answer, and the declared floor is applied
// either way, so a checkout with no git still refuses the paths that are never source.
const ignoredSource = ignoredPaths(root, sourceCandidates);
const excludedSource = new Set([
  ...ignoredSource.ignored,
  ...sourceCandidates.filter(isExcludedSourcePath)
]);

const sourceEntries = [];
for (const filename of sourceCandidates) {
  if (excludedSource.has(filename)) continue;
  sourceEntries.push({ filename, data: new Uint8Array(await readFile(path.join(root, filename))) });
}
sourceEntries.sort((left, right) => left.filename.localeCompare(right.filename));
await writeFile(path.join(dist, `aviary-source-v${pkg.version}.zip`), buildStoreZip(sourceEntries));

async function packDirectoryAsStoreZip(directory, outputPath) {
  const entries = [];
  for await (const filePath of walk(directory)) {
    const relative = path.relative(directory, filePath).replace(/\\/g, "/");
    const data = await readFile(filePath);
    entries.push({ filename: relative, data: new Uint8Array(data) });
  }
  const archive = buildStoreZip(entries);
  await writeFile(outputPath, archive);
}

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(next);
    } else if ((await stat(next)).isFile()) {
      yield next;
    }
  }
}

async function* walkSource(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", ".tmp", ".cache", "mockups"].includes(entry.name)) continue;
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkSource(next);
    } else if ((await stat(next)).isFile()) {
      if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      yield next;
    }
  }
}

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoreZip(entries) {
  const encoder = new TextEncoder();
  const localBlocks = [];
  const centralBlocks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.filename);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    // Store artifacts must be byte-reproducible. A live timestamp would dirty the tracked ZIPs
    // on every verification run even when the source and generated files are unchanged.
    const date = STORE_ZIP_DATE;
    const dosDate = ((Math.max(date.getUTCFullYear() - 1980, 0) & 0x7f) << 9)
      | (((date.getUTCMonth() + 1) & 0x0f) << 5)
      | (date.getUTCDate() & 0x1f);
    const dosTime = ((date.getUTCHours() & 0x1f) << 11)
      | ((date.getUTCMinutes() & 0x3f) << 5)
      | (Math.floor(date.getUTCSeconds() / 2) & 0x1f);

    const localHeader = new ArrayBuffer(30 + nameBytes.length);
    const lhView = new DataView(localHeader);
    lhView.setUint32(0, 0x04034b50, true);
    lhView.setUint16(4, 20, true);
    lhView.setUint16(6, 0, true);
    lhView.setUint16(8, 0, true);
    lhView.setUint16(10, dosTime, true);
    lhView.setUint16(12, dosDate, true);
    lhView.setUint32(14, crc, true);
    lhView.setUint32(18, size, true);
    lhView.setUint32(22, size, true);
    lhView.setUint16(26, nameBytes.length, true);
    lhView.setUint16(28, 0, true);
    const localHeaderBytes = new Uint8Array(localHeader);
    localHeaderBytes.set(nameBytes, 30);
    localBlocks.push(localHeaderBytes);
    localBlocks.push(entry.data);

    const centralHeader = new ArrayBuffer(46 + nameBytes.length);
    const chView = new DataView(centralHeader);
    chView.setUint32(0, 0x02014b50, true);
    chView.setUint16(4, 20, true);
    chView.setUint16(6, 20, true);
    chView.setUint16(8, 0, true);
    chView.setUint16(10, 0, true);
    chView.setUint16(12, dosTime, true);
    chView.setUint16(14, dosDate, true);
    chView.setUint32(16, crc, true);
    chView.setUint32(20, size, true);
    chView.setUint32(24, size, true);
    chView.setUint16(28, nameBytes.length, true);
    chView.setUint16(30, 0, true);
    chView.setUint16(32, 0, true);
    chView.setUint16(34, 0, true);
    chView.setUint16(36, 0, true);
    chView.setUint32(38, 0, true);
    chView.setUint32(42, offset, true);
    const centralBytes = new Uint8Array(centralHeader);
    centralBytes.set(nameBytes, 46);
    centralBlocks.push(centralBytes);

    offset += localHeaderBytes.length + entry.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const block of centralBlocks) centralSize += block.length;

  const endRecord = new Uint8Array(22);
  const erView = new DataView(endRecord.buffer);
  erView.setUint32(0, 0x06054b50, true);
  erView.setUint16(4, 0, true);
  erView.setUint16(6, 0, true);
  erView.setUint16(8, entries.length, true);
  erView.setUint16(10, entries.length, true);
  erView.setUint32(12, centralSize, true);
  erView.setUint32(16, centralStart, true);
  erView.setUint16(20, 0, true);

  const total = offset + centralSize + endRecord.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const block of localBlocks) {
    output.set(block, cursor);
    cursor += block.length;
  }
  for (const block of centralBlocks) {
    output.set(block, cursor);
    cursor += block.length;
  }
  output.set(endRecord, cursor);
  return output;
}

function userscriptBanner(version) {
  const matches = matchLines.map((value) => `// @match        ${value}`).join("\n");
  const urls = userscriptUrls(pkg);
  return `// ==UserScript==
// @name         Aviary for X
// @namespace    ${urls.namespace}
// @version      ${version}
// @description  Local-first X/Twitter enhancer with reversible controls and privacy-first defaults.
// @author       ${pkg.author}
// @homepage     ${repositoryUrl(pkg)}
${matches}
// @run-at       document-start
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_download
// @grant        unsafeWindow
// @connect      pbs.twimg.com
// @connect      video.twimg.com
// @updateURL    ${urls.meta}
// @downloadURL  ${urls.script}
// ==/UserScript==
`;
}
