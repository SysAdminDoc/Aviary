export interface VideoVariant {
  url: string;
  type: string;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

export interface ExtractedVideo {
  container: HTMLElement;
  poster: string | null;
  isGif: boolean;
  variants: VideoVariant[];
  preferred: VideoVariant | null;
}

const VIDEO_SELECTOR = '[data-testid="videoPlayer"], [data-testid="videoComponent"]';

export function extractVideos(article: Element): ExtractedVideo[] {
  const results: ExtractedVideo[] = [];
  for (const container of Array.from(article.querySelectorAll<HTMLElement>(VIDEO_SELECTOR))) {
    const extracted = extractVideo(container);
    if (extracted) {
      results.push(extracted);
    }
  }
  return results;
}

export function extractVideo(container: HTMLElement): ExtractedVideo | null {
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

  if (variants.length === 0) {
    return null;
  }

  const preferred = pickPreferred(variants);
  const poster = video.poster || null;
  const isGif = looksLikeGif(container, video, variants);

  return { container, poster, isGif, variants, preferred };
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

function pickPreferred(variants: VideoVariant[]): VideoVariant {
  const sorted = [...variants].sort((a, b) => {
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
