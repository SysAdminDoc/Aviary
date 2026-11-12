import {
  isStorageLockFence,
  STORAGE_FENCE_OPERATION_PREFIX,
  STORAGE_FENCE_RECEIPT_SUFFIX,
  type StorageLockFence
} from "./storage-fence.ts";

/**
 * The immutable records behind a fenced write, and the rules for reading and trimming them.
 *
 * Every fenced write appends an operation and its receipt before it materializes the plain key, so
 * a stale owner's late copy can be recognized and ignored. Reads only ever consult the newest
 * committed operation plus whichever operation explains the plain copy. Everything else is dead
 * weight, and keeping it forever turned a week of ordinary saves into tens of thousands of keys
 * that every read had to deserialize.
 */
export interface FenceOperationRecord {
  version: 1;
  operationId: string;
  storageKey: string;
  kind: "set" | "remove";
  value?: unknown;
  fence: StorageLockFence;
}

export interface FenceReceiptRecord {
  version: 1;
  operationId: string;
  committedAt: number;
}

interface FenceEntry {
  operationKey: string;
  operation: FenceOperationRecord;
  receipt: FenceReceiptRecord;
}

/** Raw values keyed by storage key: the plain copy (when present) plus its operation records. */
export type FenceRecords = Record<string, unknown>;

export function fenceOperationPrefix(storageKey: string): string {
  return `${STORAGE_FENCE_OPERATION_PREFIX}${encodeURIComponent(storageKey)}.`;
}

export function fenceOperationKey(storageKey: string, operationId: string): string {
  return `${fenceOperationPrefix(storageKey)}${encodeURIComponent(operationId)}`;
}

/** Whether a stored key belongs to `storageKey`: its plain copy or one of its fence records. */
export function isFenceRecordKeyFor(key: string, storageKey: string): boolean {
  return key === storageKey || key.startsWith(fenceOperationPrefix(storageKey));
}

/** The storage keys that own at least one operation record in `records`. */
export function fencedStorageKeys(records: FenceRecords): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(records)) {
    if (!isOperationRecordKey(key)) continue;
    if (isFenceOperation(value) && key.startsWith(fenceOperationPrefix(value.storageKey))) {
      keys.add(value.storageKey);
    }
  }
  return keys;
}

/**
 * The value a read of `storageKey` returns when fenced records decide it.
 *
 * `found: false` means no committed operation exists and the plain copy is authoritative.
 */
export function resolveFencedValue(
  records: FenceRecords,
  storageKey: string,
  fallback: unknown
): { found: boolean; value: unknown } {
  const entries = fenceEntries(records, storageKey);
  const best = newestCommitted(entries);
  if (!best) return { found: false, value: fallback };
  // A plain write is still supported for migration and older releases. Trust it only when no
  // fenced operation can explain the materialized bytes. A delayed owner can leave a stale copy
  // behind, but its receipt is past its expiry and therefore cannot masquerade as a newer direct
  // write. When no plain value exists, the committed immutable record is the materialized value.
  const rawPresent = Object.prototype.hasOwnProperty.call(records, storageKey);
  if (rawPresent && !entries.some((entry) => explainsRaw(entry, records[storageKey]))) {
    return { found: true, value: records[storageKey] };
  }
  return {
    found: true,
    value: best.operation.kind === "remove" ? fallback : best.operation.value
  };
}

/**
 * Operation and receipt keys a read of `storageKey` no longer consults.
 *
 * Only committed operations older than the newest one are dropped, and one that still explains the
 * plain copy is kept, so `resolveFencedValue` answers the same before and after. Late or
 * receipt-less operations stay: a frozen tab may still be about to materialize them, and their
 * record is what stops that copy from reading as a direct write.
 */
export function supersededFenceRecordKeys(records: FenceRecords, storageKey: string): string[] {
  const entries = fenceEntries(records, storageKey);
  const best = newestCommitted(entries);
  if (!best) return [];
  const keep = new Set<FenceEntry>([best]);
  const rawPresent = Object.prototype.hasOwnProperty.call(records, storageKey);
  if (rawPresent && !explainsRaw(best, records[storageKey])) {
    const explainers = entries.filter((entry) => explainsRaw(entry, records[storageKey]));
    if (explainers.length > 0 && explainers.every(isCommitted)) keep.add(explainers[explainers.length - 1]!);
  }
  return entries
    .filter((entry) => isCommitted(entry) && !keep.has(entry))
    .flatMap((entry) => [entry.operationKey, `${entry.operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`]);
}

/**
 * Whether a fenced remove would leave every read unchanged.
 *
 * True when the plain copy is already gone and the newest committed operation is itself a remove.
 * That operation keeps defending against a stale owner's late copy, so writing another is pure
 * growth. This was the common case: every durable save under a lock clears the legacy copy.
 */
export function fencedRemoveIsNoop(records: FenceRecords, storageKey: string): boolean {
  if (Object.prototype.hasOwnProperty.call(records, storageKey)) return false;
  return newestCommitted(fenceEntries(records, storageKey))?.operation.kind === "remove";
}

export function isFenceOperation(value: unknown, storageKey?: string): value is FenceOperationRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operation = value as Partial<FenceOperationRecord>;
  return (
    operation.version === 1 &&
    typeof operation.operationId === "string" &&
    operation.operationId.length > 0 &&
    typeof operation.storageKey === "string" &&
    (storageKey === undefined || operation.storageKey === storageKey) &&
    (operation.kind === "set" || operation.kind === "remove") &&
    isStorageLockFence(operation.fence)
  );
}

export function isFenceReceipt(value: unknown): value is FenceReceiptRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<FenceReceiptRecord>;
  return (
    receipt.version === 1 &&
    typeof receipt.operationId === "string" &&
    receipt.operationId.length > 0 &&
    typeof receipt.committedAt === "number" &&
    Number.isFinite(receipt.committedAt)
  );
}

function isOperationRecordKey(key: string): boolean {
  return (
    key.startsWith(STORAGE_FENCE_OPERATION_PREFIX) &&
    !key.endsWith(STORAGE_FENCE_RECEIPT_SUFFIX) &&
    !key.endsWith(".materialized")
  );
}

function fenceEntries(records: FenceRecords, storageKey: string): FenceEntry[] {
  const prefix = fenceOperationPrefix(storageKey);
  const entries: FenceEntry[] = [];
  for (const [operationKey, operation] of Object.entries(records)) {
    if (!operationKey.startsWith(prefix) || !isOperationRecordKey(operationKey)) continue;
    const receipt = records[`${operationKey}${STORAGE_FENCE_RECEIPT_SUFFIX}`];
    if (!isFenceOperation(operation, storageKey) || !isFenceReceipt(receipt)) continue;
    entries.push({ operationKey, operation, receipt });
  }
  return entries;
}

function isCommitted(entry: FenceEntry): boolean {
  return (
    entry.receipt.operationId === entry.operation.operationId &&
    entry.receipt.committedAt <= entry.operation.fence.expiresAt
  );
}

function newestCommitted(entries: readonly FenceEntry[]): FenceEntry | undefined {
  let best: FenceEntry | undefined;
  for (const entry of entries) {
    if (isCommitted(entry) && (!best || compareEntries(best, entry) < 0)) best = entry;
  }
  return best;
}

function explainsRaw(entry: FenceEntry, raw: unknown): boolean {
  return entry.operation.kind === "set" && storageValuesEqual(raw, entry.operation.value);
}

/**
 * Commit order, newest last.
 *
 * Commit time comes first. A generation only orders owners within one lease: the register hands
 * out a ticket one past the current contenders, so it restarts after every release, and an old
 * contended write would otherwise outrank every write made since. A committed receipt already
 * proves its owner held a live lease, which is what rules out a stale owner.
 */
function compareEntries(left: FenceEntry, right: FenceEntry): number {
  const generation =
    left.operation.fence.name === right.operation.fence.name
      ? left.operation.fence.generation - right.operation.fence.generation
      : 0;
  return (
    left.receipt.committedAt - right.receipt.committedAt ||
    generation ||
    operationSequence(left.operation.operationId) - operationSequence(right.operation.operationId) ||
    left.operation.fence.owner.localeCompare(right.operation.fence.owner) ||
    left.operationKey.localeCompare(right.operationKey)
  );
}

/**
 * The writer's counter inside an operation id (`<time36>-<seq36>-<random>`).
 *
 * Saves inside one millisecond tie on commit time, and the ids do not sort as strings: base 36
 * puts "10" before "9", so the tenth save of a burst could read as older than the ninth.
 */
function operationSequence(operationId: string): number {
  const sequence = Number.parseInt(operationId.split("-")[1] ?? "", 36);
  return Number.isSafeInteger(sequence) ? sequence : -1;
}

export function storageValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => storageValuesEqual(value, right[index]))
    );
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && storageValuesEqual(leftRecord[key], rightRecord[key])
      )
    );
  }
  return false;
}
