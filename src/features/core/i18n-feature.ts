import { localeDirection } from "../../platform/i18n";
import type { FeatureContext, FeatureModule } from "../registry";

const STYLE_ID = "av-i18n";

export const i18nFeature: FeatureModule = {
  id: "core.i18n",
  title: "Internationalization",
  category: "core",
  defaultEnabled: true,

  init(ctx) {
    ensureI18nStyle();
    applyLocaleClasses(ctx);
    ctx.diagnostics.info("i18n initialized", { locale: ctx.settings.i18n.locale });
  },

  apply(ctx) {
    ensureI18nStyle();
    applyLocaleClasses(ctx);
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    const root = document.documentElement;
    root.classList.remove("av-rtl", "av-ltr");
    delete root.dataset.avLocale;
    ctx.diagnostics.info("i18n destroyed");
  }
};

function applyLocaleClasses(ctx: FeatureContext): void {
  const root = document.documentElement;
  const direction = localeDirection(ctx.settings.i18n.locale);
  root.dataset.avLocale = ctx.settings.i18n.locale;
  root.classList.toggle("av-rtl", direction === "rtl");
  root.classList.toggle("av-ltr", direction === "ltr");
}

function ensureI18nStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = I18N_CSS;
  (document.head ?? document.documentElement).append(style);
}

const I18N_CSS = `
html.av-rtl [data-testid="tweetText"] {
  text-align: start;
  unicode-bidi: plaintext;
}

html.av-rtl [data-testid="primaryColumn"] {
  direction: rtl;
}

html.av-ltr [data-testid="tweetText"][lang^="ar"],
html.av-ltr [data-testid="tweetText"][lang^="he"] {
  direction: rtl;
  text-align: start;
  unicode-bidi: plaintext;
}

[data-testid="tweetText"],
[data-testid="cellInnerDiv"] {
  overflow-wrap: anywhere;
  word-break: break-word;
}

@media (pointer: coarse) {
  html [data-testid="reply"],
  html [data-testid="retweet"],
  html [data-testid="like"],
  html [data-testid="bookmark"] {
    min-height: 44px;
    min-width: 44px;
  }
}
`;
