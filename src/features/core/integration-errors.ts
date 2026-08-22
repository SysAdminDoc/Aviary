import type { AuditEntry } from "./audit-log.ts";

/**
 * Actions that can carry a failure. `export.start`/`export.complete` are no longer in this set
 * because crosspost and aria2 cancel stopped masquerading as them -- they have their own kinds
 * now, so this reads the log rather than working around how it was written.
 */
const ERROR_ACTIONS = new Set([
  "media.download.failed",
  "crosspost",
  "aria2.cancel",
  "semantic.index",
  "export.complete"
]);

export interface IntegrationErrorEntry {
  at: string;
  kind: string;
  message: string;
  details?: Record<string, unknown>;
}

export function recentIntegrationErrors(
  entries: readonly AuditEntry[],
  limit = 10
): IntegrationErrorEntry[] {
  const errors: IntegrationErrorEntry[] = [];
  // Walk the log newest-first so the latest issues surface first.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (!ERROR_ACTIONS.has(entry.action) && entry.action !== "diagnostics.copy") continue;
    const detail = entry.detail ?? {};
    const failed = detail.error || detail.ok === false || entry.action === "media.download.failed";
    if (!failed) continue;
    errors.push({
      at: entry.at,
      kind: pickKind(entry.action, detail),
      message: String(detail.error ?? detail.message ?? entry.action),
      details: detail
    });
    if (errors.length >= limit) break;
  }
  return errors;
}

function pickKind(action: string, detail: Record<string, unknown>): string {
  if (typeof detail.target === "string") return `crosspost:${detail.target}`;
  if (typeof detail.kind === "string") return String(detail.kind);
  if (action === "media.download.failed") return "media";
  return action;
}
