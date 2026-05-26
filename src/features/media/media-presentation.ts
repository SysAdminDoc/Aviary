import type { FeatureContext, FeatureModule } from "../registry";

const STYLE_ID = "av-media-presentation";

export const mediaPresentationFeature: FeatureModule = {
  id: "media.presentation",
  title: "Media presentation",
  category: "media",
  defaultEnabled: true,

  init(ctx) {
    ensurePresentationStyle();
    applyPresentationClasses(ctx);
    ctx.diagnostics.info("Media presentation initialized", {
      sensitive: ctx.settings.media.sensitive,
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
      "av-sensitive-default",
      "av-sensitive-reveal",
      "av-sensitive-blur",
      "av-sensitive-hide",
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
    "av-sensitive-default",
    "av-sensitive-reveal",
    "av-sensitive-blur",
    "av-sensitive-hide"
  ]) {
    root.classList.remove(className);
  }
  root.classList.add(`av-sensitive-${ctx.settings.media.sensitive}`);

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

const PRESENTATION_CSS = `
html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="contentDisclosureButton"] {
  display: none !important;
}

html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="tweetPhoto"] img,
html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="videoPlayer"] video,
html.av-sensitive-reveal article[data-testid="tweet"] [data-testid="videoComponent"] video {
  filter: none !important;
}

html.av-sensitive-blur article[data-testid="tweet"] [data-testid="tweetPhoto"] img,
html.av-sensitive-blur article[data-testid="tweet"] [data-testid="videoPlayer"] video,
html.av-sensitive-blur article[data-testid="tweet"] [data-testid="videoComponent"] video {
  filter: blur(18px) saturate(0.85) !important;
  transition: filter 160ms ease;
}

html.av-sensitive-blur article[data-testid="tweet"] [data-testid="tweetPhoto"]:hover img,
html.av-sensitive-blur article[data-testid="tweet"] [data-testid="tweetPhoto"]:focus-within img {
  filter: none !important;
}

html.av-sensitive-hide article[data-testid="tweet"] [data-testid="tweetPhoto"],
html.av-sensitive-hide article[data-testid="tweet"] [data-testid="videoPlayer"],
html.av-sensitive-hide article[data-testid="tweet"] [data-testid="videoComponent"] {
  display: none !important;
}

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
