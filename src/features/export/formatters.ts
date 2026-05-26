import type { ExportArtifact, ExportFormat, ExportRecord } from "./types";
import { formatXlsx } from "./xlsx";

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
      records
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
  const headers = ["tweetId", "handle", "displayName", "capturedAt", "surface", "permalink", "text", "mediaUrls"];
  const lines = [headers.join(",")];
  for (const record of records) {
    const mediaUrls = record.media.map((media) => media.url).join("|");
    lines.push(
      [
        record.tweetId ?? "",
        record.handle ?? "",
        record.displayName ?? "",
        record.capturedAt,
        record.surface,
        record.permalink ?? "",
        record.text,
        mediaUrls
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

function csvCell(value: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  const needsQuotes = /[,"\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function htmlArtifact(records: ExportRecord[]): ExportArtifact {
  const rows = records
    .map((record) => {
      const media = record.media
        .map((entry) => `<li><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.kind)}</a></li>`)
        .join("");
      const permalink = record.permalink
        ? `<a href="${escapeHtml(record.permalink)}">${escapeHtml(record.permalink)}</a>`
        : "";
      return `<article class="record">
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
    const header = `## ${record.displayName ?? record.handle ?? "Unknown"} (@${record.handle ?? "anon"}) — ${record.capturedAt}`;
    const body = record.text.split("\n").map((line) => `> ${line}`).join("\n");
    const media =
      record.media.length === 0
        ? ""
        : `\n\n${record.media.map((entry) => `- [${entry.kind}](${entry.url})`).join("\n")}`;
    const permalink = record.permalink ? `\n\n${record.permalink}` : "";
    return `${header}\n\n${body}${media}${permalink}`;
  });

  const md = `# Aviary export\n\nGenerated ${new Date().toISOString()} — ${records.length} records.\n\n${sections.join("\n\n---\n\n")}\n`;

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
