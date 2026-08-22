import { normalizeImageUrl, tweetIdFromHref, type NormalizedImage } from "./urls.ts";
import type { CapturedMediaMetadata } from "./media-metadata.ts";
import {
  extractVideo,
  videoContainers,
  type ExtractedVideo,
  type SubtitleTrack,
  type VideoVariant
} from "./video-extract.ts";

export interface ExtractedAudio {
  container: HTMLElement;
  variants: VideoVariant[];
  preferred: VideoVariant | null;
}

export interface ExtractedSubtitle {
  container: HTMLElement;
  track: SubtitleTrack;
}

export interface ExtractedMedia {
  kind: "photo" | "thumbnail" | "video" | "audio" | "subtitle";
  source: HTMLElement;
  image?: NormalizedImage;
  video?: ExtractedVideo;
  audio?: ExtractedAudio;
  subtitle?: ExtractedSubtitle;
  /** Whose media this actually is. Not always the post it was found in. */
  owner: MediaOwner;
}

/**
 * Where a piece of media inside an `article` really came from.
 *
 * A timeline post can carry three kinds of media in one subtree: its own, a quoted post's, and a
 * link card's. Everything here walked the whole article and assigned all of it to the outer post,
 * so saving a photo out of a quote wrote it under the quoting account's handle -- the exact
 * complaint filed against every feed downloader in this lineage.
 */
export type MediaScope = "post" | "quote" | "card";

export interface MediaOwner {
  scope: MediaScope;
  tweetId: string | null;
  handle: string | null;
  text: string;
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

/**
 * A quoted post inside another post.
 *
 * X has shipped three shapes for this and still renders more than one: the named test id, the
 * labelled region, and -- most commonly on current Home -- a focusable `div[role="link"]` with no
 * test id at all, identified by the fact that it carries a second author header. The bare
 * `role="link"` form needs that second test, because X uses the role widely for things that are
 * not quotes.
 */
export const QUOTE_BOUNDARY_SELECTOR =
  '[data-testid="quoteTweet"], [aria-labelledby="quoted"], div[role="link"][tabindex="0"]';

/** A link preview. Its media belongs to the page linked, not to the post or its author. */
export const CARD_BOUNDARY_SELECTOR = '[data-testid="card.wrapper"]';

/** The quoted post an article carries, if it carries one. */
export function quotedPost(article: Element): Element | null {
  for (const candidate of Array.from(article.querySelectorAll(QUOTE_BOUNDARY_SELECTOR))) {
    if (isQuoteBoundary(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function extractTweet(article: Element, options: ExtractTweetOptions = {}): ExtractedTweet {
  const tweetId = readTweetId(article);
  const handle = readHandle(article);
  const text = readText(article);
  const own: MediaOwner = { scope: "post", tweetId, handle, text };
  const media: ExtractedMedia[] = [];
  const imageOptions = { preferOriginal: options.preferOriginalImages ?? true };

  for (const img of Array.from(
    article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img')
  )) {
    const normalized = normalizeImageUrl(img.src, imageOptions);
    if (normalized) {
      media.push({ kind: "photo", source: img, image: normalized, owner: ownerOf(article, img, own) });
    }
  }

  for (const container of videoContainers(article)) {
    const localPoster = container.querySelector<HTMLVideoElement>("video")?.poster || null;
    const owner = ownerOf(article, container, own);
    const captured = options.mediaMetadata?.({
      // A quoted player's poster belongs to the quoted post, so filtering the lookup by the
      // outer post's id would rule out the only entry that can match it.
      tweetId: owner.scope === "post" ? tweetId : owner.tweetId,
      mediaId: mediaIdFromUrl(localPoster),
      poster: localPoster
    });
    const video = extractVideo(container, captured ?? undefined);
    if (!video) {
      continue;
    }
    // A captured record knows the id of the post it came from, which is how a quoted video gets
    // an identity the DOM never renders: X makes the whole quote card the link rather than
    // giving the quoted post a permalink of its own.
    const resolved =
      owner.scope === "quote" && !owner.tweetId && captured?.tweetId
        ? { ...owner, tweetId: captured.tweetId }
        : owner;
    if (video.preferred) {
      media.push({ kind: "video", source: video.container, video, owner: resolved });
    }
    const audio = preferredAudio(video.audioVariants);
    if (audio) {
      media.push({
        kind: "audio",
        source: video.container,
        audio: { container: video.container, variants: video.audioVariants, preferred: audio },
        owner: resolved
      });
    }
    for (const track of video.subtitleTracks) {
      media.push({
        kind: "subtitle",
        source: video.container,
        subtitle: { container: video.container, track },
        owner: resolved
      });
    }
    if (video.poster) {
      const normalized = normalizeImageUrl(video.poster, imageOptions);
      if (normalized) {
        // Keep the player in the document as the placement anchor. A detached fake image has no
        // tweetPhoto ancestor, so media-buttons cannot attach the promised Thumb control to it.
        media.push({ kind: "thumbnail", source: video.container, image: normalized, owner: resolved });
      }
    }
  }

  for (const audio of Array.from(article.querySelectorAll<HTMLAudioElement>("audio"))) {
    const owner = ownerOf(article, audio, own);
    const variants = readAudioVariants(audio);
    const preferred = preferredAudio(variants);
    if (preferred) {
      media.push({ kind: "audio", source: audio, audio: { container: audio, variants, preferred }, owner });
    }
    for (const track of Array.from(audio.querySelectorAll<HTMLTrackElement>("track"))) {
      const subtitle = readSubtitleTrack(track);
      if (subtitle) {
        media.push({ kind: "subtitle", source: audio, subtitle: { container: audio, track: subtitle }, owner });
      }
    }
  }

  return { article, tweetId, handle, text, media };
}

function readAudioVariants(audio: HTMLAudioElement): VideoVariant[] {
  const variants: VideoVariant[] = [];
  const seen = new Set<string>();
  const push = (url: string, type: string, bitrate?: string): void => {
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    variants.push({
      url,
      type: type || "audio/mp4",
      width: null,
      height: null,
      bitrate: bitrate && Number.isFinite(Number(bitrate)) ? Number(bitrate) : null
    });
  };
  if (audio.currentSrc) push(audio.currentSrc, audio.dataset.contentType ?? "audio/mp4");
  if (audio.src) push(audio.src, audio.dataset.contentType ?? "audio/mp4");
  for (const source of Array.from(audio.querySelectorAll<HTMLSourceElement>("source"))) {
    push(source.src, source.type || "audio/mp4", source.dataset.bitrate);
  }
  return variants;
}

function preferredAudio(variants: VideoVariant[]): VideoVariant | null {
  return [...variants].sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0))[0] ?? null;
}

function readSubtitleTrack(track: HTMLTrackElement): SubtitleTrack | null {
  const url = track.src || track.getAttribute("src") || "";
  if (!/^https?:\/\//i.test(url)) return null;
  const kind = (track.kind || "").toLowerCase();
  if (kind && kind !== "subtitles" && kind !== "captions") return null;
  return {
    url,
    type: track.getAttribute("type") || "text/vtt",
    language: track.srclang?.trim() || null,
    label: track.label?.trim() || null
  };
}

/**
 * The identity a save should be filed under.
 *
 * The handle is the ownership claim and always comes from the owner. The id often cannot: X
 * renders no permalink inside a quote card, so where nothing -- neither the DOM nor a captured
 * record -- supplies the quoted post's own id, the containing post's id stands in as the record
 * of where the asset was found. That keeps names unique without ever attributing the media to the
 * wrong account.
 */
export function mediaIdentity(
  tweet: ExtractedTweet,
  media: ExtractedMedia
): { handle: string | null; tweetId: string | null; text: string } {
  const owner = media.owner;
  if (owner.scope === "post") {
    return { handle: tweet.handle, tweetId: tweet.tweetId, text: tweet.text };
  }
  return {
    handle: owner.handle ?? tweet.handle,
    tweetId: owner.tweetId ?? tweet.tweetId,
    text: owner.text
  };
}

function isQuoteBoundary(element: Element): boolean {
  if (element.matches('[data-testid="quoteTweet"], [aria-labelledby="quoted"]')) {
    return true;
  }
  return (
    element.matches('div[role="link"][tabindex="0"]') &&
    element.querySelector('[data-testid="User-Name"]') !== null
  );
}

/**
 * The outermost quote or card between `node` and its article.
 *
 * Outermost, not nearest: a link card inside a quoted post belongs to the quoted post's author,
 * and stopping at the card would file it under whoever quoted them.
 */
function boundaryFor(
  article: Element,
  node: Element
): { element: Element; scope: MediaScope } | null {
  let found: { element: Element; scope: MediaScope } | null = null;
  let current: Element | null = node;
  while (current && current !== article) {
    if (isQuoteBoundary(current)) {
      found = { element: current, scope: "quote" };
    } else if (!found && current.matches(CARD_BOUNDARY_SELECTOR)) {
      found = { element: current, scope: "card" };
    }
    current = current.parentElement;
  }
  return found;
}

function ownerOf(article: Element, node: Element, own: MediaOwner): MediaOwner {
  const boundary = boundaryFor(article, node);
  if (!boundary) {
    return own;
  }
  if (boundary.scope === "card") {
    // The post's author did attach the link, so the post's identity is the right one to file it
    // under. What is wrong is treating it as the post's own media, which is what the scope says.
    return { ...own, scope: "card" };
  }
  return {
    scope: "quote",
    tweetId: readTweetId(boundary.element, false),
    handle: readHandle(boundary.element, false),
    text: readText(boundary.element, false)
  };
}

function mediaIdFromUrl(url: string | null): string | null {
  return /\/media\/([A-Za-z0-9_-]+)/i.exec(url ?? "")?.[1] ?? null;
}

/**
 * `skipNested` keeps an article's own identity out of the quote it carries.
 *
 * Reading the first `/status/` link in the whole subtree meant a post with no permalink of its
 * own -- a reply shell still building, or a card-only post -- adopted the quoted post's id.
 */
function readTweetId(article: Element, skipNested = true): string | null {
  const links = article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]');
  for (const link of Array.from(links)) {
    if (skipNested && boundaryFor(article, link)) {
      continue;
    }
    const candidate = tweetIdFromHref(link.getAttribute("href"));
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function readHandle(article: Element, skipNested = true): string | null {
  const userNames = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
  for (const userName of userNames) {
    if (skipNested && boundaryFor(article, userName)) {
      continue;
    }
    for (const link of Array.from(userName.querySelectorAll('a[href^="/"]'))) {
      const href = link.getAttribute("href") ?? "";
      const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
      const candidate = match?.[1];
      if (candidate) {
        return candidate;
      }
    }
  }
  return null;
}

function readText(article: Element, skipNested = true): string {
  for (const node of Array.from(article.querySelectorAll('[data-testid="tweetText"]'))) {
    if (skipNested && boundaryFor(article, node)) {
      continue;
    }
    return node.textContent?.trim() ?? "";
  }
  return "";
}
