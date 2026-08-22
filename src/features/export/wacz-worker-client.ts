import type { ExportArtifact, ExportRecord } from "./types";
import {
  buildWaczArchive,
  estimateWaczBytes,
  type WaczBuildOptions
} from "./wacz";

declare const __AVIARY_WACZ_WORKER_SOURCE__: string;

export const MAX_WACZ_EXPORT_BYTES = 256 * 1024 * 1024;

export interface WaczWorkerBuildOptions extends WaczBuildOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

interface WorkerReply {
  id?: unknown;
  type?: unknown;
  progress?: unknown;
  artifact?: unknown;
  error?: unknown;
}

let requestSequence = 0;

export async function buildWaczArchiveOffThread(
  records: readonly ExportRecord[],
  options: WaczWorkerBuildOptions = {}
): Promise<ExportArtifact> {
  const estimate = estimateWaczBytes(records);
  if (estimate.estimatedBytes > MAX_WACZ_EXPORT_BYTES) {
    throw new RangeError(
      `This WACZ is about ${formatMiB(estimate.estimatedBytes)} MiB. The safe export limit is ${formatMiB(MAX_WACZ_EXPORT_BYTES)} MiB.`
    );
  }
  throwIfAborted(options.signal);
  options.onProgress?.(0);

  const source =
    typeof __AVIARY_WACZ_WORKER_SOURCE__ === "string"
      ? __AVIARY_WACZ_WORKER_SOURCE__
      : "";
  if (!source) {
    // Unit bundles do not pass through the release builder. Yield once so their direct import
    // remains useful without pretending that this fallback is the production execution path.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    throwIfAborted(options.signal);
    const artifact = buildWaczArchive(records, options);
    options.onProgress?.(1);
    return artifact;
  }
  if (typeof Worker !== "function") {
    throw new Error("This browser cannot build a WACZ without blocking the page.");
  }

  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(blobUrl, { name: "aviary-wacz" });
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(`The browser blocked the WACZ worker: ${String((error as Error)?.message ?? error)}`);
  }

  const id = ++requestSequence;
  return new Promise<ExportArtifact>((resolve, reject) => {
    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    const fail = (error: unknown): void => {
      cleanup();
      reject(error);
    };
    const abort = (): void => fail(abortError());

    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (reply?.id !== id) return;
      if (reply.type === "progress" && typeof reply.progress === "number") {
        options.onProgress?.(Math.max(0, Math.min(1, reply.progress)));
        return;
      }
      if (reply.type === "error") {
        fail(new Error(typeof reply.error === "string" ? reply.error : "WACZ worker failed"));
        return;
      }
      if (reply.type !== "complete" || !isExportArtifact(reply.artifact)) {
        fail(new Error("WACZ worker returned an invalid archive"));
        return;
      }
      const artifact = reply.artifact;
      cleanup();
      resolve(artifact);
    };
    worker.onerror = (event) => {
      fail(new Error(event.message || "WACZ worker failed"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage({
      id,
      records,
      options: {
        ...(options.generatedAt ? { generatedAt: options.generatedAt.toISOString() } : {})
      }
    });
  });
}

function isExportArtifact(value: unknown): value is ExportArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<ExportArtifact>;
  return (
    typeof artifact.filename === "string" &&
    typeof artifact.contentType === "string" &&
    artifact.data instanceof Uint8Array
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException("WACZ export cancelled", "AbortError");
}

function formatMiB(bytes: number): string {
  return Math.ceil(bytes / (1024 * 1024)).toLocaleString();
}
