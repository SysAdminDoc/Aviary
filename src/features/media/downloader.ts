import type { IntegrationSettings } from "../../platform/settings";
import { addUriToAria2, shouldHandoffToAria2 } from "../integrations/aria2";

export interface DownloadRequest {
  url: string;
  filename: string;
  estimatedBytes?: number | null;
}

export interface DownloaderResult {
  ok: true;
  via: "gm" | "extension" | "anchor" | "aria2";
}

export interface DownloaderOptions {
  integrations?: IntegrationSettings;
}

export type Downloader = (request: DownloadRequest) => Promise<DownloaderResult>;

type GlobalWithDownload = typeof globalThis & {
  GM_download?: (options: GmDownloadOptions) => unknown;
};

interface GmDownloadOptions {
  url: string;
  name: string;
  onload?: () => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}

export function createDownloader(options: DownloaderOptions = {}): Downloader {
  return async (request: DownloadRequest) => {
    if (options.integrations) {
      const aria = options.integrations.aria2;
      if (shouldHandoffToAria2(aria, request.estimatedBytes ?? null)) {
        const result = await addUriToAria2(
          { endpoint: aria.endpoint, secret: aria.secret },
          { url: request.url, filename: request.filename }
        );
        if (result.ok) {
          return { ok: true, via: "aria2" };
        }
      }
    }

    const gmResult = await tryGmDownload(request);
    if (gmResult) {
      return { ok: true, via: "gm" };
    }

    const extResult = await tryExtensionDownload(request);
    if (extResult) {
      return { ok: true, via: "extension" };
    }

    triggerAnchor(request);
    return { ok: true, via: "anchor" };
  };
}

async function tryGmDownload(request: DownloadRequest): Promise<boolean> {
  const globals = globalThis as GlobalWithDownload;
  if (typeof globals.GM_download !== "function") {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    try {
      globals.GM_download?.({
        url: request.url,
        name: request.filename,
        onload: () => resolve(true),
        onerror: () => resolve(false),
        ontimeout: () => resolve(false)
      });
    } catch {
      resolve(false);
    }
  });
}

async function tryExtensionDownload(request: DownloadRequest): Promise<boolean> {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    return false;
  }

  try {
    const response = (await runtime.sendMessage({
      type: "AVIARY_DOWNLOAD",
      url: request.url,
      filename: request.filename
    })) as { ok?: boolean } | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

function triggerAnchor(request: DownloadRequest): void {
  if (typeof document === "undefined") {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = request.url;
  anchor.download = request.filename;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
