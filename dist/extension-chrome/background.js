// src/entrypoints/extension-background.ts
var runtime = globalThis.chrome?.runtime;
var DOWNLOAD_PERMISSION_CODE = "downloads-permission-missing";
runtime?.onInstalled?.addListener(() => {
});
globalThis.chrome?.action?.onClicked?.addListener(() => {
  void openOptions();
});
runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
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
export {
  DOWNLOAD_PERMISSION_CODE
};
