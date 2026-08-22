import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The bans.
 *
 * This is the one file that asserts on source text, and it does so only for claims of the form
 * "this pattern must not appear anywhere": no `innerHTML`, no `eval`, no keyboard shortcuts, no
 * `<all_urls>`, no unpinned devDependency, no page-level selector reaching into a shadow root.
 * A ban is the single claim a source scan states exactly — there is no behaviour to drive,
 * because the whole point is that the behaviour does not exist.
 *
 * Everything else belongs in a test that runs the code. If you are reaching for
 * `assert.match(source, /.../)` to check that something *works*, it goes elsewhere: the panel is
 * driven in a11y-behaviour, panel-appearance-contract and control-center-render; features in
 * feature-lifecycle and boot-registration; hardening guarantees in runtime-hardening.
 */

test("source avoids unsafe injection and shortcut patterns", async () => {
  const files = await listFiles(path.join(root, "src"), ".ts");
  const unsafe = [];
  const shortcuts = [];
  const blur = [];

  for (const file of files) {
    const rel = path.relative(root, file);
    const text = await readFile(file, "utf8");

    if (!rel.endsWith(path.join("platform", "trusted-types.ts")) && /innerHTML|insertAdjacentHTML/.test(text)) {
      unsafe.push(rel);
    }
    if (/keydown|keyup|keypress/.test(text) && !isScopedKeyboardInteraction(rel, text)) {
      shortcuts.push(rel);
    }
    if (/backdrop-filter/.test(text)) {
      blur.push(rel);
    }
  }

  assert.deepEqual(unsafe, [], "HTML injection must route through TrustedTypes helpers");
  assert.deepEqual(shortcuts, [], "Aviary does not register custom keyboard shortcuts");
  assert.deepEqual(blur, [], "content scripts must not use backdrop-filter");
});

function isScopedKeyboardInteraction(relative, text) {
  const allowed = new Set([
    path.join("src", "ui", "control-center.ts"),
    path.join("src", "features", "ai", "command-menu.ts"),
    path.join("src", "features", "composer", "composer-snippets.ts")
  ]);
  if (!allowed.has(relative)) return false;
  return /\.key\s*(?:===|!==)\s*["'](?:Escape|Tab|Arrow(?:Up|Down|Left|Right)|Home|End|Enter|\s)["']/.test(text);
}

test("no stylesheet targets one of X's generated class names", async () => {
  const files = await listFiles(path.join(root, "src"), ".ts");
  const offenders = [];

  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!/[.#]r-[a-z0-9-]{5,}/.test(line)) continue;
      // `selectors.ts` declares a handful as documented *fallbacks*, used only once the stable
      // selector stops matching and reported as degraded when they are. That is the opposite of
      // depending on them.
      if (relative === "src/platform/selectors.ts" && /^\s*fallback:/.test(line)) continue;
      offenders.push(`${relative}: ${line.trim().slice(0, 80)}`);
    }
  }

  // `.r-150rngu` is emitted by X's build and changes without notice. A rule that depends on one
  // stops applying silently — the feature looks enabled and does nothing.
  assert.deepEqual(offenders, [], "these depend on class names X regenerates");
});

/**
 * The options page ships as static assets loaded under the MV3 page CSP, which blocks inline
 * script outright. These are bans on what the shipped files may contain -- the only claim a
 * source scan states exactly -- so they live here. What the page *does* is driven in
 * tests/extension-options-page.test.mjs.
 */
test("the shipped options page carries no inline script, handler, or pill styling", async () => {
  const html = await readFile(path.join(root, "src/extension/options.html"), "utf8");
  assert.ok(
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html),
    "MV3 page CSP blocks inline script"
  );
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "no inline event handlers");
  assert.match(html, /src="options\.js"/, "the controller must load as a separate file");
  assert.match(html, /href="options\.css"/);

  const controller = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");
  assert.ok(!/\bfetch\s*\(/.test(controller), "the options page must not make network calls");
  assert.ok(!/innerHTML/.test(controller), "no HTML injection sink");

  const css = await readFile(path.join(root, "src/extension/options.css"), "utf8");
  assert.ok(
    !/border-radius:\s*(999|9999)px|border-radius:\s*50%/.test(css),
    "no pill backdrops"
  );
  assert.ok(!/backdrop-filter/.test(css), "forced-colors and older engines drop it to nothing");
});

/**
 * The Control Center's section files reach everything through the `PanelContext` they are handed.
 * Calling a shared row helper directly, or touching `options` instead of `ctx.options`, works
 * until the panel needs to intercept one -- draft staging, the coverage tally and the locale
 * repaint all hang off going through the context. That the builders exist with the right
 * signature is already a typecheck failure if it stops being true, so only the bans are here.
 */
test("Control Center section files reach the panel only through their context", async () => {
  const SECTION_FILES = ["advanced.ts", "data.ts", "presets.ts", "reading.ts"];
  const SHARED_HELPERS = [
    "actionRow", "toggleRow", "selectRow", "readonlyRow", "dataRow", "textInputRow",
    "secretInputRow", "integerInputRow", "textareaRow", "surfaceRow", "setStatus", "setStatusCopy",
    "save", "render", "formatCopy", "localizedCopy", "t", "el", "button", "presetIcon"
  ];

  const offenders = [];
  for (const filename of SECTION_FILES) {
    const source = await readFile(
      path.join(root, "src/ui/control-center/sections", filename),
      "utf8"
    );
    for (const helper of SHARED_HELPERS) {
      if (new RegExp(String.raw`(?<![\w.])${helper}\(`).test(source)) {
        offenders.push(`${filename}: calls ${helper}() directly`);
      }
    }
    if (/(?<![\w.])options\s*\./.test(source)) {
      offenders.push(`${filename}: reaches options directly instead of ctx.options`);
    }
  }

  assert.deepEqual(offenders, []);
});

/**
 * A page-level class cannot style a shadow descendant. Rules written that way are inert CSS that
 * reads as working styling, so they are banned rather than tested for -- what the panel actually
 * does under a coarse pointer is measured in tests/panel-appearance-contract.test.mjs.
 */
/**
 * The AI command menu is a local surface: it builds a prompt and puts it on the clipboard. The
 * external call, when the user has configured one, lives in `integrations/ai-provider.ts` behind
 * the disclosure and the local-only policy. A network call reaching the menu module would bypass
 * both, so it is banned outright rather than tested around.
 */
/**
 * X's bird is their trademark, and a lookalike would be no better. Only Aviary's own mark ships,
 * so no X-hosted asset may be referenced from the favicon feature at all.
 */
test("no X-hosted asset is referenced as a favicon option", async () => {
  const source = await readFile(path.join(root, "src/features/appearance/favicon.ts"), "utf8");
  assert.ok(
    !/twitter\.com|abs\.twimg\.com|pbs\.twimg\.com/i.test(source),
    "the favicon feature must not reference an asset hosted by X"
  );
});

test("the AI command menu never reaches the network itself", async () => {
  const menu = await readFile(path.join(root, "src/features/ai/command-menu.ts"), "utf8");
  const reached = [];
  for (const api of ["fetch(", "XMLHttpRequest", "sendBeacon", "EventSource", "WebSocket"]) {
    if (menu.includes(api)) reached.push(api);
  }
  assert.deepEqual(reached, [], "the menu must reach a provider through ai-provider.ts or not at all");
});

test("no stylesheet tries to reach the Control Center through a page-level class", async () => {
  const mobile = await readFile(path.join(root, "src/features/core/mobile-touch.ts"), "utf8");

  // Only the panel's own class names: the AI trigger, snippet popover and hide button live in the
  // light DOM, where a page-level class is exactly the right tool.
  const PANEL_ONLY = "shell|overlay|panel|launcher|nav|content|section|row|searchbar|toggle|transaction|status";
  const dead = [
    ...mobile.matchAll(new RegExp(String.raw`html\.av-(?:touch|mobile)\s+\.av-(?:${PANEL_ONLY})\b[a-z-]*`, "g"))
  ].map((match) => match[0]);

  assert.deepEqual(dead, [], "these selectors cannot cross the shadow boundary");
});

test("MV3 manifests keep permissions narrow", async () => {
  const manifests = [
    "src/extension/manifest.chrome.json",
    "src/extension/manifest.firefox.json"
  ];
  const expectedIcons = {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png"
  };

  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.icons, expectedIcons);
    assert.deepEqual(manifest.action.default_icon, expectedIcons);
    assert.deepEqual(manifest.permissions, [
      "storage",
      "declarativeNetRequestWithHostAccess",
      "contextMenus"
    ]);
    assert.deepEqual(manifest.optional_permissions, ["downloads"]);
    assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
    assert.ok(!JSON.stringify(manifest).includes("tabs"));
    assert.ok(!manifest.permissions.includes("declarativeNetRequestFeedback"));
    assert.ok(!manifest.permissions.includes("webRequest"));
  }

  for (const size of [16, 32, 48, 128, 512]) {
    const icon = await readFile(path.join(root, "src/extension/icons", `icon-${size}.png`));
    assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG", `icon-${size} is not a PNG`);
    assert.equal(icon.readUInt32BE(16), size, `icon-${size} width drifted`);
    assert.equal(icon.readUInt32BE(20), size, `icon-${size} height drifted`);
    assert.equal(icon[25], 6, `icon-${size} must retain RGBA transparency`);
  }
});

test("development dependencies are pinned for reproducible builds", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    assert.ok(!/^[~^*]/.test(version), `${name} must use an exact version`);
  }
});

test("release metadata and removed UI claims stay synchronized", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const [readme, roadmap, changelog, panel] = await Promise.all(
    ["README.md", "ROADMAP.md", "CHANGELOG.md", "src/ui/control-center.ts"].map((relative) =>
      readFile(path.join(root, relative), "utf8")
    )
  );
  const claude = await readFile(path.join(root, "CLAUDE.md"), "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  assert.ok(
    readme.includes("shields.io/badge/version-" + pkg.version + "-"),
    "README version badge is out of sync"
  );
  if (claude) {
    assert.ok(
      claude.includes("**Current version:** " + pkg.version),
      "CLAUDE current version is out of sync"
    );
  }
  assert.ok(
    roadmap.includes("Version: " + String.fromCharCode(96) + pkg.version + String.fromCharCode(96)),
    "ROADMAP version is out of sync"
  );
  assert.ok(changelog.includes("## " + pkg.version + " ("), "CHANGELOG has no current release heading");
  assert.doesNotMatch(readme, /\*\*Sensitive content\*\*\s*[—-]/i);
  assert.doesNotMatch(readme, /insertion(?: into[^)]*)? lands? in a later release/i);
  assert.doesNotMatch(readme, /v1\.5\.0 closes the .*batch/i);
  assert.doesNotMatch(panel, /insertion landing in a later release/i);
  assert.match(panel, /declare const __AVIARY_VERSION__/);
  assert.match(panel, /av-version/);
});

test("no stylesheet uses the font shorthand with an inherited family", async () => {
  // `font: 700 10px/1.2 inherit` is invalid: the shorthand cannot take a CSS-wide keyword as
  // its family, so the whole declaration is dropped and the control falls back to the UA font.
  // Measured before the fix: the Control Center launcher and every nav item rendered Arial
  // 13.33px/400 instead of the declared 13px/600-700 panel type. Buttons do not inherit font,
  // so this silently hit ten declarations across five files.
  const files = await listFiles(path.join(root, "src"), ".ts");
  const offenders = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    source.split("\n").forEach((line, index) => {
      if (/\bfont:\s*[^;]*\binherit\b/.test(line)) {
        offenders.push(`${path.relative(root, file)}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `use font-size/font-weight/line-height longhands with font-family: inherit instead:\n${offenders.join("\n")}`
  );
});
async function listFiles(dir, suffix) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full, suffix)));
    } else if (entry.name.endsWith(suffix)) {
      files.push(full);
    }
  }

  return files;
}

/**
 * A popover surface must state its own closed appearance.
 *
 * The UA hides a closed popover with `[popover]:not(:popover-open) { display: none }`, which is
 * UA-origin and loses to any author `display` on the same element. v1.45.0 shipped the Control
 * Center panel with an author `display: flex` and no closed-state rule, so it painted full-screen
 * on every page load with `inert` keeping it dead to input. This is a ban on that shape: a module
 * that creates a popover must not leave its closed appearance to the UA sheet.
 */
test("every popover surface states its closed appearance", async () => {
  const files = await listFiles(path.join(root, "src"), ".ts");
  const silent = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (!text.includes('setAttribute("popover"')) {
      continue;
    }
    const relative = path.relative(root, file);

    // Per popover surface, not per file: a module can create two and guard only one, which a
    // file-level check waves through. The class is tied to the element by variable name, because
    // that is what says which element actually receives the popover attribute. Both ways this
    // codebase names an element are covered: a direct `className =` and the `el(tag, class)` helper.
    const popoverVars = new Set(
      [...text.matchAll(/(\w+)\.setAttribute\("popover"/g)].map((match) => match[1])
    );
    for (const variable of popoverVars) {
      const assigned =
        new RegExp(`${variable}\\.className = "([\\w -]+)"`).exec(text) ??
        new RegExp(`(?:const|let) ${variable} = el\\(\\s*"[\\w-]+"\\s*,\\s*"([\\w -]+)"`).exec(text);
      assert.ok(
        assigned,
        `${relative}: could not find the class given to the popover element "${variable}"; ` +
          `this contract has to be able to see it to check it`
      );
      for (const className of assigned[1].split(/\s+/).filter(Boolean)) {
        // A class only needs a closed-state rule when the author sheet gives it a `display`: that
        // is what outranks the UA's `[popover]:not(:popover-open) { display: none }`.
        const declaresDisplay = new RegExp(
          `\\.${className}\\s*\\{[^}]*\\bdisplay\\s*:`,
          "s"
        ).test(text);
        if (!declaresDisplay) continue;
        // Either form states the closed appearance: hiding it explicitly, or driving the visible
        // state from `:popover-open` while the base rule is already invisible.
        if (
          !text.includes(`.${className}:not(:popover-open)`) &&
          !text.includes(`.${className}:popover-open`)
        ) {
          silent.push(`${relative} .${className}`);
        }
      }
    }
  }

  assert.deepEqual(
    silent,
    [],
    `these popover surfaces set an author display with no :popover-open rule, so the closed ` +
      `surface stays painted: ${silent.join(", ")}`
  );
});

/**
 * An action row whose handler does not catch must carry its own failure sentence.
 *
 * `actionRow`'s shared rejection boundary reports the real error to diagnostics and shows the
 * caller's `failureMessage`, defaulting to "Action failed." A row that handles its own errors never
 * reaches that boundary, so it does not need one; a row that lets the rejection through does, or
 * the reader gets three words with no cause and no next step for every distinct failure.
 */
test("every action row that can reject says what failed and what to do", async () => {
  const directory = path.join(root, "src/ui/control-center/sections");
  const files = await listFiles(directory, ".ts");
  const silent = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(root, file);

    for (const match of text.matchAll(/ctx\.actionRow\(/g)) {
      // Walk to the matching close paren, counting top-level arguments, so a comma inside a
      // nested call or string cannot be miscounted.
      let index = match.index + match[0].length;
      let depth = 1;
      let args = 1;
      let quote = null;
      while (index < text.length && depth > 0) {
        const char = text[index];
        if (quote) {
          if (char === "\\") index += 1;
          else if (char === quote) quote = null;
        } else if (char === '"' || char === "'" || char === "`") {
          quote = char;
        } else if (char === "(" || char === "[" || char === "{") {
          depth += 1;
        } else if (char === ")" || char === "]" || char === "}") {
          depth -= 1;
          if (depth === 0) break;
        } else if (char === "," && depth === 1) {
          args += 1;
        }
        index += 1;
      }
      const body = text.slice(match.index, index);
      // An actual catch construct -- `catch (error)`, `catch {`, `.catch(...)` -- not the word.
      // Matching the bare word let the "Open catch-up digest" row pass on its own product
      // vocabulary while its handler had no boundary at all and showed "Action failed."
      if (args < 4 && !/\bcatch\s*[({]/.test(body)) {
        silent.push(`${relative}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
  }

  assert.deepEqual(
    silent,
    [],
    `these action rows let a rejection reach the shared boundary with no message of their own, so ` +
      `every failure reads "Action failed.": ${silent.join(", ")}`
  );
});

/**
 * An integer row must enforce the range its own description promises.
 *
 * `integerInputRow` writes its `bounds` argument to the input's `min`/`max`, and `commitDraft`
 * gates on `checkValidity()`. Three rows omitted it while the normalizer clamped a real range, so
 * the panel accepted an out-of-range value, confirmed it, let the features use it for the rest of
 * the session, and let the next reload substitute a different number with nothing said.
 */
test("every integer row whose description states a range enforces it", async () => {
  const directory = path.join(root, "src/ui/control-center/sections");
  const files = await listFiles(directory, ".ts");
  const unbounded = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(root, file);

    for (const match of text.matchAll(/ctx\.integerInputRow\(/g)) {
      let index = match.index + match[0].length;
      let depth = 1;
      let args = 1;
      let quote = null;
      while (index < text.length && depth > 0) {
        const char = text[index];
        if (quote) {
          if (char === "\\") index += 1;
          else if (char === quote) quote = null;
        } else if (char === '"' || char === "'" || char === "`") {
          quote = char;
        } else if (char === "(" || char === "[" || char === "{") {
          depth += 1;
        } else if (char === ")" || char === "]" || char === "}") {
          depth -= 1;
          if (depth === 0) break;
        } else if (char === "," && depth === 1) {
          args += 1;
        }
        index += 1;
      }
      const body = text.slice(match.index, index);
      // A description that states a range in parentheses, or a label in MB, is a promise.
      const promisesRange = /\(\d+-\d+\)/.test(body) || /\(MB\)/.test(body);
      if (promisesRange && args < 5) {
        const label = /"([^"]+)"/.exec(body);
        unbounded.push(`${relative} ${label ? label[1] : "?"}`);
      }
    }
  }

  assert.deepEqual(
    unbounded,
    [],
    `these rows state a range and do not enforce it, so the panel confirms a value the normalizer ` +
      `will silently replace: ${unbounded.join(", ")}`
  );
});

/**
 * A module that raises the shared toast must be able to take it down.
 *
 * `showFeatureToast` mounts a host on `<html>` with a shadow root and a pending dismissal timer,
 * outside anything a feature's own selectors sweep. Two features raised it and never removed it,
 * and only came off because another feature's teardown happened to run later in reverse
 * registration order -- an ordering accident, not a guarantee.
 */
test("every module that shows the shared toast also removes it", async () => {
  const files = await listFiles(path.join(root, "src"), ".ts");
  const orphaned = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (path.basename(file) === "feature-toast.ts") continue;
    if (!text.includes("showFeatureToast(")) continue;
    if (!text.includes("removeFeatureToast(")) {
      orphaned.push(path.relative(root, file));
    }
  }

  assert.deepEqual(
    orphaned,
    [],
    `these modules raise the shared toast with no way to take it down, so it can outlive their ` +
      `own teardown: ${orphaned.join(", ")}`
  );
});

/**
 * The panel's status tone is chosen from the English source string.
 *
 * `setStatus` picks the dot colour by matching the source against /could not|failed|error|invalid/
 * and defaults to the success tone, so a message that is already translated, or that is a raw
 * exception, is scored on the wrong text. A WACZ failure reporting "Quota exceeded" matched none of
 * those words and rendered beside the green dot.
 */
test("no panel status message is pre-translated or a raw exception", async () => {
  const directory = path.join(root, "src/ui/control-center/sections");
  const files = await listFiles(directory, ".ts");
  const offenders = [];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    for (const pattern of [/setStatus\(\s*ctx\.t\(/g, /setStatus\([^)]*\berror\.message\b/g]) {
      for (const match of text.matchAll(pattern)) {
        offenders.push(`${relative}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these status calls hand setStatus something other than the English source, so the tone is ` +
      `chosen from the wrong text: ${offenders.join(", ")}`
  );
});

/**
 * One status line, one voice.
 *
 * `ctx.save(...)` and `ctx.setStatus(...)` both end up in the same element, and they disagreed:
 * setStatus copy ended in a period and save copy did not. The clash was visible inside a single
 * section -- "Snapshots cleared" one click, "Bookmarks cleared." the next -- because which style
 * appeared depended only on which helper the last action happened to use.
 *
 * Sentence form wins, being the majority of the user-visible text. A string ending in a digit, a
 * percent sign or an ellipsis is already finished and needs nothing added.
 */
test("every status string the panel shows is a finished sentence", async () => {
  const directory = path.join(root, "src/ui/control-center/sections");
  const files = await listFiles(directory, ".ts");
  const unfinished = [];

  // A template literal that ends in an interpolation is completed by the value, not by the source.
  const finished = (value, quote) =>
    /[.…%!?:]$/.test(value.trimEnd()) ||
    /\d$/.test(value.trimEnd()) ||
    (quote === "`" && value.trimEnd().endsWith("}"));

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const relative = path.relative(root, file);

    for (const match of text.matchAll(/\bctx\.(save|setStatus)\(/g)) {
      let index = match.index + match[0].length;
      let depth = 1;
      const args = [];
      while (index < text.length && depth > 0) {
        const char = text[index];
        if (char === '"' || char === "'" || char === "`") {
          const quote = char;
          let value = "";
          index += 1;
          while (index < text.length && text[index] !== quote) {
            if (text[index] === "\\") {
              value += text[index + 1] === "n" ? "\n" : text[index + 1];
              index += 2;
              continue;
            }
            value += text[index];
            index += 1;
          }
          args.push({ value, quote });
        } else if (char === "(" || char === "[" || char === "{") {
          depth += 1;
        } else if (char === ")" || char === "]" || char === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        index += 1;
      }

      const line = text.slice(0, match.index).split("\n").length;
      for (const { value, quote } of args) {
        if (value.trim().length === 0) continue;
        if (finished(value, quote)) continue;
        unfinished.push(`${relative}:${line} ${JSON.stringify(value)}`);
      }
    }
  }

  assert.deepEqual(
    unfinished,
    [],
    `these status strings do not end a sentence, so the panel's status line alternates styles ` +
      `depending on which action ran last: ${unfinished.join(", ")}`
  );
});
