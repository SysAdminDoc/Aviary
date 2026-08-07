import type { FeatureContext, FeatureModule } from "../registry";
import { normalizeImageUrl } from "./urls";

const PROCESSED_ATTR = "data-av-orig-image";
const ORIGINAL_SRC = "avOriginalSrc";
const ORIGINAL_SRCSET = "avOriginalSrcset";

const IMAGE_SELECTOR = 'img[src*="pbs.twimg.com/media"]';

/**
 * Serves timeline photos at `name=orig` instead of the size X picked for the slot.
 *
 * The same normalisation the downloader uses, pointed at the displayed `src`. Off by default:
 * an original-quality image is several times the bytes of the `900x900` X serves, and that is
 * the viewer's bandwidth to spend.
 */
export function upgradeImage(img: HTMLImageElement): boolean {
  const current = img.getAttribute("src");
  if (!current) {
    return false;
  }
  const normalized = normalizeImageUrl(current, { preferOriginal: true });
  if (!normalized || normalized.url === current) {
    return false;
  }

  if (img.dataset[ORIGINAL_SRC] === undefined) {
    img.dataset[ORIGINAL_SRC] = current;
    // Captured even though X does not currently set it: if that changes, a stale srcset would
    // silently out-rank the src we just upgraded, and the feature would look like it did nothing.
    img.dataset[ORIGINAL_SRCSET] = img.getAttribute("srcset") ?? "";
  }
  img.removeAttribute("srcset");
  img.setAttribute("src", normalized.url);
  return true;
}

export function restoreImage(img: HTMLImageElement): void {
  const original = img.dataset[ORIGINAL_SRC];
  if (original !== undefined) {
    img.setAttribute("src", original);
    delete img.dataset[ORIGINAL_SRC];
  }
  const srcset = img.dataset[ORIGINAL_SRCSET];
  if (srcset !== undefined) {
    if (srcset.length > 0) {
      img.setAttribute("srcset", srcset);
    }
    delete img.dataset[ORIGINAL_SRCSET];
  }
  img.removeAttribute(PROCESSED_ATTR);
}

export const inlineOriginalImagesFeature: FeatureModule = {
  id: "media.inlineOriginalImages",
  title: "Show images at original quality",
  category: "media",
  defaultEnabled: true,

  init(ctx: FeatureContext) {
    if (!ctx.settings.media.inlineOriginalImages) {
      return;
    }
    scan(document);
    ctx.diagnostics.info("Original-quality images initialized");
  },

  apply(ctx: FeatureContext, root: ParentNode, addedNodes?: Element[]) {
    if (!ctx.settings.media.inlineOriginalImages) {
      return;
    }
    if (!addedNodes || addedNodes.length === 0) {
      scan(root);
      return;
    }
    for (const node of addedNodes) {
      scan(node);
    }
  },

  destroy(ctx: FeatureContext) {
    for (const img of Array.from(
      document.querySelectorAll<HTMLImageElement>(`img[${PROCESSED_ATTR}]`)
    )) {
      restoreImage(img);
    }
    ctx.diagnostics.info("Original-quality images destroyed");
  }
};

function scan(root: ParentNode | Element): void {
  const images: HTMLImageElement[] =
    (root as Element).tagName === "IMG"
      ? [root as HTMLImageElement]
      : Array.from(root.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR));

  for (const img of images) {
    if (img.getAttribute(PROCESSED_ATTR) === "1") {
      continue;
    }
    // Marked before the upgrade is attempted: an image whose URL is already `name=orig` needs no
    // rewrite, and re-testing it on every mutation batch is pure work.
    img.setAttribute(PROCESSED_ATTR, "1");
    upgradeImage(img);
  }
}
