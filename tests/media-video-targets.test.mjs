import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a MediaSource blob is never chosen over a real variant", async () => {
  const { extractVideo } = await importBundledModule("src/features/media/video-extract.ts");

  // Shaped like X's player: the blob handle plus a real progressive URL. The blob carries no
  // bitrate, but bitrate is not the tie-breaker that matters here -- saveability is.
  const container = fakeContainer([
    { src: "blob:https://x.com/9a1f-not-a-file", type: "video/mp4" },
    { src: "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/abc.mp4", type: "video/mp4" }
  ]);

  const extracted = extractVideo(container);
  assert.ok(extracted, "no video extracted");
  assert.equal(extracted.preferred.url, "https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/abc.mp4");
});

test("isSaveableVariantUrl rejects blob handles and accepts real media URLs", async () => {
  const { isSaveableVariantUrl } = await importBundledModule("src/features/media/video-extract.ts");

  assert.equal(isSaveableVariantUrl("blob:https://x.com/9a1f"), false);
  assert.equal(isSaveableVariantUrl("BLOB:https://x.com/9a1f"), false, "scheme is case-insensitive");
  assert.equal(isSaveableVariantUrl("https://video.twimg.com/tweet_video/abc.mp4"), true);
});

test("resolveTarget refuses a blob-only video instead of reporting a save", async () => {
  const { resolveTarget } = await importBundledModule("src/features/media/batch-downloader.ts");

  const blobOnly = {
    kind: "video",
    source: {},
    video: { isGif: false, preferred: { url: "blob:https://x.com/9a1f", type: "video/mp4" } }
  };
  assert.equal(
    resolveTarget(blobOnly),
    null,
    "a MediaSource blob cannot be handed to any downloader, so it must not resolve"
  );

  // GIFs are served as real files and must keep working.
  const gif = {
    kind: "video",
    source: {},
    video: {
      isGif: true,
      preferred: { url: "https://video.twimg.com/tweet_video/GkQxyz123.mp4", type: "video/mp4" }
    }
  };
  const resolved = resolveTarget(gif);
  assert.ok(resolved, "a direct tweet_video URL must still resolve");
  assert.equal(resolved.ext, "mp4");
  assert.equal(resolved.mediaId, "GkQxyz123");
});

test("the media stylesheet keeps download buttons visible and leaves X's anchors intact", async () => {
  const source = await readFile(path.join(root, "src/features/media/media-buttons.ts"), "utf8");

  const css = source.slice(source.indexOf("const MEDIA_CSS"));
  assert.match(css, /opacity:\s*1/);
  assert.doesNotMatch(
    css,
    /\]:hover\s*\{[^}]*opacity:\s*0/s,
    "hover must not hide a persistent media action"
  );
  assert.match(css, /min-height:\s*36px/);
  assert.match(css, /box-shadow:/);

  // The positioning context is no longer taken from X. Making tweetPhoto the containing block
  // collapsed the photo it holds: X keeps that box at height 0 and hangs the picture off it with
  // position:absolute inset:0, so the picture inherited the zero height and vanished the moment
  // the Save button was switched on. Offsets are measured against whatever ancestor X has
  // already positioned -- see positionButton() and tests/media-button-layout.test.mjs.
  assert.match(source, /function positionButton\(/);
  assert.match(source, /function positionedAncestor\(/);

  const forced = [...css.matchAll(/([^{}]+)\{([^{}]*position\s*:\s*relative[^{}]*)\}/g)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((selector) => /data-testid=/.test(selector));
  assert.deepEqual(forced, [], "Aviary must not make X's media containers the positioning context");
});

test("a disabled aria2 integration is not contacted at boot", async () => {
  const source = await readFile(path.join(root, "src/features/media/media-buttons.ts"), "utf8");

  // An endpoint string survives disabling the integration, so `endpoint` alone was the wrong gate.
  assert.match(source, /ctx\.settings\.integrations\.aria2\.enabled && ctx\.settings\.integrations\.aria2\.endpoint/);
  // And a housekeeping reconcile must never fail the feature that owns the Save buttons.
  const init = source.slice(source.indexOf("async init(ctx)"), source.indexOf("apply(ctx, root, addedNodes)"));
  assert.match(init, /try \{[\s\S]*reconcile\([\s\S]*\} catch/);
});

test("tellAria2Status fails soft in local-only mode rather than throwing out", async () => {
  const { tellAria2Status } = await importBundledModule("src/features/integrations/aria2.ts");
  const { setLocalOnlyPolicy, resetLocalOnlyPolicy } = await importBundledModule(
    "src/features/integrations/network-policy.ts"
  );
  // Bundled separately, so this only proves the try/catch shape; the source assert below is
  // what pins the ordering that mattered.
  void setLocalOnlyPolicy;
  void resetLocalOnlyPolicy;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network should not be reached");
  };
  try {
    assert.equal(await tellAria2Status({ endpoint: "", secret: "" }, "abc"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const source = await readFile(path.join(root, "src/features/integrations/aria2.ts"), "utf8");
  const fn = source.slice(source.indexOf("export async function tellAria2Status"));
  const assertIndex = fn.indexOf("assertOutboundAllowed");
  const tryIndex = fn.indexOf("try {");
  assert.ok(
    tryIndex > -1 && tryIndex < assertIndex,
    "assertOutboundAllowed must sit inside a try, or local-only mode throws out of the reconcile"
  );
});

test("reconcile keeps entries when aria2 rejects the secret, drops only unknown GIDs", async () => {
  const { Aria2History } = await importBundledModule("src/features/integrations/aria2.ts");

  const entries = [
    { gid: "aaa", url: "https://x/1", filename: "1.mp4", status: "queued", queuedAt: "2026-01-01T00:00:00.000Z" },
    { gid: "bbb", url: "https://x/2", filename: "2.mp4", status: "queued", queuedAt: "2026-01-01T00:00:00.000Z" }
  ];
  const storage = () => {
    const data = new Map([["aviary.aria2.history.v1", { entries: structuredClone(entries) }]]);
    return {
      async get(key, fallback) {
        return data.has(key) ? structuredClone(data.get(key)) : fallback;
      },
      async set(key, value) {
        data.set(key, structuredClone(value));
      }
    };
  };

  const respond = (payload) => {
    globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  };
  const originalFetch = globalThis.fetch;
  const config = { endpoint: "http://127.0.0.1:6800", secret: "wrong" };

  try {
    // A bad secret is an auth fault, not "this download is gone".
    respond({ error: { code: 1, message: "Unauthorized" } });
    const authFault = new Aria2History(storage());
    const afterAuthFault = await authFault.reconcile(config);
    assert.equal(afterAuthFault.removed, 0, "an auth fault must not delete the ledger");
    assert.equal(authFault.snapshot().entries.length, 2);

    // A GID aria2 does not know really is gone.
    respond({ error: { code: 1, message: "GID aaa is not found" } });
    const unknownGid = new Aria2History(storage());
    const afterUnknownGid = await unknownGid.reconcile(config);
    assert.equal(afterUnknownGid.removed, 2, "unknown GIDs are removed");
    assert.equal(unknownGid.snapshot().entries.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the aria2 connection test does not enqueue a download", async () => {
  const { pingAria2Version } = await importBundledModule("src/features/integrations/aria2.ts");

  const methods = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    methods.push(JSON.parse(init.body).method);
    return { ok: true, json: async () => ({ result: { version: "1.37.0" } }) };
  };
  try {
    const result = await pingAria2Version({ endpoint: "http://127.0.0.1:6800", secret: "s" });
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(methods, ["aria2.getVersion"]);
  assert.ok(!methods.includes("aria2.addUri"), "testing the connection must not queue a download");
});

function fakeContainer(sources) {
  const video = {
    currentSrc: "",
    src: "",
    poster: "",
    loop: false,
    muted: false,
    dataset: {},
    getAttribute: () => null,
    querySelectorAll: () =>
      sources.map((entry) => ({
        src: entry.src,
        type: entry.type,
        dataset: {}
      }))
  };
  return {
    getAttribute: () => null,
    querySelector: (selector) => (selector === "video" ? video : null)
  };
}

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-video-"));
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
