import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("extension downloads receive the ordered original-image fallback candidates", async () => {
  const { createDownloader } = await importBundledModule("src/features/media/downloader.ts");
  const originalChrome = globalThis.chrome;
  const sent = [];
  globalThis.chrome = {
    runtime: {
      sendMessage: async (message) => {
        sent.push(message);
        return { ok: true };
      }
    }
  };

  try {
    const result = await createDownloader()({
      url: "https://pbs.twimg.com/media/x?format=jpg&name=orig",
      fallbackUrls: ["https://pbs.twimg.com/media/x?format=jpg&name=4096x4096"],
      filename: "x.jpg"
    });
    assert.deepEqual(result, { ok: true, via: "extension" });
    assert.deepEqual(sent, [
      {
        type: "AVIARY_DOWNLOAD",
        url: "https://pbs.twimg.com/media/x?format=jpg&name=orig",
        fallbackUrls: ["https://pbs.twimg.com/media/x?format=jpg&name=4096x4096"],
        filename: "x.jpg"
      }
    ]);
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

test("background answers the capability probe and wires the native media context menu", async () => {
  const source = await readFile(path.join(root, "src/entrypoints/extension-background.ts"), "utf8");
  assert.match(source, /AVIARY_DOWNLOAD_CAPABILITY/);
  assert.match(source, /AVIARY_OPEN_OPTIONS/);
  assert.match(source, /openOptionsPage/);
  assert.match(source, /permissions\.contains\(\{ permissions: \["downloads"\] \}\)/);
  assert.match(source, /action\?\.onClicked/);
  assert.match(source, /MEDIA_CONTEXT_MENU_ID/);
  assert.match(source, /contexts: \["all"\]/);
  assert.match(source, /contextMenus\?\.onClicked/);
  assert.match(source, /permissions\?\.request\(\{ permissions: \["downloads"\] \}\)/);
  assert.match(source, /sendContextDownloadMessage/);
  assert.match(source, /\.\.\.\(message\.fallbackUrls \?\? \[\]\)/);
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
  assert.match(buttons, /outcome\.degraded[\s\S]*"Opened"/, "a navigated anchor must not read as saved");

  const batch = await readFile(path.join(root, "src/features/media/batch-downloader.ts"), "utf8");
  assert.match(batch, /needsDownloadPermission/);
  assert.match(batch, /if \(needsDownloadPermission\) return;/, "the batch must stop, not repeat the same failure");
});

test("both manifests declare the options page that hosts the permission grant", async () => {
  for (const name of ["manifest.chrome.json", "manifest.firefox.json"]) {
    const manifest = JSON.parse(await readFile(path.join(root, "src/extension", name), "utf8"));
    assert.deepEqual(manifest.options_ui, { page: "options.html", open_in_tab: true }, name);
    assert.ok(manifest.optional_permissions.includes("downloads"), name);
    assert.ok(manifest.permissions.includes("contextMenus"), name);
  }
});

test("native media context clicks request download access before messaging the selected X tab", async () => {
  const originalChrome = globalThis.chrome;
  const sent = [];
  const requests = [];
  const grants = [true, false];
  let clicked;
  let insideGesture = false;

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} }
    },
    action: { onClicked: { addListener() {} } },
    contextMenus: {
      create() { return "aviary-download-media"; },
      removeAll(callback) { callback?.(); },
      onClicked: { addListener(listener) { clicked = listener; } }
    },
    permissions: {
      request(request) {
        assert.equal(insideGesture, true, "permission request escaped the context-menu gesture");
        requests.push(request);
        return Promise.resolve(grants.shift());
      }
    },
    tabs: {
      async sendMessage(tabId, message) {
        sent.push({ tabId, message });
        return { ok: true };
      }
    }
  };

  try {
    await importBundledModule("src/entrypoints/extension-background.ts");
    assert.equal(typeof clicked, "function", "background did not register the context-menu action");

    insideGesture = true;
    clicked({ menuItemId: "aviary-download-media" }, { id: 91 });
    insideGesture = false;
    await waitFor(() => sent.length === 1);

    insideGesture = true;
    clicked({ menuItemId: "aviary-download-media" }, { id: 92 });
    insideGesture = false;
    await waitFor(() => sent.length === 2);

    assert.deepEqual(requests, [
      { permissions: ["downloads"] },
      { permissions: ["downloads"] }
    ]);
    assert.deepEqual(sent, [
      { tabId: 91, message: { type: "AVIARY_DOWNLOAD_CONTEXT_MEDIA" } },
      { tabId: 92, message: { type: "AVIARY_CONTEXT_DOWNLOAD_PERMISSION_DENIED" } }
    ]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("an interrupted original-image download resumes from the persisted quality fallback", async () => {
  const originalChrome = globalThis.chrome;
  const calls = [];
  const stored = {};
  let onMessage;
  let onDownloadChanged;
  let nextId = 40;
  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    permissions: { async contains() { return true; } },
    storage: {
      local: {
        async get(key) { return { [key]: stored[key] }; },
        async set(items) { Object.assign(stored, structuredClone(items)); }
      }
    },
    downloads: {
      async download(options) {
        calls.push(options);
        return nextId++;
      },
      onChanged: { addListener(listener) { onDownloadChanged = listener; } }
    }
  };

  try {
    await importBundledModule("src/entrypoints/extension-background.ts");
    const response = await new Promise((resolve) => {
      const keptOpen = onMessage(
        {
          type: "AVIARY_DOWNLOAD",
          url: "https://pbs.twimg.com/media/x?format=jpg&name=orig",
          fallbackUrls: ["https://pbs.twimg.com/media/x?format=jpg&name=4096x4096"],
          filename: "x.jpg"
        },
        {},
        resolve
      );
      assert.equal(keptOpen, true);
    });
    assert.deepEqual(response, { ok: true, id: 40 });
    assert.equal(typeof onDownloadChanged, "function");

    onDownloadChanged({ id: 40, state: { current: "interrupted" } });
    await waitFor(() => calls.length === 2);
    assert.deepEqual(calls.map((call) => call.url), [
      "https://pbs.twimg.com/media/x?format=jpg&name=orig",
      "https://pbs.twimg.com/media/x?format=jpg&name=4096x4096"
    ]);
    assert.deepEqual(stored["aviary.downloadFallbacks.v1"], {});
  } finally {
    globalThis.chrome = originalChrome;
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

test("the build ships the options page and branded icons into both extension targets", async () => {
  const source = await readFile(path.join(root, "tools/build.mjs"), "utf8");
  assert.match(source, /extension-options\.ts/);
  assert.match(source, /options\.html/);
  assert.match(source, /options\.css/);
  assert.match(source, /extensionIconSizes/);
  assert.match(source, /src\/extension\/icons/);

  const preflight = await readFile(path.join(root, "tools/preflight.mjs"), "utf8");
  assert.match(preflight, /options_ui\?\.page/);
  assert.match(preflight, /options\.html contains inline script/);
  assert.match(preflight, /default_icon/);
  assert.match(preflight, /PNG dimensions/);
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
  const source = (
    await Promise.all([
      "src/ui/control-center.ts",
      "src/ui/control-center/sections/reading.ts"
    ].map((file) => readFile(path.join(root, file), "utf8")))
  ).join("\n");
  assert.match(source, /ctx\.options\.settings\.appearance\.hideBorders = checked/);
  assert.match(source, /ctx\.options\.settings\.layout\.writerMode = checked/);
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

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, "timed out waiting for asynchronous background work");
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

test("reports use the build version rather than the selected locale", async () => {
  const source = await readFile(path.join(root, "src/features/core/control-center.ts"), "utf8");
  assert.match(source, /reportInput\.version\s*=\s*AVIARY_VERSION/);
  assert.ok(!/reportInput\.version\s*=\s*ctx\.settings\.i18n\.locale/.test(source));
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
  assert.match(main, /limiter\.configure\(conservative \? 4 : 8, conservative \? 1 : 4\)/);
  assert.match(main, /reconcileRateLimit\(\);\s*void registry\.applyAll/);
});

test("media.zipChunkSize splits a long export into several archives", async () => {
  const { buildExportZipChunks } = await importBundledModule("src/features/export/export-feature.ts");

  const records = Array.from({ length: 250 }, (_, i) => ({
    tweetId: String(i),
    handle: "someone",
    text: `post ${i}`,
    capturedAt: "2026-08-06T00:00:00Z"
  }));

  const one = await buildExportZipChunks(records, ["json"], "", 1000);
  assert.equal(one.length, 1, "a run that fits must stay a single archive");
  assert.doesNotMatch(one[0].filename, /part/, "an unsplit run keeps the plain name");

  const many = await buildExportZipChunks(records, ["json"], "", 100);
  assert.equal(many.length, 3, "250 records at 100 per ZIP is three archives");
  assert.match(many[0].filename, /-part1of3\.zip$/);
  assert.match(many[2].filename, /-part3of3\.zip$/);
  assert.equal(new Set(many.map((a) => a.filename)).size, 3, "chunk names must be unique");

  // Every record has to land in exactly one archive -- a chunker that drops the tail is worse
  // than no chunking at all, and a plain length check would not catch it. Read the archives
  // properly rather than scanning raw bytes: entries are DEFLATE now, so a substring search over
  // the container would find nothing and quietly pass once the assertion was relaxed.
  const { readZip } = await importBundledModule("src/features/export/zip-reader.ts");
  const decoder = new TextDecoder();
  const seen = new Set();
  for (const artifact of many) {
    assert.ok(artifact.data.byteLength > 0);
    for (const entry of await readZip(artifact.data)) {
      const text = decoder.decode(entry.data);
      for (let i = 0; i < 250; i += 1) {
        if (text.includes(`"post ${i}"`)) seen.add(i);
      }
    }
  }
  assert.equal(seen.size, 250, "every record must survive compression into some chunk");

  assert.equal((await buildExportZipChunks([], ["json"], "", 100)).length, 0, "no records, no archive");
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

test("local-only mode blocks every integration entry point", async () => {
  const policy = await importBundledModule("src/features/integrations/network-policy.ts");
  const { assertOutboundAllowed, setLocalOnlyPolicy, resetLocalOnlyPolicy, LocalOnlyError } = policy;

  resetLocalOnlyPolicy();
  assert.doesNotThrow(() => assertOutboundAllowed("A request"));

  setLocalOnlyPolicy(() => true);
  assert.throws(() => assertOutboundAllowed("A request"), LocalOnlyError);
  // The message has to name the switch, or a blocked call reads as a broken integration.
  assert.throws(() => assertOutboundAllowed("A request"), /Local-only mode/i);

  // Read fresh each call, so toggling the setting applies without a reload.
  let on = true;
  setLocalOnlyPolicy(() => on);
  assert.throws(() => assertOutboundAllowed("A request"), LocalOnlyError);
  on = false;
  assert.doesNotThrow(() => assertOutboundAllowed("A request"));
  resetLocalOnlyPolicy();

  // Every module that can reach the network must consult the policy.
  const { readFile } = await import("node:fs/promises");
  for (const file of ["ai-provider.ts", "aria2.ts", "crosspost.ts", "semantic-search.ts"]) {
    const source = await readFile(path.join(root, "src/features/integrations", file), "utf8");
    assert.match(source, /assertOutboundAllowed\(/, `${file} can still reach the network unguarded`);
  }
  const main = await readFile(path.join(root, "src/main.ts"), "utf8");
  assert.match(main, /setLocalOnlyPolicy\(\(\) => settings\.privacy\.localOnly\)/);
});

test("upgrading with a configured integration does not silently break it", async () => {
  const { normalizeSettings, DEFAULT_SETTINGS } = await importBundledModule("src/platform/settings.ts");

  // A fresh install keeps the local-only default, because integrations ship disabled.
  assert.equal(normalizeSettings({}).privacy.localOnly, true);
  assert.equal(DEFAULT_SETTINGS.privacy.localOnly, true);

  // Someone who configured Aria2 in v1.3-v1.7 was already opting into those requests.
  const upgraded = normalizeSettings({
    privacy: { localOnly: true },
    integrations: { aria2: { enabled: true, endpoint: "http://localhost:6800" } }
  });
  assert.equal(upgraded.privacy.localOnly, false, "an enabled integration must clear local-only");

  // A disabled integration is not consent.
  const untouched = normalizeSettings({
    privacy: { localOnly: true },
    integrations: { aria2: { enabled: false, endpoint: "http://localhost:6800" } }
  });
  assert.equal(untouched.privacy.localOnly, true);
});

test("the local-only guard fires before any integration touches the network", async () => {
  // Bundled as one entry on purpose: the policy is module-scope state, so this also proves
  // main.ts and the integration clients share one instance in a real build. Bundling each
  // module separately would give each its own copy and quietly pass while shipping broken.
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-localonly-"));
  try {
    const entry = path.join(temp, "entry.ts");
    const p = (rel) => path.resolve(root, rel).split(path.sep).join("/");
    await writeFile(
      entry,
      `export { setLocalOnlyPolicy, resetLocalOnlyPolicy, LocalOnlyError } from "${p("src/features/integrations/network-policy.ts")}";
export { addUriToAria2, tellActiveAria2 } from "${p("src/features/integrations/aria2.ts")}";
export { crosspost } from "${p("src/features/integrations/crosspost.ts")}";
export { runAiPrompt } from "${p("src/features/integrations/ai-provider.ts")}";`
    );
    const outfile = path.join(temp, "bundle.mjs");
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      logLevel: "silent"
    });
    const mod = await import(pathToFileURL(outfile).href);

    // Any fetch at all means the guard did not stop the call early enough.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network was reached while local-only mode was on");
    };
    try {
      mod.setLocalOnlyPolicy(() => true);
      await assert.rejects(
        () => mod.addUriToAria2({ enabled: true, endpoint: "http://localhost:6800", secret: "" }, { url: "https://x/y.mp4" }),
        mod.LocalOnlyError
      );
      await assert.rejects(
        () => mod.tellActiveAria2({ enabled: true, endpoint: "http://localhost:6800", secret: "" }),
        mod.LocalOnlyError
      );
      await assert.rejects(
        () => mod.runAiPrompt({ enabled: true, apiKey: "k", provider: "anthropic", endpoint: "", model: "m" }, { prompt: "hi" }),
        mod.LocalOnlyError
      );
    } finally {
      mod.resetLocalOnlyPolicy();
      globalThis.fetch = originalFetch;
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("zip entry names are flagged UTF-8 so non-ASCII paths survive extraction", async () => {
  const { buildStoreZip } = await importBundledModule("src/features/export/zip-store.ts");

  const name = "Recherché-アーカイブ/aviary-export.json";
  const zip = buildStoreZip([
    { filename: name, data: new TextEncoder().encode('{"ok":true}'), date: new Date("2026-08-06T12:00:00Z") }
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // Bit 11 says "these name bytes are UTF-8". Without it a conforming extractor must read them
  // as CP437, and Recherché-アーカイブ arrives as Recherch├⌐-πéóπâ╝πé½πéñπâû.
  assert.equal(view.getUint16(6, true) & 0x0800, 0x0800, "local header is not flagged UTF-8");

  let centralAt = -1;
  for (let i = 0; i < zip.length - 4; i += 1) {
    if (view.getUint32(i, true) === 0x02014b50) {
      centralAt = i;
      break;
    }
  }
  assert.ok(centralAt > -1, "no central directory header found");
  assert.equal(view.getUint16(centralAt + 8, true) & 0x0800, 0x0800, "central header is not flagged UTF-8");

  // The stored bytes must be the UTF-8 encoding, and the length field must count bytes not chars.
  const expected = new TextEncoder().encode(name);
  assert.equal(view.getUint16(26, true), expected.length);
  assert.deepEqual(zip.slice(30, 30 + expected.length), expected);
});

test("the zip writer refuses to emit a silently-truncated archive", async () => {
  const { buildStoreZip } = await importBundledModule("src/features/export/zip-store.ts");

  // setUint16/setUint32 truncate without complaint, so these ceilings have to be checked.
  const tooMany = Array.from({ length: 0x10000 }, (_, i) => ({
    filename: `f${i}.txt`,
    data: new Uint8Array(0)
  }));
  assert.throws(() => buildStoreZip(tooMany), RangeError);

  // A name longer than the uint16 field that records its length.
  assert.throws(
    () => buildStoreZip([{ filename: "x".repeat(0x10000), data: new Uint8Array(0) }]),
    RangeError
  );

  // The ordinary case still works and stays byte-identical in shape.
  const ok = buildStoreZip([{ filename: "a.txt", data: new TextEncoder().encode("hi") }]);
  assert.equal(new DataView(ok.buffer, ok.byteOffset).getUint32(0, true), 0x04034b50);
});

test("a CRLF in a scraped value cannot inject WARC headers or split a record", async () => {
  const { formatRecord, buildWarcArchive } = await importBundledModule("src/features/export/warc.ts");

  const hostile = "https://x.com/a/status/456\r\nWARC-Type: warcinfo\r\nX-Injected: yes";
  const bytes = formatRecord({ url: hostile, mime: "application/json", body: "{}" });
  const text = new TextDecoder().decode(bytes);

  // One record means exactly one version line and one header block.
  assert.equal(text.split("WARC/1.1").length - 1, 1, "the value started a second record");

  // The hostile text survives *inside* the URI value, which is fine and inert. What must not
  // happen is it becoming its own header line, so assert on line starts rather than substrings.
  const headerLines = text.split("\r\n\r\n")[0].split("\r\n");
  assert.ok(
    !headerLines.some((line) => line.startsWith("X-Injected")),
    `an arbitrary header was injected: ${JSON.stringify(headerLines)}`
  );
  assert.equal(
    headerLines.filter((line) => line.startsWith("WARC-Type:")).length,
    1,
    "WARC-Type could be forged"
  );

  // The whole archive must still parse as the expected number of records.
  const archive = buildWarcArchive([
    { tweetId: "1", handle: "a", text: "t", permalink: hostile, media: [{ url: hostile, kind: "photo", type: "image/jpeg" }] }
  ]);
  const all = new TextDecoder().decode(archive.data);
  assert.equal(all.split("WARC/1.1").length - 1, 3, "expected metadata + resource + media records");
});

test("WARC Content-Length counts bytes, not characters", async () => {
  const { formatRecord } = await importBundledModule("src/features/export/warc.ts");

  // 8 characters, but more than 8 bytes once encoded — a char count would truncate the body
  // and desynchronise every following record.
  const body = "アーカイブ-é";
  const expected = new TextEncoder().encode(body).length;
  assert.notEqual(expected, body.length, "pick a body where bytes and chars differ");

  const text = new TextDecoder().decode(formatRecord({ url: "urn:x", mime: "text/plain", body }));
  const declared = Number(/Content-Length: (\d+)/.exec(text)[1]);
  assert.equal(declared, expected);
});

test("a record with no target URI or mime still carries both fields", async () => {
  const { formatRecord } = await importBundledModule("src/features/export/warc.ts");
  const text = new TextDecoder().decode(formatRecord({ url: "", mime: "", body: "x" }));
  assert.match(text, /WARC-Target-URI: urn:aviary:unknown/);
  assert.match(text, /Content-Type: application\/octet-stream/);
});

test("a swallowed storage write still reports through the gateway sink", async () => {
  const { createStorageGateway, setStorageErrorSink } = await importBundledModule(
    "src/platform/storage.ts"
  );

  const original = globalThis.localStorage;
  globalThis.localStorage = {
    setItem() {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    },
    getItem: () => null,
    removeItem() {}
  };

  const seen = [];
  setStorageErrorSink((key, error) => seen.push({ key, error }));
  try {
    const storage = createStorageGateway("aviary");
    // The gateway must report *and* rethrow: callers that swallow keep working, but the
    // failure stops being invisible. Nine call sites wrap set() in an empty catch.
    await assert.rejects(() => storage.set("cleanupQueue.v1", { a: 1 }));
    assert.equal(seen.length, 1, "a failed write did not reach the sink");
    assert.match(seen[0].key, /cleanupQueue/);
    assert.match(String(seen[0].error), /quota/i);

    // The Trust row keys off this wording; keep them in step.
    assert.match(`Storage write failed to save ${seen[0].key}`, /failed to save/);
  } finally {
    setStorageErrorSink(undefined);
    globalThis.localStorage = original;
  }
});

test("the panel renders one section at a time behind a nav rail", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // Twelve sections in one column was ~144 controls and 19 screens of scrolling.
  const registry = source.slice(
    source.indexOf("const sectionRegistry ="),
    source.indexOf("const buildNav =")
  );
  const entries = [
    ...registry.matchAll(/id:\s*"([a-z]+)",\s*title:\s*"([^"]+)",\s*group:\s*"([A-Za-z]+)"/g)
  ];
  // A lower bound, not an exact count: adding a section is normal growth, and pinning the number
  // only turns every new section into a failing test. What must hold is that sections are
  // declared here rather than inlined, and that ids stay unique.
  assert.ok(entries.length >= 12, `expected at least 12 declared sections, found ${entries.length}`);
  assert.equal(
    new Set(entries.map((m) => m[1])).size,
    entries.length,
    "section ids must be unique -- a duplicate makes one section unreachable"
  );
  assert.deepEqual(
    [...new Set(entries.map((m) => m[3]))],
    ["Start", "Reading", "Data", "Advanced"],
    "group order is the rail's reading order"
  );

  // The content pane builds the active section only — building all twelve would put the
  // scrolling straight back.
  assert.match(source, /content\.append\(section\(entry, entry\.build\(\)\)\)/);
});

test("the settings search lives outside the re-rendered body", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // render() calls body.replaceChildren(), so a search field inside `body` would lose focus
  // and its caret on every keystroke. It has to hang off the panel chrome instead.
  assert.match(source, /header\.append\(titleWrap, searchBar, close\)/);
  assert.match(source, /panel\.append\(header, body, transactionBar\)/);
  assert.ok(
    !/body\.append\([^)]*searchBar/.test(source),
    "the search bar must not be inside the re-rendered body"
  );
  assert.match(source, /search\.addEventListener\("input"/);
  assert.ok(!/search\.addEventListener\("key/.test(source), "Aviary registers no key handlers");
});

test("search matches rendered row text and offers a way out when nothing matches", async () => {
  const source = await readFile(path.join(root, "src/ui/control-center.ts"), "utf8");

  // Matching on the row's own text means a row added later is searchable immediately, and a
  // label edit cannot drift from a separate keyword list.
  assert.match(source, /\(row\.textContent \?\? ""\)\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(source, /Nothing matches that search\./);
  assert.match(source, /Try a shorter word, or pick a section on the left\./);

  // Choosing a section has to clear the filter, or the click appears to do nothing.
  const navClick = source.slice(source.indexOf("item.addEventListener(\"click\""), source.indexOf("nav.append(item)"));
  assert.match(navClick, /searchQuery = ""/);
  assert.match(navClick, /search\.value = ""/);
});
