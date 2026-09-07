import {
  buildWaczArchive,
  finishWaczArchive,
  prepareWaczArchive,
  type PreparedWacz,
  type WaczBuildOptions
} from "../features/export/wacz.ts";
import type { ExportRecord } from "../features/export/types.ts";
import type { WaczSignatureData } from "../features/export/wacz-signing.ts";

interface WaczWorkerRequest {
  id: number;
  type?: "build" | "prepare" | "finish";
  records?: ExportRecord[];
  prepared?: PreparedWacz;
  signedData?: WaczSignatureData;
  options?: { generatedAt?: string; audience?: { includeProtected?: boolean; includeUnknown?: boolean } };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WaczWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || !Number.isSafeInteger(request.id)) return;
  try {
    const type = request.type ?? "build";
    if (type === "finish") {
      if (!request.prepared) throw new TypeError("WACZ worker is missing prepared archive data");
      scope.postMessage({ id: request.id, type: "progress", progress: 0.85 });
      const artifact = finishWaczArchive(request.prepared, request.signedData);
      scope.postMessage({ id: request.id, type: "progress", progress: 1 });
      scope.postMessage(
        { id: request.id, type: "complete", artifact },
        [artifact.data.buffer]
      );
      return;
    }
    if (!Array.isArray(request.records)) throw new TypeError("WACZ worker is missing records");
    const options: WaczBuildOptions = {
      ...(request.options?.generatedAt ? { generatedAt: new Date(request.options.generatedAt) } : {}),
      ...(request.options?.audience ? { audience: request.options.audience } : {})
    };
    scope.postMessage({ id: request.id, type: "progress", progress: 0.15 });
    if (type === "prepare") {
      const prepared = prepareWaczArchive(request.records, options);
      scope.postMessage(
        { id: request.id, type: "prepared", prepared },
        transferPrepared(prepared)
      );
      return;
    }
    const artifact = buildWaczArchive(request.records, options);
    scope.postMessage({ id: request.id, type: "progress", progress: 1 });
    scope.postMessage(
      { id: request.id, type: "complete", artifact },
      [artifact.data.buffer]
    );
  } catch (error) {
    scope.postMessage({
      id: request.id,
      type: "error",
      error: String((error as Error)?.message ?? error)
    });
  }
};

function transferPrepared(prepared: PreparedWacz): Transferable[] {
  return [
    prepared.datapackageBytes.buffer,
    ...prepared.resourceEntries.map((entry) => entry.data.buffer)
  ];
}
