import type { FeatureContext, FeatureModule } from "../registry.ts";

/**
 * X puts its unread count in the tab title ("(3) Home / X"), which survives every declutter
 * setting: you can hide notification badges everywhere on the page and still be pulled back by
 * the number in the tab. Minimal Twitter's most-requested open issues are this exact thing.
 *
 * This is a title-string transform, not a DOM contract. It removes a leading parenthesised number
 * and nothing else, so if X stops emitting one the feature simply does nothing. The original title
 * is restored exactly on Off or destroy.
 */
const BADGE = /^\(\d+\+?\)\s*/;

let observer: MutationObserver | undefined;
let lastWritten: string | undefined;

export const titleBadgeFeature: FeatureModule = {
  id: "appearance.titleBadge",
  title: "Hide tab title badge",
  category: "appearance",

  init(ctx) {
    applyTitleBadge(ctx);
  },

  apply(ctx) {
    applyTitleBadge(ctx);
  },

  destroy() {
    stop();
  }
};

function applyTitleBadge(ctx: FeatureContext): void {
  if (!ctx.settings.appearance.hideTitleBadge) {
    stop();
    return;
  }
  strip();
  if (observer || typeof MutationObserver === "undefined") {
    return;
  }
  const titleElement = document.querySelector("title");
  if (!titleElement) {
    return;
  }
  // X rewrites the title on navigation and on every new notification, so the strip has to run
  // again each time. Watching the element's children is what sees document.title assignments.
  observer = new MutationObserver(() => strip());
  observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
}

function strip(): void {
  const current = document.title;
  // Ignore the mutation our own write produced, or the observer would re-enter forever.
  if (current === lastWritten) {
    return;
  }
  const stripped = current.replace(BADGE, "");
  if (stripped === current) {
    return;
  }
  lastWritten = stripped;
  document.title = stripped;
}

function stop(): void {
  observer?.disconnect();
  observer = undefined;
  lastWritten = undefined;
  // The badge is X's to restore: it rewrites the title on the next notification or navigation.
  // Aviary does not invent a count it never owned.
}

/** Test seam: module-level observer state must not leak between cases. */
export function resetTitleBadgeState(): void {
  stop();
}

export const TITLE_BADGE_PATTERN = BADGE;
