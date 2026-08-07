import type { StorageGateway } from "../../platform/storage";
import type { FeatureContext, FeatureModule } from "../registry";
import { ft } from "../core/feature-i18n";

export const USER_NOTES_KEY = "aviary.userNotes.v1";
const STYLE_ID = "av-user-notes";
const BADGE_ATTR = "data-av-note-badge";
const ARTICLE_ATTR = "data-av-note-processed";

interface UserNotesStore {
  notes: Record<string, string>;
  updatedAt: string | null;
}

let cache: UserNotesStore | undefined;
let activeStorage: StorageGateway | undefined;

export const userNotesFeature: FeatureModule = {
  id: "library.userNotes",
  title: "Account notes",
  category: "core",
  defaultEnabled: true,

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
    await activeStorage.set(USER_NOTES_KEY, cache);
  } catch {
    // best effort
  }
}

export async function clearUserNotes(): Promise<void> {
  if (!activeStorage) return;
  cache = { notes: {}, updatedAt: new Date().toISOString() };
  try {
    await activeStorage.set(USER_NOTES_KEY, cache);
  } catch {
    // best effort
  }
}

async function load(storage: StorageGateway): Promise<UserNotesStore> {
  const fallback: UserNotesStore = { notes: {}, updatedAt: null };
  const stored = await storage.get<UserNotesStore>(USER_NOTES_KEY, fallback);
  const notes = stored?.notes ?? {};
  const sanitized: Record<string, string> = {};
  for (const [handle, note] of Object.entries(notes)) {
    const normalized = normalizeHandle(handle);
    if (normalized && typeof note === "string" && note.trim().length > 0) {
      sanitized[normalized] = note.slice(0, 280);
    }
  }
  return { notes: sanitized, updatedAt: stored?.updatedAt ?? null };
}

function decorate(ctx: FeatureContext, root: ParentNode | Element): void {
  if (!cache) return;
  const articles =
    root instanceof Element && root.matches('article[data-testid="tweet"]')
      ? [root]
      : Array.from(root.querySelectorAll<Element>('article[data-testid="tweet"]'));

  for (const article of articles) {
    if (article.getAttribute(ARTICLE_ATTR) === "1") {
      continue;
    }
    const handle = readHandle(article);
    if (!handle) continue;
    const note = cache.notes[handle];
    if (!note) {
      article.setAttribute(ARTICLE_ATTR, "1");
      continue;
    }
    const userName = article.querySelector('[data-testid="User-Name"]');
    if (!userName || userName.querySelector(`[${BADGE_ATTR}]`)) {
      article.setAttribute(ARTICLE_ATTR, "1");
      continue;
    }
    const badge = document.createElement("span");
    badge.setAttribute(BADGE_ATTR, "1");
    badge.className = "av-note-badge";
    badge.textContent = ft(ctx, "Note");
    badge.title = note;
    badge.setAttribute("role", "note");
    badge.setAttribute("aria-label", `${ft(ctx, "Note")} @${handle}: ${note}`);
    userName.append(badge);
    article.setAttribute(ARTICLE_ATTR, "1");
  }
}

function readHandle(article: Element): string | null {
  const userName = article.querySelector('[data-testid="User-Name"]');
  const links = userName?.querySelectorAll('a[href^="/"]') ?? [];
  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") ?? "";
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
  style.textContent = NOTE_CSS;
  (document.head ?? document.documentElement).append(style);
}

const NOTE_CSS = `
.av-note-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 70%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 18%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 700;
  font-size: 10px;
  line-height: 1.2;
  font-family: inherit;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
`;
