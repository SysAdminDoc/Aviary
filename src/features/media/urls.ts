export interface NormalizedImage {
  url: string;
  format: "jpg" | "png" | "webp";
  mediaId: string | null;
}

const IMAGE_HOST = "pbs.twimg.com";
const FORMAT_PRIORITY = ["jpg", "png", "webp"] as const;

export interface NormalizeImageOptions {
  /** When false the served size is kept instead of being upgraded to `name=orig`. */
  preferOriginal?: boolean;
}

export function normalizeImageUrl(
  rawUrl: string,
  options: NormalizeImageOptions = {}
): NormalizedImage | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, "https://x.com");
  } catch {
    return null;
  }

  if (parsed.hostname !== IMAGE_HOST) {
    return null;
  }
  if (!parsed.pathname.startsWith("/media/")) {
    return null;
  }

  const params = parsed.searchParams;
  const requestedFormat = (params.get("format") ?? "").toLowerCase();
  const format = (FORMAT_PRIORITY as readonly string[]).includes(requestedFormat)
    ? (requestedFormat as NormalizedImage["format"])
    : "jpg";

  params.set("format", format);
  if (options.preferOriginal ?? true) {
    params.set("name", "orig");
  } else if (!params.has("name")) {
    params.set("name", "large");
  }

  const mediaId = mediaIdFromPath(parsed.pathname);
  return {
    url: `${parsed.origin}${parsed.pathname}?${params.toString()}`,
    format,
    mediaId
  };
}

export function mediaIdFromPath(pathname: string): string | null {
  const match = /\/media\/([A-Za-z0-9_-]{6,})(?:\.[A-Za-z0-9]+)?$/.exec(pathname);
  return match?.[1] ?? null;
}

export function tweetIdFromHref(href: string | null | undefined): string | null {
  if (!href) {
    return null;
  }
  const match = /\/status(?:es)?\/(\d{6,})/.exec(href);
  return match?.[1] ?? null;
}

export function extensionFor(format: NormalizedImage["format"]): string {
  return format;
}
