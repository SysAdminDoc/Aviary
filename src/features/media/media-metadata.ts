import {
  mergeVideoVariant,
  mergeVideoVariants,
  type SubtitleTrack,
  type VideoVariant
} from "./video-extract.ts";

export interface CapturedMediaMetadata {
  tweetId: string | null;
  mediaId: string | null;
  poster: string | null;
  variants: VideoVariant[];
  audioVariants: VideoVariant[];
  subtitleTracks: SubtitleTrack[];
  isGif: boolean;
}

/**
 * Extracted media-only observations. The response body is parsed and discarded by this function;
 * callers receive only the direct media URLs and the small amount of rendition metadata needed by
 * the download controls.
 */
export function extractMediaMetadata(payload: unknown): CapturedMediaMetadata[] {
  const body = readBody(payload);
  if (!body || body.length === 0 || body.length > MAX_BODY_CHARS) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const found: CapturedMediaMetadata[] = [];
  const state = { nodes: 0 };
  collectMetadata(parsed, null, 0, state, found);
  return found.map(cloneMetadata);
}

interface MetadataPayload {
  body?: unknown;
}

const MAX_BODY_CHARS = 1_500_000;
const MAX_ENTRIES = 256;
const MAX_NODES = 50_000;
const MAX_DEPTH = 32;
const MEDIA_URL_PATTERN = /\/media\/([A-Za-z0-9_-]+)/i;

/**
 * Keeps the small part of X's GraphQL responses that the DOM player cannot expose.
 *
 * X's timeline video is normally backed by a MediaSource `blob:` URL. The response that created
 * the player still contains a preview image and direct `video_info.variants`, so retaining only
 * those fields gives the media controls a useful target without retaining an authenticated
 * response body or growing with the user's browsing session.
 */
export class MediaMetadataCache {
  #entries = new Map<string, CapturedMediaMetadata>();
  #version = 0;

  get version(): number {
    return this.#version;
  }

  get size(): number {
    return this.#entries.size;
  }

  ingest(payload: unknown): number {
    return this.ingestMetadata(extractMediaMetadata(payload));
  }

  ingestMetadata(found: readonly CapturedMediaMetadata[]): number {
    let changed = 0;
    for (const metadata of found) {
      if (upsert(this.#entries, metadata)) {
        changed += 1;
        this.#version += 1;
      }
    }
    while (this.#entries.size > MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.#entries.delete(oldest);
    }
    return changed;
  }

  find(
    tweetId: string | null,
    mediaId: string | null = null,
    poster: string | null = null
  ): CapturedMediaMetadata | null {
    const wantedTweet = cleanId(tweetId);
    const wantedMedia = cleanId(mediaId) ?? mediaIdFromUrl(poster);
    const wantedPoster = cleanUrl(poster);

    let winner: CapturedMediaMetadata | null = null;
    let winnerScore = 0;
    let tied = false;

    for (const entry of this.#entries.values()) {
      let score = 0;
      if (wantedTweet && entry.tweetId === wantedTweet) {
        score += 4;
      } else if (wantedTweet && entry.tweetId) {
        continue;
      }
      if (wantedMedia) {
        const mediaMatches =
          entry.mediaId === wantedMedia || mediaIdFromUrl(entry.poster) === wantedMedia;
        if (!mediaMatches && (!wantedPoster || cleanUrl(entry.poster) !== wantedPoster)) {
          continue;
        }
        if (mediaMatches) {
          score += 8;
        }
      }
      if (wantedPoster && cleanUrl(entry.poster) === wantedPoster) {
        score += 6;
      } else if (wantedMedia && mediaIdFromUrl(entry.poster) === wantedMedia) {
        score += 3;
      }
      if (score === 0 || score < winnerScore) {
        continue;
      }
      if (score === winnerScore) {
        tied = true;
        continue;
      }
      winner = entry;
      winnerScore = score;
      tied = false;
    }

    // If an article cannot identify which of several media items it contains, do not attach one
    // item's MP4 to another item's player. A single tweet/media match is safe; an ambiguous one
    // is intentionally treated like a cache miss.
    return winner && !tied ? cloneMetadata(winner) : null;
  }

  clear(): void {
    this.#entries.clear();
    this.#version += 1;
  }
}

/** Stable identity used by bounded replay and cache merging. */
export function mediaMetadataIdentity(metadata: CapturedMediaMetadata): string {
  const identity = [
    metadata.tweetId,
    metadata.mediaId,
    mediaIdFromUrl(metadata.poster),
    metadata.poster
  ].filter(Boolean);
  if (identity.length === 0) {
    identity.push(metadata.variants[0]?.url ?? metadata.audioVariants[0]?.url ?? "unknown");
  }
  return JSON.stringify(identity);
}

/** Merges repeated observations without retaining the response that carried them. */
export function mergeMediaMetadata(
  existing: CapturedMediaMetadata,
  incoming: CapturedMediaMetadata
): CapturedMediaMetadata {
  return mergeMetadata(existing, incoming);
}

export function mediaIdFromUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  return MEDIA_URL_PATTERN.exec(url)?.[1] ?? null;
}

function readBody(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const body = (payload as MetadataPayload).body;
  return typeof body === "string" ? body : null;
}

function collectMetadata(
  value: unknown,
  inheritedTweetId: string | null,
  depth: number,
  state: { nodes: number },
  found: CapturedMediaMetadata[]
): void {
  if (depth > MAX_DEPTH || state.nodes >= MAX_NODES || !value || typeof value !== "object") {
    return;
  }
  state.nodes += 1;

  if (Array.isArray(value)) {
    for (const child of value) {
      collectMetadata(child, inheritedTweetId, depth + 1, state, found);
      if (state.nodes >= MAX_NODES) {
        return;
      }
    }
    return;
  }

  const record = value as Record<string, unknown>;
  const tweetId = isMediaRecord(record) ? inheritedTweetId : readTweetId(record) ?? inheritedTweetId;
  if (isMediaRecord(record)) {
    const metadata = readMediaMetadata(record, tweetId);
    if (metadata) {
      found.push(metadata);
    }
  }

  for (const child of Object.values(record)) {
    collectMetadata(child, tweetId, depth + 1, state, found);
    if (state.nodes >= MAX_NODES) {
      return;
    }
  }
}

function readTweetId(record: Record<string, unknown>): string | null {
  const restId = cleanId(record.rest_id);
  if (restId && looksLikeTweet(record)) {
    return restId;
  }
  const id = cleanId(record.id_str);
  return id && looksLikeTweet(record) ? id : null;
}

function looksLikeTweet(record: Record<string, unknown>): boolean {
  return (
    "legacy" in record ||
    "core" in record ||
    "conversation_id_str" in record ||
    "full_text" in record ||
    "note_tweet" in record ||
    "quoted_status_result" in record
  );
}

function isMediaRecord(record: Record<string, unknown>): boolean {
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  return (
    type === "video" ||
    type === "animated_gif" ||
    isRecord(record.video_info) ||
    (Boolean(record.preview_image_url || record.preview_image_url_https) &&
      (type.includes("video") || type.includes("gif")))
  );
}

function readMediaMetadata(
  record: Record<string, unknown>,
  tweetId: string | null
): CapturedMediaMetadata | null {
  const videoInfo = isRecord(record.video_info) ? record.video_info : {};
  const allVariants = readVariants(videoInfo.variants);
  const audioVariants = allVariants.filter(isAudioVariant);
  const variants = allVariants.filter((variant) => !isAudioVariant(variant));
  const subtitleTracks = readSubtitleTracks(record, videoInfo);
  const poster = firstUrl(
    record.preview_image_url_https,
    record.preview_image_url,
    record.media_url_https,
    record.media_url
  );
  const mediaId =
    (poster ? mediaIdFromUrl(poster) : null) ??
    cleanId(record.media_key) ??
    cleanId(record.media_id_string) ??
    cleanId(record.media_id);
  const isGif =
    record.type === "animated_gif" ||
    record.is_gif === true ||
    variants.some((variant) => variant.url.toLowerCase().includes("tweet_video"));

  if (!poster && variants.length === 0 && audioVariants.length === 0 && subtitleTracks.length === 0) {
    return null;
  }
  return { tweetId, mediaId, poster, variants, audioVariants, subtitleTracks, isGif };
}

function readVariants(value: unknown): VideoVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const variants: VideoVariant[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const url = httpUrl(entry.url);
    if (!url) {
      continue;
    }
    const candidate: VideoVariant = {
      url,
      type: typeof entry.content_type === "string" ? entry.content_type : "video/mp4",
      width: positiveNumber(entry.width) ?? dimensionsFromUrl(url)?.width ?? null,
      height: positiveNumber(entry.height) ?? dimensionsFromUrl(url)?.height ?? null,
      bitrate: positiveNumber(entry.bitrate) ?? positiveNumber(entry.bit_rate) ?? null
    };
    if (typeof entry.codec === "string" && entry.codec.trim()) {
      candidate.codec = entry.codec.trim();
    }
    if (typeof entry.provenance === "string" && entry.provenance.trim()) {
      candidate.provenance = entry.provenance.trim();
    }
    const existingIndex = variants.findIndex((variant) => variant.url === url);
    if (existingIndex < 0) {
      variants.push(candidate);
    } else {
      variants[existingIndex] = mergeVideoVariant(variants[existingIndex]!, candidate);
    }
  }
  return mergeVideoVariants([], variants);
}

function isAudioVariant(variant: VideoVariant): boolean {
  return /^audio\//i.test(variant.type) || /\.(?:aac|m4a|mp3|ogg|opus|wav)(?:[?#]|$)/i.test(variant.url);
}

function readSubtitleTracks(...values: unknown[]): SubtitleTrack[] {
  const found = new Map<string, SubtitleTrack>();
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || !value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    const url = firstUrl(record.url, record.src, record.source_url, record.href);
    if (url && isSubtitleUrl(url, type)) {
      found.set(url, {
        url,
        type: type.includes("/") ? type : subtitleType(url),
        language: cleanOptional(record.language ?? record.lang ?? record.srclang),
        label: cleanOptional(record.label ?? record.name ?? record.title)
      });
    }
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  for (const value of values) visit(value, 0);
  return [...found.values()].slice(0, 8);
}

function isSubtitleUrl(url: string, type: string): boolean {
  return /(?:text\/vtt|text\/srt|application\/ttml|caption|subtitle)/i.test(type) ||
    /\.(?:vtt|srt|ttml|dfxp)(?:[?#]|$)/i.test(url);
}

function subtitleType(url: string): string {
  if (/\.(?:srt)(?:[?#]|$)/i.test(url)) return "text/srt";
  if (/\.(?:ttml|dfxp)(?:[?#]|$)/i.test(url)) return "application/ttml+xml";
  return "text/vtt";
}

function cleanOptional(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 80) : null;
}

function upsert(entries: Map<string, CapturedMediaMetadata>, incoming: CapturedMediaMetadata): boolean {
  const existingKey = findExistingKey(entries, incoming);
  if (!existingKey) {
    entries.set(metadataKey(incoming), cloneMetadata(incoming));
    return true;
  }

  const existing = entries.get(existingKey)!;
  const merged = mergeMetadata(existing, incoming);
  if (!metadataEqual(existing, merged)) {
    entries.delete(existingKey);
    entries.set(metadataKey(merged), merged);
    return true;
  }
  // Touch the entry so frequently seen timeline responses remain in the bounded cache.
  entries.delete(existingKey);
  entries.set(existingKey, existing);
  return false;
}

function findExistingKey(
  entries: Map<string, CapturedMediaMetadata>,
  incoming: CapturedMediaMetadata
): string | null {
  const incomingPosterId = mediaIdFromUrl(incoming.poster);
  for (const [key, entry] of entries) {
    if (incoming.mediaId && entry.mediaId === incoming.mediaId) {
      return key;
    }
    if (incomingPosterId && mediaIdFromUrl(entry.poster) === incomingPosterId) {
      return key;
    }
    if (
      incoming.tweetId &&
      entry.tweetId === incoming.tweetId &&
      incoming.poster &&
      entry.poster === incoming.poster
    ) {
      return key;
    }
  }
  return null;
}

function mergeMetadata(
  existing: CapturedMediaMetadata,
  incoming: CapturedMediaMetadata
): CapturedMediaMetadata {
  const variants = mergeVideoVariants(existing.variants, incoming.variants);
  const audioVariants = mergeVideoVariants(existing.audioVariants, incoming.audioVariants);
  const subtitleTracks = [...existing.subtitleTracks];
  const seenTracks = new Set(subtitleTracks.map((track) => track.url));
  for (const track of incoming.subtitleTracks) {
    if (!seenTracks.has(track.url)) {
      subtitleTracks.push(track);
      seenTracks.add(track.url);
    }
  }
  return {
    tweetId: existing.tweetId ?? incoming.tweetId,
    mediaId: existing.mediaId ?? incoming.mediaId,
    poster: existing.poster ?? incoming.poster,
    variants,
    audioVariants,
    subtitleTracks,
    isGif: existing.isGif || incoming.isGif
  };
}

function metadataEqual(a: CapturedMediaMetadata, b: CapturedMediaMetadata): boolean {
  return (
    a.tweetId === b.tweetId &&
    a.mediaId === b.mediaId &&
    a.poster === b.poster &&
    a.isGif === b.isGif &&
    a.variants.length === b.variants.length &&
    a.variants.every((variant, index) => {
      const other = b.variants[index];
      return (
        other !== undefined && videoVariantEqual(variant, other)
      );
    }) &&
    a.audioVariants.length === b.audioVariants.length &&
    a.audioVariants.every((variant, index) => {
      const other = b.audioVariants[index];
      return (
        other !== undefined && videoVariantEqual(variant, other)
      );
    }) &&
    a.subtitleTracks.length === b.subtitleTracks.length &&
    a.subtitleTracks.every((track, index) => {
      const other = b.subtitleTracks[index];
      return (
        track.url === other?.url &&
        track.type === other.type &&
        track.language === other.language &&
        track.label === other.label
      );
    })
  );
}

function videoVariantEqual(left: VideoVariant, right: VideoVariant): boolean {
  return (
    left.url === right.url &&
    left.type === right.type &&
    left.width === right.width &&
    left.height === right.height &&
    left.bitrate === right.bitrate &&
    left.codec === right.codec &&
    left.provenance === right.provenance
  );
}

function metadataKey(metadata: CapturedMediaMetadata): string {
  return (
    [
      metadata.tweetId,
      metadata.mediaId,
      mediaIdFromUrl(metadata.poster),
      metadata.poster,
      metadata.variants[0]?.url
    ]
      .filter(Boolean)
      .join(":") || "unknown"
  );
}

function cloneMetadata(metadata: CapturedMediaMetadata): CapturedMediaMetadata {
  return {
    ...metadata,
    variants: metadata.variants.map((variant) => ({ ...variant })),
    audioVariants: metadata.audioVariants.map((variant) => ({ ...variant })),
    subtitleTracks: metadata.subtitleTracks.map((track) => ({ ...track }))
  };
}

function firstUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const url = httpUrl(value);
    if (url) {
      return url;
    }
  }
  return null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) {
    return null;
  }
  return value;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const result = String(value).trim();
  return result.length > 0 ? result : null;
}

function cleanUrl(value: string | null | undefined): string | null {
  return httpUrl(value);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function dimensionsFromUrl(url: string): { width: number; height: number } | null {
  const match = /\/(\d{2,5})x(\d{2,5})\//.exec(url);
  if (!match) {
    return null;
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
