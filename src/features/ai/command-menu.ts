import type { FeatureContext, FeatureModule } from "../registry.ts";
import { runAiPrompt } from "../integrations/ai-provider.ts";
import { buildAiDisclosure } from "../integrations/usage.ts";
import { isLocalOnly } from "../integrations/network-policy.ts";
import { removeFeatureToast, showFeatureToast } from "../core/feature-toast.ts";
import { ft } from "../core/feature-i18n.ts";

const STYLE_ID = "av-ai-command-menu";
const TRIGGER_ATTR = "data-av-ai-trigger";
const PROCESSED_ATTR = "data-av-ai-processed";

export type AiCommandId = "translate" | "summarize" | "explain" | "factcheck";

export interface AiCommand {
  id: AiCommandId;
  label: string;
  hint: string;
  promptTemplate: (text: string) => string;
}

export const AI_COMMANDS: AiCommand[] = [
  {
    id: "translate",
    label: "Translate",
    hint: "Translate the selected post to your active locale.",
    promptTemplate: (text) => `Translate the following X post. Keep the tone, hashtags, and @mentions intact.\n\n${text}`
  },
  {
    id: "summarize",
    label: "Summarize",
    hint: "Summarize a thread or long post in 3 bullet points.",
    promptTemplate: (text) =>
      `Summarize the following X post (or thread) in 3 short bullet points. Avoid speculation.\n\n${text}`
  },
  {
    id: "explain",
    label: "Explain",
    hint: "Explain context, jargon, and references in the post.",
    promptTemplate: (text) =>
      `Explain the context behind this X post: define jargon, expand acronyms, and note references that might be unfamiliar.\n\n${text}`
  },
  {
    id: "factcheck",
    label: "Fact-check prompt",
    hint: "Generate a fact-check prompt for the post (no network call without your key).",
    promptTemplate: (text) =>
      `Treat this X post as a claim. List the verifiable assertions, the kind of source that would confirm each one, and any obvious counterpoints. Do not invent sources.\n\n${text}`
  }
];

export const aiCommandMenuFeature: FeatureModule = {
  id: "ai.commandMenu",
  title: "AI command menu (local prompt builder)",
  category: "core",

  init(ctx) {
    if (!ctx.settings.ai.commandMenu) {
      return;
    }
    ensureStyle();
    decorate(ctx, document);
    ctx.diagnostics.info("AI command menu ready");
  },

  apply(ctx, root, addedNodes) {
    if (!ctx.settings.ai.commandMenu) {
      clearDecorations();
      return;
    }
    ensureStyle();
    if (!addedNodes || addedNodes.length === 0) {
      decorate(ctx, root);
      return;
    }
    for (const node of addedNodes) {
      decorate(ctx, node);
    }
  },

  destroy(ctx) {
    // The menu lives on <body>, outside anything the selectors below sweep: without this it
    // survived teardown as an unstyled list with a live capture-phase click listener.
    clearDecorations();
    ctx.diagnostics.info("AI command menu destroyed");
  },

  getStatus() {
    return { ok: true, message: `${AI_COMMANDS.length} local AI prompts` };
  }
};

function clearDecorations(): void {
  closeOpenMenu();
  closeAiReview?.(false);
  closeAiReview = undefined;
  removeFeatureToast();
  document.getElementById(STYLE_ID)?.remove();
  for (const article of Array.from(document.querySelectorAll(`[${PROCESSED_ATTR}]`))) {
    article.removeAttribute(PROCESSED_ATTR);
  }
  for (const trigger of Array.from(document.querySelectorAll(`[${TRIGGER_ATTR}]`))) {
    trigger.remove();
  }
}

function decorate(ctx: FeatureContext, root: ParentNode | Element): void {
  // Off by default: a button on every post is a visible change to X, and nothing Aviary adds to
  // the timeline appears until it is asked for.
  if (!ctx.settings.ai.commandMenu) {
    return;
  }
  const articles =
    root instanceof Element && root.matches('article[data-testid="tweet"]')
      ? [root]
      : Array.from(root.querySelectorAll<Element>('article[data-testid="tweet"]'));

  for (const article of articles) {
    if (article.getAttribute(PROCESSED_ATTR) === "1") {
      continue;
    }
    const toolbar = article.querySelector<HTMLElement>('[role="group"][aria-label]');
    if (!toolbar) {
      article.setAttribute(PROCESSED_ATTR, "1");
      continue;
    }
    if (toolbar.querySelector(`[${TRIGGER_ATTR}]`)) {
      article.setAttribute(PROCESSED_ATTR, "1");
      continue;
    }
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "av-ai-trigger";
    trigger.setAttribute(TRIGGER_ATTR, "1");
    const triggerId = `av-ai-trigger-${++menuSequence}`;
    const menuId = `av-ai-menu-${menuSequence}`;
    trigger.id = triggerId;
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", menuId);
    trigger.setAttribute("aria-label", ft(ctx, "Open Aviary AI command menu"));
    trigger.textContent = "AI";
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      openMenu(article, trigger, ctx);
    });
    toolbar.append(trigger);
    article.setAttribute(PROCESSED_ATTR, "1");
  }
}

/** The menu is appended to <body>, so destroy() has to be able to reach it. */
let openMenuNode: HTMLElement | undefined;
let openMenuKeydown: ((event: KeyboardEvent) => void) | undefined;
let openMenuTrigger: HTMLElement | undefined;
let closeAiReview: ((approved: boolean) => void) | undefined;
let menuSequence = 0;

function closeOpenMenu(restoreFocus = true): void {
  const menu = openMenuNode;
  if (openMenuKeydown && menu) {
    menu.removeEventListener("keydown", openMenuKeydown);
    openMenuKeydown = undefined;
  }
  const trigger = openMenuTrigger;
  trigger?.setAttribute("aria-expanded", "false");
  openMenuTrigger = undefined;
  if (menu) {
    try {
      (menu as HTMLElement & { hidePopover?: () => void }).hidePopover?.();
    } catch {
      // Keep teardown best-effort for embedded hosts without a complete Popover implementation.
    }
    menu.remove();
  }
  openMenuNode = undefined;
  for (const stray of Array.from(document.querySelectorAll(".av-ai-menu"))) {
    stray.remove();
  }
  if (restoreFocus && trigger?.isConnected) {
    trigger.focus({ preventScroll: true });
  }
}

function openMenu(article: Element, trigger: HTMLElement, ctx: FeatureContext): void {
  closeOpenMenu();
  const menu = document.createElement("div");
  menu.className = "av-ai-menu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "menu");
  menu.id = trigger.getAttribute("aria-controls") ?? `av-ai-menu-${++menuSequence}`;
  menu.setAttribute("aria-labelledby", trigger.id);
  trigger.setAttribute("aria-expanded", "true");
  openMenuTrigger = trigger;
  const text = (article.querySelector('[data-testid="tweetText"]')?.textContent ?? article.textContent ?? "").trim();
  const aiEnabled = ctx.settings.integrations.ai.enabled && ctx.settings.integrations.ai.apiKey.length > 0;
  for (const command of AI_COMMANDS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "av-ai-option";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.setAttribute("aria-description", ft(ctx, command.hint));
    item.textContent = aiEnabled
      ? `${ft(ctx, command.label)} · ${ft(ctx, "Run with provider")}`
      : ft(ctx, command.label);
    item.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const prompt = command.promptTemplate(text);
      if (aiEnabled) {
        if (ctx.integrationUsage) {
          const disclosure = buildAiDisclosure(
            ctx.settings.integrations.ai,
            { prompt },
            ctx.integrationUsage.snapshot(),
            !isLocalOnly()
          );
          const approved = await showAiRequestReview(ctx, disclosure);
          if (!approved) {
            closeOpenMenu();
            return;
          }
        }
        item.disabled = true;
        item.textContent = `${ft(ctx, command.label)} · ${ft(ctx, "running…")}`;
        try {
          const result = await runAiPrompt(
            ctx.settings.integrations.ai,
            { prompt },
            ctx.integrationUsage ? { usage: ctx.integrationUsage } : {}
          );
          if (result.ok && result.text) {
            try {
              await copyToClipboard(result.text);
              ctx.diagnostics.info("AI result copied", {
                command: command.id,
                length: result.text.length
              });
              void ctx.auditLog.record("diagnostics.copy", {
                kind: "ai-response",
                command: command.id,
                provider: ctx.settings.integrations.ai.provider
              });
              showFeatureToast(`${ft(ctx, command.label)}: ${ft(ctx, "result copied to the clipboard.")}`, { ctx });
            } catch {
              ctx.diagnostics.warn("AI result clipboard failed");
              showFeatureToast(ft(ctx, "The result could not be copied. Your browser blocked clipboard access."), {
                tone: "error",
                ctx
              });
            }
          } else {
            ctx.diagnostics.warn("AI provider call failed");
            showFeatureToast(
              `${ft(ctx, command.label)}: ${result.error ?? ft(ctx, "the provider did not respond")}. ${ft(ctx, "Check the key and model in Integrations.")}`,
              { tone: "error", ctx }
            );
          }
        } catch (error) {
          const message = String((error as Error)?.message ?? error);
          ctx.diagnostics.warn("AI provider call failed");
          showFeatureToast(`${ft(ctx, command.label)}: ${message}`, { tone: "error", ctx });
        } finally {
          item.disabled = false;
          item.textContent = `${ft(ctx, command.label)} · ${ft(ctx, "Run with provider")}`;
          closeOpenMenu();
        }
      } else {
        try {
          await copyToClipboard(prompt);
          ctx.diagnostics.info("AI prompt copied", { command: command.id, length: prompt.length });
          void ctx.auditLog.record("diagnostics.copy", { kind: "ai", command: command.id });
          showFeatureToast(ft(ctx, "Prompt copied to the clipboard. Paste it into your assistant."), { ctx });
        } catch {
          ctx.diagnostics.warn("AI prompt clipboard failed");
          showFeatureToast(ft(ctx, "The prompt could not be copied. Your browser blocked clipboard access."), {
            tone: "error",
            ctx
          });
        }
      }
      closeOpenMenu();
    });
    menu.append(item);
  }
  document.body.append(menu);
  openMenuNode = menu;
  const menuItems = (): HTMLButtonElement[] =>
    Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  const focusMenuItem = (index: number): void => {
    const items = menuItems();
    if (items.length === 0) return;
    const next = (index + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  };
  const keydown = (event: KeyboardEvent): void => {
    const items = menuItems();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeOpenMenu();
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
  openMenuKeydown = keydown;
  menu.addEventListener("keydown", keydown);
  menu.addEventListener("toggle", (event) => {
    const closed = (event as Event & { newState?: string }).newState === "closed";
    if (closed && openMenuNode === menu) {
      // Escape and light-dismiss are handled by the UA. Mirror the state back to the trigger and
      // remove the detached menu so a later post mutation cannot leave stale commands behind.
      closeOpenMenu();
    }
  });
  try {
    (menu as HTMLElement & { showPopover?: () => void }).showPopover?.();
  } catch {
    // Both manifest floors ship the Popover API, and an engine without it drops the
    // `:not(:popover-open)` rule at parse time, so the authored display applies. A host with the
    // selector but no methods would otherwise get an invisible menu; the class restores it.
    menu.classList.add("av-popover-unavailable");
  }
  // Measured after showing, not merely after insertion: a closed popover is display:none, so a
  // height read before showPopover is zero and the flip-above decision never fires.
  positionMenu(menu, trigger);
  focusMenuItem(0);
}

function showAiRequestReview(
  ctx: FeatureContext,
  disclosure: ReturnType<typeof buildAiDisclosure>
): Promise<boolean> {
  const dialog = document.createElement("section");
  dialog.className = "av-ai-review";
  dialog.setAttribute("popover", "auto");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", ft(ctx, "Review external AI request"));

  const title = document.createElement("h2");
  title.textContent = ft(ctx, "Review external AI request");
  const intro = document.createElement("p");
  intro.textContent = ft(ctx, "Nothing is sent until you choose Send request.");
  const details = document.createElement("dl");
  const addDetail = (label: string, value: string): void => {
    const name = document.createElement("dt");
    name.textContent = ft(ctx, label);
    const content = document.createElement("dd");
    content.textContent = value;
    details.append(name, content);
  };
  addDetail("Provider", disclosure.provider);
  addDetail("Endpoint", disclosure.endpoint);
  addDetail("Fields sent", disclosure.fields.join(", "));
  addDetail("Characters", String(disclosure.characterCount));
  addDetail("Estimated tokens", String(disclosure.estimatedTokens));
  addDetail("Request bytes", String(disclosure.requestBytes));
  addDetail(
    "Daily usage",
    `${disclosure.dailyUsedBytes} / ${disclosure.dailyLimitBytes > 0 ? disclosure.dailyLimitBytes : ft(ctx, "unlimited")} bytes`
  );
  addDetail(
    "Retained data",
    ft(ctx, "Aviary stores usage counters only; the provider's retention follows its policy.")
  );
  addDetail(
    "Network status",
    disclosure.networkAllowed ? ft(ctx, "Allowed") : ft(ctx, "Blocked by local-only mode")
  );
  if (!disclosure.budgetAllowed) {
    addDetail("Budget status", disclosure.budgetReason ?? ft(ctx, "Budget blocked this request."));
  }

  const actions = document.createElement("div");
  actions.className = "av-ai-review-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "av-ai-review-button av-ai-review-cancel";
  cancel.textContent = ft(ctx, "Cancel");
  const send = document.createElement("button");
  send.type = "button";
  send.className = "av-ai-review-button av-ai-review-send";
  send.textContent = ft(ctx, "Send request");
  send.disabled = !disclosure.networkAllowed || !disclosure.budgetAllowed;
  actions.append(cancel, send);
  dialog.append(title, intro, details, actions);
  document.body.append(dialog);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved: boolean): void => {
      if (settled) return;
      settled = true;
      closeAiReview = undefined;
      dialog.removeEventListener("toggle", onToggle);
      try {
        (dialog as HTMLElement & { hidePopover?: () => void }).hidePopover?.();
      } catch {
        // Keep teardown best-effort for embedded hosts without a complete Popover implementation.
      }
      dialog.remove();
      resolve(approved);
    };
    const onToggle = (event: Event): void => {
      if ((event as Event & { newState?: string }).newState === "closed") {
        finish(false);
      }
    };
    cancel.addEventListener("click", () => finish(false));
    send.addEventListener("click", () => finish(true));
    dialog.addEventListener("toggle", onToggle);
    closeAiReview = finish;
    try {
      (dialog as HTMLElement & { showPopover?: () => void }).showPopover?.();
    } catch {
      // Nothing hides this one when it is closed -- there is no `:not(:popover-open)` rule for the
      // review dialog -- so a host without the methods shows it and it stays usable. The catch is
      // only here so a throw cannot leave the caller half-built.
    }
    (send.disabled ? cancel : send).focus({ preventScroll: true });
  });
}

function positionMenu(menu: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.left = `${Math.max(12, rect.left)}px`;
  menu.style.maxWidth = "260px";

  // Flip above the trigger when the menu would run past the fold. Clamping the top alone left
  // the lower half of the list unreachable on a post near the bottom of the viewport.
  const viewportHeight = globalThis.innerHeight || 0;
  const height = menu.getBoundingClientRect().height;
  const below = rect.bottom + 6;
  menu.style.top = viewportHeight > 0 && below + height > viewportHeight - 12
    ? `${Math.max(12, rect.top - height - 6)}px`
    : `${Math.max(12, below)}px`;
}

async function copyToClipboard(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard API unavailable");
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = AI_CSS;
  (document.head ?? document.documentElement).append(style);
}

const AI_CSS = `
.av-ai-trigger {
  margin-inline-start: auto;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, var(--av-muted, rgb(132, 139, 145)) 60%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--av-muted, rgb(132, 139, 145));
  font-weight: 700;
  font-size: 12px;
  line-height: 1.2;
  font-family: inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
}

article[data-testid="tweet"]:hover .av-ai-trigger,
article[data-testid="tweet"]:focus-within .av-ai-trigger,
.av-ai-trigger:focus-visible {
  opacity: 1;
  color: var(--av-text, rgb(239, 243, 244));
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
}

.av-ai-menu {
  margin: 0;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
}

/* Author display: grid outranks the UA's [popover]:not(:popover-open) { display: none }, so a
   menu that never reached showPopover would paint anyway. */
.av-ai-menu:not(:popover-open) {
  display: none;
}

/* See the panel's copy of this: the class is repeated so the rule outweighs the one above rather
   than tying with it and being settled by source order. */
.av-ai-menu.av-popover-unavailable.av-popover-unavailable {
  display: grid;
}

.av-ai-option {
  padding: 6px 10px;
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

.av-ai-option:hover,
.av-ai-option:focus-visible {
  border-color: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 60%, transparent);
  background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 12%, transparent);
}

.av-ai-review {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(460px, 100%);
  max-height: min(720px, calc(100vh - 32px));
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: var(--av-surface, rgb(15, 20, 25));
  color: var(--av-text, rgb(239, 243, 244));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}

.av-ai-review::backdrop {
  background: rgba(0, 0, 0, 0.58);
}

.av-ai-review h2 {
  margin: 0;
  font-size: 17px;
}

.av-ai-review p {
  margin: 8px 0 14px;
  color: var(--av-muted, rgb(132, 139, 145));
  font-size: 13px;
}

.av-ai-review dl {
  display: grid;
  grid-template-columns: minmax(110px, 0.8fr) minmax(0, 1.5fr);
  gap: 7px 12px;
  margin: 0;
  font-size: 12px;
}

.av-ai-review dt {
  color: var(--av-muted, rgb(132, 139, 145));
}

.av-ai-review dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.av-ai-review-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

.av-ai-review-button {
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 8px;
  background: transparent;
  color: var(--av-text, rgb(239, 243, 244));
  font-family: inherit;
  font-size: 13px;
  line-height: 1.3;
  cursor: pointer;
}

.av-ai-review-send {
  border-color: var(--av-accent, rgb(29, 155, 240));
  background: var(--av-accent, rgb(29, 155, 240));
  color: white;
}

.av-ai-review-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
`;
