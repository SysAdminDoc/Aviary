import type { StorageGateway } from "../../platform/storage";
import type { PersistErrorSink } from "../media/history";

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
  readonly #onPersistError: PersistErrorSink | undefined;
  readonly #isEnabled: (() => boolean) | undefined;
  #entries: AuditEntry[] = [];
  #loaded = false;
  #loading: Promise<void> | undefined;

  constructor(
    storage: StorageGateway,
    limit = AUDIT_LOG_LIMIT,
    onPersistError?: PersistErrorSink,
    /** Read fresh on every write so toggling `privacy.auditLog` takes effect immediately. */
    isEnabled?: () => boolean
  ) {
    this.#storage = storage;
    this.#limit = Math.max(50, limit);
    this.#onPersistError = onPersistError;
    this.#isEnabled = isEnabled;
  }

  async load(): Promise<void> {
    if (this.#loaded) return;
    if (!this.#loading) {
      this.#loading = this.#hydrate();
    }
    await this.#loading;
  }

  async record(action: AuditAction, detail?: Record<string, unknown>): Promise<void> {
    // `privacy.auditLog` used to normalize and round-trip while nothing read it, so turning
    // the local action log off left it recording exactly as before.
    if (this.#isEnabled && !this.#isEnabled()) {
      return;
    }
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
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }
}
