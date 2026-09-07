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

export type MediaContextDownloadMessage = {
  type: typeof MEDIA_CONTEXT_DOWNLOAD_MESSAGE;
  documentUrl: string;
};

export type MediaContextPermissionDeniedMessage = {
  type: typeof MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE;
  documentUrl: string;
};

export function isMediaContextDownloadMessage(
  message: unknown,
  sender: unknown
): message is MediaContextDownloadMessage {
  return isContextMessage(message, MEDIA_CONTEXT_DOWNLOAD_MESSAGE, sender);
}

export function isMediaContextPermissionDeniedMessage(
  message: unknown,
  sender: unknown
): message is MediaContextPermissionDeniedMessage {
  return isContextMessage(message, MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE, sender);
}

export function isSupportedXDocumentUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "pro.x.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isContextMessage<T extends string>(
  message: unknown,
  type: T,
  sender: unknown
): message is { type: T; documentUrl: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    Object.keys(message).length === 2 &&
    Object.prototype.hasOwnProperty.call(message, "type") &&
    Object.prototype.hasOwnProperty.call(message, "documentUrl") &&
    (message as { type?: unknown }).type === type &&
    isSupportedXDocumentUrl((message as { documentUrl?: unknown }).documentUrl) &&
    isTrustedExtensionSender(sender)
  );
}

function isTrustedExtensionSender(sender: unknown): boolean {
  const extensionId = globalThis.chrome?.runtime?.id;
  return (
    typeof extensionId === "string" &&
    extensionId.length > 0 &&
    typeof sender === "object" &&
    sender !== null &&
    (sender as { id?: unknown }).id === extensionId
  );
}
