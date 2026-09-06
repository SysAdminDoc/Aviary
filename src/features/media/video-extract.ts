export interface VideoVariant {
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  /** Optional rendition evidence carried by X when it is available. */
  codec?: string | null;
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

export function extractVideos(article: Element): ExtractedVideo[] {
  const results: ExtractedVideo[] = [];
  for (const container of videoContainers(article)) {
    const extracted = extractVideo(container);
    if (extracted) {
      results.push(extracted);
    }
  }
  return results;
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
      source.dataset.bitrate
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
    variant.provenance ?? undefined
  );
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
  provenance?: string
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
  if (codec?.trim()) candidate.codec = codec.trim();
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
    const bitrateDiff = (b.bitrate ?? 0) - (a.bitrate ?? 0);
    if (bitrateDiff !== 0) {
      return bitrateDiff;
    }
    const aPixels = (a.width ?? 0) * (a.height ?? 0);
    const bPixels = (b.width ?? 0) * (b.height ?? 0);
    const pixelDiff = bPixels - aPixels;
    return pixelDiff !== 0 ? pixelDiff : compareStable(a.url, b.url);
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
