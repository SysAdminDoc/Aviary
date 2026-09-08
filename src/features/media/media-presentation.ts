import type { FeatureContext, FeatureModule } from "../registry.ts";

const STYLE_ID = "av-media-presentation";

/**
 * Media layout only.
 *
 * This module also carried a `media.sensitive` mode (default / reveal / blur / hide) until
 * v1.13.0. None of its rules could tell sensitive media apart from any other media -- they
 * matched every `tweetPhoto` and video in the timeline -- so "blur" smeared the whole timeline
 * and read as images failing to load. Scoping them needs a capture containing sensitive media,
 * and neither 2026-05-19 capture held a single instance.
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
    clearLayoutClasses();
    ctx.diagnostics.info("Media presentation destroyed");
  }
};

function applyPresentationClasses(ctx: FeatureContext): void {
  clearLayoutClasses();
  document.documentElement.classList.add(`av-media-layout-${ctx.settings.media.layout}`);
}

/**
 * Removed by prefix rather than from a list of names.
 *
 * The class is built from the setting, so a fourth layout added to the settings type would be
 * applied by the line above and left behind by a hardcoded removal list -- the same shape as the
 * per-item nav classes in layout/declutter.ts, which have always been cleared this way.
 */
function clearLayoutClasses(): void {
  const root = document.documentElement;
  for (const className of Array.from(root.classList)) {
    if (className.startsWith("av-media-layout-")) {
      root.classList.remove(className);
    }
  }
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
//
// Both layouts below reshape the media of the post being read. They exclude a quoted post, and a
// reply under a conversation, because that media belongs to a post the reader is not on: stretched
// to the full column it buried the thread under banners. The exclusions are written as `:not()`
// rather than as a second rule that puts the values back, so X's own layout is never overridden in
// the first place and there is nothing to restore it to.
const NOT_BORROWED = ':not([role="link"] *):not([data-av-conversation-role="reply"] *)';

const PRESENTATION_CSS = `
html.av-media-layout-stacked article[data-testid="tweet"] [data-testid="tweetPhoto"]${NOT_BORROWED} {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  margin: 8px 0 !important;
}

html.av-media-layout-stacked article[data-testid="tweet"] [data-testid="tweetPhoto"]${NOT_BORROWED} img {
  width: 100% !important;
  height: auto !important;
  object-fit: contain !important;
  border-radius: 12px;
}

html.av-media-layout-grid article[data-testid="tweet"] [aria-label="Image"]${NOT_BORROWED} {
  display: grid !important;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
  gap: 6px !important;
}
`;
