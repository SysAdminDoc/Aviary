import type { IntegrationSettings } from "../../platform/settings.ts";
import { assertOutboundAllowed } from "../integrations/network-policy.ts";
import { compareVariantQuality, type VideoVariant } from "./video-extract.ts";

/** The format selector yt-dlp documents for best video plus best audio, with a single-file fallback. */
export const YTDLP_FORMAT_POLICY = "bv*+ba/b";
/**
 * Let yt-dlp choose MP4 when the streams are compatible and MKV when they are not.
 *
 * Both are container writes, not re-encodes: `--merge-output-format` muxes the streams yt-dlp
 * already downloaded. MKV is the honest answer when the streams will not fit MP4, and taking it
 * costs nothing in picture quality -- which is why this policy never asks for a transcode. The
 * result is a remux of an adaptive rendition, and `ADAPTIVE_HANDOFF_OUTPUT` is what callers label
 * it: never "original", because the original progressive file X served is a different file and
 * stays available.
 */
export const YTDLP_MERGE_POLICY = "mp4/mkv";

/**
 * What the optional helper produces, stated so no surface can present it as the file X served.
 *
 * `losslessRemux` is true because `bv*+ba/b` selects streams and muxes them; nothing is
 * re-encoded, so there is no quality cost to declare. If a future policy ever required a
 * transcode, this is where its cost would be named, and the label would stop saying remux.
 */
export const ADAPTIVE_HANDOFF_OUTPUT = {
  label: "adaptive-remux",
  losslessRemux: true,
  transcoded: false,
  qualityCost: null
} as const;
export const YTDLP_DEFAULT_ENDPOINT = "http://127.0.0.1:8787";

export interface ObservedAdaptiveCandidate {
  manifestUrl: string;
  variant: VideoVariant;
}

export type YtDlpJobState = "missing" | "refused" | "running" | "completed" | "failed";

export interface YtDlpJobStatus {
  jobId?: string;
  state: YtDlpJobState;
  error?: string;
}

export interface YtDlpHandoffRequest {
  manifestUrl: string;
  filename: string;
  formatPolicy: string;
}

/**
 * Only manifests already observed in X's media metadata can cross the optional local-helper
 * boundary. A status page, a user URL, or a guessed CDN host is never accepted as a job input.
 */
export function isObservedAdaptiveManifest(variant: Pick<VideoVariant, "url" | "type">): boolean {
  let parsed: URL;
  try {
    parsed = new URL(variant.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "video.twimg.com") {
    return false;
  }
  return /\.(?:m3u8|mpd)$/i.test(parsed.pathname) ||
    /(?:mpegurl|dash\+xml)/i.test(variant.type);
}

/** Returns observed HLS/DASH manifests from richest rendition to weakest, deterministically. */
export function observedAdaptiveCandidates(
  variants: readonly VideoVariant[]
): ObservedAdaptiveCandidate[] {
  return variants
    .filter(isObservedAdaptiveManifest)
    .map((variant) => ({ manifestUrl: variant.url, variant }))
    .sort((left, right) => {
      const quality = compareVariantQuality(right.variant, left.variant);
      return quality !== 0 ? quality : left.manifestUrl.localeCompare(right.manifestUrl);
    });
}

export function bestObservedAdaptive(
  variants: readonly VideoVariant[]
): ObservedAdaptiveCandidate | null {
  return observedAdaptiveCandidates(variants)[0] ?? null;
}

/** A helper action is useful only when the observed adaptive path can beat or replace direct media. */
export function shouldOfferAdaptiveHelper(
  direct: Pick<VideoVariant, "width" | "height" | "bitrate"> | null,
  variants: readonly VideoVariant[]
): boolean {
  const adaptive = bestObservedAdaptive(variants);
  return adaptive !== null && (direct === null || compareVariantQuality(adaptive.variant, direct) > 0);
}

export function buildYtDlpCommand(request: YtDlpHandoffRequest): string {
  return [
    "yt-dlp",
    "--no-playlist",
    "--format",
    quotePowerShell(request.formatPolicy),
    "--merge-output-format",
    quotePowerShell(YTDLP_MERGE_POLICY),
    "--output",
    quotePowerShell(request.filename),
    quotePowerShell(request.manifestUrl)
  ].join(" ");
}

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

export async function handoffToYtDlp(
  settings: IntegrationSettings["ytDlp"],
  request: YtDlpHandoffRequest
): Promise<YtDlpJobStatus> {
  if (!settings.enabled || !settings.secret) {
    return { state: "refused", error: "Enable the local yt-dlp helper and set its shared secret." };
  }
  const endpoint = normalizeYtDlpEndpoint(settings.endpoint);
  if (!endpoint) {
    return { state: "refused", error: "The yt-dlp helper endpoint must be on this machine." };
  }
  if (!isObservedAdaptiveManifest({ url: request.manifestUrl, type: "application/x-mpegURL" })) {
    return { state: "refused", error: "Only an observed X adaptive manifest can be handed off." };
  }
  assertOutboundAllowed("The local yt-dlp handoff");
  try {
    const response = await fetch(`${endpoint}/v1/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.secret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        manifestUrl: request.manifestUrl,
        filename: request.filename,
        formatPolicy: request.formatPolicy
      })
    });
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      return { state: "refused", error: textError(payload, "The local yt-dlp helper refused authorization.") };
    }
    if (!response.ok) {
      return { state: "failed", error: textError(payload, `The local yt-dlp helper returned HTTP ${response.status}.`) };
    }
    return normalizeJobStatus(payload, "The local yt-dlp helper returned an invalid job.");
  } catch (error) {
    return { state: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readYtDlpJob(
  settings: IntegrationSettings["ytDlp"],
  jobId: string
): Promise<YtDlpJobStatus> {
  if (!settings.enabled || !settings.secret) return { state: "refused", error: "The local yt-dlp helper is not configured." };
  const endpoint = normalizeYtDlpEndpoint(settings.endpoint);
  if (!endpoint || !/^[A-Za-z0-9_-]{8,80}$/.test(jobId)) return { state: "missing" };
  assertOutboundAllowed("The local yt-dlp status check");
  try {
    const response = await fetch(`${endpoint}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${settings.secret}` }
    });
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      return { state: "refused", error: textError(payload, "The local yt-dlp helper refused authorization.") };
    }
    if (response.status === 404) return { state: "missing" };
    if (!response.ok) return { state: "failed", error: textError(payload, `The local yt-dlp helper returned HTTP ${response.status}.`) };
    return normalizeJobStatus(payload, "The local yt-dlp helper returned an invalid status.");
  } catch (error) {
    return { state: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeJobStatus(value: unknown, fallback: string): YtDlpJobStatus {
  if (!value || typeof value !== "object") return { state: "failed", error: fallback };
  const record = value as Record<string, unknown>;
  const state = record.state;
  if (state !== "missing" && state !== "refused" && state !== "running" && state !== "completed" && state !== "failed") {
    return { state: "failed", error: fallback };
  }
  return {
    ...(typeof record.jobId === "string" ? { jobId: record.jobId } : {}),
    state: state as YtDlpJobState,
    ...(typeof record.error === "string" ? { error: record.error } : {})
  };
}

function textError(value: unknown, fallback: string): string {
  const error = value && typeof value === "object" ? (value as Record<string, unknown>).error : undefined;
  if (typeof error === "string") {
    return error;
  }
  return fallback;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
