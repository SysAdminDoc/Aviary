import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

async function loadBuilder() {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-bookmark-managers-"));
  const entry = path.join(temp, "entry.ts");
  const output = path.join(temp, "module.mjs");
  await writeFile(entry, `export * from ${JSON.stringify(abs("src/features/library/bookmarks.ts"))};`, "utf8");
  await build({ entryPoints: [entry], outfile: output, bundle: true, format: "esm", platform: "neutral", logLevel: "silent" });
  const module = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  return { module, cleanup: () => rm(temp, { recursive: true, force: true }) };
}

const record = (overrides) => ({
  id: "b1",
  tweetId: "1001",
  handle: "alice",
  text: "Saved thread about bread",
  url: "https://x.com/alice/status/1001",
  tags: ["baking", "later"],
  folder: null,
  remindAt: null,
  notes: "",
  capturedAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
  source: "manual",
  sourceOperation: null,
  ...overrides
});

test("bookmark managers get a Netscape file and a Raindrop CSV that survive hostile text", async () => {
  const { module, cleanup } = await loadBuilder();
  const entries = [
    record({}),
    record({
      id: "b2",
      tweetId: "2002",
      handle: "mallory",
      text: '</A><script>alert("x")</script> =HYPERLINK("http://evil")',
      url: "javascript:alert(1)",
      tags: ['a,b', 'q"uote'],
      folder: "</H3><DL>Recipes",
      notes: "<img src=x onerror=alert(2)>"
    }),
    // No URL and no id: there is nothing to link to, so it cannot become a bookmark anywhere.
    record({ id: "b3", tweetId: null, handle: null, url: null, text: "orphan" })
  ];
  try {
    const [html, csv] = module.buildBookmarkManagerArtifacts(entries, "2026-09-23T10:00:00.000Z");
    assert.equal(html.filename, "aviary-bookmarks-2026-09-23T10-00-00-000Z.html");
    assert.equal(csv.filename, "aviary-bookmarks-2026-09-23T10-00-00-000Z-raindrop.csv");
    const htmlText = new TextDecoder().decode(html.data);
    const csvText = new TextDecoder().decode(csv.data);

    assert.ok(htmlText.startsWith("<!DOCTYPE NETSCAPE-Bookmark-file-1>"));
    // Raw markup must not survive; the same characters escaped as text are harmless.
    assert.doesNotMatch(htmlText, /<script|javascript:|<img|<\/H3><DL>/i);

    const browser = await chromium.launch({ headless: true });
    let parsed;
    try {
      const page = await browser.newPage();
      // Browsers and Karakeep/Linkwarden read this format with an ordinary HTML parser.
      parsed = await page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, "text/html");
        return {
          scripts: doc.querySelectorAll("script, img").length,
          folders: [...doc.querySelectorAll("h3")].map((node) => node.textContent),
          links: [...doc.querySelectorAll("a")].map((a) => ({
            href: a.getAttribute("href"),
            added: a.getAttribute("add_date"),
            tags: a.getAttribute("tags"),
            title: a.textContent
          }))
        };
      }, htmlText);
    } finally {
      await browser.close();
    }
    assert.equal(parsed.scripts, 0);
    assert.deepEqual(parsed.folders, ["</H3><DL>Recipes"]);
    assert.deepEqual(parsed.links, [
      {
        href: "https://x.com/alice/status/1001",
        added: String(Date.parse("2026-09-01T08:00:00.000Z") / 1000),
        tags: "baking,later",
        title: "Saved thread about bread"
      },
      {
        // The javascript: address is refused and the post's own permalink is used instead.
        href: "https://x.com/mallory/status/2002",
        added: String(Date.parse("2026-09-01T08:00:00.000Z") / 1000),
        tags: "a b,q\"uote",
        title: '</A><script>alert("x")</script> =HYPERLINK("http://evil")'
      }
    ]);

    const lines = csvText.trimEnd().split("\n");
    assert.equal(lines[0], "url,folder,title,note,tags,created");
    assert.equal(lines.length, 3, "the orphan without a link is left out");
    assert.equal(lines[1], "https://x.com/alice/status/1001,,Saved thread about bread,,\"baking,later\",2026-09-01T08:00:00.000Z");
    assert.ok(lines[2].startsWith("https://x.com/mallory/status/2002,"));
    assert.doesNotMatch(csvText, /javascript:/);
  } finally {
    await cleanup();
  }
});
