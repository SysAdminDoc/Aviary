import type { FeatureContext, FeatureModule } from "../registry";

const MARKER = "data-av-abs-time";
const ORIGINAL = "data-av-abs-original";

/**
 * X shows relative timestamps ("2h", "May 18"), which lose the actual time and stop being
 * comparable once a thread is more than a day old. Every `<time>` in the captures carries a full
 * `datetime` attribute, so the exact value is already present — it is only the rendered text that
 * is relative.
 *
 * The original text is stashed on the element so Off restores exactly what X wrote, rather than
 * Aviary inventing a relative string of its own.
 */
export const absoluteTimeFeature: FeatureModule = {
  id: "appearance.absoluteTime",
  title: "Absolute timestamps",
  category: "appearance",

  init(ctx) {
    applyAbsoluteTime(ctx, document);
  },

  apply(ctx, root) {
    applyAbsoluteTime(ctx, root);
  },

  destroy(ctx) {
    restoreTimestamps();
    ctx.diagnostics.info("Absolute timestamps restored");
  }
};

function applyAbsoluteTime(ctx: FeatureContext, root: ParentNode): void {
  if (!ctx.settings.appearance.absoluteTimestamps) {
    restoreTimestamps();
    return;
  }

  const formatter = buildFormatter(ctx.settings.i18n.locale);
  if (!formatter) {
    return;
  }

  for (const node of collectTimes(root)) {
    const iso = node.getAttribute("datetime");
    if (!iso) {
      continue;
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    const text = formatter.format(parsed);
    if (node.textContent === text) {
      continue;
    }
    if (!node.hasAttribute(ORIGINAL)) {
      node.setAttribute(ORIGINAL, node.textContent ?? "");
    }
    node.textContent = text;
    node.setAttribute(MARKER, "1");
    // X's own tooltip already carries the full date; keep whatever it set.
  }
}

function collectTimes(root: ParentNode): HTMLTimeElement[] {
  const found: HTMLTimeElement[] = [];
  if (root instanceof Element && root.matches("time[datetime]")) {
    found.push(root as HTMLTimeElement);
  }
  if ("querySelectorAll" in root) {
    for (const node of Array.from(root.querySelectorAll<HTMLTimeElement>("time[datetime]"))) {
      found.push(node);
    }
  }
  return found;
}

function buildFormatter(locale: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return undefined;
  }
}

function restoreTimestamps(): void {
  for (const node of Array.from(document.querySelectorAll<HTMLTimeElement>(`time[${MARKER}]`))) {
    const original = node.getAttribute(ORIGINAL);
    if (original !== null) {
      node.textContent = original;
    }
    node.removeAttribute(MARKER);
    node.removeAttribute(ORIGINAL);
  }
}
