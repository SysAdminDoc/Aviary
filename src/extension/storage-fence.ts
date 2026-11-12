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
import {
  fenceOperationKey,
  fencedRemoveIsNoop,
  fencedStorageKeys,
  isFenceRecordKeyFor,
  supersededFenceRecordKeys,
  type FenceOperationRecord,
  type FenceReceiptRecord,
  type FenceRecords
} from "../platform/storage-fence-records.ts";
import { storageValueBytes } from "../platform/storage-value-hash.ts";

interface ExtensionStorageLocal {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getKeys?(): Promise<string[]>;
}

interface StoredStorageFence extends StorageLockFence {
  version: 1;
}

const FENCE_RECORD_PREFIX = "aviary.storage.fence.v1.";
/** Keys per `remove` call while compacting, so one call never carries an unbounded list. */
const COMPACTION_BATCH = 500;
let operationSequence = 0;

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
  const records = await readFenceRecords(storage, storageKey);
  if (kind === "remove" && fencedRemoveIsNoop(records, storageKey)) return;
  const operationId = `${Date.now().toString(36)}-${(++operationSequence).toString(36)}-${
    Math.random().toString(36).slice(2)
  }`;
  const operationKey = fenceOperationKey(storageKey, operationId);
  const operation: FenceOperationRecord = {
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
  const receipt: FenceReceiptRecord = {
    version: 1,
    operationId,
    committedAt: Date.now()
  };
  await storage.set({ [`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`]: receipt });
  if (kind === "set") await storage.set({ [storageKey]: value });
  else await storage.remove(storageKey);

  records[operationKey] = operation;
  records[`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`] = receipt;
  if (kind === "set") records[storageKey] = value;
  else delete records[storageKey];
  const superseded = supersededFenceRecordKeys(records, storageKey);
  if (superseded.length === 0) return;
  try {
    await storage.remove(superseded);
  } catch (error) {
    // The write itself committed. Leftover records only cost space, and the next write or the
    // worker's startup compaction retries them, so failing the caller here would be a lie.
    console.warn(`Aviary could not trim fenced records for ${storageKey}: ${errorMessage(error)}`);
  }
}

/**
 * Trims every fenced record a read no longer consults, in one pass over the area.
 *
 * Builds before this one never trimmed, so a profile that ran a long account cleanup carried tens
 * of thousands of records into every read. Run once per worker start: on a compacted area this is
 * one key listing and a handful of small reads. Returns how many keys it removed.
 */
export async function compactStorageFenceRecords(
  storage: ExtensionStorageLocal | undefined = globalThis.chrome?.storage?.local
): Promise<number> {
  if (!storage) return 0;
  const records = await readAllFenceRecords(storage);
  const stale = [...fencedStorageKeys(records)].flatMap((storageKey) =>
    supersededFenceRecordKeys(records, storageKey)
  );
  for (let index = 0; index < stale.length; index += COMPACTION_BATCH) {
    await storage.remove(stale.slice(index, index + COMPACTION_BATCH));
  }
  return stale.length;
}

async function readFenceRecords(storage: ExtensionStorageLocal, storageKey: string): Promise<FenceRecords> {
  if (typeof storage.getKeys !== "function") return storage.get(null);
  const keys = (await storage.getKeys()).filter((key) => isFenceRecordKeyFor(key, storageKey));
  return keys.length === 0 ? {} : storage.get(keys);
}

async function readAllFenceRecords(storage: ExtensionStorageLocal): Promise<FenceRecords> {
  if (typeof storage.getKeys !== "function") return storage.get(null);
  const fenceKeys = (await storage.getKeys()).filter((key) => key.startsWith(STORAGE_FENCE_OPERATION_PREFIX));
  if (fenceKeys.length === 0) return {};
  const records = await storage.get(fenceKeys);
  const plainKeys = [...fencedStorageKeys(records)];
  return plainKeys.length === 0 ? records : { ...records, ...(await storage.get(plainKeys)) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
