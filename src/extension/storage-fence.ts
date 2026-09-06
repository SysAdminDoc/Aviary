import {
  STORAGE_FENCE_OPERATION_PREFIX,
  STORAGE_FENCE_RECEIPT_SUFFIX,
  isStorageFenceRequest,
  isStorageLockFence,
  StorageFenceLostError,
  type StorageFenceMutationAuthority,
  type StorageFenceRequest,
  type StorageFenceResponse,
  type StorageLockFence
} from "../platform/storage-fence.ts";
import { storageValueBytes } from "../platform/storage-value-hash.ts";

interface ExtensionStorageLocal {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface StoredStorageFence extends StorageLockFence {
  version: 1;
}

const FENCE_RECORD_PREFIX = "aviary.storage.fence.v1.";
let operationSequence = 0;

interface FenceOperation {
  version: 1;
  operationId: string;
  storageKey: string;
  kind: "set" | "remove";
  value?: unknown;
  fence: StorageLockFence;
}

interface FenceReceipt {
  version: 1;
  operationId: string;
  committedAt: number;
}

/**
 * Background-owned lease authority.
 *
 * The register in a content page is only the election mechanism. This authority is the commit
 * boundary: every mutation for a fence is serialized with acquire/renew/release and re-reads the
 * persisted generation before it touches IndexedDB or chrome.storage.local. The record survives a
 * service-worker restart, so a worker that wakes for an old queued message cannot resurrect an
 * expired owner.
 */
export class ExtensionStorageFenceAuthority implements StorageFenceMutationAuthority {
  readonly #storage: ExtensionStorageLocal | undefined;
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(storage: ExtensionStorageLocal | undefined = globalThis.chrome?.storage?.local) {
    this.#storage = storage;
  }

  async acquire(candidate: StorageLockFence): Promise<StorageLockFence> {
    this.assertFence(candidate);
    return this.#serialize(candidate.name, async () => {
      const current = await this.read(candidate.name);
      const now = Date.now();
      if (current && current.expiresAt > now && current.owner !== candidate.owner) {
        throw new StorageFenceLostError("Another owner still holds this storage fence.");
      }
      if (current && current.owner === candidate.owner && current.expiresAt > now) {
        return current;
      }
      const next: StoredStorageFence = {
        ...candidate,
        generation: Math.max(current?.generation ?? 0, candidate.generation) + 1
      };
      await this.write(next);
      return next;
    });
  }

  async renew(fence: StorageLockFence): Promise<StorageLockFence> {
    this.assertFence(fence);
    return this.#serialize(fence.name, async () => {
      const current = await this.read(fence.name);
      if (!matchesFence(current, fence) || current!.expiresAt <= Date.now()) {
        throw new StorageFenceLostError("The storage lease expired before renewal.");
      }
      const next: StoredStorageFence = { ...current!, expiresAt: fence.expiresAt };
      await this.write(next);
      return next;
    });
  }

  async release(fence: StorageLockFence): Promise<void> {
    this.assertFence(fence);
    await this.#serialize(fence.name, async () => {
      const current = await this.read(fence.name);
      if (!matchesFence(current, fence)) return;
      await this.#storage!.remove(fenceRecordKey(fence.name));
    });
  }

  async mutate<T>(fence: StorageLockFence, action: () => Promise<T>): Promise<T> {
    this.assertFence(fence);
    return this.#serialize(fence.name, async () => {
      const current = await this.read(fence.name);
      if (!matchesFence(current, fence) || current!.expiresAt <= Date.now()) {
        throw new StorageFenceLostError("The storage lease expired before the write could commit.");
      }
      const result = await action();
      const after = await this.read(fence.name);
      if (!matchesFence(after, fence) || after!.expiresAt <= Date.now()) {
        throw new StorageFenceLostError("The storage lease changed before the write completed.");
      }
      return result;
    });
  }

  async handle(
    request: StorageFenceRequest,
    storage: ExtensionStorageLocal | undefined = this.#storage
  ): Promise<StorageFenceResponse> {
    try {
      switch (request.operation) {
        case "acquire":
          return { ok: true, result: await this.acquire(request.fence) };
        case "renew":
          return { ok: true, result: await this.renew(request.fence) };
        case "release":
          await this.release(request.fence);
          return { ok: true, result: null };
        case "set":
          if (!storage) throw new StorageFenceLostError("Extension storage is unavailable.");
          await this.mutate(request.fence, () =>
            writeFencedOperation(storage, request.key, request.value, request.fence)
          );
          return { ok: true, result: null };
        case "remove":
          if (!storage) throw new StorageFenceLostError("Extension storage is unavailable.");
          await this.mutate(request.fence, () =>
            writeFencedOperation(storage, request.key, undefined, request.fence, "remove")
          );
          return { ok: true, result: null };
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof StorageFenceLostError ? { code: error.code } : {})
      };
    }
  }

  private async read(name: string): Promise<StoredStorageFence | undefined> {
    if (!this.#storage) throw new StorageFenceLostError("Extension storage is unavailable.");
    const result = await this.#storage.get(fenceRecordKey(name));
    const value = result[fenceRecordKey(name)];
    return isStorageLockFence(value) ? value : undefined;
  }

  private async write(fence: StoredStorageFence): Promise<void> {
    if (!this.#storage) throw new StorageFenceLostError("Extension storage is unavailable.");
    await this.#storage.set({ [fenceRecordKey(fence.name)]: fence });
  }

  private assertFence(fence: StorageLockFence): void {
    if (!isStorageLockFence(fence)) {
      throw new StorageFenceLostError("The storage fence was malformed.");
    }
  }

  async #serialize<T>(name: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(name) ?? Promise.resolve();
    const attempt = previous.then(action, action);
    const settled = attempt.then(() => undefined, () => undefined);
    this.#chains.set(name, settled);
    void settled.then(() => {
      if (this.#chains.get(name) === settled) this.#chains.delete(name);
    });
    return attempt;
  }
}

async function writeFencedOperation(
  storage: ExtensionStorageLocal,
  storageKey: string,
  value: unknown,
  fence: StorageLockFence,
  kind: "set" | "remove" = "set"
): Promise<void> {
  const operationId = `${Date.now().toString(36)}-${(++operationSequence).toString(36)}-${
    Math.random().toString(36).slice(2)
  }`;
  const operationKey = `${STORAGE_FENCE_OPERATION_PREFIX}${encodeURIComponent(storageKey)}.${
    encodeURIComponent(operationId)
  }`;
  const operation: FenceOperation = {
    version: 1,
    operationId,
    storageKey,
    kind,
    ...(kind === "set" ? { value } : {}),
    fence
  };
  // Keep the operation record bounded by the same practical value size used by the page adapter.
  // chrome.storage.local has a much larger quota, but refusing an oversized record is safer than
  // acknowledging a fence whose immutable proof cannot be retained.
  if (storageValueBytes(operation) > 16 * 1024 * 1024) {
    throw new StorageFenceLostError("The fenced extension operation exceeds the storage safety limit.");
  }
  await storage.set({ [operationKey]: operation });
  const receipt: FenceReceipt = {
    version: 1,
    operationId,
    committedAt: Date.now()
  };
  await storage.set({ [`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`]: receipt });
  if (kind === "set") await storage.set({ [storageKey]: value });
  else await storage.remove(storageKey);
}

export function isExtensionStorageFenceRequest(value: unknown): value is StorageFenceRequest {
  return isStorageFenceRequest(value);
}

function fenceRecordKey(name: string): string {
  return `${FENCE_RECORD_PREFIX}${encodeURIComponent(name)}`;
}

function matchesFence(
  current: StoredStorageFence | undefined,
  expected: StorageLockFence
): current is StoredStorageFence {
  return Boolean(
    current &&
    current.name === expected.name &&
    current.owner === expected.owner &&
    current.generation === expected.generation
  );
}
