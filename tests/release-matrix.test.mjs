import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THEMES = ["off", "dim", "lightsOut", "graphite", "plum", "midnight"];
const INPUT_MODES = ["keyboard", "coarse-pointer"];
const ROUTES = [
  ["/home", "home"],
  ["/home?tab=following", "home"],
  ["/alice_fixture", "profile"],
  ["/alice_fixture/followers", "profile"],
  ["/alice_fixture/following", "profile"],
  ["/alice_fixture/verified_followers", "profile"],
  ["/notifications", "notifications"],
  ["/messages", "messages"],
  ["/search?q=aviary", "search"],
  ["/alice_fixture/status/123456789", "status"],
  ["/i/media_viewer?url=https%3A%2F%2Fpbs.twimg.com%2Fmedia%2Ffixture", "unknown"]
];

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-release-matrix-"));
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

test("release matrix covers every deterministic route, locale, theme, and input mode", async () => {
  const [{ readRoute }, { normalizeSettings }, { panelCoverage, supportedLocales }] = await Promise.all([
    importBundledModule("src/platform/route.ts"),
    importBundledModule("src/platform/settings.ts"),
    importBundledModule("src/platform/i18n.ts")
  ]);
  const locales = supportedLocales();
  let combinations = 0;

  for (const [pathname, expectedSurface] of ROUTES) {
    const location = new URL(`https://x.com${pathname}`);
    assert.equal(
      readRoute({ href: location.href, pathname: location.pathname }).surface,
      expectedSurface,
      pathname
    );
    for (const locale of locales) {
      assert.equal(panelCoverage(locale.code).percent, 100, `${locale.code} coverage drifted`);
      for (const theme of THEMES) {
        for (const inputMode of INPUT_MODES) {
          const settings = normalizeSettings({
            appearance: { theme },
            accessibility: { reduceMotion: inputMode === "coarse-pointer" ? "always" : "system" },
            i18n: { locale: locale.code }
          });
          assert.equal(settings.appearance.theme, theme);
          assert.equal(settings.i18n.locale, locale.code);
          assert.equal(
            settings.accessibility.reduceMotion,
            inputMode === "coarse-pointer" ? "always" : "system"
          );
          combinations += 1;
        }
      }
    }
  }

  const ui = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
  assert.match(ui, /event\.key === "Escape"/);
  assert.match(ui, /event\.key !== "Tab"/);
  assert.match(ui, /@media \(pointer: coarse\)/);
  assert.match(ui, /min-height: 44px/);
  assert.equal(combinations, ROUTES.length * locales.length * THEMES.length * INPUT_MODES.length);
  console.log(
    `[release-matrix] ${combinations} route/locale/theme/input combinations; ${ROUTES.length} routes, ${locales.length} locales, ${THEMES.length} themes.`
  );
});

test("release matrix rejects malformed state, provider bodies, Unicode overflow, and ZIP bombs", async () => {
  const [{ normalizeSettings }, { IntegrationUsageLedger }, { utf8Bytes }, { runAiPrompt }, { readStoreZip, ZIP_LIMITS }] = await Promise.all([
    importBundledModule("src/platform/settings.ts"),
    importBundledModule("src/features/integrations/usage.ts"),
    importBundledModule("src/features/integrations/usage.ts"),
    importBundledModule("src/features/integrations/ai-provider.ts"),
    importBundledModule("src/features/export/zip-reader.ts")
  ]);

  for (const input of [
    null,
    [],
    "not-settings",
    JSON.parse('{"appearance":{"theme":"evil"},"i18n":{"locale":"?"}}'),
    JSON.parse('{"integrations":{"ai":{"maxRequestBytes":"NaN","dailyRequestBytes":-4}}}')
  ]) {
    const settings = normalizeSettings(input);
    assert.ok(THEMES.includes(settings.appearance.theme));
    assert.ok(["en", "es", "pt", "fr", "de", "ja", "ko", "ar", "he"].includes(settings.i18n.locale));
    assert.ok(Number.isFinite(settings.integrations.ai.maxRequestBytes));
    assert.ok(settings.integrations.ai.dailyRequestBytes >= 0);
  }

  const writes = [];
  const ledger = new IntegrationUsageLedger({
    async get() {
      return { schemaVersion: "corrupt", days: [{ prompt: "must not persist" }] };
    },
    async set(key, value) {
      writes.push({ key, value });
    }
  });
  await ledger.load();
  assert.equal((await ledger.reserveAi(8, { maxRequestBytes: 10, dailyBytes: 10 })).allowed, true);
  const dailyBlocked = await ledger.reserveAi(8, { maxRequestBytes: 10, dailyBytes: 10 });
  assert.equal(dailyBlocked.allowed, false);
  assert.doesNotMatch(JSON.stringify(writes), /must not persist/);

  const unicodeLedger = new IntegrationUsageLedger({
    async get() {
      return null;
    },
    async set() {}
  });
  const unicode = "🦄".repeat(100);
  assert.equal(utf8Bytes(unicode), 400);
  const unicodeBlocked = await unicodeLedger.reserveAi(utf8Bytes(unicode), {
    maxRequestBytes: 100,
    dailyBytes: 100
  });
  assert.equal(unicodeBlocked.allowed, false);

  const originalFetch = globalThis.fetch;
  const aiConfig = {
    enabled: true,
    provider: "openai",
    endpoint: "https://fixture.invalid/chat",
    apiKey: "fixture-key",
    model: "fixture-model",
    maxRequestBytes: 0,
    dailyRequestBytes: 0
  };
  try {
    globalThis.fetch = async () => new Response("null", { status: 200 });
    const emptyProvider = await runAiPrompt(aiConfig, { prompt: "fixture" });
    assert.deepEqual(emptyProvider, { ok: true, text: "" });
    globalThis.fetch = async () => new Response("{", { status: 200 });
    const malformedProvider = await runAiPrompt(aiConfig, { prompt: "fixture" });
    assert.equal(malformedProvider.ok, false);
    assert.match(malformedProvider.error, /JSON|unexpected|end/i);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const tooManyEntries = new Uint8Array(22);
  new DataView(tooManyEntries.buffer).setUint32(0, 0x06054b50, true);
  new DataView(tooManyEntries.buffer).setUint16(10, ZIP_LIMITS.maxEntries + 1, true);
  assert.throws(() => readStoreZip(tooManyEntries), /more than/);

  const oversizedEntry = new Uint8Array(68);
  const oversizedView = new DataView(oversizedEntry.buffer);
  oversizedView.setUint32(0, 0x02014b50, true);
  oversizedView.setUint32(20, 0, true);
  oversizedView.setUint32(24, ZIP_LIMITS.maxEntryUncompressedBytes + 1, true);
  oversizedView.setUint32(46, 0x06054b50, true);
  oversizedView.setUint16(56, 1, true);
  oversizedView.setUint16(58, 1, true);
  assert.throws(() => readStoreZip(oversizedEntry), /entry exceeds/);
});

test("route subscriptions survive teardown and a second boot", async () => {
  const { watchRoute } = await importBundledModule("src/platform/route.ts");
  const originalHistory = globalThis.history;
  const originalLocation = globalThis.location;
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  const hadHistory = Object.prototype.hasOwnProperty.call(globalThis, "history");
  const hadLocation = Object.prototype.hasOwnProperty.call(globalThis, "location");
  const hadAdd = Object.prototype.hasOwnProperty.call(globalThis, "addEventListener");
  const hadRemove = Object.prototype.hasOwnProperty.call(globalThis, "removeEventListener");
  const location = new URL("https://x.com/home");
  const listeners = new Set();
  const originalPush = () => {};
  const originalReplace = () => {};
  const history = {
    pushState: originalPush,
    replaceState: originalReplace
  };
  const setUrl = (value) => {
    const next = new URL(String(value), location.href);
    location.href = next.href;
  };
  Object.defineProperty(globalThis, "history", { configurable: true, value: history, writable: true });
  Object.defineProperty(globalThis, "location", { configurable: true, value: location, writable: true });
  globalThis.addEventListener = (type, listener) => {
    if (type === "popstate") listeners.add(listener);
  };
  globalThis.removeEventListener = (type, listener) => {
    if (type === "popstate") listeners.delete(listener);
  };

  try {
    history.pushState = (_state, _title, url) => setUrl(url);
    history.replaceState = (_state, _title, url) => setUrl(url);
    const firstBoot = [];
    const stopFirst = watchRoute((route) => firstBoot.push(route.surface));
    history.pushState({}, "", "/messages");
    await Promise.resolve();
    assert.deepEqual(firstBoot, ["messages"]);
    stopFirst();
    assert.equal(listeners.size, 0);
    const secondBoot = [];
    const stopSecond = watchRoute((route) => secondBoot.push(route.surface));
    history.replaceState({}, "", "/notifications");
    await Promise.resolve();
    assert.deepEqual(secondBoot, ["notifications"]);
    stopSecond();
    assert.equal(listeners.size, 0);
  } finally {
    if (hadHistory) globalThis.history = originalHistory;
    else delete globalThis.history;
    if (hadLocation) globalThis.location = originalLocation;
    else delete globalThis.location;
    if (hadAdd) globalThis.addEventListener = originalAdd;
    else delete globalThis.addEventListener;
    if (hadRemove) globalThis.removeEventListener = originalRemove;
    else delete globalThis.removeEventListener;
  }
});
