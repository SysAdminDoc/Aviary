export const MEDIA_CONTEXT_MENU_ID = "aviary-download-media";
export const MEDIA_CONTEXT_MENU_TITLE = "Download media with Aviary";

export const MEDIA_CONTEXT_DOWNLOAD_MESSAGE = "AVIARY_DOWNLOAD_CONTEXT_MEDIA";
export const MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE =
  "AVIARY_CONTEXT_DOWNLOAD_PERMISSION_DENIED";

export const X_DOCUMENT_PATTERNS = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://pro.x.com/*",
] as const;

export function isMediaContextDownloadMessage(
  message: unknown
): message is { type: typeof MEDIA_CONTEXT_DOWNLOAD_MESSAGE } {
  return isType(message, MEDIA_CONTEXT_DOWNLOAD_MESSAGE);
}

export function isMediaContextPermissionDeniedMessage(
  message: unknown
): message is { type: typeof MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE } {
  return isType(message, MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE);
}

function isType<T extends string>(message: unknown, type: T): message is { type: T } {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === type
  );
}
