import {
  isAdRuleSyncMessage,
  restoreDynamicAdRule,
  syncDynamicAdRule,
  type ExtensionAdRuleApi
} from "../extension/ad-rule";
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
const DOWNLOAD_FALLBACK_KEY = "aviary.downloadFallbacks.v1";

interface PendingDownloadFallback {
  fallbackUrls: string[];
  filename: string;
}

const pendingDownloadFallbacks = new Map<number, PendingDownloadFallback>();

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
    settleBackgroundTask(clearDownloadFallback(delta.id), "download completion");
  } else if (delta.state?.current === "interrupted") {
    settleBackgroundTask(retryDownloadFallback(delta.id), "download fallback");
  }
});

runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
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
    handleDownload(message).then(
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

async function handleDownload(message: {
  url: string;
  fallbackUrls?: string[];
  filename: string;
}): Promise<{ ok: boolean; id?: number; error?: string; code?: string }> {
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
      await rememberDownloadFallback(id, {
        fallbackUrls: candidates.slice(index + 1),
        filename: message.filename
      });
      return { ok: true, id };
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  return { ok: false, error: lastError };
}

async function retryDownloadFallback(downloadId: number): Promise<void> {
  const pending = await readDownloadFallback(downloadId);
  await clearDownloadFallback(downloadId);
  const downloads = globalThis.chrome?.downloads;
  if (!pending || !downloads) {
    return;
  }

  for (let index = 0; index < pending.fallbackUrls.length; index += 1) {
    const url = pending.fallbackUrls[index]!;
    try {
      const id = await downloads.download({
        url,
        filename: pending.filename,
        conflictAction: "uniquify"
      });
      await rememberDownloadFallback(id, {
        fallbackUrls: pending.fallbackUrls.slice(index + 1),
        filename: pending.filename
      });
      return;
    } catch {
      // Try the next bounded candidate. The original candidate order is quality order.
    }
  }
}

async function rememberDownloadFallback(
  downloadId: number,
  pending: PendingDownloadFallback
): Promise<void> {
  if (pending.fallbackUrls.length === 0) {
    return;
  }
  pendingDownloadFallbacks.set(downloadId, pending);
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return;
  }
  try {
    const stored = await readStoredDownloadFallbacks();
    stored[String(downloadId)] = pending;
    await storage.set({ [DOWNLOAD_FALLBACK_KEY]: stored });
  } catch {
    // The in-memory entry still covers the current service-worker lifetime.
  }
}

async function readDownloadFallback(
  downloadId: number
): Promise<PendingDownloadFallback | undefined> {
  const local = pendingDownloadFallbacks.get(downloadId);
  if (local) {
    return local;
  }
  try {
    const stored = await readStoredDownloadFallbacks();
    const pending = stored[String(downloadId)];
    if (pending) {
      pendingDownloadFallbacks.set(downloadId, pending);
    }
    return pending;
  } catch {
    return undefined;
  }
}

async function clearDownloadFallback(downloadId: number): Promise<void> {
  pendingDownloadFallbacks.delete(downloadId);
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    return;
  }
  try {
    const stored = await readStoredDownloadFallbacks();
    if (stored[String(downloadId)] === undefined) {
      return;
    }
    delete stored[String(downloadId)];
    await storage.set({ [DOWNLOAD_FALLBACK_KEY]: stored });
  } catch {
    // Cleanup is best effort; entries are bounded by explicit user downloads.
  }
}

async function readStoredDownloadFallbacks(): Promise<
  Record<string, PendingDownloadFallback>
> {
  const stored = await globalThis.chrome?.storage?.local?.get(DOWNLOAD_FALLBACK_KEY);
  const raw = stored?.[DOWNLOAD_FALLBACK_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const valid: Record<string, PendingDownloadFallback> = {};
  for (const [id, value] of Object.entries(raw)) {
    const candidate = value as Partial<PendingDownloadFallback>;
    if (
      /^\d+$/.test(id) &&
      typeof candidate.filename === "string" &&
      Array.isArray(candidate.fallbackUrls) &&
      candidate.fallbackUrls.length <= 3 &&
      candidate.fallbackUrls.every(
        (url) => typeof url === "string" && /^https?:\/\//i.test(url)
      )
    ) {
      valid[id] = {
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
