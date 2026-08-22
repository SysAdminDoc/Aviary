import type { FeatureModule } from "../registry.ts";

const STYLE_ID = "av-mobile-touch";

export const mobileTouchFeature: FeatureModule = {
  id: "core.mobileTouch",
  title: "Mobile & touch ergonomics",
  category: "accessibility",

  init(ctx) {
    ensureMobileStyle();
    applyMobileClasses();
    ctx.diagnostics.info("Mobile/touch initialized");
  },

  apply() {
    ensureMobileStyle();
    applyMobileClasses();
  },

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.classList.remove("av-mobile", "av-touch");
    ctx.diagnostics.info("Mobile/touch destroyed");
  }
};

function applyMobileClasses(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  const root = document.documentElement;
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  root.classList.toggle("av-touch", touch);
  root.classList.toggle("av-mobile", narrow);
}

function ensureMobileStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = MOBILE_CSS;
  (document.head ?? document.documentElement).append(style);
}

// The Control Center lives in a shadow root, so its touch and viewport rules ship with its
// own stylesheet (src/ui/control-center.ts). Only page DOM can be styled from here.
const MOBILE_CSS = `
html.av-touch [${"data-av-hide-button"}] {
  min-width: 44px;
  min-height: 44px;
  margin-inline-end: 4px;
  padding: 8px 12px;
}

html.av-touch [${"data-av-media-button"}] {
  min-width: 44px;
  min-height: 44px;
  padding: 8px 12px;
  font-size: 12px;
}

html.av-touch [data-av-local-bookmark],
html.av-touch .av-ai-trigger,
html.av-touch [data-av-snippet-palette="trigger"] {
  min-width: 44px;
  min-height: 44px;
  margin-block: 2px;
  padding: 8px 10px;
}

/* Hover is not a discovery mechanism on a coarse pointer. Keep both prompt affordances visible
   and give their options the same target size without enlarging the surrounding timeline. */
html.av-touch .av-ai-trigger {
  opacity: 1;
}

html.av-touch .av-ai-menu,
html.av-touch .av-snippet-popover {
  gap: 8px;
}

html.av-touch .av-ai-option,
html.av-touch .av-snippet-option {
  min-width: 44px;
  min-height: 44px;
  padding: 10px 12px;
}

html.av-mobile [data-testid="primaryColumn"] {
  padding-inline: 0;
}
`;
