import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_OUTPUT = path.resolve("aviary-downloads");
export const FORMAT_POLICY = "bv*+ba/b";
export const MERGE_POLICY = "mp4/mkv";
const MAX_BODY = 16_384;
const MAX_JOBS = 64;

/**
 * Small companion service for the optional browser handoff. It accepts an observed X manifest,
 * never a post URL or browser credential, and launches yt-dlp without a shell. The browser-facing
 * API is intentionally boring so a local firewall or a separate process manager can wrap it.
 */
export function createYtDlpHelper({
  token,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  outputDir = DEFAULT_OUTPUT,
  spawnProcess = spawn
} = {}) {
  if (typeof token !== "string" || token.trim().length < 16) {
    throw new Error("AVIARY_YTDLP_TOKEN must be a shared secret of at least 16 characters.");
  }
  const jobs = new Map();
  const server = createServer(async (request, response) => {
    applyCors(response, request.headers.origin);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (!authorized(request, token)) {
      writeJson(response, 401, { state: "refused", error: "Authorization required." });
      return;
    }

    const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
    if (request.method === "POST" && pathname === "/v1/jobs") {
      const body = await readBody(request);
      if (body === null) {
        writeJson(response, 413, { state: "failed", error: "Request body is too large." });
        return;
      }
      const input = parseInput(body);
      if (!input.ok) {
        writeJson(response, 400, { state: "refused", error: input.error });
        return;
      }
      const jobId = randomBytes(12).toString("base64url");
      const job = { jobId, state: "running", error: undefined };
      jobs.set(jobId, job);
      trimJobs(jobs);
      writeJson(response, 202, job);
      void runJob(job, input.value, { outputDir, spawnProcess });
      return;
    }

    const match = /^\/v1\/jobs\/([A-Za-z0-9_-]{16,80})$/.exec(pathname);
    if (request.method === "GET" && match) {
      const job = jobs.get(match[1]);
      if (!job) {
        writeJson(response, 404, { state: "missing" });
        return;
      }
      writeJson(response, 200, job);
      return;
    }

    writeJson(response, 404, { state: "missing" });
  });

  return {
    server,
    jobs,
    listen: () => new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address());
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    }),
    close: () => new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    })
  };
}

export function parseInput(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, error: "Request body must be JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Request body must be an object." };
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "filename,formatPolicy,manifestUrl") {
    return { ok: false, error: "Only manifestUrl, filename, and formatPolicy are accepted." };
  }
  if (value.formatPolicy !== FORMAT_POLICY) {
    return { ok: false, error: "Unsupported format policy." };
  }
  if (!isObservedManifest(value.manifestUrl)) {
    return { ok: false, error: "Only an observed video.twimg.com adaptive manifest is accepted." };
  }
  const filename = safeFilename(value.filename);
  if (!filename) {
    return { ok: false, error: "Filename must stay inside the helper output folder." };
  }
  return { ok: true, value: { manifestUrl: value.manifestUrl, filename, formatPolicy: value.formatPolicy } };
}

export function isObservedManifest(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname.toLowerCase() === "video.twimg.com" &&
      /\.(?:m3u8|mpd)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function safeFilename(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) return null;
  const cleaned = segments.map((segment) => segment.replace(/[<>:"/\\|?*]/g, "_").replace(/[. ]+$/g, "")).filter(Boolean);
  return cleaned.length === segments.length ? cleaned.join(path.sep) : null;
}

async function runJob(job, input, { outputDir, spawnProcess }) {
  try {
    await mkdir(outputDir, { recursive: true });
    const child = spawnProcess("yt-dlp", [
      "--no-playlist",
      "--format", input.formatPolicy,
      "--merge-output-format", MERGE_POLICY,
      "--output", input.filename,
      input.manifestUrl
    ], { cwd: outputDir, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-800);
    });
    child.on("error", (error) => {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    });
    child.on("close", (code) => {
      if (job.state === "failed") return;
      if (code === 0) {
        job.state = "completed";
        delete job.error;
      } else {
        job.state = "failed";
        job.error = stderr.trim() || `yt-dlp exited with code ${code ?? "unknown"}.`;
      }
    });
  } catch (error) {
    job.state = "failed";
    job.error = error instanceof Error ? error.message : String(error);
  }
}

function trimJobs(jobs) {
  while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value);
}

function authorized(request, token) {
  const header = request.headers.authorization;
  return typeof header === "string" && header === `Bearer ${token}`;
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > MAX_BODY) return null;
  }
  return body;
}

function applyCors(response, origin) {
  response.setHeader("access-control-allow-origin", typeof origin === "string" ? origin : "*");
  response.setHeader("access-control-allow-headers", "authorization, content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("vary", "Origin");
}

function writeJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.AVIARY_YTDLP_TOKEN;
  const port = Number(process.env.AVIARY_YTDLP_PORT ?? DEFAULT_PORT);
  const outputDir = process.env.AVIARY_YTDLP_OUTPUT ? path.resolve(process.env.AVIARY_YTDLP_OUTPUT) : DEFAULT_OUTPUT;
  const helper = createYtDlpHelper({ token, port, outputDir });
  await helper.listen();
  console.log(`Aviary yt-dlp helper listening on http://${DEFAULT_HOST}:${port}`);
  console.log(`Downloads are written under ${outputDir}`);
}
