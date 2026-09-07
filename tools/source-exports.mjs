import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Finds exported names in `src/` that nothing anywhere in the repository refers to.
 *
 * The repository exports deliberately so tests can import a unit directly, which means an
 * `export` keyword is not evidence that anything uses the thing it is attached to. TypeScript
 * will not say so either: an exported declaration is reachable by definition, so `noUnusedLocals`
 * never sees it. The result was fifteen abandoned entry points that read as supported API.
 *
 * A symbol counts as referenced when its name appears, on a word boundary, anywhere in `src/`,
 * `tests/`, or `tools/` on a line that is not itself a declaration or an export of that name.
 * That deliberately over-counts -- a name mentioned in a comment is enough -- because the cost of
 * a false positive here is a broken build for something that is actually in use, while the cost of
 * a false negative is one more pass finding it later.
 *
 * The known consequence of over-counting: a function whose only caller is itself reads as
 * referenced. Closing that needs a call graph, which is a different tool; it is written down here
 * rather than left for someone to discover as a surprise.
 *
 * Three earlier holes are closed by that phrasing and by `exportedNames` below, and each one had a
 * live example in `src/`:
 *
 *   - `export { X }` with `X` declared on an earlier line always looked referenced, because only
 *     the export line was skipped and the declaration line counted as a use of itself.
 *   - Two dead exports of the same name in different files cleared each other. Eight names are
 *     shared between `i18n.ts` and `i18n-runtime.ts` alone.
 *   - `export type { X }`, a multi-line export list, and a multi-declarator `export const a, b`
 *     were not recognised as exports at all. `src/ui/control-center.ts` has the first of those.
 *
 * Five shapes are refused rather than analysed: `export default` and `export * from` name nothing
 * at the definition site, a destructured `export const { a }` binds through a pattern, an
 * `export namespace` is not a value binding, and an `export const` whose name is on the next line
 * is not on the line these patterns are anchored to. Refusing them keeps the gate from quietly
 * having a blind spot -- each one previously bound nothing and was silently dropped, so an export
 * written that way could rot to nothing with preflight green.
 */

const SCAN_ROOTS = [
  { directory: "src", suffixes: [".ts"] },
  { directory: "tests", suffixes: [".ts", ".mjs"] },
  { directory: "tools", suffixes: [".mjs"] }
];

const KEYWORDS = String.raw`(?:function\*?|const\s+enum|const|let|var|class|interface|type|enum)`;
const MODIFIERS = String.raw`(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?`;
const EXPORTED_DECLARATION = new RegExp(String.raw`^\s*export\s+${MODIFIERS}${KEYWORDS}\s+(.*)$`);
const LOCAL_DECLARATION = new RegExp(String.raw`^\s*(?:export\s+)?${MODIFIERS}${KEYWORDS}\s+(.*)$`);
const EXPORT_LIST_OPEN = /^\s*export\s+(?:type\s+)?\{/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Walks a directory for the file suffixes that carry source. */
async function collect(directory, suffixes) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const next = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collect(next, suffixes)));
    } else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) {
      found.push(next);
    }
  }
  return found;
}

/**
 * The names a `{ a, b as c, type D }` list binds, after `export` or after a declaration keyword.
 * A rename binds the new name; a `type` modifier binds the name beside it.
 */
function namesInList(body) {
  const names = [];
  for (const part of body.split(",")) {
    const trimmed = part.trim().replace(/^type\s+/, "");
    if (!trimmed) continue;
    const renamed = /\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(trimmed);
    const name = renamed ? renamed[1] : trimmed;
    if (IDENTIFIER.test(name)) names.push(name);
  }
  return names;
}

/**
 * The names a declaration's right-hand side binds: `a = 1, b = 2` binds both.
 *
 * Split on top-level commas first, then take the identifier that opens each piece. Reading left to
 * right and stopping at the first `=` looked simpler and was wrong: the initialiser was still
 * collected as a final piece, so `const audience = audienceOf(record)` recorded `audienceOf` as a
 * declaration, and the line that actually used it was then skipped as a declaration of itself.
 * Five live functions were reported dead that way.
 *
 * Angle brackets are not counted as nesting. They are ambiguous -- `=>` would close a depth that
 * was never opened -- and the commas inside a generic argument list are already inside the
 * parentheses or braces that surround them.
 */
function namesInDeclarators(body) {
  const pieces = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth -= 1;
    if (character === "," && depth <= 0) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  pieces.push(current);
  return pieces
    .map((piece) => /^\s*([A-Za-z_$][\w$]*)/.exec(piece)?.[1])
    .filter((value) => value !== undefined && IDENTIFIER.test(value));
}

/**
 * Every name a file exports, plus every line that declares or exports one.
 *
 * Returns `{ exports, declarationLines, refusals }`. `declarationLines` maps a name to the line
 * indexes in this file that declare or export it, which is what stops a declaration from counting
 * as a reference to itself.
 */
export function exportedNames(lines) {
  const exports = [];
  const declarationLines = new Map();
  const refusals = [];

  const note = (name, index) => {
    const existing = declarationLines.get(name);
    if (existing) existing.add(index);
    else declarationLines.set(name, new Set([index]));
  };

  let listOpenIndex = -1;
  let listBody = "";

  lines.forEach((line, index) => {
    // A multi-line export list is one statement spread over several lines; the old single-line
    // pattern saw the opening brace and nothing else.
    if (listOpenIndex >= 0) {
      const close = line.indexOf("}");
      listBody += close >= 0 ? line.slice(0, close) : line;
      note("", index);
      for (const name of namesInList(close >= 0 ? listBody : line)) note(name, index);
      if (close >= 0) {
        for (const name of namesInList(listBody)) {
          exports.push({ name, line: listOpenIndex });
          note(name, listOpenIndex);
        }
        listOpenIndex = -1;
        listBody = "";
      }
      return;
    }

    if (/^\s*export\s+\*/.test(line)) {
      refusals.push({ line: index, reason: "`export *` re-exports names this scan cannot check" });
      return;
    }
    if (/^\s*export\s+default\b/.test(line)) {
      refusals.push({ line: index, reason: "`export default` has no name at the definition site" });
      return;
    }
    // A destructured export binds names through a pattern rather than after a keyword, and
    // `namesInDeclarators` reads the identifier that opens each piece -- which for `{ a }` or
    // `[ a ]` is a brace. It used to fall through and bind nothing at all, so an export written
    // that way could rot to nothing with the gate green. Refused rather than half-parsed.
    if (/^\s*export\s+(?:declare\s+)?(?:const|let|var)\s*[[{]/.test(line)) {
      refusals.push({ line: index, reason: "a destructured export binds names this scan cannot read" });
      return;
    }
    if (/^\s*export\s+namespace\b/.test(line)) {
      refusals.push({ line: index, reason: "`export namespace` is not a shape this scan reads" });
      return;
    }
    // `export const` with the name on the next line. The declaration patterns are anchored to one
    // line, so this bound nothing; it is rare enough to refuse rather than to parse.
    if (/^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const\s+enum|const|let|var|class|interface|type|enum)\s*$/.test(line)) {
      refusals.push({ line: index, reason: "an export whose name is on the next line is not read by this scan" });
      return;
    }

    if (EXPORT_LIST_OPEN.test(line)) {
      const open = line.indexOf("{");
      const close = line.indexOf("}", open);
      if (close >= 0) {
        for (const name of namesInList(line.slice(open + 1, close))) {
          exports.push({ name, line: index });
          note(name, index);
        }
      } else {
        listOpenIndex = index;
        listBody = line.slice(open + 1);
      }
      return;
    }

    const exported = EXPORTED_DECLARATION.exec(line);
    if (exported) {
      for (const name of namesInDeclarators(exported[1])) {
        exports.push({ name, line: index });
        note(name, index);
      }
      return;
    }

    // Not exported, but still a declaration: its line must not count as a use of the name.
    const local = LOCAL_DECLARATION.exec(line);
    if (local) {
      for (const name of namesInDeclarators(local[1])) note(name, index);
    }
  });

  return { exports, declarationLines, refusals };
}

/**
 * Reports the reference graph for `src/` exports.
 *
 * `overrides` replaces a file's text without touching the working tree, so a test can plant an
 * unreferenced export and watch the gate fail without writing to `src/`.
 */
export async function sourceExportReferences(root, overrides = new Map()) {
  const files = [];
  for (const { directory, suffixes } of SCAN_ROOTS) {
    files.push(...(await collect(path.join(root, directory), suffixes)));
  }
  const relativeOf = (file) => path.relative(root, file).replace(/\\/g, "/");

  const lines = new Map();
  for (const file of files) {
    const relative = relativeOf(file);
    const text = overrides.has(relative) ? overrides.get(relative) : await readFile(file, "utf8");
    lines.set(relative, text.split(/\r?\n/));
  }
  for (const [relative, text] of overrides) {
    if (!lines.has(relative)) lines.set(relative, text.split(/\r?\n/));
  }

  // Parse every scanned file, not only `src/`: a declaration of the same name in a test or a tool
  // is not a reference to the exported one either.
  const parsed = new Map();
  for (const [relative, body] of lines) parsed.set(relative, exportedNames(body));

  const sourceFiles = [...lines.keys()].filter((relative) => relative.startsWith("src/")).sort();
  const declarations = [];
  const refused = [];
  for (const relative of sourceFiles) {
    for (const found of parsed.get(relative).exports) {
      declarations.push({ file: relative, ...found });
    }
    for (const refusal of parsed.get(relative).refusals) {
      refused.push({ file: relative, ...refusal });
    }
  }

  const unreferenced = [];
  for (const declaration of declarations) {
    const pattern = new RegExp(
      String.raw`\b` + declaration.name.replace(/\$/g, String.raw`\$`) + String.raw`\b`
    );
    let referenced = false;
    for (const [relative, body] of lines) {
      // Skip every line anywhere that declares or exports this name. Two dead exports sharing a
      // name used to clear each other, and a list-form export was cleared by its own declaration.
      const skip = parsed.get(relative).declarationLines.get(declaration.name);
      for (let index = 0; index < body.length; index += 1) {
        if (skip?.has(index)) continue;
        if (pattern.test(body[index])) {
          referenced = true;
          break;
        }
      }
      if (referenced) break;
    }
    if (!referenced) unreferenced.push(declaration);
  }

  return {
    exportCount: declarations.length,
    sourceFileCount: sourceFiles.length,
    unreferenced,
    refused
  };
}
