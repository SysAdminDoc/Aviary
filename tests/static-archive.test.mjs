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
      text: "the root of the thread <script>alert(1)</script> & \"quoted\" 'single' \u0001 ]]>",
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
          altText: 'a kept picture" onerror="alert(1)',
          label: "captions & more",
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
      permalink: "javascript:document.body.setAttribute('data-pwned', '1')",
      parentId: "5",
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
  const entries = buildStaticArchive(records(), {
    generatedAt: GENERATED,
    feedLink: "https://archive.example/aviary/"
  });
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
  // Every hostile value in the fixture arrives escaped rather than as markup.
  assert.doesNotMatch(root, /<script>alert\(1\)<\/script>/);
  assert.match(root, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(root, /onerror="alert\(1\)"/);
  assert.doesNotMatch(root, /\u0001/, "a control character must not reach the page either");
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
  assert.match(orphan, /5, which is not in this archive/);
  assert.doesNotMatch(orphan, /href="\.\.\/posts\/5\.html"/);

  // A javascript: permalink is captured data and must never become an href on a file:// page.
  assert.doesNotMatch(orphan, /javascript:/);
  assert.match(orphan, /No usable original address was recorded/);
  assert.doesNotMatch(text(files.get("feed.xml")), /javascript:/);

  // The index lists posts in id order, and so does the feed.
  const indexOrder = [...text(files.get("index.html")).matchAll(/href="(posts\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(indexOrder, ["posts/9.html", "posts/10.html", "posts/11.html"]);
  const guidOrder = [...text(files.get("feed.xml")).matchAll(/<guid[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(guidOrder, ["9", "10", "11"]);

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
  // Given a base, the channel and any local page hang off it.
  assert.match(feed, /<link>https:\/\/archive\.example\/aviary\/<\/link>/);
  assert.match(feed, /<link>https:\/\/archive\.example\/aviary\/posts\/11\.html<\/link>/);

  // Given none, the links stay relative to the feed, which is where the pages actually are. The
  // channel must not name x.com as its website: that is a site this archive is not.
  const local = text(byName(buildStaticArchive(records(), { generatedAt: GENERATED })).get("feed.xml"));
  assert.doesNotMatch(local, /<link>https:\/\/x\.com\/<\/link>/);
  assert.match(local, /<link>index\.html<\/link>/);
  assert.match(local, /<link>posts\/11\.html<\/link>/);
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

  // Ids that are not all numeric are the case a length-then-locale comparator gets wrong: it
  // reports 9 < 10 < 5a < 9, which is a cycle, and a sort over a cycle depends on input order.
  const mixed = ["9", "10", "5a", "5A", "\u00e4", "z"].map((id, index) => ({
    tweetId: id,
    handle: "archivist",
    displayName: "Archivist",
    text: `post ${id}`,
    capturedAt: "2026-08-12T12:00:00Z",
    createdAt: `2026-08-11T09:${String(index).padStart(2, "0")}:00Z`,
    surface: "home",
    permalink: `https://x.com/archivist/status/${index}`,
    audience: "public",
    media: []
  }));
  const orders = new Set();
  for (const permutation of [mixed, [...mixed].reverse(), [mixed[3], mixed[0], mixed[5], mixed[1], mixed[4], mixed[2]]]) {
    const built = buildStaticArchive(permutation, { generatedAt: GENERATED });
    orders.add([...text(byName(built).get("index.html")).matchAll(/href="(posts\/[^"]+)"/g)].map((m) => m[1]).join(","));
  }
  assert.equal(orders.size, 1, `mixed ids ordered ${orders.size} different ways: ${[...orders].join(" | ")}`);

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
  assert.equal(
    text(later.get("feed.xml")).replaceAll("Sat, 02 Jan 2027 03:04:05 +0000", "Mon, 07 Sep 2026 10:30:00 +0000"),
    text(byName(first).get("feed.xml")),
    "lastBuildDate must be the feed's only moving part"
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

/** A record with the fields every test here needs and nothing else. */
function record(id, extra = {}) {
  return {
    tweetId: id,
    handle: "archivist",
    displayName: "Archivist",
    text: `post ${id}`,
    capturedAt: "2026-08-12T12:00:00Z",
    createdAt: "2026-08-11T09:15:00Z",
    surface: "home",
    permalink: `https://x.com/archivist/status/${encodeURIComponent(id)}`,
    audience: "public",
    media: [],
    ...extra
  };
}

test("file names built from a post id cannot collide, escape, or name a device", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  // Ids reach here from imported bundles, which supply their own: nothing on that path requires a
  // number, or requires two of them to stay distinct once the unsafe characters come out.
  const ids = ["a/b", "a-b", "../../evil", "CON", "com1", "aux", "", "9"];
  const entries = buildStaticArchive(ids.map((id) => record(id)), { generatedAt: GENERATED });
  const pages = entries.map((entry) => entry.filename).filter((name) => name.startsWith("posts/"));

  assert.equal(pages.length, ids.length, `${ids.length} posts produced ${pages.length} pages: ${pages.join(", ")}`);
  assert.equal(new Set(pages).size, pages.length, `two posts share one page: ${pages.join(", ")}`);
  for (const name of pages) {
    assert.ok(!name.split("/").includes(".."), `${name} escapes the archive`);
    assert.doesNotMatch(name, /^\//, `${name} must not be absolute`);
    assert.doesNotMatch(
      name,
      /^posts\/(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i,
      `${name} is a Windows device name and cannot be extracted`
    );
  }

  // Every listed link resolves to a page that is actually in the archive.
  const listed = [...new TextDecoder()
    .decode(entries.find((entry) => entry.filename === "index.html").data)
    .matchAll(/href="(posts\/[^"]+)"/g)].map((match) => match[1]);
  assert.equal(listed.length, ids.length);
  for (const href of listed) assert.ok(pages.includes(href), `${href} is linked but not written`);
});

test("two records sharing one id share one page rather than two entries under one name", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  const entries = buildStaticArchive([record("7"), record("7", { text: "the duplicate" })], {
    generatedAt: GENERATED
  });
  const names = entries.map((entry) => entry.filename);
  assert.equal(new Set(names).size, names.length, `duplicate ZIP entry names: ${names.join(", ")}`);
  assert.equal(names.filter((name) => name.startsWith("posts/")).length, 1);
});

test("captured audio and captions get an element that can play them, not a broken image", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  const entries = buildStaticArchive(
    [
      record("1", {
        media: [
          { kind: "audio", url: "https://video.twimg.com/a.mp3", bytes: PNG, captureStatus: "captured-bytes" },
          { kind: "subtitle", url: "https://video.twimg.com/c.vtt", bytes: PNG, captureStatus: "captured-bytes", language: "en" },
          { kind: "video", url: "https://video.twimg.com/v.mp4", bytes: PNG, captureStatus: "captured-bytes" }
        ]
      })
    ],
    { generatedAt: GENERATED }
  );
  const page = text(byName(entries).get("posts/1.html"));

  // Bytes that were captured and copied in must not display as the failure the placeholder means.
  assert.doesNotMatch(page, /<img /, page);
  assert.match(page, /<audio controls preload="none" src="\.\.\/media\/1-audio\.mp3">/);
  assert.match(page, /<video controls preload="none" src="\.\.\/media\/1-video\.mp4">/);
  assert.match(page, /Captions \(en\): <a href="\.\.\/media\/1-subtitle\.vtt">/);
});

test("a media path with no bytes behind it is a stated gap, not a link to a file nobody wrote", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  const entries = buildStaticArchive(
    [
      record("1", {
        media: [
          // An assetPath is a promise the package builder makes when it writes bytes. Without them
          // it names a file that is not there, and the page would render a broken image.
          { kind: "photo", url: "https://pbs.twimg.com/media/x.png", assetPath: "media/000001-photo.png" },
          { kind: "photo", url: "https://pbs.twimg.com/media/y.png", assetPath: "../../../../etc/passwd", bytes: PNG }
        ]
      })
    ],
    { generatedAt: GENERATED }
  );
  const files = byName(entries);
  const page = text(files.get("posts/1.html"));

  assert.doesNotMatch(page, /000001-photo\.png/, "a path with no bytes must not become a src");
  assert.match(page, /not stored/);
  // A path that would climb out of the archive is refused, and the bytes are copied in instead.
  assert.doesNotMatch(page, /etc\/passwd/);
  assert.ok(files.has("media/1-photo.png"), [...files.keys()].join(", "));
  for (const src of [...page.matchAll(/ src="([^"]+)"/g)].map((match) => match[1])) {
    assert.match(src, /^\.\.\/(?:media|posts)\/[A-Za-z0-9._-]+$/, `${src} is not a path inside the archive`);
  }
});

test("posts held back by the audience setting are counted on the index rather than vanishing", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  // A record captured before audience tracking normalizes to unknown, which share-oriented output
  // excludes by default. An index that says "0 posts" beside a manifest counting one is an archive
  // arguing with itself.
  const legacy = record("1");
  delete legacy.audience;
  const index = text(byName(buildStaticArchive([legacy], { generatedAt: GENERATED })).get("index.html"));
  assert.match(index, /0 posts, 1 held back by the audience setting/);

  const shown = text(
    byName(buildStaticArchive([legacy], { generatedAt: GENERATED, audience: { includeUnknown: true } })).get("index.html")
  );
  assert.match(shown, /1 post ·/);
  assert.doesNotMatch(shown, /held back/);
});

test("a date with no zone is read the same on every host", async () => {
  const { buildStaticArchive } = await importSourceModule("src/features/export/static-archive.ts");
  // `new Date("2026-08-11T09:15:00")` is parsed as local time, so the same record would export
  // thirteen hours apart in New York and Tokyo.
  const built = (zone) => {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      return text(
        byName(
          buildStaticArchive([record("1", { createdAt: "2026-08-11T09:15:00" })], { generatedAt: GENERATED })
        ).get("feed.xml")
      );
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  };
  assert.match(built("UTC"), /<pubDate>Tue, 11 Aug 2026 09:15:00 \+0000<\/pubDate>/);
  assert.equal(built("America/New_York"), built("Asia/Tokyo"));
});
