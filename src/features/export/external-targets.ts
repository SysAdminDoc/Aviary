import type { ExportArtifact, ExportRecord } from "./types";

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
    const permalink = record.permalink ? ` — [link](${record.permalink})` : "";
    const body = record.text.split("\n").map((line) => `> ${line}`).join("\n");
    return `### ${record.displayName ?? handle} (${handle})${permalink}\n\n${body}`;
  });
  return `# Aviary clipboard export\n\n${lines.join("\n\n---\n\n")}\n`;
}

function toObsidianArtifact(records: readonly ExportRecord[]): ExportArtifact {
  const sections = records.map((record) => {
    const safeId = record.tweetId ?? "no-id";
    const handle = record.handle ?? "anon";
    const tags = ["#aviary", `#x/${handle}`];
    const frontmatter = [
      "---",
      `tweet_id: ${safeId}`,
      `handle: ${handle}`,
      `display_name: ${record.displayName ?? ""}`,
      `captured_at: ${record.capturedAt}`,
      `surface: ${record.surface}`,
      `permalink: ${record.permalink ?? ""}`,
      `tags: [${tags.join(", ")}]`,
      "---"
    ].join("\n");
    const mediaList =
      record.media.length === 0
        ? ""
        : `\n\n${record.media.map((media) => `- [${media.kind}](${media.url})`).join("\n")}`;
    return `${frontmatter}\n\n# ${record.displayName ?? handle}\n\n${record.text}${mediaList}`;
  });
  const document = sections.join("\n\n---\n\n");
  return {
    filename: "aviary-obsidian.md",
    contentType: "text/markdown",
    data: ENCODER.encode(document)
  };
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
        lines.push(`- ${media.kind}: ${media.url}`);
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
    { generator: "Aviary", generatedAt: new Date().toISOString(), records },
    null,
    2
  );
  return {
    filename: "aviary-records.json",
    contentType: "application/json",
    data: ENCODER.encode(json)
  };
}
