import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("downloader throws instead of reporting success when downloads is not granted", async () => {
  const { createDownloader, DownloadPermissionError } = await importBundledModule(
    "src/features/media/downloader.ts"
  );

  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: false,
        code: "downloads-permission-missing",
        error: "downloads permission not granted"
      })
    }
  };

  try {
    const downloader = createDownloader();
    await assert.rejects(
      () => downloader({ url: "https://pbs.twimg.com/media/x.jpg", filename: "x.jpg" }),
      (error) => error instanceof DownloadPermissionError && error.code === "downloads-permission-missing"
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("downloader surfaces a background failure rather than silently navigating", async () => {
  const { createDownloader } = await importBundledModule("src/features/media/downloader.ts");
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { sendMessage: async () => ({ ok: false, error: "disk full" }) }
  };

  try {
    await assert.rejects(
      () => createDownloader()({ url: "https://pbs.twimg.com/media/x.jpg", filename: "x.jpg" }),
      /disk full/
    );
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("isCrossOrigin marks the anchor fallback degraded only when download is ignored", async () => {
  const { isCrossOrigin } = await importBundledModule("src/features/media/downloader.ts");
  assert.equal(isCrossOrigin("blob:https://x.com/abc"), false);
  assert.equal(isCrossOrigin("data:image/png;base64,AAAA"), false);
  // No `location` in node: treat unknown origin as cross-origin so callers never over-promise.
  assert.equal(isCrossOrigin("https://pbs.twimg.com/media/x.jpg"), true);
  assert.equal(isCrossOrigin("not a url"), false);
});

test("background answers the capability probe and opens the grant surface", async () => {
  const source = await readFile(path.join(root, "src/entrypoints/extension-background.ts"), "utf8");
  assert.match(source, /AVIARY_DOWNLOAD_CAPABILITY/);
  assert.match(source, /AVIARY_OPEN_OPTIONS/);
  assert.match(source, /openOptionsPage/);
  assert.match(source, /permissions\.contains\(\{ permissions: \["downloads"\] \}\)/);
  assert.match(source, /action\?\.onClicked/);
  assert.ok(
    source.includes("DOWNLOAD_PERMISSION_CODE"),
    "background must report the shared permission code so the content script can react"
  );
});

test("media buttons and batch downloads react to a missing download permission", async () => {
  const buttons = await readFile(path.join(root, "src/features/media/media-buttons.ts"), "utf8");
  assert.match(buttons, /DownloadPermissionError/);
  assert.match(buttons, /requestDownloadPermissionSurface/);
  assert.match(buttons, /permissionSurfaceOpened/, "the grant page must open at most once per session");
  assert.match(buttons, /result\.degraded \? "Opened"/, "a navigated anchor must not read as saved");

  const batch = await readFile(path.join(root, "src/features/media/batch-downloader.ts"), "utf8");
  assert.match(batch, /needsDownloadPermission/);
  assert.match(batch, /if \(needsDownloadPermission\) return;/, "the batch must stop, not repeat the same failure");
});

test("both manifests declare the options page that hosts the permission grant", async () => {
  for (const name of ["manifest.chrome.json", "manifest.firefox.json"]) {
    const manifest = JSON.parse(await readFile(path.join(root, "src/extension", name), "utf8"));
    assert.deepEqual(manifest.options_ui, { page: "options.html", open_in_tab: true }, name);
    assert.ok(manifest.optional_permissions.includes("downloads"), name);
  }
});

test("options page is CSP-clean and only touches the permissions API", async () => {
  const html = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html), "no inline script");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline handlers");
  assert.match(html, /src="options\.js"/);
  assert.match(html, /href="options\.css"/);

  const controller = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");
  assert.match(controller, /permissions\.request\(/);
  assert.match(controller, /permissions\.remove\(/);
  assert.ok(!/\bfetch\s*\(/.test(controller), "the options page must not make network calls");
  assert.ok(!/innerHTML/.test(controller), "no HTML injection sink");

  const css = await readFile(path.join(root, "src/extension/options.css"), "utf8");
  assert.ok(!/border-radius:\s*(999|9999)px|border-radius:\s*50%/.test(css), "no pill backdrops");
  assert.ok(!/backdrop-filter/.test(css));
});

test("the build ships the options page into both extension targets", async () => {
  const source = await readFile(path.join(root, "tools/build.mjs"), "utf8");
  assert.match(source, /extension-options\.ts/);
  assert.match(source, /options\.html/);
  assert.match(source, /options\.css/);

  const preflight = await readFile(path.join(root, "tools/preflight.mjs"), "utf8");
  assert.match(preflight, /options_ui\?\.page/);
  assert.match(preflight, /options\.html contains inline script/);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v180-"));
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
