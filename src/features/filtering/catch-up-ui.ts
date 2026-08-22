import {
  buildCatchUpDigest,
  type CatchUpCategory,
  type CatchUpRecord,
  type CatchUpSort
} from "./catch-up.ts";
import { ft } from "../core/feature-i18n.ts";
import type { FeatureContext } from "../registry.ts";

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

/**
 * Written as literal `ft` calls rather than a lookup table the caller indexes.
 *
 * tools/i18n-extract.mjs harvests literal ft call sites out of the source, so a label reached
 * through a computed index is invisible to it and ships untranslated however complete the catalog
 * looks. CLAUDE.md records this trap; this is the shape that avoids it.
 */
function categoryLabel(ctx: FeatureContext, category: CatchUpCategory | "all"): string {
  switch (category) {
    case "original":
      return ft(ctx, "Original");
    case "replies":
      return ft(ctx, "Replies");
    case "quotes":
      return ft(ctx, "Quotes");
    case "reposts":
      return ft(ctx, "Reposts");
    case "filtered":
      return ft(ctx, "Filtered");
    default:
      return ft(ctx, "All");
  }
}

const WINDOW_OPTIONS: Array<[number, string]> = [
  [1, "Last hour"],
  [2, "Last 2 hours"],
  [4, "Last 4 hours"],
  [6, "Last 6 hours"],
  [8, "Last 8 hours"],
  [12, "Last 12 hours"],
  [13, "Beyond 12 hours"]
];

export function openCatchUpDigest(
  ctx: FeatureContext,
  entries: readonly CatchUpRecord[]
): { count: number } {
  document.getElementById(DIALOG_ID)?.remove();
  ensureStyle();
  const dialog = document.createElement("dialog");
  dialog.id = DIALOG_ID;
  dialog.className = "av-catch-up-dialog";
  dialog.setAttribute("aria-labelledby", "av-catch-up-title");
  const state = readState();

  // Built once. Only the scroller's contents are replaced on a state change, because rebuilding
  // the whole dialog removed the select or chip the user had just operated -- focus fell back to
  // the dialog root and the next Tab restarted from the top, which made filtering the digest
  // unusable from the keyboard.
  const header = buildHeader(ctx, dialog);
  const controls = document.createElement("div");
  controls.className = "av-catch-up-controls";
  const filters = document.createElement("div");
  filters.className = "av-catch-up-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", ft(ctx, "Catch-up categories"));
  const scroller = document.createElement("div");
  scroller.className = "av-catch-up-scroll";
  scroller.addEventListener("scroll", () => {
    state.scrollTop = scroller.scrollTop;
    writeState(state);
  }, { passive: true });

  const render = (): void => {
    renderDigest(ctx, { header, controls, filters, scroller }, entries, state, render);
  };

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    writeState(state);
    dialog.remove();
  }, { once: true });
  dialog.append(header, controls, filters, scroller);
  document.body.append(dialog);
  buildControls(ctx, controls, state, render);
  render();
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    // A plain `open` attribute is not a modal: it carries no dialog semantics, moves no focus, and
    // leaves the page behind it in the tab order. Both manifest floors ship showModal, so this path
    // only runs in an embedded host -- but it still has to be usable rather than a trap.
    //
    // Everything a modal owes the reader except Escape: the surface says what it is, focus lands on
    // the control that dismisses it, and the rest of the document is made inert so Tab cannot walk
    // out behind it. Escape is deliberately absent -- this project registers no keyboard shortcuts,
    // and `tests/source-contracts.test.mjs` enforces that -- so on this path the close button and
    // the backdrop click are the ways out. Native showModal supplies Escape everywhere it exists.
    dialog.setAttribute("open", "true");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    // The dialog's siblings, not <body> itself. A modal opened with showModal is exempt from an
    // inert ancestor; this one is not, so inerting <body> would make the dialog inside it dead too.
    const inerted: Element[] = [];
    for (const sibling of Array.from(document.body?.children ?? [])) {
      if (sibling === dialog || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      inerted.push(sibling);
    }
    dialog.addEventListener(
      "close",
      () => {
        for (const sibling of inerted) sibling.removeAttribute("inert");
      },
      { once: true }
    );
    header.querySelector<HTMLButtonElement>(".av-catch-up-close")?.focus();
  }
  const digest = buildCatchUpDigest(entries, state);
  return { count: digest.records.length };
}

/**
 * Takes the digest and its stylesheet back off the page.
 *
 * The dialog removes itself on `close`, but nothing fires that during teardown, and the stylesheet
 * was never removed at all -- so after `registry.destroyAll` the page had not returned to what X
 * rendered, which is the contract every feature is held to.
 */
export function closeCatchUpDigest(): void {
  document.getElementById(DIALOG_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
}

interface DialogParts {
  header: HTMLElement;
  controls: HTMLElement;
  filters: HTMLElement;
  scroller: HTMLElement;
}

/** Built once, so the close button keeps its identity across every state change. */
function buildHeader(ctx: FeatureContext, dialog: HTMLDialogElement): HTMLElement {
  const header = document.createElement("header");
  header.className = "av-catch-up-header";
  const heading = document.createElement("div");
  heading.className = "av-catch-up-heading";
  const title = document.createElement("h2");
  title.id = "av-catch-up-title";
  title.textContent = ft(ctx, "Catch-up");
  const summary = document.createElement("p");
  summary.className = "av-catch-up-summary";
  // The count changes as the reader filters, and a screen reader was told nothing about it.
  summary.setAttribute("role", "status");
  heading.append(title, summary);

  const close = button(ft(ctx, "Close"), "av-catch-up-close");
  close.setAttribute("aria-label", ft(ctx, "Close catch-up"));
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  return header;
}

/** Built once. Their values are read from `state`, so a re-render never replaces them. */
function buildControls(
  ctx: FeatureContext,
  controls: HTMLElement,
  state: CatchUpUiState,
  rerender: () => void
): void {
  const windowSelect = select(
    ft(ctx, "Window"),
    WINDOW_OPTIONS.map(([value, label]) => [value, ft(ctx, label)] as [string | number, string]),
    String(state.windowHours)
  );
  windowSelect.addEventListener("change", () => {
    state.windowHours = Number(windowSelect.value);
    state.scrollTop = 0;
    rerender();
  });
  controls.append(field(ft(ctx, "Window"), windowSelect));

  const sortSelect = select(
    ft(ctx, "Sort"),
    [
      ["newest", ft(ctx, "Newest first")],
      ["oldest", ft(ctx, "Oldest first")],
      ["density", ft(ctx, "Least dense first")],
      ["author", ft(ctx, "Group by author")]
    ],
    state.sort
  );
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value as CatchUpSort;
    state.scrollTop = 0;
    rerender();
  });
  controls.append(field(ft(ctx, "Sort"), sortSelect));

  const groupLabel = document.createElement("label");
  groupLabel.className = "av-catch-up-check";
  const group = document.createElement("input");
  group.type = "checkbox";
  group.checked = state.groupByAuthor || state.sort === "author";
  group.addEventListener("change", () => {
    state.groupByAuthor = group.checked;
    rerender();
  });
  groupLabel.append(group, document.createTextNode(ft(ctx, "Group by author")));
  controls.append(groupLabel);
}

/**
 * Repaints what the state actually changes: the summary count, the chip counts and pressed state,
 * and the scroller's contents. The header, the selects and the chips themselves stay mounted, so
 * whatever the reader was operating still has focus when this returns.
 */
function renderDigest(
  ctx: FeatureContext,
  parts: DialogParts,
  entries: readonly CatchUpRecord[],
  state: CatchUpUiState,
  rerender: () => void
): void {
  const digest = buildCatchUpDigest(entries, state);

  const summary = parts.header.querySelector(".av-catch-up-summary");
  if (summary) {
    summary.textContent =
      digest.records.length > 0
        ? `${digest.records.length} ${ft(ctx, digest.records.length === 1 ? "post Aviary saw in this window" : "posts Aviary saw in this window")}`
        : ft(ctx, "A quiet window. Nothing new to review.");
  }

  const categories = ["all", "original", "replies", "quotes", "reposts", "filtered"] as const;
  if (parts.filters.childElementCount === 0) {
    for (const category of categories) {
      const chip = button("", "av-catch-up-filter");
      chip.dataset.avCategory = category;
      chip.addEventListener("click", () => {
        state.category = category;
        state.scrollTop = 0;
        rerender();
      });
      parts.filters.append(chip);
    }
  }
  for (const chip of Array.from(parts.filters.children)) {
    const category = (chip as HTMLElement).dataset.avCategory as CatchUpCategory | "all";
    chip.textContent = `${categoryLabel(ctx, category)} ${digest.counts[category]}`;
    chip.classList.toggle("is-active", state.category === category);
    chip.setAttribute("aria-pressed", String(state.category === category));
  }

  const content = document.createElement("div");
  content.className = "av-catch-up-content";
  const links = buildLinks(ctx, digest.topLinks);
  if (links) content.append(links);

  if (digest.records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "av-catch-up-empty";
    empty.append(
      element("strong", ft(ctx, "Nothing in this window.")),
      element("p", ft(ctx, "Catch-up only includes posts Aviary has already rendered. It does not request more from X.")),
      element("span", ft(ctx, "That's all."))
    );
    content.append(empty);
  } else {
    appendRecords(ctx, content, digest.records, state.groupByAuthor || state.sort === "author");
    content.append(element("p", ft(ctx, "That's all."), "av-catch-up-end"));
  }
  parts.scroller.replaceChildren(content);
  queueMicrotask(() => {
    parts.scroller.scrollTop = Math.max(0, state.scrollTop);
  });
}

function appendRecords(
  ctx: FeatureContext,
  parent: HTMLElement,
  records: readonly CatchUpRecord[],
  grouped: boolean
): void {
  let lastAuthor = "";
  for (const record of records) {
    if (grouped && record.handle !== lastAuthor) {
      const heading = element("h3", record.handle ? `@${record.handle}` : ft(ctx, "Unknown account"), "av-catch-up-author");
      parent.append(heading);
      lastAuthor = record.handle ?? "";
    }
    parent.append(recordRow(ctx, record));
  }
}

function recordRow(ctx: FeatureContext, record: CatchUpRecord): HTMLElement {
  const row = element("article", "", "av-catch-up-record");
  row.dataset.avCategory = record.category;
  const meta = element("div", "", "av-catch-up-meta");
  const author = element("span", record.handle ? `@${record.handle}` : ft(ctx, "Unknown account"), "av-catch-up-author-name");
  const time = element("time", formatTime(record.seenAt), "av-catch-up-time");
  time.dateTime = record.capturedAt;
  meta.append(author, time);
  const body = element("p", record.text || ft(ctx, "(no text)"), "av-catch-up-text");
  row.append(meta, body);
  if (record.filterReason) row.append(element("p", record.filterReason, "av-catch-up-reason"));
  if (record.media.length > 0) {
    const media = element("div", "", "av-catch-up-media");
    for (const item of record.media) {
      const preview = button(
        item.kind === "photo"
          ? ft(ctx, "Photo")
          : item.kind === "video"
            ? ft(ctx, "Video")
            : item.kind === "audio"
              ? ft(ctx, "Audio")
              : item.kind === "subtitle"
                ? ft(ctx, "Captions")
                : ft(ctx, "Thumb"),
        "av-catch-up-media-preview"
      );
      preview.setAttribute("aria-label", `${ft(ctx, "Load preview")}: ${item.kind}`);
      preview.addEventListener("click", () => {
        if (item.kind === "audio") {
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = item.url;
          preview.replaceWith(audio);
          return;
        }
        if (item.kind === "subtitle") {
          const link = document.createElement("a");
          link.href = item.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = ft(ctx, "Open captions");
          preview.replaceWith(link);
          return;
        }
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
    link.textContent = ft(ctx, "Open post");
    actions.append(link);
  }
  if (actions.childElementCount > 0) row.append(actions);
  return row;
}

function buildLinks(
  ctx: FeatureContext,
  links: ReturnType<typeof buildCatchUpDigest>["topLinks"]
): HTMLElement | null {
  if (links.length === 0) return null;
  const section = element("section", "", "av-catch-up-links");
  section.append(element("h3", ft(ctx, "Top links")));
  for (const link of links.slice(0, 5)) {
    const row = element("div", "", "av-catch-up-link-row");
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = link.url;
    row.append(
      anchor,
      element("span", `${link.shared} ${ft(ctx, link.shared === 1 ? "share" : "shares")}`)
    );
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

/**
 * The digest is a first-class Aviary surface: it is appended to <body> with its own document-level
 * stylesheet, and it was the only one that ignored the user's theme entirely. Every colour below
 * reads a token with its previous literal as the fallback, so the default theme "off" -- which
 * defines no custom properties -- paints exactly what it painted before, while a chosen palette
 * now reaches it.
 */
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
  color: var(--av-text, #f2f5f7);
  background: var(--av-surface, #11161c);
  box-shadow: 0 26px 90px rgba(0, 0, 0, .55);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.av-catch-up-dialog::backdrop { background: rgba(3, 7, 12, .72); }
.av-catch-up-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 24px 28px 18px; border-bottom: 1px solid rgba(148, 163, 184, .16); }
.av-catch-up-heading h2 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
.av-catch-up-heading p { margin: 5px 0 0; color: var(--av-muted, #9aa6b2); }
.av-catch-up-close, .av-catch-up-filter, .av-catch-up-select { border: 1px solid rgba(148, 163, 184, .3); border-radius: 8px; background: var(--av-surface-raised, #18212b); color: inherit; }
.av-catch-up-close { padding: 8px 12px; cursor: pointer; }
.av-catch-up-controls { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; padding: 16px 28px 10px; }
.av-catch-up-field { display: grid; gap: 5px; color: var(--av-muted, #9aa6b2); font-size: 12px; }
.av-catch-up-select { min-width: 138px; padding: 8px 10px; font-size: 13px; }
.av-catch-up-check { display: flex; align-items: center; gap: 7px; min-height: 34px; color: var(--av-text, #cbd5df); }
.av-catch-up-filters { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 28px 16px; border-bottom: 1px solid rgba(148, 163, 184, .16); }
.av-catch-up-filter { padding: 7px 10px; cursor: pointer; font-size: 12px; }
.av-catch-up-filter.is-active { border-color: var(--av-accent, #54d5c5); color: var(--av-accent, #8ef1e4); background: color-mix(in srgb, var(--av-accent, #54d5c5) 12%, transparent); }
.av-catch-up-scroll { height: calc(100% - 162px); overflow: auto; }
.av-catch-up-content { max-width: 760px; margin: 0 auto; padding: 18px 28px 32px; }
.av-catch-up-record { position: relative; padding: 16px 0; border-bottom: 1px solid rgba(148, 163, 184, .13); }
.av-catch-up-record:last-of-type { border-bottom: 0; }
.av-catch-up-meta { display: flex; align-items: baseline; gap: 10px; }
.av-catch-up-author-name { font-weight: 650; color: var(--av-text, #e8edf1); }
.av-catch-up-time { color: var(--av-muted, #8693a0); font-size: 12px; }
.av-catch-up-text { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--av-text, #d9e0e6); }
.av-catch-up-reason { margin: 8px 0 0; color: var(--av-warn, #f5c36a); font-size: 12px; }
.av-catch-up-media { display: flex; gap: 8px; margin-top: 12px; }
.av-catch-up-media img, .av-catch-up-media-preview { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; background: var(--av-surface-raised, #202a34); }
.av-catch-up-media-preview { border: 1px solid rgba(148, 163, 184, .24); color: #aeb9c3; cursor: pointer; font-size: 11px; }
.av-catch-up-actions { margin-top: 10px; }
.av-catch-up-link { color: var(--av-accent, #71e2d2); text-decoration: none; font-size: 12px; }
.av-catch-up-link:hover { text-decoration: underline; }
.av-catch-up-author { margin: 20px 0 0; font-size: 13px; color: var(--av-accent, #8ef1e4); }
.av-catch-up-links { margin: 0 0 8px; padding: 12px 0; border-bottom: 1px solid rgba(148, 163, 184, .13); }
.av-catch-up-links h3 { margin: 0 0 8px; font-size: 13px; color: #aeb9c3; }
.av-catch-up-link-row { display: flex; justify-content: space-between; gap: 14px; padding: 5px 0; font-size: 12px; }
.av-catch-up-link-row a { overflow: hidden; color: var(--av-text, #d9e0e6); text-overflow: ellipsis; white-space: nowrap; }
.av-catch-up-link-row span { flex: none; color: var(--av-muted, #8693a0); }
.av-catch-up-empty { display: grid; gap: 8px; padding: 80px 0; text-align: center; color: var(--av-muted, #9aa6b2); }
.av-catch-up-empty strong { color: var(--av-text, #e8edf1); font-size: 18px; }
.av-catch-up-empty p { margin: 0; }
.av-catch-up-end { margin: 22px 0 0; text-align: center; color: var(--av-muted, #8693a0); font-size: 12px; }
@media (max-width: 640px) {
  .av-catch-up-dialog { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
  .av-catch-up-header, .av-catch-up-controls, .av-catch-up-filters { padding-left: 18px; padding-right: 18px; }
  .av-catch-up-content { padding-left: 18px; padding-right: 18px; }
  .av-catch-up-scroll { height: calc(100% - 194px); }
}
`;
  (document.head ?? document.documentElement).append(style);
}
