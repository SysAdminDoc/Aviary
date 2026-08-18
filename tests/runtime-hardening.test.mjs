import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The runtime guarantees that used to be asserted by grepping for the identifier that implements
 * them: `/BLOCKED_OBJECT_KEYS/`, `/CRITICAL_SURFACES/`, `/MIN_LOG_INTERVAL_MS/`,
 * `/history\.pushState = originalPush/`. A constant can exist and never be consulted, and a
 * restore line can sit on a branch that never runs. Each one is exercised here.
 *
 * These are hardening properties rather than features: prototype pollution through an imported
 * settings file, a browser with no storage at all, a page whose history methods Aviary borrowed,
 * and a degraded-selector log that must not flood the diagnostics ring.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-hardening-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
      `export { createStorageGateway } from ${JSON.stringify(abs("src/platform/storage.ts"))};`,
      `export { getSelectorHealthForRoute } from ${JSON.stringify(abs("src/platform/selectors.ts"))};`,
      `export { selectorHealthFeature } from ${JSON.stringify(abs("src/features/core/selector-health.ts"))};`,
      `export { watchRoute } from ${JSON.stringify(abs("src/platform/route.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryHard",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("an imported settings object cannot reach Object.prototype", async () => {
  const result = await page.evaluate(() => {
    // The shape an attacker would put in a settings file the user was talked into importing.
    const hostile = JSON.parse(
      '{"filter":{"mediaTypes":{"__proto__":{"polluted":true},"constructor":{"polluted":true},"prototype":{"polluted":true},"photo":true}}}'
    );

    const normalized = AviaryHard.normalizeSettings(hostile);
    return {
      prototypePolluted: {}.polluted === true,
      arrayPolluted: [].polluted === true,
      keptKeys: Object.keys(normalized.filter.mediaTypes ?? {}),
      photo: normalized.filter.mediaTypes?.photo
    };
  });

  assert.equal(result.prototypePolluted, false, "Object.prototype was polluted by an import");
  assert.equal(result.arrayPolluted, false);
  assert.ok(!result.keptKeys.includes("__proto__"), `kept ${JSON.stringify(result.keptKeys)}`);
  assert.ok(!result.keptKeys.includes("constructor"));
  assert.ok(!result.keptKeys.includes("prototype"));
  assert.equal(result.photo, true, "a legitimate key alongside them must survive");
});

test("telemetry is off in the defaults and cannot be turned on by an import", async () => {
  const result = await page.evaluate(() => ({
    fromDefaults: AviaryHard.DEFAULT_SETTINGS.privacy.telemetry,
    fromImport: AviaryHard.normalizeSettings({ privacy: { telemetry: true } }).privacy.telemetry
  }));

  // Aviary sends nothing anywhere; the setting exists so the panel can say so, not so it can be
  // switched. An import that flips it would be a silent change of that promise.
  assert.equal(result.fromDefaults, false);
  assert.equal(result.fromImport, false, "an imported file turned telemetry on");
});

test("a browser with no storage at all fails loudly rather than pretending to save", async () => {
  const result = await page.evaluate(async () => {
    const localStorage = Object.getOwnPropertyDescriptor(window, "localStorage");
    const sessionStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const chrome = globalThis.chrome;
    const gmSet = globalThis.GM_setValue;
    try {
      Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
      Object.defineProperty(window, "sessionStorage", { value: undefined, configurable: true });
      delete globalThis.chrome;
      delete globalThis.GM_setValue;

      const gateway = AviaryHard.createStorageGateway("aviary");
      try {
        await gateway.set("probe.v1", { a: 1 });
        return { threw: false };
      } catch (error) {
        return { threw: true, message: String(error) };
      }
    } finally {
      if (localStorage) Object.defineProperty(window, "localStorage", localStorage);
      if (sessionStorage) Object.defineProperty(window, "sessionStorage", sessionStorage);
      if (chrome) globalThis.chrome = chrome;
      if (gmSet) globalThis.GM_setValue = gmSet;
    }
  });

  // Silently discarding writes is the failure this guards: every setting appears to save and
  // none of them survive a reload.
  assert.equal(result.threw, true, "a write with no backend resolved as if it had been stored");
  assert.match(result.message, /No storage backend is available/);
});

test("selector health accepts an element root as well as the document", async () => {
  const result = await page.evaluate(() => {
    document.body.innerHTML = `
      <div id="react-root">
        <main data-testid="primaryColumn"></main>
        <a data-testid="AppTabBar_Home"></a>
      </div>`;

    // The mutation observer hands in the changed subtree, not the document. A reader that only
    // accepted a document would report every surface missing on every incremental pass.
    const fromDocument = AviaryHard.getSelectorHealthForRoute(document, "home");
    const fromElement = AviaryHard.getSelectorHealthForRoute(document.getElementById("react-root"), "home");
    const named = (list, surface) => list.find((item) => item.surface === surface)?.healthy;
    return {
      documentPrimary: named(fromDocument, "Primary column"),
      elementPrimary: named(fromElement, "Primary column"),
      elementRootItself: named(fromElement, "App root")
    };
  });

  assert.equal(result.documentPrimary, true);
  assert.equal(result.elementPrimary, true, "an element root reported its own subtree as missing");
  assert.equal(result.elementRootItself, true, "the root element must match itself, not only its descendants");
});

test("a degraded timeline does not flood diagnostics on every mutation batch", async () => {
  const warnings = await page.evaluate(async () => {
    // No primary column: every pass is a degraded pass, which is exactly when a per-batch log
    // would bury everything else in the diagnostics ring.
    document.body.innerHTML = `<div id="react-root"><a data-testid="AppTabBar_Home"></a></div>`;
    const seen = [];
    const ctx = {
      route: { surface: "home", path: "/home" },
      settings: AviaryHard.cloneSettings(AviaryHard.DEFAULT_SETTINGS),
      storage: { async get(_key, fallback) { return fallback; }, async set() {}, async remove() {} },
      diagnostics: { info() {}, warn(message) { seen.push(message); }, error() {} }
    };
    await AviaryHard.selectorHealthFeature.init(ctx);
    for (let i = 0; i < 25; i++) {
      await AviaryHard.selectorHealthFeature.apply(ctx, document);
    }
    AviaryHard.selectorHealthFeature.destroy(ctx);
    return seen;
  });

  assert.ok(warnings.length >= 1, "a degraded timeline must be reported at least once");
  assert.ok(
    warnings.length <= 3,
    `25 identical degraded passes produced ${warnings.length} log lines; the interval floor is not holding`
  );
});

test("route watching gives the page its history methods back when it stops", async () => {
  const result = await page.evaluate(() => {
    const beforePush = history.pushState;
    const beforeReplace = history.replaceState;

    const stop = AviaryHard.watchRoute(() => {});
    const whilePatched = { push: history.pushState, replace: history.replaceState };
    stop();

    return {
      // Some engines route this through the Navigation API instead, in which case nothing is
      // patched at all — either way, what must never happen is a patch left behind.
      patched: whilePatched.push !== beforePush || whilePatched.replace !== beforeReplace,
      restoredPush: history.pushState === beforePush,
      restoredReplace: history.replaceState === beforeReplace
    };
  });

  assert.equal(result.restoredPush, true, "history.pushState was left patched after teardown");
  assert.equal(result.restoredReplace, true, "history.replaceState was left patched after teardown");
});
