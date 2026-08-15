// src/extension/ad-rule.ts
var AD_RULE_SYNC_MESSAGE = "AVIARY_SYNC_AD_RULE";
var AD_LOGGER_RULE_ID = 73001;
var AD_LOGGER_STATE_KEY = "aviary.runtime.adLoggerRule.v1";
var AD_LOGGER_RULE = {
  id: AD_LOGGER_RULE_ID,
  priority: 1,
  action: { type: "block" },
  condition: {
    regexFilter: "^https://[^/]+/i/api/1[.]1/promoted_content/log[.]json([?].*)?$",
    requestDomains: [
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com",
      "pro.x.com"
    ],
    resourceTypes: ["xmlhttprequest", "ping", "other"]
  }
};
function isAdRuleSyncMessage(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value;
  return candidate.type === AD_RULE_SYNC_MESSAGE && typeof candidate.enabled === "boolean";
}
async function syncDynamicAdRule(api, enabled) {
  const dnr = api.declarativeNetRequest;
  if (!dnr?.updateDynamicRules) {
    throw new Error("declarativeNetRequest is unavailable");
  }
  await dnr.updateDynamicRules({
    removeRuleIds: [AD_LOGGER_RULE_ID],
    addRules: enabled ? [AD_LOGGER_RULE] : []
  });
  const storage = api.storage?.local;
  if (!storage?.set) {
    throw new Error("extension storage is unavailable");
  }
  await storage.set({ [AD_LOGGER_STATE_KEY]: enabled });
}
async function restoreDynamicAdRule(api) {
  const storage = api.storage?.local;
  if (!storage?.get) {
    return null;
  }
  const stored = await storage.get(AD_LOGGER_STATE_KEY);
  const enabled = stored[AD_LOGGER_STATE_KEY];
  if (typeof enabled !== "boolean") {
    return null;
  }
  await syncDynamicAdRule(api, enabled);
  return enabled;
}

// src/extension/media-context-menu.ts
var MEDIA_CONTEXT_MENU_ID = "aviary-download-media";
var MEDIA_CONTEXT_MENU_TITLE = "Download media with Aviary";
var MEDIA_CONTEXT_DOWNLOAD_MESSAGE = "AVIARY_DOWNLOAD_CONTEXT_MEDIA";
var MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE = "AVIARY_CONTEXT_DOWNLOAD_PERMISSION_DENIED";
var X_DOCUMENT_PATTERNS = [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://pro.x.com/*"
];

// src/entrypoints/extension-background.ts
var runtime = globalThis.chrome?.runtime;
var extensionApi = globalThis.chrome;
var contextMenus = globalThis.chrome?.contextMenus;
var DOWNLOAD_PERMISSION_CODE = "downloads-permission-missing";
runtime?.onInstalled?.addListener((details) => {
  const task = details?.reason === "install" && extensionApi ? syncDynamicAdRule(extensionApi, true) : extensionApi ? restoreDynamicAdRule(extensionApi) : Promise.resolve(null);
  settleBackgroundTask(task, "install/update");
  settleBackgroundTask(installMediaContextMenu(), "context-menu install/update");
});
runtime?.onStartup?.addListener(() => {
  if (extensionApi) {
    settleBackgroundTask(restoreDynamicAdRule(extensionApi), "startup");
  }
  settleBackgroundTask(installMediaContextMenu(), "context-menu startup");
});
globalThis.chrome?.action?.onClicked?.addListener(() => {
  void openOptions();
});
contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId !== MEDIA_CONTEXT_MENU_ID || typeof tab?.id !== "number") {
    return;
  }
  const tabId = tab.id;
  let permissionRequest;
  try {
    permissionRequest = globalThis.chrome?.permissions?.request({ permissions: ["downloads"] }) ?? Promise.resolve(false);
  } catch {
    permissionRequest = Promise.resolve(false);
  }
  settleBackgroundTask(
    permissionRequest.then(
      (granted) => sendContextDownloadMessage(
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
      (error) => sendResponse({ ok: false, enabled: message.enabled, error: errorMessage(error) })
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
      (error) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  if (isDownload(message)) {
    handleDownload(message).then(
      (result) => sendResponse(result),
      (error) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
  return false;
});
function isType(message, type) {
  return typeof message === "object" && message !== null && message.type === type;
}
async function installMediaContextMenu() {
  if (!contextMenus) {
    return;
  }
  await new Promise((resolve) => {
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
      void runtime?.lastError;
    }
  );
}
async function sendContextDownloadMessage(tabId, type) {
  const tabs = globalThis.chrome?.tabs;
  if (!tabs?.sendMessage) {
    return;
  }
  await tabs.sendMessage(tabId, { type });
}
function isDownload(message) {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message;
  return candidate.type === "AVIARY_DOWNLOAD" && typeof candidate.url === "string" && typeof candidate.filename === "string";
}
async function hasDownloadPermission() {
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
async function openOptions() {
  if (typeof runtime?.openOptionsPage !== "function") {
    return false;
  }
  await runtime.openOptionsPage();
  return true;
}
async function handleDownload(message) {
  if (!await hasDownloadPermission()) {
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
function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function settleBackgroundTask(task, lifecycle) {
  void task.catch((error) => {
    console.warn(`Aviary background task failed during ${lifecycle}: ${errorMessage(error)}`);
  });
}
export {
  DOWNLOAD_PERMISSION_CODE
};
