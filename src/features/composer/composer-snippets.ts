import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";
import { removeFeatureToast, showFeatureToast } from "../core/feature-toast.ts";

const STYLE_ID = "av-composer-snippets";
const TOOLBAR_ATTR = "data-av-composer-mounted";
const PALETTE_ATTR = "data-av-snippet-palette";

export const composerSnippetsFeature: FeatureModule = {
  id: "composer.snippets",
  title: "Composer snippets",
  category: "core",

  init(ctx) {
    appliedSnippetsSignature = snippetsSignature(ctx);
    if (ctx.settings.composer.snippets.length === 0) {
      return;
    }
    ensureComposerStyle();
    decorate(ctx, document);
    ctx.diagnostics.info("Composer snippets initialized");
  },

  apply(ctx, root, addedNodes) {
    if (ctx.settings.composer.snippets.length === 0) {
      clearDecorations();
      appliedSnippetsSignature = undefined;
      return;
    }
    const signature = snippetsSignature(ctx);
    if (appliedSnippetsSignature !== undefined && appliedSnippetsSignature !== signature) {
      // A visible palette contains the old list. Close it before repainting the existing
      // toolbar so a subsequent click cannot choose a deleted snippet.
      closePalettes();
    }
    appliedSnippetsSignature = signature;
    ensureComposerStyle();
    if (!addedNodes || addedNodes.length === 0) {
      decorate(ctx, root);
      return;
    }
    for (const node of addedNodes) {
      decorate(ctx, node);
    }
  },

  destroy(ctx) {
    clearDecorations();
    appliedSnippetsSignature = undefined;
    ctx.diagnostics.info("Composer snippets destroyed");
  },

  getStatus(): { ok: boolean; message: string } {
    return { ok: true, message: "Composer snippets ready" };
  }
};

let openPaletteKeydown: ((event: KeyboardEvent) => void) | undefined;
let openPaletteNode: HTMLElement | undefined;
let openPaletteTrigger: HTMLElement | undefined;
let appliedSnippetsSignature: string | undefined;
let paletteSequence = 0;

function clearDecorations(): void {
  closePalettes();
  removeFeatureToast();
  document.getElementById(STYLE_ID)?.remove();
  for (const toolbar of Array.from(document.querySelectorAll(`[${TOOLBAR_ATTR}]`))) {
    toolbar.removeAttribute(TOOLBAR_ATTR);
  }
  for (const trigger of Array.from(document.querySelectorAll(`[${PALETTE_ATTR}="trigger"]`))) {
    trigger.remove();
  }
}

function closePalettes(restoreFocus = true): void {
  const palette = openPaletteNode;
  if (openPaletteKeydown && palette) {
    palette.removeEventListener("keydown", openPaletteKeydown);
    openPaletteKeydown = undefined;
  }
  const trigger = openPaletteTrigger;
  trigger?.setAttribute("aria-expanded", "false");
  openPaletteTrigger = undefined;
  if (palette) {
    try {
      (palette as HTMLElement & { hidePopover?: () => void }).hidePopover?.();
    } catch {
      // Keep teardown best-effort for embedded hosts without a complete Popover implementation.
    }
    palette.remove();
  }
  for (const stray of Array.from(document.querySelectorAll(`[${PALETTE_ATTR}="popover"]`))) {
    stray.remove();
  }
  openPaletteNode = undefined;
  if (restoreFocus && trigger?.isConnected) {
    trigger.focus({ preventScroll: true });
  }
}

function snippetsSignature(ctx: FeatureContext): string {
  return ctx.settings.composer.snippets.join("\u001f");
}

function decorate(ctx: FeatureContext, root: ParentNode | Element): void {
  // The trigger is only worth its place once there is something to insert. With no snippets
  // configured -- the default -- the composer is left exactly as X built it.
  if (ctx.settings.composer.snippets.length === 0) {
    return;
  }
  const toolbars =
    root instanceof Element && root.matches('[data-testid="toolBar"]')
      ? [root as HTMLElement]
      : Array.from(root.querySelectorAll<HTMLElement>('[data-testid="toolBar"]'));

  for (const toolbar of toolbars) {
    if (toolbar.getAttribute(TOOLBAR_ATTR) === "1") {
      const trigger = toolbar.querySelector<HTMLElement>(`[${PALETTE_ATTR}="trigger"]`);
      if (trigger) {
        configureTrigger(trigger);
        trigger.textContent = ft(ctx, "Snippets");
        trigger.setAttribute("aria-label", ft(ctx, "Open Aviary composer snippets"));
      }
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "av-snippet-trigger";
    button.setAttribute(PALETTE_ATTR, "trigger");
    configureTrigger(button);
    button.textContent = ft(ctx, "Snippets");
    button.setAttribute("aria-label", ft(ctx, "Open Aviary composer snippets"));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      openPalette(button, ctx);
    });
    toolbar.append(button);
    toolbar.setAttribute(TOOLBAR_ATTR, "1");
  }
}

function configureTrigger(trigger: HTMLElement): void {
  if (!trigger.id) {
    const sequence = ++paletteSequence;
    trigger.id = `av-snippet-trigger-${sequence}`;
    trigger.setAttribute("aria-controls", `av-snippet-menu-${sequence}`);
  }
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
}

function openPalette(trigger: HTMLElement, ctx: FeatureContext): void {
  // Close any existing palette before opening a new one (idempotent).
  closePalettes();

  const snippets = ctx.settings.composer.snippets;
  const popover = document.createElement("div");
  popover.setAttribute(PALETTE_ATTR, "popover");
  popover.setAttribute("popover", "auto");
  popover.className = "av-snippet-popover";
  popover.setAttribute("role", "menu");
  popover.tabIndex = -1;
  popover.id = trigger.getAttribute("aria-controls") ?? `av-snippet-menu-${++paletteSequence}`;
  popover.setAttribute("aria-labelledby", trigger.id);
  trigger.setAttribute("aria-expanded", "true");
  openPaletteTrigger = trigger;

  if (snippets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "av-snippet-empty";
    empty.textContent = ft(ctx, "No snippets yet. Add some in the Control Center → Library.");
    popover.append(empty);
  } else {
    for (const snippet of snippets) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "av-snippet-option";
      option.textContent = snippet.length > 80 ? `${snippet.slice(0, 77)}…` : snippet;
      option.setAttribute("role", "menuitem");
      option.tabIndex = -1;
      option.title = snippet;
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (insertSnippet(snippet)) {
          ctx.diagnostics.info("Snippet inserted", { length: snippet.length });
          void ctx.auditLog.record("snippet.insert", { length: snippet.length });
        } else {
          ctx.diagnostics.warn("Snippet insert failed — composer not focused");
          // A successful insert is self-evident (the text appears); only the failure needs
          // saying, and it needs to say what to do about it.
          showFeatureToast(ft(ctx, "Click into the composer first, then pick a snippet."), {
            tone: "error",
            ctx
          });
        }
        closePalettes();
      });
      popover.append(option);
    }
  }

  document.body.append(popover);
  positionPopover(popover, trigger);
  openPaletteNode = popover;
  const menuItems = (): HTMLButtonElement[] =>
    Array.from(popover.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  const focusMenuItem = (index: number): void => {
    const items = menuItems();
    if (items.length === 0) {
      popover.focus({ preventScroll: true });
      return;
    }
    const next = (index + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };
  const keydown = (event: KeyboardEvent): void => {
    const items = menuItems();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closePalettes();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusMenuItem(current + 1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusMenuItem(current - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(items.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[current]?.click();
    }
  };
  openPaletteKeydown = keydown;
  popover.addEventListener("keydown", keydown);
  popover.addEventListener("toggle", (event) => {
    const closed = (event as Event & { newState?: string }).newState === "closed";
    if (closed && openPaletteNode === popover) {
      // Escape and light-dismiss are handled by the UA. Mirror the state back to the trigger and
      // remove the detached palette so future composer mutations cannot keep stale snippets.
      closePalettes();
    }
  });
  try {
    (popover as HTMLElement & { showPopover?: () => void }).showPopover?.();
  } catch {
    // The manifest floors include Popover API support. The authored palette remains usable in a
    // test host that exposes the attribute but not the methods.
  }
  focusMenuItem(0);
}

function insertSnippet(snippet: string): boolean {
  const composer = document.querySelector<HTMLElement>('[data-testid="tweetTextarea_0"]');
  if (!composer) return false;
  composer.focus();
  // execCommand("insertText") is deprecated but is the only mechanism Draft.js (used by the X
  // composer) recognises as a real edit. Aviary never simulates keystrokes.
  const ok = document.execCommand("insertText", false, snippet);
  if (!ok) {
    return false;
  }
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: snippet }));
  return true;
}

function positionPopover(popover: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.left = `${Math.max(12, rect.left)}px`;
  popover.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
  popover.style.maxWidth = "320px";
}

function ensureComposerStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = COMPOSER_CSS;
  (document.head ?? document.documentElement).append(style);
}

const COMPOSER_CSS = `
.av-snippet-trigger {
  margin-inline-start: 8px;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 14%, transparent);
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 700;
  font-size: 11px;
  line-height: 1.2;
  font-family: inherit;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}

.av-snippet-popover {
  margin: 0;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
}

.av-snippet-option {
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 600;
  font-size: 12px;
  line-height: 1.3;
  font-family: inherit;
  text-align: start;
  cursor: pointer;
}

.av-snippet-option:hover,
.av-snippet-option:focus-visible {
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 12%, transparent);
}

.av-snippet-empty {
  padding: 6px 8px;
  color: var(--av-muted, rgb(113, 118, 123));
  font-size: 12px;
}
`;
