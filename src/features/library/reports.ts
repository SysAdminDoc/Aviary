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
      const detail = entry.detail ? ` · ${JSON.stringify(entry.detail)}` : "";
      lines.push(`- ${entry.at} · ${entry.action}${detail}`);
    }
  }
  lines.push("");

  if (input.snapshots) {
    const { latest, diff } = input.snapshots;
    lines.push(`## Snapshot: ${latest.kind} for @${latest.handle}`);
    lines.push("");
    lines.push(`- Captured: ${latest.capturedAt}`);
    lines.push(`- Source: ${latest.source}`);
    lines.push(`- Total: ${latest.accounts.length}`);
    if (latest.coverage) {
      lines.push(
        `- Coverage: ${latest.coverage.rows} rows rendered, ` +
          `${latest.coverage.reachedEnd ? "list finished loading" : "list still loading"}`
      );
    }
    if (diff) {
      lines.push("");
      lines.push(`### Compared with the capture from ${diff.earlierAt}`);
      if (diff.partial) {
        // The buckets below are still worth printing, but not under a heading that says somebody
        // followed or unfollowed. At least one of these captures saw part of a list.
        lines.push("");
        lines.push(
          "At least one of these captures did not reach the end of its list, so this compares " +
            "two partial views. A handle listed below may simply have been off screen. Scroll " +
            "each list to the end before capturing if you want a comparison that means something."
        );
        lines.push("");
      }
      const sample = (handles: string[]): string =>
        `${handles.slice(0, 30).join(", ") || "none"}${handles.length > 30 ? ", …" : ""}`;
      lines.push(`- Present only in the later capture (${diff.onlyLater.length}): ${sample(diff.onlyLater)}`);
      lines.push(`- Present only in the earlier capture (${diff.onlyEarlier.length}): ${sample(diff.onlyEarlier)}`);
      lines.push(`- Present in both: ${diff.inBoth}`);
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
        lines.push(`- ${candidate.bucket}${guard} · ${handle} · ${candidate.tweetId ?? "unknown"} · "${preview}"`);
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
