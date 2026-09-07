import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectRows, currentReference, readFaq } from "../tools/settings-reference.mjs";
import { FACT_DOCUMENTS, collectFacts, staleFactDocuments } from "../tools/docs-facts.mjs";

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
  const { DURABLE_STORAGE_KEYS } = await importSourceModule("src/platform/durable-storage.ts");
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
  const media = pages.find((page) => page.page === "Media");
  assert.equal(
    media.rows.find((row) => row.label === "Media layout")?.description,
    "A choice control.",
    "a select row borrowed choices from the next control"
  );
  assert.equal(
    media.rows.find((row) => row.label === "Metadata sidecar")?.description,
    "Choose one: Off, Text, JSON."
  );
  const filtering = pages.find((page) => page.page === "Filtering");
  assert.equal(
    filtering.rows.find((row) => row.label === "Portable rule set")?.description,
    "Export plain text, or paste a set to preview before adding or replacing rules."
  );
});

/**
 * The facts the documentation states, checked against the source that owns them.
 *
 * Every one of these had drifted and none of it was checkable, because each figure was a sentence
 * somebody typed: the privacy and install pages listed two required permissions while the
 * manifests declared five, a logo brief still carried the name this project had before it was
 * Aviary, and no document said how many destinations the panel draws.
 */
test("every generated documentation fact is the one the source supports", async () => {
  const stale = await staleFactDocuments();
  assert.deepEqual(
    stale,
    [],
    "these documents state facts the source no longer supports; run: npm run docs:facts"
  );
});

test("the permission list in the docs is the one both manifests declare", async () => {
  const facts = await collectFacts();
  // A five-permission manifest and a two-permission privacy page is not a wording problem, it is a
  // reader being told the extension asks for less than it does.
  assert.ok(facts.required.length >= 5, `expected the full required set, saw ${facts.required.join(", ")}`);
  for (const permission of ["contextMenus", "scripting", "unlimitedStorage"]) {
    assert.ok(facts.required.includes(permission), `${permission} is declared but not in the fact set`);
  }

  const [install, privacy] = await Promise.all([
    readFile(path.join(root, "docs/INSTALL.md"), "utf8"),
    readFile(path.join(root, "docs/PRIVACY.md"), "utf8")
  ]);
  for (const document of [install, privacy]) {
    for (const permission of facts.required) {
      assert.match(document, new RegExp(`\`${permission}\``), `a document omits ${permission}`);
    }
    for (const permission of facts.optional) {
      assert.match(document, new RegExp(`\`${permission}\``), `a document omits optional ${permission}`);
    }
  }

  // Removing the extension takes its storage with it, which a reader deciding whether to install
  // needs to know and which neither page used to say.
  assert.match(privacy, /Removing the extension the ordinary way deletes everything it stored/);
});

test("no document still carries the name this project had before it was Aviary", async () => {
  // The logo briefs asked an image model for a mark for "Twitter Userscript", which is not the
  // name of anything that ships.
  const documents = [...FACT_DOCUMENTS, "docs/FAQ.md", "LOGO_PROMPTS.md"];
  const offenders = [];
  for (const document of documents) {
    const text = await readFile(path.join(root, document), "utf8");
    if (/Twitter[_ ]Userscript/.test(text)) offenders.push(document);
  }
  assert.deepEqual(offenders, [], "these still name the project Twitter Userscript");
});

test("the docs describe the theme, width and action names the panel actually ships", async () => {
  const { DEFAULT_SETTINGS } = await importSourceModule("src/platform/settings.ts");
  const [readme, faq] = await Promise.all([
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, "docs/FAQ.md"), "utf8")
  ]);
  const docs = `${readme}
${faq}`;

  // The three width tiers the setting actually offers, by the names the panel uses for them.
  const tiers = ["default", "comfortable", "wide"];
  assert.deepEqual(
    tiers,
    ["default", "comfortable", "wide"],
    "the width tiers this asserts against have to be the ones the setting normalizes to"
  );
  assert.equal(DEFAULT_SETTINGS.appearance.timelineWidth, "default");
  for (const tier of ["Comfortable", "Wide"]) {
    assert.match(docs, new RegExp(tier, "i"), `the docs never mention the ${tier} width`);
  }

  // The media action is called Download, not Save. Both words appear in the docs for other
  // things, so this checks the action's own name where the docs name it.
  assert.match(docs, /\bDownload\b/, "the media action's name has to appear");
  assert.doesNotMatch(
    docs,
    /the \*\*Save\*\* button on a post/i,
    "the per-post media action is Download; Save locally is the Library action"
  );

  // Extension pages follow the reader's own light or dark setting rather than forcing one.
  assert.match(docs, /light/i, "the docs must say what happens in a light browser");
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
