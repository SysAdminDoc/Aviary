/**
 * The escaping and path rules every export artifact has to obey.
 *
 * These existed already, one private copy per module: `safeHref` in `formatters.ts` because an
 * exported HTML page opened from disk runs a `javascript:` href same-origin as the file, and
 * `stripInvalidXmlChars` in `xlsx.ts` because XML 1.0 forbids most C0 controls and one of them
 * makes a workbook unopenable. Every new artifact rediscovered the problem the hard way, so the
 * rules live in one place now and each module imports the one it needs.
 */

/** An address safe to put in an `href` on a page that is opened from the filesystem. */
export function safeExternalHref(value: string): string {
  // An empty string resolves against the base and comes back as `https://x.com/`, which is an
  // address the record never carried. A post with no permalink has to end up with nothing.
  if (typeof value !== "string" || value.trim().length === 0) return "";
  try {
    const parsed = new URL(value, "https://x.com");
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

/**
 * A relative path inside the package, or nothing.
 *
 * Anything with a scheme, a leading slash, a backslash, or a `..` segment is refused: those are
 * the shapes that turn a local `src` into a request off the folder or a read above it.
 */
export function safeRelativePath(value: string): string {
  if (!/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(value)) return "";
  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || isReservedFileName(segment))) return "";
  return value;
}

const RESERVED_FILE_NAMES = /^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[1-9²³¹]|LPT[1-9²³¹])(?:\.|$)/i;

/**
 * Windows resolves `CON.html` to the console device whatever extension follows it, so a ZIP
 * holding that entry cannot be extracted. The settings folder hint already refuses these; a file
 * name built from a post id has to refuse them too, because an imported bundle supplies its own
 * ids and nothing on that path requires them to be numbers.
 */
export function isReservedFileName(value: string): boolean {
  return RESERVED_FILE_NAMES.test(value.trim());
}

/**
 * A single path segment built from arbitrary text.
 *
 * Never empty and never a device name, so the caller always has something to write. It is not
 * unique on its own -- two different ids can render the same segment -- so a caller writing more
 * than one file has to de-duplicate what comes back.
 */
export function safeFileSlug(value: string): string {
  const slug = value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length === 0) return "post";
  return isReservedFileName(slug) ? `${slug}-post` : slug;
}

/** Drops the code points XML 1.0 has no representation for at all. */
export function stripInvalidXmlChars(value: string): string {
  let output = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const allowed =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (allowed) output += char;
  }
  return output;
}

/** Text for an XML node or a quoted XML attribute. */
export function escapeXmlText(value: string): string {
  return stripInvalidXmlChars(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * A date whose written form does not move with the reading machine's clock.
 *
 * `new Date("2026-08-11T09:15:00")` is parsed as local time, so the same record exports thirteen
 * hours apart on two hosts. A date-only or offset-less date-time is read as UTC instead, which is
 * what every producer on this path already writes and the only reading that is reproducible.
 */
export function parseExportDate(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const value = raw.trim();
  const offsetless = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(value);
  const parsed = new Date(offsetless ? `${value.replace(" ", "T")}Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * A total order over post ids.
 *
 * Numeric ids compare as numbers, because X ids outgrew 53-bit floats long ago and string order
 * puts 10 before 9. Everything else compares by code unit rather than by `localeCompare`, which
 * is neither a total order alongside a numeric branch (9 < 10 < 5a < 9 is a real cycle it
 * produces) nor stable across hosts: `"ä"` sorts before `"z"` under `en` and after it under `sv`.
 */
export function compareRecordIds(left: string | null, right: string | null): number {
  const a = left ?? "";
  const b = right ?? "";
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) {
    const trimmedA = a.replace(/^0+(?=\d)/, "");
    const trimmedB = b.replace(/^0+(?=\d)/, "");
    if (trimmedA.length !== trimmedB.length) return trimmedA.length - trimmedB.length;
    return trimmedA < trimmedB ? -1 : trimmedA > trimmedB ? 1 : compareCodeUnits(a, b);
  }
  // Numbers before everything else, so the two branches never disagree about a pair.
  if (numericA !== numericB) return numericA ? -1 : 1;
  return compareCodeUnits(a, b);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
