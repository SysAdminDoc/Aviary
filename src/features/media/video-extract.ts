/**
 * Where a codec string came from, kept beside the codec itself.
 *
 * A codec name is evidence about a stream, not a measurement of quality and not proof that the
 * file plays. X has shipped a declared AVC stream inside a container the browser then refused, and
 * it omits the field entirely on plenty of renditions that play fine. Recording the source keeps
 * "X told us" apart from "we read it off a source element", so neither can be mistaken for the
 * other or for playback.
 */
export type CodecEvidenceSource = "graphql-variant" | "source-element";

export interface VideoVariant {
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  /** Optional rendition evidence carried by X when it is available. */
  codec?: string | null;
  /** Where `codec` was read. Absent whenever `codec` is absent. */
  codecSource?: CodecEvidenceSource | null;
  /**
   * The browser rendered frames from this exact URL on this page. Separate from any codec claim:
   * a stream can be named and unplayable, or unnamed and playing right now.
   */
  playbackObserved?: boolean;
  /** Sources may be combined when the same signed URL is observed more than once. */
  provenance?: string | null;
}

export interface SubtitleTrack {
  url: string;
  type: string;
  language: string | null;
  label: string | null;
}

export interface VideoMetadata {
  poster?: string | null;
  variants?: VideoVariant[];
  audioVariants?: VideoVariant[];
  subtitleTracks?: SubtitleTrack[];
  isGif?: boolean;
}

export interface ExtractedVideo {
  container: HTMLElement;
  poster: string | null;
  isGif: boolean;
  variants: VideoVariant[];
  preferred: VideoVariant | null;
  audioVariants: VideoVariant[];
  subtitleTracks: SubtitleTrack[];
}

export const VIDEO_CONTAINER_SELECTOR =
  '[data-testid="videoPlayer"], [data-testid="videoComponent"]';

/**
 * X nests `videoComponent` inside `videoPlayer` on current routes. Return the innermost matched
 * container that owns each actual <video>, otherwise callers decorate the same player twice.
 */
export function videoContainers(root: Element): HTMLElement[] {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(VIDEO_CONTAINER_SELECTOR)
  );
  return candidates.filter((container) => {
    const video = container.querySelector<HTMLVideoElement>("video");
    if (!video) {
      return false;
    }
    return !candidates.some(
      (candidate) =>
        candidate !== container && container.contains(candidate) && candidate.contains(video)
    );
  });
}

export function extractVideo(
  container: HTMLElement,
  metadata: VideoMetadata = {}
): ExtractedVideo | null {
  const video = container.querySelector<HTMLVideoElement>("video");
  if (!video) {
    return null;
  }

  const variants: VideoVariant[] = [];
  const seen = new Set<string>();

  if (video.currentSrc) {
    pushVariant(variants, seen, video.currentSrc, video.dataset.contentType ?? "video/mp4");
    // `HAVE_CURRENT_DATA` means the element decoded a frame from this exact URL. It is the only
    // playback fact available without downloading anything, and it belongs nowhere near the codec
    // fields: it says the browser managed it, not what the stream claims to be.
    if (typeof video.readyState === "number" && video.readyState >= 2) {
      markPlaybackObserved(variants, video.currentSrc);
    }
  }
  if (video.src) {
    pushVariant(variants, seen, video.src, "video/mp4");
  }
  for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>("source"))) {
    pushVariant(
      variants,
      seen,
      source.src,
      source.type || "video/mp4",
      source.dataset.width,
      source.dataset.height,
      source.dataset.bitrate,
      source.dataset.codec,
      undefined,
      source.dataset.codec ? "source-element" : undefined
    );
  }

  for (const variant of metadata.variants ?? []) {
    pushVariantObject(variants, seen, variant);
  }

  const audioVariants: VideoVariant[] = [];
  const seenAudio = new Set<string>();
  for (const source of Array.from(video.querySelectorAll<HTMLSourceElement>("source"))) {
    const markedAudio =
      typeof source.hasAttribute === "function"
        ? source.hasAttribute("data-av-audio")
        : source.dataset?.avAudio !== undefined;
    if (!/^audio\//i.test(source.type) && !markedAudio) continue;
    pushVariant(
      audioVariants,
      seenAudio,
      source.src,
      source.type || "audio/mp4",
      undefined,
      undefined,
      source.dataset.bitrate
    );
  }
  for (const variant of metadata.audioVariants ?? []) {
    pushVariantObject(audioVariants, seenAudio, variant);
  }

  const subtitleTracks = [
    ...Array.from(video.querySelectorAll<HTMLTrackElement>("track"))
      .map(readSubtitleTrack)
      .filter((track): track is SubtitleTrack => track !== null),
    ...(metadata.subtitleTracks ?? [])
  ].filter((track, index, all) => all.findIndex((candidate) => candidate.url === track.url) === index);

  const poster = video.poster || metadata.poster || null;
  if (variants.length === 0 && !poster) {
    return null;
  }

  // Keep the extracted shape stable even when equivalent DOM/source observations arrive in a
  // different order. The preferred target is already deterministic, and the array now is too.
  const stableVariants = mergeVideoVariants([], variants);
  const stableAudioVariants = mergeVideoVariants([], audioVariants);
  const preferred = stableVariants.length > 0 ? pickPreferred(stableVariants) : null;
  const isGif = metadata.isGif === true || looksLikeGif(container, video, variants);

  return {
    container,
    poster,
    isGif,
    variants: stableVariants,
    preferred,
    audioVariants: stableAudioVariants,
    subtitleTracks
  };
}

function readSubtitleTrack(track: HTMLTrackElement): SubtitleTrack | null {
  if (typeof track.getAttribute !== "function" && typeof track.kind !== "string") {
    return null;
  }
  const url = track.src || track.getAttribute("src") || "";
  if (!/^https?:\/\//i.test(url)) return null;
  const kind = (track.kind || "").toLowerCase();
  if (kind && kind !== "subtitles" && kind !== "captions") return null;
  return {
    url,
    type: track.getAttribute?.("type") || "text/vtt",
    language: track.srclang?.trim() || null,
    label: track.label?.trim() || null
  };
}

function pushVariantObject(
  variants: VideoVariant[],
  seen: Set<string>,
  variant: VideoVariant
): void {
  pushVariant(
    variants,
    seen,
    variant.url,
    variant.type,
    variant.width === null ? undefined : String(variant.width),
    variant.height === null ? undefined : String(variant.height),
    variant.bitrate === null ? undefined : String(variant.bitrate),
    variant.codec ?? undefined,
    variant.provenance ?? undefined,
    variant.codecSource ?? (variant.codec ? "graphql-variant" : undefined)
  );
}

/** Records that one exact URL was seen decoding, without touching any other variant. */
function markPlaybackObserved(variants: VideoVariant[], url: string): void {
  const index = variants.findIndex((variant) => variant.url === url);
  if (index >= 0) variants[index] = { ...variants[index]!, playbackObserved: true };
}

function pushVariant(
  variants: VideoVariant[],
  seen: Set<string>,
  src: string,
  type: string,
  width?: string,
  height?: string,
  bitrate?: string,
  codec?: string,
  provenance?: string,
  codecSource?: CodecEvidenceSource
): void {
  if (!src) {
    return;
  }
  const candidate: VideoVariant = {
    url: src,
    type,
    width: parsePositiveInt(width),
    height: parsePositiveInt(height),
    bitrate: parsePositiveInt(bitrate)
  };
  if (codec?.trim()) {
    candidate.codec = codec.trim();
    // The name and where it came from travel together, so a later reader cannot treat an
    // unattributed string as an observation.
    if (codecSource) candidate.codecSource = codecSource;
  }
  if (provenance?.trim()) candidate.provenance = provenance.trim();

  const existingIndex = variants.findIndex((variant) => variant.url === src);
  if (existingIndex >= 0) {
    variants[existingIndex] = mergeVideoVariant(variants[existingIndex]!, candidate);
    seen.add(src);
    return;
  }
  seen.add(src);
  variants.push(candidate);
}

/**
 * Combines two observations of one exact, validated resource without mutating either caller.
 * Numeric evidence keeps the richest known value. Text evidence uses a deterministic precedence so
 * arrival order cannot change the selected rendition, while provenance retains every source label.
 */
export function mergeVideoVariant(left: VideoVariant, right: VideoVariant): VideoVariant {
  if (left.url !== right.url) {
    return { ...left };
  }
  const merged: VideoVariant = {
    url: left.url,
    type: chooseVariantType(left.url, left.type, right.type),
    width: maxKnown(left.width, right.width),
    height: maxKnown(left.height, right.height),
    bitrate: maxKnown(left.bitrate, right.bitrate)
  };
  if ("codec" in left || "codec" in right) {
    merged.codec = chooseKnownText(left.codec, right.codec);
    const source = merged.codec === left.codec ? left.codecSource : right.codecSource;
    merged.codecSource = merged.codec ? source ?? null : null;
  }
  if (left.playbackObserved || right.playbackObserved) {
    merged.playbackObserved = true;
  }
  if ("provenance" in left || "provenance" in right) {
    merged.provenance = mergeProvenance(left.provenance, right.provenance);
  }
  return merged;
}

/** Merges variants by exact URL, retaining signed query parameters and a stable order. */
export function mergeVideoVariants(
  existing: readonly VideoVariant[],
  incoming: readonly VideoVariant[]
): VideoVariant[] {
  const merged = new Map<string, VideoVariant>();
  for (const variant of [...existing, ...incoming]) {
    const previous = merged.get(variant.url);
    merged.set(
      variant.url,
      previous ? mergeVideoVariant(previous, variant) : { ...variant }
    );
  }
  return [...merged.values()].sort((left, right) => compareStable(left.url, right.url));
}

/**
 * Only complete, direct video files are browser-download targets. X also exposes MediaSource
 * handles and streaming manifests/segments; saving those produces an unusable blob, playlist, or
 * fragment instead of the video the person asked for.
 */
export function isSaveableVariantUrl(url: string, type = ""): boolean {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (/\.(?:m3u8|mpd|m4s)(?:[?#]|$)/i.test(url)) {
    return false;
  }
  return !/(?:mpegurl|dash\+xml)/i.test(type);
}

/**
 * Positive means `left` is the richer rendition.
 *
 * Resolution decides first, and a missing number is missing rather than zero. The old order asked
 * for bitrate first and read an absent bitrate as `0`, so a 1080p rendition that happened to carry
 * no bitrate lost to a 480p one that did -- a smaller picture chosen because of an absence. X's
 * reported bitrate has also been wrong often enough that it is a tie-break between two renditions
 * that both declared one, never a reason to take fewer pixels.
 *
 * Codec is deliberately absent from this comparison. A name is evidence about a stream, not a
 * measure of it, and demoting an unnamed higher-resolution rendition for a named smaller one is
 * the same mistake in a different field.
 */
export function compareVariantQuality(
  left: Pick<VideoVariant, "width" | "height" | "bitrate">,
  right: Pick<VideoVariant, "width" | "height" | "bitrate">
): number {
  const height = compareKnown(left.height, right.height);
  if (height !== 0) return height;
  const width = compareKnown(left.width, right.width);
  if (width !== 0) return width;
  if (left.bitrate !== null && right.bitrate !== null) {
    return left.bitrate - right.bitrate;
  }
  return 0;
}

/** Known beats unknown; two known values compare normally; two unknowns are a tie. */
function compareKnown(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

export function pickPreferred(variants: VideoVariant[]): VideoVariant {
  const sorted = [...variants].sort((a, b) => {
    const saveableDiff =
      Number(isSaveableVariantUrl(b.url, b.type)) -
      Number(isSaveableVariantUrl(a.url, a.type));
    if (saveableDiff !== 0) {
      return saveableDiff;
    }
    const mp4Diff = Number(isProgressiveMp4(b)) - Number(isProgressiveMp4(a));
    if (mp4Diff !== 0) {
      return mp4Diff;
    }
    const qualityDiff = compareVariantQuality(b, a);
    if (qualityDiff !== 0) {
      return qualityDiff;
    }
    return compareStable(a.url, b.url);
  });
  return sorted[0] ?? variants[0]!;
}

function maxKnown(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return Math.max(left ?? 0, right ?? 0) || null;
}

function chooseKnownText(left: string | null | undefined, right: string | null | undefined): string | null {
  const values = [left, right]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return [...new Set(values)].sort(compareStable)[0] ?? null;
}

function mergeProvenance(
  left: string | null | undefined,
  right: string | null | undefined
): string | null {
  const values = [left, right]
    .flatMap((value) => typeof value === "string" ? value.split("|") : [])
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)].sort(compareStable).join("|") || null;
}

function chooseVariantType(url: string, left: string, right: string): string {
  const types = [...new Set([left, right].map((value) => value.trim()).filter(Boolean))];
  if (types.length === 0) return "video/mp4";
  return types.sort((a, b) => {
    const scoreDiff = variantTypeScore(url, b) - variantTypeScore(url, a);
    return scoreDiff !== 0 ? scoreDiff : compareStable(a, b);
  })[0]!;
}

function variantTypeScore(url: string, type: string): number {
  const lowerType = type.toLowerCase();
  const lowerUrl = url.toLowerCase();
  let score = 0;
  if (lowerType === "video/mp4") score += 40;
  else if (lowerType.startsWith("video/")) score += 30;
  else if (lowerType === "audio/mp4") score += 35;
  else if (lowerType.startsWith("audio/")) score += 25;
  if (/(?:mpegurl|dash\+xml)/i.test(lowerType)) score -= 100;
  for (const extension of ["mp4", "webm", "mov", "m4a", "mp3", "ogg", "opus", "wav"]) {
    if (new RegExp(`\\.${extension}(?:[?#]|$)`, "i").test(lowerUrl) && lowerType.includes(extension)) {
      score += 50;
    }
  }
  return score;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isProgressiveMp4(variant: VideoVariant): boolean {
  return /video\/mp4/i.test(variant.type) || /\.mp4(?:[?#]|$)/i.test(variant.url);
}

function looksLikeGif(
  container: HTMLElement,
  video: HTMLVideoElement,
  variants: VideoVariant[]
): boolean {
  if (video.loop && video.muted) {
    return true;
  }
  const label = (container.getAttribute("aria-label") ?? "").toLowerCase();
  if (label.includes("gif")) {
    return true;
  }
  return variants.some((variant) => variant.url.toLowerCase().includes("tweet_video"));
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
