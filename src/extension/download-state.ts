/**
 * The message that carries a browser download's terminal state back to the tab that asked for it.
 *
 * `chrome.downloads.download()` resolves when the browser accepts the request, not when the file
 * is on disk. A transfer interrupted ten seconds later had already been reported as Saved, and had
 * already been written into the duplicate history -- so the retry the user then wanted was refused
 * as something already downloaded. Both sides of the extension agree on this shape so the tab can
 * wait for the real answer.
 */
export const DOWNLOAD_STATE_MESSAGE = "AVIARY_DOWNLOAD_STATE";

/**
 * A content page can outlive the service worker that accepted its download. This request lets it
 * reconcile a retained browser id before starting a retry, so a worker restart never creates a
 * second copy of a transfer that is still running or already complete.
 */
export const DOWNLOAD_QUERY_MESSAGE = "AVIARY_DOWNLOAD_QUERY";

export type DownloadTerminalState = "complete" | "interrupted";

export type DownloadQueryState = "in_progress" | DownloadTerminalState | "missing";

/**
 * A bounded, non-identifying description of the rendition that reached disk.
 *
 * `adaptive-remux` is the optional local helper's output: streams selected from an observed
 * adaptive manifest and muxed into one container. It is deliberately not `original` -- the
 * progressive file X served is a different file, and it stays available.
 */
export type DownloadQualityLabel =
  | "original"
  | "fallback"
  | "best-direct"
  | "adaptive-remux"
  | "quality-unknown";

/** Where a codec name came from. Absent means nothing declared one. */
export type DownloadCodecSource = "graphql-variant" | "source-element";

export interface DownloadQualityReceipt {
  label: DownloadQualityLabel;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  mime: string | null;
  /**
   * Codec evidence, kept apart from the measured fields above and from `playbackProven` below.
   * A declared codec is a claim about a stream: it is not a resolution, and X has shipped a named
   * AVC stream in a container the browser then refused. Reading these three as one number is how
   * a smaller file gets chosen because its codec happened to be named.
   */
  codec: string | null;
  codecSource: DownloadCodecSource | null;
  /** The browser decoded a frame from this exact URL before the download. Never inferred. */
  playbackProven: boolean;
}

export function unknownDownloadQuality(): DownloadQualityReceipt {
  return {
    label: "quality-unknown",
    width: null,
    height: null,
    bitrate: null,
    mime: null,
    codec: null,
    codecSource: null,
    playbackProven: false
  };
}

export function normalizeDownloadQuality(value: unknown): DownloadQualityReceipt {
  if (!value || typeof value !== "object") {
    return unknownDownloadQuality();
  }
  const candidate = value as Partial<DownloadQualityReceipt>;
  const label = candidate.label === "original" || candidate.label === "fallback" ||
    candidate.label === "best-direct" || candidate.label === "adaptive-remux" ||
    candidate.label === "quality-unknown"
    ? candidate.label
    : "quality-unknown";
  // A codec name with no recorded source is not evidence, so both fields fall together. History
  // written before codec evidence existed carries neither and stays codec-unknown.
  const codecSource = candidate.codecSource === "graphql-variant" || candidate.codecSource === "source-element"
    ? candidate.codecSource
    : null;
  const codec = codecSource !== null && typeof candidate.codec === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.codec.trim())
    ? candidate.codec.trim().toLowerCase()
    : null;
  return {
    label,
    width: boundedPositive(candidate.width, 20_000),
    height: boundedPositive(candidate.height, 20_000),
    bitrate: boundedPositive(candidate.bitrate, 1_000_000_000),
    mime: typeof candidate.mime === "string" && /^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/i.test(candidate.mime)
      ? candidate.mime.slice(0, 120).toLowerCase()
      : null,
    codec: codec === null ? null : codec,
    codecSource: codec === null ? null : codecSource,
    playbackProven: candidate.playbackProven === true
  };
}

/**
 * Accepts a receipt this build could have written, including one an older build wrote.
 *
 * The two copies of this check compared `JSON.stringify(normalize(value))` against
 * `JSON.stringify(value)`, so adding a field to the receipt made every message from a content
 * script that had not reloaded yet fail validation -- and a download silently produced no terminal
 * message at all. Comparing the keys the sender actually supplied keeps the point of the check,
 * which is that nothing was smuggled in and nothing the normalizer rejected was kept.
 */
export function isDownloadQualityReceipt(value: unknown): value is DownloadQualityReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const normalized = normalizeDownloadQuality(value) as unknown as Record<string, unknown>;
  for (const [key, provided] of Object.entries(value as Record<string, unknown>)) {
    if (!(key in normalized)) return false;
    if (provided !== normalized[key]) return false;
  }
  return true;
}

function boundedPositive(value: unknown, max: number): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? Math.round(number) : null;
}

export interface DownloadStateMessage {
  type: typeof DOWNLOAD_STATE_MESSAGE;
  /** The id the content script was given when the browser accepted the handoff. */
  id: number;
  state: DownloadTerminalState;
  error?: string;
  quality?: DownloadQualityReceipt;
}

export interface DownloadQueryMessage {
  type: typeof DOWNLOAD_QUERY_MESSAGE;
  id: number;
}

export type DownloadQueryResponse =
  | {
      ok: true;
      id: number;
      state: DownloadQueryState;
      error?: string;
      quality?: DownloadQualityReceipt;
    }
  | {
      ok: false;
      id: number;
      error: string;
    };

export function isDownloadStateMessage(value: unknown): value is DownloadStateMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    type?: unknown;
    id?: unknown;
    state?: unknown;
    error?: unknown;
    quality?: unknown;
  };
  return (
    candidate.type === DOWNLOAD_STATE_MESSAGE &&
    typeof candidate.id === "number" &&
    (candidate.state === "complete" || candidate.state === "interrupted") &&
    (candidate.error === undefined || typeof candidate.error === "string") &&
    (candidate.quality === undefined || isDownloadQualityReceipt(candidate.quality))
  );
}

export function isDownloadQueryMessage(value: unknown): value is DownloadQueryMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown; id?: unknown };
  return (
    candidate.type === DOWNLOAD_QUERY_MESSAGE &&
    typeof candidate.id === "number" &&
    Number.isSafeInteger(candidate.id) &&
    candidate.id >= 0
  );
}
