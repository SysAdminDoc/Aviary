import type { StorageGateway } from "../../platform/storage";

export const AUDIT_LOG_KEY = "aviary.audit.v1";
export const AUDIT_LOG_LIMIT = 500;

export type AuditAction =
  | "media.download"
  | "media.download.duplicate"
  | "media.download.failed"
  | "filter.applied"
  | "post.hide"
  | "post.unhide"
  | "post.hide.cleared"
  | "export.start"
  | "export.complete"
  | "settings.import"
  | "settings.export"
  | "diagnostics.copy";

export interface AuditEntry {
  at: string;
  action: AuditAction;
  detail?: Record<string, unknown>;
}

export interface AuditSnapshot {
  entries: AuditEntry[];
}

const EMPTY: AuditSnapshot = { entries: [] };

export class AuditLog {
  readonly #storage: StorageGateway;
  readonly #limit: number;
  #entries: AuditEntry[] = [];
  #loaded = false;
  #loading: Promise<void> | undefined;

  constructor(storage: StorageGateway, limit = AUDIT_LOG_LIMIT) {
    this.#storage = storage;
    this.#limit = Math.max(50, limit);
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    if (!this.#loading) {
      this.#loading = this.#hydrate();
    }
    await this.#loading;
  }

  async record(action: AuditAction, detail?: Record<string, unknown>): Promise<void> {
    await this.load();
    const entry: AuditEntry = { at: new Date().toISOString(), action };
    if (detail) entry.detail = detail;
    this.#entries.push(entry);
    while (this.#entries.length > this.#limit) {
      this.#entries.shift();
    }
    await this.#persist();
  }

  snapshot(): AuditSnapshot {
    return { entries: [...this.#entries] };
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#loaded = true;
    await this.#persist();
  }

  size(): number {
    return this.#entries.length;
  }

  async #hydrate(): Promise<void> {
    const stored = await this.#storage.get<AuditSnapshot>(AUDIT_LOG_KEY, EMPTY);
    const entries = Array.isArray(stored?.entries) ? stored.entries : [];
    this.#entries = entries
      .filter(
        (entry): entry is AuditEntry =>
          typeof entry?.at === "string" && typeof entry?.action === "string"
      )
      .slice(-this.#limit);
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    try {
      await this.#storage.set(AUDIT_LOG_KEY, { entries: this.#entries });
    } catch {
      // best effort
    }
  }
}
