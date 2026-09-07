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

export interface DownloadStateMessage {
  type: typeof DOWNLOAD_STATE_MESSAGE;
  /** The id the content script was given when the browser accepted the handoff. */
  id: number;
  state: DownloadTerminalState;
  error?: string;
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
  const candidate = value as { type?: unknown; id?: unknown; state?: unknown; error?: unknown };
  return (
    candidate.type === DOWNLOAD_STATE_MESSAGE &&
    typeof candidate.id === "number" &&
    (candidate.state === "complete" || candidate.state === "interrupted") &&
    (candidate.error === undefined || typeof candidate.error === "string")
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
