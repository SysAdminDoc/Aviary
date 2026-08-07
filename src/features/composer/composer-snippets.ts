import type { FeatureContext, FeatureModule } from "../registry";
import { removeFeatureToast, showFeatureToast } from "../core/feature-toast";

const STYLE_ID = "av-composer-snippets";
const TOOLBAR_ATTR = "data-av-composer-mounted";
const PALETTE_ATTR = "data-av-snippet-palette";

export const composerSnippetsFeature: FeatureModule = {
  id: "composer.snippets",
  title: "Composer snippets",
  category: "core",
  defaultEnabled: true,

  init(ctx) {
    ensureComposerStyle();
    decorate(ctx, document);
    ctx.diagnostics.info("Composer snippets initialized");
  },

  apply(ctx, root, addedNodes) {
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
    removeFeatureToast();
    document.getElementById(STYLE_ID)?.remove();
    for (const toolbar of Array.from(document.querySelectorAll(`[${TOOLBAR_ATTR}]`))) {
      toolbar.removeAttribute(TOOLBAR_ATTR);
    }
    for (const palette of Array.from(document.querySelectorAll(`[${PALETTE_ATTR}]`))) {
      palette.remove();
    }
    ctx.diagnostics.info("Composer snippets destroyed");
  },

  getStatus(): { ok: boolean; message: string } {
    return { ok: true, message: "Composer snippets ready" };
  }
};

function decorate(ctx: FeatureContext, root: ParentNode | Element): void {
  const toolbars =
    root instanceof Element && root.matches('[data-testid="toolBar"]')
      ? [root as HTMLElement]
      : Array.from(root.querySelectorAll<HTMLElement>('[data-testid="toolBar"]'));

  for (const toolbar of toolbars) {
    if (toolbar.getAttribute(TOOLBAR_ATTR) === "1") {
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "av-snippet-trigger";
    button.setAttribute(PALETTE_ATTR, "trigger");
    button.textContent = "Snippets";
    button.setAttribute("aria-label", "Open Aviary composer snippets");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      openPalette(button, ctx);
    });
    toolbar.append(button);
    toolbar.setAttribute(TOOLBAR_ATTR, "1");
  }
}

function openPalette(trigger: HTMLElement, ctx: FeatureContext): void {
  // Close any existing palette before opening a new one (idempotent).
  for (const previous of Array.from(document.querySelectorAll(`[${PALETTE_ATTR}="popover"]`))) {
    previous.remove();
  }

  const snippets = ctx.settings.composer.snippets;
  const popover = document.createElement("div");
  popover.setAttribute(PALETTE_ATTR, "popover");
  popover.className = "av-snippet-popover";
  popover.setAttribute("role", "menu");

  if (snippets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "av-snippet-empty";
    empty.textContent = "No snippets yet. Add some in the Control Center → Library.";
    popover.append(empty);
  } else {
    for (const snippet of snippets) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "av-snippet-option";
      option.textContent = snippet.length > 80 ? `${snippet.slice(0, 77)}…` : snippet;
      option.setAttribute("role", "menuitem");
      option.title = snippet;
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (insertSnippet(snippet)) {
          ctx.diagnostics.info("Snippet inserted", { length: snippet.length });
          void ctx.auditLog.record("settings.import", { kind: "snippet", length: snippet.length });
        } else {
          ctx.diagnostics.warn("Snippet insert failed — composer not focused");
          // A successful insert is self-evident (the text appears); only the failure needs
          // saying, and it needs to say what to do about it.
          showFeatureToast("Click into the composer first, then pick a snippet.", {
            tone: "error",
            ctx
          });
        }
        popover.remove();
      });
      popover.append(option);
    }
  }

  positionPopover(popover, trigger);
  document.body.append(popover);

  const dismiss = (event: Event): void => {
    if (!popover.contains(event.target as Node) && event.target !== trigger) {
      popover.remove();
      document.removeEventListener("click", dismiss, true);
    }
  };
  // Defer so the click that opened the palette doesn't dismiss it.
  setTimeout(() => document.addEventListener("click", dismiss, true), 0);
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
  z-index: 2147482700;
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
