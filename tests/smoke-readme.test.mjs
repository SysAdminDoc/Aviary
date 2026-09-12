import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the README opens with one evergreen marketing hero", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const reference = "![Aviary, a quieter way to read X and keep a local media library](docs/marketing/social-preview.png)";
  assert.ok(readme.startsWith(reference));
  assert.equal(readme.split("docs/marketing/social-preview.png").length - 1, 1);

  const source = await readFile(path.join(root, "docs/marketing/social-preview.html"), "utf8");
  assert.doesNotMatch(source, /\bv\d+\.\d+\.\d+\b/i);

  const png = await readFile(path.join(root, "docs/marketing/social-preview.png"));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

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
  const fastGate = await readFile(path.join(root, "tools/verify-fast.mjs"), "utf8");
  assert.equal(pkg.scripts["verify:fast"], "node tools/verify-fast.mjs");
  assert.match(fastGate, /"lint"/);
  assert.equal(typeof pkg.scripts.preflight, "string");
  assert.match(fastGate, /"preflight"/);
  assert.ok((await stat(path.join(root, "tools/preflight.mjs"))).isFile());
});
