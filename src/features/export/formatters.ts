import type { ExportArtifact, ExportFormat, ExportRecord } from "./types.ts";
import { describeMediaCapture, serializeExportRecords } from "./assets.ts";
import { reconstructThreads } from "./thread-reconstruction.ts";
import { formatXlsx } from "./xlsx.ts";
import { normalizeAudience } from "./audience.ts";

const TEXT_ENCODER = new TextEncoder();

export function formatExport(format: ExportFormat, records: ExportRecord[]): ExportArtifact {
  switch (format) {
    case "json":
      return jsonArtifact(records);
    case "csv":
      return csvArtifact(records);
    case "html":
      return htmlArtifact(records);
    case "markdown":
      return markdownArtifact(records);
    case "xlsx":
      return formatXlsx(records);
    default:
      return jsonArtifact(records);
  }
}

function jsonArtifact(records: ExportRecord[]): ExportArtifact {
  const json = JSON.stringify(
    {
      generator: "Aviary",
      generatedAt: new Date().toISOString(),
      count: records.length,
      records: serializeExportRecords(records),
      threads: reconstructThreads(records).map((thread) => ({
        id: thread.id,
        rootId: thread.rootId,
        kind: thread.kind,
        postIds: thread.records.map((record) => record.tweetId ?? null),
        gaps: thread.gaps.map((gap) => ({ missingId: gap.missingId, parentId: gap.parentId })),
        authorRuns: thread.authorRuns
      }))
    },
    null,
    2
  );
  return {
    filename: "tweets.json",
    contentType: "application/json",
    data: TEXT_ENCODER.encode(json)
  };
}

function csvArtifact(records: ExportRecord[]): ExportArtifact {
  const headers = [
    "tweetId",
    "handle",
    "displayName",
    "capturedAt",
    "surface",
    "permalink",
    "audience",
    "text",
    "mediaUrls",
    "mediaStatus",
    "mediaManifest"
  ];
  const lines = [headers.join(",")];
  for (const record of records) {
    const captures = record.media.map((media) => describeMediaCapture(media, record.capturedAt));
    const mediaUrls = captures.map((media) => media.sourceUrl).filter(Boolean).join("|");
    const mediaStatus = captures.map((media) => media.status).join("|");
    lines.push(
      [
        record.tweetId ?? "",
        record.handle ?? "",
        record.displayName ?? "",
        record.capturedAt,
        record.surface,
        record.permalink ?? "",
        normalizeAudience(record.audience),
        record.text,
        mediaUrls,
        mediaStatus,
        JSON.stringify(captures)
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return {
    filename: "tweets.csv",
    contentType: "text/csv",
    data: TEXT_ENCODER.encode(`${lines.join("\n")}\n`)
  };
}

/**
 * Post text is attacker-controlled and spreadsheets execute any cell that opens with a
 * formula sigil, so `=HYPERLINK(...)` in a post would run when the export is opened.
 * Prefixing with an apostrophe keeps the text intact and forces a literal cell.
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  const safe = neutralizeFormula(value);
  const needsQuotes = /[,"\r\n]/.test(safe);
  const escaped = safe.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Exported HTML is opened from disk, where a javascript: href would run same-origin as the file. */
function safeHref(value: string): string {
  try {
    const parsed = new URL(value, "https://x.com");
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function htmlArtifact(records: ExportRecord[]): ExportArtifact {
  const rows = records
    .map((record) => {
      const media = record.media
        .map((entry) => {
          const capture = describeMediaCapture(entry, record.capturedAt);
          const href = capture.packagePath
            ? safeRelativeHref(capture.packagePath)
            : safeHref(capture.sourceUrl);
          const label = `${entry.kind} · ${capture.status}`;
          const link = href
            ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
            : escapeHtml(label);
          const details = [
            capture.capturedAt ? `captured ${capture.capturedAt}` : "capture time unknown",
            capture.byteLength === null ? "bytes unknown" : `${capture.byteLength} bytes`,
            capture.sha256 ? `sha256 ${capture.sha256}` : "checksum unknown"
          ].join(" · ");
          const source = capture.sourceUrl && capture.status !== "captured-bytes"
            ? ` <small>source: ${escapeHtml(capture.sourceUrl)}</small>`
            : "";
          return `<li data-capture-status="${escapeHtml(capture.status)}">${link} <small>${escapeHtml(details)}</small>${source}</li>`;
        })
        .join("");
      const permalinkHref = record.permalink ? safeHref(record.permalink) : "";
      const permalink = permalinkHref
        ? `<a href="${escapeHtml(permalinkHref)}" rel="noopener noreferrer">${escapeHtml(permalinkHref)}</a>`
        : "";
      return `<article class="record" data-audience="${normalizeAudience(record.audience)}">
  <header>
    <strong>${escapeHtml(record.displayName ?? record.handle ?? "Unknown")}</strong>
    <span class="handle">@${escapeHtml(record.handle ?? "")}</span>
    <time datetime="${escapeHtml(record.capturedAt)}">${escapeHtml(record.capturedAt)}</time>
  </header>
  <p>${escapeHtml(record.text).replace(/\n/g, "<br>")}</p>
  <ul>${media}</ul>
  <footer>${permalink}</footer>
</article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Aviary export</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; background: #0a0a0a; color: #e7e9ea; padding: 24px; }
article { border: 1px solid #2f3336; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
.handle { color: #71767b; }
time { margin-left: auto; color: #71767b; font-size: 12px; }
ul { padding-left: 18px; }
a { color: #1d9bf0; }
</style>
</head><body>
<h1>Aviary export</h1>
<p>${records.length} records, generated ${new Date().toISOString()}.</p>
<p>Media status is explicit: captured bytes use package-relative links; remote references are not fetched until a link is activated.</p>
${rows}
</body></html>`;

  return {
    filename: "tweets.html",
    contentType: "text/html",
    data: TEXT_ENCODER.encode(html)
  };
}

function markdownArtifact(records: ExportRecord[]): ExportArtifact {
  const sections = records.map((record) => {
    const header = `## ${record.displayName ?? record.handle ?? "Unknown"} (@${record.handle ?? "anon"}) · ${record.capturedAt}`;
    const body = record.text.split("\n").map((line) => `> ${line}`).join("\n");
    const media =
      record.media.length === 0
        ? ""
        : `\n\n${record.media.map((entry) => {
            const capture = describeMediaCapture(entry, record.capturedAt);
            const target = capture.packagePath ?? capture.sourceUrl;
            const label = `${entry.kind} · ${capture.status}`;
            const link = target ? `[${label}](${escapeMarkdownUrl(target)})` : label;
            const details = `captured ${capture.capturedAt ?? "unknown"}; bytes ${capture.byteLength ?? "unknown"}; sha256 ${capture.sha256 ?? "unknown"}`;
            return `- ${link} (${details})`;
          }).join("\n")}`;
    const permalink = record.permalink ? `\n\n${record.permalink}` : "";
    return `${header}\n\nAudience: ${normalizeAudience(record.audience)}\n\n${body}${media}${permalink}`;
  });

  const md = `# Aviary export\n\nGenerated ${new Date().toISOString()} · ${records.length} records. Media links marked remote-reference are not fetched automatically.\n\n${sections.join("\n\n---\n\n")}\n`;

  return {
    filename: "tweets.md",
    contentType: "text/markdown",
    data: TEXT_ENCODER.encode(md)
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeRelativeHref(value: string): string {
  return /^(?:[a-z0-9._-]+\/)*[a-z0-9._/-]+$/i.test(value) ? value : "";
}

function escapeMarkdownUrl(value: string): string {
  return value.replace(/\\/g, "%5C").replace(/\)/g, "%29").replace(/\s/g, "%20");
}
