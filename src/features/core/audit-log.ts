import type { StorageGateway } from "../../platform/storage";
import { mutateStored, replaceStored } from "../../platform/storage-lock";
import type { PersistErrorSink } from "../media/history";

export const AUDIT_LOG_KEY = "aviary.audit.v1";
export const AUDIT_LOG_LIMIT = 500;

export type AuditAction =
  | "media.download"
  | "media.download.opened"
  | "media.download.duplicate"
  | "media.download.failed"
  | "media.batch"
  | "filter.applied"
  | "post.hide"
  | "post.unhide"
  | "post.hide.cleared"
  | "bookmark.save"
  | "bookmark.update"
  | "bookmark.remove"
  | "bookmark.clear"
  | "export.start"
  | "export.complete"
  | "export.failed"
  | "capture.payload"
  | "settings.reset"
  | "settings.import"
  | "settings.export"
  | "library.backup.export"
  | "library.backup.restore"
  | "preset.apply"
  | "crosspost"
  | "aria2.cancel"
  | "cleanup.enqueue"
  | "semantic.index"
  | "snippet.insert"
  | "diagnostics.copy"
  | "diagnostics.clear"
  | "bisect.start"
  | "bisect.result"
  | "link.copy";

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
    await this.#persist([entry]);
  }

  snapshot(): AuditSnapshot {
    return { entries: [...this.#entries] };
  }

  async clear(): Promise<void> {
    this.#entries = [];
    this.#loaded = true;
    // A replace: clearing the local action log must not leave another tab's copy behind.
    try {
      await replaceStored<AuditSnapshot>(this.#storage, AUDIT_LOG_KEY, { entries: [] });
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }

  size(): number {
    return this.#entries.length;
  }

  async #hydrate(): Promise<void> {
    const stored = await this.#storage.get<AuditSnapshot>(AUDIT_LOG_KEY, EMPTY);
    this.#entries = readAuditEntries(stored).slice(-this.#limit);
    this.#loaded = true;
  }

  /**
   * Appends into what is stored rather than over it.
   *
   * The log is a bounded ring of what happened locally, and two tabs each writing their own copy
   * meant one tab's actions were simply missing from the record the user is told is complete.
   * Merged by (time, action, detail) so the same entry arriving twice does not duplicate it.
   */
  async #persist(added: AuditEntry[]): Promise<void> {
    try {
      const merged = await mutateStored<AuditSnapshot>(
        this.#storage,
        AUDIT_LOG_KEY,
        EMPTY,
        (stored) => {
          const seen = new Map<string, AuditEntry>();
          // Only this call's entry: merging the whole local ring would restore lines a
          // "Clear audit log" in another tab had just removed.
          for (const entry of [...readAuditEntries(stored), ...added]) {
            seen.set(auditIdentity(entry), entry);
          }
          const ordered = [...seen.values()].sort((left, right) =>
            left.at < right.at ? -1 : left.at > right.at ? 1 : 0
          );
          return { entries: ordered.slice(-this.#limit) };
        }
      );
      this.#entries = readAuditEntries(merged);
    } catch (error) {
      this.#onPersistError?.(error);
    }
  }
}

function readAuditEntries(stored: AuditSnapshot | undefined): AuditEntry[] {
  const entries = Array.isArray(stored?.entries) ? stored.entries : [];
  return entries.filter(
    (entry): entry is AuditEntry =>
      typeof entry?.at === "string" && typeof entry?.action === "string"
  );
}

/**
 * What makes two log lines the same line.
 *
 * The merge runs on every persist, so this tab's own entries meet themselves on the way back in.
 * Time and action alone are not enough -- two downloads inside the same millisecond are two
 * events -- so the detail is part of the identity.
 */
function auditIdentity(entry: AuditEntry): string {
  return `${entry.at}|${entry.action}|${entry.detail ? JSON.stringify(entry.detail) : ""}`;
}
