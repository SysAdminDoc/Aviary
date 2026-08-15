import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { captureAgeReport, listFixtureFiles, readCaptureManifest } from "../tools/capture-manifest.mjs";
import { assertScrubbed, extractHtml, scrub } from "../tools/capture-decode.mjs";

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
    '[data-testid="GrokDrawer"]',
    'a[href="/i/grok"]',
    'button[aria-label="Grok actions"]'
  ]) {
    assert.ok(source.includes(selector), `missing selector: ${selector}`);
  }

  assert.match(source, /fallback:/);
});

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

// --- capture provenance -------------------------------------------------------------------------
// The fixtures are the authority every selector is proved against, so they need a date. Without
// one, a blocked item's "measured: 0 hits" silently means "0 hits as X was on the capture date",
// which is how three months of drift stayed invisible until 2026-08-15.

test("every fixture on disk is registered with a capture date", async () => {
  const manifest = await readCaptureManifest();
  const registered = new Set(manifest.captures.map((capture) => capture.file));
  for (const file of await listFixtureFiles()) {
    assert.ok(registered.has(file), `_decoded/${file} is not registered in captures.json`);
  }
  for (const capture of manifest.captures) {
    await readFile(path.join(root, "_decoded", capture.file), "utf8");
    assert.ok(capture.route, `${capture.file} must record the route it was captured from`);
  }
});

test("the age report fails past the declared ceiling, and a waiver only defers it", () => {
  const manifest = {
    ceilingDays: 90,
    warnDays: 30,
    captures: [{ file: "a.html", capturedOn: "2026-01-01" }]
  };
  const day = (iso) => Date.parse(`${iso}T00:00:00Z`);

  const fresh = captureAgeReport(manifest, day("2026-01-20"));
  assert.equal(fresh.overWarn, false);
  assert.equal(fresh.blocking, false);

  const warned = captureAgeReport(manifest, day("2026-02-15"));
  assert.equal(warned.overWarn, true, "45 days is past the 30-day warning");
  assert.equal(warned.blocking, false, "a warning is not a failure");

  const stale = captureAgeReport(manifest, day("2026-05-01"));
  assert.equal(stale.overCeiling, true);
  assert.equal(stale.blocking, true, "past the ceiling with no waiver must block");

  const waived = { ...manifest, acknowledgedStaleUntil: "2026-06-01" };
  assert.equal(captureAgeReport(waived, day("2026-05-01")).blocking, false, "an unexpired waiver defers");
  assert.equal(
    captureAgeReport(waived, day("2026-06-02")).blocking,
    true,
    "an expired waiver must not keep deferring — that is how a gate becomes decorative"
  );
});

test("a capture manifest missing its dates or ceiling is rejected", async () => {
  const manifest = await readCaptureManifest();
  assert.ok(manifest.ceilingDays > 0);
  // The waiver is only honoured when it explains itself, so it cannot be a silent permanent bypass.
  if (manifest.acknowledgedStaleUntil) {
    assert.ok(
      manifest.acknowledgedReason.length >= 20,
      "a stale-capture waiver must say why it exists"
    );
  }
});

test("the capture decoder extracts and scrubs a real saved MHTML", async () => {
  const source = path.join(root, "_decoded", "Home _ X.mhtml");
  const html = extractHtml(await readFile(source, "utf8"));
  assert.match(html, /data-testid="primaryColumn"/, "decoded output should be the page itself");
  assert.ok(html.length > 100_000, `expected a full page, got ${html.length} chars`);

  const planted = html.replace(
    "<head>",
    '<head><script>window.__x = {"ct0":"abcdef0123456789abcdef","auth_token":"deadbeefdeadbeef"};</script>'
  );
  assert.throws(() => assertScrubbed(planted), /still contains/, "the leak guard must catch a token");
  const { html: cleaned } = scrub(planted);
  assert.doesNotThrow(() => assertScrubbed(cleaned), "scrubbing must satisfy its own guard");
  assert.ok(!cleaned.includes("abcdef0123456789abcdef"), "ct0 value survived the scrub");
  assert.ok(!cleaned.includes("deadbeefdeadbeef"), "auth_token survived the scrub");
});
