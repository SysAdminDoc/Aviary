import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

test("filter recompiles when the rules change and not when they do not", async () => {
  const { compileFilters, decide } = await importSourceModule(
    "src/features/filtering/predicates.ts"
  );

  // That every settings input actually invalidates the compiled filter is proven by changing each
  // one mid-session in tests/filter-engine-work.test.mjs; this is the compiler's own contract.

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
  const { createStorageGateway, setStorageErrorSink } = await importSourceModule(
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

test("an out-of-range value cannot reach storage through saveSettings", async () => {
  const { normalizeSettings, DEFAULT_SETTINGS, cloneSettings } = await importSourceModule(
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

test("the action log is keyed by its own store, not by a label borrowed from elsewhere", async () => {
  const { AUDIT_LOG_KEY, AuditLog } = await importSourceModule("src/features/core/audit-log.ts");
  assert.equal(typeof AUDIT_LOG_KEY, "string");

  const values = new Map();
  const storage = {
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    }
  };

  const log = new AuditLog(storage, undefined, () => {}, () => true);
  await log.load();
  // Each of these used to be filed under the nearest export.* or settings.* label, so a failed
  // crosspost appeared in the user-facing log as "export.start". `AuditAction` is a type, so an
  // undeclared action is a typecheck failure; what this asserts is that the store keeps the
  // action it was handed rather than folding it into a neighbour.
  for (const action of ["crosspost", "aria2.cancel", "cleanup.enqueue", "semantic.index", "preset.apply", "snippet.insert"]) {
    await log.record(action, { probe: action });
  }

  const recorded = log.snapshot().entries.map((entry) => entry.action);
  assert.deepEqual(recorded, [
    "crosspost",
    "aria2.cancel",
    "cleanup.enqueue",
    "semantic.index",
    "preset.apply",
    "snippet.insert"
  ]);
  assert.ok(
    JSON.stringify([...values.values()]).includes("aria2.cancel"),
    "the log must persist under its own key, or it is gone on the next reload"
  );
});

test("a failed crosspost surfaces as an integration error under its own kind", async () => {
  const { recentIntegrationErrors } = await importSourceModule(
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

test("aria2 routes by size, so the threshold finally means something", async () => {
  const { createDownloader } = await importSourceModule("src/features/media/downloader.ts");
  const { shouldHandoffToAria2 } = await importSourceModule("src/features/integrations/aria2.ts");

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

test("the options page is localized without importing the whole catalog", async () => {
  const html = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  // The page is a separate document with no FeatureContext, so its subset is defined at build
  // time. Importing the panel catalog instead would put ~240KB into a page that ships a few KB,
  // which is a claim about the shipped file rather than about a line in the controller.
  const packaged = path.join(root, "dist", "extension-chrome", "options.js");
  if (existsSync(packaged)) {
    const shipped = await readFile(packaged, "utf8");
    const bytes = Buffer.byteLength(shipped, "utf8");
    assert.ok(
      bytes < 120_000,
      `the options bundle is ${Math.round(bytes / 1024)}KB — the whole catalog looks to be in it`
    );
    // The subset is defined in, so the strings are there while the panel's own catalog is not.
    assert.ok(shipped.includes("Grant download access"), "the options subset did not reach the bundle");
    assert.ok(
      !shipped.includes("Local controls for a quieter X."),
      "a panel-only string is in the options bundle, so the whole catalog came with it"
    );
  }

  // Every key the page marks up has to exist in the catalog, or the subset ships it in English.
  const keys = [...html.matchAll(/data-i18n="((?:[^"\\]|\\.)*)"/g)].map((match) =>
    match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, String.fromCharCode(34)).replace(/&#39;/g, String.fromCharCode(39))
  );
  assert.ok(keys.length >= 10, `expected the page to be marked up, found ${keys.length} keys`);

  // Read through the accessor rather than slicing the generated source. This used to look for a
  // "  ja: {" block, which stopped existing the moment the catalog became a lazily parsed JSON
  // string -- a passing assertion about a file's shape rather than about its contents.
  const { panelCatalog } = await importSourceModule("src/platform/i18n-catalog.ts");
  const ja = panelCatalog().ja ?? {};
  for (const key of keys) {
    assert.ok(ja[key] !== undefined, `options string missing from ja: ${key.slice(0, 50)}`);
  }
});

test("both shipped artifacts carry the build version, not the fallback", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const artifacts = ["dist/aviary.user.js", "dist/extension-chrome/content.js"];

  // `npm run verify` tests before it builds, so on a version bump dist/ still carries the previous
  // release and on a first-ever run it does not exist. Preflight gates version parity on the build
  // that follows either way; what this adds is that the define reached the bundle at all.
  const manifestPath = path.join(root, "dist", "extension-chrome", "manifest.json");
  if (!existsSync(manifestPath)) return;
  const built = JSON.parse(await readFile(manifestPath, "utf8"));
  if (built.version !== pkg.version) return;

  for (const artifact of artifacts) {
    const file = path.join(root, artifact);
    if (!existsSync(file)) {
      continue;
    }
    const source = await readFile(file, "utf8");
    // The stamp is defined in at build time rather than read from chrome.runtime.getManifest(),
    // which would only ever answer for the extension and leave the userscript saying "dev".
    assert.ok(
      source.includes(pkg.version),
      `${artifact} does not carry version ${pkg.version} — the build define did not reach it`
    );
    assert.ok(
      !/av-version[^]{0,40}"vdev"/.test(source),
      `${artifact} shipped the "dev" version fallback`
    );
  }

  // What the panel does with the stamp is driven in tests/panel-appearance-contract.test.mjs;
  // what chrome://extensions reads is gated by preflight's version parity check.
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

/**
 * A delete is a write, and it was the one write the sink could not see.
 *
 * `get` reports and returns its fallback; `set` reports and rethrows. `remove` did neither, so a
 * failed delete threw raw at the caller and never reached diagnostics -- while this module's own
 * comment promises it catches every write "and every store added later, without each having to
 * remember to plumb a sink through its constructor". ProfileManager.adoptLegacyIntoActive calls
 * remove() bare, so a backend failure there was an unreported rejection.
 */
test("a failed delete reaches the storage error sink", async () => {
  const { createStorageGateway, setStorageErrorSink } = await importSourceModule(
    "src/platform/storage.ts"
  );

  const reports = [];
  setStorageErrorSink((key, error, op) => reports.push({ key, op, message: String(error) }));

  const original = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => {
      throw new Error("backend refused the delete");
    }
  };

  let threw = null;
  try {
    const gateway = createStorageGateway("aviary");
    await gateway.remove("aviary.snapshots.v1").catch((error) => {
      threw = error;
    });
  } finally {
    globalThis.localStorage = original;
    setStorageErrorSink(undefined);
  }

  assert.equal(reports.length, 1, "a failed delete must reach the sink exactly once");
  assert.equal(reports[0].op, "write", "a delete is a write");
  assert.equal(reports[0].key, "aviary.snapshots.v1");
  assert.ok(threw, "and it must still reach the caller, the way a failed set does");
  assert.match(String(threw), /backend refused the delete/);
});

/**
 * A blob that never got downloaded still has to be released.
 *
 * Both helpers created the object URL, built an anchor, clicked it, and only then armed the revoke
 * timer. A throw anywhere in between -- a null document.body, a click the page blocks -- stranded
 * the blob for the lifetime of the document. The sidecar helper additionally returned false, as
 * though nothing had been allocated at all.
 */
test("a blob download releases its object URL when the click throws", async () => {
  const { saveMediaSidecar } = await importSourceModule("src/features/media/sidecar.ts");

  const created = [];
  const revoked = [];
  const originalDocument = globalThis.document;
  const originalURL = globalThis.URL;

  globalThis.URL = class extends originalURL {
    static createObjectURL() {
      const url = `blob:test/${created.length}`;
      created.push(url);
      return url;
    }
    static revokeObjectURL(url) {
      revoked.push(url);
    }
  };

  const makeDocument = (onClick) => ({
    createElement: () => ({
      href: "",
      download: "",
      rel: "",
      click: onClick,
      remove: () => undefined
    }),
    body: { append: () => undefined }
  });

  try {
    globalThis.document = makeDocument(() => {
      throw new Error("the page refused the download");
    });
    const failed = saveMediaSidecar({
      format: "json",
      mediaFilename: "photo.jpg",
      sourceUrl: "https://pbs.twimg.com/media/photo.jpg",
      tweetId: "1",
      handle: "someone"
    });

    assert.equal(failed, false, "the caller is still told it did not save");
    assert.equal(created.length, 1, "the URL was created");
    assert.deepEqual(revoked, created, "and released rather than stranded");

    // The control: a download that works hands the URL to the revoke timer instead, so it is not
    // revoked before the browser has read it.
    created.length = 0;
    revoked.length = 0;
    globalThis.document = makeDocument(() => undefined);
    const saved = saveMediaSidecar({
      format: "json",
      mediaFilename: "photo.jpg",
      sourceUrl: "https://pbs.twimg.com/media/photo.jpg",
      tweetId: "1",
      handle: "someone"
    });
    assert.equal(saved, true);
    assert.equal(created.length, 1);
    assert.deepEqual(revoked, [], "not revoked while the download is still starting");
  } finally {
    globalThis.URL = originalURL;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
