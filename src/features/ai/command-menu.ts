import type { FeatureContext, FeatureModule } from "../registry";
import { runAiPrompt } from "../integrations/ai-provider";
import { removeFeatureToast, showFeatureToast } from "../core/feature-toast";
import { ft } from "../core/feature-i18n";

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
  defaultEnabled: true,

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
    trigger.setAttribute("aria-label", ft(ctx, "Open Aviary AI command menu"));
    trigger.title = ft(ctx, "Aviary AI commands (offline prompt builder)");
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
let openMenuDismiss: ((event: Event) => void) | undefined;

function closeOpenMenu(): void {
  if (openMenuDismiss) {
    document.removeEventListener("click", openMenuDismiss, true);
    openMenuDismiss = undefined;
  }
  openMenuNode?.remove();
  openMenuNode = undefined;
  for (const stray of Array.from(document.querySelectorAll(".av-ai-menu"))) {
    stray.remove();
  }
}

function openMenu(article: Element, trigger: HTMLElement, ctx: FeatureContext): void {
  closeOpenMenu();
  const menu = document.createElement("div");
  menu.className = "av-ai-menu";
  menu.setAttribute("role", "menu");
  const text = (article.querySelector('[data-testid="tweetText"]')?.textContent ?? article.textContent ?? "").trim();
  const aiEnabled = ctx.settings.integrations.ai.enabled && ctx.settings.integrations.ai.apiKey.length > 0;
  for (const command of AI_COMMANDS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "av-ai-option";
    item.setAttribute("role", "menuitem");
    item.title = ft(ctx, command.hint);
    item.textContent = aiEnabled
      ? `${ft(ctx, command.label)} — ${ft(ctx, "Run with provider")}`
      : ft(ctx, command.label);
    item.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      const prompt = command.promptTemplate(text);
      if (aiEnabled) {
        item.disabled = true;
        item.textContent = `${ft(ctx, command.label)} — ${ft(ctx, "running…")}`;
        const result = await runAiPrompt(ctx.settings.integrations.ai, { prompt });
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
          } catch (error) {
            ctx.diagnostics.warn("AI result clipboard failed", {
              error: String((error as Error)?.message ?? error)
            });
            showFeatureToast(ft(ctx, "The result could not be copied. Your browser blocked clipboard access."), {
              tone: "error",
              ctx
            });
          }
        } else {
          ctx.diagnostics.warn("AI provider call failed", { error: result.error ?? "unknown" });
          showFeatureToast(
            `${ft(ctx, command.label)}: ${result.error ?? ft(ctx, "the provider did not respond")}. ${ft(ctx, "Check the key and model in Integrations.")}`,
            { tone: "error", ctx }
          );
        }
      } else {
        try {
          await copyToClipboard(prompt);
          ctx.diagnostics.info("AI prompt copied", { command: command.id, length: prompt.length });
          void ctx.auditLog.record("diagnostics.copy", { kind: "ai", command: command.id });
          showFeatureToast(ft(ctx, "Prompt copied to the clipboard — paste it into your assistant."), { ctx });
        } catch (error) {
          ctx.diagnostics.warn("AI prompt clipboard failed", {
            error: String((error as Error)?.message ?? error)
          });
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
  // Measured after insertion: the flip decision needs the menu's real height.
  positionMenu(menu, trigger);
  openMenuNode = menu;
  const dismiss = (event: Event): void => {
    if (!menu.contains(event.target as Node) && event.target !== trigger) {
      closeOpenMenu();
    }
  };
  openMenuDismiss = dismiss;
  setTimeout(() => document.addEventListener("click", dismiss, true), 0);
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
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--av-muted, rgb(113, 118, 123)) 60%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--av-muted, rgb(113, 118, 123));
  font-weight: 700;
  font-size: 10px;
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
  z-index: 2147482800;
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--av-border, rgb(47, 51, 54));
  border-radius: 10px;
  background: color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 96%, black);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.4);
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
`;
