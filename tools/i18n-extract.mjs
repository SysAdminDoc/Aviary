/**
 * Regenerates the panel string manifest that `PANEL_STRINGS` in src/platform/i18n-catalog.ts
 * is built from, and reports what each locale is still missing.
 *
 *   node tools/i18n-extract.mjs [--write]
 *
 * How the manifest is decided, so it cannot drift into claiming more than it covers:
 *
 * 1. The Control Center is mounted in a real browser with every optional callback supplied,
 *    so conditionally-rendered rows are actually drawn. `renderedPanelStrings()` reports the
 *    exact English strings the render passed through `t()`.
 * 2. That render happens twice with different stub data. A string that changes between the
 *    two is interpolated data ("3 jobs tracked", a timestamp), not translatable copy, and is
 *    dropped. This replaces a hand-kept exclusion list that would rot.
 * 3. Locale endonyms (Español, 日本語, …) are dropped: they are already in their own
 *    language and translating them would be wrong.
 * 4. Status and error copy lives in branches one render cannot reach, so `setStatus("…")` and
 * `setStatusCopy("…", values)` literals are harvested from the source and unioned in.
 *    literals are harvested from the source and unioned in.
 * 5. Features that inject into the timeline never render inside the panel at all, so their
 *    `ft(ctx, "…")` call sites — and the static preset label/description data — are harvested
 *    from source the same way.
 */
import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const LITERAL_RE = /^\s+\w+: "((?:[^"\\]|\\.)*)",?$/gm;
const abs = (p) => path.resolve(root, p).replace(/\\/g, "/");

const temp = await mkdtemp(path.join(tmpdir(), "aviary-i18n-"));

/** Two stub sets differing only in data, so interpolated values differ between renders. */
function stubs(variant) {
  const v = variant === "a";
  return `{
  getMediaStatus: () => ({ historySize: ${v ? 4 : 9}, completed: ${v ? 2 : 7}, failed: ${v ? 1 : 5}, duplicate: ${v ? 1 : 6}, running: ${v ? 0 : 3} }),
  clearMediaHistory: async () => {},
  getExportStatus: () => ({ jobCount: ${v ? 2 : 8}, knownQueries: ${v ? 3 : 11} }),
  runExport: async () => ({ records: 0, filename: "aviary.json" }),
  copyDiagnostics: async () => {},
  resetSettings: async () => {},
  exportSettings: async () => {},
  importSettings: async () => ({ applied: true, warnings: [], errors: [] }),
  exportLibraryBackup: async () => ({ filename: "aviary-backup.json", collections: ${v ? 3 : 7}, bytes: ${v ? 1200 : 2400} }),
  previewLibraryRestore: async () => ({
    schemaVersion: 1,
    createdAt: "2026-08-0${v ? 6 : 5}T00:00:00Z",
    profile: null,
    includeCredentials: false,
    credentialsRedacted: true,
    totalBytes: ${v ? 1200 : 2400},
    collections: [{
      key: "aviary.settings.v1",
      label: "Settings",
      version: 1,
      present: true,
      count: ${v ? 1 : 2},
      byteLength: ${v ? 500 : 900},
      conflict: "replace",
      currentPresent: true,
      currentCount: 1,
      currentByteLength: 400
    }],
    conflictCount: ${v ? 1 : 2},
    warnings: ["Credentials are redacted; the values already saved in this profile will be kept."]
  }),
  restoreLibraryBackup: async () => ({
    applied: true,
    dryRun: false,
    cancelled: false,
    rolledBack: false,
    restoredKeys: ["aviary.settings.v1"],
    warnings: [],
    errors: [],
    rollbackErrors: [],
    preview: {}
  }),
  getAuditSize: () => ${v ? 3 : 12},
  getPageHooks: () => ({ reachable: true, reason: "", blockedBeacons: ${v ? 5 : 17} }),
  clearAuditLog: async () => {},
  getRetentionPolicy: () => ({ maxJobs: ${v ? 10 : 20}, maxRecordsPerJob: ${v ? 100 : 200}, maxAgeDays: ${v ? 30 : 60} }),
  saveRetentionPolicy: async () => {},
  getUserNotes: () => ({ ${v ? "someone" : "another"}: "a note" }),
  // Row labels are literals passed to the row builders, not to t(), so only a render can see
  // them. A conditional row needs its option supplied here or its copy never reaches the manifest.
  getUserColors: () => ({ ${v ? "someone" : "another"}: "${v ? "violet" : "sky"}" }),
  setUserColor: async () => {},
  exportFilterRules: async () => ({ filename: "aviary-filter-rules.txt", rules: ${v ? 2 : 5} }),
  previewFilterRuleImport: () => ({
    imported: ${v ? 2 : 5},
    comments: 0,
    add: { mode: "add", lines: [], added: 2, duplicates: 0, replaced: 0, total: 2, errors: [] },
    replace: { mode: "replace", lines: [], added: 2, duplicates: 0, replaced: 1, total: 2, errors: [] }
  }),
  applyFilterRuleImport: async () => ({ mode: "add", lines: [], added: 2, duplicates: 0, replaced: 0, total: 2, errors: [] }),
  setUserNote: async () => {},
  clearUserNotes: async () => {},
  // Real preset copy: a stub phrase here would enter the manifest and give translators a
  // string the product never shows.
  listPresets: () => [{ id: "quiet-reader", label: "Quiet Reader", description: "Hide trends and row borders, dim premium posts, strip t.co, dense + dim theme." }],
  applyPreset: async () => ({ applied: true, changes: [] }),
  listLocales: () => supportedLocales(),
  setLocale: async (code: string) => { settings.i18n.locale = code; },
  getCleanupQueueSize: () => ({ total: ${v ? 1 : 4}, queued: ${v ? 1 : 2}, approved: ${v ? 0 : 1}, skipped: ${v ? 0 : 1} }),
  enqueueCleanupReview: async () => ({ added: 1, protected: 0 }),
  clearCleanupQueue: async () => {},
  runMediaBatch: async () => ({ total: 0, downloaded: 0, duplicate: 0, failed: 0 }),
  offlineSearch: () => [],
  offlineSemanticSearch: async () => [],
  getCapturedMediaCount: () => ${v ? 3 : 8},
  runCapturedMediaBatch: async () => ({ total: 0, downloaded: 0, duplicate: 0, failed: 0 }),
  exportMediaHistory: async () => ({ records: 0, files: 2, filenames: ["history.json", "history.csv"] }),
  downloadWarc: async () => ({ records: 0 }),
  getWaczEstimate: () => ({ records: ${v ? 2 : 5}, estimatedBytes: ${v ? 2048 : 8192} }),
  downloadWacz: async () => ({ records: 0, bytes: 0, filename: "archive.wacz" }),
  getWaczSigningStatus: () => (${v
    ? '{ state: "ready", fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", createdAt: "2026-08-21T12:00:00Z" }'
    : '{ state: "missing", fingerprint: null, createdAt: null }'}),
  downloadSignedWacz: async () => ({ records: 0, bytes: 0, filename: "archive.wacz", fingerprint: "0123456789abcdef" }),
  exportWaczSigningKey: async () => ({ filename: "keypair.json", fingerprint: "0123456789abcdef" }),
  replaceWaczSigningKey: async () => ({ state: "ready", fingerprint: "0123456789abcdef", createdAt: "2026-08-21T12:00:00Z" }),
  exportToTarget: async () => ({ target: "notion", records: 0 }),
  crosspost: async () => ({ ok: true }),
  listAria2Active: async () => [
    { gid: "${v ? "abc123" : "def456"}", status: "active", totalLength: ${v ? 100 : 900}, completedLength: ${v ? 50 : 300}, path: "/tmp/${v ? "a" : "b"}.mp4" }
  ],
  cancelAria2: async () => ({ ok: true }),
  recentIntegrationErrors: () => [{ at: "2026-08-0${v ? 6 : 5}T00:00:00Z", kind: "aria2", message: "refused" }],
  rebuildSemanticIndex: async () => ({ added: 0, skipped: 0, errors: 0, total: 0 }),
  semanticSearchQuery: async () => [{ tweetId: "1", handle: "a", text: "t", score: 1 }],
  clearSemanticIndex: async () => {},
  pingAria2: async () => ({ ok: true }),
  getIntegrationStatus: () => ({
    aria2: { enabled: true, configured: true },
    bluesky: { enabled: true, configured: ${v} },
    mastodon: { enabled: true, configured: true },
    ai: { enabled: true, configured: true },
    semanticSearch: { enabled: true, configured: true, indexed: ${v ? 5 : 15} }
  }),
  getIntegrationUsage: () => ({
    day: "2026-08-0${v ? 6 : 5}",
    networkAllowed: true,
    localOnly: false,
    lastBlocked: null,
    ai: { requests: ${v ? 2 : 5}, bytes: ${v ? 1200 : 4200}, dailyLimitBytes: 10000 },
    embedding: { requests: ${v ? 4 : 9}, records: ${v ? 3 : 8}, bytes: ${v ? 1800 : 7200}, dailyLimitBytes: 20000 }
  }),
  clearIntegrationUsage: async () => {},
  captureSnapshot: async () => ({ count: 1, handle: "a" }),
  getSnapshotStatus: () => ({ total: ${v ? 1 : 6}, latestAt: "2026-08-0${v ? 6 : 5}T00:00:00Z", latestKind: "${v ? "followers" : "following"}", latestCount: ${v ? 2 : 8} }),
  diffLatestSnapshot: () => ({ added: 1, removed: 0, unchanged: 1 }),
  clearSnapshots: async () => {},
  importArchive: async () => ({ records: 0, warnings: 0, errors: 0 }),
  searchArchive: () => [{ handle: "a", tweetId: "1", text: "t", score: 1 }],
  downloadReport: async () => {},
  getHiddenPostsStatus: () => ({
    total: ${v ? 1 : 7},
    updatedAt: "2026-08-0${v ? 6 : 5}T00:00:00Z",
    recent: [{ key: "k", handle: "${v ? "someone" : "other"}", text: "hidden text", hiddenAt: "2026-08-0${v ? 6 : 5}" }]
  }),
  undoLastHide: async () => ({ restored: true, handle: "a" }),
  unhidePost: async () => true,
  clearHiddenPosts: async () => 1
}`;
}

async function renderStrings(page, variant) {
  const entry = path.join(temp, `entry-${variant}.ts`);
  await writeFile(
    entry,
    `import { mountControlCenter, renderedPanelStrings } from "${abs("src/ui/control-center.ts")}";
import { DEFAULT_SETTINGS, cloneSettings } from "${abs("src/platform/settings.ts")}";
import { supportedLocales } from "${abs("src/platform/i18n.ts")}";

const settings: any = cloneSettings(DEFAULT_SETTINGS);
// Turn on everything gated behind a settings flag, so no row is skipped.
settings.integrations.aria2.enabled = true;
settings.integrations.bluesky.enabled = true;
settings.integrations.mastodon.enabled = true;
settings.integrations.ai.enabled = true;
settings.integrations.semanticSearch.enabled = true;
// The beacon count row only renders when blocking is on; without this its label is copy no
// render reaches, which is how three sentences here shipped in English at full reported coverage.
settings.privacy.blockAnalyticsBeacons = true;

const handle = mountControlCenter({
  settings,
  // Both variants carry the same failure so the storage-health row renders its error
  // branch. Copy that only appears on one side of a condition would otherwise look like
  // data to the two-render diff and be dropped.
  diagnostics: () => [
    { level: "error", at: "2026-08-06T00:00:00Z", message: "Media history failed to save" }
  ] as any,
  onChange: async () => {},
  onError: () => {},
  ...${stubs(variant)}
});

(globalThis as any).__av = {
  handle,
  strings: () => renderedPanelStrings(),
  locales: supportedLocales().map((l) => l.label)
};`
  );

  const out = path.join(temp, `bundle-${variant}.js`);
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  const htmlPath = path.join(temp, `index-${variant}.html`);
  await writeFile(
    htmlPath,
    `<!doctype html><meta charset="utf-8"><body style="background:#000"><script src="bundle-${variant}.js"></script></body>`
  );

  const errors = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(htmlPath).href);
  if (errors.length > 0) {
    throw new Error(`mount failed (${variant}):\n${errors.join("\n")}`);
  }

  await page.evaluate(() =>
    document.getElementById("av-control-center").shadowRoot.querySelector(".av-launcher").click()
  );
  await page.evaluate(() => globalThis.__av.handle.refresh());
  // Since the panel gained a nav rail it draws one section at a time, and the coverage tally is
  // reset on every render -- so a single render now reports only the default section's strings.
  // Every section is visited and the results unioned, or rows outside "Presets" would silently
  // stop reaching the manifest.
  return page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const ids = [...shadow.querySelectorAll(".av-nav-item")].map((item) => item.dataset.avSection);
    if (ids.length === 0) {
      throw new Error("no nav items found -- the panel structure changed");
    }
    const strings = new Set();
    for (const id of ids) {
      shadow.querySelector(`.av-nav-item[data-av-section="${id}"]`).click();
      for (const value of globalThis.__av.strings()) {
        strings.add(value);
      }
    }
    return { strings: [...strings], locales: globalThis.__av.locales, sections: ids.length };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });

const a = await renderStrings(page, "a");
const b = await renderStrings(page, "b");
await browser.close();

const inB = new Set(b.strings);
const endonyms = new Set(a.locales);
const copy = a.strings.filter((s) => inB.has(s) && !endonyms.has(s));
const dropped = a.strings.filter((s) => !inB.has(s) || endonyms.has(s));

// Status and toast copy sits in branches a render cannot reach.
const src = (await readUiSources()).join("\n");
const statusLiterals = harvestStatusLiterals(src);
// Copy inside rows a render cannot reach (see harvestPanelLiterals).
const panelLiterals = harvestPanelLiterals(src);

// Features that inject into the timeline translate through `ft(ctx, "…")`. They never render
// inside the panel, so no amount of mounting finds them -- they are harvested from source, like
// the status literals. Preset labels and descriptions are static data in presets.ts and are
// wrapped with t() at render time, so they come from there too.
const featureSources = await readFeatureSources();
const featureLiterals = [...new Set(featureSources.flatMap(harvestFeatureLiterals))];

// The extension options page is a separate document that gets its subset defined in at build
// time, so its strings have to reach this manifest or that subset is empty.
const optionsHtml = await readFile(path.join(root, "src/extension/options.html"), "utf8");
const optionsController = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");
const optionsLiterals = harvestOptionsLiterals(optionsHtml, optionsController);

// The standalone export viewer inlines its own copy into a generated HTML file, so its strings
// never pass through a panel render or an ft() call. They are declared in one English map and
// resolved from the catalog at generation time; harvest that map so they reach this manifest.
const viewerSource = await readFile(path.join(root, "src/features/export/viewer.ts"), "utf8");
const viewerLiterals = harvestViewerLiterals(viewerSource);

/**
 * Collects every string literal inside a `setStatus(...)`, `setStatusCopy(...)`, or `save(...)` call.
 *
 * Anchoring on the literal that immediately follows the open paren misses the far more common
 * `save(checked ? "X on" : "X off")` form -- which is how nearly every toggle reports itself, so
 * those confirmations were shipping in English regardless of locale. Scanning to the matching
 * close paren instead catches both arms, and any future shape.
 */
/**
 * The English sources declared in the export viewer's VIEWER_COPY map. A viewer string is a
 * catalog string like any other; without this harvest the sync step, which rewrites the catalog in
 * manifest order, would silently drop every one of them.
 */
function harvestViewerLiterals(source) {
  const start = source.indexOf("const VIEWER_COPY = {");
  if (start === -1) {
    throw new Error("VIEWER_COPY was not found in viewer.ts; the viewer i18n harvest is broken");
  }
  const block = source.slice(start, source.indexOf("} as const;", start));
  const literals = [];
  for (const match of block.matchAll(LITERAL_RE)) {
    literals.push(JSON.parse('"' + match[1] + '"'));
  }
  if (literals.length === 0) {
    throw new Error("VIEWER_COPY harvested no strings; the viewer i18n harvest is broken");
  }
  return literals;
}

async function readFeatureSources() {
  const { readdir } = await import("node:fs/promises");
  const roots = [path.join(root, "src/features"), path.join(root, "src/ui")];
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".ts")) files.push(full);
    }
  };
  for (const dir of roots) await walk(dir);
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

async function readUiSources() {
  const { readdir } = await import("node:fs/promises");
  const uiRoot = path.join(root, "src/ui");
  const names = await readdir(uiRoot, { recursive: true });
  return Promise.all(
    names
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFile(path.join(uiRoot, name), "utf8"))
  );
}

/**
 * Every double-quoted literal reachable from an `ft(ctx, …)` call, plus the static
 * label/description/hint data (presets, AI commands) that the panel wraps in `t()` at render
 * time. Both arms of a ternary are taken, for the same reason the status harvest does it.
 */
function harvestFeatureLiterals(source) {
  const found = [];
  for (const match of source.matchAll(/\bft\([^,]+,\s*"((?:[^"\\]|\\.)*)"/g)) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  for (const match of source.matchAll(
    /\bft\([^,]+,[^)]*\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  )) {
    found.push(JSON.parse(`"${match[1]}"`), JSON.parse(`"${match[2]}"`));
  }
  for (const match of source.matchAll(
    /^\s+(?:label|description|hint):\s*"((?:[^"\\]|\\.)*)",?$/gm
  )) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  return found;
}

function harvestOptionsLiterals(html, controller) {
  const found = new Set();
  const decode = (value) =>
    value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, String.fromCharCode(34))
      .replace(/&#39;/g, String.fromCharCode(39));
  const attr = new RegExp('data-i18n="((?:[^"' + String.fromCharCode(92) + String.fromCharCode(92) + ']|' + String.fromCharCode(92) + String.fromCharCode(92) + '.)*)"', "g");
  for (const match of html.matchAll(attr)) {
    found.add(decode(match[1]));
  }
  const literal = '((?:[^"' + String.fromCharCode(92) + String.fromCharCode(92) + ']|' + String.fromCharCode(92) + String.fromCharCode(92) + '.)*)"';
  for (const pattern of [
    new RegExp(String.fromCharCode(92) + 'btranslate' + String.fromCharCode(92) + '(' + String.fromCharCode(92) + 's*"' + literal, "g"),
    new RegExp('(?:grantedLabel|missingLabel|grantedMessage):' + String.fromCharCode(92) + 's*"' + literal, "g")
  ]) {
    for (const match of controller.matchAll(pattern)) {
      found.add(JSON.parse('"' + match[1] + '"'));
    }
  }
  return [...found];
}

function harvestStatusLiterals(source) {
  const found = [];
  const readLiteral = (i) => {
    const quote = source[i];
    let j = i + 1;
    while (j < source.length && source[j] !== quote) {
      j += source[j] === "\\" ? 2 : 1;
    }
    if (quote === '"') {
      found.push(JSON.parse(source.slice(i, j + 1)));
    }
    return j;
  };

  const collectAllArguments = (start) => {
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === '"' || ch === "'" || ch === "`") i = readLiteral(i);
      i += 1;
    }
  };

  const collectFirstArgument = (start) => {
    let depth = 0;
    let i = start;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === "`") {
        i = readLiteral(i);
      } else if (ch === "(" || ch === "[" || ch === "{") {
        depth += 1;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) return;
        depth -= 1;
      } else if (ch === "," && depth === 0) {
        return;
      }
      i += 1;
    }
  };

  for (const match of source.matchAll(/\b(setStatusCopy|setStatus|save)\(/g)) {
    const start = match.index + match[0].length;
    if (match[1] === "setStatusCopy") collectFirstArgument(start);
    else collectAllArguments(start);
  }
  return [...new Set(found)];
}

// Previously-curated entries cover fallback rows ("… unavailable in this build.") that only
// appear when a capability is absent, which neither render nor the status scan reaches.
const prevOut = path.join(temp, "prev-catalog.mjs");
await build({
  entryPoints: [path.join(root, "src/platform/i18n-catalog.ts")],
  outfile: prevOut,
  bundle: true,
  format: "esm",
  platform: "neutral",
  logLevel: "silent"
});
const { PANEL_STRINGS: previous } = await import(pathToFileURL(prevOut).href);

const manifest = [];
const seen = new Set();
for (const s of [
  ...copy,
  ...statusLiterals,
  ...panelLiterals,
  ...featureLiterals,
  ...optionsLiterals,
  ...viewerLiterals,
  ...previous
]) {
  const v = s.trim();
  if (v.length > 0 && !seen.has(v)) {
    seen.add(v);
    manifest.push(v);
  }
}

console.log(`rendered:        ${a.strings.length} (${a.sections} sections visited)`);
console.log(`data / endonyms: ${dropped.length} dropped`);
console.log(`setStatus:       ${statusLiterals.length}`);
console.log(`panel t():       ${panelLiterals.length}`);
console.log(`ft() + presets:  ${featureLiterals.length}`);
console.log(`options page:    ${optionsLiterals.length}`);
console.log(`export viewer:   ${viewerLiterals.length}`);
console.log(`MANIFEST:        ${manifest.length}`);

const catOut = path.join(temp, "catalog.mjs");
await build({
  entryPoints: [path.join(root, "src/platform/i18n-catalog.ts")],
  outfile: catOut,
  bundle: true,
  format: "esm",
  platform: "neutral",
  logLevel: "silent"
});
const { panelCatalog } = await import(pathToFileURL(catOut).href);
const missing = {};
for (const loc of ["es", "pt", "fr", "de", "ja", "ko", "ar", "he"]) {
  const bundle = panelCatalog()[loc] ?? {};
  missing[loc] = manifest.filter((s) => bundle[s] === undefined);
  console.log(`  ${loc}: missing ${missing[loc].length}/${manifest.length}`);
}

if (write) {
  const target = path.join(root, "tools/i18n-manifest.json");
  await writeFile(target, `${JSON.stringify({ manifest, missing, dropped }, null, 2)}\n`);
  console.log(`wrote ${path.relative(root, target)}`);
}

await rm(temp, { recursive: true, force: true });

/**
 * Every double-quoted literal passed directly to `t(...)` in the panel source.
 *
 * The two-render diff can only see copy that some render actually reached, and a row rendered
 * behind a condition -- an unreachable page bridge, a hook that has not fired yet -- is copy no
 * stub can reliably produce in both variants at once. Those sentences shipped in English while
 * the manifest reported full coverage.
 *
 * `t()` takes the English source string as its key, so anything passed to it literally is copy by
 * definition. Collecting them from source needs no maintenance as rows are added, and the union
 * with the rendered set costs nothing when a string appears in both.
 */
function harvestPanelLiterals(source) {
  const found = [];
  for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  // Dynamic rows use a stable template plus runtime values so the final text remains localized.
  // Harvest both helper calls and action-row copy objects; neither reaches the literal-only t()
  // scan above.
  for (const match of source.matchAll(/\blocalizedCopy\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  for (const match of source.matchAll(/\bsource:\s*"((?:[^"\\]|\\.)*)"/g)) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  // Row helpers translate their label through a function parameter, so an unavailable callback
  // can hide the label from the browser render. Keep those labels in the manifest as source copy
  // too; otherwise a conditional data row can ship in English while coverage still reports full.
  for (const match of source.matchAll(/\b(?:dataRow|readonlyRow|actionRow|toggleRow|selectRow|textInputRow)\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  // And the sentence under the label, for every helper whose second argument *is* the
  // description. Harvesting only the label left the explanatory copy of every conditional row in
  // English while the manifest reported full coverage -- the same defect as above, one argument
  // to the right. `dataRow`/`readonlyRow` are excluded because their second argument is a value,
  // and `selectRow` because its description is the fifth.
  for (const match of source.matchAll(
    /\b(?:actionRow|toggleRow|textInputRow|textareaRow|surfaceRow|integerInputRow|secretInputRow)\(\s*"(?:(?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g
  )) {
    found.push(JSON.parse(`"${match[1]}"`));
  }
  return [...new Set(found)];
}
