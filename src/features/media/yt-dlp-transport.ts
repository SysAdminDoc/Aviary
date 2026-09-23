/**
 * The one HTTP exchange the optional yt-dlp helper needs, and where it runs.
 *
 * A fetch from the x.com page to a loopback address meets Chrome's Local Network Access prompt
 * (Chrome 142+). An extension context that holds host access to the loopback origin is exempt,
 * so extension builds hand the exchange to the background worker. The userscript has no
 * background and keeps the direct fetch. This module stays free of media and settings imports so
 * the background bundle only gains URL checks.
 */

import { assertOutboundAllowed } from "../integrations/network-policy.ts";

export const YTDLP_PROXY_MESSAGE = "AVIARY_YTDLP_PROXY";
export const YTDLP_DEFAULT_ENDPOINT = "http://127.0.0.1:8787";

export interface YtDlpHttpCall {
  method: "GET" | "POST";
  url: string;
  secret: string;
  body?: string;
}

export interface YtDlpHttpResult {
  status: number;
  payload: unknown;
}

const MAX_BODY = 16_384;
const MAX_SECRET = 1024;
const CREATE_PATH = /\/v1\/jobs$/;
const READ_PATH = /\/v1\/jobs\/[A-Za-z0-9_-]{8,80}$/;
const JOB_KEYS = "filename,formatPolicy,manifestUrl";

export function normalizeYtDlpEndpoint(endpoint: string): string | null {
  try {
    const parsed = new URL(endpoint || YTDLP_DEFAULT_ENDPOINT);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      host !== "localhost" &&
      host !== "::1" &&
      !host.endsWith(".localhost") &&
      !/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    ) {
      return null;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * The background re-checks everything the content side already checked. A content script is
 * the only sender, but the worker holds loopback host access, so it only ever carries a job
 * create or a job read to a loopback helper, with an observed X manifest as the job input.
 */
export function validateYtDlpCall(value: unknown): YtDlpHttpCall | null {
  if (!value || typeof value !== "object") return null;
  const { method, url, secret, body } = value as Record<string, unknown>;
  if (typeof url !== "string" || typeof secret !== "string") return null;
  if (secret.length === 0 || secret.length > MAX_SECRET || /[\r\n]/.test(secret)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (normalizeYtDlpEndpoint(url) === null) return null;
  if (method === "GET") {
    return body === undefined && READ_PATH.test(parsed.pathname) ? { method, url, secret } : null;
  }
  if (method !== "POST" || !CREATE_PATH.test(parsed.pathname)) return null;
  if (typeof body !== "string" || body.length > MAX_BODY || !isJobBody(body)) return null;
  return { method, url, secret, body };
}

function isJobBody(body: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return false;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== JOB_KEYS) return false;
  if (typeof record.filename !== "string" || typeof record.formatPolicy !== "string") return false;
  if (typeof record.manifestUrl !== "string") return false;
  try {
    const manifest = new URL(record.manifestUrl);
    return manifest.protocol === "https:" && manifest.hostname.toLowerCase() === "video.twimg.com";
  } catch {
    return false;
  }
}

export async function performYtDlpCall(call: YtDlpHttpCall): Promise<YtDlpHttpResult> {
  const response = await fetch(call.url, {
    method: call.method,
    headers: {
      authorization: `Bearer ${call.secret}`,
      ...(call.body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(call.body === undefined ? {} : { body: call.body })
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

/**
 * Extension builds send the call to the background worker. No answer means no Aviary background
 * is listening (the userscript, or a page where `chrome.runtime` belongs to someone else), and
 * then the call goes out directly as it always has. Local-only mode is checked here, on the page
 * side, for both routes: the background has no settings of its own and only ever answers this.
 */
export async function sendYtDlpCall(call: YtDlpHttpCall): Promise<YtDlpHttpResult> {
  assertOutboundAllowed("The local yt-dlp helper call");
  const runtime = globalThis.chrome?.runtime;
  if (runtime?.id && typeof runtime.sendMessage === "function") {
    const response = (await runtime.sendMessage({ type: YTDLP_PROXY_MESSAGE, call })) as
      | { ok?: unknown; status?: unknown; payload?: unknown; error?: unknown }
      | undefined;
    if (response?.ok === true && typeof response.status === "number") {
      return { status: response.status, payload: response.payload ?? null };
    }
    if (response?.ok === false) {
      throw new Error(typeof response.error === "string" ? response.error : "The extension background refused the helper call.");
    }
  }
  return performYtDlpCall(call);
}

export function isYtDlpProxyMessage(message: unknown): message is { type: typeof YTDLP_PROXY_MESSAGE; call: unknown } {
  return typeof message === "object" && message !== null &&
    (message as { type?: unknown }).type === YTDLP_PROXY_MESSAGE;
}
