import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  assert.equal(isSaveableVariantUrl("https://video.twimg.com/live/abc.m3u8"), false);
  assert.equal(isSaveableVariantUrl("https://video.twimg.com/chunk/abc.m4s"), false);
  assert.equal(
    isSaveableVariantUrl("https://video.twimg.com/live/playlist", "application/x-mpegURL"),
    false
  );
});

test("the best progressive MP4 wins over a higher-bitrate streaming manifest", async () => {
  const { extractVideo } = await importBundledModule("src/features/media/video-extract.ts");
  const container = fakeContainer([]);
  const extracted = extractVideo(container, {
    variants: [
      {
        url: "https://video.twimg.com/amplify_video/1/pl/playlist.m3u8",
        type: "application/x-mpegURL",
        width: 1920,
        height: 1080,
        bitrate: 12_000_000
      },
      {
        url: "https://video.twimg.com/amplify_video/1/vid/1280x720/best.mp4",
        type: "video/mp4",
        width: 1280,
        height: 720,
        bitrate: 2_176_000
      },
      {
        url: "https://video.twimg.com/amplify_video/1/vid/640x360/small.mp4",
        type: "video/mp4",
        width: 640,
        height: 360,
        bitrate: 832_000
      }
    ]
  });

  assert.ok(extracted, "no video extracted");
  assert.equal(
    extracted.preferred.url,
    "https://video.twimg.com/amplify_video/1/vid/1280x720/best.mp4"
  );
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

  const manifestOnly = {
    kind: "video",
    source: {},
    video: {
      isGif: false,
      preferred: {
        url: "https://video.twimg.com/live/playlist.m3u8",
        type: "application/x-mpegURL"
      }
    }
  };
  assert.equal(resolveTarget(manifestOnly), null, "a playlist is not a downloadable video file");

  const audio = {
    kind: "audio",
    source: {},
    audio: {
      preferred: { url: "https://video.twimg.com/ext_tw_audio/abc/track.mp3", type: "audio/mpeg" }
    }
  };
  assert.equal(resolveTarget(audio).ext, "mp3");

  const captions = {
    kind: "subtitle",
    source: {},
    subtitle: {
      track: { url: "https://video.twimg.com/ext_tw_video/abc/captions.srt", type: "text/srt" }
    }
  };
  assert.equal(resolveTarget(captions).ext, "srt");
});

test("tellAria2Status fails soft in local-only mode rather than throwing out", async () => {
  // One bundle: the local-only policy is module-scope state, so importing the two separately
  // would give each its own copy and the switch below would reach a policy aria2 never consults.
  // The old version of this test said so in a comment and then asserted on source text instead.
  const mod = await importBundledEntry([
    "src/features/integrations/aria2.ts",
    "src/features/integrations/network-policy.ts"
  ]);

  const originalFetch = globalThis.fetch;
  let reached = 0;
  globalThis.fetch = () => {
    reached += 1;
    throw new Error("network should not be reached");
  };
  try {
    mod.setLocalOnlyPolicy(() => true);
    // The reconcile that calls this is housekeeping on the media feature's init path. Throwing
    // here takes the Save buttons down because the user turned local-only mode on.
    assert.equal(
      await mod.tellAria2Status({ enabled: true, endpoint: "http://127.0.0.1:6800/jsonrpc", secret: "" }, "abc"),
      null,
      "local-only mode threw out of tellAria2Status instead of reporting no status"
    );
    assert.equal(reached, 0, "local-only mode must stop the call before it reaches the network");

    // An unconfigured endpoint is the other soft path, and must not throw either.
    mod.resetLocalOnlyPolicy();
    assert.equal(await mod.tellAria2Status({ endpoint: "", secret: "" }, "abc"), null);
  } finally {
    mod.resetLocalOnlyPolicy();
    globalThis.fetch = originalFetch;
  }
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

/** Bundles several modules into one graph so their module-level state is genuinely shared. */
async function importBundledEntry(relativePaths) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-media-multi-"));
  const entry = path.join(temp, "entry.ts");
  const outfile = path.join(temp, "module.mjs");
  try {
    await writeFile(
      entry,
      relativePaths
        .map((relative) => `export * from ${JSON.stringify(path.resolve(root, relative).split(path.sep).join("/"))}`)
        .join(";\n"),
      "utf8"
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
