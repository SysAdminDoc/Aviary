import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectRows, currentReference, readFaq } from "../tools/settings-reference.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("privacy, install, and FAQ docs match the current release surface", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const [privacy, install, faq, durable] = await Promise.all([
    readFile(path.join(root, "docs/PRIVACY.md"), "utf8"),
    readFile(path.join(root, "docs/INSTALL.md"), "utf8"),
    readFile(path.join(root, "docs/FAQ.md"), "utf8"),
    readFile(path.join(root, "src/platform/durable-storage.ts"), "utf8")
  ]);
  const docs = `${privacy}\n${install}\n${faq}`;

  assert.match(privacy, new RegExp(`release ${pkg.version.replaceAll(".", "\\.")}`));
  assert.match(install, new RegExp(`Aviary ${pkg.version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(docs, /\bv0\.(3|9)\.0\b/i);
  assert.doesNotMatch(docs, /XLSX is queued for v0\.10/i);
  assert.doesNotMatch(docs, /optional permissions are not requested or used/i);
  assert.doesNotMatch(docs, /the only outbound traffic Aviary triggers is fetching image/i);

  for (const match of durable.matchAll(/^\s+"(aviary\.[^"]+)"/gm)) {
    assert.ok(privacy.includes(match[1]), `privacy docs omit durable key ${match[1]}`);
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
