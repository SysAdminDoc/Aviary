import { buildWaczArchive, type WaczBuildOptions } from "../features/export/wacz";
import type { ExportRecord } from "../features/export/types";

interface WaczWorkerRequest {
  id: number;
  records: ExportRecord[];
  options: { generatedAt?: string };
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WaczWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || !Number.isSafeInteger(request.id) || !Array.isArray(request.records)) return;
  try {
    scope.postMessage({ id: request.id, type: "progress", progress: 0.15 });
    const options: WaczBuildOptions = {
      ...(request.options.generatedAt ? { generatedAt: new Date(request.options.generatedAt) } : {})
    };
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
