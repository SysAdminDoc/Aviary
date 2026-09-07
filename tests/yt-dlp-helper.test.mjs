import { allowOutbound } from "./helpers/network-policy.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

// Nothing outbound is permitted until a policy is installed, so a spec that drives an integration
// says which posture it is driving under. This file's cases assume Local-only mode is off; the
// ones that assert the refusal install the opposite policy themselves.
await allowOutbound();

const helperTool = await import(new URL("../tools/yt-dlp-helper.mjs", import.meta.url));

const direct = {
  url: "https://video.twimg.com/ext_tw_video/123/pu/vid/1280x720/direct.mp4",
  type: "video/mp4",
  width: 1280,
  height: 720,
  bitrate: 2_000_000
};
const adaptive = {
  url: "https://video.twimg.com/ext_tw_video/123/pu/pl/1280x1080/manifest.m3u8?tag=12",
  type: "application/x-mpegURL",
  width: 1920,
  height: 1080,
  bitrate: 4_000_000
};

test("adaptive observations beat a lower direct MP4 without changing the default target", async () => {
  const mod = await importSourceModule("src/features/media/yt-dlp-helper.ts");
  const candidates = mod.observedAdaptiveCandidates([
    direct,
    adaptive,
    { ...adaptive, url: "https://example.com/status/123.m3u8" }
  ]);
  assert.deepEqual(candidates.map((entry) => entry.manifestUrl), [adaptive.url]);
  assert.equal(mod.shouldOfferAdaptiveHelper(direct, [direct, adaptive]), true);
  assert.equal(mod.shouldOfferAdaptiveHelper({ ...direct, height: 1440 }, [direct, adaptive]), false);
  assert.match(
    mod.buildYtDlpCommand({
      manifestUrl: adaptive.url,
      filename: "alice_123.%(ext)s",
      formatPolicy: mod.YTDLP_FORMAT_POLICY
    }),
    /--format 'bv\*\+ba\/b' --merge-output-format 'mp4\/mkv'/
  );
});

test("the client sends only an observed manifest, filename, and fixed format policy", async () => {
  const mod = await importSourceModule("src/features/media/yt-dlp-helper.ts");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ jobId: "job_12345678", state: "running" }), {
      status: 202,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await mod.handoffToYtDlp(
      { enabled: true, endpoint: "http://127.0.0.1:8787", secret: "secret-secret-secret" },
      { manifestUrl: adaptive.url, filename: "alice_123.%(ext)s", formatPolicy: mod.YTDLP_FORMAT_POLICY }
    );
    assert.deepEqual(result, { jobId: "job_12345678", state: "running" });
    const payload = JSON.parse(calls[0].init.body);
    assert.deepEqual(Object.keys(payload).sort(), ["filename", "formatPolicy", "manifestUrl"]);
    assert.equal(payload.manifestUrl, adaptive.url);
    assert.equal(payload.filename, "alice_123.%(ext)s");
    assert.equal(payload.formatPolicy, mod.YTDLP_FORMAT_POLICY);
    assert.equal(calls[0].init.headers.authorization, "Bearer secret-secret-secret");

    const remote = await mod.handoffToYtDlp(
      { enabled: true, endpoint: "https://helper.example", secret: "secret-secret-secret" },
      { manifestUrl: adaptive.url, filename: "x.%(ext)s", formatPolicy: mod.YTDLP_FORMAT_POLICY }
    );
    assert.equal(remote.state, "refused");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the local helper requires auth, never creates jobs through GET, and reports terminal states", async () => {
  const children = [];
  const helper = helperTool.createYtDlpHelper({
    token: "secret-secret-secret",
    port: 0,
    spawnProcess(command, args, options) {
      assert.equal(command, "yt-dlp");
      assert.equal(options.shell, false);
      assert.deepEqual(args.slice(0, 5), ["--no-playlist", "--format", "bv*+ba/b", "--merge-output-format", "mp4/mkv"]);
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      children.push(child);
      setTimeout(() => child.emit("close", 0), 10);
      return child;
    }
  });
  const address = await helper.listen();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const unauthenticated = await fetch(`${origin}/v1/jobs`, { method: "GET" });
    assert.equal(unauthenticated.status, 401);

    const create = await fetch(`${origin}/v1/jobs`, {
      method: "POST",
      headers: { authorization: "Bearer secret-secret-secret", "content-type": "application/json" },
      body: JSON.stringify({
        manifestUrl: adaptive.url,
        filename: "alice_123.%(ext)s",
        formatPolicy: "bv*+ba/b"
      })
    });
    assert.equal(create.status, 202);
    const running = await create.json();
    assert.equal(running.state, "running");
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(children.length, 1);

    const unknown = await fetch(`${origin}/v1/jobs/job_unknown_12345678`, {
      headers: { authorization: "Bearer secret-secret-secret" }
    });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { state: "missing" });
    assert.equal(children.length, 1, "GET must never create a helper job");

    await new Promise((resolve) => setTimeout(resolve, 25));
    const completed = await fetch(`${origin}/v1/jobs/${running.jobId}`, {
      headers: { authorization: "Bearer secret-secret-secret" }
    });
    assert.deepEqual(await completed.json(), { jobId: running.jobId, state: "completed" });

    const extra = await fetch(`${origin}/v1/jobs`, {
      method: "POST",
      headers: { authorization: "Bearer secret-secret-secret", "content-type": "application/json" },
      body: JSON.stringify({
        manifestUrl: adaptive.url,
        filename: "alice_123.%(ext)s",
        formatPolicy: "bv*+ba/b",
        statusUrl: "https://x.com/alice/status/123"
      })
    });
    assert.equal(extra.status, 400);
    assert.match((await extra.json()).error, /only manifestUrl/i);
  } finally {
    await helper.close();
  }
});
