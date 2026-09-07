import { supportedLocales, translateText } from "../../platform/i18n.ts";
import { serializeExportRecords } from "./assets.ts";
import {
  reconstructThreads,
  threadRecordKey,
  type ReconstructedThread
} from "./thread-reconstruction.ts";
import type { ExportRecord } from "./types.ts";

/**
 * The viewer's copy, in English, keyed by the id its markup uses.
 *
 * The exported viewer is a standalone file, so its strings have to be inlined into the
 * generated HTML rather than looked up at runtime. They used to be inlined as a second,
 * hand-maintained nine-locale table living outside the catalog and outside the extractor —
 * a table nothing could keep honest, in a repository that has already lost five separate
 * rounds of copy to i18n blind spots.
 *
 * Now only the English source lives here and every translation is resolved from the one
 * catalog at generation time. A viewer string is a catalog string like any other.
 */
const VIEWER_COPY = {
  title: "Aviary archive",
  subtitle: "Local archive viewer. Remote references are never fetched automatically.",
  language: "Language",
  search: "Search records",
  status: "Media status",
  all: "All media",
  captured: "Captured bytes",
  remote: "Remote reference",
  missing: "Missing",
  sort: "Sort",
  newest: "Newest first",
  oldest: "Oldest first",
  handle: "Handle",
  thread: "Thread view",
  media: "Media",
  records: "records",
  shown: "shown",
  noResults: "No matching records.",
  source: "source",
  bytes: "bytes",
  checksum: "SHA-256",
  openSource: "Open source URL",
  threadPosts: "posts",
  offline: "offline-ready",
  network: "network may be required",
  gap: "Missing captured post",
  gapDetail: "This parent was not captured locally.",
  conversation: "Conversation",
  authorRun: "{count} posts by {author}",
} as const;

type ViewerCopyKey = keyof typeof VIEWER_COPY;
export type ViewerLabels = Record<ViewerCopyKey | "name", string>;

/** Resolve every viewer string for every shipped locale, from the shared catalog. */
function buildViewerLabels(): Record<string, ViewerLabels> {
  const table: Record<string, ViewerLabels> = {};
  for (const locale of supportedLocales()) {
    const entry = { name: locale.label } as ViewerLabels;
    for (const [key, english] of Object.entries(VIEWER_COPY)) {
      entry[key as ViewerCopyKey] = translateText(locale.code, english);
    }
    table[locale.code] = entry;
  }
  return table;
}

const LOCALE_ORDER: string[] = supportedLocales().map((locale) => locale.code);
const RTL_CODES: string[] = supportedLocales()
  .filter((locale) => locale.direction === "rtl")
  .map((locale) => locale.code);

export function buildExportViewer(records: readonly ExportRecord[]): Uint8Array {
  const data = safeJson(serializeExportRecords(records));
  const threads = safeJson(serializeThreads(reconstructThreads(records)));
  const labels = safeJson(buildViewerLabels());
  const script = viewerScript(labels, LOCALE_ORDER, RTL_CODES);
  const html = `<!doctype html>
<html lang="en" dir="ltr"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Aviary archive</title>
<style>${VIEWER_STYLES}</style>
</head><body>
<main id="app">
  <header class="hero">
    <div><h1 id="title">Aviary archive</h1><p id="subtitle"></p></div>
    <label class="locale"><span id="language-label">Language</span><select id="locale"></select></label>
  </header>
  <section class="toolbar" aria-labelledby="search-label">
    <label><span id="search-label">Search records</span><input id="search" type="search" autocomplete="off" /></label>
    <label><span id="status-label">Media status</span><select id="status"></select></label>
    <label><span id="sort-label">Sort</span><select id="sort"></select></label>
    <label class="check"><input id="thread" type="checkbox" /><span id="thread-label">Thread view</span></label>
  </section>
  <p id="summary" class="summary" role="status"></p>
  <p id="empty" class="empty" hidden></p>
  <div id="records" class="records" role="region" aria-live="polite" aria-label="Aviary records">
    <div id="canvas" class="canvas"><div id="top-spacer"></div><div id="list"></div><div id="bottom-spacer"></div></div>
  </div>
</main>
<script type="application/json" id="records-data">${data}</script>
<script type="application/json" id="threads-data">${threads}</script>
<script>${script}</script>
</body></html>`;
  return new TextEncoder().encode(html);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function serializeThreads(threads: readonly ReconstructedThread[]): Array<Record<string, unknown>> {
  return threads.map((thread) => ({
    id: thread.id,
    rootId: thread.rootId,
    kind: thread.kind,
    participants: thread.participants,
    authorRuns: thread.authorRuns,
    items: thread.items.map((item) => item.kind === "gap"
      ? { kind: "gap", missingId: item.missingId, parentId: item.parentId, depth: item.depth }
      : {
          kind: "post",
          key: threadRecordKey(item.record),
          depth: item.depth,
          parentId: item.parentId,
          differentAuthor: item.differentAuthor
        })
  }));
}

/**
 * The registry's own locale list, not a copy of it.
 *
 * The header of this file condemns exactly the pattern these two literals were: a second
 * hand-maintained table that nothing can keep honest. Adding a locale left the picker short and
 * `localeFromBrowser()` falling back to English; adding a right-to-left one rendered it the wrong
 * way round; removing one made `LABELS[code].name` throw inside `applyLabels()`, which is the
 * generated IIFE's last statement, so the whole viewer came up blank. Every test still passed
 * through all of it, because nothing could see these lines.
 */
function viewerScript(labels: string, locales: readonly string[], rtl: readonly string[]): string {
  return `(function () {
  "use strict";
  const LABELS = ${labels};
  const RECORDS = JSON.parse(document.getElementById("records-data").textContent || "[]");
  const THREADS = JSON.parse(document.getElementById("threads-data").textContent || "[]");
  const LOCALES = ${JSON.stringify(locales)};
  const RTL = new Set(${JSON.stringify(rtl)});
  const state = { locale: localeFromBrowser(), query: "", status: "all", sort: "newest", thread: false };
  const rowHeight = 190;
  const overscan = 4;
  const viewport = document.getElementById("records");
  const list = document.getElementById("list");
  const topSpacer = document.getElementById("top-spacer");
  const bottomSpacer = document.getElementById("bottom-spacer");
  const empty = document.getElementById("empty");
  const summary = document.getElementById("summary");
  const queryInput = document.getElementById("search");
  const statusSelect = document.getElementById("status");
  const sortSelect = document.getElementById("sort");
  const threadInput = document.getElementById("thread");
  const localeSelect = document.getElementById("locale");
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const currentLabels = () => LABELS[state.locale] || LABELS.en;
  const interpolate = (value, replacements) => Object.entries(replacements).reduce(
    (result, entry) => result.replaceAll("{" + entry[0] + "}", String(entry[1])), value
  );
  const captureOf = (media) => media && media.capture ? media.capture : {
    status: media && media.url ? "remote-reference" : "missing",
    sourceUrl: media && media.url ? media.url : "",
    capturedAt: null,
    byteLength: null,
    sha256: null,
    retryable: Boolean(media && media.url)
  };
  const statusLabel = (status) => {
    const labels = currentLabels();
    return status === "captured-bytes" ? labels.captured : status === "remote-reference" ? labels.remote : labels.missing;
  };
  const mediaStatuses = (record) => new Set((record.media || []).map((media) => captureOf(media).status));
  const recordText = (record) => [record.handle, record.displayName, record.text, record.permalink]
    .filter(Boolean).join(" ").toLocaleLowerCase();
  const recordKey = (record) => record.tweetId
    ? "tweet:" + record.tweetId
    : ["record", record.surface || "", record.permalink || "", record.capturedAt || "", String(record.text || "").slice(0, 160)].join("|");
  function localeFromBrowser() {
    const candidate = (navigator.language || "en").slice(0, 2).toLowerCase();
    return LOCALES.includes(candidate) ? candidate : "en";
  }
  function populateSelect(select, options, selected) {
    clear(select);
    options.forEach((option) => {
      const item = document.createElement("option");
      item.value = option[0];
      item.textContent = option[1];
      item.selected = option[0] === selected;
      select.append(item);
    });
  }
  function applyLabels() {
    const labels = currentLabels();
    document.documentElement.lang = state.locale;
    document.documentElement.dir = RTL.has(state.locale) ? "rtl" : "ltr";
    document.title = labels.title;
    document.getElementById("title").textContent = labels.title;
    document.getElementById("subtitle").textContent = labels.subtitle;
    document.getElementById("language-label").textContent = labels.language;
    document.getElementById("search-label").textContent = labels.search;
    document.getElementById("status-label").textContent = labels.status;
    document.getElementById("sort-label").textContent = labels.sort;
    document.getElementById("thread-label").textContent = labels.thread;
    queryInput.setAttribute("aria-label", labels.search);
    statusSelect.setAttribute("aria-label", labels.status);
    sortSelect.setAttribute("aria-label", labels.sort);
    threadInput.setAttribute("aria-label", labels.thread);
    populateSelect(localeSelect, LOCALES.map((code) => [code, LABELS[code].name]), state.locale);
    populateSelect(statusSelect, [["all", labels.all], ["captured-bytes", labels.captured], ["remote-reference", labels.remote], ["missing", labels.missing]], state.status);
    populateSelect(sortSelect, [["newest", labels.newest], ["oldest", labels.oldest], ["handle", labels.handle]], state.sort);
    render();
  }
  function filteredRecords() {
    const query = state.query.trim().toLocaleLowerCase();
    const filtered = RECORDS.filter((record) => {
      if (query && !recordText(record).includes(query)) return false;
      if (state.status !== "all" && !mediaStatuses(record).has(state.status)) return false;
      return true;
    });
    filtered.sort((left, right) => {
      if (state.sort === "handle") return String(left.handle || "").localeCompare(String(right.handle || ""));
      const leftDate = Date.parse(left.capturedAt || "") || 0;
      const rightDate = Date.parse(right.capturedAt || "") || 0;
      return state.sort === "newest" ? rightDate - leftDate : leftDate - rightDate;
    });
    if (!state.thread) return filtered.map((record) => [record]);
    const groups = threadGroups(filtered);
    groups.sort((left, right) => compareGroups(left, right, state.sort));
    return groups;
  }
  function threadGroups(records) {
    const byKey = new Map(records.map((record) => [recordKey(record), record]));
    const used = new Set();
    const result = [];
    THREADS.forEach((thread) => {
      const group = [];
      let hasPost = false;
      (thread.items || []).forEach((item) => {
        if (item.kind === "gap") {
          if (hasPost || (thread.items || []).some((candidate) => candidate.kind === "post" && byKey.has(candidate.key))) {
            group.push({ __aviaryGap: true, missingId: item.missingId, parentId: item.parentId, depth: item.depth });
          }
          return;
        }
        const record = byKey.get(item.key);
        if (!record) return;
        hasPost = true;
        used.add(item.key);
        group.push({ ...record, __threadDepth: item.depth, __differentAuthor: item.differentAuthor });
      });
      if (hasPost) result.push(group);
    });
    const leftovers = new Map();
    records.forEach((record) => {
      const key = recordKey(record);
      if (used.has(key)) return;
      const groupKey = record.conversationId || record.rootId || record.threadId || recordKey(record);
      const group = leftovers.get(groupKey) || [];
      group.push(record);
      leftovers.set(groupKey, group);
    });
    return result.concat(Array.from(leftovers.values()));
  }
  function appendMedia(card, group) {
    const labels = currentLabels();
    const media = group.filter((entry) => !entry.__aviaryGap).flatMap((record) => record.media || []);
    if (media.length === 0) return;
    const section = document.createElement("section");
    section.className = "media";
    section.append(text("h3", labels.media));
    media.slice(0, 24).forEach((entry) => {
      const capture = captureOf(entry);
      const item = document.createElement("div");
      item.className = "media-item status-" + capture.status;
      item.append(text("strong", entry.kind + " · " + statusLabel(capture.status)));
      if (capture.status === "captured-bytes" && capture.packagePath && /^(?:[a-z0-9._-]+\\/)*[a-z0-9._/-]+$/i.test(capture.packagePath)) {
        if (/^image\\//i.test(entry.type || "")) {
          const image = document.createElement("img");
          image.src = capture.packagePath;
          image.loading = "lazy";
          image.alt = entry.altText || entry.kind;
          item.append(image);
        }
        if (entry.kind === "audio") {
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = capture.packagePath;
          item.append(audio);
        }
        const link = document.createElement("a");
        link.href = capture.packagePath;
        link.textContent = labels.captured;
        item.append(link);
      } else if (capture.status === "remote-reference" && /^https?:\\/\\//i.test(capture.sourceUrl || "")) {
        const link = document.createElement("a");
        link.href = capture.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = labels.openSource;
        item.append(link);
      } else {
        item.append(text("span", labels.missing));
      }
      const details = [
        capture.capturedAt || "",
        capture.byteLength === null || capture.byteLength === undefined ? "" : capture.byteLength + " " + labels.bytes,
        capture.sha256 ? labels.checksum + " " + capture.sha256 : ""
      ].filter(Boolean).join(" · ");
      if (details) item.append(text("small", details));
      if (capture.status === "remote-reference" && capture.sourceUrl) item.append(text("small", labels.source + ": " + capture.sourceUrl, "source"));
      section.append(item);
    });
    if (media.length > 24) section.append(text("small", "+" + (media.length - 24) + " " + labels.media));
    card.append(section);
  }
  function appendCard(group) {
    const posts = group.filter((entry) => !entry.__aviaryGap);
    const record = posts[0] || {};
    const card = document.createElement("article");
    card.className = "record-card";
    const heading = document.createElement("div");
    heading.className = "record-heading";
    heading.append(text("h2", record.displayName || (record.handle ? "@" + record.handle : "Unknown")));
    if (record.handle) heading.append(text("span", "@" + record.handle, "handle"));
    if (posts.length > 1) heading.append(text("span", posts.length + " " + currentLabels().threadPosts, "thread-count"));
    if (posts.some((entry) => entry.__differentAuthor)) heading.append(text("span", currentLabels().conversation, "thread-conversation"));
    if (group.some((entry) => entry.__aviaryGap)) heading.append(text("span", currentLabels().gap, "thread-gap-count"));
    heading.append(text("time", record.capturedAt || "", "date"));
    card.append(heading);
    let run = [];
    const flushRun = () => {
      if (run.length === 0) return;
      if (run.length === 1) {
        appendPost(card, run[0]);
      } else {
        const details = document.createElement("details");
        details.className = "author-run";
        const author = run[0].displayName || (run[0].handle ? "@" + run[0].handle : "Unknown");
        details.append(text("summary", interpolate(currentLabels().authorRun, { count: run.length, author })));
        run.forEach((entry) => appendPost(details, entry));
        card.append(details);
      }
      run = [];
    };
    group.forEach((entry) => {
      if (entry.__aviaryGap) {
        flushRun();
        const gap = document.createElement("div");
        gap.className = "thread-gap";
        gap.append(text("strong", currentLabels().gap));
        gap.append(text("small", currentLabels().gapDetail));
        if (entry.missingId) gap.append(text("code", entry.missingId));
        card.append(gap);
        return;
      }
      const previous = run[run.length - 1];
      if (previous && (previous.authorId || previous.handle || previous.displayName || "unknown") !== (entry.authorId || entry.handle || entry.displayName || "unknown")) flushRun();
      run.push(entry);
    });
    flushRun();
    appendMedia(card, group);
    if (record.permalink && /^https?:\\/\\//i.test(record.permalink)) {
      const link = document.createElement("a");
      link.href = record.permalink;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = record.permalink;
      card.append(link);
    }
    return card;
  }
  function compareGroups(left, right, sort) {
    const leftPosts = left.filter((entry) => !entry.__aviaryGap);
    const rightPosts = right.filter((entry) => !entry.__aviaryGap);
    if (sort === "handle") {
      return String(leftPosts[0]?.handle || "").localeCompare(String(rightPosts[0]?.handle || ""));
    }
    const leftTimes = leftPosts.map((entry) => Date.parse(entry.capturedAt || "") || 0);
    const rightTimes = rightPosts.map((entry) => Date.parse(entry.capturedAt || "") || 0);
    const leftTime = sort === "newest" ? Math.max(0, ...leftTimes) : Math.min(...leftTimes, 0);
    const rightTime = sort === "newest" ? Math.max(0, ...rightTimes) : Math.min(...rightTimes, 0);
    return sort === "newest" ? rightTime - leftTime : leftTime - rightTime;
  }
  function appendPost(card, entry) {
    const body = text("p", entry.text || "", "body");
    if (entry.__differentAuthor) body.classList.add("different-author");
    card.append(body);
  }
  function render() {
    const groups = filteredRecords();
    const labels = currentLabels();
    const totalRecords = groups.reduce((sum, group) => sum + group.filter((entry) => !entry.__aviaryGap).length, 0);
    summary.textContent = totalRecords + " " + labels.records + " · " + groups.length + " " + labels.shown + (state.status === "all" ? "" : " · " + statusLabel(state.status));
    empty.hidden = groups.length !== 0;
    empty.textContent = labels.noResults;
    if (groups.length === 0) {
      clear(list);
      topSpacer.style.height = "0px";
      bottomSpacer.style.height = "0px";
      return;
    }
    const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
    const end = Math.min(groups.length, Math.ceil((viewport.scrollTop + viewport.clientHeight) / rowHeight) + overscan);
    topSpacer.style.height = start * rowHeight + "px";
    bottomSpacer.style.height = Math.max(0, (groups.length - end) * rowHeight) + "px";
    clear(list);
    for (let index = start; index < end; index += 1) list.append(appendCard(groups[index]));
  }
  queryInput.addEventListener("input", () => { state.query = queryInput.value; viewport.scrollTop = 0; render(); });
  statusSelect.addEventListener("change", () => { state.status = statusSelect.value; viewport.scrollTop = 0; render(); });
  sortSelect.addEventListener("change", () => { state.sort = sortSelect.value; viewport.scrollTop = 0; render(); });
  threadInput.addEventListener("change", () => { state.thread = threadInput.checked; viewport.scrollTop = 0; render(); });
  localeSelect.addEventListener("change", () => { state.locale = localeSelect.value; applyLabels(); });
  viewport.addEventListener("scroll", render, { passive: true });
  applyLabels();
})();`;
}

const VIEWER_STYLES = `
:root { --bg: #080d12; --surface: #0e151c; --raised: #16212a; --border: #30414d; --text: #f0f4f6; --muted: #a1afb9; --accent: #58d5d0; color-scheme: dark; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: var(--bg); font-size: 15px; }
main { width: min(100%, 1200px); margin: 0 auto; padding: 22px; }
.hero { display: flex; gap: 16px; align-items: start; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 14px; }
h1 { margin: 0; font-size: clamp(1.45rem, 4vw, 2rem); }
.hero p { color: var(--muted); margin: 5px 0 0; max-width: 64ch; }
label { display: grid; gap: 6px; color: var(--muted); font-size: .875rem; }
select, input { min-height: 42px; border: 1px solid var(--border); border-radius: 8px; background: var(--raised); color: var(--text); padding: 8px 10px; font-family: inherit; font-size: .9375rem; }
.locale { min-width: 130px; }
.toolbar { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(2, minmax(130px, 1fr)) auto; gap: 10px; padding: 16px 0; }
.check { display: flex; align-items: end; gap: 8px; min-height: 42px; padding-bottom: 10px; white-space: nowrap; }
.check input { min-height: 20px; width: 20px; }
.summary { color: var(--muted); margin: 0 0 10px; }
.empty { padding: 28px 10px; border-block: 1px solid var(--border); color: var(--muted); }
.records { height: min(70vh, 720px); min-height: 300px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; contain: strict; }
.canvas { min-height: 100%; }
.record-card { min-height: 160px; margin: 0; padding: 16px 18px; border: 0; border-bottom: 1px solid var(--border); background: transparent; overflow-wrap: anywhere; }
.record-heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h2 { font-size: 1rem; margin: 0; }
.handle, .date, small { color: var(--muted); font-size: .8125rem; }
.date { margin-inline-start: auto; }
.thread-count { color: var(--accent); font-size: .8125rem; }
.thread-gap-count { color: #f0b44d; font-size: .8125rem; }
.thread-conversation { color: #d6a7ff; font-size: .8125rem; }
.body { white-space: pre-wrap; line-height: 1.5; margin: 12px 0 0; }
.different-author { border-inline-start: 2px solid var(--accent); padding-inline-start: 10px; }
.author-run { margin-top: 12px; border-block: 1px solid var(--border); padding: 8px 0; }
.author-run summary { cursor: pointer; color: var(--accent); font-size: .9rem; }
.thread-gap { display: grid; gap: 3px; margin: 12px 0; padding: 10px; border: 1px dashed #8d6c36; border-radius: 8px; background: #211d15; color: #f0b44d; }
.thread-gap small { color: #c4a878; }
.thread-gap code { color: var(--text); font-size: .8125rem; overflow-wrap: anywhere; }
.media { display: grid; gap: 8px; margin-top: 12px; }
.media h3 { margin: 0; font-size: .85rem; }
.media-item { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 8px; padding: 8px; border-inline-start: 2px solid var(--border); background: var(--raised); }
.media-item img { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; grid-row: span 2; }
.media-item a { color: var(--accent); overflow-wrap: anywhere; }
.media-item small { grid-column: 1 / -1; }
.status-captured-bytes { border-inline-start: 3px solid #35c759; }
.status-remote-reference { border-inline-start: 3px solid #f0b44d; }
.status-missing { border-inline-start: 3px solid #f15c6d; }
a { color: var(--accent); }
@media (prefers-color-scheme: light) {
  :root { --bg: #edf3f6; --surface: #fafcfd; --raised: #e5edf1; --border: #c2cfd6; --text: #0f181f; --muted: #4e5e69; --accent: #00656a; color-scheme: light; }
}
@media (max-width: 620px) {
  main { padding: 12px; }
  .hero { display: grid; }
  .toolbar { grid-template-columns: 1fr 1fr; }
  .toolbar label:first-child { grid-column: 1 / -1; }
  .check { align-items: center; padding: 0; }
  .records { min-height: 360px; }
  .media-item { grid-template-columns: 1fr; }
  .media-item img { width: 100%; height: 150px; grid-row: auto; }
}
`;

export const viewerLocales: readonly string[] = LOCALE_ORDER;
