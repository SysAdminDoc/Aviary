import type { FeatureModule } from "../registry";

const STYLE_ID = "av-link-unshorten";
const PROCESSED_ATTR = "data-av-link-clean";

export const linkUnshortenFeature: FeatureModule = {
  id: "library.linkUnshorten",
  title: "Direct link unshortening",
  category: "core",
  defaultEnabled: true,

  init(ctx) {
    ensureStyle();
    if (!ctx.settings.links.expandTco) {
      return;
    }
    scan(document);
    ctx.diagnostics.info("Link unshortening initialized");
  },

  apply(ctx, root, addedNodes) {
    ensureStyle();
    if (!ctx.settings.links.expandTco) {
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

  destroy(ctx) {
    document.getElementById(STYLE_ID)?.remove();
    for (const link of Array.from(
      document.querySelectorAll<HTMLAnchorElement>(`a[${PROCESSED_ATTR}]`)
    )) {
      link.removeAttribute(PROCESSED_ATTR);
      const original = link.dataset.avOriginalText;
      if (original !== undefined) {
        link.textContent = original;
        delete link.dataset.avOriginalText;
      }
    }
    ctx.diagnostics.info("Link unshortening destroyed");
  }
};

function scan(root: ParentNode | Element): void {
  const anchors: HTMLAnchorElement[] =
    root instanceof HTMLAnchorElement
      ? [root]
      : Array.from(root.querySelectorAll<HTMLAnchorElement>("a"));
  for (const anchor of anchors) {
    if (anchor.getAttribute(PROCESSED_ATTR) === "1") {
      continue;
    }
    const href = anchor.getAttribute("href") ?? "";
    if (!/(^|\.)t\.co\//.test(href) && !/^https?:\/\/t\.co\//.test(href)) {
      continue;
    }
    const target = resolveDestination(anchor);
    if (!target) {
      continue;
    }
    if (!anchor.dataset.avOriginalText) {
      anchor.dataset.avOriginalText = anchor.textContent ?? "";
    }
    anchor.classList.add("av-link-clean");
    anchor.title = target;
    anchor.setAttribute(PROCESSED_ATTR, "1");
    if (anchor.textContent && /^https?:\/\/t\.co\//i.test(anchor.textContent.trim())) {
      anchor.textContent = target;
    }
  }
}

function resolveDestination(anchor: HTMLAnchorElement): string | null {
  const candidates = [
    anchor.getAttribute("aria-label") ?? "",
    anchor.getAttribute("data-expanded-url") ?? "",
    anchor.title,
    anchor.textContent ?? ""
  ];
  for (const candidate of candidates) {
    const match = /https?:\/\/[^\s]+/i.exec(candidate);
    if (match && !/^https?:\/\/t\.co\//i.test(match[0])) {
      return match[0];
    }
  }
  return null;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LINK_CSS;
  (document.head ?? document.documentElement).append(style);
}

const LINK_CSS = `
a.av-link-clean {
  text-decoration-style: dotted;
  text-decoration-thickness: 1px;
}
`;
