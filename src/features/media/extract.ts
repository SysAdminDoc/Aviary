import { normalizeImageUrl, tweetIdFromHref, type NormalizedImage } from "./urls";
import type { CapturedMediaMetadata } from "./media-metadata";
import {
  extractVideo,
  VIDEO_CONTAINER_SELECTOR,
  type ExtractedVideo
} from "./video-extract";

export interface ExtractedMedia {
  kind: "photo" | "thumbnail" | "video";
  source: HTMLElement;
  image?: NormalizedImage;
  video?: ExtractedVideo;
}

export interface ExtractedTweet {
  article: Element;
  tweetId: string | null;
  handle: string | null;
  text: string;
  media: ExtractedMedia[];
}

export interface ExtractTweetOptions {
  /** Mirrors `settings.media.preferOriginalImages`; defaults to the original-quality rewrite. */
  preferOriginalImages?: boolean;
  /** Resolves page-world media metadata for a DOM player backed by a `blob:` URL. */
  mediaMetadata?: (args: {
    tweetId: string | null;
    mediaId: string | null;
    poster: string | null;
  }) => CapturedMediaMetadata | null;
}

export function extractTweet(article: Element, options: ExtractTweetOptions = {}): ExtractedTweet {
  const tweetId = readTweetId(article);
  const handle = readHandle(article);
  const text = readText(article);
  const media: ExtractedMedia[] = [];
  const imageOptions = { preferOriginal: options.preferOriginalImages ?? true };

  for (const img of Array.from(
    article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img')
  )) {
    const normalized = normalizeImageUrl(img.src, imageOptions);
    if (normalized) {
      media.push({ kind: "photo", source: img, image: normalized });
    }
  }

  for (const container of Array.from(
    article.querySelectorAll<HTMLElement>(VIDEO_CONTAINER_SELECTOR)
  )) {
    const localPoster = container.querySelector<HTMLVideoElement>("video")?.poster || null;
    const captured = options.mediaMetadata?.({
      tweetId,
      mediaId: mediaIdFromUrl(localPoster),
      poster: localPoster
    });
    const video = extractVideo(container, captured ?? undefined);
    if (!video) {
      continue;
    }
    if (video.preferred) {
      media.push({ kind: "video", source: video.container, video });
    }
    if (video.poster) {
      const normalized = normalizeImageUrl(video.poster, imageOptions);
      if (normalized) {
        // Keep the player in the document as the placement anchor. A detached fake image has no
        // tweetPhoto ancestor, so media-buttons cannot attach the promised Thumb control to it.
        media.push({ kind: "thumbnail", source: video.container, image: normalized });
      }
    }
  }

  return { article, tweetId, handle, text, media };
}

function mediaIdFromUrl(url: string | null): string | null {
  return /\/media\/([A-Za-z0-9_-]+)/i.exec(url ?? "")?.[1] ?? null;
}

function readTweetId(article: Element): string | null {
  const links = article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
  for (const link of Array.from(links)) {
    const candidate = tweetIdFromHref(link.getAttribute("href"));
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function readHandle(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  const links = userName?.querySelectorAll('a[href^="/"]') ?? [];
  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") ?? "";
    const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
    const candidate = match?.[1];
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function readText(article: Element): string {
  const text = article.querySelector('[data-testid="tweetText"]');
  return text?.textContent?.trim() ?? "";
}
