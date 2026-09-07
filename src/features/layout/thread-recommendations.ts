import type { FeatureContext, FeatureModule } from "../registry.ts";

const MARKER = "data-av-thread-recommendation";
const HEADING_MARKER = "data-av-thread-recommendation-heading";

/**
 * X appends recommendation modules to the bottom of a conversation: a heading cell
 * ("Discover more" / "Sourced from across X" in the captured status page) followed by
 * cells holding posts that are not replies to the thread being read.
 *
 * The module carries no test id, generated classes are off-limits, and the heading text is
 * the only stable discriminator the capture exposes. This is the bounded-label pattern the
 * ad contracts already use: an exact heading string from a maintained list, and only when it
 * sits in an `h2[role="heading"]` inside a timeline cell on a conversation route. A heading
 * that merely contains one of these words elsewhere on the page cannot match.
 *
 * Locales beyond the verified strings simply do not match, which leaves the module visible
 * rather than risking a wrong collapse. Add a locale only with a capture that proves its copy.
 */
const HEADING_LABELS = new Set([
  // Verified in the conversation capture (2026-05-19 observation, recorded in dom-schema.json).
  "discover more"
]);

export const threadRecommendationsFeature: FeatureModule = {
  id: "layout.threadRecommendations",
  title: "Hide thread recommendations",
  category: "layout",

  init(ctx) {
    applyThreadRecommendations(ctx);
  },

  apply(ctx) {
    applyThreadRecommendations(ctx);
  },

  destroy(ctx) {
    restoreThreadRecommendations();
    ctx.diagnostics.info("Thread recommendations restored");
  }
};

function applyThreadRecommendations(ctx: FeatureContext): void {
  if (!ctx.settings.layout.hideThreadRecommendations || ctx.route?.surface !== "status") {
    restoreThreadRecommendations();
    return;
  }

  const heading = findRecommendationHeading();
  if (!heading) {
    return;
  }

  const headingCell = heading.closest<HTMLElement>('[data-testid="cellInnerDiv"]');
  if (!headingCell) {
    return;
  }

  // Everything after the boundary is recommended content, not part of the conversation.
  let hidden = 0;
  let node: Element | null = headingCell;
  while (node) {
    if (node instanceof HTMLElement && node.matches('[data-testid="cellInnerDiv"]')) {
      node.setAttribute(MARKER, "1");
      hidden += 1;
    }
    node = node.nextElementSibling;
  }
  headingCell.setAttribute(HEADING_MARKER, "1");

  if (hidden > 0) {
    ctx.diagnostics.info("Thread recommendations collapsed", { cells: hidden });
  }
}

function findRecommendationHeading(): HTMLElement | null {
  const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]'));
  for (const cell of cells) {
    // A recommendation boundary owns a heading and no post of its own.
    if (cell.querySelector('article[data-testid="tweet"]')) {
      continue;
    }
    const heading = cell.querySelector<HTMLElement>('h2[role="heading"]');
    if (!heading) {
      continue;
    }
    const label = (heading.textContent ?? "").trim().toLowerCase();
    if (HEADING_LABELS.has(label)) {
      return heading;
    }
  }
  return null;
}

function restoreThreadRecommendations(): void {
  for (const node of Array.from(document.querySelectorAll(`[${MARKER}], [${HEADING_MARKER}]`))) {
    node.removeAttribute(MARKER);
    node.removeAttribute(HEADING_MARKER);
  }
}
