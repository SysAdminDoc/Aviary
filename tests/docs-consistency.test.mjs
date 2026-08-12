import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

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
