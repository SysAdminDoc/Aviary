import type { FeatureContext, FeatureModule } from "../registry";

const STYLE_ID = "av-media-presentation";

/**
 * Media layout only.
 *
 * This module also carried a `media.sensitive` mode (default / reveal / blur / hide) until
 * v1.13.0. None of its rules could tell sensitive media apart from any other media -- they
 * matched every `tweetPhoto` and video in the timeline -- so "blur" smeared the whole timeline
 * and read as images failing to load. Scoping them needs a capture containing sensitive media,
 * and neither `_decoded/` capture holds a single instance.
 *
 * Rather than keep a control that could not do what it was named for, Aviary now leaves sensitive
 * media entirely to X, whose own filter is the one thing here that actually knows which posts are
 * sensitive. Roadmap_Blocked.md records what a capture would unblock.
 */
export const mediaPresentationFeature: FeatureModule = {
  id: "media.presentation",
  title: "Media presentation",
  category: "media",

  init(ctx) {
    ensurePresentationStyle();
    applyPresentationClasses(ctx);
    ctx.diagnostics.info("Media presentation initialized", {
      layout: ctx.settings.media.layout
    });
  },

  apply(ctx) {
    ensurePresentationStyle();
    applyPresentationClasses(ctx);
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    const root = document.documentElement;
    for (const className of [
      "av-media-layout-default",
      "av-media-layout-stacked",
      "av-media-layout-grid"
    ]) {
      root.classList.remove(className);
    }
    ctx.diagnostics.info("Media presentation destroyed");
  }
};

function applyPresentationClasses(ctx: FeatureContext): void {
  const root = document.documentElement;
  for (const className of [
    "av-media-layout-default",
    "av-media-layout-stacked",
    "av-media-layout-grid"
  ]) {
    root.classList.remove(className);
  }
  root.classList.add(`av-media-layout-${ctx.settings.media.layout}`);
}

function ensurePresentationStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PRESENTATION_CSS;
  (document.head ?? document.documentElement).append(style);
}

// `av-media-layout-default` deliberately has no rules: the default is X's own layout, untouched.
const PRESENTATION_CSS = `
html.av-media-layout-stacked article[data-testid="tweet"] [data-testid="tweetPhoto"] {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 8px 0 !important;
}

html.av-media-layout-stacked article[data-testid="tweet"] [data-testid="tweetPhoto"] img {
  width: 100% !important;
  height: auto !important;
  object-fit: contain !important;
  border-radius: 12px;
}

html.av-media-layout-grid article[data-testid="tweet"] [aria-label="Image"] {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
  gap: 6px !important;
}
`;
