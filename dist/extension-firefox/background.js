// src/entrypoints/extension-background.ts
var runtime = globalThis.chrome?.runtime;
runtime?.onInstalled?.addListener(() => {
});
runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (isPing(message)) {
    sendResponse({ ok: true, product: "aviary" });
    return false;
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
function isPing(message) {
  return typeof message === "object" && message !== null && message.type === "AVIARY_PING";
}
function isDownload(message) {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const candidate = message;
  return candidate.type === "AVIARY_DOWNLOAD" && typeof candidate.url === "string" && typeof candidate.filename === "string";
}
async function handleDownload(message) {
  const downloads = globalThis.chrome?.downloads;
  if (!downloads) {
    return { ok: false, error: "downloads permission not granted" };
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
