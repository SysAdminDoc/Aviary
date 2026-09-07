import {
  diagnosticMessageId,
  isSafeDiagnosticTimestamp,
  redactDiagnosticEvent,
  isSafeDiagnosticMessageId,
  type DiagnosticEvent,
  type DiagnosticLevel
} from "./diagnostics.ts";
import type { StorageGateway } from "./storage.ts";
import { mutateStored, replaceStored } from "./storage-lock.ts";

export const DIAGNOSTICS_KEY = "aviary.diagnostics.v1";
export const DIAGNOSTICS_SCHEMA_VERSION = 2;
export const DIAGNOSTICS_LIMIT = 50;
export const DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The profile-scoped shape written to storage. It contains no display text or detail values. */
export interface StoredDiagnostic {
  at: string;
  level: "warn" | "error";
  messageId: string;
  detailKeys: string[];
}

interface StoredDiagnosticsEnvelope {
  version: number;
  events: StoredDiagnostic[];
}

interface ParsedDiagnostics {
  events: StoredDiagnostic[];
  migrated: boolean;
}

function isPersistedLevel(level: DiagnosticLevel): level is "warn" | "error" {
  return level === "warn" || level === "error";
}

function safeDetailKeys(details: unknown): string[] {
  return Array.isArray(details)
    ? details
        .slice(0, 12)
        .map((key) => (typeof key === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ? key : "unknown"))
    : [];
}

/** Converts a live event to the only warning/error fields allowed to cross the storage boundary. */
export function redactDiagnostic(event: DiagnosticEvent): StoredDiagnostic | null {
  if (!isPersistedLevel(event.level)) {
    return null;
  }
  const redacted = redactDiagnosticEvent(event);
  return {
    at: redacted.at,
    level: event.level,
    messageId: redacted.messageId,
    detailKeys: redacted.detailKeys
  };
}

/** Parses both the current envelope and the pre-F281 shape for options/report consumers. */
export function parseStoredDiagnostics(raw: unknown): StoredDiagnostic[] {
  return parse(raw).events;
}

function parse(raw: unknown): ParsedDiagnostics {
  if (!raw || typeof raw !== "object") {
    return { events: [], migrated: raw !== undefined };
  }
  const candidateEnvelope = raw as Partial<StoredDiagnosticsEnvelope>;
  const events = candidateEnvelope.events;
  if (!Array.isArray(events)) {
    return { events: [], migrated: true };
  }
  const cutoff = Date.now() - DIAGNOSTICS_RETENTION_MS;
  const parsed: StoredDiagnostic[] = [];
  let migrated = candidateEnvelope.version !== DIAGNOSTICS_SCHEMA_VERSION;
  for (const entry of events) {
    if (!entry || typeof entry !== "object") {
      migrated = true;
      continue;
    }
    const candidate = entry as Partial<StoredDiagnostic> & {
      message?: unknown;
      reason?: unknown;
    };
    const at = isSafeDiagnosticTimestamp(candidate.at) ? candidate.at : null;
    const level = candidate.level === "warn" || candidate.level === "error" ? candidate.level : null;
    if (!at || !level) {
      migrated = true;
      continue;
    }
    const timestamp = Date.parse(at);
    if (Number.isFinite(timestamp) && timestamp < cutoff) {
      migrated = true;
      continue;
    }
    const legacyMessage = typeof candidate.message === "string" ? candidate.message : "";
    const messageId = isSafeDiagnosticMessageId(candidate.messageId)
      ? candidate.messageId
      : diagnosticMessageId(legacyMessage);
    const detailKeys = safeDetailKeys(candidate.detailKeys);
    if (
      !isSafeDiagnosticMessageId(candidate.messageId) ||
      "message" in candidate ||
      "reason" in candidate ||
      !Array.isArray(candidate.detailKeys) ||
      detailKeys.some((key, index) => key !== candidate.detailKeys?.[index])
    ) {
      migrated = true;
    }
    parsed.push({ at, level, messageId, detailKeys });
  }
  return { events: parsed.slice(-DIAGNOSTICS_LIMIT), migrated };
}

export class DiagnosticsStore {
  readonly #storage: StorageGateway;
  #events: StoredDiagnostic[] = [];
  #loaded = false;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: StorageGateway) {
    this.#storage = storage;
  }

  async load(): Promise<StoredDiagnostic[]> {
    if (this.#loaded) {
      return this.snapshot();
    }
    let parsed: ParsedDiagnostics;
    try {
      parsed = parse(await this.#storage.get<unknown>(DIAGNOSTICS_KEY, undefined));
    } catch {
      parsed = { events: [], migrated: false };
    }
    this.#events = parsed.events;
    this.#loaded = true;
    if (parsed.migrated) {
      const migration = replaceStored(
        this.#storage,
        DIAGNOSTICS_KEY,
        { version: DIAGNOSTICS_SCHEMA_VERSION, events: this.#events } satisfies StoredDiagnosticsEnvelope
      );
      this.#tail = migration.then(
        () => undefined,
        () => undefined
      );
    }
    return this.snapshot();
  }

  snapshot(): StoredDiagnostic[] {
    return [...this.#events];
  }

  /**
   * Recording must never sit on a caller's path: a failing write is itself reported through
   * diagnostics, so awaiting it here would recurse. Writes are serialized and their rejections
   * swallowed; the in-memory ring stays authoritative for this page.
   */
  record(event: DiagnosticEvent): void {
    const record = redactDiagnostic(event);
    if (!record) {
      return;
    }
    this.#events.push(record);
    if (this.#events.length > DIAGNOSTICS_LIMIT) {
      this.#events = this.#events.slice(-DIAGNOSTICS_LIMIT);
    }
    this.#queue();
  }

  async clear(): Promise<void> {
    this.#events = [];
    this.#loaded = true;
    const clearWrite = this.#tail.then(() =>
      replaceStored(
        this.#storage,
        DIAGNOSTICS_KEY,
        { version: DIAGNOSTICS_SCHEMA_VERSION, events: [] } satisfies StoredDiagnosticsEnvelope
      )
    );
    this.#tail = clearWrite.then(
      () => undefined,
      () => undefined
    );
    await clearWrite;
  }

  async flush(): Promise<void> {
    await this.#tail;
  }

  #queue(): void {
    const record = this.#events.at(-1);
    if (!record) return;
    this.#tail = this.#tail
      .then(async () => {
        const next = await mutateStored<StoredDiagnosticsEnvelope>(
          this.#storage,
          DIAGNOSTICS_KEY,
          { version: DIAGNOSTICS_SCHEMA_VERSION, events: [] },
          (stored) => {
            const events = parse(stored).events;
            events.push(record);
            return {
              version: DIAGNOSTICS_SCHEMA_VERSION,
              events: events.slice(-DIAGNOSTICS_LIMIT)
            };
          },
          { restoreGate: false }
        );
        this.#events = parse(next).events;
      })
      .then(
        () => undefined,
        () => undefined
      );
  }
}
