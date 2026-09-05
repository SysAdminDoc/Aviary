import type { FeatureModule } from "../registry.ts";
import { COUNT_METRICS, type AviarySettings, type ThemeId } from "../../platform/settings.ts";

const STYLE_ID = "av-theme-foundation";
const ACTIVE_NAV_ATTRIBUTE = "data-av-active-route";
const CONVERSATION_ROLE_ATTRIBUTE = "data-av-conversation-role";

export const themeFeature: FeatureModule = {
  id: "appearance.theme",
  title: "Theme foundation",
  category: "appearance",

  init(ctx) {
    ensureThemeStyle();
    applyTheme(ctx.settings);
    ctx.diagnostics.info("Theme foundation applied", {
      theme: ctx.settings.appearance.theme
    });
  },

  apply(ctx) {
    ensureThemeStyle();
    applyTheme(ctx.settings);
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    for (const theme of ["dim", "lightsOut", "graphite", "plum", "midnight", "noir"]) {
      document.documentElement.classList.remove(`av-theme-${theme}`);
    }
    document.documentElement.classList.remove(
      "av-dense",
      "av-hide-counts",
      ...COUNT_METRICS.map((metric) => `av-hide-count-${metric}`),
      "av-hide-borders",
      "av-high-contrast",
      "av-reduce-motion",
      "av-chirp"
    );
    delete document.documentElement.dataset.avTheme;
    delete document.documentElement.dataset.avWidth;
    delete document.documentElement.dataset.avSurface;
    syncActiveNavigation(false);
    syncConversationStructure(false);
    setColorScheme(document.documentElement, undefined);
    ctx.diagnostics.info("Theme foundation destroyed");
  }
};

export function applyTheme(settings: AviarySettings): void {
  const root = document.documentElement;
  const theme = settings.appearance.theme;

  for (const value of ["dim", "lightsOut", "graphite", "plum", "midnight", "noir"]) {
    root.classList.toggle(`av-theme-${value}`, value === theme);
  }

  // The attribute is the hook for every rule that repaints X itself -- `html[data-av-theme] body`,
  // the primary column, the sidebar. With no theme chosen it must be absent entirely, or "off"
  // would still force X's background black and claim `color-scheme: dark` over its own setting.
  if (theme === "off") {
    delete root.dataset.avTheme;
    delete root.dataset.avSurface;
  } else {
    root.dataset.avTheme = theme;
    root.dataset.avSurface = currentSurface();
  }
  syncActiveNavigation(theme === "noir");
  syncConversationStructure(theme !== "off" && root.dataset.avSurface === "conversation");
  root.dataset.avWidth = settings.appearance.timelineWidth;
  root.classList.toggle("av-chirp", settings.appearance.restoreChirp);
  root.classList.toggle("av-dense", settings.appearance.denseMode);
  root.classList.toggle("av-hide-counts", settings.appearance.hideCounts);
  // A settings object without countMetrics predates the per-metric split, and its meaning was
  // "hide all four". Absent must keep hiding what it hid, never quietly stop.
  const metrics = settings.appearance.countMetrics;
  for (const metric of COUNT_METRICS) {
    root.classList.toggle(
      `av-hide-count-${metric}`,
      settings.appearance.hideCounts && (metrics ? metrics[metric] === true : true)
    );
  }
  root.classList.toggle("av-hide-borders", settings.appearance.hideBorders);
  root.classList.toggle("av-high-contrast", settings.accessibility.highContrast);
  root.classList.toggle("av-reduce-motion", shouldReduceMotion(settings));
  setColorScheme(root, theme === "off" ? undefined : "dark");
}

/**
 * Sets the inline `color-scheme`, and clears only what Aviary itself wrote.
 *
 * X sets `color-scheme: dark` inline on `<html>` on its own. Writing `""` unconditionally --
 * which is what "reset it" looks like -- deletes X's value along with ours and flips the page to
 * `normal`, silently overriding the user's own X setting. Measured on `_decoded/home.html`:
 * clearing the property moves `<html>` from `dark` to `normal`, so the marker is what makes this
 * reversible rather than destructive.
 */
function setColorScheme(root: HTMLElement, value: string | undefined): void {
  if (value === undefined) {
    if (root.dataset.avColorScheme === "1") {
      root.style.colorScheme = "";
      delete root.dataset.avColorScheme;
    }
    return;
  }
  root.style.colorScheme = value;
  root.dataset.avColorScheme = "1";
}

function shouldReduceMotion(settings: AviarySettings): boolean {
  if (settings.accessibility.reduceMotion === "always") return true;
  if (settings.accessibility.reduceMotion === "never") return false;
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function syncActiveNavigation(enabled: boolean): void {
  const currentPath = normalizePath(globalThis.location?.pathname ?? "/");
  for (const candidate of Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="AppTabBar_"]'))) {
    const anchor = candidate instanceof HTMLAnchorElement ? candidate : candidate.closest("a");
    let active = false;
    if (enabled && anchor) {
      try {
        const target = new URL(anchor.href, globalThis.location?.href);
        const targetPath = normalizePath(target.pathname);
        active = target.origin === globalThis.location?.origin &&
          (currentPath === targetPath || (targetPath !== "/" && currentPath.startsWith(`${targetPath}/`)));
      } catch {
        active = false;
      }
    }

    if (active && candidate.getAttribute(ACTIVE_NAV_ATTRIBUTE) !== "1") {
      candidate.setAttribute(ACTIVE_NAV_ATTRIBUTE, "1");
    } else if (!active && candidate.hasAttribute(ACTIVE_NAV_ATTRIBUTE)) {
      candidate.removeAttribute(ACTIVE_NAV_ATTRIBUTE);
    }
  }
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function currentSurface(): "conversation" | "timeline" {
  return /(?:^|\/)status\/\d+(?:\/|$)/.test(globalThis.location?.pathname ?? "")
    ? "conversation"
    : "timeline";
}

/**
 * X does not expose a stable conversation-role attribute. Mark the outer timeline cells instead
 * of depending on generated classes, and ignore quoted posts by keeping one article per cell.
 * Route changes and timeline mutations already re-run the feature, so late replies receive the
 * same structure without a second observer.
 */
function syncConversationStructure(enabled: boolean): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(`[${CONVERSATION_ROLE_ATTRIBUTE}]`))) {
    node.removeAttribute(CONVERSATION_ROLE_ATTRIBUTE);
  }
  if (!enabled) return;

  const primary = document.querySelector<HTMLElement>('[data-testid="primaryColumn"]');
  if (!primary) return;

  let postIndex = 0;
  for (const cell of Array.from(primary.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]'))) {
    const article = cell.querySelector<HTMLElement>('article[data-testid="tweet"]');
    if (!article || article.closest('[data-testid="cellInnerDiv"]') !== cell) continue;
    const role = postIndex === 0 ? "focal" : "reply";
    cell.setAttribute(CONVERSATION_ROLE_ATTRIBUTE, role);
    article.setAttribute(CONVERSATION_ROLE_ATTRIBUTE, role);
    postIndex += 1;
  }
}

function ensureThemeStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = THEME_CSS;
  (document.head ?? document.documentElement).append(style);
}

// "off" is absent by construction: it emits no class, so it has no variables. The Control
// Center's own CSS carries fallbacks (`var(--av-surface, ...)`), so the panel stays styled
// while X is left completely alone -- which also means every fallback in this codebase is a real
// production value, not a safety net, and has to be kept correct.
//
// Every name a `var(--av-*)` anywhere in `src/` reads is defined here, in all six palettes. Five
// used to be referenced and defined nowhere (`--av-danger`, the four `--av-media-*`), so a theme
// could not change them and the hard-coded fallback painted in every palette.
const themeVars: Record<Exclude<ThemeId, "off">, string> = {
  dim: `
    --av-bg: rgb(0, 0, 0);
    --av-surface: rgb(15, 20, 25);
    --av-surface-raised: rgb(22, 24, 28);
    --av-border: rgb(47, 51, 54);
    --av-text: rgb(239, 243, 244);
    /* X's own secondary grey measures 3.96:1 on the panel row, below AA for the 12px
       descriptions and status line it carries. Lifted to the nearest value that clears 4.5. */
    --av-muted: rgb(132, 139, 145);
    --av-accent: rgb(29, 155, 240);
    --av-danger: rgb(255, 120, 128);
    --av-warn: rgb(247, 183, 73);
    --av-ok: rgb(72, 211, 147);
    --av-on-accent: rgb(5, 10, 15);
    --av-on-danger: rgb(28, 8, 8);
    --av-media-success: rgb(120, 200, 130);
    --av-media-error: rgb(220, 110, 110);
    --av-media-success-text: rgb(206, 240, 210);
    --av-media-error-text: rgb(248, 200, 200);
    --av-accent-secondary: rgb(29, 155, 240);
  `,
  lightsOut: `
    --av-bg: rgb(0, 0, 0);
    --av-surface: rgb(5, 6, 7);
    --av-surface-raised: rgb(14, 15, 17);
    --av-border: rgb(36, 39, 43);
    --av-text: rgb(245, 247, 248);
    --av-muted: rgb(132, 139, 145);
    --av-accent: rgb(29, 155, 240);
    --av-danger: rgb(255, 120, 128);
    --av-warn: rgb(247, 183, 73);
    --av-ok: rgb(72, 211, 147);
    --av-on-accent: rgb(5, 10, 15);
    --av-on-danger: rgb(28, 8, 8);
    --av-media-success: rgb(120, 200, 130);
    --av-media-error: rgb(220, 110, 110);
    --av-media-success-text: rgb(206, 240, 210);
    --av-media-error-text: rgb(248, 200, 200);
    --av-accent-secondary: rgb(29, 155, 240);
  `,
  graphite: `
    --av-bg: rgb(8, 9, 11);
    --av-surface: rgb(18, 20, 23);
    --av-surface-raised: rgb(27, 30, 34);
    --av-border: rgb(55, 60, 66);
    --av-text: rgb(241, 244, 246);
    --av-muted: rgb(150, 157, 164);
    --av-accent: rgb(91, 176, 255);
    --av-danger: rgb(255, 128, 136);
    --av-warn: rgb(247, 189, 90);
    --av-ok: rgb(88, 214, 155);
    --av-on-accent: rgb(6, 10, 14);
    --av-on-danger: rgb(28, 8, 8);
    --av-media-success: rgb(126, 204, 137);
    --av-media-error: rgb(222, 116, 116);
    --av-media-success-text: rgb(208, 241, 212);
    --av-media-error-text: rgb(248, 203, 203);
    --av-accent-secondary: rgb(91, 176, 255);
  `,
  plum: `
    --av-bg: rgb(9, 5, 12);
    --av-surface: rgb(21, 14, 27);
    --av-surface-raised: rgb(32, 22, 41);
    --av-border: rgb(62, 45, 73);
    --av-text: rgb(246, 241, 249);
    --av-muted: rgb(164, 148, 174);
    --av-accent: rgb(205, 142, 255);
    --av-danger: rgb(255, 133, 150);
    --av-warn: rgb(246, 191, 108);
    --av-ok: rgb(112, 216, 168);
    --av-on-accent: rgb(14, 6, 18);
    --av-on-danger: rgb(30, 8, 12);
    --av-media-success: rgb(140, 206, 160);
    --av-media-error: rgb(224, 124, 132);
    --av-media-success-text: rgb(215, 242, 224);
    --av-media-error-text: rgb(249, 208, 212);
    --av-accent-secondary: rgb(205, 142, 255);
  `,
  midnight: `
    --av-bg: rgb(2, 8, 16);
    --av-surface: rgb(9, 18, 30);
    --av-surface-raised: rgb(16, 31, 49);
    --av-border: rgb(38, 60, 82);
    --av-text: rgb(239, 246, 252);
    --av-muted: rgb(139, 160, 178);
    --av-accent: rgb(68, 171, 255);
    --av-danger: rgb(255, 126, 138);
    --av-warn: rgb(247, 187, 96);
    --av-ok: rgb(88, 216, 164);
    --av-on-accent: rgb(3, 12, 22);
    --av-on-danger: rgb(26, 8, 12);
    --av-media-success: rgb(126, 205, 150);
    --av-media-error: rgb(222, 118, 124);
    --av-media-success-text: rgb(210, 242, 220);
    --av-media-error-text: rgb(248, 205, 208);
    --av-accent-secondary: rgb(68, 171, 255);
  `,
  noir: `
    --av-bg: rgb(4, 7, 11);
    --av-surface: rgb(9, 14, 21);
    --av-surface-raised: rgb(14, 22, 32);
    --av-border: rgb(39, 53, 68);
    --av-text: rgb(245, 248, 250);
    --av-muted: rgb(155, 169, 184);
    --av-accent: rgb(92, 211, 255);
    --av-accent-secondary: rgb(151, 128, 255);
    --av-danger: rgb(255, 130, 140);
    --av-warn: rgb(248, 190, 100);
    --av-ok: rgb(92, 219, 168);
    --av-on-accent: rgb(3, 20, 24);
    --av-on-danger: rgb(26, 8, 10);
    --av-media-success: rgb(128, 208, 152);
    --av-media-error: rgb(224, 120, 126);
    --av-media-success-text: rgb(212, 243, 222);
    --av-media-error-text: rgb(249, 206, 210);
  `
};

/** Exported so tests can mount the real stylesheet rather than a copy of it. */
export const THEME_CSS = `
html.av-theme-dim { ${themeVars.dim} }
html.av-theme-lightsOut { ${themeVars.lightsOut} }
html.av-theme-graphite { ${themeVars.graphite} }
html.av-theme-plum { ${themeVars.plum} }
html.av-theme-midnight { ${themeVars.midnight} }
html.av-theme-noir { ${themeVars.noir} }

html[data-av-theme] {
  color-scheme: dark;
}

html[data-av-theme] body {
  background: var(--av-bg, rgb(0, 0, 0));
  color: var(--av-text, rgb(239, 243, 244));
}

/* Every authored palette must survive X's own light or dark selection. These semantic anchors
   repaint the shell and readable content without depending on generated atomic classes. Noir
   layers its richer gradients and depth over the same foundation below. */
html[data-av-theme] [data-testid="app-shell"],
html[data-av-theme] nav:has([data-testid="AppTabBar_Home_Link"]),
html[data-av-theme] [data-testid="sidebarColumn"] {
  background-color: var(--av-bg, rgb(0, 0, 0));
  color: var(--av-text, rgb(239, 243, 244));
}

html[data-av-theme] nav:has([data-testid="AppTabBar_Home_Link"]) a,
html[data-av-theme] article[data-testid="tweet"],
html[data-av-theme] article[data-testid="tweet"] [data-testid="User-Name"] a,
html[data-av-theme] article[data-testid="tweet"] [data-testid="tweetText"],
html[data-av-theme] [data-testid="primaryColumn"] [role="tab"],
html[data-av-theme] [data-testid^="tweetTextarea_"],
html[data-av-theme] [data-testid="SearchBox_Search_Input"] {
  color: var(--av-text, rgb(239, 243, 244));
}

html[data-av-theme] article[data-testid="tweet"] [role="group"] button:not([data-av-media-action]),
html[data-av-theme] article[data-testid="tweet"] [role="group"] a {
  color: var(--av-muted, rgb(132, 139, 145));
}

html[data-av-theme] [data-testid="primaryColumn"] {
  background: var(--av-bg, rgb(0, 0, 0));
  border-color: var(--av-border, rgb(47, 51, 54));
  color: var(--av-text, rgb(239, 243, 244));
}

html[data-av-theme] [data-testid="toolBar"],
html[data-av-theme] form[role="search"]:has([data-testid="SearchBox_Search_Input"]),
html[data-av-theme] [data-testid="GrokDrawer"],
html[data-av-theme] [data-testid="chat-drawer-root"] {
  border-color: var(--av-border, rgb(47, 51, 54));
  background-color: var(--av-surface, rgb(15, 20, 25));
  color: var(--av-text, rgb(239, 243, 244));
}

html[data-av-theme] [data-testid="sidebarColumn"] section,
html[data-av-theme] [data-testid="sidebarColumn"] div:has(> [data-testid="news_sidebar"]),
html[data-av-theme] [data-testid="sidebarColumn"] aside[role="complementary"],
html[data-av-theme] [aria-label="Timeline: Trending now"] {
  background-color: color-mix(in srgb, var(--av-surface) 92%, transparent);
  border-color: var(--av-border);
  color: var(--av-text, rgb(239, 243, 244));
}

/* Quiet Stream foundation: authored themes read as one continuous timeline. Row separators carry
   the hierarchy, while posts stay flat and media gets the available width. */
html[data-av-theme] [data-testid="cellInnerDiv"] > div {
  border-bottom-color: color-mix(in srgb, var(--av-border) 64%, transparent);
  transition: background-color 140ms ease;
}

html[data-av-theme] [data-testid="cellInnerDiv"] > div:hover {
  background-color: color-mix(in srgb, var(--av-surface-raised) 28%, transparent);
}

html[data-av-theme] article[data-testid="tweet"] {
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

html[data-av-theme] article[data-testid="tweet"] [data-testid="tweetText"] {
  max-inline-size: min(72ch, 100%);
  font-size: 16px;
  line-height: 1.5;
}

html[data-av-theme] article[data-testid="tweet"] [role="group"] {
  column-gap: clamp(12px, 2.2vw, 32px);
}

html[data-av-theme] article[data-testid="tweet"] [role="group"] > :not([data-av-media-action-slot]) {
  min-height: 36px;
}

html[data-av-width="wide"][data-av-surface="timeline"]
  article[data-testid="tweet"] [role="group"],
html[data-av-width="wide"][data-av-surface="conversation"]
  article[data-av-conversation-role="focal"] [role="group"] {
  justify-content: space-between;
  width: 100%;
}

html[data-av-theme] [data-testid="tweetPhoto"],
html[data-av-theme] [data-testid="videoPlayer"],
html[data-av-theme] [data-testid="videoComponent"] {
  inline-size: 100% !important;
  max-inline-size: none !important;
  border-radius: 10px;
}

/* The resting button only. This rule and the feature's own state rules were both (0,2,1), so which
   one painted a finished or failed download came down to which stylesheet was appended last -- and
   under every Aviary theme the answer was this one, which made success, failure, opened and
   duplicate all render as an untouched button. Excluding the states here is what leaves the
   feature that raises them in charge of what they look like. */
html[data-av-theme] [data-av-media-action]:not(.is-success):not(.is-error):not(.is-opened):not(.is-duplicate) {
  min-width: 108px;
  min-height: 40px;
  padding: 7px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--av-accent);
  color: var(--av-on-accent, rgb(3, 20, 24));
  box-shadow: none;
}

html[data-av-theme] [data-av-media-action]:hover:not(:disabled) {
  border-color: transparent;
  background: color-mix(in srgb, var(--av-accent) 86%, white);
  color: var(--av-on-accent, rgb(3, 20, 24));
}

/* A post detail route has one focal post, then a compact connected reply stream. The role markers
   are applied by syncConversationStructure so this stays independent of X's generated classes. */
html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="focal"]
  [data-testid="tweetText"] {
  max-inline-size: min(52ch, 100%);
  font-size: clamp(20px, 1.5vw, 23px);
  line-height: 1.36;
}

html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="focal"]
  [data-testid="tweetPhoto"],
html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="focal"]
  [data-testid="videoPlayer"],
html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="focal"]
  [data-testid="videoComponent"] {
  margin-block-start: 16px;
}

html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="reply"] {
  position: relative;
}

html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="reply"]::before {
  position: absolute;
  z-index: 0;
  inset-block: -1px;
  inset-inline-start: 31px;
  width: 2px;
  background: color-mix(in srgb, var(--av-accent) 24%, var(--av-border));
  content: "";
  pointer-events: none;
}

html[data-av-theme][data-av-surface="conversation"]
  [data-testid="cellInnerDiv"][data-av-conversation-role="reply"] > div {
  padding-block: 14px !important;
}

html[data-av-theme][data-av-surface="conversation"] [data-av-conversation-role="reply"]
  [data-testid="tweetText"] {
  max-inline-size: min(68ch, 100%);
  font-size: 15.5px;
  line-height: 1.52;
}

html[data-av-theme][data-av-surface="conversation"]
  [data-testid="cellInnerDiv"][data-av-conversation-role="reply"] > div > * {
  position: relative;
  z-index: 1;
}

html[data-av-theme][data-av-surface="conversation"] [data-testid^="tweetTextarea_"] {
  min-height: 40px !important;
  border-radius: 8px;
}

/* Noir is Aviary's authored premium desktop skin. The root owns the canvas so it covers every
   route and scroll depth without exposing a second base colour. */
html.av-theme-noir {
  background-color: var(--av-bg);
}

html.av-theme-noir body {
  background-color: transparent !important;
  background-image: none;
  color: var(--av-text);
}

html.av-theme-noir [data-testid="app-shell"] {
  color: var(--av-text);
}

html.av-theme-noir header[role="banner"] > div > div:has(nav[aria-label="Primary"]) {
  border-right: 1px solid color-mix(in srgb, var(--av-border) 72%, transparent);
  background: rgb(7, 12, 18);
}

html.av-theme-noir nav:has([data-testid="AppTabBar_Home_Link"]) {
  border-color: color-mix(in srgb, var(--av-border) 82%, transparent);
  background: rgb(7, 12, 18);
  box-shadow: none;
}

html.av-theme-noir [data-testid^="AppTabBar_"] {
  border-radius: 10px;
  color: color-mix(in srgb, var(--av-text) 88%, var(--av-muted));
  transition: color 150ms ease, background-color 150ms ease, transform 150ms ease;
}

html.av-theme-noir [data-testid^="AppTabBar_"]:hover {
  background-color: color-mix(in srgb, var(--av-accent) 9%, var(--av-surface));
  color: var(--av-text);
  transform: translateX(2px);
}

html.av-theme-noir [data-testid^="AppTabBar_"][aria-current="page"],
html.av-theme-noir [data-testid^="AppTabBar_"][data-av-active-route="1"] {
  background: color-mix(in srgb, var(--av-accent) 13%, var(--av-surface));
  box-shadow: inset 2px 0 0 var(--av-accent);
  color: var(--av-text);
}

html.av-theme-noir [data-testid="SideNav_NewTweet_Button"],
html.av-theme-noir [data-testid="tweetButtonInline"] {
  border-color: transparent;
  border-radius: 8px;
  background: var(--av-accent);
  color: var(--av-on-accent);
  box-shadow: none;
  font-weight: 750;
}

html.av-theme-noir [data-testid="SideNav_NewTweet_Button"]:hover,
html.av-theme-noir [data-testid="tweetButtonInline"]:hover {
  background: color-mix(in srgb, var(--av-accent) 86%, white);
  box-shadow: none;
}

html.av-theme-noir [data-testid="SideNav_AccountSwitcher_Button"] {
  border: 1px solid color-mix(in srgb, var(--av-border) 80%, transparent);
  border-radius: 9px;
  background: var(--av-surface);
}

html.av-theme-noir [data-testid="primaryColumn"] {
  border-color: color-mix(in srgb, var(--av-border) 86%, transparent);
  background: rgba(6, 10, 16, 0.94);
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.22);
}

html.av-theme-noir [data-testid="primaryColumn"] [role="tablist"] {
  border-bottom: 1px solid color-mix(in srgb, var(--av-border) 74%, transparent);
  background: rgba(7, 12, 18, 0.96);
}

html.av-theme-noir [data-testid="primaryColumn"] [role="tab"] {
  color: var(--av-muted);
}

html.av-theme-noir [data-testid="primaryColumn"] [role="tab"][aria-selected="true"] {
  color: var(--av-text);
  text-shadow: 0 0 18px rgba(92, 211, 255, 0.22);
}

html.av-theme-noir [data-testid="cellInnerDiv"] > div {
  border-bottom-color: color-mix(in srgb, var(--av-border) 64%, transparent);
}

html.av-theme-noir article[data-testid="tweet"] {
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  transition: background-color 150ms ease, box-shadow 150ms ease;
}

html.av-theme-noir article[data-testid="tweet"]:hover {
  background-color: color-mix(in srgb, var(--av-surface-raised) 36%, transparent);
  box-shadow: none;
}

html.av-theme-noir article[data-testid="tweet"] [data-testid="User-Name"],
html.av-theme-noir article[data-testid="tweet"] [data-testid="User-Name"] a,
html.av-theme-noir article[data-testid="tweet"] [data-testid="tweetText"] {
  color: var(--av-text);
}

html.av-theme-noir article[data-testid="tweet"] [role="group"] button:not([data-av-media-action]) {
  color: var(--av-muted);
  transition: color 140ms ease, background-color 140ms ease;
}

html.av-theme-noir article[data-testid="tweet"] [role="group"] button:not([data-av-media-action]):hover {
  background-color: color-mix(in srgb, var(--av-accent) 10%, transparent);
  color: var(--av-accent);
}

html.av-theme-noir [data-testid="tweetPhoto"],
html.av-theme-noir [data-testid="videoPlayer"],
html.av-theme-noir [data-testid="videoComponent"] {
  border: 1px solid color-mix(in srgb, var(--av-border) 82%, transparent);
  border-radius: 10px;
  background-color: var(--av-surface-raised);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

html.av-theme-noir [data-testid="toolBar"] {
  border-color: color-mix(in srgb, var(--av-border) 74%, transparent);
  background: var(--av-surface);
}

html.av-theme-noir [data-testid="tweetTextarea_0RichTextInputContainer"],
html.av-theme-noir [data-testid="tweetTextarea_0"] {
  border-color: color-mix(in srgb, var(--av-border) 82%, transparent);
  border-radius: 10px;
  background-color: color-mix(in srgb, var(--av-surface-raised) 76%, transparent);
  color: var(--av-text);
}

html.av-theme-noir [data-testid="sidebarColumn"] {
  color: var(--av-text);
}

html.av-theme-noir [data-testid="sidebarColumn"] div:has(> [data-testid="news_sidebar"]),
html.av-theme-noir [data-testid="sidebarColumn"] section[data-testid="news_sidebar"],
html.av-theme-noir [data-testid="sidebarColumn"] aside[role="complementary"],
html.av-theme-noir [aria-label="Timeline: Trending now"] {
  border: 1px solid color-mix(in srgb, var(--av-border) 78%, transparent);
  border-radius: 10px;
  background: rgba(11, 18, 27, 0.9);
  box-shadow: none;
}

html.av-theme-noir [aria-label="Timeline: Trending now"] > section {
  border-color: transparent;
  background: transparent;
}

html.av-theme-noir [data-testid="sidebarColumn"] [data-testid="UserCell"] {
  background-color: transparent;
  transition: background-color 140ms ease;
}

html.av-theme-noir [data-testid="sidebarColumn"] [data-testid="UserCell"]:hover {
  background-color: color-mix(in srgb, var(--av-accent) 7%, transparent);
}

html.av-theme-noir form[role="search"]:has([data-testid="SearchBox_Search_Input"]) {
  border: 1px solid color-mix(in srgb, var(--av-border) 82%, transparent);
  border-radius: 10px;
  background-color: rgba(14, 22, 32, 0.94);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
}

html.av-theme-noir [data-testid="SearchBox_Search_Input"] {
  border: 0;
  background-color: transparent;
  color: var(--av-text);
  box-shadow: none;
}

html.av-theme-noir form[role="search"]:has([data-testid="SearchBox_Search_Input"]):focus-within {
  border-color: color-mix(in srgb, var(--av-accent) 72%, transparent);
  box-shadow: 0 0 0 3px rgba(92, 211, 255, 0.12);
  outline: none;
}

html.av-theme-noir [data-testid="GrokDrawer"],
html.av-theme-noir [data-testid="grokImgGen"] {
  border-color: color-mix(in srgb, var(--av-accent-secondary) 48%, var(--av-border));
  background: var(--av-surface);
  box-shadow: none;
}

/* The primary column takes its width from its own box, not from a max-width. Current X also keeps
   several flex wrappers around it at the old two-column width after the discovery rail is hidden.
   Comfortable stays capped. Wide expands that wrapper chain, then lets the primary column shrink
   from one viewport to exactly the space left beside navigation. */
html[data-av-width="comfortable"] [data-testid="primaryColumn"] {
  flex: 0 1 min(1000px, calc(100vw - 16px)) !important;
  flex-basis: min(1000px, calc(100vw - 16px)) !important;
  width: min(1000px, calc(100vw - 16px)) !important;
  max-width: min(1000px, calc(100vw - 16px)) !important;
  min-width: 0 !important;
}

html[data-av-width="wide"] [data-testid="primaryColumn"] {
  flex: 1 1 100vw !important;
  flex-basis: 100vw !important;
  width: 100vw !important;
  max-width: 100vw !important;
  min-width: 0 !important;
}

/* Wide is the media-first desktop canvas. It removes the discovery rail, releases every retained
   two-column wrapper, and uses the whole reading area. Comfortable retains the rail for people who
   still want trends and follow suggestions beside the feed. */
html[data-av-width="wide"] [data-testid="sidebarColumn"] {
  display: none !important;
}

html[data-av-width="wide"] [data-testid="timeline-shell"],
html[data-av-width="wide"] main[role="main"] div:has([data-testid="primaryColumn"]) {
  flex: 1 1 0% !important;
  width: 100% !important;
  max-width: none !important;
  min-width: 0 !important;
}

html[data-av-width="wide"] [data-testid="timeline-shell"],
html[data-av-width="wide"] main[role="main"] div:has(> [data-testid="primaryColumn"]) {
  justify-content: center !important;
}

/* TwitterChirp is the family X registers the font under -- confirmed in the captured
   stylesheets, which preload Chirp-Regular/Bold/Medium woff2 and declare the stack twice. The
   rule reaches into descendants because X sets font-family per element through generated atomic
   classes, so inheriting from body alone would not reach them. Aviary's own panel is inside a
   shadow root, which document CSS cannot cross, so it keeps its own type. */
html.av-chirp body,
html.av-chirp body * {
  font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
    Arial, sans-serif !important;
}

html.av-dense article[data-testid="tweet"] {
  padding-top: 8px;
  padding-bottom: 8px;
}

/* Engagement counts inside the action bar only. The buttons themselves stay operable and
   keep their aria-labels, which carry the number for screen readers.

   Split per metric so each can be hidden on its own. The view total is the odd one out: it lives
   in an analytics link rather than an action button, so it is matched by href. Bookmarks are
   absent because no capture shows a bookmark count element to scope a rule to. */
html.av-hide-count-replies article[data-testid="tweet"] [data-testid="reply"] [data-testid="app-text-transition-container"],
html.av-hide-count-reposts article[data-testid="tweet"] [data-testid="retweet"] [data-testid="app-text-transition-container"],
html.av-hide-count-reposts article[data-testid="tweet"] [data-testid="unretweet"] [data-testid="app-text-transition-container"],
html.av-hide-count-likes article[data-testid="tweet"] [data-testid="like"] [data-testid="app-text-transition-container"],
html.av-hide-count-likes article[data-testid="tweet"] [data-testid="unlike"] [data-testid="app-text-transition-container"],
html.av-hide-count-views article[data-testid="tweet"] a[href$="/analytics"] [data-testid="app-text-transition-container"] {
  display: none !important;
}

/* Row dividers live on the first child of the virtualizer cell, styled by a generated atomic
   class (r-qklmqi in the captured CSS). Anchor on the structure, not the generated name. The
   column's own left/right rules are the other half of the "borderless" look. Verified against
   _decoded/home.html with its captured stylesheets: 10/10 cells carry a 1px bottom border. */
html.av-hide-borders [data-testid="cellInnerDiv"] > div {
  border-bottom-width: 0 !important;
}

html.av-hide-borders [data-testid="primaryColumn"] {
  border-left-width: 0 !important;
  border-right-width: 0 !important;
}

html.av-high-contrast {
  --av-border: color-mix(in srgb, var(--av-text, rgb(239, 243, 244)) 42%, transparent);
  --av-muted: color-mix(in srgb, var(--av-text, rgb(239, 243, 244)) 76%, transparent);
}

html.av-reduce-motion *,
html.av-reduce-motion *::before,
html.av-reduce-motion *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  transition-duration: 0.001ms !important;
}
`;
