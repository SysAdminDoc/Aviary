export type DiagnosticLevel = "info" | "warn" | "error";

export interface DiagnosticEvent {
  level: DiagnosticLevel;
  message: string;
  at: string;
  details?: Record<string, unknown>;
}

export class Diagnostics {
  readonly #events: DiagnosticEvent[] = [];

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
  }
}
