export interface FilenameFields {
  handle: string | null;
  tweetId: string | null;
  index: number;
  total: number;
  date: Date;
  ext: string;
  text: string;
  mediaId: string | null;
}

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
const COLLAPSING_WHITESPACE = /\s+/g;

export function renderFilename(template: string, fields: FilenameFields): string {
  const datePart = formatDate(fields.date);
  const safeHandle = sanitizeSegment(fields.handle ?? "unknown");
  const safeText = sanitizeSegment(fields.text).slice(0, 60);
  const tweetId = sanitizeSegment(fields.tweetId ?? "0");
  const mediaId = sanitizeSegment(fields.mediaId ?? tweetId);
  const indexLabel = String(fields.index + 1).padStart(2, "0");
  const totalLabel = String(Math.max(fields.total, 1)).padStart(2, "0");

  const substitutions: Record<string, string> = {
    handle: safeHandle,
    tweetId,
    mediaId,
    index: indexLabel,
    total: totalLabel,
    date: datePart,
    text: safeText,
    ext: fields.ext.toLowerCase()
  };

  let name = template
    .replace(/\{(\w+)\}/g, (match, key: string) => {
      const value = substitutions[key];
      return value === undefined ? match : value;
    })
    .replace(/[\\/]+/g, "/")
    .trim();

  if (name.length === 0) {
    name = `${safeHandle}_${tweetId}_${indexLabel}`;
  }

  if (!name.toLowerCase().endsWith(`.${fields.ext.toLowerCase()}`)) {
    name = `${name}.${fields.ext.toLowerCase()}`;
  }

  return name;
}

function sanitizeSegment(value: string): string {
  return value.replace(FORBIDDEN, "").replace(COLLAPSING_WHITESPACE, " ").trim();
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
