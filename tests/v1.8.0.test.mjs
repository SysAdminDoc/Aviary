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

test("a Control Center render restores focus, caret and scroll", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // The bug: save() -> render() -> body.replaceChildren() dropped focus to the document.
  const render = source.slice(source.indexOf("const render = ("), source.indexOf("const presetRows"));
  assert.match(render, /const identity = focusIdentity\(active\)/);
  assert.match(render, /const scrollTop = body\.scrollTop/);
  assert.match(render, /body\.scrollTop = scrollTop/);
  assert.match(render, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(render, /restoreSelection\(target, selection\)/);

  // Identity must survive a rebuild, so it cannot be a node reference.
  assert.match(source, /const focusIdentity = \(node: Element \| null\): string \| null/);
  assert.match(source, /`row\|\$\{sectionTitle\}\|\$\{label\}\|\$\{node\.tagName\}\|\$\{index\}`/);
  assert.match(source, /function positionalPath\(/, "controls outside a labelled row need a fallback");
  assert.match(source, /setSelectionRange/);
});

test("hideBorders targets structure, not generated atomic class names", async () => {
  const source = await readFile(path.join(root, "src/features/appearance/theme.ts"), "utf8");
  assert.match(source, /root\.classList\.toggle\("av-hide-borders", settings\.appearance\.hideBorders\)/);
  assert.match(source, /html\.av-hide-borders \[data-testid="cellInnerDiv"\] > div/);
  assert.match(source, /html\.av-hide-borders \[data-testid="primaryColumn"\]/);
  assert.match(source, /"av-hide-borders"/, "destroy must drop the class");
  assert.ok(!/\.r-[a-z0-9]{5,}/.test(source), "no dependency on X's generated class names");
});

test("writer mode is focus-driven, reversible, and registers no key handlers", async () => {
  const source = await readFile(path.join(root, "src/features/layout/declutter.ts"), "utf8");
  assert.match(source, /root\.classList\.toggle\("av-writer-mode", ctx\.settings\.layout\.writerMode\)/);
  assert.match(source, /document\.addEventListener\("focusin", syncWritingClass, true\)/);
  assert.match(source, /document\.addEventListener\("focusout", onFocusOut, true\)/);
  assert.match(source, /document\.removeEventListener\("focusin"/);
  assert.match(source, /document\.removeEventListener\("focusout"/);
  assert.match(source, /html\.av-writer-mode\.av-writing \[data-testid="sidebarColumn"\]/);
  assert.ok(!/keydown|keyup|keypress/.test(source), "focus is the signal, never a key event");
  assert.match(source, /"av-writer-mode",\s*\n\s*"av-writing"/, "destroy must drop both classes");
});

test("presets can promise the two settings that now have implementations", async () => {
  const { PRESETS } = await importBundledModule("src/features/core/presets.ts");
  const byId = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]));
  assert.equal(byId["quiet-reader"].overrides.appearance.hideBorders, true);
  assert.equal(byId.minimal.overrides.appearance.hideBorders, true);
  assert.equal(byId.creator.overrides.layout.writerMode, true);
  const source = await readFile(path.join(root, "src/features/core/presets.ts"), "utf8");
  assert.ok(
    !/nothing implements it yet/.test(source),
    "the caveat must go once the settings are implemented"
  );
});

test("the Control Center exposes both settings", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");
  assert.match(source, /options\.settings\.appearance\.hideBorders = checked/);
  assert.match(source, /options\.settings\.layout\.writerMode = checked/);
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

test("a failed write reports to the persistence sink instead of vanishing", async () => {
  const { MediaHistory } = await importBundledModule("src/features/media/history.ts");

  const full = {
    async get(_key, fallback) {
      return fallback;
    },
    async set() {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    }
  };

  const reported = [];
  const history = new MediaHistory(full, undefined, (error) => reported.push(error));
  await history.load();

  // The write fails, but the call must still resolve — persistence is best-effort by design.
  await history.record("https://pbs.twimg.com/media/a.jpg");

  assert.equal(reported.length, 1, "a full backend must not fail silently");
  assert.match(String(reported[0]), /quota/i);
});

test("the Control Center surfaces failed writes in the Trust section", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  assert.match(source, /storageHealthRow/, "the storage health row was removed");
  assert.match(source, /failed to save/, "the row no longer matches the diagnostics it reports");

  // The three stores must actually be handed a sink, or the row can never light up.
  for (const [file, ctor] of [
    ["src/features/media/media-buttons.ts", "new MediaHistory"],
    ["src/features/filtering/hidden-posts-feature.ts", "new HiddenPostStore"],
    ["src/main.ts", "new AuditLog"]
  ]) {
    const wired = await readFile(path.join(root, file), "utf8");
    const at = wired.indexOf(ctor);
    assert.ok(at > -1, `${ctor} not found in ${file}`);
    assert.match(
      wired.slice(at, at + 220),
      /failed to save/,
      `${ctor} in ${file} is constructed without a persistence sink`
    );
  }
});

test("waitForToken refuses an impossible request instead of hanging forever", async () => {
  const { TokenBucket } = await importBundledModule("src/platform/rate-limit.ts");

  const bucket = new TokenBucket(4, 1);
  // refill() clamps at capacity, so this condition could never come true — it used to spin.
  await assert.rejects(() => bucket.waitForToken(5), RangeError);

  assert.equal(bucket.tryRemove(4), true, "a full bucket should satisfy a capacity-sized draw");
  assert.equal(bucket.tryRemove(1), false, "an empty bucket should refuse");
});

test("the media batch actually draws from the rate limiter", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(root, "src/features/media/batch-downloader.ts"), "utf8");

  assert.match(
    source,
    /await ctx\.limiter\.waitForToken\(\)/,
    "jobs.rateLimitMode drives nothing again — the batch stopped drawing tokens"
  );

  // The setting has to reach both the burst size and the sustained rate, or "conservative"
  // and "standard" differ only in how big the opening burst is.
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  assert.match(main, /rateLimitMode === "conservative"/);
  assert.match(main, /new TokenBucket\(4, 1\)/);
  assert.match(main, /new TokenBucket\(8, 4\)/);
});

test("media.zipChunkSize splits a long export into several archives", async () => {
  const { buildExportZipChunks } = await importBundledModule("src/features/export/export-feature.ts");

  const records = Array.from({ length: 250 }, (_, i) => ({
    tweetId: String(i),
    handle: "someone",
    text: `post ${i}`,
    capturedAt: "2026-08-06T00:00:00Z"
  }));

  const one = buildExportZipChunks(records, ["json"], "", 1000);
  assert.equal(one.length, 1, "a run that fits must stay a single archive");
  assert.doesNotMatch(one[0].filename, /part/, "an unsplit run keeps the plain name");

  const many = buildExportZipChunks(records, ["json"], "", 100);
  assert.equal(many.length, 3, "250 records at 100 per ZIP is three archives");
  assert.match(many[0].filename, /-part1of3\.zip$/);
  assert.match(many[2].filename, /-part3of3\.zip$/);
  assert.equal(new Set(many.map((a) => a.filename)).size, 3, "chunk names must be unique");

  // Every record has to land in exactly one archive -- a chunker that drops the tail is worse
  // than no chunking at all, and a plain length check would not catch it.
  const seen = new Set();
  for (const artifact of many) {
    assert.ok(artifact.data.byteLength > 0);
    const text = new TextDecoder().decode(artifact.data);
    for (let i = 0; i < 250; i += 1) {
      if (text.includes(`"post ${i}"`)) seen.add(i);
    }
  }
  assert.equal(seen.size, 250, "every record must appear in some chunk");

  assert.equal(buildExportZipChunks([], ["json"], "", 100).length, 0, "no records, no archive");
});

test("cleanShareButtons strips tracking parameters without breaking links", async () => {
  const { cleanUrl } = await importBundledModule("src/features/library/clean-share-links.ts");

  // X's own share sheet appends t= and s=.
  assert.equal(
    cleanUrl("https://x.com/someone/status/123?t=AbC&s=20"),
    "https://x.com/someone/status/123"
  );
  // Campaign parameters go everywhere; unrelated query values must survive.
  assert.equal(
    cleanUrl("https://example.com/a?utm_source=x&id=7&fbclid=zz"),
    "https://example.com/a?id=7"
  );
  // A relative SPA route stays relative — returning an absolute URL would change navigation.
  assert.equal(cleanUrl("/someone/status/123?t=AbC"), "/someone/status/123");

  // `t` and `s` are ordinary parameter names off X; stripping them elsewhere breaks real links.
  assert.equal(cleanUrl("https://example.com/search?s=shoes&t=1"), null);

  // Nothing to do, or unsafe to touch.
  assert.equal(cleanUrl("https://example.com/plain"), null);
  assert.equal(cleanUrl("https://t.co/abc123"), null, "t.co paths are the identifier");
  assert.equal(cleanUrl("javascript:alert(1)"), null);
  assert.equal(cleanUrl("mailto:a@b.c"), null);
  assert.equal(cleanUrl(""), null);
  assert.equal(cleanUrl("not a url at all"), null);
});

test("the clean-share-links feature is registered and fully reversible", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(path.join(root, "src/features/library/clean-share-links.ts"), "utf8");
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");

  assert.match(main, /registry\.register\(cleanShareLinksFeature\)/, "feature is not registered");
  // Every feature must reverse itself: destroy has to put the original href back.
  assert.match(source, /destroy\(ctx\)/);
  assert.match(source, /setAttribute\("href", original\)/, "destroy does not restore the href");
  assert.match(source, /settings\.links\.cleanShareButtons/, "the setting drives nothing again");
});

test("every setting a preset promises now has an implementation behind it", async () => {
  const { PRESETS } = await importBundledModule("src/features/core/presets.ts");

  // A preset that flips a setting nothing reads silently lies about what applying it does.
  // These are the keys the presets touch that were schema-only when v1.8.0 opened.
  const promised = PRESETS.flatMap((preset) => Object.keys(preset.overrides.links ?? {}));
  assert.ok(promised.includes("cleanShareButtons"), "presets no longer exercise this key");

  const feature = await readFile(
    path.join(root, "src/features/library/clean-share-links.ts"),
    "utf8"
  );
  assert.match(feature, /settings\.links\.cleanShareButtons/);

  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  assert.match(main, /registry\.register\(cleanShareLinksFeature\)/);
});
