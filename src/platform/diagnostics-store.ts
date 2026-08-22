import type { DiagnosticEvent, DiagnosticLevel } from "./diagnostics.ts";
import type { StorageGateway } from "./storage.ts";

export const DIAGNOSTICS_KEY = "aviary.diagnostics.v1";
export const DIAGNOSTICS_LIMIT = 50;
export const DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REASON_LENGTH = 200;

/**
 * A bounded, profile-scoped record of the warnings and errors Aviary produced.
 *
 * The in-memory ring is lost on reload, which is exactly when a failure matters: a user cannot
 * report what evaporated on refresh. Only `warn` and `error` are persisted — `info` is a running
 * commentary and would evict the failures it sits next to.
 *
 * What is retained is deliberately narrow. Diagnostic messages are literals authored in this
 * repository, never page content, so the message itself carries no post text, handle, or URL.
 * Detail *values* can be anything a caller passed, so only their keys are kept, plus a truncated
 * reason string for errors that report one. Nothing else from `details` survives.
 */
export interface StoredDiagnostic {
  at: string;
  level: "warn" | "error";
  message: string;
  detailKeys: string[];
  reason?: string;
}

interface StoredDiagnostics {
  version: 1;
  events: StoredDiagnostic[];
}

function isPersistedLevel(level: DiagnosticLevel): level is "warn" | "error" {
  return level === "warn" || level === "error";
}

export function redactDiagnostic(event: DiagnosticEvent): StoredDiagnostic | null {
  if (!isPersistedLevel(event.level)) {
    return null;
  }
  const details = event.details ?? {};
  const detailKeys = Object.keys(details).slice(0, 12);
  const rawReason = details.message ?? details.error ?? details.reason;
  const record: StoredDiagnostic = {
    at: event.at,
    level: event.level,
    message: String(event.message).slice(0, MAX_REASON_LENGTH),
    detailKeys
  };
  if (typeof rawReason === "string" && rawReason.length > 0) {
    record.reason = rawReason.slice(0, MAX_REASON_LENGTH);
  }
  return record;
}

function parse(raw: unknown): StoredDiagnostic[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const events = (raw as Partial<StoredDiagnostics>).events;
  if (!Array.isArray(events)) {
    return [];
  }
  const cutoff = Date.now() - DIAGNOSTICS_RETENTION_MS;
  const parsed: StoredDiagnostic[] = [];
  for (const entry of events) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<StoredDiagnostic>;
    const at = typeof candidate.at === "string" ? candidate.at : null;
    const level = candidate.level === "warn" || candidate.level === "error" ? candidate.level : null;
    if (!at || !level || typeof candidate.message !== "string") {
      continue;
    }
    const timestamp = Date.parse(at);
    if (Number.isFinite(timestamp) && timestamp < cutoff) {
      continue;
    }
    const record: StoredDiagnostic = {
      at,
      level,
      message: candidate.message.slice(0, MAX_REASON_LENGTH),
      detailKeys: Array.isArray(candidate.detailKeys)
        ? candidate.detailKeys.filter((key): key is string => typeof key === "string").slice(0, 12)
        : []
    };
    if (typeof candidate.reason === "string" && candidate.reason.length > 0) {
      record.reason = candidate.reason.slice(0, MAX_REASON_LENGTH);
    }
    parsed.push(record);
  }
  return parsed.slice(-DIAGNOSTICS_LIMIT);
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
    try {
      this.#events = parse(await this.#storage.get<unknown>(DIAGNOSTICS_KEY, undefined));
    } catch {
      this.#events = [];
    }
    this.#loaded = true;
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
    await this.#storage.set(DIAGNOSTICS_KEY, { version: 1, events: [] } satisfies StoredDiagnostics);
  }

  async flush(): Promise<void> {
    await this.#tail;
  }

  #queue(): void {
    const payload: StoredDiagnostics = { version: 1, events: this.snapshot() };
    this.#tail = this.#tail
      .then(() => this.#storage.set(DIAGNOSTICS_KEY, payload))
      .then(
        () => undefined,
        () => undefined
      );
  }
}
