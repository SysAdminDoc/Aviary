// Generates the settings reference in docs/FAQ.md from the Control Center source, and checks that
// the two agree.
//
// The docs gate used to assert only that PRIVACY.md and INSTALL.md carried the current version
// string, so a version bump passed while the prose rotted: by v1.23.0, README and FAQ mentioned
// none of the features added in v1.22.0 or v1.23.0. Enumerating the panel's own rows is the only
// list that cannot drift from what the user actually sees, because it is read out of the code that
// draws them.
//
//   npm run docs:settings          rewrite the block
//   npm run docs:settings -- --check   fail if it is out of date (what CI and the suite run)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SECTION_FILES = [
  "src/ui/control-center/sections/reading.ts",
  "src/ui/control-center/sections/data.ts",
  "src/ui/control-center/sections/advanced.ts",
  "src/ui/control-center/sections/presets.ts"
];

export const START_MARKER = "<!-- settings-reference:start -->";
export const END_MARKER = "<!-- settings-reference:end -->";

/**
 * The panel's own page names. An explicit map rather than a de-camel-casing rule, because the rule
 * turned buildAppearanceRows into "Appearances" and cannot know that buildHiddenPostRows is plural.
 * A page added without an entry here fails rather than being quietly left out of the reference.
 */
const PAGE_TITLES = {
  buildAppearanceRows: "Appearance",
  buildLayoutRows: "Layout",
  buildPerformanceRows: "Performance",
  buildFilterRows: "Filtering",
  buildHiddenPostRows: "Hidden posts",
  buildMediaRows: "Media",
  buildExportRows: "Export",
  buildLibraryRows: "Library",
  buildSnapshotRows: "Snapshots",
  buildBackupRows: "Backup",
  buildIntegrationRows: "Integrations",
  buildTrustRows: "Trust",
  buildPresetRows: "Presets"
};

function pageTitle(fnName) {
  const title = PAGE_TITLES[fnName];
  if (!title) {
    throw new Error(`${fnName} has no entry in PAGE_TITLES — add it so the reference stays complete`);
  }
  return title;
}

/**
 * Reads the first two string arguments of every row helper call, attributed to the page function
 * that contains it. Deliberately a source read rather than a render: the render needs a DOM and a
 * full settings object, and this only needs the copy.
 */
export async function collectRows() {
  const pages = [];
  for (const file of SECTION_FILES) {
    const source = await readFile(path.join(root, file), "utf8");
    const bounds = [...source.matchAll(/export function (build\w+Rows)\s*\(/g)].map((match) => ({
      name: match[1],
      start: match.index
    }));
    for (const [index, bound] of bounds.entries()) {
      const end = index + 1 < bounds.length ? bounds[index + 1].start : source.length;
      const body = source.slice(bound.start, end);
      const rows = [];
      // toggleRow and textareaRow are (label, description, ...). selectRow is (label, value,
      // choices, ...) and carries no description, so its choices are what the reference can
      // honestly show. Matching only the label first is what stopped nine select rows from being
      // silently dropped by a pattern that demanded two adjacent strings.
      const call = /\b(toggleRow|selectRow|textareaRow)\(\s*\n?\s*"((?:[^"\\]|\\.)+)"\s*,/g;
      for (const match of body.matchAll(call)) {
        const label = unescape(match[2]);
        const callEnd = closingCallIndex(body, match.index);
        const rest = body.slice(match.index + match[0].length, callEnd);
        if (match[1] === "selectRow") {
          const choices = [...rest.matchAll(/\[\s*"[^"]*"\s*,\s*"([^"]+)"\s*\]/g)].map((choice) =>
            unescape(choice[1])
          );
          rows.push({
            at: match.index,
            label,
            description: choices.length > 0 ? `Choose one: ${choices.join(", ")}.` : "A choice control."
          });
          continue;
        }
        const description = rest.match(/^\s*\n?\s*"((?:[^"\\]|\\.)*)"/);
        rows.push({ at: match.index, label, description: description ? unescape(description[1]) : "" });
      }
      // Array-backed row definitions keep repetitive controls compact in the source. Expand the
      // stable label and description tuple here so the generated reference still lists every row.
      if (body.includes("const cssRows")) {
        const cssRowsStart = body.indexOf("const cssRows");
        const cssRowsBody = body.slice(cssRowsStart, body.indexOf("];", cssRowsStart) + 2);
        for (const match of cssRowsBody.matchAll(/\[\s*"(?:[^"\\]|\\.)+"\s*,\s*"((?:[^"\\]|\\.)+)"\s*,\s*"((?:[^"\\]|\\.)+)"\s*\]/g)) {
          rows.push({
            at: cssRowsStart + match.index,
            label: unescape(match[1]),
            description: unescape(match[2])
          });
        }
      }
      // A few dense tools use several controls inside one custom row. Their stable accessible
      // label and first distinct translated sentence are still enough to keep the reference
      // complete without pretending every button is a separate setting.
      for (const match of body.matchAll(/\.dataset\.avLabel\s*=\s*"((?:[^"\\]|\\.)+)"/g)) {
        const label = unescape(match[1]);
        const rowEnd = body.indexOf("return row;", match.index);
        const rowBody = body.slice(match.index, rowEnd === -1 ? body.length : rowEnd);
        const copy = [...rowBody.matchAll(/\bctx\.t\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)].map((item) =>
          unescape(item[1])
        );
        rows.push({ at: match.index, label, description: copy.find((value) => value !== label) ?? "" });
      }
      if (rows.length > 0) {
        pages.push({
          page: pageTitle(bound.name),
          file,
          rows: rows.sort((left, right) => left.at - right.at).map(({ at: _at, ...row }) => row)
        });
      }
    }
  }
  return pages;
}

/** Finds the matching close parenthesis without letting the following row donate its choices. */
function closingCallIndex(source, callStart) {
  const open = source.indexOf("(", callStart);
  if (open === -1) return source.length;
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index++) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")" && --depth === 0) return index;
  }
  return source.length;
}

function unescape(value) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeCell(value) {
  return value.replace(/ [—–] /g, ", ").replace(/\|/g, "\\|");
}

export function renderReference(pages) {
  const lines = [
    START_MARKER,
    "",
    "<!-- Generated by tools/settings-reference.mjs from the Control Center source.",
    "     Run `npm run docs:settings` after adding or renaming a control. -->",
    "",
    `Every control Aviary offers, by Control Center page. ${pages.reduce((total, page) => total + page.rows.length, 0)} controls across ${pages.length} pages.`,
    ""
  ];
  for (const page of pages) {
    lines.push(`#### ${page.page}`, "", "| Control | What it does |", "| --- | --- |");
    for (const row of page.rows) {
      lines.push(`| ${escapeCell(row.label)} | ${escapeCell(row.description)} |`);
    }
    lines.push("");
  }
  lines.push(END_MARKER);
  return lines.join("\n");
}

export async function readFaq() {
  return readFile(path.join(root, "docs", "FAQ.md"), "utf8");
}

export function spliceReference(faq, block) {
  const start = faq.indexOf(START_MARKER);
  const end = faq.indexOf(END_MARKER);
  if (start === -1 || end === -1) {
    throw new Error(`docs/FAQ.md is missing the ${START_MARKER} / ${END_MARKER} pair`);
  }
  return faq.slice(0, start) + block + faq.slice(end + END_MARKER.length);
}

export async function currentReference() {
  return renderReference(await collectRows());
}

async function main() {
  const check = process.argv.includes("--check");
  const block = await currentReference();
  const faq = await readFaq();
  const updated = spliceReference(faq, block);
  if (check) {
    if (updated !== faq) {
      console.error("docs/FAQ.md settings reference is out of date — run `npm run docs:settings`.");
      process.exit(1);
    }
    console.log("Settings reference is in sync.");
    return;
  }
  await writeFile(path.join(root, "docs", "FAQ.md"), updated, "utf8");
  console.log(`Settings reference rewritten (${block.split("\n").length} lines).`);
}

if (process.argv[1]?.endsWith("settings-reference.mjs")) {
  await main();
}
