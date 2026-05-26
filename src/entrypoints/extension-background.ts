const runtime = globalThis.chrome?.runtime;

runtime?.onInstalled?.addListener(() => {
  // Service worker stays stateless; durable work belongs in storage-backed queues.
});

runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (isPing(message)) {
    sendResponse({ ok: true, product: "aviary" });
    return false;
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

function isPing(message: unknown): message is { type: "AVIARY_PING" } {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "AVIARY_PING";
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

async function handleDownload(message: {
  url: string;
  filename: string;
}): Promise<{ ok: boolean; id?: number; error?: string }> {
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
