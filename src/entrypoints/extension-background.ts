import {
  isAdRuleSyncMessage,
  restoreDynamicAdRule,
  syncDynamicAdRule,
  type ExtensionAdRuleApi
} from "../extension/ad-rule";

const runtime = globalThis.chrome?.runtime;
const extensionApi = globalThis.chrome as unknown as ExtensionAdRuleApi | undefined;

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
});

runtime?.onStartup?.addListener(() => {
  if (extensionApi) {
    settleBackgroundTask(restoreDynamicAdRule(extensionApi), "startup");
  }
});

// No popup: the toolbar button opens the options page, which is the only surface
// where `chrome.permissions.request` has the user gesture it requires.
globalThis.chrome?.action?.onClicked?.addListener(() => {
  void openOptions();
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
    console.warn(`Aviary could not reconcile its ad rule during ${lifecycle}: ${errorMessage(error)}`);
  });
}
