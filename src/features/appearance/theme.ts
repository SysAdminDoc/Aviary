import type { FeatureModule } from "../registry";
import type { AviarySettings, ThemeId } from "../../platform/settings";

const STYLE_ID = "av-theme-foundation";

export const themeFeature: FeatureModule = {
  id: "appearance.theme",
  title: "Theme foundation",
  category: "appearance",
  defaultEnabled: true,

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
    for (const theme of ["dim", "lightsOut", "graphite", "plum", "midnight"]) {
      document.documentElement.classList.remove(`av-theme-${theme}`);
    }
    document.documentElement.classList.remove(
      "av-dense",
      "av-hide-counts",
      "av-high-contrast",
      "av-reduce-motion"
    );
    delete document.documentElement.dataset.avTheme;
    document.documentElement.style.colorScheme = "";
    ctx.diagnostics.info("Theme foundation destroyed");
  }
};

export function applyTheme(settings: AviarySettings): void {
  const root = document.documentElement;
  const theme = settings.appearance.theme;

  for (const value of ["dim", "lightsOut", "graphite", "plum", "midnight"]) {
    root.classList.toggle(`av-theme-${value}`, value === theme);
  }

  root.dataset.avTheme = theme;
  root.classList.toggle("av-dense", settings.appearance.denseMode);
  root.classList.toggle("av-hide-counts", settings.appearance.hideCounts);
  root.classList.toggle("av-high-contrast", settings.accessibility.highContrast);
  root.classList.toggle("av-reduce-motion", shouldReduceMotion(settings));
  root.style.colorScheme = "dark";
}

function shouldReduceMotion(settings: AviarySettings): boolean {
  if (settings.accessibility.reduceMotion === "always") return true;
  if (settings.accessibility.reduceMotion === "never") return false;
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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

const themeVars: Record<ThemeId, string> = {
  dim: `
    --av-bg: rgb(0, 0, 0);
    --av-surface: rgb(15, 20, 25);
    --av-surface-raised: rgb(22, 24, 28);
    --av-border: rgb(47, 51, 54);
    --av-text: rgb(239, 243, 244);
    /* X's own secondary grey measures 3.96:1 on the panel row — below AA for the 12px
       descriptions and status line it carries. Lifted to the nearest value that clears 4.5. */
    --av-muted: rgb(132, 139, 145);
    --av-accent: rgb(29, 155, 240);
  `,
  lightsOut: `
    --av-bg: rgb(0, 0, 0);
    --av-surface: rgb(5, 6, 7);
    --av-surface-raised: rgb(14, 15, 17);
    --av-border: rgb(36, 39, 43);
    --av-text: rgb(245, 247, 248);
    --av-muted: rgb(132, 139, 145);
    --av-accent: rgb(29, 155, 240);
  `,
  graphite: `
    --av-bg: rgb(8, 9, 11);
    --av-surface: rgb(18, 20, 23);
    --av-surface-raised: rgb(27, 30, 34);
    --av-border: rgb(55, 60, 66);
    --av-text: rgb(241, 244, 246);
    --av-muted: rgb(150, 157, 164);
    --av-accent: rgb(91, 176, 255);
  `,
  plum: `
    --av-bg: rgb(9, 5, 12);
    --av-surface: rgb(21, 14, 27);
    --av-surface-raised: rgb(32, 22, 41);
    --av-border: rgb(62, 45, 73);
    --av-text: rgb(246, 241, 249);
    --av-muted: rgb(164, 148, 174);
    --av-accent: rgb(205, 142, 255);
  `,
  midnight: `
    --av-bg: rgb(2, 8, 16);
    --av-surface: rgb(9, 18, 30);
    --av-surface-raised: rgb(16, 31, 49);
    --av-border: rgb(38, 60, 82);
    --av-text: rgb(239, 246, 252);
    --av-muted: rgb(139, 160, 178);
    --av-accent: rgb(68, 171, 255);
  `
};

const THEME_CSS = `
html.av-theme-dim { ${themeVars.dim} }
html.av-theme-lightsOut { ${themeVars.lightsOut} }
html.av-theme-graphite { ${themeVars.graphite} }
html.av-theme-plum { ${themeVars.plum} }
html.av-theme-midnight { ${themeVars.midnight} }

html[data-av-theme] {
  color-scheme: dark;
}

html[data-av-theme] body {
  background: var(--av-bg, rgb(0, 0, 0));
}

html[data-av-theme] [data-testid="primaryColumn"] {
  background: var(--av-bg, rgb(0, 0, 0));
}

html[data-av-theme] [data-testid="sidebarColumn"] section,
html[data-av-theme] [aria-label="Timeline: Trending now"] {
  background-color: color-mix(in srgb, var(--av-surface) 92%, transparent);
  border-color: var(--av-border);
}

html.av-dense article[data-testid="tweet"] {
  padding-top: 8px;
  padding-bottom: 8px;
}

/* Engagement counts inside the action bar only — the buttons themselves stay operable and
   keep their aria-labels, which carry the number for screen readers. */
html.av-hide-counts article[data-testid="tweet"] [data-testid="reply"] [data-testid="app-text-transition-container"],
html.av-hide-counts article[data-testid="tweet"] [data-testid="retweet"] [data-testid="app-text-transition-container"],
html.av-hide-counts article[data-testid="tweet"] [data-testid="unretweet"] [data-testid="app-text-transition-container"],
html.av-hide-counts article[data-testid="tweet"] [data-testid="like"] [data-testid="app-text-transition-container"],
html.av-hide-counts article[data-testid="tweet"] [data-testid="unlike"] [data-testid="app-text-transition-container"] {
  display: none !important;
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
