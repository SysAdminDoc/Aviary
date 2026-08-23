import type { StorageGateway } from "../../platform/storage.ts";
import { replaceStored } from "../../platform/storage-lock.ts";
import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";

export const USER_NOTES_KEY = "aviary.userNotes.v1";
const STYLE_ID = "av-user-notes";
const BADGE_ATTR = "data-av-note-badge";
const ARTICLE_ATTR = "data-av-note-processed";

/**
 * A bounded palette rather than free-form colour: a label has to stay legible against every theme
 * Aviary ships and against X's own light and dark, which an arbitrary hex value cannot promise.
 */
export const USER_COLORS = ["amber", "rose", "violet", "sky", "green", "slate"] as const;
export type UserColor = (typeof USER_COLORS)[number];

interface UserNotesStore {
  notes: Record<string, string>;
  /** Optional colour label per handle. Absent in payloads written before this existed. */
  colors: Record<string, UserColor>;
  updatedAt: string | null;
}

let cache: UserNotesStore | undefined;
let activeStorage: StorageGateway | undefined;

export const userNotesFeature: FeatureModule = {
  id: "library.userNotes",
  title: "Account notes",
  category: "core",

  async init(ctx) {
    activeStorage = ctx.storage;
    ensureStyle();
    cache = await load(ctx.storage);
    decorate(ctx, document);
    ctx.diagnostics.info("User notes initialized", { count: Object.keys(cache.notes).length });
  },

  apply(ctx, root, addedNodes) {
    ensureStyle();
    if (!cache) {
      return;
    }
    if (!addedNodes || addedNodes.length === 0) {
      decorate(ctx, root);
      return;
    }
    for (const node of addedNodes) {
      decorate(ctx, node);
    }
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    for (const article of Array.from(document.querySelectorAll(`[${ARTICLE_ATTR}]`))) {
      article.removeAttribute(ARTICLE_ATTR);
    }
    for (const badge of Array.from(document.querySelectorAll(`[${BADGE_ATTR}]`))) {
      badge.remove();
    }
    cache = undefined;
    activeStorage = undefined;
    ctx.diagnostics.info("User notes destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: cache ? `${Object.keys(cache.notes).length} notes` : "Notes idle"
    };
  }
};

export function getUserNotes(): Record<string, string> {
  return { ...(cache?.notes ?? {}) };
}

export async function setUserNote(handle: string, note: string): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (!normalized || !activeStorage) {
    return;
  }
  if (!cache) {
    cache = await load(activeStorage);
  }
  if (note.trim().length === 0) {
    delete cache.notes[normalized];
  } else {
    cache.notes[normalized] = note.trim().slice(0, 280);
  }
  cache.updatedAt = new Date().toISOString();
  try {
    await replaceStored(activeStorage, USER_NOTES_KEY, cache);
  } catch {
    // best effort
  }
}

export function getUserColors(): Record<string, UserColor> {
  return { ...(cache?.colors ?? {}) };
}

export async function setUserColor(handle: string, color: UserColor | ""): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (!normalized || !activeStorage) {
    return;
  }
  if (!cache) {
    cache = await load(activeStorage);
  }
  if (color === "") {
    delete cache.colors[normalized];
  } else if (isUserColor(color)) {
    cache.colors[normalized] = color;
  } else {
    return;
  }
  cache.updatedAt = new Date().toISOString();
  try {
    await replaceStored(activeStorage, USER_NOTES_KEY, cache);
  } catch {
    // best effort
  }
}

export async function clearUserNotes(): Promise<void> {
  if (!activeStorage) return;
  cache = { notes: {}, colors: {}, updatedAt: new Date().toISOString() };
  try {
    await replaceStored(activeStorage, USER_NOTES_KEY, cache);
  } catch {
    // best effort
  }
}

async function load(storage: StorageGateway): Promise<UserNotesStore> {
  const fallback: UserNotesStore = { notes: {}, colors: {}, updatedAt: null };
  const stored = await storage.get<UserNotesStore>(USER_NOTES_KEY, fallback);
  const notes = stored?.notes ?? {};
  const sanitized: Record<string, string> = {};
  for (const [handle, note] of Object.entries(notes)) {
    const normalized = normalizeHandle(handle);
    if (normalized && typeof note === "string" && note.trim().length > 0) {
      sanitized[normalized] = note.slice(0, 280);
    }
  }
  const colors: Record<string, UserColor> = {};
  for (const [handle, color] of Object.entries(stored?.colors ?? {})) {
    const normalized = normalizeHandle(handle);
    if (normalized && isUserColor(color)) {
      colors[normalized] = color;
    }
  }
  return { notes: sanitized, colors, updatedAt: stored?.updatedAt ?? null };
}

export function isUserColor(value: unknown): value is UserColor {
  return typeof value === "string" && (USER_COLORS as readonly string[]).includes(value);
}

function decorate(ctx: FeatureContext, root: ParentNode | Element): void {
  if (!cache) return;
  const articles =
    root instanceof Element && root.matches('article[data-testid="tweet"]')
      ? [root]
      : Array.from(root.querySelectorAll<Element>('article[data-testid="tweet"]'));

  for (const article of articles) {
    reconcileArticle(article, ctx);
  }
}

function reconcileArticle(article: Element, ctx: FeatureContext): void {
  const handle = readHandle(article);
  const note = handle ? cache?.notes[handle] : undefined;
  const color = handle ? cache?.colors[handle] : undefined;
  const userName = article.querySelector('[data-testid="User-Name"]');
  const badges = Array.from(article.querySelectorAll(`[${BADGE_ATTR}]`));

  // A colour with no note is still a label worth showing, so either one earns a badge.
  if (!handle || (!note && !color) || !userName) {
    for (const badge of badges) {
      badge.remove();
    }
    article.setAttribute(ARTICLE_ATTR, "1");
    return;
  }

  const badge = badges.find((candidate) => userName.contains(candidate));
  for (const duplicate of badges) {
    if (duplicate !== badge) {
      duplicate.remove();
    }
  }

  if (badge instanceof HTMLElement) {
    updateBadge(badge, handle, note, color, ctx);
    article.setAttribute(ARTICLE_ATTR, "1");
    return;
  }

  const nextBadge = document.createElement("span");
  nextBadge.setAttribute(BADGE_ATTR, "1");
  nextBadge.className = "av-note-badge";
  nextBadge.setAttribute("role", "note");
  updateBadge(nextBadge, handle, note, color, ctx);
  userName.append(nextBadge);
  article.setAttribute(ARTICLE_ATTR, "1");
}

function updateBadge(
  badge: HTMLElement,
  handle: string,
  note: string | undefined,
  color: UserColor | undefined,
  ctx: FeatureContext
): void {
  const label = note ? ft(ctx, "Note") : ft(ctx, "Tag");
  badge.textContent = label;
  badge.title = note ?? "";
  // Colour is never the only carrier of meaning: the badge keeps its text and its label names the
  // colour, so the tag survives a screen reader and a monochrome display.
  const description = note ? `${label} @${handle}: ${note}` : `${label} @${handle}: ${color}`;
  badge.setAttribute("aria-label", description);
  if (color) {
    badge.setAttribute("data-av-note-color", color);
  } else {
    badge.removeAttribute("data-av-note-color");
  }
}

function readHandle(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  // Every profile link, not only relative ones: the saved captures rewrite hrefs to absolute URLs,
  // so a relative-only selector reads every author as unknown when tested against them.
  const links = userName?.querySelectorAll("a[href]") ?? [];
  for (const link of Array.from(links)) {
    const href = (link.getAttribute("href") ?? "").replace(
      /^https?:\/\/(?:www\.|mobile\.|pro\.)?(?:x|twitter)\.com/i,
      ""
    );
    const match = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
    const candidate = match?.[1];
    if (candidate) {
      return normalizeHandle(candidate);
    }
  }
  return null;
}

function normalizeHandle(value: string): string | null {
  const cleaned = value.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(cleaned) ? cleaned : null;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `${NOTE_CSS}\n${COLOR_CSS}`;
  (document.head ?? document.documentElement).append(style);
}

/* One rule per palette entry rather than an inline style, so a colour cannot be injected from
   stored data and every value is one this stylesheet already knows. */
const COLOR_CSS = USER_COLORS.map((color) => {
  const tint = {
    amber: "245, 158, 11",
    rose: "244, 63, 94",
    violet: "139, 92, 246",
    sky: "56, 189, 248",
    green: "34, 197, 94",
    slate: "148, 163, 184"
  }[color];
  return `.av-note-badge[data-av-note-color="${color}"] {
  border-color: rgba(${tint}, 0.85);
  background: rgba(${tint}, 0.22);
}`;
}).join("\n");

const NOTE_CSS = `
.av-note-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  border-radius: 6px;
  /* Opaque, and deliberately so. This was an 18% accent wash straight over whatever X had behind
     it, which on X's light mode composited to near-white under near-white text: 1.08:1, an
     invisible label. The launcher was fixed the same way and this surface was missed. */
  background: var(--av-surface-raised, rgb(22, 24, 28));
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 45%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 700;
  font-size: 10px;
  line-height: 1.2;
  font-family: inherit;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
`;
