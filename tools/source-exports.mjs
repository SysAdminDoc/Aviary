import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Finds exported names in `src/` that nothing anywhere in the repository refers to.
 *
 * The repository exports deliberately so tests can import a unit directly, which means an
 * `export` keyword is not evidence that anything uses the thing it is attached to. TypeScript
 * will not say so either: an exported declaration is reachable by definition, so `noUnusedLocals`
 * never sees it. The result was nine abandoned entry points that read as supported API.
 *
 * A symbol counts as referenced when its name appears, on a word boundary, anywhere in `src/`,
 * `tests/`, or `tools/` other than on the line that exports it. That deliberately over-counts --
 * a name mentioned in a comment is enough -- because the cost of a false positive here is a
 * broken build for something that is actually in use, while the cost of a false negative is one
 * more pass finding it later.
 */

const SCAN_ROOTS = [
  { directory: "src", suffixes: [".ts"] },
  { directory: "tests", suffixes: [".ts", ".mjs"] },
  { directory: "tools", suffixes: [".mjs"] }
];

const DECLARATION = new RegExp(
  String.raw`^\s*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?` +
    String.raw`(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)`
);
const NAME_LIST = /^\s*export\s*\{([^}]*)\}/;
const RENAME = /\s+as\s+([A-Za-z_$][\w$]*)\s*$/;
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

/** Every name a file exports, with the line the export sits on. */
export function exportedNames(lines) {
  const names = [];
  lines.forEach((line, index) => {
    const declared = DECLARATION.exec(line);
    if (declared) {
      names.push({ name: declared[1], line: index });
      return;
    }
    const listed = NAME_LIST.exec(line);
    if (!listed) return;
    for (const part of listed[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const renamed = RENAME.exec(trimmed);
      const name = renamed ? renamed[1] : trimmed;
      if (IDENTIFIER.test(name)) names.push({ name, line: index });
    }
  });
  return names;
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

  const sourceFiles = [...lines.keys()].filter((relative) => relative.startsWith("src/")).sort();
  const declarations = [];
  for (const relative of sourceFiles) {
    for (const found of exportedNames(lines.get(relative))) {
      declarations.push({ file: relative, ...found });
    }
  }

  const unreferenced = [];
  for (const declaration of declarations) {
    const pattern = new RegExp(
      String.raw`\b` + declaration.name.replace(/\$/g, String.raw`\$`) + String.raw`\b`
    );
    let referenced = false;
    for (const [relative, body] of lines) {
      for (let index = 0; index < body.length; index += 1) {
        if (relative === declaration.file && index === declaration.line) continue;
        if (pattern.test(body[index])) {
          referenced = true;
          break;
        }
      }
      if (referenced) break;
    }
    if (!referenced) unreferenced.push(declaration);
  }

  return { exportCount: declarations.length, sourceFileCount: sourceFiles.length, unreferenced };
}
