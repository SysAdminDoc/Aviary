import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXCLUDED_SOURCE_PATHS,
  ignoredPaths,
  isExcludedSourcePath,
  zipEntryNames
} from "../tools/source-archive.mjs";

/**
 * `dist/aviary-source-v<version>.zip` is published beside the installable packages, and v1.48.1
 * shipped `CLAUDE.md` inside it. The build's file walk skipped a fixed list of directories and
 * never asked `.gitignore`, so the private working notes travelled with the release, along with a
 * generated `tools/i18n-manifest.json`.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("git's ignore rules decide what may travel in the source archive", () => {
  // A list mixing real source with a file this repository really does ignore. The clean half is
  // the control: a check that answered "ignored" for everything would satisfy the other half.
  const answer = ignoredPaths(root, ["src/main.ts", "package.json", "CLAUDE.md"]);
  assert.equal(answer.checked, true, "git must be reachable from the repository itself");
  assert.deepEqual(answer.ignored, ["CLAUDE.md"]);

  const clean = ignoredPaths(root, ["src/main.ts", "package.json"]);
  assert.equal(clean.checked, true);
  assert.deepEqual(clean.ignored, [], "check-ignore exits 1 when nothing matches, which is not an error");
});

test("the declared floor refuses what is never source, with or without git", () => {
  assert.ok(EXCLUDED_SOURCE_PATHS.includes("CLAUDE.md"));
  assert.equal(isExcludedSourcePath("CLAUDE.md"), true);
  assert.equal(isExcludedSourcePath(".claude/settings.json"), true, "a declared directory covers what is under it");
  assert.equal(isExcludedSourcePath(".claude"), true);
  assert.equal(isExcludedSourcePath("aviary-downloads/clip.mp4"), true);
  assert.equal(isExcludedSourcePath("assets/concepts/review/originals/source.zip.001.part"), true);
  assert.equal(isExcludedSourcePath("tools/i18n-manifest.json"), true);
  assert.equal(isExcludedSourcePath("src/main.ts"), false);
  assert.equal(isExcludedSourcePath("docs/CLAUDE.md"), false, "the rule is a path, not a filename anywhere");
});

test("nothing git ignores is still tracked, dependencies most of all", () => {
  // `.gitignore` listed `node_modules/` with a paragraph explaining why a public repository has no
  // business vendoring 3,227 files of ESLint, TypeScript and Playwright -- and all 3,227 stayed in
  // the tree anyway, because an ignore rule says nothing about what is already tracked. A comment
  // is not a guard. This asks the index.
  //
  // `ignoredPaths` is the wrong instrument for this question and answers it vacuously: plain
  // `git check-ignore` consults the index, so it never calls a tracked path ignored, which is
  // right for the walked working-tree paths the archive asks it about and useless here.
  // `ls-files --cached --ignored` asks the question directly.
  const trackedAndIgnored = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--ignored", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  )
    .split("\0")
    .filter(Boolean);

  // The control: the query has to be able to see the tree at all.
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })
    .split("\0")
    .filter(Boolean);
  assert.ok(tracked.length > 100, `expected the tracked tree, saw ${tracked.length} paths`);

  assert.deepEqual(
    trackedAndIgnored,
    [],
    "a tracked path matches an ignore rule; `git rm -r --cached` it rather than widening the rule"
  );
});

test("a malformed central directory throws instead of reporting a short, clean listing", () => {
  assert.throws(() => zipEntryNames(new Uint8Array(64)), /no end-of-central-directory record/);

  // One entry promised, none written: a reader that returned what it found would report an empty
  // archive, and an empty archive passes every contents check there is.
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, 1, true);
  view.setUint32(16, 0, true);
  assert.throws(() => zipEntryNames(bytes), /central directory entry 0 is malformed/);
});

test("the built source archive carries checkout inputs and nothing git ignores", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const archive = path.join(root, "dist", `aviary-source-v${pkg.version}.zip`);
  let bytes;
  try {
    bytes = new Uint8Array(await readFile(archive));
  } catch {
    // A fresh clone has no dist/ until `npm run build`; preflight gates the same property there.
    return;
  }

  const names = zipEntryNames(bytes);
  assert.ok(names.includes("src/main.ts"), "the archive must still carry the source it exists for");
  assert.ok(names.includes("package.json"));
  for (const size of [16, 32, 48, 128, 512]) {
    assert.ok(names.includes(`src/extension/icons/icon-${size}.png`),
      `the source download must include the ${size}px extension icon needed by a clean build`);
  }

  const { checked, ignored } = ignoredPaths(root, names);
  assert.equal(checked, true);
  assert.deepEqual(ignored, [], `the published archive ships ignored files: ${ignored.join(", ")}`);
  for (const name of names) {
    assert.equal(isExcludedSourcePath(name), false, `the published archive ships ${name}`);
  }
});

/**
 * `git check-ignore` C-quotes any path outside ASCII unless it is asked not to.
 *
 * Without `-z` the ignored path came back as `"docs/notas-caf\303\251.md"`, which matches nothing
 * the build walked, so the file was packed anyway and the gate then refused the archive naming a
 * path that does not exist. Rebuilding could never clear it. `aviary-downloads/` is gitignored,
 * sits at the repository root outside the walk's skip list, and holds media named from post
 * titles, so a non-ASCII name there is ordinary rather than exotic.
 */
test("a gitignored path outside ASCII comes back as the path that was asked about", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-ignore-"));
  try {
    await mkdir(path.join(temp, "media"), { recursive: true });
    await writeFile(path.join(temp, ".gitignore"), "media/\n", "utf8");
    await writeFile(path.join(temp, "media", "notas-café.mp4"), "x", "utf8");
    await writeFile(path.join(temp, "src.ts"), "x", "utf8");
    execFileSync("git", ["init", "-q", "."], { cwd: temp, stdio: "ignore" });

    const asked = ["src.ts", "media/notas-café.mp4", ".gitignore"];
    const { checked, ignored } = ignoredPaths(temp, asked);
    assert.equal(checked, true);
    assert.deepEqual(ignored, ["media/notas-café.mp4"]);

    const excluded = new Set(ignored);
    assert.deepEqual(
      asked.filter((name) => !excluded.has(name)),
      ["src.ts", ".gitignore"],
      "the build's Set lookup only excludes a path git names exactly"
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a directory that is not a repository is reported as unanswered, not as clean", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-norepo-"));
  try {
    const { checked, ignored } = ignoredPaths(temp, ["CLAUDE.md", "src.ts"]);
    assert.equal(checked, false, "an unanswered check must not look like a clean one");
    assert.deepEqual(ignored, []);
    // Which is why the floor is applied whether or not git answered.
    assert.equal(isExcludedSourcePath("CLAUDE.md"), true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
