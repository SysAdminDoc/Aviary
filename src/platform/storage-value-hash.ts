/**
 * Stable SHA-256 receipts for values copied between storage authorities.
 *
 * Extension messaging and IndexedDB both preserve JSON-shaped values, but object property order is
 * not a useful integrity boundary. The tagged representation below sorts object keys before
 * hashing, so the sender and receiver agree even after a structured clone.
 */
export async function hashStorageValue(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 is unavailable in this browser context");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(value, new Set<object>())));
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Measures the serialized payload before a userscript manager is asked to accept it. */
export function storageValueBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return new TextEncoder().encode(String(value)).byteLength;
  }
  return new TextEncoder().encode(serialized).byteLength;
}

type CanonicalValue =
  | null
  | string
  | ["boolean", boolean]
  | ["number", string]
  | ["bigint", string]
  | ["undefined"]
  | ["date", string]
  | ["bytes", number[]]
  | ["array", CanonicalValue[]]
  | ["object", Array<[string, CanonicalValue]>];

function canonicalValue(value: unknown, seen: Set<object>): CanonicalValue {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["number", "NaN"];
    if (value === Number.POSITIVE_INFINITY) return ["number", "Infinity"];
    if (value === Number.NEGATIVE_INFINITY) return ["number", "-Infinity"];
    if (Object.is(value, -0)) return ["number", "-0"];
    return ["number", String(value)];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return ["undefined"];
  }

  if (seen.has(value)) {
    throw new Error("Storage values must not contain cycles");
  }
  seen.add(value);
  try {
    if (value instanceof Date) return ["date", value.toISOString()];
    if (value instanceof ArrayBuffer) {
      return ["bytes", Array.from(new Uint8Array(value))];
    }
    if (ArrayBuffer.isView(value)) {
      return [
        "bytes",
        Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      ];
    }
    if (Array.isArray(value)) {
      return ["array", value.map((entry) => canonicalValue(entry, seen))];
    }
    const entries = Object.keys(value)
      .sort()
      .map((key): [string, CanonicalValue] => [
        key,
        canonicalValue((value as Record<string, unknown>)[key], seen)
      ]);
    return ["object", entries];
  } finally {
    seen.delete(value);
  }
}
