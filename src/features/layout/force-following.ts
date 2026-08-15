import type { FeatureContext, FeatureModule } from "../registry";

const TABLIST = '[role="tablist"][data-testid="ScrollSnap-List"]';
const TABLIST_FALLBACK = '[role="tablist"]';

/**
 * Selects the Following tab when the home timeline loads.
 *
 * The tab is identified by **position, not label**: X localises the tab text, so matching
 * "Following" would only work for English readers. On `/home` the first two tabs are For you and
 * Following in that order in every locale, with any pinned Lists following them -- verified
 * against `_decoded/home.html`, which has exactly those two.
 */
export function findFollowingTab(root: ParentNode): HTMLElement | null {
  const list =
    root.querySelector<HTMLElement>(TABLIST) ?? root.querySelector<HTMLElement>(TABLIST_FALLBACK);
  if (!list) {
    return null;
  }
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
  // Fewer than two tabs means this is not the home strip -- profile and search use tablists too.
  if (tabs.length < 2) {
    return null;
  }
  return tabs[1] ?? null;
}

export function shouldSelectFollowing(tab: HTMLElement): boolean {
  return tab.getAttribute("aria-selected") !== "true";
}

let assertedForHref: string | null = null;

export const forceFollowingFeature: FeatureModule = {
  id: "layout.forceFollowing",
  title: "Open Following instead of For you",
  category: "layout",

  init(ctx: FeatureContext) {
    assertedForHref = null;
    if (ctx.settings.layout.forceFollowing) {
      ctx.diagnostics.info("Following-timeline preference initialized");
    }
  },

  apply(ctx: FeatureContext, root: ParentNode) {
    if (!ctx.settings.layout.forceFollowing || ctx.route.surface !== "home") {
      return;
    }
    // Selecting a home tab does not change the URL, so "once per href" is also "once per visit
    // to home". That is deliberate: it reasserts when the viewer navigates back to the timeline,
    // and it leaves a deliberate switch to For you alone for the rest of that visit.
    if (assertedForHref === ctx.route.href) {
      return;
    }
    const tab = findFollowingTab(root) ?? findFollowingTab(document);
    if (!tab) {
      // The strip has not rendered yet; the observer will call back when it does.
      return;
    }
    assertedForHref = ctx.route.href;
    if (!shouldSelectFollowing(tab)) {
      return;
    }
    tab.click();
    ctx.diagnostics.info("Selected the Following timeline");
  },

  destroy(ctx: FeatureContext) {
    // Nothing to reverse in the DOM: the tab strip is X's own, and switching the viewer back to
    // For you on teardown would be a second unrequested navigation rather than an undo.
    assertedForHref = null;
    ctx.diagnostics.info("Following-timeline preference destroyed");
  }
};
