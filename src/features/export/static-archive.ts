import type { ExportMedia, ExportRecord } from "./types.ts";
import { filterShareRecords, normalizeAudienceSelection, type ExportAudienceSelection } from "./audience.ts";
import {
  compareRecordIds,
  escapeXmlText,
  parseExportDate,
  safeExternalHref,
  safeFileSlug,
  safeRelativePath,
  stripInvalidXmlChars
} from "./text-safety.ts";
import type { ZipFileEntry } from "./zip-store.ts";

/**
 * A static archive: plain HTML files that open from a folder, with no server and no network.
 *
 * The existing viewer is one page holding every record as embedded JSON. That is the right shape
 * for searching a library and the wrong one for keeping it: a single file cannot be linked into,
 * cannot be read by anything that is not a browser, and has no address for an individual post.
 * This produces the other thing -- an index, one page per post, and an RSS 2.0 feed -- so a
 * reader, a feed client, or a future person with a folder and no Aviary can still use it.
 *
 * Four rules the output holds to:
 *
 *   Nothing is fetched. Every stylesheet is inline, every link between pages is relative, and a
 *   media file is either copied in beside the page or replaced by a placeholder that says why it
 *   is not there. A page that would silently need the network is a page that does not work.
 *
 *   Nothing runs. A page opened from disk is a `file:` origin, where a `javascript:` href from a
 *   captured permalink would execute against the archive. Every outward link goes through
 *   `safeExternalHref` and every local one through `safeRelativePath`.
 *
 *   The canonical link points at X; navigation points at the folder. The archive is a copy, and
 *   `rel="canonical"` is how it says so; the reader still moves around inside the copy.
 *
 *   Two exports of the same records are byte-identical apart from the generated time, which is
 *   declared in one place. Ordering is by post id through a comparator that is a total order,
 *   filenames come from the id, and nothing is derived from iteration order, the locale, or the
 *   host time zone.
 */

export interface StaticArchiveOptions {
  audience?: Partial<ExportAudienceSelection>;
  /** Declared once and shown; the only value that changes between two exports of one library. */
  generatedAt?: Date;
  /** Feed title and description, for the channel element. */
  title?: string;
  description?: string;
  /** Where the feed says it lives. Feed readers need an absolute base; a local export has none. */
  feedLink?: string;
}

const ENCODER = new TextEncoder();

/** Builds every file of the static archive, ready for the ZIP writer. */
export function buildStaticArchive(
  records: readonly ExportRecord[],
  options: StaticArchiveOptions = {}
): ZipFileEntry[] {
  const withId = records.filter((record) => record.tweetId !== null);
  const visible = filterShareRecords(withId, normalizeAudienceSelection(options.audience));
  const generatedAt = options.generatedAt ?? new Date();
  const title = options.title ?? "Aviary archive";
  const description = options.description ?? "A local archive of captured posts.";

  // Sorted by id so two exports of one library agree, and so the index reads in a stable order
  // rather than in whatever order the collector happened to fill.
  const ordered = [...visible].sort((left, right) => compareRecordIds(left.tweetId, right.tweetId));

  // Two ids can render one file name, and an imported bundle supplies its own ids: nothing on
  // that path requires them to be numbers, or to be distinct after the unsafe characters come
  // out. One page silently overwriting another is a post lost from the archive.
  const slugs = new Map<string, string>();
  const usedSlugs = new Set<string>();
  for (const record of ordered) {
    const id = record.tweetId!;
    if (slugs.has(id)) continue;
    slugs.set(id, `posts/${uniqueName(`${safeFileSlug(id)}.html`, usedSlugs)}`);
  }

  const entries: ZipFileEntry[] = [];
  const mediaPaths = new Map<ExportMedia, string>();
  const usedMediaNames = new Set<string>();

  for (const record of ordered) {
    for (const media of record.media) {
      // Bytes are what makes a picture a picture. An `assetPath` without them is a path to a file
      // nobody wrote, and rendering it produces exactly the broken image the placeholder exists
      // to avoid, so the bytes are the condition and the path is only where they go.
      if (!media.bytes || media.bytes.byteLength === 0) continue;
      // Inside a full export package the bytes are already written once under `media/` and the
      // package builder recorded where, so the page points at that copy instead of a second one.
      const packaged = media.assetPath ? safeRelativePath(media.assetPath) : "";
      if (packaged) {
        mediaPaths.set(media, packaged);
        continue;
      }
      const name = uniqueName(mediaName(record.tweetId!, media), usedMediaNames);
      mediaPaths.set(media, `media/${name}`);
      entries.push({ filename: `media/${name}`, data: media.bytes, date: generatedAt });
    }
  }

  entries.push({
    filename: "index.html",
    data: ENCODER.encode(
      indexPage(ordered, slugs, title, description, generatedAt, withId.length - ordered.length)
    ),
    date: generatedAt
  });

  const written = new Set<string>();
  for (const record of ordered) {
    const filename = slugs.get(record.tweetId!)!;
    // A duplicate id shares one page; writing it twice would put two entries under one ZIP name.
    if (written.has(filename)) continue;
    written.add(filename);
    entries.push({
      filename,
      data: ENCODER.encode(postPage(record, ordered, slugs, mediaPaths, title)),
      date: generatedAt
    });
  }

  entries.push({
    filename: "feed.xml",
    data: ENCODER.encode(rssFeed(ordered, slugs, title, description, generatedAt, options.feedLink)),
    date: generatedAt
  });

  // Sorted so the ZIP's own entry order is a function of the records, not of the loops above.
  return entries.sort((left, right) => (left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0));
}

function mediaName(tweetId: string, media: ExportMedia): string {
  const source = media.url || media.sourceUrl || "";
  const extension = /\.([A-Za-z0-9]{2,5})(?:[?#]|$)/.exec(source)?.[1]?.toLowerCase() ?? "bin";
  return `${safeFileSlug(tweetId)}-${media.kind}.${extension}`;
}

/** Two files can render one name; the second gets a suffix rather than overwriting the first. */
function uniqueName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf(".");
  for (let index = 2; ; index += 1) {
    const candidate = dot > 0 ? `${base.slice(0, dot)}-${index}${base.slice(dot)}` : `${base}-${index}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

const STYLES = `
:root { color-scheme: light dark; --edge: rgba(128,128,128,0.4); }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 44rem; margin: 0 auto; }
a { color: inherit; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
.meta { font-size: 0.85rem; opacity: 0.75; }
ul.posts { list-style: none; margin: 24px 0 0; padding: 0; }
ul.posts li { border-top: 1px solid var(--edge); padding: 12px 0; }
article { border: 1px solid var(--edge); border-radius: 10px; padding: 16px; margin: 24px 0; }
figure { margin: 16px 0; }
figure img, figure video { max-width: 100%; height: auto; border-radius: 8px; }
.missing { border: 1px dashed var(--edge); border-radius: 8px; padding: 12px; font-size: 0.9rem; opacity: 0.8; }
nav.thread { border-top: 1px solid var(--edge); margin-top: 16px; padding-top: 12px; font-size: 0.9rem; }
nav.thread ul { list-style: none; margin: 4px 0 0; padding: 0; }
`.trim();

function head(pageTitle: string, canonical: string | null, depth: number): string {
  const base = depth === 0 ? "" : "../";
  return [
    "<!doctype html>",
    '<html lang="en" dir="ltr"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeText(pageTitle)}</title>`,
    // The copy points at the original. A permalink is captured data, so it goes through the
    // scheme check first: a javascript: value here would run against the archive's own file origin.
    canonical ? `<link rel="canonical" href="${escapeAttribute(canonical)}">` : "",
    `<link rel="alternate" type="application/rss+xml" title="${escapeAttribute(pageTitle)}" href="${base}feed.xml">`,
    `<style>${STYLES}</style>`,
    "</head><body><main>"
  ]
    .filter(Boolean)
    .join("\n");
}

function indexPage(
  records: readonly ExportRecord[],
  slugs: ReadonlyMap<string, string>,
  title: string,
  description: string,
  generatedAt: Date,
  heldBack: number
): string {
  const items = records
    .map((record) => {
      const href = slugs.get(record.tweetId!)!;
      const when = authoredAt(record);
      return [
        "  <li>",
        `    <a href="${escapeAttribute(href)}">${escapeText(summarize(record.text))}</a>`,
        `    <p class="meta">${escapeText(record.handle ? `@${record.handle}` : "unknown author")}` +
          `${when ? ` · <time datetime="${escapeAttribute(when.toISOString())}">${escapeText(when.toISOString().slice(0, 10))}</time>` : ""}</p>`,
        "  </li>"
      ].join("\n");
    })
    .join("\n");

  return [
    head(title, null, 0),
    `<h1>${escapeText(title)}</h1>`,
    `<p>${escapeText(description)}</p>`,
    // The held-back count is stated rather than left as a difference between this page and the
    // package manifest. An index that says "0 posts" beside a manifest that counts one is an
    // archive arguing with itself.
    `<p class="meta">${records.length} ${records.length === 1 ? "post" : "posts"}` +
      `${heldBack > 0 ? escapeText(`, ${heldBack} held back by the audience setting`) : ""} · ` +
      `generated <time datetime="${escapeAttribute(generatedAt.toISOString())}">${escapeText(generatedAt.toISOString())}</time> · ` +
      '<a href="feed.xml">RSS feed</a></p>',
    '<ul class="posts">',
    items,
    "</ul>",
    "</main></body></html>"
  ].join("\n");
}

function postPage(
  record: ExportRecord,
  all: readonly ExportRecord[],
  slugs: ReadonlyMap<string, string>,
  mediaPaths: ReadonlyMap<ExportMedia, string>,
  title: string
): string {
  const when = authoredAt(record);
  const original = safeExternalHref(record.permalink ?? "");
  const media = record.media.map((entry) => mediaBlock(entry, mediaPaths)).join("\n");
  const parent = record.parentId ? slugs.get(record.parentId) : undefined;
  const replies = all.filter((other) => other.parentId === record.tweetId);

  const threadLinks: string[] = [];
  if (record.parentId) {
    threadLinks.push(
      parent
        ? `    <li>In reply to <a href="${escapeAttribute(`../${parent}`)}">${escapeText(record.parentId)}</a></li>`
        // A parent outside the archive is said so rather than linked to a page that is not there.
        : `    <li>In reply to ${escapeText(record.parentId)}, which is not in this archive.</li>`
    );
  }
  for (const reply of replies) {
    threadLinks.push(
      `    <li>Reply: <a href="${escapeAttribute(`../${slugs.get(reply.tweetId!)!}`)}">${escapeText(summarize(reply.text))}</a></li>`
    );
  }

  return [
    head(`${summarize(record.text, 60)} · ${title}`, original || null, 1),
    '<p class="meta"><a href="../index.html">Back to the archive</a></p>',
    "<article>",
    `  <p class="meta">${escapeText(record.handle ? `@${record.handle}` : "unknown author")}` +
      `${when ? ` · <time datetime="${escapeAttribute(when.toISOString())}">${escapeText(when.toISOString())}</time>` : ""}</p>`,
    `  <p lang="${escapeAttribute(record.language ?? "und")}" dir="auto">${escapeText(record.text)}</p>`,
    media,
    original
      ? `  <p class="meta">Original: <a href="${escapeAttribute(original)}" rel="canonical">${escapeText(original)}</a></p>`
      : '  <p class="meta">No usable original address was recorded for this post.</p>',
    "</article>",
    threadLinks.length > 0
      ? `<nav class="thread"><p>Thread</p><ul>\n${threadLinks.join("\n")}\n</ul></nav>`
      : "",
    "</main></body></html>"
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A media block, or an explicit statement of why there is not one.
 *
 * A missing image rendered as a broken `img` looks like the archive is faulty. Saying that the
 * bytes were never captured, and naming the address they would have come from, is the difference
 * between an archive with a gap and an archive that appears to be broken.
 */
function mediaBlock(media: ExportMedia, mediaPaths: ReadonlyMap<ExportMedia, string>): string {
  const local = mediaPaths.get(media);
  if (local) {
    const src = escapeAttribute(`../${local}`);
    const alt = escapeAttribute(media.altText ?? "");
    // Each kind gets the element that can actually play it. An audio track or a subtitle file in
    // an img is a broken image on a page whose whole point is that a broken image means the bytes
    // are gone -- and here the bytes are right beside it.
    if (media.kind === "video") return `  <figure><video controls preload="none" src="${src}"></video></figure>`;
    if (media.kind === "audio") return `  <figure><audio controls preload="none" src="${src}"></audio></figure>`;
    if (media.kind === "subtitle") {
      const label = escapeText(media.label ?? media.language ?? "captions");
      return `  <figure><p class="meta">Captions (${label}): <a href="${src}">${escapeText(local)}</a></p></figure>`;
    }
    return `  <figure><img src="${src}" alt="${alt}" loading="lazy"></figure>`;
  }
  const address = media.url || media.sourceUrl || "";
  const reason =
    media.captureError ??
    (media.captureStatus === "remote-reference"
      ? "The bytes were not captured, so only the address was kept."
      : "No bytes and no address were kept for this item.");
  return [
    '  <figure><div class="missing">',
    `    <p>${escapeText(media.kind)} not stored. ${escapeText(reason)}</p>`,
    address ? `    <p class="meta">${escapeText(address)}</p>` : "",
    "  </div></figure>"
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * RSS 2.0.
 *
 * The required shape is a `rss` element with `version="2.0"`, one `channel` carrying `title`,
 * `link` and `description`, and items carrying enough to be identified. `guid` is
 * `isPermaLink="false"` because the post id is an identifier, not an address a reader can fetch.
 */
function rssFeed(
  records: readonly ExportRecord[],
  slugs: ReadonlyMap<string, string>,
  title: string,
  description: string,
  generatedAt: Date,
  feedLink: string | undefined
): string {
  // A local export has no absolute address, so feedLink is usually absent. Where it is given, the
  // channel and the local pages hang off it; where it is not, the links stay relative to the feed
  // itself, which is where the pages actually are. Naming x.com as the channel's website would be
  // a claim about a site this archive is not.
  const base = feedLink ?? "";
  const items = records
    .map((record) => {
      const when = authoredAt(record);
      // The post's own address where there is one, because that is what a reader can open.
      const link = safeExternalHref(record.permalink ?? "") || `${base}${slugs.get(record.tweetId!)!}`;
      return [
        "    <item>",
        `      <title>${escapeXml(summarize(record.text, 80))}</title>`,
        link ? `      <link>${escapeXml(link)}</link>` : "",
        `      <guid isPermaLink="false">${escapeXml(record.tweetId!)}</guid>`,
        when ? `      <pubDate>${escapeXml(toRfc822(when))}</pubDate>` : "",
        record.handle ? `      <dc:creator>${escapeXml(`@${record.handle}`)}</dc:creator>` : "",
        `      <description>${escapeXml(record.text)}</description>`,
        "    </item>"
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(base || "index.html")}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <lastBuildDate>${escapeXml(toRfc822(generatedAt))}</lastBuildDate>`,
    "    <generator>Aviary</generator>",
    items,
    "  </channel>",
    "</rss>",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 822 in UTC, which is what `pubDate` takes. Built by hand so a locale cannot change it. */
function toRfc822(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  );
}

/** The authored time where one was recorded. `capturedAt` is when Aviary saw it, not when it was written. */
function authoredAt(record: ExportRecord): Date | null {
  return parseExportDate(record.createdAt);
}

function summarize(text: string, limit = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "(no text)";
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

function escapeText(value: string): string {
  // Control characters are stripped here too. They are invisible on the page and they are exactly
  // what makes the sibling feed ill-formed, so one record cannot be safe in HTML and poison in XML.
  return stripInvalidXmlChars(String(value))
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function escapeXml(value: string): string {
  return escapeXmlText(value);
}
