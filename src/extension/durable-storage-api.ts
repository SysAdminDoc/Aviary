import {
  DURABLE_DATABASE_NAME,
  DURABLE_META_KEY,
  DURABLE_OBJECT_STORE,
  DURABLE_STORAGE_SCHEMA_VERSION,
  isDurableOperation,
  isDurablePendingWrite,
  isDurableStorageMeta,
  type DurableIndexedValue,
  type DurableOperation,
  type DurablePendingWrite,
  type DurablePendingWriteReceipt,
  type DurableStorageRead,
  type DurableStorageBackend,
  type DurableStorageEstimate,
  type DurableStorageMeta
} from "../platform/durable-storage.ts";
import { hashStorageValue } from "../platform/storage-value-hash.ts";
import {
  isStorageLockFence,
  StorageFenceLostError,
  type StorageFenceMutationAuthority,
  type StorageLockFence
} from "../platform/storage-fence.ts";

export const DURABLE_STORAGE_MESSAGE = "AVIARY_DURABLE_STORAGE";
const MIGRATION_BATCH_LIMIT = 16;
const MAX_KEY_LENGTH = 512;
const LEGACY_MIGRATION_SEAL_STORE = "__aviary_migration_seal__";

type DurableStorageRequest =
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "get"; key: string }
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "read"; key: string }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "put";
      key: string;
      value: unknown;
      fence?: StorageLockFence;
      durableOperation?: DurableOperation;
    }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "remove";
      key: string;
      fence?: StorageLockFence;
      durableOperation?: DurableOperation;
    }
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "get-meta" }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "put-many";
      entries: Array<[string, unknown]>;
      meta: DurableStorageMeta;
    }
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "estimate" }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "stage-pending";
      write: DurablePendingWrite;
      fence?: StorageLockFence;
    }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "commit-pending";
      write: DurablePendingWrite;
      fence?: StorageLockFence;
    }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "migrate-host";
      entries: LegacyMigrationEntry[];
    };

interface DurableStorageResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
}

interface RuntimeMessageApi {
  id?: string;
  sendMessage?: (message: unknown) => Promise<unknown>;
}

interface LegacyMigrationEntry {
  key: string;
  value: unknown;
  hash: string;
}

interface LegacyDatabaseSnapshot {
  records: DurableIndexedValue[];
  version: number;
  sealed: boolean;
}

export interface HostMigrationResult {
  databaseFound: boolean;
  recordsCopied: number;
  databaseDeleted: boolean;
}

/** Content and options use this client; only the extension background constructs IndexedDB. */
export class ExtensionDurableStorageBackend implements DurableStorageBackend {
  readonly #sendMessage: (message: unknown) => Promise<unknown>;

  constructor(sendMessage: (message: unknown) => Promise<unknown>) {
    this.#sendMessage = sendMessage;
  }

  async get(key: string): Promise<unknown | undefined> {
    const result = await this.read(key);
    return result.found && !result.removed ? result.value : undefined;
  }

  async read(key: string): Promise<DurableStorageRead> {
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "read",
      key
    }));
    if (result.found !== true) {
      return { found: false, removed: false };
    }
    return result.removed === true
      ? { found: true, removed: true }
      : { found: true, removed: false, value: result.value };
  }

  async put(
    key: string,
    value: unknown,
    fence?: StorageLockFence,
    operation?: DurableOperation
  ): Promise<void> {
    await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "put",
      key,
      value,
      ...(fence ? { fence } : {}),
      ...(operation ? { durableOperation: operation } : {})
    });
  }

  async remove(
    key: string,
    fence?: StorageLockFence,
    operation?: DurableOperation
  ): Promise<void> {
    await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "remove",
      key,
      ...(fence ? { fence } : {}),
      ...(operation ? { durableOperation: operation } : {})
    });
  }

  async getMeta(): Promise<DurableStorageMeta | undefined> {
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "get-meta"
    }));
    return result.found === true && isDurableStorageMeta(result.value)
      ? result.value
      : undefined;
  }

  async putMany(
    entries: ReadonlyArray<readonly [string, unknown]>,
    meta: DurableStorageMeta
  ): Promise<void> {
    await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "put-many",
      entries: entries.map(([key, value]) => [key, value]),
      meta
    });
  }

  async stagePendingWrite(write: DurablePendingWrite, fence?: StorageLockFence): Promise<void> {
    await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "stage-pending",
      write,
      ...(fence ? { fence } : {})
    });
  }

  async commitPendingWrite(
    write: DurablePendingWrite,
    fence?: StorageLockFence
  ): Promise<DurablePendingWriteReceipt> {
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "commit-pending",
      write,
      ...(fence ? { fence } : {})
    }));
    if (
      typeof result.id !== "string" ||
      typeof result.key !== "string" ||
      (result.kind !== "put" && result.kind !== "remove") ||
      (result.valueHash !== null && typeof result.valueHash !== "string")
    ) {
      throw new Error("The extension storage background returned an invalid reconciliation receipt");
    }
    return {
      id: result.id,
      key: result.key,
      kind: result.kind,
      valueHash: result.valueHash
    };
  }

  async estimate(): Promise<DurableStorageEstimate> {
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "estimate"
    }));
    return {
      ...(typeof result.usage === "number" ? { usage: result.usage } : {}),
      ...(typeof result.quota === "number" ? { quota: result.quota } : {})
    };
  }

  async migrateHostEntries(entries: LegacyMigrationEntry[]): Promise<Record<string, string>> {
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "migrate-host",
      entries
    }));
    const hashes = result.hashes;
    if (!hashes || typeof hashes !== "object" || Array.isArray(hashes)) {
      throw new Error("The extension storage migration returned no hash receipts");
    }
    const valid: Record<string, string> = {};
    for (const [key, hash] of Object.entries(hashes)) {
      if (typeof hash === "string") valid[key] = hash;
    }
    return valid;
  }

  async #call(request: DurableStorageRequest): Promise<unknown> {
    const response = await this.#sendMessage(request);
    if (!response || typeof response !== "object") {
      throw new Error("The extension storage background did not answer");
    }
    const candidate = response as DurableStorageResponse;
    if (candidate.ok !== true) {
      if (candidate.code === "storage-fence-lost") {
        throw new StorageFenceLostError(candidate.error);
      }
      throw new Error(candidate.error ?? "The extension storage request failed");
    }
    return candidate.result;
  }
}

export function createExtensionDurableStorageBackend(
  runtime: RuntimeMessageApi | undefined = globalThis.chrome?.runtime
): ExtensionDurableStorageBackend | null {
  if (!runtime?.id || typeof runtime.sendMessage !== "function") {
    return null;
  }
  return new ExtensionDurableStorageBackend((message) => runtime.sendMessage!(message));
}

export function isDurableStorageRequest(message: unknown): message is DurableStorageRequest {
  if (!message || typeof message !== "object") return false;
  const request = message as Partial<DurableStorageRequest> & Record<string, unknown>;
  if (request.type !== DURABLE_STORAGE_MESSAGE || typeof request.operation !== "string") {
    return false;
  }
  if (request.operation === "get-meta" || request.operation === "estimate") return true;
  if (
    request.operation === "get" ||
    request.operation === "read" ||
    request.operation === "put" ||
    request.operation === "remove"
  ) {
    return (
      validKey(request.key) &&
      (request.operation !== "put" || "value" in request) &&
      (request.fence === undefined || isStorageLockFence(request.fence)) &&
      (request.durableOperation === undefined || isDurableOperation(request.durableOperation))
    );
  }
  if (request.operation === "put-many") {
    return validEntries(request.entries) && isDurableStorageMeta(request.meta);
  }
  if (request.operation === "stage-pending" || request.operation === "commit-pending") {
    return isDurablePendingWrite(request.write) &&
      (request.fence === undefined || isStorageLockFence(request.fence));
  }
  if (request.operation === "migrate-host") {
    return (
      Array.isArray(request.entries) &&
      request.entries.length <= MIGRATION_BATCH_LIMIT &&
      request.entries.every(isLegacyMigrationEntry)
    );
  }
  return false;
}

/** The background calls this after the message shape has been validated. */
export async function handleDurableStorageRequest(
  request: DurableStorageRequest,
  backend: DurableStorageBackend,
  authority?: StorageFenceMutationAuthority
): Promise<DurableStorageResponse> {
  try {
    switch (request.operation) {
      case "get": {
        const value = await backend.get(request.key);
        return { ok: true, result: value === undefined ? { found: false } : { found: true, value } };
      }
      case "read": {
        const result = typeof backend.read === "function"
          ? await backend.read(request.key)
          : await backend.get(request.key).then((value) =>
              value === undefined
                ? { found: false, removed: false }
                : { found: true, removed: false, value }
            );
        return { ok: true, result };
      }
      case "put":
        await runFencedMutation(authority, request.fence, () =>
          backend.put(request.key, request.value, request.fence, request.durableOperation)
        );
        return { ok: true, result: null };
      case "remove":
        await runFencedMutation(authority, request.fence, () =>
          backend.remove(request.key, request.fence, request.durableOperation)
        );
        return { ok: true, result: null };
      case "get-meta": {
        const value = await backend.getMeta();
        return { ok: true, result: value ? { found: true, value } : { found: false } };
      }
      case "put-many":
        await backend.putMany(request.entries, request.meta);
        return { ok: true, result: null };
      case "estimate":
        return { ok: true, result: await backend.estimate() };
      case "stage-pending":
        await runFencedMutation(authority, request.fence, () => backend.stagePendingWrite(request.write, request.fence));
        return { ok: true, result: null };
      case "commit-pending":
        return {
          ok: true,
          result: await runFencedMutation(
            authority,
            request.fence,
            () => backend.commitPendingWrite(request.write, request.fence)
          )
        };
      case "migrate-host":
        return { ok: true, result: { hashes: await importHostEntries(backend, request.entries) } };
    }
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
      ...(error instanceof StorageFenceLostError ? { code: error.code } : {})
    };
  }
}

async function runFencedMutation<T>(
  authority: StorageFenceMutationAuthority | undefined,
  fence: StorageLockFence | undefined,
  action: () => Promise<T>
): Promise<T> {
  if (!fence) return action();
  if (!authority) throw new StorageFenceLostError("The extension storage authority is unavailable.");
  return authority.mutate(fence, action);
}

/**
 * Copies the database left by older content-script builds, verifies each stored value, and only
 * then removes the x.com-origin database. A failed or interrupted pass keeps the source intact and
 * is safe to retry on the next page load.
 */
export async function migrateLegacyHostDurableStorage(
  backend: ExtensionDurableStorageBackend,
  factory: IDBFactory | undefined = globalThis.indexedDB
): Promise<HostMigrationResult> {
  if (!factory) {
    return { databaseFound: false, recordsCopied: 0, databaseDeleted: false };
  }
  const database = await openLegacyDatabase(factory);
  if (!database) {
    return { databaseFound: false, recordsCopied: 0, databaseDeleted: false };
  }

  const initial = await readLegacyDatabaseSnapshot(database);
  const initialEntries = await migrationEntries(initial.records);
  await copyMigrationEntries(backend, initialEntries);

  const readyToDelete = initial.sealed || await sealLegacyDatabase(factory, initial.version);
  if (!readyToDelete) {
    return {
      databaseFound: true,
      recordsCopied: initialEntries.length,
      databaseDeleted: false
    };
  }

  // The seal waits for every old connection to close, but a writer can still commit between the
  // initial read and that upgrade. Re-read the sealed source and verify the destination against this
  // final snapshot before asking IndexedDB to delete the only remaining copy.
  const finalDatabase = await openLegacyDatabase(factory);
  if (!finalDatabase) {
    return {
      databaseFound: true,
      recordsCopied: initialEntries.length,
      databaseDeleted: false
    };
  }
  const finalSnapshot = await readLegacyDatabaseSnapshot(finalDatabase);
  const finalEntries = await migrationEntries(finalSnapshot.records);
  await copyMigrationEntries(backend, finalEntries);

  const databaseDeleted = await deleteDatabase(factory);
  if (databaseDeleted) {
    const remaining = await databaseNames(factory);
    if (remaining?.includes(DURABLE_DATABASE_NAME)) {
      throw new Error("The legacy durable database remained after verified migration");
    }
  }
  return {
    databaseFound: true,
    recordsCopied: finalEntries.length,
    databaseDeleted
  };
}

async function readLegacyDatabaseSnapshot(database: IDBDatabase): Promise<LegacyDatabaseSnapshot> {
  const version = database.version;
  const sealed = database.objectStoreNames.contains(LEGACY_MIGRATION_SEAL_STORE);
  try {
    if (!database.objectStoreNames.contains(DURABLE_OBJECT_STORE)) {
      throw new Error("The legacy durable database has no values store");
    }
    return {
      records: await idbRequest<DurableIndexedValue[]>(
        database
          .transaction(DURABLE_OBJECT_STORE, "readonly")
          .objectStore(DURABLE_OBJECT_STORE)
          .getAll()
      ),
      version,
      sealed
    };
  } finally {
    database.close();
  }
}

async function migrationEntries(records: DurableIndexedValue[]): Promise<LegacyMigrationEntry[]> {
  const entries: LegacyMigrationEntry[] = [];
  for (const record of records) {
    if (!record || !validKey(record.key)) {
      throw new Error("The legacy durable database contains an invalid key");
    }
    entries.push({
      key: record.key,
      value: record.value,
      hash: await hashStorageValue(record.value)
    });
  }
  return entries;
}

async function copyMigrationEntries(
  backend: ExtensionDurableStorageBackend,
  entries: LegacyMigrationEntry[]
): Promise<void> {
  for (let offset = 0; offset < entries.length; offset += MIGRATION_BATCH_LIMIT) {
    const batch = entries.slice(offset, offset + MIGRATION_BATCH_LIMIT);
    const receipts = await backend.migrateHostEntries(batch);
    for (const entry of batch) {
      if (receipts[entry.key] !== entry.hash) {
        throw new Error(`Extension storage migration hash mismatch for ${entry.key}`);
      }
    }
  }
}

async function importHostEntries(
  backend: DurableStorageBackend,
  entries: LegacyMigrationEntry[]
): Promise<Record<string, string>> {
  for (const entry of entries) {
    if ((await hashStorageValue(entry.value)) !== entry.hash) {
      throw new Error(`Legacy storage hash mismatch before import for ${entry.key}`);
    }
  }

  const sourceMeta = entries.find((entry) => entry.key === DURABLE_META_KEY)?.value;
  const previousMeta = await backend.getMeta();
  const meta = isDurableStorageMeta(sourceMeta)
    ? sourceMeta
    : {
        schemaVersion: DURABLE_STORAGE_SCHEMA_VERSION,
        migratedKeys: [...new Set([
          ...(previousMeta?.migratedKeys ?? []),
          ...entries.map((entry) => entry.key).filter((key) => key !== DURABLE_META_KEY)
        ])].sort(),
        migratedAt: new Date().toISOString()
      };
  await backend.putMany(
    entries
      .filter((entry) => entry.key !== DURABLE_META_KEY)
      .map((entry) => [entry.key, entry.value]),
    meta
  );

  const hashes: Record<string, string> = {};
  for (const entry of entries) {
    const stored = await backend.get(entry.key);
    if (stored === undefined) {
      throw new Error(`Legacy storage import did not retain ${entry.key}`);
    }
    hashes[entry.key] = await hashStorageValue(stored);
  }
  return hashes;
}

async function openLegacyDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  const names = await databaseNames(factory);
  if (names && !names.includes(DURABLE_DATABASE_NAME)) return null;

  return new Promise((resolve, reject) => {
    const request = factory.open(DURABLE_DATABASE_NAME);
    let created = false;
    let blocked = false;
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        created = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => {
      if (created) resolve(null);
      else reject(request.error ?? new Error("The legacy durable database could not open"));
    };
    // Another new tab may already be deleting the verified source. Let that request finish and
    // continue boot against the shared background database instead of failing both tabs.
    request.onblocked = () => {
      blocked = true;
      resolve(null);
    };
  });
}

async function deleteDatabase(factory: IDBFactory): Promise<boolean> {
  return deleteDatabaseRequest(factory);
}

async function deleteDatabaseRequest(factory: IDBFactory): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    const finish = (deleted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(deleted);
    };
    const request = factory.deleteDatabase(DURABLE_DATABASE_NAME);
    request.onsuccess = () => finish(true);
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("The legacy durable database could not be deleted"));
    };
    // A sealed database cannot be reopened by the old schema. A concurrent new migrator may still
    // block briefly, but letting this request finish later is safe because those clients only read.
    request.onblocked = () => finish(false);
  });
}

async function sealLegacyDatabase(factory: IDBFactory, currentVersion: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const request = factory.open(DURABLE_DATABASE_NAME, currentVersion + 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LEGACY_MIGRATION_SEAL_STORE)) {
        request.result.createObjectStore(LEGACY_MIGRATION_SEAL_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.close();
      if (!blocked) resolve(true);
    };
    request.onerror = () => {
      if (!blocked) {
        reject(request.error ?? new Error("The legacy durable database could not be sealed"));
      }
    };
    // A version upgrade preserves every late write and prevents the old version from reopening.
    // Once the blocking tab closes, the seal commits. The next boot recopies the final values and
    // can delete safely.
    request.onblocked = () => {
      blocked = true;
      resolve(false);
    };
  });
}

async function databaseNames(factory: IDBFactory): Promise<string[] | null> {
  if (typeof factory.databases !== "function") return null;
  const databases = await factory.databases();
  return databases
    .map((database) => database.name)
    .filter((name): name is string => typeof name === "string");
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Legacy IndexedDB request failed"));
  });
}

function validEntries(value: unknown): value is Array<[string, unknown]> {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((entry) => Array.isArray(entry) && entry.length === 2 && validKey(entry[0]))
  );
}

function isLegacyMigrationEntry(value: unknown): value is LegacyMigrationEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<LegacyMigrationEntry>;
  return (
    validKey(entry.key) &&
    "value" in entry &&
    typeof entry.hash === "string" &&
    /^[0-9a-f]{64}$/.test(entry.hash)
  );
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
