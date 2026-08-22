import type { FeatureContext } from "../registry.ts";

const TOAST_HOST_ID = "av-feature-toast";
const DEFAULT_TIMEOUT_MS = 4000;

export type ToastTone = "info" | "error";

let dismissTimer: ReturnType<typeof setTimeout> | undefined;

type NativePopover = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

/**
 * A small status toast for features that inject into the timeline.
 *
 * These surfaces used to end in silence: the AI menu copied to the clipboard, failed against the
 * provider, or failed to reach the clipboard at all, and every one of those looked identical --
 * the menu simply closed. Diagnostics recorded it, but nothing a viewer would ever open.
 *
 * Lives in its own shadow root so X's stylesheets cannot reach it, and reads its colours from the
 * custom properties the theme sets on `<html>`, which do inherit through a shadow boundary.
 */
export function showFeatureToast(
  message: string,
  options: { tone?: ToastTone; ctx?: FeatureContext; timeoutMs?: number } = {}
): void {
  if (typeof document === "undefined") {
    return;
  }
  const shadow = ensureHost();
  const host = document.getElementById(TOAST_HOST_ID);
  if (host && options.ctx) {
    // The page-level reduced-motion class cannot cross into this shadow tree.
    host.dataset.avMotion = prefersReducedMotion(options.ctx) ? "reduce" : "full";
  }

  const card = shadow.querySelector(".av-ftoast");
  const text = shadow.querySelector(".av-ftoast-text");
  if (!(card instanceof HTMLElement) || !(text instanceof HTMLElement)) {
    return;
  }

  text.textContent = message;
  card.dataset.tone = options.tone ?? "info";
  card.classList.add("is-open");
  try {
    const nativeCard = card as NativePopover;
    if (!card.matches(":popover-open")) {
      nativeCard.showPopover?.();
    }
  } catch {
    // The manifest floors include Popover API support. The class state remains a safe fallback
    // for embedded test hosts that expose the attribute but not the methods.
  }

  if (dismissTimer !== undefined) {
    clearTimeout(dismissTimer);
  }
  dismissTimer = setTimeout(() => {
    card.classList.remove("is-open");
    try {
      (card as NativePopover).hidePopover?.();
    } catch {
      // Keep teardown best-effort if a host removes the popover implementation mid-toast.
    }
    dismissTimer = undefined;
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

/** Removes the host entirely. Features call this from `destroy` so nothing survives teardown. */
export function removeFeatureToast(): void {
  if (dismissTimer !== undefined) {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }
  const host = document.getElementById(TOAST_HOST_ID);
  const card = host?.shadowRoot?.querySelector<HTMLElement>(".av-ftoast");
  if (card) {
    card.classList.remove("is-open");
    try {
      (card as NativePopover).hidePopover?.();
    } catch {
      // The host is removed immediately below, so no further cleanup is required.
    }
  }
  host?.remove();
}

function prefersReducedMotion(ctx: FeatureContext): boolean {
  if (ctx.settings.accessibility.reduceMotion === "always") return true;
  if (ctx.settings.accessibility.reduceMotion === "never") return false;
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function ensureHost(): ShadowRoot {
  const existing = document.getElementById(TOAST_HOST_ID);
  if (existing?.shadowRoot) {
    existing.dir = document.documentElement.dir || "ltr";
    return existing.shadowRoot;
  }

  const host = document.createElement("div");
  host.id = TOAST_HOST_ID;
  host.dataset.avOwned = "true";
  host.dir = document.documentElement.dir || "ltr";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TOAST_CSS;

  const card = document.createElement("div");
  card.className = "av-ftoast";
  card.setAttribute("popover", "manual");
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const text = document.createElement("span");
  text.className = "av-ftoast-text";

  card.append(text);
  shadow.append(style, card);
  return shadow;
}

/* Offset above the hidden-post toast so the two never cover each other. */
const TOAST_CSS = `
.av-ftoast {
  position: fixed;
  inset: auto;
  inset-inline-end: 16px;
  bottom: 132px;
  margin: 0;
  display: flex;
  align-items: center;
  max-width: 340px;
  padding: 10px 12px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-inline-start: 3px solid var(--av-accent, rgb(29, 155, 240));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface-raised, rgb(22, 24, 28)) 97%, black);
  color: var(--av-text, rgb(239, 243, 244));
  font-weight: 500;
  font-size: 13px;
  line-height: 1.35;
  font-family: TwitterChirp, Inter, ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transform: translateY(8px);
  transition: opacity 140ms ease, transform 140ms ease;
}

/* Tone is carried by the accent rule AND the wording, never by colour alone. */
.av-ftoast[data-tone="error"] {
  border-inline-start-color: rgb(220, 110, 110);
}

.av-ftoast.is-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.av-ftoast:popover-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .av-ftoast {
    transition: none;
    transform: none;
  }
}

:host([data-av-motion="reduce"]) .av-ftoast {
  transition: none;
  transform: none;
}
`;
