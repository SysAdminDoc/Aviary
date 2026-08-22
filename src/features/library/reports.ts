import type { AuditEntry } from "../core/audit-log.ts";
import type { CleanupPreview } from "./cleanup-preview.ts";
import type { SnapshotDiff, SnapshotEntry } from "./snapshots.ts";

export interface ReportInputs {
  audit: AuditEntry[];
  cleanup?: CleanupPreview;
  snapshots?: {
    latest: SnapshotEntry;
    diff?: SnapshotDiff;
  };
  generatedAt?: string;
  version?: string;
}

export function buildMarkdownReport(input: ReportInputs): string {
  const at = input.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];
  lines.push(`# Aviary report`);
  lines.push("");
  lines.push(`Generated ${at}${input.version ? ` for v${input.version}` : ""}.`);
  lines.push("");

  lines.push(`## Audit log (${input.audit.length} entries)`);
  if (input.audit.length === 0) {
    lines.push("- No entries yet.");
  } else {
    for (const entry of input.audit.slice(-50)) {
      const detail = entry.detail ? ` — ${JSON.stringify(entry.detail)}` : "";
      lines.push(`- ${entry.at} · ${entry.action}${detail}`);
    }
  }
  lines.push("");

  if (input.snapshots) {
    const { latest, diff } = input.snapshots;
    lines.push(`## Snapshot — ${latest.kind} for @${latest.handle}`);
    lines.push("");
    lines.push(`- Captured: ${latest.capturedAt}`);
    lines.push(`- Source: ${latest.source}`);
    lines.push(`- Total: ${latest.accounts.length}`);
    if (diff) {
      lines.push("");
      lines.push(`### Diff vs ${diff.earlierAt}`);
      lines.push(`- Added (${diff.added.length}): ${diff.added.slice(0, 30).join(", ") || "—"}${diff.added.length > 30 ? ", …" : ""}`);
      lines.push(`- Removed (${diff.removed.length}): ${diff.removed.slice(0, 30).join(", ") || "—"}${diff.removed.length > 30 ? ", …" : ""}`);
      lines.push(`- Unchanged: ${diff.unchanged}`);
    }
    lines.push("");
  }

  if (input.cleanup) {
    const cleanup = input.cleanup;
    lines.push(`## Cleanup preview (no destructive action)`);
    lines.push("");
    lines.push(`- Generated: ${cleanup.generatedAt}`);
    lines.push(`- Total candidates: ${cleanup.candidates.length}`);
    lines.push(`- Protected: ${cleanup.protectedCount}`);
    for (const [bucket, count] of Object.entries(cleanup.byBucket)) {
      lines.push(`  - ${bucket}: ${count}`);
    }
    if (cleanup.candidates.length > 0) {
      lines.push("");
      lines.push("### Sample (first 20)");
      for (const candidate of cleanup.candidates.slice(0, 20)) {
        const guard = candidate.protected ? " [protected]" : "";
        const handle = candidate.handle ? `@${candidate.handle}` : "(unknown)";
        const preview = candidate.text.slice(0, 80).replace(/\s+/g, " ");
        lines.push(`- ${candidate.bucket}${guard} · ${handle} · ${candidate.tweetId ?? "—"} · "${preview}"`);
      }
    }
    lines.push("");
  }

  lines.push("## Reminder");
  lines.push("");
  lines.push("Aviary never deletes anything for you in this release. The cleanup preview is read-only; destructive actions stay disabled per the v1.0 trust contract.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}
