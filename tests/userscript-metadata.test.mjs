import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { repositoryUrl, userscriptUrls } from "../tools/userscript-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

// These assert the relationship, not the slug. Pinning the literal repository name here was itself
// a place a rename had to be carried, and it is the place nobody thinks to look: the 2026-08-15
// rename to SysAdminDoc/Aviary failed this file rather than reporting the real defect, which lived
// in package.json. Whether the declared repository is the one we actually push to is a question
// only the `origin` remote can answer, so preflight owns it.
test("homepage and the derived update URLs all follow the declared repository", () => {
  const repository = repositoryUrl(pkg);
  assert.equal(pkg.homepage, repository, "homepage must not drift from the declared repository");

  const urls = userscriptUrls(pkg);
  const slug = repository.slice("https://github.com/".length);
  assert.equal(urls.script, `https://raw.githubusercontent.com/${slug}/main/dist/aviary.user.js`);
  assert.equal(urls.namespace, `https://github.com/${slug.split("/")[0]}`);
});

test("update URLs never reference a placeholder or a retired repository name", () => {
  const urls = userscriptUrls(pkg);
  // aviary-x was the invented org the URLs pointed at before 2026-08-14; Twitter_Userscript is the
  // pre-rename name. Neither can serve the script, and raw.githubusercontent.com will not redirect.
  for (const stale of ["aviary-x", "Twitter_Userscript", "example.com", "example.local"]) {
    for (const value of [...Object.values(urls), pkg.homepage, repositoryUrl(pkg)]) {
      assert.ok(!value.includes(stale), `${value} still references "${stale}"`);
    }
  }
});

test("a missing or non-GitHub repository is rejected rather than silently templated", () => {
  assert.throws(() => repositoryUrl({}), /must declare a repository/);
  assert.throws(() => repositoryUrl({ repository: "" }), /must declare a repository/);
  assert.throws(() => repositoryUrl({ repository: "git@github.com:owner/repo.git" }), /GitHub https URL/);
  assert.throws(() => repositoryUrl({ repository: { url: "https://example.com/o/r" } }), /GitHub https URL/);
});

test("git+ prefix and .git suffix normalize to the browsable repository URL", () => {
  const urls = userscriptUrls({ repository: { url: "git+https://github.com/acme/widget.git" } });
  assert.equal(urls.namespace, "https://github.com/acme");
  assert.equal(urls.script, "https://raw.githubusercontent.com/acme/widget/main/dist/aviary.user.js");
});
