/**
 * Lease fencing shared by the storage lock, gateways, and extension background.
 *
 * A lock register only decides who may enter. It cannot stop a page whose lease expired while it
 * was frozen from resuming later and writing its old snapshot. The fence is the commit credential:
 * extension writes are checked by the background authority, and userscript writes are appended as
 * immutable operations that carry the lease generation.
 */

export const STORAGE_FENCE_MESSAGE = "AVIARY_STORAGE_FENCE";
export const STORAGE_FENCE_VERSION = 1 as const;
export const STORAGE_FENCE_OPERATION_PREFIX = "aviary.fence.v1.op.";
export const STORAGE_FENCE_RECEIPT_SUFFIX = ".receipt";

export interface StorageLockFence {
  version: typeof STORAGE_FENCE_VERSION;
  name: string;
  owner: string;
  generation: number;
  expiresAt: number;
}

export interface StorageFenceMutationAuthority {
  mutate<T>(fence: StorageLockFence, action: () => Promise<T>): Promise<T>;
}

export class StorageFenceLostError extends Error {
  readonly code = "storage-fence-lost";

  constructor(message = "The storage lease expired before the write could commit.") {
    super(message);
    this.name = "StorageFenceLostError";
  }
}

export class StorageFenceUnavailableError extends Error {
  readonly code = "storage-fence-unavailable";

  constructor(message = "The storage backend cannot prove this write still owns its lease.") {
    super(message);
    this.name = "StorageFenceUnavailableError";
  }
}

export function isStorageFenceError(error: unknown): error is StorageFenceLostError | StorageFenceUnavailableError {
  return (
    error instanceof StorageFenceLostError ||
    error instanceof StorageFenceUnavailableError ||
    (isRecord(error) &&
      (error.code === "storage-fence-lost" || error.code === "storage-fence-unavailable"))
  );
}

export function isStorageLockFence(value: unknown): value is StorageLockFence {
  if (!isRecord(value)) return false;
  return (
    value.version === STORAGE_FENCE_VERSION &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 512 &&
    typeof value.owner === "string" &&
    value.owner.length > 0 &&
    value.owner.length <= 256 &&
    typeof value.generation === "number" &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0 &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  );
}

export type StorageFenceControlOperation = "acquire" | "renew" | "release";

export interface StorageFenceControlRequest {
  type: typeof STORAGE_FENCE_MESSAGE;
  operation: StorageFenceControlOperation;
  fence: StorageLockFence;
}

export interface StorageFenceSetRequest {
  type: typeof STORAGE_FENCE_MESSAGE;
  operation: "set";
  key: string;
  value: unknown;
  fence: StorageLockFence;
}

export interface StorageFenceRemoveRequest {
  type: typeof STORAGE_FENCE_MESSAGE;
  operation: "remove";
  key: string;
  fence: StorageLockFence;
}

export type StorageFenceRequest =
  | StorageFenceControlRequest
  | StorageFenceSetRequest
  | StorageFenceRemoveRequest;

export interface StorageFenceResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

export function isStorageFenceRequest(value: unknown): value is StorageFenceRequest {
  if (!isRecord(value) || value.type !== STORAGE_FENCE_MESSAGE) return false;
  if (!isStorageLockFence(value.fence)) return false;
  if (value.operation === "acquire" || value.operation === "renew" || value.operation === "release") {
    return true;
  }
  if (value.operation === "set") {
    return typeof value.key === "string" && value.key.length > 0 && value.key.length <= 512 && "value" in value;
  }
  return value.operation === "remove" && typeof value.key === "string" && value.key.length > 0 && value.key.length <= 512;
}

/**
 * A browser has no AsyncLocalStorage. This small stack is only used while a lock callback is
 * executing, and restore's exclusive gate is the only context allowed to match every key. Normal
 * locks match the key they were created for, so concurrent locks for different collections cannot
 * borrow one another's fence.
 */
interface ActiveStorageFence {
  fence: StorageLockFence;
  lockKey: string;
  exclusive: boolean;
}

const activeStorageFences: ActiveStorageFence[] = [];

export async function withStorageFenceContext<T>(
  fence: StorageLockFence | undefined,
  lockKey: string,
  exclusive: boolean,
  run: () => Promise<T>
): Promise<T> {
  if (!fence) return run();
  const active = { fence, lockKey, exclusive } satisfies ActiveStorageFence;
  activeStorageFences.push(active);
  try {
    return await run();
  } finally {
    const index = activeStorageFences.lastIndexOf(active);
    if (index >= 0) activeStorageFences.splice(index, 1);
  }
}

export function inferStorageFence(key: string): StorageLockFence | undefined {
  for (let index = activeStorageFences.length - 1; index >= 0; index -= 1) {
    const active = activeStorageFences[index]!;
    if (
      active.exclusive ||
      key === active.lockKey ||
      key === `aviary.${active.lockKey}` ||
      key === active.fence.name ||
      key === active.fence.name.replace(/^aviary\./, "")
    ) {
      return active.fence;
    }
  }
  return undefined;
}

export function hasExtensionFenceTransport(): boolean {
  return Boolean(
    globalThis.chrome?.runtime?.id &&
      typeof globalThis.chrome.runtime.sendMessage === "function"
  );
}

export async function sendStorageFenceControl(
  operation: StorageFenceControlOperation,
  fence: StorageLockFence
): Promise<StorageLockFence | undefined> {
  if (!hasExtensionFenceTransport()) return undefined;
  const response = await sendExtensionMessage({
    type: STORAGE_FENCE_MESSAGE,
    operation,
    fence
  });
  return readFenceResponse(response, operation === "release");
}

export async function sendStorageFenceMutation(
  operation: "set" | "remove",
  key: string,
  fence: StorageLockFence,
  value?: unknown
): Promise<void> {
  if (!hasExtensionFenceTransport()) {
    throw new StorageFenceUnavailableError(
      "The extension background did not expose its fenced storage authority."
    );
  }
  const response = await sendExtensionMessage({
    type: STORAGE_FENCE_MESSAGE,
    operation,
    key,
    ...(operation === "set" ? { value } : {}),
    fence
  });
  // Mutations acknowledge with `result: null`, so they only need the success/error envelope. The
  // control acquire path is the one that returns a new fence token.
  readFenceResponse(response, true);
}

/**
 * Chrome's callback transport is still the reliable path at the supported Chromium floor. Newer
 * browsers return a Promise, while older MV3 runtimes can leave that Promise pending even though
 * the background listener calls sendResponse. Supporting both forms keeps fenced writes from
 * hanging silently during the first real settings save.
 */
async function sendExtensionMessage(message: unknown): Promise<unknown> {
  const runtime = globalThis.chrome?.runtime as {
    sendMessage?: (message: unknown, callback?: (response: unknown) => void) => unknown;
    lastError?: { message?: string };
  } | undefined;
  if (!runtime?.sendMessage) {
    throw new StorageFenceUnavailableError(
      "The extension background did not expose its fenced storage authority."
    );
  }
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finish = (value: unknown, error?: unknown): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    try {
      const pending = runtime.sendMessage!(message, (value) => {
        const error = runtime.lastError?.message;
        finish(value, error ? new Error(`Storage fence message failed: ${error}`) : undefined);
      });
      if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
        (pending as PromiseLike<unknown>).then(
          (value) => finish(value),
          (error) => finish(undefined, error)
        );
      }
    } catch (error) {
      finish(undefined, error);
    }
  });
}

function readFenceResponse(value: unknown, release: boolean): StorageLockFence | undefined {
  const response = isRecord(value) ? value : {};
  if (response.ok !== true) {
    const message = typeof response.error === "string" ? response.error : undefined;
    if (response.code === "storage-fence-unavailable") {
      throw new StorageFenceUnavailableError(message);
    }
    throw new StorageFenceLostError(message);
  }
  if (release) return undefined;
  if (!isStorageLockFence(response.result)) {
    throw new StorageFenceUnavailableError(
      "The extension background returned no valid storage fence."
    );
  }
  return response.result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
