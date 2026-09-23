import { allowOutbound, blockOutbound } from "./helpers/network-policy.mjs";
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

test("the copied command keeps hostile post text inside one PowerShell argument", async () => {
  const mod = await importSourceModule("src/features/media/yt-dlp-helper.ts");
  // U+2018..U+201B close a PowerShell single-quoted string just like ASCII ', and {text} in a
  // filename template puts post text there.
  const filename = "x’; Start-Process calc; echo ‘ ‚ ‛ ' $HOME & ; ^ `n.%(ext)s";
  const command = mod.buildYtDlpCommand({
    manifestUrl: adaptive.url,
    filename,
    formatPolicy: mod.YTDLP_FORMAT_POLICY
  });
  for (const quote of ["'", "‘", "’", "‚", "‛"]) {
    assert.ok(command.includes(quote + quote), `${JSON.stringify(quote)} is not doubled`);
  }
  assert.equal(
    mod.buildYtDlpCommand({ manifestUrl: adaptive.url, filename: "alice_123.%(ext)s", formatPolicy: mod.YTDLP_FORMAT_POLICY }),
    `yt-dlp --no-playlist --format 'bv*+ba/b' --merge-output-format 'mp4/mkv' --output 'alice_123.%(ext)s' '${adaptive.url}'`
  );

  const { spawnSync } = await import("node:child_process");
  const probe = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (probe.status !== 0) return; // The literal check above still runs without PowerShell.
  const parse = spawnSync("pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    [
      "$errors = $null",
      "$ast = [System.Management.Automation.Language.Parser]::ParseInput($env:AVIARY_COMMAND, [ref]$null, [ref]$errors)",
      "$commands = @($ast.FindAll({ $args[0] -is [System.Management.Automation.Language.CommandAst] }, $true))",
      "$elements = @($commands[0].CommandElements | ForEach-Object { if ($_ -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $_.Value } else { $_.Extent.Text } })",
      "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
      "@{ errors = @($errors).Count; commands = $commands.Count; elements = $elements } | ConvertTo-Json -Compress"
    ].join("; ")
  ], { encoding: "utf8", windowsHide: true, env: { ...process.env, AVIARY_COMMAND: command } });
  assert.equal(parse.status, 0, parse.stderr);
  const parsed = JSON.parse(parse.stdout);
  assert.equal(parsed.errors, 0);
  assert.equal(parsed.commands, 1);
  assert.deepEqual(parsed.elements, [
    "yt-dlp",
    "--no-playlist",
    "--format",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4/mkv",
    "--output",
    filename,
    adaptive.url
  ]);
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

test("extension builds carry helper calls through the background worker", async () => {
  const mod = await importSourceModule("src/features/media/yt-dlp-helper.ts");
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  const direct = [];
  const messages = [];
  let answer = { ok: true, status: 202, payload: { jobId: "job_12345678", state: "running" } };
  globalThis.fetch = async (url, init) => {
    direct.push({ url, init });
    return new Response(JSON.stringify({ jobId: "job_direct_1234", state: "running" }), { status: 202 });
  };
  globalThis.chrome = {
    runtime: {
      id: "aviary-test",
      async sendMessage(message) {
        messages.push(message);
        return answer;
      }
    }
  };
  const settings = { enabled: true, endpoint: "http://127.0.0.1:8787", secret: "secret-secret-secret" };
  const job = { manifestUrl: adaptive.url, filename: "alice_123.%(ext)s", formatPolicy: mod.YTDLP_FORMAT_POLICY };
  try {
    assert.deepEqual(await mod.handoffToYtDlp(settings, job), { jobId: "job_12345678", state: "running" });
    assert.equal(direct.length, 0, "the x.com page must not fetch loopback itself when a background answers");
    assert.equal(messages[0].type, "AVIARY_YTDLP_PROXY");
    assert.equal(messages[0].call.method, "POST");
    assert.equal(messages[0].call.url, "http://127.0.0.1:8787/v1/jobs");

    answer = { ok: false, error: "Aviary only carries a job request to a helper on this machine." };
    assert.deepEqual(await mod.handoffToYtDlp(settings, job), {
      state: "failed",
      error: "Aviary only carries a job request to a helper on this machine."
    });
    assert.equal(direct.length, 0, "a refusal from the background is final, not a cue to fetch directly");

    // No Aviary background answered: the userscript path, which has always fetched directly.
    answer = undefined;
    assert.equal((await mod.handoffToYtDlp(settings, job)).state, "running");
    assert.equal(direct.length, 1);

    // Local-only mode stops the call at the transport on either route, before any message.
    const transport = await importSourceModule("src/features/media/yt-dlp-transport.ts");
    const sent = messages.length;
    await blockOutbound();
    try {
      await assert.rejects(
        transport.sendYtDlpCall({ method: "GET", url: "http://127.0.0.1:8787/v1/jobs/job_12345678", secret: "s" }),
        /local-only|Local-only/
      );
    } finally {
      await allowOutbound();
    }
    assert.equal(messages.length, sent, "a blocked call must not reach the background");
    assert.equal(direct.length, 1, "a blocked call must not fetch");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }

  const background = await (await import("node:fs/promises")).readFile(
    new URL("../src/entrypoints/extension-background.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    background,
    /isYtDlpProxyMessage\(message\)[\s\S]{0,400}validateYtDlpCall\(message\.call\)[\s\S]{0,400}performYtDlpCall\(call\)/,
    "the background must validate a helper call before it makes it"
  );
});

test("the background carries only a job create or read to a loopback helper", async () => {
  const { validateYtDlpCall } = await importSourceModule("src/features/media/yt-dlp-transport.ts");
  const body = JSON.stringify({ manifestUrl: adaptive.url, filename: "alice_123.%(ext)s", formatPolicy: "bv*+ba/b" });
  const create = { method: "POST", url: "http://127.0.0.1:8787/v1/jobs", secret: "secret-secret-secret", body };
  const read = { method: "GET", url: "http://localhost:8787/v1/jobs/job_12345678", secret: "secret-secret-secret" };
  assert.deepEqual(validateYtDlpCall(create), create);
  assert.deepEqual(validateYtDlpCall(read), read);

  const refused = {
    "a public host": { ...create, url: "https://helper.example/v1/jobs" },
    "a LAN address": { ...create, url: "http://192.168.1.20:8787/v1/jobs" },
    "another loopback path": { ...create, url: "http://127.0.0.1:8787/admin" },
    "a query string": { ...read, url: `${read.url}?next=1` },
    "embedded credentials": { ...create, url: "http://user:pass@127.0.0.1:8787/v1/jobs" },
    "an extra job field": { ...create, body: JSON.stringify({ ...JSON.parse(body), statusUrl: "https://x.com/a/status/1" }) },
    "a manifest off X's video host": { ...create, body: JSON.stringify({ ...JSON.parse(body), manifestUrl: "https://evil.example/a.m3u8" }) },
    "a body on a read": { ...read, body },
    "a create on the read path": { ...create, url: read.url },
    "another method": { ...create, method: "DELETE" },
    "no secret": { ...create, secret: "" },
    "a header break in the secret": { ...create, secret: "secret\r\nx-evil: 1" },
    "an oversized body": { ...create, body: body + " ".repeat(17_000) }
  };
  for (const [name, call] of Object.entries(refused)) {
    assert.equal(validateYtDlpCall(call), null, `${name} must be refused`);
  }
  assert.equal(validateYtDlpCall(null), null);
  assert.equal(validateYtDlpCall("http://127.0.0.1:8787/v1/jobs"), null);
});

test("loopback host access stays optional in both manifests", async () => {
  const { readFile } = await import("node:fs/promises");
  const options = await readFile(new URL("../src/entrypoints/extension-options.ts", import.meta.url), "utf8");
  // The options card asks for exactly what the manifests offer, or a grant would silently miss.
  const offered = JSON.parse(/export const HELPER_ORIGINS = (\[[^\]]*\]);/.exec(options)?.[1] ?? "[]");
  assert.deepEqual(offered, ["http://127.0.0.1/*", "http://localhost/*"]);
  for (const target of ["chrome", "firefox"]) {
    const manifest = JSON.parse(await readFile(new URL(`../src/extension/manifest.${target}.json`, import.meta.url), "utf8"));
    for (const origin of offered) {
      assert.ok(manifest.optional_host_permissions.includes(origin), `${target} must offer ${origin}`);
      assert.ok(!manifest.host_permissions.includes(origin), `${target} must not hold ${origin} at install`);
    }
  }
});

test("the local helper refuses a rebound Host, a foreign Origin and a near-miss token", async () => {
  const { request } = await import("node:http");
  const helper = helperTool.createYtDlpHelper({
    token: "secret-secret-secret",
    port: 0,
    spawnProcess() {
      throw new Error("no job may start in this test");
    }
  });
  const address = await helper.listen();
  // node:http, because fetch will not let a test forge Host or Origin the way a hostile page can.
  const call = (headers) => new Promise((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port: address.port, path: "/v1/jobs/unknown_job_12345678", method: "GET", headers },
      (incoming) => {
        incoming.resume();
        incoming.on("end", () => resolve({ status: incoming.statusCode, cors: incoming.headers["access-control-allow-origin"] ?? null }));
      }
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
  const auth = { authorization: "Bearer secret-secret-secret" };
  try {
    // DNS rebinding: the page's own hostname now resolves to loopback, and still says so in Host.
    assert.equal((await call({ ...auth, host: `evil.example:${address.port}` })).status, 421);
    assert.equal((await call({ ...auth, host: `127.0.0.1:${address.port}`, origin: "https://evil.example" })).status, 403);
    assert.equal((await call({ ...auth, host: `localhost:${address.port}`, origin: "https://x.com" })).status, 404);
    assert.equal((await call({ ...auth, host: `127.0.0.1:${address.port}`, origin: "chrome-extension://abcdefghijklmnop" })).status, 404);
    // Same length, one character off: refused like any other wrong token.
    assert.equal((await call({ authorization: "Bearer secret-secret-secreT", host: `127.0.0.1:${address.port}` })).status, 401);
    // An allowed origin is echoed back; a refused one never gets a CORS grant.
    assert.equal((await call({ ...auth, host: `127.0.0.1:${address.port}`, origin: "https://twitter.com" })).cors, "https://twitter.com");
    assert.equal((await call({ ...auth, host: `127.0.0.1:${address.port}`, origin: "https://evil.example" })).cors, null);
  } finally {
    await helper.close();
  }
  const source = await (await import("node:fs/promises")).readFile(new URL("../tools/yt-dlp-helper.mjs", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual\(received, expected\)/, "the token must be compared in constant time");
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
