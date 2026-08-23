import type { StorageGateway } from "../../platform/storage.ts";
import { replaceStored } from "../../platform/storage-lock.ts";

export const LAST_DOWNLOAD_KEY = "aviary.media.last-download.v1";

export interface LastDownload {
  url: string;
  filename: string;
  kind: "photo" | "video" | "thumbnail" | "audio" | "subtitle";
  downloadedAt: string;
}

export async function rememberLastDownload(
  storage: StorageGateway,
  input: Omit<LastDownload, "downloadedAt">
): Promise<void> {
  if (!isHttpUrl(input.url) || input.filename.trim().length === 0) return;
  try {
    await replaceStored<LastDownload>(storage, LAST_DOWNLOAD_KEY, {
      ...input,
      filename: input.filename.slice(0, 240),
      downloadedAt: new Date().toISOString()
    });
  } catch {
    // The attachment hint is best-effort; a download should not fail because storage is unavailable.
  }
}

export async function getLastDownload(storage: StorageGateway): Promise<LastDownload | null> {
  const stored = await storage.get<unknown>(LAST_DOWNLOAD_KEY, null);
  return isLastDownload(stored) ? stored : null;
}

function isLastDownload(value: unknown): value is LastDownload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LastDownload>;
  return (
    typeof candidate.url === "string" &&
    isHttpUrl(candidate.url) &&
    typeof candidate.filename === "string" &&
    candidate.filename.length > 0 &&
    (candidate.kind === "photo" || candidate.kind === "video" || candidate.kind === "thumbnail" || candidate.kind === "audio" || candidate.kind === "subtitle") &&
    typeof candidate.downloadedAt === "string"
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
