import type { DurableStorageBackend } from "../platform/durable-storage.ts";
import { isSafeDiagnosticTimestamp, safeDiagnosticTimestamp } from "../platform/diagnostics.ts";

export const BACKGROUND_DIAGNOSTICS_KEY = "aviary.background.diagnostics.v1";
export const BACKGROUND_DIAGNOSTICS_MESSAGE = "AVIARY_BACKGROUND_DIAGNOSTICS";
export const BACKGROUND_DIAGNOSTICS_LIMIT = 64;

export type BackgroundDiagnosticSeverity = "warn" | "error";

/** Worker-owned diagnostics never carry the failed task's value, URL, filename, or exception. */
export interface BackgroundDiagnostic {
  operation: string;
  severity: BackgroundDiagnosticSeverity;
  at: string;
}

interface BackgroundDiagnosticEnvelope {
  version: 1;
  events: BackgroundDiagnostic[];
}

export interface BackgroundDiagnosticsRequest {
  type: typeof BACKGROUND_DIAGNOSTICS_MESSAGE;
  operation: "read";
}

export function isBackgroundDiagnosticsRequest(value: unknown): value is BackgroundDiagnosticsRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BackgroundDiagnosticsRequest>;
  return candidate.type === BACKGROUND_DIAGNOSTICS_MESSAGE && candidate.operation === "read";
}

export async function readBackgroundDiagnostics(
  backend: DurableStorageBackend | null | undefined
): Promise<BackgroundDiagnostic[]> {
  if (!backend) return [];
  try {
    return parse(await backend.get(BACKGROUND_DIAGNOSTICS_KEY));
  } catch {
    return [];
  }
}

/** Validates a response before a report copies it, even when the worker is older than the page. */
export function parseBackgroundDiagnostics(raw: unknown): BackgroundDiagnostic[] {
  return parse(raw);
}

/** Queues one bounded record without ever retaining the failure that caused it. */
export function recordBackgroundDiagnostic(
  backend: DurableStorageBackend | null | undefined,
  operation: string,
  severity: BackgroundDiagnosticSeverity = "error",
  at = new Date().toISOString()
): void {
  if (!backend || !isSafeOperation(operation) || (severity !== "warn" && severity !== "error")) return;
  const event: BackgroundDiagnostic = {
    operation,
    severity,
    at: safeDiagnosticTimestamp(at)
  };
  backgroundWriteTail = backgroundWriteTail
    .then(async () => {
      const events = parse(await backend.get(BACKGROUND_DIAGNOSTICS_KEY));
      events.push(event);
      await backend.put(BACKGROUND_DIAGNOSTICS_KEY, {
        version: 1,
        events: events.slice(-BACKGROUND_DIAGNOSTICS_LIMIT)
      } satisfies BackgroundDiagnosticEnvelope);
    })
    .then(
      () => undefined,
      () => undefined
  );
}

/** Test and shutdown hook for callers that need the worker ring to be settled before reading it. */
export async function flushBackgroundDiagnostics(): Promise<void> {
  await backgroundWriteTail;
}

function parse(raw: unknown): BackgroundDiagnostic[] {
  if (!raw || typeof raw !== "object") return [];
  const events = (raw as Partial<BackgroundDiagnosticEnvelope>).events;
  if (!Array.isArray(events)) return [];
  const parsed: BackgroundDiagnostic[] = [];
  for (const entry of events) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<BackgroundDiagnostic>;
    if (
      !isSafeOperation(candidate.operation) ||
      (candidate.severity !== "warn" && candidate.severity !== "error") ||
      !isSafeDiagnosticTimestamp(candidate.at)
    ) {
      continue;
    }
    parsed.push({
      operation: candidate.operation,
      severity: candidate.severity,
      at: candidate.at
    });
  }
  return parsed.slice(-BACKGROUND_DIAGNOSTICS_LIMIT);
}

function isSafeOperation(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+){0,5}$/.test(value);
}

let backgroundWriteTail: Promise<void> = Promise.resolve();
