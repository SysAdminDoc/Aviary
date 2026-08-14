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
  filename: string;
} {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message as { type?: unknown; url?: unknown; filename?: unknown };
  return (
    candidate.type === "AVIARY_DOWNLOAD" &&
    typeof candidate.url === "string" &&
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
  try {
    const id = await downloads.download({
      url: message.url,
      filename: message.filename,
      conflictAction: "uniquify"
    });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
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
