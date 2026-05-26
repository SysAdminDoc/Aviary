import { normalizeImageUrl, tweetIdFromHref, type NormalizedImage } from "./urls";
import { extractVideos, type ExtractedVideo } from "./video-extract";

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

export function extractTweet(article: Element): ExtractedTweet {
  const tweetId = readTweetId(article);
  const handle = readHandle(article);
  const text = readText(article);
  const media: ExtractedMedia[] = [];

  for (const img of Array.from(
    article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img')
  )) {
    const normalized = normalizeImageUrl(img.src);
    if (normalized) {
      media.push({ kind: "photo", source: img, image: normalized });
    }
  }

  for (const video of extractVideos(article)) {
    if (video.preferred) {
      media.push({ kind: "video", source: video.container, video });
    }
    if (video.poster) {
      const normalized = normalizeImageUrl(video.poster);
      if (normalized) {
        const fake = document.createElement("img");
        fake.src = video.poster;
        media.push({ kind: "thumbnail", source: fake, image: normalized });
      }
    }
  }

  return { article, tweetId, handle, text, media };
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
