import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * What Aviary actually registers when it boots.
 *
 * "Is this feature wired up?" used to be asserted one feature at a time as
 * `assert.match(main, /registry\.register\(cleanShareLinksFeature\)/)` — a claim about a line of
 * `main.ts` rather than about the running app. That regex passes for a registration placed after
 * an early return, and for a feature whose `init` throws on every boot. Here `boot()` runs
 * against the checked-in X fixture and the answer comes from the registry itself.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

/**
 * Features that a settings key or a preset promises. A key that drives nothing is the failure
 * this guards: the panel offers a switch, and flipping it changes nothing on the page.
 */
const PROMISED_FEATURE_IDS = [
  "appearance.theme",
  "layout.declutter",
  "library.cleanShareLinks",
  "filtering.engine",
  "filtering.hiddenPosts",
  "media.buttons",
  "core.selectorHealth",
  "core.controlCenter"
];

let browser;
let context;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-boot-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { boot } from ${JSON.stringify(abs("src/main.ts"))};`,
      // Same bundle on purpose: the local-only policy is module-scope state, so importing it here
      // proves main.ts and this test share one instance the way a real build does.
      `export { assertOutboundAllowed, LocalOnlyError } from ${JSON.stringify(abs("src/features/integrations/network-policy.ts"))};`,
      `export { SETTINGS_KEY } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryBoot",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  const fixture = await readFile(path.join(root, "tests/smoke/current-x-home.html"), "utf8");

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // The storage backend and the page-world handshake are origin-scoped, so the fixture is served
  // as x.com rather than about:blank. Nothing leaves the process: every other request is stubbed.
  await context.route("https://x.com/home", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixture })
  );
  await context.route("**/*", (route) =>
    route.request().url() === "https://x.com/home" ? route.fallback() : route.fulfill({ status: 204, body: "" })
  );
  page = await context.newPage();
  await page.goto("https://x.com/home");
  await page.addScriptTag({ path: bundle });
  await page.evaluate(async () => {
    window.__boot = { app: await AviaryBoot.boot({ source: "userscript" }) };
  });
  await page.waitForTimeout(50);
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("boot reaches ready rather than stalling or failing", async () => {
  const state = await page.evaluate(() => ({
    ready: document.documentElement.dataset.avReady,
    source: document.documentElement.dataset.avSource,
    booted: Boolean(window.__boot.app)
  }));

  assert.equal(state.booted, true, "boot must return an app handle");
  assert.equal(state.ready, "true", "boot must finish — 'booting' means it hung, 'error' that it threw");
  assert.equal(state.source, "userscript");
});

test("every feature the settings promise is registered in the running app", async () => {
  const ids = await page.evaluate(() => window.__boot.app.registry.ids());

  const missing = PROMISED_FEATURE_IDS.filter((id) => !ids.includes(id));
  assert.deepEqual(missing, [], "these are offered in the panel and nothing registered them");
  assert.equal(new Set(ids).size, ids.length, "registration is keyed by id; a duplicate would throw");
});

test("no feature is shipped in a state where its own init throws", async () => {
  const inactive = await page.evaluate(() => {
    const registry = window.__boot.app.registry;
    return registry.ids().filter((id) => !registry.isActive(id));
  });

  // The registry isolates a throwing feature rather than failing the boot, which is right at
  // runtime and wrong to ship: the feature is simply absent and nothing on the page says so.
  assert.deepEqual(inactive, [], "these features failed to initialize on a clean boot");
});

test("the only feature reporting a problem is the one this harness cannot give a page world", async () => {
  const statuses = await page.evaluate(() => window.__boot.app.registry.statuses());
  const bad = statuses.filter((status) => status.ok === false).map((status) => status.message);

  // Injecting the bundle with `addScriptTag` puts it in the page's own world, so the isolated
  // world half of the bridge has nothing to hand a page agent — the same shape as a userscript
  // manager without `@inject-into page`, and the reason that status exists. Anything else here
  // is a feature that came up broken on a clean boot.
  assert.deepEqual(bad, ["no-page-scope"]);
});

test("local-only mode reads the live setting the app booted with, not a snapshot of it", async () => {
  const result = await page.evaluate(() => {
    const settings = window.__boot.app.context.settings;
    const attempt = () => {
      try {
        AviaryBoot.assertOutboundAllowed("A request");
        return null;
      } catch (error) {
        return error instanceof AviaryBoot.LocalOnlyError ? "local-only" : String(error);
      }
    };

    const before = settings.privacy.localOnly;
    settings.privacy.localOnly = false;
    const allowed = attempt();
    // Flipping the switch has to apply at once; a policy captured at boot would need a reload.
    settings.privacy.localOnly = true;
    const blocked = attempt();
    settings.privacy.localOnly = before;
    return { allowed, blocked };
  });

  assert.equal(result.allowed, null, "outbound calls are permitted while local-only is off");
  assert.equal(result.blocked, "local-only", "turning local-only on must block without a reload");
});

test("the one path that persists settings normalizes them on the way through", async () => {
  const stored = await page.evaluate(async () => {
    const context = window.__boot.app.context;
    const settings = context.settings;

    // Values a panel handler could hold in memory but must never reach storage: out of range,
    // negative, and an enum member that does not exist.
    settings.hidden.maxEntries = 10_000_000;
    settings.jobs.concurrentDownloads = -4;
    settings.appearance.theme = "chartreuse";

    await context.saveSettings();

    // Read back through the gateway the app writes with, not from the in-memory object.
    const written = await context.storage.get(AviaryBoot.SETTINGS_KEY, undefined);
    return { written: JSON.stringify(written), inMemory: settings.appearance.theme };
  });

  assert.ok(stored.written && stored.written !== "undefined", "settings were not persisted at all");
  // Normalization happens on the way to storage; the in-memory object is deliberately left as the
  // caller set it, which is why the choke point has to be the write and not the setter.
  assert.equal(stored.inMemory, "chartreuse");
  assert.ok(!stored.written.includes("chartreuse"), "an unknown theme reached storage");
  assert.ok(!stored.written.includes("10000000"), "an out-of-range retention limit reached storage");
  assert.ok(!/"concurrentDownloads":-/.test(stored.written), "a negative concurrency reached storage");
});

test("destroy puts the page back and leaves nothing registered as active", async () => {
  const after = await page.evaluate(async () => {
    await window.__boot.app.destroy();
    const registry = window.__boot.app.registry;
    return {
      ready: document.documentElement.dataset.avReady ?? null,
      source: document.documentElement.dataset.avSource ?? null,
      active: registry.ids().filter((id) => registry.isActive(id)),
      panel: Boolean(document.getElementById("av-control-center"))
    };
  });

  assert.equal(after.ready, null, "the ready marker must go with the app");
  assert.equal(after.source, null);
  assert.deepEqual(after.active, [], "every feature must have been torn down");
  assert.equal(after.panel, false, "the injected panel must be removed");
});
