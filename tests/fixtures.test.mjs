import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const [name, fixture] of [
  ["home", "_decoded/home.html"],
  ["status", "_decoded/status.html"]
]) {
  test(`${name} fixture exposes stable X surfaces`, async () => {
    const html = await readFile(path.join(root, fixture), "utf8");

    assert.match(html, /id="react-root"/);
    assert.match(html, /data-testid="primaryColumn"/);
    assert.match(html, /data-testid="tweet"/);
    assert.match(html, /data-testid="tweetText"/);
    assert.match(html, /data-testid="SearchBox_Search_Input"/);

    const tweetCount = count(html, /data-testid="tweet"/g);
    assert.ok(tweetCount >= 5, `expected several tweet nodes, saw ${tweetCount}`);
  });
}

test("source selector registry contains stable and fallback selectors", async () => {
  const source = await readFile(path.join(root, "src/platform/selectors.ts"), "utf8");

  for (const selector of [
    '[data-testid="primaryColumn"]',
    'article[data-testid="tweet"]',
    '[data-testid="tweetText"]',
    '[data-testid="tweetTextarea_0"]',
    '[data-testid="GrokDrawer"]'
  ]) {
    assert.ok(source.includes(selector), `missing selector: ${selector}`);
  }

  assert.match(source, /fallback:/);
});

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}
