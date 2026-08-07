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
 * 4. Status and error copy lives in branches one render cannot reach, so `setStatus("…")`
 *    literals are harvested from the source and unioned in.
 */
import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
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
  exportSettings: async () => {},
  importSettings: async () => ({ applied: true, warnings: [], errors: [] }),
  getAuditSize: () => ${v ? 3 : 12},
  clearAuditLog: async () => {},
  getRetentionPolicy: () => ({ maxJobs: ${v ? 10 : 20}, maxRecordsPerJob: ${v ? 100 : 200}, maxAgeDays: ${v ? 30 : 60} }),
  saveRetentionPolicy: async () => {},
  getUserNotes: () => ({ ${v ? "someone" : "another"}: "a note" }),
  setUserNote: async () => {},
  clearUserNotes: async () => {},
  listPresets: () => [{ id: "quiet", label: "Quiet Reader", description: "A calmer timeline." }],
  applyPreset: async () => ({ applied: true, changes: [] }),
  listLocales: () => supportedLocales(),
  setLocale: async (code: string) => { settings.i18n.locale = code; },
  getCleanupQueueSize: () => ({ total: ${v ? 1 : 4}, queued: ${v ? 1 : 2}, approved: ${v ? 0 : 1}, skipped: ${v ? 0 : 1} }),
  enqueueCleanupReview: async () => ({ added: 1, protected: 0 }),
  clearCleanupQueue: async () => {},
  runMediaBatch: async () => ({ total: 0, downloaded: 0, duplicate: 0, failed: 0 }),
  downloadWarc: async () => ({ records: 0 }),
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
  return page.evaluate(() => ({
    strings: globalThis.__av.strings(),
    locales: globalThis.__av.locales
  }));
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
const src = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
const statusLiterals = [...src.matchAll(/\b(?:setStatus|save)\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
  JSON.parse(`"${m[1]}"`)
);

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
for (const s of [...copy, ...statusLiterals, ...previous]) {
  const v = s.trim();
  if (v.length > 0 && !seen.has(v)) {
    seen.add(v);
    manifest.push(v);
  }
}

console.log(`rendered:        ${a.strings.length}`);
console.log(`data / endonyms: ${dropped.length} dropped`);
console.log(`setStatus:       ${statusLiterals.length}`);
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
const { PANEL_CATALOG } = await import(pathToFileURL(catOut).href);
const missing = {};
for (const loc of ["es", "pt", "fr", "de", "ja", "ko", "ar", "he"]) {
  const bundle = PANEL_CATALOG[loc] ?? {};
  missing[loc] = manifest.filter((s) => bundle[s] === undefined);
  console.log(`  ${loc}: missing ${missing[loc].length}/${manifest.length}`);
}

if (write) {
  const target = path.join(root, "tools/i18n-manifest.json");
  await writeFile(target, `${JSON.stringify({ manifest, missing, dropped }, null, 2)}\n`);
  console.log(`wrote ${path.relative(root, target)}`);
}

await rm(temp, { recursive: true, force: true });
