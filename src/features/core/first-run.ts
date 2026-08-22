import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "./feature-i18n.ts";

export const FIRST_RUN_KEY = "aviary.firstRun.v1";
const HOST_ID = "av-first-run";

interface FirstRunState {
  version: 1;
  acknowledged: boolean;
}

let shown = false;

/**
 * A one-time explanation of what a fresh install already changed.
 *
 * Aviary's product promise is that it changes nothing about X except what you turn on — but two
 * things are on out of the box: ad protection and the on-post media controls. A new user therefore
 * sees a page that is already different, with nothing saying so and nothing pointing at the
 * settings entry. That silence is the opposite of the trust this project trades on.
 *
 * Shown only when the profile had no stored settings at boot, so upgrading users, who already know
 * what Aviary does, never meet it.
 */
export const firstRunFeature: FeatureModule = {
  id: "core.firstRun",
  title: "First run notice",
  category: "core",

  async init(ctx) {
    if (!ctx.freshInstall || shown || typeof document === "undefined") {
      return;
    }
    let state: FirstRunState | undefined;
    try {
      state = await ctx.storage.get<FirstRunState | undefined>(FIRST_RUN_KEY, undefined);
    } catch {
      // A storage failure must not mean the notice repeats on every load; treat it as shown.
      shown = true;
      return;
    }
    if (state?.acknowledged) {
      shown = true;
      return;
    }
    shown = true;
    mountNotice(ctx);
  },

  destroy() {
    document.getElementById(HOST_ID)?.remove();
  }
};

function mountNotice(ctx: FeatureContext): void {
  if (document.getElementById(HOST_ID)) {
    return;
  }
  const parent = document.body ?? document.documentElement;
  if (!parent) {
    return;
  }

  const reduceMotion = prefersReducedMotion(ctx);
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483000";
  host.style.insetInlineStart = "16px";
  host.style.insetBlockEnd = "16px";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .card {
      max-width: 320px;
      padding: 13px 14px;
      border: 1px solid #2f3336;
      border-radius: 9px;
      background: #16181c;
      color: #e7e9ea;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.38);
      ${reduceMotion ? "" : "animation: rise 160ms ease-out;"}
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }
    .title { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
    ul { margin: 7px 0 0; padding-inline-start: 18px; }
    li { margin-bottom: 3px; }
    .actions { display: flex; justify-content: flex-end; margin-top: 10px; }
    button {
      min-height: 32px;
      padding: 0 14px;
      border: 0;
      border-radius: 7px;
      background: #1d9bf0;
      color: #fff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #e7e9ea; outline-offset: 2px; }
  `;

  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");

  const title = document.createElement("div");
  title.className = "title";
  title.textContent = ft(ctx, "Aviary is on");

  const intro = document.createElement("div");
  intro.textContent = ft(ctx, "Two things are enabled from the start. Everything else stays off until you turn it on.");

  const list = document.createElement("ul");
  for (const line of [
    ft(ctx, "Sponsored posts, promoted trends and pre-rolls are hidden."),
    ft(ctx, "Photos and videos get a save control that only acts when you click it.")
  ]) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }

  const where = document.createElement("div");
  where.style.marginTop = "8px";
  where.textContent = ft(ctx, "Open Aviary from the last row of X's left navigation to change any of it.");

  const actions = document.createElement("div");
  actions.className = "actions";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = ft(ctx, "Got it");
  dismiss.addEventListener("click", () => {
    host.remove();
    void acknowledge(ctx);
  });
  actions.append(dismiss);

  card.append(title, intro, list, where, actions);
  shadow.append(style, card);
  parent.append(host);
}

async function acknowledge(ctx: FeatureContext): Promise<void> {
  try {
    await ctx.storage.set(FIRST_RUN_KEY, { version: 1, acknowledged: true } satisfies FirstRunState);
  } catch (error) {
    ctx.diagnostics.warn("First-run acknowledgement could not be saved", {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function prefersReducedMotion(ctx: FeatureContext): boolean {
  if (ctx.settings.accessibility.reduceMotion === "always") return true;
  if (ctx.settings.accessibility.reduceMotion === "never") return false;
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Test seam: the module-level guard must not leak between cases. */
export function resetFirstRunGuard(): void {
  shown = false;
}
