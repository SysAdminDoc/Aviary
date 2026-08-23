import {
  DURABLE_DATABASE_NAME,
  DURABLE_META_KEY,
  DURABLE_OBJECT_STORE,
  DURABLE_STORAGE_SCHEMA_VERSION,
  isDurablePendingWrite,
  isDurableStorageMeta,
  type DurableIndexedValue,
  type DurablePendingWrite,
  type DurablePendingWriteReceipt,
  type DurableStorageBackend,
  type DurableStorageEstimate,
  type DurableStorageMeta
} from "../platform/durable-storage.ts";
import { hashStorageValue } from "../platform/storage-value-hash.ts";

export const DURABLE_STORAGE_MESSAGE = "AVIARY_DURABLE_STORAGE";
const MIGRATION_BATCH_LIMIT = 16;
const MAX_KEY_LENGTH = 512;

type DurableStorageRequest =
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "get"; key: string }
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "put"; key: string; value: unknown }
  | { type: typeof DURABLE_STORAGE_MESSAGE; operation: "remove"; key: string }
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
    }
  | {
      type: typeof DURABLE_STORAGE_MESSAGE;
      operation: "commit-pending";
      write: DurablePendingWrite;
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
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "get",
      key
    }));
    return result.found === true ? result.value : undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.#call({ type: DURABLE_STORAGE_MESSAGE, operation: "put", key, value });
  }

  async remove(key: string): Promise<void> {
    await this.#call({ type: DURABLE_STORAGE_MESSAGE, operation: "remove", key });
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

  async stagePendingWrite(write: DurablePendingWrite): Promise<void> {
    await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "stage-pending",
      write
    });
  }

  async commitPendingWrite(write: DurablePendingWrite): Promise<DurablePendingWriteReceipt> {
    const result = asRecord(await this.#call({
      type: DURABLE_STORAGE_MESSAGE,
      operation: "commit-pending",
      write
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
  if (request.operation === "get" || request.operation === "put" || request.operation === "remove") {
    return validKey(request.key) && (request.operation !== "put" || "value" in request);
  }
  if (request.operation === "put-many") {
    return validEntries(request.entries) && isDurableStorageMeta(request.meta);
  }
  if (request.operation === "stage-pending" || request.operation === "commit-pending") {
    return isDurablePendingWrite(request.write);
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
  backend: DurableStorageBackend
): Promise<DurableStorageResponse> {
  try {
    switch (request.operation) {
      case "get": {
        const value = await backend.get(request.key);
        return { ok: true, result: value === undefined ? { found: false } : { found: true, value } };
      }
      case "put":
        await backend.put(request.key, request.value);
        return { ok: true, result: null };
      case "remove":
        await backend.remove(request.key);
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
        await backend.stagePendingWrite(request.write);
        return { ok: true, result: null };
      case "commit-pending":
        return { ok: true, result: await backend.commitPendingWrite(request.write) };
      case "migrate-host":
        return { ok: true, result: { hashes: await importHostEntries(backend, request.entries) } };
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
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

  let records: DurableIndexedValue[];
  try {
    if (!database.objectStoreNames.contains(DURABLE_OBJECT_STORE)) {
      throw new Error("The legacy durable database has no values store");
    }
    records = await idbRequest<DurableIndexedValue[]>(
      database
        .transaction(DURABLE_OBJECT_STORE, "readonly")
        .objectStore(DURABLE_OBJECT_STORE)
        .getAll()
    );
  } finally {
    database.close();
  }

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

  for (let offset = 0; offset < entries.length; offset += MIGRATION_BATCH_LIMIT) {
    const batch = entries.slice(offset, offset + MIGRATION_BATCH_LIMIT);
    const receipts = await backend.migrateHostEntries(batch);
    for (const entry of batch) {
      if (receipts[entry.key] !== entry.hash) {
        throw new Error(`Extension storage migration hash mismatch for ${entry.key}`);
      }
    }
  }

  await deleteDatabase(factory);
  const remaining = await databaseNames(factory);
  if (remaining?.includes(DURABLE_DATABASE_NAME)) {
    throw new Error("The legacy durable database remained after verified migration");
  }
  return {
    databaseFound: true,
    recordsCopied: entries.length,
    databaseDeleted: true
  };
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
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        created = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (created) resolve(null);
      else reject(request.error ?? new Error("The legacy durable database could not open"));
    };
    request.onblocked = () => reject(new Error("The legacy durable database is open in another tab"));
  });
}

async function deleteDatabase(factory: IDBFactory): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(DURABLE_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("The legacy durable database could not be deleted"));
    request.onblocked = () => reject(new Error("The legacy durable database is open in another tab"));
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
