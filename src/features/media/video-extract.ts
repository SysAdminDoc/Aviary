export interface VideoVariant {
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

export interface VideoMetadata {
  poster?: string | null;
  variants?: VideoVariant[];
  isGif?: boolean;
}

export interface ExtractedVideo {
  container: HTMLElement;
  poster: string | null;
  isGif: boolean;
  variants: VideoVariant[];
  preferred: VideoVariant | null;
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

  const poster = video.poster || metadata.poster || null;
  if (variants.length === 0 && !poster) {
    return null;
  }

  const preferred = variants.length > 0 ? pickPreferred(variants) : null;
  const isGif = metadata.isGif === true || looksLikeGif(container, video, variants);

  return { container, poster, isGif, variants, preferred };
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
    variant.bitrate === null ? undefined : String(variant.bitrate)
  );
}

function pushVariant(
  variants: VideoVariant[],
  seen: Set<string>,
  src: string,
  type: string,
  width?: string,
  height?: string,
  bitrate?: string
): void {
  if (!src || seen.has(src)) {
    return;
  }
  seen.add(src);
  variants.push({
    url: src,
    type,
    width: parsePositiveInt(width),
    height: parsePositiveInt(height),
    bitrate: parsePositiveInt(bitrate)
  });
}

/**
 * A `blob:` source is X's MediaSource handle, not a file: it cannot be fetched or saved, so any
 * real URL beats it however low its bitrate. Ranking is only a preference here — when the blob is
 * the only variant it still wins, and callers that need a saveable target check {@link isSaveableVariantUrl}.
 */
export function isSaveableVariantUrl(url: string): boolean {
  return !/^blob:/i.test(url);
}

function pickPreferred(variants: VideoVariant[]): VideoVariant {
  const sorted = [...variants].sort((a, b) => {
    const saveableDiff = Number(isSaveableVariantUrl(b.url)) - Number(isSaveableVariantUrl(a.url));
    if (saveableDiff !== 0) {
      return saveableDiff;
    }
    const bitrateDiff = (b.bitrate ?? 0) - (a.bitrate ?? 0);
    if (bitrateDiff !== 0) {
      return bitrateDiff;
    }
    const aPixels = (a.width ?? 0) * (a.height ?? 0);
    const bPixels = (b.width ?? 0) * (b.height ?? 0);
    return bPixels - aPixels;
  });
  return sorted[0] ?? variants[0]!;
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
