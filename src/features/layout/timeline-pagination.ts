import type { FeatureContext, FeatureModule } from "../registry.ts";
import { ft } from "../core/feature-i18n.ts";

/**
 * Lets the timeline stop.
 *
 * Infinite scroll is the one attention mechanism the focus window does not touch: focus mode
 * covers the column outside chosen hours, but inside them the feed still never ends. This counts
 * the posts X has rendered and, past a limit the reader sets, stops the feed extending until they
 * ask for more.
 *
 * It intervenes at the *end* of the timeline and nowhere else. The posts already rendered are left
 * exactly where they are, nothing above the cut is touched, and the control is appended after the
 * last visible row -- so the reading position never moves. That is the whole safety property: an
 * intervention that scrolled the reader would be worse than the problem.
 *
 * X's own loader is not blocked, because Aviary originates no requests and refuses none on the
 * reader's behalf. What is hidden is everything past the limit, which is what stops the *reading*
 * from being endless; X may still have fetched it.
 */

const STYLE_ID = "av-timeline-pagination";
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
const TIMELINE_SELECTOR = '[data-testid="primaryColumn"]';
const OVER_LIMIT_ATTR = "data-av-past-limit";
const CONTROL_ID = "av-timeline-more";
/** Surfaces with a feed that extends. A conversation is finite and is left alone. */
const PAGINATED_SURFACES = new Set(["home", "profile", "search"]);

/** Extra posts released each time the reader asks for more, on top of their own limit. */
let released = 0;
let lastSurface = "";

export function timelineLimitFor(ctx: FeatureContext): number {
  return ctx.settings.layout.timelineStopAfter;
}

export const timelinePaginationFeature: FeatureModule = {
  id: "layout.timelinePagination",
  title: "Let the timeline stop",
  category: "layout",

  init(ctx) {
    released = 0;
    lastSurface = ctx.route.surface;
    if (active(ctx)) {
      ensureStyle();
      ctx.diagnostics.info("Timeline pagination initialized", {
        stopAfter: timelineLimitFor(ctx)
      });
    }
  },

  apply(ctx, root) {
    if (!active(ctx)) {
      clear();
      return;
    }
    // A new surface is a new feed, so the reader's allowance starts over rather than carrying a
    // release they granted on a different timeline.
    if (ctx.route.surface !== lastSurface) {
      lastSurface = ctx.route.surface;
      released = 0;
    }
    ensureStyle();
    paginate(ctx, root);
  },

  destroy(ctx) {
    clear();
    released = 0;
    ctx.diagnostics.info("Timeline pagination destroyed");
  },

  getStatus() {
    return {
      ok: true,
      message: released > 0 ? `Timeline extended by ${released}` : "Timeline pagination idle"
    };
  }
};

function active(ctx: FeatureContext): boolean {
  return (
    ctx.settings.layout.timelineStopAfter > 0 && PAGINATED_SURFACES.has(ctx.route.surface)
  );
}

function paginate(ctx: FeatureContext, root: ParentNode | Element): void {
  const timeline = findTimeline(root) ?? findTimeline(document);
  if (!timeline) {
    return;
  }
  const limit = timelineLimitFor(ctx) + released;
  const cells = Array.from(timeline.querySelectorAll(CELL_SELECTOR));

  let shown = 0;
  let firstHidden: Element | null = null;
  for (const cell of cells) {
    if (shown < limit) {
      cell.removeAttribute(OVER_LIMIT_ATTR);
      shown += 1;
      continue;
    }
    if (!firstHidden) {
      firstHidden = cell;
    }
    cell.setAttribute(OVER_LIMIT_ATTR, "1");
  }

  syncControl(ctx, timeline, firstHidden, shown, cells.length);
}

function findTimeline(root: ParentNode | Element): Element | null {
  if (root instanceof Element && root.matches(TIMELINE_SELECTOR)) {
    return root;
  }
  return "querySelector" in root ? root.querySelector(TIMELINE_SELECTOR) : null;
}

/**
 * The control lives after the last post the reader is allowed, so pressing it extends downward
 * into space that was already below the fold. Nothing above it moves.
 */
function syncControl(
  ctx: FeatureContext,
  timeline: Element,
  firstHidden: Element | null,
  shown: number,
  total: number
): void {
  const existing = timeline.ownerDocument?.getElementById(CONTROL_ID) ?? null;
  if (!firstHidden) {
    existing?.remove();
    return;
  }

  const label = `${ft(ctx, "Show more posts")} · ${shown}`;
  if (existing) {
    const button = existing.querySelector("button");
    if (button) {
      button.textContent = label;
    }
    // X recycles rows, so the control has to stay immediately before the first held-back post.
    if (existing.nextElementSibling !== firstHidden) {
      firstHidden.parentElement?.insertBefore(existing, firstHidden);
    }
    return;
  }

  const host = timeline.ownerDocument?.createElement("div");
  if (!host) {
    return;
  }
  host.id = CONTROL_ID;
  host.className = "av-timeline-more";
  const button = timeline.ownerDocument!.createElement("button");
  button.type = "button";
  button.className = "av-timeline-more-button";
  button.textContent = label;
  button.addEventListener("click", () => {
    released += timelineLimitFor(ctx);
    ctx.diagnostics.info("Timeline extended", { released, total });
    ctx.requestApply();
  });
  host.append(button);
  firstHidden.parentElement?.insertBefore(host, firstHidden);
}

function clear(): void {
  document.getElementById(CONTROL_ID)?.remove();
  for (const cell of Array.from(document.querySelectorAll(`[${OVER_LIMIT_ATTR}]`))) {
    cell.removeAttribute(OVER_LIMIT_ATTR);
  }
  document.getElementById(STYLE_ID)?.remove();
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PAGINATION_CSS;
  (document.head ?? document.documentElement).append(style);
}

const PAGINATION_CSS = `
[${OVER_LIMIT_ATTR}="1"] {
  display: none !important;
}

.av-timeline-more {
  display: flex;
  justify-content: center;
  padding: 16px 0 24px;
}

.av-timeline-more-button {
  appearance: none;
  border: 1px solid currentColor;
  border-radius: 9999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  /* Longhands, not the shorthand: the shorthand cannot take a CSS-wide keyword as its family,
     so the whole declaration is dropped, and a button does not inherit its type on its own. */
  font-family: inherit;
  font-weight: 600;
  line-height: 1.2;
  font-size: 15px;
  padding: 10px 22px;
  opacity: 0.85;
}

.av-timeline-more-button:hover,
.av-timeline-more-button:focus-visible {
  opacity: 1;
}
`;
