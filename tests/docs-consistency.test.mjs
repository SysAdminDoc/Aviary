import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { collectRows, currentReference, readFaq } from "../tools/settings-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("privacy, install, and FAQ docs match the current release surface", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const [privacy, install, faq] = await Promise.all([
    readFile(path.join(root, "docs/PRIVACY.md"), "utf8"),
    readFile(path.join(root, "docs/INSTALL.md"), "utf8"),
    readFile(path.join(root, "docs/FAQ.md"), "utf8")
  ]);
  const docs = `${privacy}\n${install}\n${faq}`;

  assert.match(privacy, new RegExp(`release ${pkg.version.replaceAll(".", "\\.")}`));
  assert.match(install, new RegExp(`Aviary ${pkg.version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(docs, /\bv0\.(3|9)\.0\b/i);
  assert.doesNotMatch(docs, /XLSX is queued for v0\.10/i);
  assert.doesNotMatch(docs, /optional permissions are not requested or used/i);
  assert.doesNotMatch(docs, /the only outbound traffic Aviary triggers is fetching image/i);

  // Read from the exported list rather than regexed out of the file that declares it: a key
  // added in a differently-indented block, or built from a template literal, would be silently
  // missed by the pattern and its absence from the privacy manifest would go unnoticed.
  const { DURABLE_STORAGE_KEYS } = await importBundledModule("src/platform/durable-storage.ts");
  assert.ok(DURABLE_STORAGE_KEYS.length > 0, "the durable key list is empty");
  for (const key of DURABLE_STORAGE_KEYS) {
    assert.ok(privacy.includes(key), `privacy docs omit durable key ${key}`);
  }

  for (const phrase of [
    "aviary.durable.v1",
    "aviary.archive.imports.v1",
    "aviary.archive.library.v1",
    "aviary.media.queue.v1",
    "aviary.semanticIndex.v1",
    "downloads",
    "pbs.twimg.com",
    "video.twimg.com",
    "options page"
  ]) {
    assert.match(privacy.toLowerCase(), new RegExp(phrase.toLowerCase().replaceAll(".", "\\.")));
  }

  for (const phrase of ["Aria2", "Bluesky", "Mastodon", "AI provider", "Semantic search", "XLSX", "WARC"]) {
    assert.match(faq, new RegExp(phrase.replaceAll(" ", "\\s+"), "i"));
  }
});

// The gate above checks version strings, which is why README and FAQ could reach v1.23.0 without
// mentioning a single feature added in v1.22.0 or v1.23.0. These bind the docs to the panel itself.

test("the FAQ settings reference lists every control the Control Center draws", async () => {
  const faq = await readFaq();
  const expected = await currentReference();
  assert.ok(faq.includes(expected), "docs/FAQ.md settings reference is stale — run `npm run docs:settings`");

  const pages = await collectRows();
  const total = pages.reduce((count, page) => count + page.rows.length, 0);
  assert.ok(total >= 60, `expected the panel's full control set, collected only ${total}`);
  for (const page of pages) {
    for (const row of page.rows) {
      assert.ok(
        faq.includes(`| ${row.label.replaceAll("|", "\|")} |`),
        `control "${row.label}" (${page.page}) is missing from the FAQ reference`
      );
    }
  }
});

test("README defers release detail to CHANGELOG instead of restating it", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

  assert.ok(readme.includes(`version-${pkg.version}-`), "the README badge must name the current version");
  // The rot this replaces: a hand-written "the latest batch adds ..." list that stayed on the
  // v1.18 batch through three releases while claiming to describe the current one.
  assert.doesNotMatch(readme, /the latest batch\s+adds/i);
  const roadmapSection = readme.slice(readme.indexOf("## Roadmap"));
  assert.match(roadmapSection, /CHANGELOG\.md/, "the Roadmap section must point at the changelog");
});

test("the archived design boards for the page system are still on disk", async () => {
  // Archived 2026-08-14: these depict the retired four-section IA and stay as the generated
  // design reference for the page system, just not beside the current mockups. A truncated or
  // placeholder file would leave the reference silently gone.
  for (const board of [
    "control-center-presets.png",
    "control-center-reading.png",
    "control-center-data.png",
    "control-center-advanced.png"
  ]) {
    const image = await readFile(path.join(root, "docs", "mockups", "archive-pre-2026-08-13", board));
    assert.ok(image.length > 100_000, `${board} is ${image.length} bytes — the reference is gone`);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${board} is not a PNG`);
  }
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-docs-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
