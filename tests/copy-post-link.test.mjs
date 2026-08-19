import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

/**
 * Copying a post's link on a front-end other than X.
 *
 * The distinction this feature exists to hold is between *copying* a rewritten address and
 * *redirecting* to one. Redirection is the shape everyone else shipped and everyone else removed:
 * logging in through the alternate host now sets an `x.com` cookie, and the front-ends people
 * redirected to have been architecturally dead since X removed guest tokens. So the tests below
 * check the clipboard, and check just as hard that the page X rendered is untouched.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

const FIXTURE = `
<main data-testid="primaryColumn">
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/alice"><span>@alice</span></a></div>
      <a href="/alice/status/1900000000000001"><time datetime="2026-08-19T10:00:00.000Z">now</time></a>
      <div data-testid="caret"></div>
      <div data-testid="tweetText">the outer post</div>
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><a href="/bob"><span>@bob</span></a></div>
        <a href="/bob/status/1900000000000999"><time datetime="2026-08-19T09:00:00.000Z">1h</time></a>
        <div data-testid="tweetText">the quoted post</div>
      </div>
    </article>
  </div>
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/carol"><span>@carol</span></a></div>
      <div data-testid="tweetText">a shell with no permalink yet</div>
    </article>
  </div>
  <!--
    The case that decides whether the quote boundary is respected: this article has no permalink of
    its own, and the only /status/ link in its subtree belongs to the post it quotes. Reading the
    first one found would put a control here that copies somebody else's address.
  -->
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="User-Name"><a href="/dave"><span>@dave</span></a></div>
      <div data-testid="tweetText">quote-only, still building</div>
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><a href="/erin"><span>@erin</span></a></div>
        <a href="/erin/status/1900000000000777"><time datetime="2026-08-19T08:00:00.000Z">2h</time></a>
        <div data-testid="tweetText">the quoted post</div>
      </div>
    </article>
  </div>
</main>`;

let browser;
let page;
let temp;

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), "aviary-copy-link-"));
  const entry = path.join(temp, "entry.ts");
  await writeFile(
    entry,
    [
      `export { copyPostLinkFeature, buildPostLink, readPostIdentity } from ${JSON.stringify(abs("src/features/library/copy-post-link.ts"))};`,
      `export { DEFAULT_SETTINGS, cloneSettings, normalizeSettings, COPY_LINK_HOSTS, isCopyLinkHost } from ${JSON.stringify(abs("src/platform/settings.ts"))};`
    ].join("\n"),
    "utf8"
  );
  const bundle = path.join(temp, "bundle.js");
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviaryCopyLink",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
  await page.addScriptTag({ path: bundle });
  await page.evaluate((fixture) => {
    window.copyCtx = (host) => {
      const settings = AviaryCopyLink.cloneSettings(AviaryCopyLink.DEFAULT_SETTINGS);
      settings.links.copyLinkHost = host;
      return {
        settings,
        route: { surface: "home", path: "/home" },
        auditLog: { records: [], async record(action, detail) { this.records.push({ action, detail }); } },
        diagnostics: { info() {}, warn() {}, error() {} }
      };
    };
    window.mount = async (host) => {
      document.body.innerHTML = fixture;
      // A clipboard that records rather than one that needs a permission prompt.
      window.__clipboard = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { async writeText(text) { window.__clipboard.push(text); } }
      });
      const ctx = window.copyCtx(host);
      await AviaryCopyLink.copyPostLinkFeature.init(ctx);
      await AviaryCopyLink.copyPostLinkFeature.apply(ctx, document);
      return ctx;
    };
    window.buttons = () => [...document.querySelectorAll("[data-av-copy-link]")];
  }, FIXTURE);
});

after(async () => {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
});

test("the default is X's own URL, and the control is not on the page at all", async () => {
  const observed = await page.evaluate(async () => {
    const defaultHost = AviaryCopyLink.DEFAULT_SETTINGS.links.copyLinkHost;
    const ctx = await window.mount(defaultHost);
    const result = {
      defaultHost,
      buttons: window.buttons().length,
      styles: document.getElementById("av-copy-post-link") !== null
    };
    await AviaryCopyLink.copyPostLinkFeature.destroy(ctx);
    return result;
  });

  // The whole feature is opt-in: on a default install X's page is exactly as X rendered it.
  assert.equal(observed.defaultHost, "");
  assert.equal(observed.buttons, 0, "the control appeared without a host being chosen");
  assert.equal(observed.styles, false, "a stylesheet was injected for a feature that is off");
});

test("the copied link is the post's own address on the chosen host", async () => {
  const observed = await page.evaluate(async () => {
    const ctx = await window.mount("fxtwitter.com");
    const button = window.buttons()[0];
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = {
      buttons: window.buttons().length,
      copied: [...window.__clipboard],
      label: button.textContent,
      audit: ctx.auditLog.records
    };
    await AviaryCopyLink.copyPostLinkFeature.destroy(ctx);
    return result;
  });

  // One control, on the post that has a permalink -- not on the shell that has none.
  assert.equal(observed.buttons, 1);
  assert.deepEqual(observed.copied, ["https://fxtwitter.com/alice/status/1900000000000001"]);
  assert.match(observed.label, /Copied/);
  assert.deepEqual(observed.audit, [{ action: "link.copy", detail: { host: "fxtwitter.com" } }]);
});

test("the quoted post's permalink is not mistaken for this post's", async () => {
  const observed = await page.evaluate(async () => {
    const ctx = await window.mount("xcancel.com");
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const identities = articles.map((article) => AviaryCopyLink.readPostIdentity(article));
    window.buttons()[0].click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = {
      copied: [...window.__clipboard],
      identities,
      buttons: window.buttons().length,
      // Which articles ended up carrying a control.
      decorated: articles.map((article) => article.querySelector("[data-av-copy-link]") !== null)
    };
    await AviaryCopyLink.copyPostLinkFeature.destroy(ctx);
    return result;
  });

  // @alice's post carries a quote whose permalink sits later in the subtree, and the control copies
  // @alice's address rather than the quoted one.
  assert.deepEqual(observed.copied, ["https://xcancel.com/alice/status/1900000000000001"]);

  // The article that decides it: @dave has no permalink of its own and the only `/status/` link in
  // its subtree is @erin's. Reading the first link found would give @dave's post a control that
  // copies @erin's address -- a link to the wrong post, under somebody else's handle.
  assert.equal(observed.identities.length, 3, "the fixture lost the article this test turns on");
  assert.deepEqual(observed.identities[2], { handle: null, tweetId: null });
  assert.deepEqual(observed.decorated, [true, false, false]);
  assert.equal(observed.buttons, 1, "a control was placed on a post with no address of its own");
});

test("nothing X rendered is rewritten, and no navigation is redirected", async () => {
  const observed = await page.evaluate(async () => {
    const before = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    const ctx = await window.mount("vxtwitter.com");
    const afterMount = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    window.buttons()[0].click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterCopy = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    await AviaryCopyLink.copyPostLinkFeature.destroy(ctx);
    return { before, afterMount, afterCopy, remaining: window.buttons().length };
  });

  assert.ok(observed.afterMount.length > 0, "the fixture rendered no links to leave alone");
  // The links X rendered still point at x.com. This is the line between copying and redirecting.
  assert.deepEqual(observed.afterMount, observed.afterCopy);
  assert.ok(
    observed.afterCopy.every((href) => !/vxtwitter/.test(href ?? "")),
    `a rendered link was rewritten: ${JSON.stringify(observed.afterCopy)}`
  );
  assert.equal(observed.remaining, 0, "destroy left the control behind");
});

test("switching back to X takes the control away again", async () => {
  const observed = await page.evaluate(async () => {
    const ctx = await window.mount("fixupx.com");
    const on = window.buttons().length;
    ctx.settings.links.copyLinkHost = "";
    await AviaryCopyLink.copyPostLinkFeature.apply(ctx, document);
    const off = {
      buttons: window.buttons().length,
      styles: document.getElementById("av-copy-post-link") !== null,
      processed: document.querySelectorAll("[data-av-copy-link-processed]").length
    };
    await AviaryCopyLink.copyPostLinkFeature.destroy(ctx);
    return { on, off };
  });

  assert.equal(observed.on, 1);
  assert.equal(observed.off.buttons, 0);
  assert.equal(observed.off.styles, false);
  assert.equal(observed.off.processed, 0, "a marker survived the feature being turned off");
});

test("a host nobody offered is refused by normalization rather than copied to", async () => {
  const observed = await page.evaluate(() => {
    const hosts = [...AviaryCopyLink.COPY_LINK_HOSTS];
    const normalized = AviaryCopyLink.normalizeSettings({
      links: { copyLinkHost: "evil.example" }
    }).links.copyLinkHost;
    const kept = AviaryCopyLink.normalizeSettings({
      links: { copyLinkHost: "xcancel.com" }
    }).links.copyLinkHost;
    return {
      hosts,
      normalized,
      kept,
      accepts: AviaryCopyLink.isCopyLinkHost("xcancel.com"),
      rejects: AviaryCopyLink.isCopyLinkHost("evil.example")
    };
  });

  // A closed list, because a free-text host lets a typo silently produce a link to somewhere the
  // user did not mean -- and the value is round-tripped through settings import and backup.
  assert.deepEqual(observed.hosts, ["", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "xcancel.com"]);
  assert.equal(observed.normalized, "", "an unknown host survived normalization");
  assert.equal(observed.kept, "xcancel.com");
  assert.equal(observed.accepts, true);
  assert.equal(observed.rejects, false);
});

test("buildPostLink needs both halves of an identity", async () => {
  const observed = await page.evaluate(() => ({
    both: AviaryCopyLink.buildPostLink("alice", "1900000000000001", "fxtwitter.com"),
    xDefault: AviaryCopyLink.buildPostLink("alice", "1900000000000001", ""),
    noHandle: AviaryCopyLink.buildPostLink(null, "1900000000000001", "fxtwitter.com"),
    noId: AviaryCopyLink.buildPostLink("alice", null, "fxtwitter.com")
  }));

  assert.equal(observed.both, "https://fxtwitter.com/alice/status/1900000000000001");
  assert.equal(observed.xDefault, "https://x.com/alice/status/1900000000000001");
  // Half an identity would produce a link to the wrong place, so it produces none.
  assert.equal(observed.noHandle, null);
  assert.equal(observed.noId, null);
});
