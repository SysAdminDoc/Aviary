import type { ExportArtifact, ExportRecord } from "./types.ts";
import { describeMediaCapture, serializeExportRecords } from "./assets.ts";

const ENCODER = new TextEncoder();

export type ExternalTargetId = "clipboard-markdown" | "obsidian" | "notion" | "raw-json";

export interface ExternalTargetResult {
  id: ExternalTargetId;
  artifact?: ExportArtifact;
  payload?: string;
}

export function renderForExternalTarget(
  target: ExternalTargetId,
  records: readonly ExportRecord[]
): ExternalTargetResult {
  switch (target) {
    case "clipboard-markdown":
      return { id: target, payload: toPlainMarkdown(records) };
    case "obsidian":
      return { id: target, artifact: toObsidianArtifact(records) };
    case "notion":
      return { id: target, artifact: toNotionArtifact(records) };
    case "raw-json":
      return { id: target, artifact: toJsonArtifact(records) };
    default:
      return { id: "clipboard-markdown", payload: toPlainMarkdown(records) };
  }
}

function toPlainMarkdown(records: readonly ExportRecord[]): string {
  const lines = records.map((record) => {
    const handle = record.handle ? `@${record.handle}` : "(unknown)";
    const permalink = record.permalink ? ` · [link](${markdownUrl(record.permalink)})` : "";
    const body = record.text.split("\n").map((line) => `> ${line}`).join("\n");
    const media = record.media.map((entry) => {
      const capture = describeMediaCapture(entry, record.capturedAt);
      return `- ${entry.kind} · ${capture.status}: ${capture.sourceUrl || "no source URL"}; bytes ${capture.byteLength ?? "unknown"}; sha256 ${capture.sha256 ?? "unknown"}`;
    }).join("\n");
    return `### ${markdownText(record.displayName ?? handle)} (${markdownText(handle)})${permalink}\n\n${body}${media ? `\n\n**Media**\n${media}` : ""}`;
  });
  return `# Aviary clipboard export\n\n${lines.join("\n\n---\n\n")}\n`;
}

function toObsidianArtifact(records: readonly ExportRecord[]): ExportArtifact {
  const sections = records.map((record) => {
    const safeId = record.tweetId ?? "no-id";
    const handle = record.handle ?? "anon";
    // The handle is escaped for every other frontmatter value but was interpolated raw here, so a
    // handle carrying newlines terminated the YAML block from inside it and turned the rest of the
    // note into real Markdown. An imported archive's screen_name is an arbitrary string.
    const tags = ["#aviary", `#x/${tagToken(handle)}`];
    const frontmatter = [
      "---",
      `tweet_id: ${yamlScalar(safeId)}`,
      `handle: ${yamlScalar(handle)}`,
      `display_name: ${yamlScalar(record.displayName ?? "")}`,
      `captured_at: ${yamlScalar(record.capturedAt)}`,
      `surface: ${yamlScalar(record.surface)}`,
      `permalink: ${yamlScalar(record.permalink ?? "")}`,
      `tags: [${tags.join(", ")}]`,
      "---"
    ].join("\n");
    const mediaList =
      record.media.length === 0
        ? ""
        : `\n\n${record.media.map((media) => {
            const capture = describeMediaCapture(media, record.capturedAt);
            const target = capture.packagePath ?? capture.sourceUrl;
            const label = `${media.kind} · ${capture.status}`;
            return `- ${target ? `[${label}](${markdownUrl(target)})` : label} · captured ${capture.capturedAt ?? "unknown"}; bytes ${capture.byteLength ?? "unknown"}; sha256 ${capture.sha256 ?? "unknown"}`;
          }).join("\n")}`;
    return `${frontmatter}\n\n# ${markdownText(record.displayName ?? handle)}\n\n${record.text}${mediaList}`;
  });
  const document = sections.join("\n\n---\n\n");
  return {
    filename: "aviary-obsidian.md",
    contentType: "text/markdown",
    data: ENCODER.encode(document)
  };
}

/**
 * Quotes a scraped value so it cannot break — or extend — the frontmatter block.
 *
 * Display names are page text. A colon followed by a space, a leading quote or `#`, or a newline
 * all produce invalid YAML, which Obsidian renders as a broken block; a crafted name could add
 * frontmatter keys of its own.
 */
/**
 * A YAML tag carries no quoting of its own, so anything that could end the line has to go.
 *
 * Every other frontmatter value goes through `yamlScalar`; a tag cannot, because the `#x/` prefix
 * has to stay a bare token. Reducing it to the characters a handle can legally contain is what
 * keeps the block closed.
 */
function tagToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "anon";
}

/**
 * Identity text on a Markdown line the reader will open.
 *
 * Post text is left alone -- it is the content, and Markdown is what the export is for -- but a
 * display name or handle sits inside a heading Aviary builds, where a newline ends the heading and
 * a bracket starts a link the author did not write.
 */
function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/([[\]<>`])/g, "\\$1").trim();
}

function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
  return `"${escaped}"`;
}

function toNotionArtifact(records: readonly ExportRecord[]): ExportArtifact {
  // Notion's import is happiest with a single Markdown document that has predictable headings.
  const lines = ["# Aviary export"];
  for (const record of records) {
    const handle = record.handle ?? "anon";
    lines.push("");
    lines.push(`## ${record.displayName ?? handle} · @${handle}`);
    lines.push("");
    lines.push(`*Captured:* ${record.capturedAt}  `);
    if (record.permalink) lines.push(`*Permalink:* ${record.permalink}  `);
    lines.push("");
    lines.push(record.text);
    if (record.media.length > 0) {
      lines.push("");
      lines.push("**Media**");
      for (const media of record.media) {
        const capture = describeMediaCapture(media, record.capturedAt);
        lines.push(`- ${media.kind} · ${capture.status}: ${capture.sourceUrl || "no source URL"}; bytes ${capture.byteLength ?? "unknown"}; sha256 ${capture.sha256 ?? "unknown"}`);
      }
    }
  }
  return {
    filename: "aviary-notion.md",
    contentType: "text/markdown",
    data: ENCODER.encode(`${lines.join("\n")}\n`)
  };
}

function toJsonArtifact(records: readonly ExportRecord[]): ExportArtifact {
  const json = JSON.stringify(
    { generator: "Aviary", generatedAt: new Date().toISOString(), records: serializeExportRecords(records) },
    null,
    2
  );
  return {
    filename: "aviary-records.json",
    contentType: "application/json",
    data: ENCODER.encode(json)
  };
}

/**
 * A URL that cannot end its own link early or start a second one.
 *
 * Escaping only the closing paren left an unbalanced opening one able to nest, and square
 * brackets able to begin a link label, so an archive whose id_str carried a bracket-paren pair
 * produced a second destination the author never wrote.
 */
function markdownUrl(value: string): string {
  return value
    .replace(/\\/g, "%5C")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\[/g, "%5B")
    .replace(/\]/g, "%5D")
    .replace(/\s/g, "%20");
}
