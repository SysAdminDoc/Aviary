import type { MediaSidecarFormat } from "../../platform/settings";

const MAX_SIDECAR_TEXT = 10_000;

export interface MediaSidecarInput {
  mediaFilename: string;
  kind: "photo" | "video" | "thumbnail";
  handle: string | null;
  tweetId: string | null;
  text: string;
  permalink: string | null;
  savedAt: string;
}

export interface MediaSidecarRequest extends MediaSidecarInput {
  format: Exclude<MediaSidecarFormat, "off">;
}

export interface MediaSidecarArtifact {
  filename: string;
  contentType: "application/json" | "text/plain";
  data: Uint8Array;
}

/** Builds a bounded companion file without contacting X or retaining a media delivery URL. */
export function buildMediaSidecar(
  format: MediaSidecarFormat,
  input: MediaSidecarInput
): MediaSidecarArtifact | null {
  if (format === "off") return null;
  const normalized = normalizeMediaSidecarInput(input);
  const extension = format === "json" ? "json" : "txt";
  const filename = replaceExtension(normalized.mediaFilename, extension);
  if (format === "json") {
    const payload = {
      schemaVersion: 1,
      savedAt: normalized.savedAt,
      post: {
        handle: normalized.handle,
        tweetId: normalized.tweetId,
        text: normalized.text,
        permalink: normalized.permalink
      },
      media: {
        kind: normalized.kind,
        filename: normalized.mediaFilename
      }
    };
    return {
      filename,
      contentType: "application/json",
      data: new TextEncoder().encode(`${JSON.stringify(payload, null, 2)}\n`)
    };
  }
  const lines = [
    `Saved: ${normalized.savedAt}`,
    `Account: ${normalized.handle ? `@${normalized.handle}` : "unknown"}`,
    `Post ID: ${normalized.tweetId ?? "unknown"}`,
    `Post: ${normalized.permalink ?? "unavailable"}`,
    `Media: ${normalized.kind} (${normalized.mediaFilename})`,
    "",
    normalized.text
  ];
  return {
    filename,
    contentType: "text/plain",
    data: new TextEncoder().encode(`${lines.join("\n")}\n`)
  };
}

export function mediaSidecarRequest(
  format: MediaSidecarFormat,
  input: MediaSidecarInput
): MediaSidecarRequest | undefined {
  if (format === "off") return undefined;
  return { format, ...normalizeMediaSidecarInput(input) };
}

export function normalizeMediaSidecarRequest(value: unknown): MediaSidecarRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<MediaSidecarRequest>;
  if (record.format !== "json" && record.format !== "text") return undefined;
  if (
    typeof record.mediaFilename !== "string" ||
    (record.kind !== "photo" && record.kind !== "video" && record.kind !== "thumbnail")
  ) {
    return undefined;
  }
  return {
    format: record.format,
    ...normalizeMediaSidecarInput({
      mediaFilename: record.mediaFilename,
      kind: record.kind,
      handle: typeof record.handle === "string" ? record.handle : null,
      tweetId: typeof record.tweetId === "string" ? record.tweetId : null,
      text: typeof record.text === "string" ? record.text : "",
      permalink: typeof record.permalink === "string" ? record.permalink : null,
      savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date().toISOString()
    })
  };
}

/** Starts the local companion-file save. Blob downloads do not require a network permission. */
export function saveMediaSidecar(request: MediaSidecarRequest | undefined): boolean {
  if (!request || typeof document === "undefined") return false;
  const artifact = buildMediaSidecar(request.format, request);
  if (!artifact) return false;
  try {
    const blob = new Blob([new Uint8Array(artifact.data)], { type: artifact.contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.filename;
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4_000);
    return true;
  } catch {
    return false;
  }
}

function normalizeMediaSidecarInput(input: MediaSidecarInput): MediaSidecarInput {
  return {
    mediaFilename: bounded(input.mediaFilename, 240) || "media",
    kind: input.kind,
    handle: nullable(input.handle, 80),
    tweetId: nullable(input.tweetId, 80),
    text: bounded(input.text, MAX_SIDECAR_TEXT),
    permalink: safePermalink(input.permalink),
    savedAt: validInstant(input.savedAt) ? input.savedAt : new Date().toISOString()
  };
}

function replaceExtension(filename: string, extension: string): string {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const dot = filename.lastIndexOf(".");
  const base = dot > slash ? filename.slice(0, dot) : filename;
  return `${base || "media"}.${extension}`;
}

function safePermalink(value: string | null): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function bounded(value: string, max: number): string {
  return String(value ?? "").normalize("NFC").slice(0, max);
}

function nullable(value: string | null, max: number): string | null {
  const normalized = value === null ? "" : bounded(value, max).trim();
  return normalized || null;
}

function validInstant(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
