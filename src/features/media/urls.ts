export interface NormalizedImage {
  url: string;
  fallbackUrls: string[];
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
  const pathFormat = /\.([a-z0-9]+)$/i.exec(parsed.pathname)?.[1]?.toLowerCase() ?? "";
  const validatedPathFormat = pathFormat === "jpeg" ? "jpg" : pathFormat;
  const format = (FORMAT_PRIORITY as readonly string[]).includes(requestedFormat)
    ? (requestedFormat as NormalizedImage["format"])
    : (FORMAT_PRIORITY as readonly string[]).includes(validatedPathFormat)
      ? (validatedPathFormat as NormalizedImage["format"])
      : "jpg";

  params.set("format", format);
  const preferOriginal = options.preferOriginal ?? true;
  if (preferOriginal) {
    params.set("name", "orig");
  } else if (!params.has("name")) {
    params.set("name", "large");
  }

  const mediaId = mediaIdFromPath(parsed.pathname);
  const fallbackUrls: string[] = [];
  if (preferOriginal) {
    const fallbackParams = new URLSearchParams(params);
    fallbackParams.set("name", "4096x4096");
    fallbackUrls.push(`${parsed.origin}${parsed.pathname}?${fallbackParams.toString()}`);
  }
  return {
    url: `${parsed.origin}${parsed.pathname}?${params.toString()}`,
    fallbackUrls,
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
