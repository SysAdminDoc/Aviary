import type { IntegrationSettings } from "../../platform/settings";
import {
  addUriToAria2,
  Aria2History,
  shouldHandoffToAria2
} from "../integrations/aria2";
import { NETWORK_TIMEOUTS, withNetworkTimeout } from "../../platform/network";

export interface DownloadRequest {
  url: string;
  filename: string;
  estimatedBytes?: number | null;
}

export interface DownloaderResult {
  ok: true;
  via: "gm" | "extension" | "anchor" | "aria2";
  gid?: string;
  deduplicated?: boolean;
  /** True when the file was handed to the browser without a guaranteed save (cross-origin anchor). */
  degraded?: boolean;
}

/** Code shared with the background worker so both sides agree on the failure. */
export const DOWNLOAD_PERMISSION_CODE = "downloads-permission-missing";

/**
 * Thrown when running as an extension without the optional `downloads` permission.
 * The anchor fallback cannot save a cross-origin `pbs.twimg.com` URL — the browser
 * ignores `download` and navigates instead — so reporting success there is a lie.
 */
export class DownloadPermissionError extends Error {
  readonly code = DOWNLOAD_PERMISSION_CODE;

  constructor(message = "Aviary needs the browser download permission to save this file.") {
    super(message);
    this.name = "DownloadPermissionError";
  }
}

type ExtensionAttempt =
  | { status: "ok" }
  | { status: "unavailable" }
  | { status: "needs-permission" }
  | { status: "failed"; error: string };

export interface DownloaderOptions {
  integrations?: IntegrationSettings;
  aria2History?: Aria2History;
  /**
   * Reports a handoff that was configured but refused. Without it, an unreachable aria2 or a
   * wrong secret silently fell through to a browser download -- the one place a
   * misconfiguration actually matters, and the only place it was invisible.
   */
  onWarn?: (message: string, details?: Record<string, unknown>) => void;
}

export type Downloader = (request: DownloadRequest) => Promise<DownloaderResult>;

type GlobalWithDownload = typeof globalThis & {
  GM_download?: (options: GmDownloadOptions) => unknown;
};

interface GmDownloadOptions {
  url: string;
  name: string;
  onload?: () => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}

export function createDownloader(options: DownloaderOptions = {}): Downloader {
  return async (request: DownloadRequest) => {
    if (options.integrations) {
      const aria = options.integrations.aria2;
      if (options.aria2History?.hasUrl(request.url)) {
        return { ok: true, via: "aria2", deduplicated: true };
      }
      // Without a size, shouldHandoffToAria2 sends everything -- so the 50 MB default threshold
      // routed 40 KB thumbnails to aria2 too. No caller had a size to give, so one is measured
      // here with a HEAD request, and a failed probe keeps the old send-anyway behaviour.
      const estimatedBytes =
        request.estimatedBytes ?? (aria.enabled && aria.endpoint ? await estimateBytes(request.url) : null);
      if (shouldHandoffToAria2(aria, estimatedBytes)) {
        const result = await addUriToAria2(
          { endpoint: aria.endpoint, secret: aria.secret },
          { url: request.url, filename: request.filename }
        );
        if (result.ok) {
          if (result.gid && options.aria2History) {
            await options.aria2History.rememberQueued({
              gid: result.gid,
              url: request.url,
              filename: request.filename
            });
          }
          return { ok: true, via: "aria2", ...(result.gid ? { gid: result.gid } : {}) };
        }
        options.onWarn?.("Aria2 refused the handoff — saving through the browser instead", {
          error: result.error ?? "unknown",
          filename: request.filename
        });
      }
    }

    const gmResult = await tryGmDownload(request);
    if (gmResult) {
      return { ok: true, via: "gm" };
    }

    const extResult = await tryExtensionDownload(request);
    if (extResult.status === "ok") {
      return { ok: true, via: "extension" };
    }
    if (extResult.status === "needs-permission") {
      throw new DownloadPermissionError();
    }
    if (extResult.status === "failed") {
      throw new Error(extResult.error);
    }

    triggerAnchor(request);
    return isCrossOrigin(request.url)
      ? { ok: true, via: "anchor", degraded: true }
      : { ok: true, via: "anchor" };
  };
}

/**
 * `<a download>` is honoured only for same-origin (or blob/data) URLs. Anywhere else the
 * attribute is dropped and the click navigates, so callers must not claim the file was saved.
 */
export function isCrossOrigin(url: string): boolean {
  if (/^(blob|data):/i.test(url)) {
    return false;
  }
  const base = typeof location === "undefined" ? undefined : location.href;
  try {
    const parsed = new URL(url, base);
    return base === undefined ? true : parsed.origin !== new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * Content-Length via HEAD, or null when the server will not say.
 *
 * Null preserves the previous behaviour (hand off regardless), because a threshold that silently
 * blocked handoffs on a server that hides its size would be worse than one that over-sends.
 */
async function estimateBytes(url: string): Promise<number | null> {
  if (typeof fetch !== "function") {
    return null;
  }
  try {
    const response = await withNetworkTimeout(
      (signal) => fetch(url, { method: "HEAD", signal }),
      NETWORK_TIMEOUTS.mediaProbe
    );
    if (!response.ok) {
      return null;
    }
    const length = Number(response.headers.get("content-length"));
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

async function tryGmDownload(request: DownloadRequest): Promise<boolean> {
  const globals = globalThis as GlobalWithDownload;
  if (typeof globals.GM_download !== "function") {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    try {
      globals.GM_download?.({
        url: request.url,
        name: request.filename,
        onload: () => resolve(true),
        onerror: () => resolve(false),
        ontimeout: () => resolve(false)
      });
    } catch {
      resolve(false);
    }
  });
}

async function tryExtensionDownload(request: DownloadRequest): Promise<ExtensionAttempt> {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return { status: "unavailable" };
  }

  try {
    const response = (await runtime.sendMessage({
      type: "AVIARY_DOWNLOAD",
      url: request.url,
      filename: request.filename
    })) as { ok?: boolean; code?: string; error?: string } | undefined;
    if (response?.ok === true) {
      return { status: "ok" };
    }
    if (response?.code === DOWNLOAD_PERMISSION_CODE) {
      return { status: "needs-permission" };
    }
    if (response === undefined) {
      // No listener answered — this page is not running the extension build.
      return { status: "unavailable" };
    }
    return { status: "failed", error: response.error ?? "download failed" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Asks the background worker to open the options page, where the grant button lives. */
export async function requestDownloadPermissionSurface(): Promise<boolean> {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return false;
  }
  try {
    const response = (await runtime.sendMessage({ type: "AVIARY_OPEN_OPTIONS" })) as
      | { ok?: boolean }
      | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

function triggerAnchor(request: DownloadRequest): void {
  if (typeof document === "undefined") {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = request.url;
  anchor.download = request.filename;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
