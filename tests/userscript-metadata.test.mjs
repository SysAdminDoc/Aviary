import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { repositoryUrl, userscriptUrls } from "../tools/userscript-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

test("package.json declares the real repository the update URLs derive from", () => {
  const repository = repositoryUrl(pkg);
  assert.equal(repository, "https://github.com/SysAdminDoc/Twitter_Userscript");
  assert.equal(pkg.homepage, repository);
});

test("update URLs point at the declared repository, never a placeholder org", () => {
  const urls = userscriptUrls(pkg);
  assert.equal(
    urls.script,
    "https://raw.githubusercontent.com/SysAdminDoc/Twitter_Userscript/main/dist/aviary.user.js"
  );
  assert.equal(urls.namespace, "https://github.com/SysAdminDoc");
  for (const value of Object.values(urls)) {
    assert.ok(!value.includes("aviary-x"), `${value} still references the placeholder aviary-x org`);
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
