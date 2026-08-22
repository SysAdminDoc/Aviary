import {
  buildCatchUpDigest,
  type CatchUpCategory,
  type CatchUpRecord,
  type CatchUpSort
} from "./catch-up";

const DIALOG_ID = "av-catch-up-dialog";
const STYLE_ID = "av-catch-up-style";
const SESSION_KEY = "aviary.catchUp.ui.v1";

interface CatchUpUiState {
  windowHours: number;
  category: CatchUpCategory | "all";
  author: string | null;
  sort: CatchUpSort;
  groupByAuthor: boolean;
  scrollTop: number;
}

const CATEGORY_LABELS: Record<CatchUpCategory | "all", string> = {
  all: "All",
  original: "Original",
  replies: "Replies",
  quotes: "Quotes",
  reposts: "Reposts",
  filtered: "Filtered"
};

const WINDOW_OPTIONS: Array<[number, string]> = [
  [1, "Last hour"],
  [2, "Last 2 hours"],
  [4, "Last 4 hours"],
  [6, "Last 6 hours"],
  [8, "Last 8 hours"],
  [12, "Last 12 hours"],
  [13, "Beyond 12 hours"]
];

export function openCatchUpDigest(entries: readonly CatchUpRecord[]): { count: number } {
  document.getElementById(DIALOG_ID)?.remove();
  ensureStyle();
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "av-catch-up-dialog";
  dialog.setAttribute("aria-labelledby", "av-catch-up-title");
  const state = readState();
  const render = (): void => renderDialog(dialog, entries, state, render);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    writeState(state);
    dialog.remove();
  }, { once: true });
  document.body.append(dialog);
  render();
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "true");
  }
  const digest = buildCatchUpDigest(entries, state);
  return { count: digest.records.length };
}

function renderDialog(
  dialog: HTMLDialogElement,
  entries: readonly CatchUpRecord[],
  state: CatchUpUiState,
  rerender: () => void
): void {
  const digest = buildCatchUpDigest(entries, state);
  const header = document.createElement("header");
  header.className = "av-catch-up-header";
  const heading = document.createElement("div");
  heading.className = "av-catch-up-heading";
  const title = document.createElement("h2");
  title.id = "av-catch-up-title";
  title.textContent = "Catch-up";
  const summary = document.createElement("p");
  summary.textContent = digest.records.length > 0
    ? `${digest.records.length} post${digest.records.length === 1 ? "" : "s"} Aviary saw in this window`
    : "A quiet window. Nothing new to review.";
  heading.append(title, summary);

  const close = button("Close", "av-catch-up-close");
  close.setAttribute("aria-label", "Close catch-up");
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);

  const controls = document.createElement("div");
  controls.className = "av-catch-up-controls";
  const windowSelect = select("Window", WINDOW_OPTIONS, String(state.windowHours));
  windowSelect.addEventListener("change", () => {
    state.windowHours = Number(windowSelect.value);
    state.scrollTop = 0;
    rerender();
  });
  controls.append(field("Window", windowSelect));

  const sortSelect = select("Sort", [
    ["newest", "Newest first"],
    ["oldest", "Oldest first"],
    ["density", "Least dense first"],
    ["author", "Group by author"]
  ], state.sort);
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value as CatchUpSort;
    state.scrollTop = 0;
    rerender();
  });
  controls.append(field("Sort", sortSelect));

  const groupLabel = document.createElement("label");
  groupLabel.className = "av-catch-up-check";
  const group = document.createElement("input");
  group.type = "checkbox";
  group.checked = state.groupByAuthor || state.sort === "author";
  group.addEventListener("change", () => {
    state.groupByAuthor = group.checked;
    rerender();
  });
  groupLabel.append(group, document.createTextNode("Group authors"));
  controls.append(groupLabel);

  const filters = document.createElement("div");
  filters.className = "av-catch-up-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Catch-up categories");
  for (const category of ["all", "original", "replies", "quotes", "reposts", "filtered"] as const) {
    const chip = button(
      `${CATEGORY_LABELS[category]} ${digest.counts[category]}`,
      `av-catch-up-filter${state.category === category ? " is-active" : ""}`
    );
    chip.setAttribute("aria-pressed", String(state.category === category));
    chip.addEventListener("click", () => {
      state.category = category;
      state.scrollTop = 0;
      rerender();
    });
    filters.append(chip);
  }

  const scroller = document.createElement("div");
  scroller.className = "av-catch-up-scroll";
  scroller.addEventListener("scroll", () => {
    state.scrollTop = scroller.scrollTop;
    writeState(state);
  }, { passive: true });
  const content = document.createElement("div");
  content.className = "av-catch-up-content";
  const links = buildLinks(digest.topLinks);
  if (links) content.append(links);

  if (digest.records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "av-catch-up-empty";
    empty.append(
      element("strong", "Nothing in this window."),
      element("p", "Catch-up only includes posts Aviary has already rendered. It does not request more from X."),
      element("span", "That's all.")
    );
    content.append(empty);
  } else {
    appendRecords(content, digest.records, state.groupByAuthor || state.sort === "author");
    content.append(element("p", "That's all.", "av-catch-up-end"));
  }
  scroller.append(content);
  dialog.replaceChildren(header, controls, filters, scroller);
  queueMicrotask(() => {
    scroller.scrollTop = Math.max(0, state.scrollTop);
  });
}

function appendRecords(parent: HTMLElement, records: readonly CatchUpRecord[], grouped: boolean): void {
  let lastAuthor = "";
  for (const record of records) {
    if (grouped && record.handle !== lastAuthor) {
      const heading = element("h3", record.handle ? `@${record.handle}` : "Unknown account", "av-catch-up-author");
      parent.append(heading);
      lastAuthor = record.handle ?? "";
    }
    parent.append(recordRow(record));
  }
}

function recordRow(record: CatchUpRecord): HTMLElement {
  const row = element("article", "", "av-catch-up-record");
  row.dataset.avCategory = record.category;
  const meta = element("div", "", "av-catch-up-meta");
  const author = element("span", record.handle ? `@${record.handle}` : "Unknown account", "av-catch-up-author-name");
  const time = element("time", formatTime(record.seenAt), "av-catch-up-time");
  time.dateTime = record.capturedAt;
  meta.append(author, time);
  const body = element("p", record.text || "(no text)", "av-catch-up-text");
  row.append(meta, body);
  if (record.filterReason) row.append(element("p", record.filterReason, "av-catch-up-reason"));
  if (record.media.length > 0) {
    const media = element("div", "", "av-catch-up-media");
    for (const item of record.media) {
      const preview = button(item.kind === "photo" ? "Photo" : item.kind === "video" ? "Video" : "Thumb", "av-catch-up-media-preview");
      preview.setAttribute("aria-label", `Load ${item.kind} preview`);
      preview.addEventListener("click", () => {
        const image = document.createElement("img");
        image.src = item.url;
        image.alt = item.altText ?? `${item.kind} from the post`;
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        preview.replaceWith(image);
      }, { once: true });
      media.append(preview);
    }
    row.append(media);
  }
  const actions = element("div", "", "av-catch-up-actions");
  if (record.permalink) {
    const link = document.createElement("a");
    link.className = "av-catch-up-link";
    link.href = record.permalink;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open post";
    actions.append(link);
  }
  if (actions.childElementCount > 0) row.append(actions);
  return row;
}

function buildLinks(links: ReturnType<typeof buildCatchUpDigest>["topLinks"]): HTMLElement | null {
  if (links.length === 0) return null;
  const section = element("section", "", "av-catch-up-links");
  section.append(element("h3", "Top links"));
  for (const link of links.slice(0, 5)) {
    const row = element("div", "", "av-catch-up-link-row");
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = link.url;
    row.append(anchor, element("span", `${link.shared} share${link.shared === 1 ? "" : "s"}`));
    section.append(row);
  }
  return section;
}

function field(label: string, control: HTMLSelectElement): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "av-catch-up-field";
  wrapper.append(element("span", label), control);
  return wrapper;
}

function select(label: string, options: Array<[string | number, string]>, value: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "av-catch-up-select";
  select.setAttribute("aria-label", label);
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = String(optionValue);
    option.textContent = optionLabel;
    option.selected = option.value === value;
    select.append(option);
  }
  return select;
}

function button(label: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function formatTime(value: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value);
  } catch {
    return new Date(value).toISOString();
  }
}

function readState(): CatchUpUiState {
  const fallback: CatchUpUiState = { windowHours: 1, category: "all", author: null, sort: "newest", groupByAuthor: false, scrollTop: 0 };
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CatchUpUiState>;
    return {
      windowHours: typeof parsed.windowHours === "number" ? parsed.windowHours : fallback.windowHours,
      category: parsed.category === "original" || parsed.category === "replies" || parsed.category === "quotes" || parsed.category === "reposts" || parsed.category === "filtered" ? parsed.category : "all",
      author: typeof parsed.author === "string" ? parsed.author : null,
      sort: parsed.sort === "oldest" || parsed.sort === "density" || parsed.sort === "author" ? parsed.sort : "newest",
      groupByAuthor: parsed.groupByAuthor === true,
      scrollTop: typeof parsed.scrollTop === "number" && parsed.scrollTop > 0 ? parsed.scrollTop : 0
    };
  } catch {
    return fallback;
  }
}

function writeState(state: CatchUpUiState): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // A private browsing session may reject sessionStorage; the digest remains usable in memory.
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.av-catch-up-dialog {
  width: min(980px, calc(100vw - 40px));
  max-width: none;
  height: min(860px, calc(100vh - 48px));
  padding: 0;
  border: 1px solid rgba(148, 163, 184, .22);
  border-radius: 12px;
  color: #f2f5f7;
  background: #11161c;
  box-shadow: 0 26px 90px rgba(0, 0, 0, .55);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.av-catch-up-dialog::backdrop { background: rgba(3, 7, 12, .72); }
.av-catch-up-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 24px 28px 18px; border-bottom: 1px solid rgba(148, 163, 184, .16); }
.av-catch-up-heading h2 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
.av-catch-up-heading p { margin: 5px 0 0; color: #9aa6b2; }
.av-catch-up-close, .av-catch-up-filter, .av-catch-up-select { border: 1px solid rgba(148, 163, 184, .3); border-radius: 8px; background: #18212b; color: inherit; }
.av-catch-up-close { padding: 8px 12px; cursor: pointer; }
.av-catch-up-controls { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; padding: 16px 28px 10px; }
.av-catch-up-field { display: grid; gap: 5px; color: #9aa6b2; font-size: 12px; }
.av-catch-up-select { min-width: 138px; padding: 8px 10px; font-size: 13px; }
.av-catch-up-check { display: flex; align-items: center; gap: 7px; min-height: 34px; color: #cbd5df; }
.av-catch-up-filters { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 28px 16px; border-bottom: 1px solid rgba(148, 163, 184, .16); }
.av-catch-up-filter { padding: 7px 10px; cursor: pointer; font-size: 12px; }
.av-catch-up-filter.is-active { border-color: #54d5c5; color: #8ef1e4; background: rgba(84, 213, 197, .12); }
.av-catch-up-scroll { height: calc(100% - 162px); overflow: auto; }
.av-catch-up-content { max-width: 760px; margin: 0 auto; padding: 18px 28px 32px; }
.av-catch-up-record { position: relative; padding: 16px 0; border-bottom: 1px solid rgba(148, 163, 184, .13); }
.av-catch-up-record:last-of-type { border-bottom: 0; }
.av-catch-up-meta { display: flex; align-items: baseline; gap: 10px; }
.av-catch-up-author-name { font-weight: 650; color: #e8edf1; }
.av-catch-up-time { color: #8693a0; font-size: 12px; }
.av-catch-up-text { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #d9e0e6; }
.av-catch-up-reason { margin: 8px 0 0; color: #f5c36a; font-size: 12px; }
.av-catch-up-media { display: flex; gap: 8px; margin-top: 12px; }
.av-catch-up-media img, .av-catch-up-media-preview { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: #202a34; }
.av-catch-up-media-preview { border: 1px solid rgba(148, 163, 184, .24); color: #aeb9c3; cursor: pointer; font-size: 11px; }
.av-catch-up-actions { margin-top: 10px; }
.av-catch-up-link { color: #71e2d2; text-decoration: none; font-size: 12px; }
.av-catch-up-link:hover { text-decoration: underline; }
.av-catch-up-author { margin: 20px 0 0; font-size: 13px; color: #8ef1e4; }
.av-catch-up-links { margin: 0 0 8px; padding: 12px 0; border-bottom: 1px solid rgba(148, 163, 184, .13); }
.av-catch-up-links h3 { margin: 0 0 8px; font-size: 13px; color: #aeb9c3; }
.av-catch-up-link-row { display: flex; justify-content: space-between; gap: 14px; padding: 5px 0; font-size: 12px; }
.av-catch-up-link-row a { overflow: hidden; color: #d9e0e6; text-overflow: ellipsis; white-space: nowrap; }
.av-catch-up-link-row span { flex: none; color: #8693a0; }
.av-catch-up-empty { display: grid; gap: 8px; padding: 80px 0; text-align: center; color: #9aa6b2; }
.av-catch-up-empty strong { color: #e8edf1; font-size: 18px; }
.av-catch-up-empty p { margin: 0; }
.av-catch-up-end { margin: 22px 0 0; text-align: center; color: #65727f; font-size: 12px; }
@media (max-width: 640px) {
  .av-catch-up-dialog { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
  .av-catch-up-header, .av-catch-up-controls, .av-catch-up-filters { padding-left: 18px; padding-right: 18px; }
  .av-catch-up-content { padding-left: 18px; padding-right: 18px; }
  .av-catch-up-scroll { height: calc(100% - 194px); }
}
`;
  (document.head ?? document.documentElement).append(style);
}
