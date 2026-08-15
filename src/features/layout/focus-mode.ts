import type { FeatureContext, FeatureModule } from "../registry";
import { ft } from "../core/feature-i18n";

const HOST_ID = "av-focus-mode";
const STYLE_ID = "av-focus-mode-style";
const OVERRIDE_MINUTES = 5;

/** Minutes past midnight, local time. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Whether `now` falls inside the allowed window.
 *
 * A window that ends before it starts wraps midnight (22:00–02:00), which is the shape most
 * evening limits take; treating it as an empty range would silently allow nothing.
 */
export function withinWindow(now: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) {
    return true;
  }
  return startMinute < endMinute
    ? now >= startMinute && now < endMinute
    : now >= startMinute || now < endMinute;
}

export function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

let overrideUntil = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * A local, time-boxed gate over the timeline.
 *
 * Nothing is blocked at the network layer and nothing leaves the machine: outside the allowed
 * window the reading column is covered by a calm local panel. The override is deliberately
 * generous and one click away — a gate you cannot open is one people uninstall rather than obey.
 */
export const focusModeFeature: FeatureModule = {
  id: "layout.focusMode",
  title: "Focus mode",
  category: "layout",

  init(ctx) {
    applyFocusMode(ctx);
  },

  apply(ctx) {
    applyFocusMode(ctx);
  },

  destroy(ctx) {
    teardown();
    ctx.diagnostics.info("Focus mode removed");
  },

  getStatus() {
    return {
      ok: true,
      message: document.getElementById(HOST_ID) ? "Focus mode covering the timeline" : "Focus mode clear"
    };
  }
};

function applyFocusMode(ctx: FeatureContext): void {
  const settings = ctx.settings.layout;
  if (!settings.focusMode) {
    teardown();
    return;
  }

  const start = parseTime(settings.focusStart);
  const end = parseTime(settings.focusEnd);
  if (start === null || end === null) {
    // An unreadable window must not lock someone out of X.
    teardown();
    ctx.diagnostics.warn("Focus mode window could not be read", {
      start: settings.focusStart,
      end: settings.focusEnd
    });
    return;
  }

  const now = Date.now();
  if (now < overrideUntil) {
    hidePanel();
    scheduleRecheck(ctx);
    return;
  }

  if (withinWindow(minutesOfDay(new Date(now)), start, end)) {
    hidePanel();
  } else {
    showPanel(ctx);
  }
  scheduleRecheck(ctx);
}

/** The window closes on a clock, not on a page event, so re-check on a timer as well. */
function scheduleRecheck(ctx: FeatureContext): void {
  if (timer !== undefined) {
    return;
  }
  timer = setInterval(() => applyFocusMode(ctx), 30_000);
}

function showPanel(ctx: FeatureContext): void {
  ensureStyle();
  if (document.getElementById(HOST_ID)) {
    return;
  }
  const parent = document.body ?? document.documentElement;
  if (!parent) {
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = PANEL_CSS;

  const card = document.createElement("div");
  card.className = "card";
  card.setAttribute("role", "status");

  const title = document.createElement("h2");
  title.textContent = ft(ctx, "Outside your reading hours");

  const copy = document.createElement("p");
  copy.textContent = ft(
    ctx,
    "Aviary is covering the timeline until your next window. Nothing is blocked and nothing left this device."
  );

  const window_ = document.createElement("p");
  window_.className = "window";
  window_.textContent = `${ctx.settings.layout.focusStart} – ${ctx.settings.layout.focusEnd}`;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = ft(ctx, "Let me through for five minutes");
  button.addEventListener("click", () => {
    overrideUntil = Date.now() + OVERRIDE_MINUTES * 60_000;
    hidePanel();
  });

  card.append(title, copy, window_, button);
  shadow.append(style, card);
  parent.append(host);
  document.documentElement.classList.add("av-focus-active");
}

function hidePanel(): void {
  document.getElementById(HOST_ID)?.remove();
  document.documentElement.classList.remove("av-focus-active");
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Only the reading column is covered. Navigation stays usable so the rest of X — messages,
  // settings, a specific profile — is still reachable; this is a reading gate, not a site block.
  style.textContent = `
html.av-focus-active [data-testid="primaryColumn"] > * {
  filter: blur(9px);
  pointer-events: none;
  user-select: none;
}
`;
  (document.head ?? document.documentElement).append(style);
}

const PANEL_CSS = `
:host { all: initial; }
.card {
  position: fixed;
  inset-block-start: 96px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: 2147482000;
  max-width: 380px;
  padding: 20px 22px;
  border: 1px solid #2f3336;
  border-radius: 16px;
  background: #16181c;
  color: #e7e9ea;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  text-align: center;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
h2 { margin: 0 0 8px; font-size: 17px; }
p { margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: #c9cdd1; }
.window { font-variant-numeric: tabular-nums; font-weight: 700; color: #e7e9ea; }
button {
  margin-top: 8px;
  min-height: 34px;
  padding: 0 16px;
  border: 1px solid #536471;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
`;

function teardown(): void {
  hidePanel();
  document.getElementById(STYLE_ID)?.remove();
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** Test seam: module-level override and timer must not leak between cases. */
export function resetFocusModeState(): void {
  teardown();
  overrideUntil = 0;
}
