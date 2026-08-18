import {
  isAdRuleSyncMessage,
  restoreDynamicAdRule,
  syncDynamicAdRule,
  type ExtensionAdRuleApi
} from "../extension/ad-rule";
import { DOWNLOAD_STATE_MESSAGE } from "../extension/download-state";
import {
  MEDIA_CONTEXT_DOWNLOAD_MESSAGE,
  MEDIA_CONTEXT_MENU_ID,
  MEDIA_CONTEXT_MENU_TITLE,
  MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE,
  X_DOCUMENT_PATTERNS
} from "../extension/media-context-menu";

const runtime = globalThis.chrome?.runtime;
const extensionApi = globalThis.chrome as unknown as ExtensionAdRuleApi | undefined;
const contextMenus = globalThis.chrome?.contextMenus;
const DOWNLOAD_TRACKING_KEY = "aviary.downloadTracking.v2";
/** Bounded: every entry is one explicit user download, and each is cleared at its terminal state. */
const DOWNLOAD_TRACKING_LIMIT = 64;

/**
 * A download the browser accepted but has not finished.
 *
 * `downloads.download()` resolves as soon as the browser takes the request, which is a handoff and
 * not a saved file -- a transfer interrupted ten seconds later had already been reported as Saved.
 * This is what lets the terminal state get back to the tab that asked for it.
 *
 * `reportId` is the id the content script was told about. A fallback retry starts a *new* download
 * with a new id, so without it the tab would never hear the outcome of the transfer it is waiting
 * on.
 */
interface TrackedDownload {
  reportId: number;
  tabId: number | null;
  filename: string;
  fallbackUrls: string[];
}

const trackedDownloads = new Map<number, TrackedDownload>();

/** Returned to the content script when `downloads` has not been granted yet. */
export const DOWNLOAD_PERMISSION_CODE = "downloads-permission-missing";

runtime?.onInstalled?.addListener((details) => {
  // Fresh installs inherit the product's default-on ad protection before the first X tab opens.
  // Updates preserve the content script's last mirrored choice; an older build has no mirror, so
  // its document-start page guard remains the safe parity path until the first content boot.
  const task =
    details?.reason === "install" && extensionApi
      ? syncDynamicAdRule(extensionApi, true)
      : extensionApi
        ? restoreDynamicAdRule(extensionApi)
        : Promise.resolve(null);
  settleBackgroundTask(task, "install/update");
  settleBackgroundTask(installMediaContextMenu(), "context-menu install/update");
});

runtime?.onStartup?.addListener(() => {
  if (extensionApi) {
    settleBackgroundTask(restoreDynamicAdRule(extensionApi), "startup");
  }
  settleBackgroundTask(installMediaContextMenu(), "context-menu startup");
});

// No popup: the toolbar button opens the durable permission-management surface. The native media
// context-menu action can also request download access from its own explicit user gesture.
globalThis.chrome?.action?.onClicked?.addListener(() => {
  void openOptions();
});

contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== MEDIA_CONTEXT_MENU_ID || typeof tab?.id !== "number") {
    return;
  }
  const tabId = tab.id;

  // `permissions.request()` has to begin inside a user gesture. Calling it synchronously from
  // the native context-menu click preserves that gesture; checking first with an awaited
  // `permissions.contains()` would lose it in some Chromium builds.
  let permissionRequest: Promise<boolean>;
  try {
    permissionRequest =
      globalThis.chrome?.permissions?.request({ permissions: ["downloads"] }) ??
      Promise.resolve(false);
  } catch {
    permissionRequest = Promise.resolve(false);
  }

  settleBackgroundTask(
    permissionRequest.then((granted) =>
      sendContextDownloadMessage(
        tabId,
        granted ? MEDIA_CONTEXT_DOWNLOAD_MESSAGE : MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE
      )
    ),
    "context-menu download"
  );
});

globalThis.chrome?.downloads?.onChanged?.addListener((delta) => {
  if (delta.state?.current === "complete") {
    settleBackgroundTask(finishDownload(delta.id, "complete"), "download completion");
  } else if (delta.state?.current === "interrupted") {
    settleBackgroundTask(
      retryDownloadFallback(delta.id, delta.error?.current),
      "download fallback"
    );
  }
});

runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (isAdRuleSyncMessage(message)) {
    if (!extensionApi) {
      sendResponse({ ok: false, enabled: message.enabled, error: "extension APIs unavailable" });
      return false;
    }
    syncDynamicAdRule(extensionApi, message.enabled).then(
      () => sendResponse({ ok: true, enabled: message.enabled }),
      (error: unknown) =>
        sendResponse({ ok: false, enabled: message.enabled, error: errorMessage(error) })
    );
    return true;
  }
  if (isType(message, "AVIARY_PING")) {
    sendResponse({ ok: true, product: "aviary" });
    return false;
  }
  if (isType(message, "AVIARY_DOWNLOAD_CAPABILITY")) {
    hasDownloadPermission().then(
      (granted) => sendResponse({ ok: true, granted }),
      () => sendResponse({ ok: true, granted: false })
    );
    return true;
  }
  if (isType(message, "AVIARY_OPEN_OPTIONS")) {
    openOptions().then(
      (opened) => sendResponse({ ok: opened }),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  if (isDownload(message)) {
    handleDownload(message, tabIdOf(sender)).then(
      (result) => sendResponse(result),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  return false;
});

function isType<T extends string>(message: unknown, type: T): message is { type: T } {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === type;
}

async function installMediaContextMenu(): Promise<void> {
  if (!contextMenus) {
    return;
  }

  // This extension owns one context-menu item. Clear first so unpacked reloads and updates cannot
  // leave duplicate entries behind; the callback form works on the Chrome 116 minimum as well as
  // Firefox, while newer Chromium also returns a Promise.
  await new Promise<void>((resolve) => {
    try {
      contextMenus.removeAll(() => resolve());
    } catch {
      resolve();
    }
  });

  contextMenus.create(
    {
      id: MEDIA_CONTEXT_MENU_ID,
      title: MEDIA_CONTEXT_MENU_TITLE,
      contexts: ["all"],
      documentUrlPatterns: [...X_DOCUMENT_PATTERNS]
    },
    () => {
      // Reading lastError suppresses Chrome's unchecked-error warning if a browser rejects a
      // document pattern. The preflight and background tests still enforce the intended item.
      void runtime?.lastError;
    }
  );
}

async function sendContextDownloadMessage(tabId: number, type: string): Promise<void> {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.sendMessage) {
    return;
  }
  await tabs.sendMessage(tabId, { type });
}

function isDownload(message: unknown): message is {
  type: "AVIARY_DOWNLOAD";
  url: string;
  fallbackUrls?: string[];
  filename: string;
} {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as {
    type?: unknown;
    url?: unknown;
    fallbackUrls?: unknown;
    filename?: unknown;
  };
  return (
    candidate.type === "AVIARY_DOWNLOAD" &&
    typeof candidate.url === "string" &&
    (candidate.fallbackUrls === undefined ||
      (Array.isArray(candidate.fallbackUrls) &&
        candidate.fallbackUrls.length <= 3 &&
        candidate.fallbackUrls.every((url) => typeof url === "string"))) &&
    typeof candidate.filename === "string"
  );
}

async function hasDownloadPermission(): Promise<boolean> {
  if (!globalThis.chrome?.downloads) {
    return false;
  }
  const permissions = globalThis.chrome?.permissions;
  if (!permissions?.contains) {
    return true;
  }
  try {
    return await permissions.contains({ permissions: ["downloads"] });
  } catch {
    return false;
  }
}

async function openOptions(): Promise<boolean> {
  if (typeof runtime?.openOptionsPage !== "function") {
    return false;
  }
  await runtime.openOptionsPage();
  return true;
}

async function handleDownload(
  message: {
    url: string;
    fallbackUrls?: string[];
    filename: string;
  },
  tabId: number | null
): Promise<{ ok: boolean; id?: number; pending?: boolean; error?: string; code?: string }> {
  if (!(await hasDownloadPermission())) {
    return {
      ok: false,
      code: DOWNLOAD_PERMISSION_CODE,
      error: "downloads permission not granted"
    };
  }
  const downloads = globalThis.chrome?.downloads;
  if (!downloads) {
    return { ok: false, code: DOWNLOAD_PERMISSION_CODE, error: "downloads permission not granted" };
  }
  const candidates = [message.url, ...(message.fallbackUrls ?? [])]
    .filter((url, index, all) => /^https?:\/\//i.test(url) && all.indexOf(url) === index)
    .slice(0, 4);
  let lastError = "download failed";
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index]!;
    try {
      const id = await downloads.download({
        url,
        filename: message.filename,
        conflictAction: "uniquify"
      });
      await trackDownload(id, {
        reportId: id,
        tabId,
        fallbackUrls: candidates.slice(index + 1),
        filename: message.filename
      });
      // `pending` is the whole point: the browser has taken the request, and nothing yet knows
      // whether the bytes arrive. The tab waits for AVIARY_DOWNLOAD_STATE before saying Saved.
      return { ok: true, id, pending: true };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * An interrupted transfer: try the next quality candidate, and only give up out loud.
 *
 * The retry inherits `reportId`, so whatever the tab is waiting on is what it eventually hears
 * about -- a fallback that succeeds reports the original request complete, and one that has no
 * candidates left reports it interrupted rather than leaving the button spinning forever.
 */
async function retryDownloadFallback(downloadId: number, error?: string): Promise<void> {
  const pending = await readTrackedDownload(downloadId);
  await clearTrackedDownload(downloadId);
  const downloads = globalThis.chrome?.downloads;
  if (!pending) {
    return;
  }
  if (downloads) {
    for (let index = 0; index < pending.fallbackUrls.length; index += 1) {
      const url = pending.fallbackUrls[index]!;
      try {
        const id = await downloads.download({
          url,
          filename: pending.filename,
          conflictAction: "uniquify"
        });
        await trackDownload(id, {
          reportId: pending.reportId,
          tabId: pending.tabId,
          fallbackUrls: pending.fallbackUrls.slice(index + 1),
          filename: pending.filename
        });
        return;
      } catch {
        // Try the next bounded candidate. The original candidate order is quality order.
      }
    }
  }
  await reportDownloadState(pending, "interrupted", error);
}

async function finishDownload(downloadId: number, state: "complete"): Promise<void> {
  const tracked = await readTrackedDownload(downloadId);
  await clearTrackedDownload(downloadId);
  if (tracked) {
    await reportDownloadState(tracked, state);
  }
}

/**
 * Tells the tab that asked. Best effort by nature: the tab may have navigated away, in which case
 * nothing is left there that was waiting to hear it.
 */
async function reportDownloadState(
  tracked: TrackedDownload,
  state: "complete" | "interrupted",
  error?: string
): Promise<void> {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.sendMessage || tracked.tabId === null) {
    return;
  }
  try {
    await tabs.sendMessage(tracked.tabId, {
      type: DOWNLOAD_STATE_MESSAGE,
      id: tracked.reportId,
      state,
      ...(error ? { error } : {})
    });
  } catch {
    // No receiver in that tab any more.
  }
}

function tabIdOf(sender: unknown): number | null {
  const tab = (sender as { tab?: { id?: unknown } } | undefined)?.tab;
  return typeof tab?.id === "number" ? tab.id : null;
}

/**
 * Persisted, not just held in memory: a service worker is suspended between the handoff and the
 * `onChanged` that reports the terminal state, and an in-memory map does not survive that.
 */
async function trackDownload(downloadId: number, pending: TrackedDownload): Promise<void> {
  trackedDownloads.set(downloadId, pending);
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return;
  }
  try {
    const stored = await readStoredDownloadTracking();
    stored[String(downloadId)] = pending;
    await storage.set({ [DOWNLOAD_TRACKING_KEY]: capTracking(stored) });
  } catch {
    // The in-memory entry still covers the current service-worker lifetime.
  }
}

async function readTrackedDownload(downloadId: number): Promise<TrackedDownload | undefined> {
  const local = trackedDownloads.get(downloadId);
  if (local) {
    return local;
  }
  try {
    const stored = await readStoredDownloadTracking();
    const pending = stored[String(downloadId)];
    if (pending) {
      trackedDownloads.set(downloadId, pending);
    }
    return pending;
  } catch {
    return undefined;
  }
}

async function clearTrackedDownload(downloadId: number): Promise<void> {
  trackedDownloads.delete(downloadId);
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return;
  }
  try {
    const stored = await readStoredDownloadTracking();
    if (stored[String(downloadId)] === undefined) {
      return;
    }
    delete stored[String(downloadId)];
    await storage.set({ [DOWNLOAD_TRACKING_KEY]: stored });
  } catch {
    // Cleanup is best effort; entries are bounded by explicit user downloads.
  }
}

/** Oldest first, so a browser that never reports a terminal state cannot grow this without end. */
function capTracking(stored: Record<string, TrackedDownload>): Record<string, TrackedDownload> {
  const ids = Object.keys(stored).sort((a, b) => Number(a) - Number(b));
  if (ids.length <= DOWNLOAD_TRACKING_LIMIT) {
    return stored;
  }
  const kept: Record<string, TrackedDownload> = {};
  for (const id of ids.slice(ids.length - DOWNLOAD_TRACKING_LIMIT)) {
    kept[id] = stored[id]!;
  }
  return kept;
}

async function readStoredDownloadTracking(): Promise<Record<string, TrackedDownload>> {
  const stored = await globalThis.chrome?.storage?.local?.get(DOWNLOAD_TRACKING_KEY);
  const raw = stored?.[DOWNLOAD_TRACKING_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const valid: Record<string, TrackedDownload> = {};
  for (const [id, value] of Object.entries(raw)) {
    const candidate = value as Partial<TrackedDownload>;
    if (
      /^\d+$/.test(id) &&
      typeof candidate.filename === "string" &&
      typeof candidate.reportId === "number" &&
      (candidate.tabId === null || typeof candidate.tabId === "number") &&
      Array.isArray(candidate.fallbackUrls) &&
      candidate.fallbackUrls.length <= 3 &&
      candidate.fallbackUrls.every(
        (url) => typeof url === "string" && /^https?:\/\//i.test(url)
      )
    ) {
      valid[id] = {
        reportId: candidate.reportId,
        tabId: candidate.tabId ?? null,
        filename: candidate.filename,
        fallbackUrls: candidate.fallbackUrls
      };
    }
  }
  return valid;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function settleBackgroundTask(task: Promise<unknown>, lifecycle: string): void {
  void task.catch((error: unknown) => {
    console.warn(`Aviary background task failed during ${lifecycle}: ${errorMessage(error)}`);
  });
}
