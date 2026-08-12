import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("install + FAQ docs exist and reference the right primitives", async () => {
  const install = await readFile(path.join(root, "docs/INSTALL.md"), "utf8");
  assert.match(install, /Tampermonkey/);
  assert.match(install, /Load unpacked/);
  assert.match(install, /aviary\.user\.js/);
  assert.match(install, /aviary\.settings\.v1/);

  const faq = await readFile(path.join(root, "docs/FAQ.md"), "utf8");
  assert.match(faq, /Selector health/);
  assert.match(faq, /STORE-only ZIP/);
  assert.match(faq, /Aviary downloaded an image/);
});

test("preflight script and build script are wired into package.json", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(typeof pkg.scripts.lint, "string");
  assert.ok(pkg.scripts.verify.includes("lint"));
  assert.equal(typeof pkg.scripts.preflight, "string");
  assert.ok(pkg.scripts.verify.includes("preflight"));
  assert.ok((await stat(path.join(root, "tools/preflight.mjs"))).isFile());
});
