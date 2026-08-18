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

export type DownloadTerminalState = "complete" | "interrupted";

export interface DownloadStateMessage {
  type: typeof DOWNLOAD_STATE_MESSAGE;
  /** The id the content script was given when the browser accepted the handoff. */
  id: number;
  state: DownloadTerminalState;
  error?: string;
}

export function isDownloadStateMessage(value: unknown): value is DownloadStateMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown; id?: unknown; state?: unknown; error?: unknown };
  return (
    candidate.type === DOWNLOAD_STATE_MESSAGE &&
    typeof candidate.id === "number" &&
    (candidate.state === "complete" || candidate.state === "interrupted") &&
    (candidate.error === undefined || typeof candidate.error === "string")
  );
}
