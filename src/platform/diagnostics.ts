export type DiagnosticLevel = "info" | "warn" | "error";

export const UNKNOWN_DIAGNOSTIC_MESSAGE_ID = "diagnostic.unknown";

/** The content-free shape used when a diagnostic crosses a persistence or clipboard boundary. */
export interface RedactedDiagnostic {
  level: DiagnosticLevel;
  at: string;
  messageId: string;
  detailKeys: string[];
}

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  message: string;
  at: string;
  /** Stable id generated from the authored message. The display text remains page-local. */
  messageId?: string;
  details?: Record<string, unknown>;
}

export type DiagnosticSink = (event: DiagnosticEvent) => void;

export class Diagnostics {
  readonly #events: DiagnosticEvent[] = [];
  #sink: DiagnosticSink | undefined;

  /**
   * Mirror events to a persistent store. The sink runs inside `push`, so it must not throw and
   * must not await: every caller of `info`/`warn`/`error` is on a feature's hot path.
   */
  setSink(sink: DiagnosticSink | undefined): void {
    this.#sink = sink;
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.push("info", message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.push("warn", message, details);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.push("error", message, details);
  }

  snapshot(): DiagnosticEvent[] {
    return [...this.#events];
  }

  private push(level: DiagnosticLevel, message: string, details?: Record<string, unknown>): void {
    const event: DiagnosticEvent = {
      level,
      message,
      at: new Date().toISOString(),
      messageId: diagnosticMessageId(message),
      ...(details ? { details } : {})
    };
    this.#events.push(event);
    if (this.#events.length > 200) {
      this.#events.shift();
    }
    try {
      this.#sink?.(event);
    } catch {
      // A diagnostics sink that fails must never break the code being diagnosed.
    }
  }
}

/**
 * Generates a stable opaque id without retaining the authored sentence or any interpolated value.
 * A short non-cryptographic digest is enough for grouping diagnostics; it is not an identity claim.
 */
export function diagnosticMessageId(message: string): string {
  const source = message.trim();
  if (!source) {
    return UNKNOWN_DIAGNOSTIC_MESSAGE_ID;
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `diagnostic.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function safeDetailKeys(details: Record<string, unknown> | undefined): string[] {
  return Object.keys(details ?? {})
    .slice(0, 12)
    .map((key) => (/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) ? key : "unknown"));
}

/** Removes all diagnostic message and detail values before a report leaves the page. */
export function redactDiagnosticEvent(event: DiagnosticEvent): RedactedDiagnostic {
  return {
    level: event.level,
    at: safeDiagnosticTimestamp(event.at),
    messageId: isSafeDiagnosticMessageId(event.messageId)
      ? event.messageId!
      : diagnosticMessageId(event.message),
    detailKeys: safeDetailKeys(event.details)
  };
}

export function isSafeDiagnosticTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function safeDiagnosticTimestamp(value: unknown): string {
  return isSafeDiagnosticTimestamp(value) ? value : new Date().toISOString();
}

export function isSafeDiagnosticMessageId(value: unknown): value is string {
  return typeof value === "string" && /^(?:diagnostic|background)\.[a-z0-9][a-z0-9._-]{0,95}$/.test(value);
}
