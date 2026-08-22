import type { ExportArtifact, ExportRecord } from "./types.ts";
import {
  buildSignedWaczArchive,
  buildWaczArchive,
  estimateWaczBytes,
  type PreparedWacz,
  type WaczBuildOptions
} from "./wacz.ts";
import type { WaczDigestSigner, WaczSignatureData } from "./wacz-signing.ts";

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
  prepared?: unknown;
  error?: unknown;
}

interface WorkerRequest {
  type: "build" | "prepare" | "finish";
  records?: readonly ExportRecord[];
  prepared?: PreparedWacz;
  signedData?: WaczSignatureData;
  options?: { generatedAt?: string };
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
  const reply = await callWaczWorker(source, {
    type: "build",
    records,
    options: buildOptions(options)
  }, options);
  if (reply.type !== "complete" || !isExportArtifact(reply.artifact)) {
    throw new Error("WACZ worker returned an invalid archive");
  }
  return reply.artifact;
}

export async function buildSignedWaczArchiveOffThread(
  records: readonly ExportRecord[],
  signer: WaczDigestSigner,
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
  const source = typeof __AVIARY_WACZ_WORKER_SOURCE__ === "string"
    ? __AVIARY_WACZ_WORKER_SOURCE__
    : "";
  if (!source) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    throwIfAborted(options.signal);
    const artifact = await buildSignedWaczArchive(records, signer, options);
    options.onProgress?.(1);
    return artifact;
  }
  const preparedReply = await callWaczWorker(source, {
    type: "prepare",
    records,
    options: buildOptions(options)
  }, options);
  if (preparedReply.type !== "prepared" || !isPreparedWacz(preparedReply.prepared)) {
    throw new Error("WACZ worker returned invalid signing data");
  }
  const prepared = preparedReply.prepared;
  const signedData = await signer.sign(prepared.datapackageHash, prepared.generatedAt.toISOString());
  if (signedData.hash !== prepared.datapackageHash) {
    throw new Error("WACZ signer returned a signature for a different manifest hash");
  }
  throwIfAborted(options.signal);
  const finalReply = await callWaczWorker(source, {
    type: "finish",
    prepared,
    signedData
  }, { ...options, onProgress: (progress) => options.onProgress?.(Math.max(0.85, progress)) });
  if (finalReply.type !== "complete" || !isExportArtifact(finalReply.artifact)) {
    throw new Error("WACZ worker returned an invalid signed archive");
  }
  return finalReply.artifact;
}

async function callWaczWorker(
  source: string,
  request: WorkerRequest,
  options: WaczWorkerBuildOptions
): Promise<WorkerReply> {
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(blobUrl, { name: "aviary-wacz" });
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    throw new Error(`The browser blocked the WACZ worker: ${String((error as Error)?.message ?? error)}`);
  }
  const id = ++requestSequence;
  return new Promise<WorkerReply>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const complete = (reply: WorkerReply): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(reply);
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
      complete(reply);
    };
    worker.onerror = (event) => {
      fail(new Error(event.message || "WACZ worker failed"));
    };
    worker.onmessageerror = () => {
      fail(new Error("WACZ worker message could not be cloned"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const transfer = request.prepared ? preparedTransferables(request.prepared) : undefined;
    worker.postMessage({ id, ...request }, transfer ?? []);
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

function isPreparedWacz(value: unknown): value is PreparedWacz {
  if (!value || typeof value !== "object") return false;
  const prepared = value as Partial<PreparedWacz>;
  return (
    prepared.generatedAt instanceof Date &&
    prepared.datapackageBytes instanceof Uint8Array &&
    typeof prepared.datapackageHash === "string" &&
    Array.isArray(prepared.resourceEntries) &&
    prepared.resourceEntries.every((entry) => (
      entry && typeof entry === "object" &&
      typeof entry.filename === "string" &&
      entry.data instanceof Uint8Array
    ))
  );
}

function preparedTransferables(prepared: PreparedWacz): Transferable[] {
  return [
    prepared.datapackageBytes.buffer,
    ...prepared.resourceEntries.map((entry) => entry.data.buffer)
  ];
}

function buildOptions(options: WaczBuildOptions): { generatedAt?: string } {
  return options.generatedAt ? { generatedAt: options.generatedAt.toISOString() } : {};
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
