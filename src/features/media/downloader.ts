import type { IntegrationSettings } from "../../platform/settings.ts";
import {
  mediaIdentityHash,
  perceptualImageHash,
  sha256HexAsync,
  type MediaFingerprint,
  type MediaFingerprintKind
} from "../export/assets.ts";
import type { ExportMedia, ExportRecord, MediaCaptureReduction } from "../export/types.ts";
import {
  addUriToAria2,
  Aria2History,
  shouldHandoffToAria2
} from "../integrations/aria2.ts";
import { NETWORK_TIMEOUTS, withNetworkTimeout } from "../../platform/network.ts";
import {
  DOWNLOAD_QUERY_MESSAGE,
  type DownloadQualityReceipt,
  type DownloadQueryResponse,
  type DownloadQueryState,
  normalizeDownloadQuality
} from "../../extension/download-state.ts";

export interface DownloadRequest {
  url: string;
  /** Ordered lower-quality candidates used only when the preferred transfer fails. */
  fallbackUrls?: string[];
  filename: string;
  estimatedBytes?: number | null;
  quality?: DownloadQualityReceipt;
  fallbackQualities?: DownloadQualityReceipt[];
}

export interface DownloaderResult {
  ok: true;
  via: "gm" | "extension" | "anchor" | "aria2";
  gid?: string;
  deduplicated?: boolean;
  /** True when the file was handed to the browser without a guaranteed save (cross-origin anchor). */
  degraded?: boolean;
  /**
   * The browser accepted the request but has not finished the transfer. Callers must not report a
   * save, or write duplicate history, until the terminal state arrives for `downloadId`.
   */
  pending?: boolean;
  downloadId?: number;
  quality?: DownloadQualityReceipt;
}

export interface CapturedMediaBytes {
  sourceUrl: string;
  capturedAt: string;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  contentType: string;
  httpStatus: number;
  httpHeaders: Record<string, string>;
}

export interface CaptureMediaOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

export interface MediaFingerprintRequest {
  kind: MediaFingerprintKind;
  url: string;
  fallbackUrls?: string[];
  mediaId: string | null;
  includePerceptual: boolean;
  timeoutMs?: number;
}

/** A duplicate check must stay much shorter than the download it precedes. */
export const MEDIA_FINGERPRINT_TIMEOUT_MS = 1_500;

/** Code shared with the background worker so both sides agree on the failure. */
export const DOWNLOAD_PERMISSION_CODE = "downloads-permission-missing";

/**
 * Reads a media response into the export model. Browser download APIs only acknowledge a
 * handoff; they cannot prove that an offline package contains the body, so package capture uses
 * this explicit, bounded path instead.
 */
export async function captureMediaBytes(
  url: string,
  options: CaptureMediaOptions = {}
): Promise<CapturedMediaBytes> {
  const sourceUrl = url.trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new TypeError("Only HTTP(S) media URLs can be captured into an archive.");
  }
  const maxBytes = Math.max(1, Math.trunc(options.maxBytes ?? 50 * 1024 * 1024));
  const captured = await withNetworkTimeout(async (signal) => {
    const response = await fetch(sourceUrl, { signal });
    if (!response.ok) {
      throw new Error(`Media request failed with HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new RangeError(`Media response exceeds the ${maxBytes}-byte capture limit.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new RangeError(`Media response exceeds the ${maxBytes}-byte capture limit.`);
    }
    // A deadline cannot interrupt the hash, and it never even got the chance to try. `fetch` and
    // `arrayBuffer` resolve through microtasks, which drain before any timer runs, so a one
    // millisecond budget against a 48 MB response copied and digested the whole payload and only
    // then reported that the budget had run out. Yielding once lets an expired timer actually
    // fire, and the check then happens before anything is paid for.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    if (signal.aborted) {
      throw signal.reason;
    }
    const sha256 = await sha256HexAsync(bytes);
    return {
      bytes,
      contentType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream",
      httpStatus: response.status,
      httpHeaders: safeResponseHeaders(response.headers),
      sha256
    };
  }, options.timeoutMs ?? NETWORK_TIMEOUTS.mediaTransfer);
  return {
    sourceUrl,
    capturedAt: new Date().toISOString(),
    bytes: captured.bytes,
    byteLength: captured.bytes.byteLength,
    sha256: captured.sha256,
    contentType: captured.contentType,
    httpStatus: captured.httpStatus,
    httpHeaders: captured.httpHeaders
  };
}

/**
 * Builds the strongest fingerprint available without making a save depend on the fingerprint
 * request. Videos retain their stable X identity because reading a multi-gigabyte file merely to
 * decide whether to download it would double the transfer. Images add exact bytes and, when the
 * user opts in, a visual signature.
 */
export async function fingerprintMediaDownload(
  request: MediaFingerprintRequest
): Promise<MediaFingerprint> {
  const identityHash = mediaIdentityHash(request.kind, request.url, request.mediaId);
  if (request.kind === "video") {
    return { identityHash };
  }

  const timeoutMs = Math.max(
    1,
    Math.min(MEDIA_FINGERPRINT_TIMEOUT_MS, Math.trunc(request.timeoutMs ?? MEDIA_FINGERPRINT_TIMEOUT_MS))
  );
  const deadline = Date.now() + timeoutMs;
  for (const url of downloadCandidates(request)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const captured = await captureMediaBytes(url, { timeoutMs: remaining });
      let perceptualHash: string | null = null;
      if (request.includePerceptual && captured.contentType.startsWith("image/")) {
        const decodeBudget = deadline - Date.now();
        if (decodeBudget <= 0) {
          return { identityHash, exactHash: captured.sha256 };
        }
        try {
          perceptualHash = await withNetworkTimeout(async (signal) => {
            const hash = await perceptualImageHash(captured.bytes, captured.contentType);
            if (signal.aborted) throw signal.reason;
            return hash;
          }, decodeBudget);
        } catch {
          // Exact matching still works when an image decoder refuses an otherwise downloadable file.
        }
      }
      return {
        identityHash,
        exactHash: captured.sha256,
        ...(perceptualHash ? { perceptualHash } : {})
      };
    } catch {
      // The downloader walks the same ordered candidates. A fingerprint miss must never block it.
    }
  }
  return { identityHash };
}

/**
 * How much of each asset to keep. Both default to keeping everything the host served.
 *
 * They apply from here on and never touch a record that is already stored: a capture setting is a
 * decision about the next capture, not a retroactive edit of a library.
 */
export interface CaptureSizeOptions {
  /** Fraction of the original pixel dimensions to keep for an image. `1` keeps the original. */
  imageScale?: number;
  /** Store a video's poster frame instead of its bytes. */
  posterFrameOnly?: boolean;
}

/** Captures each asset explicitly and retains a retryable remote-reference on failure. */
export async function captureExportRecordMedia(
  record: ExportRecord,
  options: CaptureMediaOptions & CaptureSizeOptions = {}
): Promise<ExportRecord> {
  const media = await Promise.all(record.media.map(async (entry): Promise<ExportMedia> => {
    const posterOnly = options.posterFrameOnly === true && entry.kind === "video";
    // The poster is a still the host already serves, so this is a different asset rather than a
    // shrunken version of the same one. Saying so on the record is what stops a later export from
    // presenting a thumbnail as the video.
    const posterUrl = posterOnly ? (entry.poster ?? "").trim() : "";
    const sourceUrl = posterOnly && posterUrl
      ? posterUrl
      : (entry.sourceUrl ?? entry.url).trim();
    try {
      const captured = await captureMediaBytes(sourceUrl, options);
      const reduced = await applyCaptureSize(captured, options, posterOnly && Boolean(posterUrl));
      return {
        ...entry,
        sourceUrl: captured.sourceUrl,
        capturedAt: captured.capturedAt,
        byteLength: reduced.bytes.byteLength,
        sha256: reduced.sha256,
        bytes: reduced.bytes,
        httpStatus: captured.httpStatus,
        httpHeaders: captured.httpHeaders,
        type: reduced.contentType || (entry.type?.includes("/") ? entry.type : captured.contentType),
        captureStatus: "captured-bytes",
        ...(reduced.reduction ? { reduction: reduced.reduction } : {})
      };
    } catch (error) {
      return {
        ...entry,
        sourceUrl,
        capturedAt: entry.capturedAt ?? new Date().toISOString(),
        captureStatus: /^https?:\/\//i.test(sourceUrl) ? "remote-reference" : "missing",
        captureError: error instanceof Error ? error.message : String(error)
      };
    }
  }));
  return { ...record, media };
}

/**
 * Applies the capture-size settings to bytes that were already fetched.
 *
 * A downscale that cannot run -- no `createImageBitmap`, no `OffscreenCanvas`, a format the
 * decoder refuses -- keeps the original bytes and records no reduction. Claiming a reduction that
 * did not happen would put a wrong number on the record, which is worse than storing the original.
 */
async function applyCaptureSize(
  captured: CapturedMediaBytes,
  options: CaptureSizeOptions,
  posterFrameOnly: boolean
): Promise<{ bytes: Uint8Array; sha256: string; contentType: string; reduction?: MediaCaptureReduction }> {
  const scale = options.imageScale ?? 1;
  const isImage = captured.contentType.startsWith("image/");
  const wantsScale = isImage && Number.isFinite(scale) && scale > 0 && scale < 1;

  const reduction: MediaCaptureReduction = {};
  if (posterFrameOnly) reduction.posterFrameOnly = true;

  if (!wantsScale) {
    if (posterFrameOnly) reduction.originalByteLength = captured.byteLength;
    return {
      bytes: captured.bytes,
      sha256: captured.sha256,
      contentType: captured.contentType,
      ...(posterFrameOnly ? { reduction } : {})
    };
  }

  const rescaled = await downscaleImageBytes(captured.bytes, captured.contentType, scale);
  if (!rescaled) {
    return {
      bytes: captured.bytes,
      sha256: captured.sha256,
      contentType: captured.contentType,
      ...(posterFrameOnly ? { reduction: { ...reduction, originalByteLength: captured.byteLength } } : {})
    };
  }
  return {
    bytes: rescaled.bytes,
    sha256: await sha256HexAsync(rescaled.bytes),
    contentType: rescaled.contentType,
    reduction: { ...reduction, imageScale: scale, originalByteLength: captured.byteLength }
  };
}

/** Decodes, redraws at a fraction of the size, and re-encodes. Returns null if any step is absent. */
async function downscaleImageBytes(
  bytes: Uint8Array,
  contentType: string,
  scale: number
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const decode = globalThis.createImageBitmap;
  const Canvas = globalThis.OffscreenCanvas;
  if (typeof decode !== "function" || typeof Canvas !== "function") return null;
  try {
    const source = new Blob([new Uint8Array(bytes)], { type: contentType });
    const bitmap = await decode(source);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new Canvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return null;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    // PNG keeps a lossless re-encode lossless. A JPEG source stays JPEG so a photo does not grow.
    const type = contentType === "image/png" ? "image/png" : "image/jpeg";
    const blob = await canvas.convertToBlob({ type, quality: 0.92 });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: type };
  } catch {
    return null;
  }
}

function safeResponseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (/^(?:accept-ranges|cache-control|content-disposition|content-range|content-type|etag|expires|last-modified)$/.test(normalized)) {
      output[normalized] = value;
    }
  });
  return output;
}

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
  | { status: "ok"; id?: number; pending?: boolean }
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

/**
 * Reconciles a browser download id retained by the durable media queue. A missing response means
 * this page is running without Aviary's extension background, so callers can use their normal
 * downloader fallback instead of treating the query itself as a failed save.
 */
export async function queryExtensionDownload(
  id: number
): Promise<Extract<DownloadQueryResponse, { ok: true }> | undefined> {
  if (!Number.isSafeInteger(id) || id < 0) {
    return undefined;
  }
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return undefined;
  }
  try {
    const response = (await runtime.sendMessage({
      type: DOWNLOAD_QUERY_MESSAGE,
      id
    })) as {
      ok?: unknown;
      id?: unknown;
      state?: unknown;
      error?: unknown;
      quality?: unknown;
    } | undefined;
    if (
      response?.ok !== true ||
      response.id !== id ||
      !isDownloadQueryState(response.state)
    ) {
      return undefined;
    }
    return {
      ok: true,
      id,
      state: response.state,
      ...(typeof response.error === "string" ? { error: response.error } : {}),
      ...(response.quality ? { quality: normalizeDownloadQuality(response.quality) } : {})
    };
  } catch {
    return undefined;
  }
}

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
        options.onWarn?.("Aria2 refused the handoff, saving through the browser instead", {
          error: result.error ?? "unknown",
          filename: request.filename
        });
      }
    }

    const gmResult = await tryGmDownload(request);
    if (gmResult) {
      return { ok: true, via: "gm", ...(gmResult.quality ? { quality: gmResult.quality } : {}) };
    }

    const extResult = await tryExtensionDownload(request);
    if (extResult.status === "ok") {
      return {
        ok: true,
        via: "extension",
        ...(extResult.pending && extResult.id !== undefined
          ? { pending: true, downloadId: extResult.id }
          : {})
      };
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

async function tryGmDownload(
  request: DownloadRequest
): Promise<{ quality?: DownloadQualityReceipt } | undefined> {
  const globals = globalThis as GlobalWithDownload;
  if (typeof globals.GM_download !== "function") {
    return undefined;
  }

  const candidates = [
    { url: request.url, quality: request.quality },
    ...(request.fallbackUrls ?? []).map((url, index) => ({
      url,
      quality: request.fallbackQualities?.[index]
    }))
  ]
    .filter((candidate, index, all) =>
      /^https?:\/\//i.test(candidate.url) &&
      all.findIndex((entry) => entry.url === candidate.url) === index
    )
    .slice(0, 4);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const saved = await new Promise<boolean>((resolve) => {
      try {
        globals.GM_download?.({
          url: candidate.url,
          name: request.filename,
          onload: () => resolve(true),
          onerror: () => resolve(false),
          ontimeout: () => resolve(false)
        });
      } catch {
        resolve(false);
      }
    });
    if (saved) {
      return candidate.quality ? { quality: candidate.quality } : {};
    }
  }
  return undefined;
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
      ...(request.fallbackUrls ? { fallbackUrls: request.fallbackUrls } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.fallbackQualities ? { fallbackQualities: request.fallbackQualities } : {}),
      filename: request.filename
    })) as { ok?: boolean; id?: number; pending?: boolean; code?: string; error?: string } | undefined;
    if (response?.ok === true) {
      return {
        status: "ok",
        ...(typeof response.id === "number" ? { id: response.id } : {}),
        ...(response.pending === true ? { pending: true } : {})
      };
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

function downloadCandidates(request: Pick<DownloadRequest, "url" | "fallbackUrls">): string[] {
  return [request.url, ...(request.fallbackUrls ?? [])]
    .filter((url, index, all) => /^https?:\/\//i.test(url) && all.indexOf(url) === index)
    .slice(0, 4);
}

function isDownloadQueryState(value: unknown): value is DownloadQueryState {
  return value === "in_progress" || value === "complete" || value === "interrupted" || value === "missing";
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
