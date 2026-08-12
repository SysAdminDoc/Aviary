import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

test("an unchanged apply does not invalidate every article's processed stamp", async () => {
  const source = await readFile(path.join(root, "src/features/filtering/filter-engine.ts"), "utf8");

  // `generation` is both the compile id and the per-article stamp. Bumping it on every apply
  // meant the stamp check could never hit, so the whole visible timeline was re-extracted on
  // every mutation batch (~120ms while scrolling).
  const refresh = source.slice(
    source.indexOf("function refreshCompiled"),
    source.indexOf("function filterSignature")
  );
  assert.match(refresh, /signature === compiledSignature/);
  assert.match(refresh, /return;/);
  const bumpIndex = refresh.indexOf("generation += 1");
  const guardIndex = refresh.indexOf("return;");
  assert.ok(guardIndex < bumpIndex, "the early return must come before the generation bump");
});

test("filter recompiles when the rules change and not when they do not", async () => {
  const { compileFilters, decide } = await importBundledModule(
    "src/features/filtering/predicates.ts"
  );

  // The signature covers exactly the inputs compileFilters consumes; if a new input is added to
  // one and not the other, a settings change would stop taking effect. This pins that pairing.
  const engine = await readFile(path.join(root, "src/features/filtering/filter-engine.ts"), "utf8");
  const signature = engine.slice(engine.indexOf("function filterSignature"), engine.indexOf("function scanRoot"));
  for (const field of ["keywordRules", "regexRules", "whitelist", "premiumRule", "mediaTypes", "enabled"]) {
    assert.match(signature, new RegExp(`filter\\.${field}\\b`), `${field} missing from the signature`);
  }

  const base = {
    keywords: [],
    regex: [],
    whitelist: [],
    premium: "off",
    media: { photo: false, video: false, gif: false },
    generation: 1
  };
  const before = compileFilters(base);
  const after = compileFilters({ ...base, keywords: ["spam"], generation: 2 });
  const signal = { text: "this is spam", handle: "someone", premium: false, media: { photo: false, video: false, gif: false } };
  assert.equal(decide(signal, before), "show");
  assert.equal(decide(signal, after), "hide");
});

test("a corrupted stored value is reported instead of silently reading as unset", async () => {
  const { createStorageGateway, setStorageErrorSink } = await importBundledModule(
    "src/platform/storage.ts"
  );

  const reports = [];
  setStorageErrorSink((key, error, op) => reports.push({ key, op, message: String(error) }));

  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => "{not json",
    setItem: () => undefined,
    removeItem: () => undefined
  };
  try {
    const gateway = createStorageGateway("aviary");
    const value = await gateway.get("aviary.settings.v1", { fallback: true });
    // Still non-throwing: a bad read must not take the boot down.
    assert.deepEqual(value, { fallback: true });
  } finally {
    globalThis.localStorage = original;
    setStorageErrorSink(undefined);
  }

  assert.equal(reports.length, 1, "a failed read must reach the sink exactly once");
  assert.equal(reports[0].op, "read");
  assert.equal(reports[0].key, "aviary.settings.v1");
});

test("settings persistence has a single choke point that normalizes", async () => {
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  const panel = await readFile(path.join(root, "src/features/core/control-center.ts"), "utf8");

  // Panel toggles used to persist whatever was in memory while import/preset/locale persisted
  // normalized values -- two write paths with different guarantees.
  assert.match(main, /storage\.set\(SETTINGS_KEY, normalizeSettings\(cloneSettings\(settings\)\)\)/);
  assert.ok(
    !/storage\.set\(SETTINGS_KEY/.test(panel),
    "the panel must persist settings through ctx.saveSettings, not directly"
  );
  for (const handler of ["importSettings", "applyPreset", "setLocale"]) {
    // Anchored on the method definition -- the bare name also appears in the import list.
    const start = panel.indexOf(`async ${handler}(`);
    assert.ok(start > -1, `${handler} handler not found`);
    assert.match(panel.slice(start, start + 900), /ctx\.saveSettings\(\)/, `${handler} bypasses the choke point`);
  }
});

test("an out-of-range value cannot reach storage through saveSettings", async () => {
  const { normalizeSettings, DEFAULT_SETTINGS, cloneSettings } = await importBundledModule(
    "src/platform/settings.ts"
  );

  // What saveSettings now does, with a value a future handler could plausibly set.
  const settings = cloneSettings(DEFAULT_SETTINGS);
  settings.media.zipChunkSize = 999999;
  settings.appearance.theme = "not-a-theme";

  const persisted = normalizeSettings(cloneSettings(settings));
  assert.ok(persisted.media.zipChunkSize <= 1000, "the chunk size must be clamped before it is stored");
  assert.equal(persisted.appearance.theme, DEFAULT_SETTINGS.appearance.theme);
});

test("the action log records what happened, not the nearest available label", async () => {
  const { AUDIT_LOG_KEY } = await importBundledModule("src/features/core/audit-log.ts");
  assert.equal(typeof AUDIT_LOG_KEY, "string");

  const panel = await readFile(path.join(root, "src/features/core/control-center.ts"), "utf8");
  const snippets = await readFile(path.join(root, "src/features/composer/composer-snippets.ts"), "utf8");
  const audit = await readFile(path.join(root, "src/features/core/audit-log.ts"), "utf8");

  // Each of these used to be filed under the nearest export.* or settings.* label, so a failed
  // crosspost appeared in the user-facing log as "export.start".
  for (const action of ["crosspost", "aria2.cancel", "cleanup.enqueue", "semantic.index", "preset.apply", "snippet.insert"]) {
    assert.match(audit, new RegExp(`"${action.replace(".", "\.")}"`), `${action} is not a declared AuditAction`);
  }
  assert.match(panel, /record\("crosspost", \{/);
  assert.match(panel, /record\("aria2\.cancel", \{/);
  assert.match(panel, /record\("cleanup\.enqueue", \{/);
  assert.match(panel, /record\("semantic\.index", \{/);
  assert.match(panel, /record\("preset\.apply", \{/);
  assert.match(snippets, /record\("snippet\.insert", \{/);
  assert.ok(!/kind: "crosspost"/.test(panel), "crosspost no longer needs to smuggle its kind");
});

test("a failed crosspost surfaces as an integration error under its own kind", async () => {
  const { recentIntegrationErrors } = await importBundledModule(
    "src/features/core/integration-errors.ts"
  );

  const errors = recentIntegrationErrors([
    { at: "2026-08-07T00:00:00.000Z", action: "crosspost", detail: { target: "bluesky", ok: false, error: "Bluesky credentials missing" } },
    { at: "2026-08-07T00:00:01.000Z", action: "crosspost", detail: { target: "mastodon", ok: true, error: null } }
  ]);

  assert.equal(errors.length, 1, "only the failure is an error");
  assert.equal(errors[0].kind, "crosspost:bluesky");
  assert.equal(errors[0].message, "Bluesky credentials missing");
});

test("a refused aria2 handoff is reported rather than silently falling back", async () => {
  const downloader = await readFile(path.join(root, "src/features/media/downloader.ts"), "utf8");
  const buttons = await readFile(path.join(root, "src/features/media/media-buttons.ts"), "utf8");

  assert.match(downloader, /onWarn\?\.\("Aria2 refused the handoff/);
  assert.match(buttons, /onWarn: \(message, details\) => ctx\.diagnostics\.warn/);
});

test("each options-page permission card explains its own grant", async () => {
  const source = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");

  // Host access has nothing to do with "media saves through the browser".
  assert.match(source, /grantedMessage: "Granted\. Media saves through the browser now\."/);
  assert.match(source, /grantedMessage: "Granted\. Aviary can read full-size media directly for exports now\."/);
  // Routed through translate() since the page was localized, but still per-card.
  assert.match(source, /setStatus\(granted \? translate\(card\.grantedMessage\)/);
});

test("aria2 routes by size, so the threshold finally means something", async () => {
  const { createDownloader } = await importBundledModule("src/features/media/downloader.ts");
  const { shouldHandoffToAria2 } = await importBundledModule("src/features/integrations/aria2.ts");

  // The predicate always said yes without a size, and no caller ever supplied one -- so with
  // aria2 on, a 40 KB thumbnail was handed off just like a 4 GB video.
  const aria = { enabled: true, endpoint: "http://127.0.0.1:6800", secret: "", minBytes: 50_000_000 };
  assert.equal(shouldHandoffToAria2(aria, 10_000), false);
  assert.equal(shouldHandoffToAria2(aria, 90_000_000), true);
  assert.equal(shouldHandoffToAria2(aria, null), true, "an unknown size still hands off");

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (init?.method === "HEAD") {
      return { ok: true, headers: { get: () => "20000" } };
    }
    return { ok: true, json: async () => ({ result: "gid-1" }) };
  };

  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, click() {}, remove() {}, setAttribute() {} }),
    body: { append() {} }
  };

  try {
    const download = createDownloader({ integrations: { aria2: aria } });
    const result = await download({ url: "https://pbs.twimg.com/media/small.jpg", filename: "small.jpg" });
    assert.notEqual(result.via, "aria2", "a 20 KB file is below the 50 MB threshold");
    assert.ok(calls.some((call) => call.method === "HEAD"), "the size must actually be measured");
    assert.ok(
      !calls.some((call) => call.url.includes("jsonrpc")),
      "no aria2 RPC may be issued for a file below the threshold"
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});

test("the aria2 threshold is reachable from the panel", async () => {
  const panel = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/advanced.ts",
      "src/ui/control-center/sections/data.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");

  // It normalized and round-tripped for releases with no control anywhere in the UI.
  assert.match(panel, /Hand off files larger than \(MB\)/);
  assert.match(panel, /integrations\.aria2\.minBytes = Math\.max\(0, value\) \* 1_000_000/);
});

test("scroll capture is a real session rather than a one-await window", async () => {
  const source = await readFile(path.join(root, "src/features/export/export-feature.ts"), "utf8");

  // The lifecycle is serialized because settings changes and MutationObserver delivery can race.
  // The reconciliation helper keeps the session open across every apply while the toggle stays
  // enabled, instead of setting and clearing activeJobId around one append.
  const apply = source.slice(source.indexOf("async apply(ctx, root, addedNodes)"), source.indexOf("async destroy(ctx)"));
  assert.match(apply, /lifecycleQueue\.then\(\(\) => reconcileExportState/);
  assert.match(source, /if \(!lastExportEnabled \|\| !activeJobId\) \{/);
  assert.match(source, /checkpointStore\.start\(/);
  assert.match(source, /await finishCaptureSession\(ctx\)/);

  const run = source.slice(source.indexOf("export async function runExportOfVisibleTweets"));
  assert.ok(
    !/activeJobId = undefined;/.test(run.slice(0, run.indexOf("const records ="))),
    "the export run must not close the capture window it just opened"
  );

  // A session left open would never be marked done; teardown delegates to the same serialized
  // finisher used by the live false transition.
  const destroy = source.slice(source.indexOf("async destroy(ctx)"), source.indexOf("getStatus()"));
  assert.match(destroy, /await finishCaptureSession\(ctx\)/);
});

test("the nav rail signals that it scrolls", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // Thirteen sections overflow a short viewport; the last item rendered cut through its own
  // baseline with nothing to say there was more below it.
  const nav = source.slice(source.indexOf(".av-nav {"), source.indexOf(".av-nav-group"));
  assert.match(nav, /overflow-y: auto/);
  assert.match(nav, /mask-image: linear-gradient/);
  assert.match(nav, /scrollbar-gutter: stable/);
});

test("the options page is localized without importing the whole catalog", async () => {
  const html = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  const controller = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");
  const build = await readFile(path.join(root, "tools/build.mjs"), "utf8");
  const catalog = await readFile(path.join(root, "src/platform/i18n-catalog.ts"), "utf8");

  // The page is a separate document with no FeatureContext, so its subset is defined at build
  // time. Importing PANEL_CATALOG instead would put ~240KB into a page that ships a few KB.
  assert.ok(
    !/platform\/i18n/.test(controller),
    "the options page must not import the catalog directly"
  );
  assert.match(build, /define: \{ __AVIARY_OPTIONS_I18N__/);
  assert.match(controller, /readLocale/);
  assert.match(controller, /document\.documentElement\.dir =/, "RTL locales need a direction");

  // Every key the page marks up has to exist in the catalog, or the subset ships it in English.
  const keys = [...html.matchAll(/data-i18n="((?:[^"\\]|\\.)*)"/g)].map((match) =>
    match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, String.fromCharCode(34)).replace(/&#39;/g, String.fromCharCode(39))
  );
  assert.ok(keys.length >= 10, `expected the page to be marked up, found ${keys.length} keys`);

  const start = catalog.indexOf("  ja: {");
  const jaBlock = catalog.slice(start, catalog.indexOf(String.fromCharCode(10) + "  },", start));
  for (const key of keys) {
    assert.ok(jaBlock.includes(JSON.stringify(key)), `options string missing from ja: ${key.slice(0, 50)}`);
  }
});

test("the panel shows the build it is running, stamped from package.json", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const panel = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
  const build = await readFile(path.join(root, "tools/build.mjs"), "utf8");

  // Reloading an unpacked extension gives no signal about which build took effect unless the
  // running code says so. chrome.runtime.getManifest() would cover the extension only, so the
  // version is defined in at build time and both artifacts stay in step.
  assert.match(panel, /declare const __AVIARY_VERSION__/);
  assert.match(panel, /el\("span", "av-version", `v\$\{AVIARY_VERSION\}`\)/);
  assert.ok(
    !/t\(\s*`v\$\{AVIARY_VERSION\}/.test(panel),
    "a version number is data, not copy -- it must not be translated or counted for coverage"
  );

  const defines = [...build.matchAll(/define: \{ __AVIARY_VERSION__/g)];
  assert.equal(defines.length, 2, "the userscript and the content script both need the stamp");

  // The manifests are what chrome://extensions reads; they must not drift from package.json.
  for (const manifest of ["src/extension/manifest.chrome.json", "src/extension/manifest.firefox.json"]) {
    const parsed = JSON.parse(await readFile(path.join(root, manifest), "utf8"));
    assert.equal(parsed.version, pkg.version, `${manifest} is out of step with package.json`);
  }
});

test("store extension archives are byte-reproducible", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const archivePaths = [
    path.join(root, "dist", `extension-chrome-v${packageJson.version}.zip`),
    path.join(root, "dist", `extension-firefox-v${packageJson.version}.zip`)
  ];

  await execFileAsync(process.execPath, ["tools/build.mjs"], { cwd: root });
  const first = await Promise.all(archivePaths.map(async (archivePath) => createHash("sha256").update(await readFile(archivePath)).digest("hex")));
  await execFileAsync(process.execPath, ["tools/build.mjs"], { cwd: root });
  const second = await Promise.all(archivePaths.map(async (archivePath) => createHash("sha256").update(await readFile(archivePath)).digest("hex")));

  assert.deepEqual(second, first, "repeated builds changed a tracked ZIP without source changes");
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-audit0807-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
