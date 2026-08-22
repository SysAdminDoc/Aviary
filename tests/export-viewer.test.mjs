import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";


test("standalone viewer is local-only, responsive, virtualized, searchable, and RTL-aware", async () => {
  const { buildExportViewer } = await importSourceModule("src/features/export/viewer.ts");
  const records = Array.from({ length: 120 }, (_, index) => ({
    tweetId: String(index + 1),
    handle: "archivist",
    displayName: "Archivist",
    conversationId: "1",
    rootId: "1",
    ...(index > 0 ? { parentId: String(index) } : {}),
    text: index === 73 ? "needle survives the filter" : `post ${index}`,
    capturedAt: `2026-08-12T12:${String(index % 60).padStart(2, "0")}:00Z`,
    surface: "home",
    media: index === 73
      ? [{ kind: "photo", url: "https://pbs.twimg.com/media/remote.jpg", capture: {
          status: "remote-reference",
          sourceUrl: "https://pbs.twimg.com/media/remote.jpg",
          capturedAt: "2026-08-12T12:00:00Z",
          byteLength: null,
          sha256: null,
          retryable: true
        } }]
      : [],
    permalink: `https://x.com/archivist/status/${index + 1}`
  }));
  const html = new TextDecoder().decode(buildExportViewer(records));
  assert.match(html, /<title>Aviary archive<\/title>/);
  assert.equal((html.match(/<script[^>]*\bsrc=/g) || []).length, 0, "viewer must not load remote scripts");
  assert.match(html, /remote-reference/);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 600 }, locale: "en-US" });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent(html, { waitUntil: "load" });

    const initialCards = await page.locator("#list .record-card").count();
    assert.ok(initialCards < records.length, `virtualized viewer rendered ${initialCards} of ${records.length} cards`);
    assert.equal(await page.locator("#records").evaluate((node) => node.clientWidth <= 320), true);

    await page.locator("#search").fill("needle");
    assert.equal(await page.locator("#list .record-card").count(), 1, JSON.stringify({ summary: await page.locator("#summary").textContent(), errors: pageErrors }));
    assert.match(await page.locator("#list").textContent(), /needle survives the filter/);
    assert.match(await page.locator("#list").textContent(), /Remote reference/);

    await page.locator("#search").fill("");
    await page.locator("#thread").check();
    assert.equal(await page.locator("#list .record-card").count(), 1);
    assert.match(await page.locator("#list").textContent(), /120 posts/);
    assert.equal(await page.locator("#list .body").count(), 120, "long threads must stay continuous");

    await page.selectOption("#locale", "ar");
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.locator("html").getAttribute("lang"), "ar");
    assert.match(await page.locator("#title").textContent(), /أرشيف/);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("thread view renders missing parents and collapses same-author runs", async () => {
  const { buildExportViewer } = await importSourceModule("src/features/export/viewer.ts");
  const records = [
    {
      tweetId: "root-1",
      handle: "alice",
      displayName: "Alice",
      authorId: "author-a",
      conversationId: "root-1",
      rootId: "root-1",
      text: "root",
      capturedAt: "2026-08-22T12:00:00Z",
      createdAt: "2026-08-22T12:00:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/alice/status/root-1"
    },
    {
      tweetId: "reply-1",
      handle: "alice",
      displayName: "Alice",
      authorId: "author-a",
      conversationId: "root-1",
      rootId: "root-1",
      parentId: "root-1",
      text: "same author",
      capturedAt: "2026-08-22T12:01:00Z",
      createdAt: "2026-08-22T12:01:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/alice/status/reply-1"
    },
    {
      tweetId: "reply-2",
      handle: "bob",
      displayName: "Bob",
      authorId: "author-b",
      conversationId: "root-1",
      rootId: "root-1",
      parentId: "missing-parent",
      text: "conversation reply",
      capturedAt: "2026-08-22T12:02:00Z",
      createdAt: "2026-08-22T12:02:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/bob/status/reply-2"
    }
  ];
  const html = new TextDecoder().decode(buildExportViewer(records));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.locator("#thread").check();
    assert.equal(await page.locator(".thread-gap").count(), 1);
    assert.equal(await page.locator("details.author-run").count(), 1);
    assert.match(await page.locator("#list").textContent(), /Missing captured post/);
    assert.match(await page.locator("#list").textContent(), /3 posts/);
  } finally {
    await browser.close();
  }
});

test("thread sorting orders complete groups without breaking parent order", async () => {
  const { buildExportViewer } = await importSourceModule("src/features/export/viewer.ts");
  const records = [
    {
      tweetId: "old-root",
      handle: "zeta",
      displayName: "Zeta",
      conversationId: "old-root",
      rootId: "old-root",
      text: "old root",
      capturedAt: "2026-08-22T10:00:00Z",
      createdAt: "2026-08-22T10:00:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/zeta/status/old-root"
    },
    {
      tweetId: "new-root",
      handle: "alpha",
      displayName: "Alpha",
      conversationId: "new-root",
      rootId: "new-root",
      text: "new root",
      capturedAt: "2026-08-22T12:00:00Z",
      createdAt: "2026-08-22T12:00:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/alpha/status/new-root"
    },
    {
      tweetId: "new-reply",
      handle: "alpha",
      displayName: "Alpha",
      conversationId: "new-root",
      rootId: "new-root",
      parentId: "new-root",
      text: "new reply",
      capturedAt: "2026-08-22T12:01:00Z",
      createdAt: "2026-08-22T12:01:00Z",
      surface: "home",
      media: [],
      permalink: "https://x.com/alpha/status/new-reply"
    }
  ];
  const html = new TextDecoder().decode(buildExportViewer(records));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(html, { waitUntil: "load" });
    await page.locator("#thread").check();
    assert.equal(await page.locator("#list .record-card").count(), 2);
    assert.match(await page.locator("#list .record-card").first().textContent(), /new root/);
    await page.selectOption("#sort", "oldest");
    assert.match(await page.locator("#list .record-card").first().textContent(), /old root/);
    await page.selectOption("#sort", "handle");
    assert.match(await page.locator("#list .record-card").first().textContent(), /new root/);
    assert.match(await page.locator("#list .record-card").first().textContent(), /new reply/);
  } finally {
    await browser.close();
  }
});
