import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-seen-dim-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    `export { seenPostsFeature, resetSeenPostsState, getSeenPostStore } from ${JSON.stringify(abs("src/features/filtering/seen-posts-feature.ts"))};
export { normalizeSettings } from ${JSON.stringify(abs("src/platform/settings.ts"))};`,
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviarySeen",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

const TIMELINE = (ids) =>
  ids
    .map(
      (id) =>
        `<article data-testid="tweet" id="post-${id}"><a href="/someone/status/${id}">link</a></article>`
    )
    .join("");

async function run({ enabled = true } = {}) {
  return page.evaluate(
    async ({ enabled, first, second }) => {
      AviarySeen.resetSeenPostsState();
      const values = new Map();
      const storage = {
        async get(key, fallback) {
          return values.has(key) ? values.get(key) : fallback;
        },
        async set(key, value) {
          values.set(key, JSON.parse(JSON.stringify(value)));
        }
      };
      const settings = AviarySeen.normalizeSettings({ filter: { dimSeenPosts: enabled } });
      const ctx = {
        settings,
        storage,
        route: { href: "https://x.com/home", path: "/home", surface: "home" },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
      const feature = AviarySeen.seenPostsFeature;

      // First pass: these posts are new, so nothing should fade.
      document.body.innerHTML = first;
      await feature.init(ctx);
      const opacityOf = (id) => {
        const node = document.getElementById(`post-${id}`);
        return node ? getComputedStyle(node).opacity : "absent";
      };
      const firstPass = { a: opacityOf("111"), b: opacityOf("222") };

      // Second pass: the same two return alongside one genuinely new post.
      document.body.innerHTML = second;
      feature.apply(ctx, document);
      const secondPass = { a: opacityOf("111"), b: opacityOf("222"), fresh: opacityOf("333") };

      await feature.destroy(ctx);
      const afterDestroy = {
        a: opacityOf("111"),
        marked: document.querySelectorAll("[data-av-seen]").length
      };
      return { firstPass, secondPass, afterDestroy };
    },
    { enabled, first: TIMELINE(["111", "222"]), second: TIMELINE(["111", "222", "333"]) }
  );
}

test("a post fades only on its second pass, never while first being read", async () => {
  const { firstPass, secondPass } = await run();

  assert.equal(firstPass.a, "1", "a post must not fade the first time it is on screen");
  assert.equal(firstPass.b, "1");

  assert.notEqual(secondPass.a, "1", "a returning post must fade");
  assert.notEqual(secondPass.b, "1");
  assert.equal(secondPass.fresh, "1", "a genuinely new post must stay at full opacity");
});

test("destroy removes the fade and every marker", async () => {
  const { afterDestroy } = await run();
  assert.equal(afterDestroy.a, "1", "opacity must return after destroy");
  assert.equal(afterDestroy.marked, 0, "no seen marker may survive destroy");
});

test("the feature is inert while off", async () => {
  const { firstPass, secondPass } = await run({ enabled: false });
  assert.equal(firstPass.a, "1");
  assert.equal(secondPass.a, "1", "nothing may fade while the setting is off");
});
