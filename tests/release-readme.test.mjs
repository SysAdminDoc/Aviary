import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { releaseReadme } from "../tools/release-readme.mjs";

const repository = "https://github.com/SysAdminDoc/Aviary";

test("a downloaded README links to guides and images outside the source checkout", () => {
  const input = '[Install](docs/INSTALL.md#updating)\n![Screen](docs/marketing/presets.png)\n<img src="src/extension/icons/icon-128.png">';
  const output = releaseReadme(input, repository);
  assert.ok(output.includes(`[Install](${repository}/blob/main/docs/INSTALL.md#updating)`));
  assert.ok(output.includes(`![Screen](${repository}/raw/main/docs/marketing/presets.png)`));
  assert.ok(output.includes(`src="${repository}/raw/main/src/extension/icons/icon-128.png"`));
  assert.ok(input.includes('[Install](docs/INSTALL.md#updating)'), "the source README is not mutated");
});

test("nested badges gain a portable target without changing external or anchor links", () => {
  const input = '[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE) [Top](#top) [Mail](mailto:reader@example.com)';
  const output = releaseReadme(input, repository);
  assert.ok(output.includes(`](${repository}/blob/main/LICENSE)`));
  assert.ok(output.includes('https://img.shields.io/badge/license-MIT-green'));
  assert.ok(output.includes('[Top](#top) [Mail](mailto:reader@example.com)'));
  assert.equal(releaseReadme(output, repository), output, "rebuilding does not double-prefix URLs");
});

test("the current release README resolves the root logo, screenshot and guide paths", async () => {
  const input = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const output = releaseReadme(input, repository);
  assert.ok(output.includes(`${repository}/raw/main/src/extension/icons/icon-128.png`));
  assert.ok(output.includes(`${repository}/raw/main/docs/marketing/presets.png`));
  assert.ok(output.includes(`${repository}/blob/main/docs/INSTALL.md`));
  assert.ok(!output.includes('](docs/'));
});
