import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-boot-notice-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export * from ${JSON.stringify(abs("src/platform/boot-notice.ts"))};`,
      `export { boot } from ${JSON.stringify(abs("src/main.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryBootNotice",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("a boot failure becomes visible and states the reason", async () => {
  const result = await page.evaluate(() => {
    AviaryBootNotice.showBootFailureNotice("storage backend unavailable");
    const host = document.getElementById("av-boot-notice");
    const card = host?.shadowRoot?.querySelector(".card");
    const text = card?.textContent ?? "";
    const visible = host ? getComputedStyle(host).display !== "none" : false;
    AviaryBootNotice.removeBootFailureNotice();
    return {
      mounted: Boolean(host),
      visible,
      role: card?.getAttribute("role") ?? null,
      mentionsReason: text.includes("storage backend unavailable"),
      saysXIsFine: /X is unaffected/.test(text),
      removed: document.getElementById("av-boot-notice") === null
    };
  });

  assert.equal(result.mounted, true, "the notice must mount");
  assert.equal(result.visible, true, "the notice must be visible");
  assert.equal(result.role, "alert", "assistive technology must be told without a focus steal");
  assert.equal(result.mentionsReason, true, "the failure reason must be readable");
  assert.equal(result.saysXIsFine, true, "the notice must say X itself still works");
  assert.equal(result.removed, true, "removal must be complete");
});

test("the notice can be dismissed and never mounts twice", async () => {
  const result = await page.evaluate(() => {
    AviaryBootNotice.showBootFailureNotice("first");
    AviaryBootNotice.showBootFailureNotice("second");
    const hosts = document.querySelectorAll("#av-boot-notice").length;
    const host = document.getElementById("av-boot-notice");
    const button = host?.shadowRoot?.querySelector("button");
    button?.click();
    return { hosts, dismissed: document.getElementById("av-boot-notice") === null };
  });

  assert.equal(result.hosts, 1, "a second failure must not stack another notice");
  assert.equal(result.dismissed, true, "the dismiss control must remove the notice");
});

test("the notice mounts before body exists, because boot starts at document-start", async () => {
  const bare = await browser.newPage();
  // No <body>: this is the state a document-start failure can happen in.
  await bare.setContent("<!doctype html><html><head></head></html>");
  await bare.addScriptTag({ path: path.join(temp, "bundle.js") });
  const mounted = await bare.evaluate(() => {
    document.body?.remove();
    AviaryBootNotice.showBootFailureNotice("early failure");
    return document.getElementById("av-boot-notice") !== null;
  });
  await bare.close();
  assert.equal(mounted, true, "the notice must attach to documentElement when body is absent");
});

/**
 * A failure in the awaited prelude has to reach the notice too.
 *
 * `bootInternal` opens its own guard at the first feature, so storage initialization, the profile
 * load, the settings read and the audit log all ran outside it. Both entrypoints call `boot()` as
 * `void boot(...)`, so a rejection there went nowhere: the page kept `data-av-ready="booting"`, the
 * user saw an enhancer that silently did nothing, and the page bridge stayed installed. Extension
 * storage now lives in the background, so this drives the earlier host-migration read instead of
 * pretending the active database is still constructed on x.com.
 */
test("a failure before the first feature still reports itself", async () => {
  const result = await page.evaluate(async () => {
    AviaryBootNotice.removeBootFailureNotice();
    delete document.documentElement.dataset.avReady;

    const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    const originalChrome = globalThis.chrome;
    globalThis.chrome = {
      runtime: {
        id: "fixture-extension",
        async sendMessage() {
          return { ok: false, error: "background must not be reached" };
        }
      }
    };
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("indexedDB is unavailable in this context");
      }
    });

    let threw = false;
    try {
      await AviaryBootNotice.boot({ source: "extension" });
    } catch {
      threw = true;
    }

    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else delete globalThis.indexedDB;
    if (originalChrome) globalThis.chrome = originalChrome;
    else delete globalThis.chrome;

    const notice = document.getElementById("av-boot-notice");
    return {
      threw,
      ready: document.documentElement.dataset.avReady ?? null,
      noticeShown: notice !== null,
      reason: notice?.shadowRoot?.querySelector(".reason")?.textContent ?? ""
    };
  });

  assert.equal(result.threw, true, "boot must still reject so callers can see it");
  assert.equal(result.ready, "error", "the page must not be left claiming it is still booting");
  assert.equal(result.noticeShown, true, "a boot failure must be visible");
  assert.match(result.reason, /indexedDB/, "the notice must carry the reason");
});
