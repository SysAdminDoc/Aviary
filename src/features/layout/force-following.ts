import type { FeatureContext, FeatureModule } from "../registry.ts";

const TABLIST = '[role="tablist"][data-testid="ScrollSnap-List"]';
const TABLIST_FALLBACK = '[role="tablist"]';
const HIDE_MARKER = "data-av-hide-for-you";

interface HiddenTabSnapshot {
  style: string | null;
  ariaHidden: string | null;
  tabIndex: string | null;
}

const hiddenTabs = new Set<HTMLElement>();
const hiddenTabSnapshots = new WeakMap<HTMLElement, HiddenTabSnapshot>();
let hiddenForHref: string | null = null;
let degradedForHref: string | null = null;

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

function findHomeTabList(root: ParentNode): HTMLElement | null {
  const list = root.querySelector<HTMLElement>(TABLIST);
  if (list) return list;
  if (root !== document) {
    return document.querySelector<HTMLElement>(TABLIST);
  }
  return null;
}

function homeTabs(root: ParentNode): HTMLElement[] | null {
  const list = findHomeTabList(root);
  if (!list) return null;
  return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function restoreHiddenTabs(): void {
  for (const tab of hiddenTabs) {
    const snapshot = hiddenTabSnapshots.get(tab);
    if (snapshot) {
      if (snapshot.style === null) tab.removeAttribute("style");
      else tab.setAttribute("style", snapshot.style);
      if (snapshot.ariaHidden === null) tab.removeAttribute("aria-hidden");
      else tab.setAttribute("aria-hidden", snapshot.ariaHidden);
      if (snapshot.tabIndex === null) tab.removeAttribute("tabindex");
      else tab.setAttribute("tabindex", snapshot.tabIndex);
    }
    tab.removeAttribute(HIDE_MARKER);
  }
  hiddenTabs.clear();
  hiddenForHref = null;
}

function hideForYouTab(tab: HTMLElement): void {
  if (!hiddenTabSnapshots.has(tab)) {
    hiddenTabSnapshots.set(tab, {
      style: tab.getAttribute("style"),
      ariaHidden: tab.getAttribute("aria-hidden"),
      tabIndex: tab.getAttribute("tabindex")
    });
  }
  tab.setAttribute(HIDE_MARKER, "true");
  tab.setAttribute("aria-hidden", "true");
  tab.setAttribute("tabindex", "-1");
  const collapsed = [
    ["width", "0px"],
    ["min-width", "0px"],
    ["max-width", "0px"],
    ["height", "0px"],
    ["min-height", "0px"],
    ["max-height", "0px"],
    ["padding", "0px"],
    ["margin", "0px"],
    ["overflow", "hidden"],
    ["opacity", "0"],
    ["visibility", "hidden"],
    ["pointer-events", "none"],
    ["flex", "0 0 0px"]
  ] as const;
  for (const [property, value] of collapsed) {
    tab.style.setProperty(property, value, "important");
  }
  hiddenTabs.add(tab);
}

function markDegraded(ctx: FeatureContext): void {
  if (degradedForHref === ctx.route.href) return;
  degradedForHref = ctx.route.href;
  ctx.diagnostics.warn("Hide For You tab selector degraded", {
    feature: "layout.forceFollowing",
    reason: "home-tablist-short"
  });
}

let assertedForHref: string | null = null;

export const forceFollowingFeature: FeatureModule = {
  id: "layout.forceFollowing",
  title: "Open Following instead of For you",
  category: "layout",

  init(ctx: FeatureContext) {
    restoreHiddenTabs();
    assertedForHref = null;
    degradedForHref = null;
    if (ctx.settings.layout.forceFollowing) {
      ctx.diagnostics.info("Following-timeline preference initialized");
    }
    if (ctx.settings.layout.hideForYouTab) {
      ctx.diagnostics.info("For You tab visibility preference initialized");
    }
  },

  apply(ctx: FeatureContext, root: ParentNode) {
    const hideForYou = ctx.settings.layout.hideForYouTab;
    if (!hideForYou || ctx.route.surface !== "home") {
      if (hiddenTabs.size > 0) restoreHiddenTabs();
      degradedForHref = null;
    }

    if (ctx.route.surface !== "home") {
      return;
    }

    if (hideForYou) {
      if (hiddenForHref !== null && hiddenForHref !== ctx.route.href) restoreHiddenTabs();
      const tabs = homeTabs(root);
      if (!tabs) return;
      if (tabs.length < 2) {
        restoreHiddenTabs();
        markDegraded(ctx);
        return;
      }
      degradedForHref = null;
      hiddenForHref = ctx.route.href;
      const following = tabs[1]!;
      if (shouldSelectFollowing(following)) {
        following.click();
        ctx.diagnostics.info("Selected the Following timeline for hidden For You tab");
      }
      hideForYouTab(tabs[0]!);
    }

    if (!ctx.settings.layout.forceFollowing) {
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
    restoreHiddenTabs();
    assertedForHref = null;
    degradedForHref = null;
    ctx.diagnostics.info("Following-timeline preference destroyed");
  },

  getStatus() {
    return {
      ok: degradedForHref === null,
      message: degradedForHref === null
        ? "Home tab controls ready"
        : "Hide For You tab needs the two-tab Home strip"
    };
  }
};
