import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const GENERATED = new Date("2026-09-07T10:30:00Z");

/** One photo's worth of real bytes, so the "copied media" branch copies something a browser reads. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

function records() {
  return [
    {
      tweetId: "9",
      handle: "archivist",
      displayName: "Archivist",
      text: "the root of the thread",
      capturedAt: "2026-08-12T12:00:00Z",
      createdAt: "2026-08-11T09:15:00Z",
      surface: "home",
      permalink: "https://x.com/archivist/status/9",
      audience: "public",
      media: [
        {
          kind: "photo",
          url: "https://pbs.twimg.com/media/kept.png",
          captureStatus: "captured-bytes",
          type: "image/png",
          altText: "a kept picture",
          bytes: PNG
        }
      ]
    },
    {
      tweetId: "10",
      handle: "archivist",
      displayName: "Archivist",
      text: "the reply, whose picture was never captured",
      capturedAt: "2026-08-12T12:01:00Z",
      createdAt: "2026-08-11T09:20:00Z",
      surface: "home",
      permalink: "https://x.com/archivist/status/10",
      parentId: "9",
      audience: "public",
      media: [
        {
          kind: "photo",
          url: "https://pbs.twimg.com/media/missing.jpg",
          captureStatus: "remote-reference"
        }
      ]
    },
    {
      tweetId: "11",
      handle: "elsewhere",
      displayName: "Elsewhere",
      text: "a reply to something outside this archive",
      capturedAt: "2026-08-12T12:02:00Z",
      createdAt: "2026-08-11T10:00:00Z",
      surface: "home",
      permalink: "https://x.com/elsewhere/status/11",
      parentId: "8888",
      audience: "public",
      media: []
    }
  ];
}

function byName(entries) {
  return new Map(entries.map((entry) => [entry.filename, entry]));
}

function text(entry) {
  return new TextDecoder().decode(entry.data);
}

/** Writes the archive to a directory so the pages are opened the way a person opens them. */
async function materialize(entries) {
  const directory = await mkdtemp(path.join(tmpdir(), "aviary-static-"));
  for (const entry of entries) {
    const target = path.join(directory, entry.filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
  return directory;
}

test("a static archive is an index, per-post pages, thread links, media or a stated gap, and RSS", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  const entries = buildStaticArchive(records(), { generatedAt: GENERATED, feedLink: "https://x.com/" });
  const files = byName(entries);

  assert.ok(files.has("index.html"), [...files.keys()].join(", "));
  assert.ok(files.has("posts/9.html"));
  assert.ok(files.has("posts/10.html"));
  assert.ok(files.has("posts/11.html"));
  assert.ok(files.has("feed.xml"));

  const copied = [...files.keys()].filter((name) => name.startsWith("media/"));
  assert.equal(copied.length, 1, `expected one copied asset, got ${copied.join(", ")}`);
  assert.deepEqual(Array.from(files.get(copied[0]).data), Array.from(PNG), "copied bytes must be the captured bytes");

  // The kept picture is rendered; the one that was never captured says so instead of leaving a
  // broken image behind.
  const root = text(files.get("posts/9.html"));
  assert.match(root, new RegExp(`<img src="\\.\\./${copied[0]}"`), root.slice(0, 400));
  const reply = text(files.get("posts/10.html"));
  assert.doesNotMatch(reply, /<img /, "an uncaptured asset must not render as an image");
  assert.match(reply, /not stored/);
  assert.match(reply, /only the address was kept/);
  assert.match(reply, /pbs\.twimg\.com\/media\/missing\.jpg/);

  // Thread relationships are links inside the folder, both directions.
  assert.match(root, /href="\.\.\/posts\/10\.html"/, "a parent must link down to its reply");
  assert.match(reply, /href="\.\.\/posts\/9\.html"/, "a reply must link up to its parent");
  // A parent outside the archive is named rather than linked to a page that is not there.
  const orphan = text(files.get("posts/11.html"));
  assert.match(orphan, /8888, which is not in this archive/);
  assert.doesNotMatch(orphan, /href="\.\.\/posts\/8888\.html"/);

  // The copy points at the original; navigation stays in the folder.
  assert.match(root, /<link rel="canonical" href="https:\/\/x\.com\/archivist\/status\/9">/);
  for (const name of ["index.html", "posts/9.html", "posts/10.html", "posts/11.html"]) {
    const page = text(files.get(name));
    const navigation = [...page.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((match) => match[1]);
    const remote = navigation.filter((href) => /^https?:/i.test(href));
    // The only absolute link a page carries is the statement of where the post came from.
    for (const href of remote) {
      assert.match(href, /^https:\/\/x\.com\/[a-z]+\/status\/\d+$/i, `${name} links out to ${href}`);
    }
    assert.equal((page.match(/<script/g) || []).length, 0, `${name} must not carry script`);
    assert.equal((page.match(/\ssrc="https?:/g) || []).length, 0, `${name} must not source anything remote`);
    assert.equal((page.match(/<link rel="stylesheet"/g) || []).length, 0, `${name} must not link a stylesheet`);
  }

  const feed = text(files.get("feed.xml"));
  assert.match(feed, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/);
  assert.match(feed, /<pubDate>Tue, 11 Aug 2026 09:15:00 \+0000<\/pubDate>/);
  assert.equal((feed.match(/<item>/g) || []).length, 3);
  assert.match(feed, /<guid isPermaLink="false">9<\/guid>/);
  assert.match(feed, /<link>https:\/\/x\.com\/archivist\/status\/9<\/link>/);
});

test("a repeated static export is byte-identical apart from the declared generated time", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  const first = buildStaticArchive(records(), { generatedAt: GENERATED });
  const same = buildStaticArchive(records(), { generatedAt: GENERATED });

  assert.deepEqual(
    first.map((entry) => entry.filename),
    same.map((entry) => entry.filename)
  );
  for (const [index, entry] of first.entries()) {
    assert.deepEqual(Array.from(same[index].data), Array.from(entry.data), `${entry.filename} is not reproducible`);
  }

  // Shuffled input must not change the output: the order is a function of the records, not of
  // whichever order the collector happened to hand them over in.
  const shuffled = buildStaticArchive([...records()].reverse(), { generatedAt: GENERATED });
  for (const [index, entry] of first.entries()) {
    assert.deepEqual(Array.from(shuffled[index].data), Array.from(entry.data), `${entry.filename} depends on input order`);
  }

  // A different clock changes the generated time and nothing else.
  const later = byName(buildStaticArchive(records(), { generatedAt: new Date("2027-01-02T03:04:05Z") }));
  const changed = [];
  for (const entry of first) {
    if (text(later.get(entry.filename)) !== text(entry)) changed.push(entry.filename);
  }
  assert.deepEqual(changed.sort(), ["feed.xml", "index.html"], "only the pages that declare the time may change");
  assert.equal(
    text(later.get("index.html")).replaceAll("2027-01-02T03:04:05.000Z", "2026-09-07T10:30:00.000Z"),
    text(byName(first).get("index.html")),
    "the generated time must be the only difference"
  );
});

test("every page of a static archive opens from disk with no network at all", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  const entries = buildStaticArchive(records(), { generatedAt: GENERATED });
  const directory = await materialize(entries);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const offsite = [];
    const failures = [];
    page.on("request", (request) => {
      if (!/^file:/i.test(request.url())) offsite.push(request.url());
    });
    page.on("requestfailed", (request) => {
      if (/^file:/i.test(request.url())) failures.push(request.url());
    });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(pathToFileURL(path.join(directory, "index.html")).href, { waitUntil: "load" });
    assert.equal(await page.locator("ul.posts li").count(), 3);
    assert.match(await page.locator("main").textContent(), /the root of the thread/);

    // Followed the way a reader follows it: click through, do not construct the URL.
    await page.getByRole("link", { name: /the root of the thread/ }).click();
    await page.waitForLoadState("load");
    assert.match(page.url(), /posts\/9\.html$/);
    assert.match(await page.locator("article").textContent(), /the root of the thread/);
    assert.equal(await page.locator("article figure img").count(), 1);
    // The picture is decoded from the copied file, so the copy is a real image and not a stub.
    assert.equal(
      await page.locator("article figure img").evaluate((node) => node.naturalWidth),
      1,
      "the copied asset did not decode"
    );

    await page.getByRole("link", { name: /whose picture was never captured/ }).click();
    await page.waitForLoadState("load");
    assert.match(page.url(), /posts\/10\.html$/);
    assert.match(await page.locator(".missing").textContent(), /not stored/);

    await page.getByRole("link", { name: "Back to the archive" }).click();
    await page.waitForLoadState("load");
    assert.match(page.url(), /index\.html$/);

    // The feed opens from the folder like everything else.
    const feedResponse = await page.goto(pathToFileURL(path.join(directory, "feed.xml")).href, {
      waitUntil: "load"
    });
    assert.notEqual(feedResponse, null, "feed.xml did not load from disk");

    // And it is XML a parser accepts, checked by a parser rather than by a regular expression.
    const feed = await page.evaluate((source) => {
      const parsed = new DOMParser().parseFromString(source, "application/xml");
      const error = parsed.querySelector("parsererror");
      return {
        error: error ? error.textContent : null,
        root: parsed.documentElement.nodeName,
        version: parsed.documentElement.getAttribute("version"),
        channels: parsed.querySelectorAll("rss > channel").length,
        title: parsed.querySelector("rss > channel > title")?.textContent ?? null,
        link: parsed.querySelector("rss > channel > link")?.textContent ?? null,
        description: parsed.querySelector("rss > channel > description")?.textContent ?? null,
        items: [...parsed.querySelectorAll("rss > channel > item")].map((item) => ({
          title: item.querySelector("title")?.textContent ?? null,
          guid: item.querySelector("guid")?.textContent ?? null,
          pubDate: item.querySelector("pubDate")?.textContent ?? null
        }))
      };
    }, text(byName(entries).get("feed.xml")));

    assert.equal(feed.error, null, String(feed.error));
    assert.equal(feed.root, "rss");
    assert.equal(feed.version, "2.0");
    assert.equal(feed.channels, 1);
    assert.ok(feed.title && feed.link && feed.description, JSON.stringify(feed));
    assert.equal(feed.items.length, 3);
    for (const item of feed.items) {
      assert.ok(item.title, JSON.stringify(item));
      assert.ok(item.guid, JSON.stringify(item));
      assert.match(item.pubDate, /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/);
    }

    assert.deepEqual(offsite, [], "a static archive must not reach past the folder it lives in");
    assert.deepEqual(failures, [], "every file a page asks for must be in the folder");
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the export package carries the static site beside the viewer and shares one copy of the media", async () => {
  const { buildExportZip } = await importSourceModule("src/features/export/export-feature.ts");
  const { readZip } = await importSourceModule("src/features/export/zip-reader.ts");
  const zip = await buildExportZip(records(), ["json"], "aviary");
  const names = (await readZip(zip)).map((entry) => entry.filename).sort();

  assert.ok(names.includes("aviary/index.html"), names.join(", "));
  assert.ok(names.includes("aviary/posts/9.html"), names.join(", "));
  assert.ok(names.includes("aviary/feed.xml"), names.join(", "));
  assert.ok(names.includes("aviary/viewer.html"), names.join(", "));

  // One set of bytes. The static pages point at the package's own media folder rather than
  // carrying a second copy of every asset.
  const media = names.filter((name) => name.includes("/media/"));
  assert.deepEqual(media, ["aviary/media/000001-photo.png"], media.join(", "));
});
