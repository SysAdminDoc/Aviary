import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * The accessibility contract, driven rather than read.
 *
 * These assertions stay behavioural instead of matching implementation details such as an inert
 * toggle, a hand-written Escape branch, or a visibility substring. That form fails on any
 * rename while a real regression that keeps the string passes, and it demonstrably let two defects
 * ship: a settings toggle unreadable in forced colors, and an `aria-busy` written as the empty
 * string. Nothing here reads a `.ts` file; every check mounts the panel and drives it.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let context;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-a11y-behaviour-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};
export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};
export { CONTROL_CENTER_SECTION_MANIFEST } from ${JSON.stringify(abs("src/ui/control-center/section-manifest.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryA11y",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await page.setContent(
    "<!doctype html><meta charset=utf-8><body><a id=outside href='#'>outside</a><button id=host-button>host</button></body>"
  );
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/** Mounts a fresh panel and leaves it available on `window.__panel`. */
async function mount() {
  await page.evaluate(() => {
    window.__panel?.destroy?.();
    const settings = AviaryA11y.cloneSettings(AviaryA11y.DEFAULT_SETTINGS);
    window.__panel = AviaryA11y.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: () => {}
    });
  });
}

test("a closed panel is out of the tab order, not merely invisible", async () => {
  await mount();

  const closed = await page.evaluate(() => {
    const root = document.getElementById("av-control-center").shadowRoot;
    const overlay = root.querySelector(".av-overlay");
    const panel = root.querySelector(".av-panel");
    return {
      inert: overlay.inert === true || overlay.hasAttribute("inert"),
      popover: panel.getAttribute("popover"),
      popoverOpen: panel.matches(":popover-open")
    };
  });

  // `aria-hidden` over focusable descendants is the failure this guards; `inert` is what actually
  // removes them from the tab order. Native popover state keeps the closed dialog out of the
  // accessibility tree as well.
  assert.equal(closed.inert, true, "a closed overlay must be inert");
  assert.equal(closed.popover, "auto");
  assert.equal(closed.popoverOpen, false);
});

test("opening moves focus into the panel and exposes it as a modal", async () => {
  await mount();

  const open = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const overlay = root.querySelector(".av-overlay");
    const panel = root.querySelector(".av-panel");
    return {
      inert: overlay.inert === true || overlay.hasAttribute("inert"),
      popover: panel.getAttribute("popover"),
      popoverOpen: panel.matches(":popover-open"),
      role: panel.getAttribute("role"),
      ariaModal: panel.getAttribute("aria-modal"),
      bodyInert: document.body.hasAttribute("inert"),
      focusInsidePanel: panel.contains(root.activeElement)
    };
  });

  assert.equal(open.inert, false, "an open overlay must be interactive");
  assert.equal(open.popover, "auto");
  assert.equal(open.popoverOpen, true);
  assert.equal(open.ariaModal, "true", "a modal must say so");
  assert.ok(open.role === "dialog" || open.role === "alertdialog", `unexpected role ${open.role}`);
  assert.equal(open.bodyInert, true, "the page behind a modal must be inert");
  assert.equal(open.focusInsidePanel, true, "focus must land inside the panel, not stay on the trigger");
});

test("Escape closes the panel and returns focus to what opened it", async () => {
  await mount();

  const opened = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    const launcher = root.querySelector(".av-launcher");
    launcher.focus();
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const openedWith = root.activeElement?.className ?? "";

    return { openedWith };
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(25);
  const result = await page.evaluate(() => {
    const root = document.getElementById("av-control-center").shadowRoot;
    const launcher = root.querySelector(".av-launcher");
    const overlay = root.querySelector(".av-overlay");
    return {
      closedInert: overlay.inert === true || overlay.hasAttribute("inert"),
      bodyInert: document.body.hasAttribute("inert"),
      focusReturned: root.activeElement === launcher
    };
  });

  assert.notEqual(opened.openedWith, "", "the panel must take focus when it opens");
  assert.equal(result.closedInert, true, "Escape must close the panel");
  assert.equal(result.bodyInert, false, "and must release the page behind it");
  assert.equal(result.focusReturned, true, "focus must go back to the control that opened it");
});

test("focus stays inside the panel while it is open", async () => {
  await mount();

  const contained = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Anything outside the modal is inert, so it cannot take focus even when asked directly.
    document.getElementById("outside").focus();
    document.getElementById("host-button").focus();
    const panel = root.querySelector(".av-panel");
    return {
      hostFocusEscaped:
        document.activeElement !== null &&
        document.activeElement.id !== "" &&
        document.activeElement.id !== "av-control-center",
      stillInPanel: panel.contains(root.activeElement)
    };
  });

  assert.equal(contained.hostFocusEscaped, false, "an inert page must not accept focus");
  assert.equal(contained.stillInPanel, true, "focus must remain inside the open modal");
});

test("every control the panel draws has an accessible name", async () => {
  await mount();

  const unnamed = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const nameOf = (node) => {
      const labelled = node.getAttribute("aria-labelledby");
      if (labelled) {
        const target = root.getElementById?.(labelled) ?? root.querySelector(`#${CSS.escape(labelled)}`);
        if (target?.textContent?.trim()) return target.textContent.trim();
      }
      return (
        node.getAttribute("aria-label")?.trim() ||
        node.getAttribute("title")?.trim() ||
        node.textContent?.trim() ||
        // A checkbox is named by the row it sits in; the row label is its visible name.
        node.closest(".av-row")?.querySelector(".av-row-label")?.textContent?.trim() ||
        ""
      );
    };

    const missing = [];
    for (const node of root.querySelectorAll("button, select, input, textarea, a[href]")) {
      if (node.hidden || node.closest("[hidden]")) continue;
      if (!nameOf(node)) {
        missing.push(`${node.tagName.toLowerCase()}.${node.className || "(no class)"}`);
      }
    }
    return missing;
  });

  assert.deepEqual(unnamed, [], "controls without an accessible name are unusable by screen reader");
});

test("the panel does not attach hover tooltips to its controls or labels", async () => {
  await mount();

  const titled = await page.evaluate(() => {
    const root = document.getElementById("av-control-center").shadowRoot;
    return [...root.querySelectorAll("[title]")].map((node) => ({
      tag: node.tagName.toLowerCase(),
      className: node.className,
      title: node.getAttribute("title")
    }));
  });

  assert.deepEqual(titled, []);
});

test("the launcher says what it controls, and the status line announces itself", async () => {
  await mount();

  const wiring = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    const launcher = root.querySelector(".av-launcher");
    const controls = launcher.getAttribute("aria-controls");
    const before = launcher.getAttribute("aria-expanded");
    launcher.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const status = root.querySelector(".av-status");
    return {
      controls,
      // The id has to resolve inside the same root, or the relationship is decorative.
      target: controls ? Boolean(root.getElementById?.(controls) ?? root.querySelector(`#${CSS.escape(controls)}`)) : false,
      collapsed: before,
      expanded: launcher.getAttribute("aria-expanded"),
      statusRole: status?.getAttribute("role") ?? null,
      statusLive: status?.getAttribute("aria-live") ?? status?.getAttribute("role") ?? null
    };
  });

  assert.ok(wiring.controls, "the launcher must name the region it opens");
  assert.equal(wiring.target, true, `aria-controls points at ${wiring.controls}, which is not in this root`);
  assert.equal(wiring.collapsed, "false");
  assert.equal(wiring.expanded, "true", "the launcher must report its own state");
  // Saving is asynchronous and its only feedback is this line; without a live role a screen
  // reader user gets no confirmation that a setting was written.
  assert.ok(
    wiring.statusRole === "status" || wiring.statusLive === "polite",
    `the status line is neither role=status nor aria-live=polite (role ${wiring.statusRole})`
  );
});

test("the status line actually announces the result of a save", async () => {
  await mount();

  const announced = await page.evaluate(async () => {
    const root = document.getElementById("av-control-center").shadowRoot;
    root.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Presets is the landing destination and has no toggles; Appearance is the first that does.
    root.querySelector('.av-nav-item[data-av-section="appearance"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const status = root.querySelector(".av-status");
    const before = status.textContent;
    const box = root.querySelector('.av-row input[type="checkbox"]');
    box.checked = !box.checked;
    box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const staged = status.textContent;

    root.querySelector(".av-transaction-save").click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { before, staged, saved: status.textContent };
  });

  assert.notEqual(announced.staged, announced.before, "staging a change must be announced");
  assert.match(announced.staged, /Unsaved/i);
  // Each control names its own outcome ("Density updated."), so the assertion is that the line
  // changed again and stopped warning about unsaved work — not that it says one fixed word.
  assert.notEqual(announced.saved, announced.staged, "the save must be announced too");
  assert.ok(!/Unsaved/i.test(announced.saved), `the panel still reads "${announced.saved}" after saving`);
});

/**
 * The WCAG 2.2 criteria axe does not check.
 *
 * axe reports colour, names, roles and structure. It says nothing about a control that receives
 * focus underneath a sticky element, nothing about a drag-only interaction, and only part of what
 * target size requires. All three are shapes this panel has: settings commit through a sticky Save
 * row at the bottom of a scrolling page, the destination rail is pinned down the left, and the
 * toggle rows are dense.
 *
 *   2.4.11 Focus Not Obscured (Minimum), AA -- the focused control must not be entirely hidden.
 *   2.5.7 Dragging Movements, AA          -- anything draggable needs a single-pointer alternative.
 *   2.5.8 Target Size (Minimum), AA       -- 24 by 24 CSS pixels, or a named exception.
 *
 * Each test ends with a positive control that breaks the thing it checks and requires the check to
 * notice, because a sweep over a panel that happens to be fine is indistinguishable from a sweep
 * that cannot see anything.
 */

const OCCLUDERS = [".av-transaction-bar", ".av-nav"];
/** Tall enough to lay out normally, and short enough that a section must scroll under the row. */
const A11Y_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 560 }
];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focuses each control in the panel and reports any whose box ends up entirely inside an occluder.
 *
 * Focus order here is document order: the panel sets no positive `tabindex`, and a separate test
 * below drives real Tab presses and requires them to visit the same sequence.
 */
const OBSCURED_SWEEP = (options) => {
  const shadow = document.getElementById("av-control-center").shadowRoot;
  const covered = (inner, outer) =>
    inner.width > 0 &&
    inner.height > 0 &&
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom;

  const hidden = [];
  for (const entry of window.__manifest) {
    const item = shadow.querySelector(`[data-av-section="${entry.id}"]`);
    if (!item) {
      hidden.push(`${entry.id}: destination is missing from the rail`);
      continue;
    }
    item.click();
    const occluders = options.occluders
      .map((selector) => ({ selector, node: shadow.querySelector(selector) }))
      .filter((entry) => entry.node !== null)
      .map((entry) => ({ ...entry, box: entry.node.getBoundingClientRect() }));

    for (const node of shadow.querySelectorAll(options.focusable)) {
      node.focus();
      if (shadow.activeElement !== node) continue;
      const rect = node.getBoundingClientRect();
      for (const { selector, node: occluder, box } of occluders) {
        // A control inside the rail is not obscured by the rail; it is the rail.
        if (occluder.contains(node)) continue;
        if (covered(rect, box)) {
          hidden.push(`${entry.id}: ${node.className || node.tagName} sits entirely inside ${selector}`);
        }
      }
    }
  }
  return hidden;
};

async function openPanelAt(viewport) {
  await page.setViewportSize(viewport);
  await mount();
  await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    window.__manifest = AviaryA11y.CONTROL_CENTER_SECTION_MANIFEST.map((entry) => ({ id: entry.id }));
  });
}

test("no control is left focused entirely behind the save row or the rail", async () => {
  for (const viewport of A11Y_VIEWPORTS) {
    await openPanelAt(viewport);
    const hidden = await page.evaluate(OBSCURED_SWEEP, {
      occluders: OCCLUDERS,
      focusable: FOCUSABLE
    });
    assert.deepEqual(hidden, [], `at ${viewport.width}x${viewport.height}, focus landed under a pinned element`);
  }

  // Positive control: grow the save row until it covers the page, and the sweep has to say so.
  await openPanelAt({ width: 1024, height: 560 });
  await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const style = document.createElement("style");
    style.textContent = ".av-transaction-bar { position: fixed; inset: 0; z-index: 9; }";
    shadow.append(style);
  });
  const broken = await page.evaluate(OBSCURED_SWEEP, { occluders: OCCLUDERS, focusable: FOCUSABLE });
  assert.ok(
    broken.length > 0,
    "a save row covering the whole page must be reported, or this sweep cannot see an occlusion"
  );
  await page.setViewportSize({ width: 1440, height: 900 });
});

/**
 * A key that tells two controls apart.
 *
 * `tagName.className` collapsed thirteen rail buttons and eleven toggle rows into a handful of
 * repeated strings, so any reordering was invisible and the comparison was mostly a repeated label
 * matching itself. The key is now the control's position in the panel's own focusable list plus a
 * short description: two controls can share a description, but not a position, and a Tab order
 * that visits them in a different sequence produces a different list of positions.
 */
const FOCUS_KEY_SOURCE = `window.__focusKey = function (node) {
  const index = (window.__focusOrder || []).indexOf(node);
  const label = (node.getAttribute("aria-label") || node.textContent || "").trim().slice(0, 32);
  return index + "|" + node.tagName + "." + (node.className || "") + "|" + label;
};`;

test("real Tab presses visit the controls this sweep measures", async () => {
  // The sweep focuses controls in document order. This is what says that is the tab order.
  //
  // Driven on a destination with real content rather than on Presets, which contributes exactly
  // one non-rail control: an order this only ever checked across the rail would say nothing about
  // the 373 focus calls the occlusion sweep makes inside the sections.
  await openPanelAt({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector('[data-av-section="appearance"]').click();
  });

  // Scoped to the panel: the launcher sits outside it and Tab starts inside once it is open.
  // Injected as a script rather than passed as an argument: Playwright cannot serialize a
  // function, and building one from a string inside the page is the eval the lint rules refuse.
  await page.addScriptTag({ content: FOCUS_KEY_SOURCE });
  const expected = await page.evaluate((focusable) => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const panel = shadow.querySelector(".av-panel");
    window.__focusOrder = [...shadow.querySelectorAll(focusable)].filter((node) => panel.contains(node));
    return window.__focusOrder
      .filter((node) => {
        node.focus();
        return shadow.activeElement === node;
      })
      .map(window.__focusKey);
  }, FOCUSABLE);
  assert.ok(expected.length >= 20, `expected a content destination, saw ${expected.length} controls`);
  assert.ok(
    new Set(expected).size >= expected.length - 2,
    `the comparison key collapses ${expected.length - new Set(expected).size} controls into duplicates, so a reorder would be invisible`
  );

  await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelectorAll("*")[0]?.blur?.();
    shadow.querySelector(".av-panel")?.focus?.();
  });

  const visited = [];
  for (let index = 0; index < expected.length + 2; index += 1) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => {
      const shadow = document.getElementById("av-control-center").shadowRoot;
      const node = shadow.activeElement;
      return node ? window.__focusKey(node) : null;
    });
    if (current === null) break;
    if (visited.length > 0 && current === visited[0]) break;
    visited.push(current);
  }

  assert.deepEqual(
    visited.slice(0, expected.length),
    expected,
    "the tab order and the order this sweep measures must be the same order"
  );
});

/**
 * The activating region, not the input box.
 *
 * Every small control in this panel is a checkbox inside a `label` -- a 38 by 22 painted toggle in
 * a 994 by 55 row, or a 14 by 14 box in an 83 by 40 chip. Clicking anywhere in the label activates
 * the control, so the label is the target 2.5.8 is about. Measuring the input would report sixty-two
 * failures that a pointer user cannot experience, which is how a real check gets switched off.
 */
const TARGET_SIZE_SWEEP = (options) => {
  const shadow = document.getElementById("av-control-center").shadowRoot;
  const small = [];

  for (const entry of window.__manifest) {
    shadow.querySelector(`[data-av-section="${entry.id}"]`)?.click();
    const targets = [];
    for (const node of shadow.querySelectorAll(options.focusable)) {
      const label = node.closest("label");
      const target = label ?? node;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      targets.push({ node, target, rect });
    }

    for (const { node, target, rect } of targets) {
      if (rect.width >= options.minimum && rect.height >= options.minimum) continue;

      // The spacing exception, as 2.5.8 actually defines it: a circle of the minimum diameter
      // centred on the undersized target must not intersect *another target*, nor the circle of
      // another undersized one. Comparing centre to centre was wrong -- it ignores the neighbour's
      // size, so a 20 by 20 button flush against a 200 by 40 one measured 110 pixels apart and
      // read as exempt while the spec's circle overlapped the neighbour's box by 10 pixels.
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const radius = options.minimum / 2;
      const distanceToBox = (box) => {
        const dx = Math.max(box.left - centre.x, 0, centre.x - box.right);
        const dy = Math.max(box.top - centre.y, 0, centre.y - box.bottom);
        return Math.hypot(dx, dy);
      };
      const crowded = targets.some((other) => {
        if (other.target === target) return false;
        const box = other.rect;
        const undersized = box.width < options.minimum || box.height < options.minimum;
        if (undersized) {
          // Two undersized targets: the two circles must not touch, so their centres must be at
          // least one full diameter apart.
          const otherCentre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          return Math.hypot(centre.x - otherCentre.x, centre.y - otherCentre.y) < options.minimum;
        }
        // A full-sized neighbour: the circle must not reach its box at all.
        return distanceToBox(box) < radius;
      });
      if (!crowded) {
        small.push(`${entry.id}: ${node.className || node.tagName} is ${Math.round(rect.width)}x${Math.round(rect.height)}, exempt by spacing`);
        continue;
      }
      small.push(
        `${entry.id}: ${node.className || node.tagName} target is ${Math.round(rect.width)}x${Math.round(rect.height)}, under ${options.minimum} with no exception`
      );
    }
  }
  return small;
};

test("every interactive target is 24 by 24, or names the exception that lets it be smaller", async () => {
  await openPanelAt({ width: 1440, height: 900 });
  const findings = await page.evaluate(TARGET_SIZE_SWEEP, { focusable: FOCUSABLE, minimum: 24 });
  const failures = findings.filter((entry) => entry.includes("no exception"));
  assert.deepEqual(failures, [], "a target under 24 by 24 needs a spec exception, and this one has none");

  // Positive control: shrink the rows the toggles live in and the sweep has to report them.
  await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const style = document.createElement("style");
    style.textContent = ".av-row { min-height: 0 !important; height: 8px !important; padding: 0 !important; }";
    shadow.append(style);
  });
  const shrunk = await page.evaluate(TARGET_SIZE_SWEEP, { focusable: FOCUSABLE, minimum: 24 });
  assert.ok(
    shrunk.some((entry) => entry.includes("no exception")),
    "an 8-pixel row must be reported, or this sweep cannot see a small target"
  );

  // The exemption branch never runs on the real panel -- every focusable resolves through its
  // label to a box comfortably over 24 -- so it is driven here instead. Shipping an unexercised
  // exemption is how a wrong one survives: this is the geometry the spec defines, and the
  // centre-to-centre version that stood before called the first of these exempt.
  const geometry = await page.evaluate((minimum) => {
    const surface = document.createElement("div");
    surface.style.cssText = "position:fixed;inset:0;background:#fff;";
    const place = (left, top, width, height, id) => {
      const node = document.createElement("button");
      node.type = "button";
      node.id = id;
      node.textContent = id;
      node.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;margin:0;padding:0;`;
      surface.append(node);
      return node;
    };
    // A 20x20 target flush against a 200x40 one. Their centres are 110px apart, so a centre-to-
    // centre rule calls it exempt; the spec's 24px circle overlaps the neighbour's box.
    place(0, 0, 20, 20, "crowded-small");
    place(20, 0, 200, 40, "crowded-neighbour");
    // The same small target with the neighbour moved well clear.
    place(0, 400, 20, 20, "lonely-small");
    place(300, 400, 200, 40, "lonely-neighbour");
    document.body.append(surface);

    const rectOf = (id) => document.getElementById(id).getBoundingClientRect();
    const measure = (id) => {
      const rect = rectOf(id);
      const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const radius = minimum / 2;
      const others = ["crowded-neighbour", "lonely-neighbour"].map(rectOf);
      return others.some((box) => {
        const dx = Math.max(box.left - centre.x, 0, centre.x - box.right);
        const dy = Math.max(box.top - centre.y, 0, centre.y - box.bottom);
        return Math.hypot(dx, dy) < radius;
      });
    };
    const result = { crowded: measure("crowded-small"), lonely: measure("lonely-small") };
    surface.remove();
    return result;
  }, 24);

  assert.equal(geometry.crowded, true, "a 24px circle overlapping a full-sized neighbour is not exempt");
  assert.equal(geometry.lonely, false, "and one that reaches nothing is");
});

test("nothing in the panel can only be operated by dragging", async () => {
  // 2.5.7 holds because no path here requires a drag. That is a claim about the panel, so it is
  // asserted rather than assumed: a reorderable list added later has to bring a single-pointer
  // alternative with it, and this fails until it does.
  await openPanelAt({ width: 1440, height: 900 });
  const dragOnly = await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const found = [];
    for (const entry of window.__manifest) {
      shadow.querySelector(`[data-av-section="${entry.id}"]`)?.click();
      for (const node of shadow.querySelectorAll("*")) {
        if (node.draggable === true) found.push(`${entry.id}: ${node.className || node.tagName} is draggable`);
        const style = getComputedStyle(node);
        // A slider is the other drag-shaped control, and it is exempt only when the keyboard and
        // a click can move it too.
        if (node.tagName === "INPUT" && node.getAttribute("type") === "range" && node.disabled) {
          found.push(`${entry.id}: a disabled range control has no alternative`);
        }
        if (style.touchAction === "none" && node.tagName !== "CANVAS") {
          found.push(`${entry.id}: ${node.className || node.tagName} suppresses touch scrolling`);
        }
      }
    }
    return found;
  });
  assert.deepEqual(dragOnly, [], "a drag-only interaction needs a single-pointer alternative");
});
