import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * How the Control Center survives its own re-render.
 *
 * Every save calls `render()`, which calls `body.replaceChildren()` — so focus, caret and scroll
 * position have to be deliberately put back, the search field has to live outside the replaced
 * subtree, and only the active section may be built. Those four claims used to be asserted as
 * regexes over `control-center.ts` (`/body\.scrollTop = scrollTop/`, `/header\.append\(titleWrap,
 * searchBar, close\)/`), which pass whenever the literal survives and fail on any rename. Here
 * the panel is mounted and driven, so the assertions fail when the behaviour does.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let context;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-cc-render-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { mountControlCenter } from ${JSON.stringify(abs("src/ui/control-center.ts"))};
export { DEFAULT_SETTINGS, cloneSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCC",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  page = await context.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

/**
 * Mounts a panel, opens it, and leaves the handle on `window.__panel`. `diagnostics` is the list
 * the Trust section reads, so a test can hand it the events it wants rendered.
 */
async function mount(diagnostics = []) {
  await page.evaluate((events) => {
    window.__panel?.destroy?.();
    const settings = AviaryCC.cloneSettings(AviaryCC.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    window.__panel = AviaryCC.mountControlCenter({
      settings,
      diagnostics: () => events,
      onChange: async () => {},
      onError: () => {}
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
  }, diagnostics);
  await page.waitForTimeout(20);
}

const openSection = (name) =>
  page.evaluate((section) => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(`.av-nav-item[data-av-section="${section}"]`).click();
  }, name);

test("saving a setting returns focus to the row that was changed, and holds the scroll", async () => {
  await mount();
  await openSection("appearance");

  const result = await page.evaluate(async () => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const body = shadow.querySelector(".av-panel-body");

    // A row far enough down that losing the scroll position would be obvious.
    const boxes = [...body.querySelectorAll('.av-row input[type="checkbox"]')];
    const box = boxes[boxes.length - 1];
    const label = box.closest(".av-row").dataset.avLabel;

    // `.av-content` is the scroller — `.av-panel-body` is the grid around it and is
    // `overflow: hidden`, so scrolling that instead would make every assertion below 0 === 0.
    shadow.querySelector(".av-content").scrollTop = 9999;
    const scrolledTo = shadow.querySelector(".av-content").scrollTop;

    box.checked = !box.checked;
    box.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The transaction bar is the commit: save() calls render(), which replaces every row.
    shadow.querySelector(".av-transaction-save").click();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const active = shadow.activeElement;
    return {
      scrolledTo,
      scrollAfter: shadow.querySelector(".av-content").scrollTop,
      // A different element after replaceChildren — otherwise nothing was rebuilt and the
      // assertions below would hold vacuously.
      sameNode: active === box,
      focusedLabel: active?.closest?.(".av-row")?.dataset?.avLabel ?? null,
      expectedLabel: label,
      focusInBody: body.contains(active)
    };
  });

  assert.equal(result.sameNode, false, "the row really is rebuilt — otherwise this proves nothing");
  assert.equal(result.focusInBody, true, "a save must not drop focus to the document");
  assert.equal(result.focusedLabel, result.expectedLabel, "focus must land back on the row that changed");
  assert.ok(result.scrolledTo > 0, "the fixture must actually scroll, or the next assertion is 0 === 0");
  assert.equal(result.scrollAfter, result.scrolledTo, "scroll position must survive the rebuild");
});

test("a rebuild requested while the user is mid-edit is deferred, not forced on them", async () => {
  await mount();
  await openSection("filtering");

  const result = await page.evaluate(async () => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const textarea = shadow.querySelector(".av-textarea");
    if (!textarea) return { skipped: "no textarea in the filtering section" };

    textarea.focus();
    textarea.value = "alpha\nbravo\ncharlie";
    textarea.setSelectionRange(7, 12);

    // A page mutation asking the panel to repaint. Honouring it here would replace the row
    // under the caret and throw away half-typed input.
    window.__panel.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const active = shadow.activeElement;
    return {
      survived: active === textarea,
      value: active?.value ?? null,
      selectionStart: active?.selectionStart ?? null,
      selectionEnd: active?.selectionEnd ?? null
    };
  });

  assert.ok(!result.skipped, result.skipped);
  assert.equal(result.survived, true, "the focused control must not be replaced mid-edit");
  assert.equal(result.value, "alpha\nbravo\ncharlie", "half-typed input must survive a deferred refresh");
  assert.equal(result.selectionStart, 7, "and so must the caret");
  assert.equal(result.selectionEnd, 12);
});

test("the panel draws one section at a time behind a grouped nav rail", async () => {
  await mount();

  const rail = await page.evaluate(() => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const nav = shadow.querySelector(".av-nav");
    const items = [...nav.querySelectorAll(".av-nav-item")];
    const content = shadow.querySelector(".av-content");
    return {
      ids: items.map((item) => item.dataset.avSection),
      groups: [...nav.querySelectorAll(".av-nav-group")].map((node) => node.textContent),
      order: [...nav.children].map((node) =>
        node.classList.contains("av-nav-group") ? `#${node.textContent}` : node.dataset.avSection
      ),
      sectionsRendered: content.querySelectorAll(".av-section").length,
      active: items.filter((item) => item.getAttribute("aria-current") === "true").map((i) => i.dataset.avSection)
    };
  });

  // A lower bound, not an exact count: adding a section is normal growth, and pinning the number
  // turns every new section into a failing test.
  assert.ok(rail.ids.length >= 12, `expected at least 12 sections in the rail, found ${rail.ids.length}`);
  assert.equal(
    new Set(rail.ids).size,
    rail.ids.length,
    "section ids must be unique — a duplicate makes one section unreachable"
  );
  assert.deepEqual(rail.groups, ["Start", "Reading", "Data", "Advanced"], "group order is the rail's reading order");
  // Every group heading must precede the items it labels, or the rail reads as one flat list.
  assert.equal(rail.order[0], "#Start");
  assert.deepEqual(rail.active, [rail.ids[0]], "exactly one rail item may be current");
  assert.equal(rail.sectionsRendered, 1, "building all twelve sections puts the scrolling straight back");
});

test("each rail destination renders only itself", async () => {
  await mount();

  const titles = await page.evaluate(async () => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const ids = [...shadow.querySelectorAll(".av-nav-item")].map((item) => item.dataset.avSection);
    const seen = [];
    for (const id of ids) {
      shadow.querySelector(`.av-nav-item[data-av-section="${id}"]`).click();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const pages = shadow.querySelectorAll(".av-content .av-section");
      seen.push({
        id,
        count: pages.length,
        current: [...shadow.querySelectorAll(".av-nav-item")]
          .filter((item) => item.getAttribute("aria-current") === "true")
          .map((item) => item.dataset.avSection)
      });
    }
    return seen;
  });

  for (const entry of titles) {
    assert.equal(entry.count, 1, `${entry.id} rendered ${entry.count} sections`);
    assert.deepEqual(entry.current, [entry.id], `${entry.id} is not marked current after being chosen`);
  }
});

test("the search field keeps focus and caret across the renders its own typing causes", async () => {
  await mount();

  const typed = await page.evaluate(async () => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const search = shadow.querySelector(".av-search-input");
    const body = shadow.querySelector(".av-panel-body");
    search.focus();

    // Each input event re-renders the body. A search field inside `body` would be replaced
    // mid-word and lose both focus and caret.
    for (const char of "hidden") {
      search.value += char;
      search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return {
      insideBody: body.contains(search),
      stillFocused: shadow.activeElement === search,
      value: search.value,
      caret: search.selectionStart
    };
  });

  assert.equal(typed.insideBody, false, "the search field must hang off the panel chrome, not the body");
  assert.equal(typed.stillFocused, true, "typing must not knock focus out of the search field");
  assert.equal(typed.value, "hidden");
  assert.equal(typed.caret, "hidden".length, "the caret must stay at the end of what was typed");
});

test("search matches rendered row text, and says so when nothing does", async () => {
  await mount();

  const search = async (needle) =>
    page.evaluate(async (query) => {
      const shadow = document.getElementById("av-control-center").shadowRoot;
      const input = shadow.querySelector(".av-search-input");
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      const content = shadow.querySelector(".av-content");
      return {
        rows: [...content.querySelectorAll(".av-row")].map((row) => row.textContent ?? ""),
        sections: content.querySelectorAll(".av-section").length,
        empty: content.querySelector(".av-empty-title")?.textContent ?? null,
        hint: content.querySelector(".av-empty-hint")?.textContent ?? null
      };
    }, needle);

  const hits = await search("theme");
  assert.ok(hits.rows.length > 0, "a word drawn on a row must find that row");
  for (const row of hits.rows) {
    assert.match(row.toLowerCase(), /theme/, "search must only return rows whose own text matches");
  }

  // Matching on the row's own rendered text is what lets a row added later be searchable the
  // moment it exists, rather than when someone remembers to update a keyword table.
  const wide = await search("e");
  assert.ok(wide.sections > 1, "a common letter must reach rows in more than one section");

  const nothing = await search("zzzznotasetting");
  assert.equal(nothing.rows.length, 0);
  assert.equal(nothing.empty, "Nothing matches that search.");
  assert.equal(nothing.hint, "Try a shorter word, or pick a section on the left.");
});

test("choosing a section clears an active search instead of appearing to do nothing", async () => {
  await mount();

  const after = await page.evaluate(async () => {
    const shadow = document.getElementById("av-control-center").shadowRoot;
    const input = shadow.querySelector(".av-search-input");
    input.value = "theme";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    shadow.querySelector(".av-nav-item[data-av-section=\"performance\"]").click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const content = shadow.querySelector(".av-content");
    return {
      value: input.value,
      sections: content.querySelectorAll(".av-section").length,
      current: [...shadow.querySelectorAll(".av-nav-item")]
        .filter((item) => item.getAttribute("aria-current") === "true")
        .map((item) => item.dataset.avSection)
    };
  });

  assert.equal(after.value, "", "the field must be cleared, not left showing a filter that no longer applies");
  assert.equal(after.sections, 1, "the chosen section must be what renders");
  assert.deepEqual(after.current, ["performance"]);
});

test("Trust reports a failed write rather than letting it vanish", async () => {
  const healthy = await (async () => {
    await mount([]);
    await openSection("trust");
    return page.evaluate(() => {
      const shadow = document.getElementById("av-control-center").shadowRoot;
      return [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === "Saving")
        ?.querySelector(".av-row-description")?.textContent ?? null;
    });
  })();

  const broken = await (async () => {
    await mount([
      { level: "error", message: "hidden posts failed to save: QuotaExceededError" },
      { level: "warn", message: "something unrelated" }
    ]);
    await openSection("trust");
    return page.evaluate(() => {
      const shadow = document.getElementById("av-control-center").shadowRoot;
      return [...shadow.querySelectorAll(".av-row")]
        .find((row) => row.querySelector(".av-row-label")?.textContent === "Saving")
        ?.querySelector(".av-row-description")?.textContent ?? null;
    });
  })();

  assert.match(healthy, /Working/, "with no failures the row must say so plainly");
  assert.match(broken, /could not be saved/, "a failed write must reach the user");
  assert.match(broken, /QuotaExceededError/, "and must carry the reason, not just a generic apology");
  assert.match(broken, /\(1\)/, "only the write failures count — the warning is not one");
});

test("a section that cannot be drawn says so and leaves the rest of the panel usable", async () => {
  // FeatureRegistry has always isolated per-feature failures; the panel did not isolate
  // per-section ones. A builder that threw took the whole render with it, so the rail item
  // appeared to do nothing -- activeSectionId had moved, the previous section stayed on screen,
  // and the status line still read "Saved locally".
  const result = await page.evaluate(async () => {
    window.__panel?.destroy?.();
    const settings = AviaryCC.cloneSettings(AviaryCC.DEFAULT_SETTINGS);
    settings.i18n.locale = "en";
    const errors = [];

    window.__panel = AviaryCC.mountControlCenter({
      settings,
      diagnostics: () => [],
      onChange: async () => {},
      onError: (message) => errors.push(message),
      // Reached only by the Trust section, so building Trust throws and nothing else does.
      getSelectorHealth() {
        throw new Error("selector health blew up");
      }
    });
    const shadow = document.getElementById("av-control-center").shadowRoot;
    shadow.querySelector(".av-launcher").click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    shadow.querySelector('.av-nav-item[data-av-section="trust"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const broken = {
      rendered: shadow.querySelector(".av-content .av-section")?.dataset.avSection ?? null,
      current: [...shadow.querySelectorAll(".av-nav-item")]
        .filter((item) => item.getAttribute("aria-current") === "true")
        .map((item) => item.dataset.avSection),
      copy: shadow.querySelector(".av-content")?.textContent ?? ""
    };

    // Every other destination must still work.
    shadow.querySelector('.av-nav-item[data-av-section="appearance"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const recovered = {
      rendered: shadow.querySelector(".av-content .av-section")?.dataset.avSection ?? null,
      rows: shadow.querySelectorAll(".av-content .av-row").length
    };

    // And a search across every section must not stop at the one that cannot be built.
    const input = shadow.querySelector(".av-search-input");
    input.value = "theme";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const searched = shadow.querySelectorAll(".av-content .av-row").length;

    return { broken, recovered, searched, errors };
  });

  assert.equal(result.broken.rendered, "trust", "the chosen section must render, not the previous one");
  assert.deepEqual(result.broken.current, ["trust"], "and the rail must show it as current");
  assert.match(result.broken.copy, /could not be drawn/, "the panel must say the section is broken");
  assert.match(result.broken.copy, /selector health blew up/, "and must carry the reason");
  assert.ok(
    result.errors.some((message) => /could not draw the Trust section/i.test(message)),
    `the failure must reach diagnostics, saw ${JSON.stringify(result.errors)}`
  );

  assert.equal(result.recovered.rendered, "appearance", "the rest of the panel must still work");
  assert.ok(result.recovered.rows > 0);
  assert.ok(result.searched > 0, "a search must not stop at the section that cannot be built");
});
