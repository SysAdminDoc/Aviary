export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  message: string;
  at: string;
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
