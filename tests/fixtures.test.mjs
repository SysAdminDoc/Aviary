import { importSourceModule } from "./helpers/source-import.mjs";
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
  // Local, not UTC: the waiver covers the whole of its stated day where the reader is, so a UTC
  // instant would express a different question in every timezone but one.
  const day = (iso) => {
    const [year, month, date] = iso.split("-").map(Number);
    return new Date(year, month - 1, date, 12, 0, 0, 0).getTime();
  };

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
    captureAgeReport(waived, day("2026-06-01")).blocking,
    false,
    "the waiver covers the whole of its stated day, in the reader's own timezone"
  );
  assert.equal(
    captureAgeReport(waived, day("2026-06-02")).blocking,
    true,
    "an expired waiver must not keep deferring — that is how a gate becomes decorative"
  );

  // One fresh capture used to mask a stale sibling, because only the newest was measured.
  const mixed = {
    ceilingDays: 90,
    captures: [
      { file: "fresh.html", capturedOn: "2026-05-01" },
      { file: "stale.html", capturedOn: "2026-01-01" }
    ]
  };
  const report = captureAgeReport(mixed, day("2026-05-10"));
  assert.equal(report.newest.file, "fresh.html");
  assert.equal(report.blocking, true, "a stale sibling must block even beside a fresh capture");
  assert.deepEqual(report.stale.map((item) => item.file), ["stale.html"], "and be named");
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

// Watching only the ten foundational surfaces meant a rename anywhere else silently disabled its
// owning feature with no diagnostic — the exact failure the fixture discipline exists to prevent,
// happening outside the fixture's reach. These keep the expanded registry honest without a browser:
// the health pass itself is exercised against a live DOM in the Trust selector-health tests.

// --- capture decoder: the two defects that would have poisoned a refreshed capture ------------
// Quoted-printable carries bytes, not characters, and the first version mapped each octet through
// String.fromCharCode before writing UTF-8 back out. Every non-ASCII character in a capture would
// have arrived as mojibake — including the localized ad labels the fixtures exist to measure.

test("quoted-printable decoding survives multibyte text", () => {
  const body = [
    "Content-Type: text/html",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<html><body>an em=E2=80=94dash, =E6=97=A5=E6=9C=AC=E8=AA=9E, =D8=B9=D8=B1=D8=A8=D9=8A</body></html>"
  ].join("\r\n");
  const mhtml = `Content-Type: multipart/related; boundary="B"; type="text/html"\r\n\r\n--B\r\n${body}\r\n--B--`;

  const html = extractHtml(mhtml);
  assert.match(html, /an em—dash/, "an em-dash must decode as one character, not three");
  assert.match(html, /日本語/, "CJK must survive");
  assert.match(html, /عربي/, "Arabic must survive");
  assert.doesNotMatch(html, /â/, "mojibake signature must not appear");
});

test("a soft line break inside a multibyte escape sequence still decodes", () => {
  // Quoted-printable wraps at 76 columns, so an octet run can be split by `=\r\n` mid-character.
  const body = [
    "Content-Type: text/html",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>=E2=80=",
    "=94</p>"
  ].join("\r\n");
  const mhtml = `Content-Type: multipart/related; boundary="B"; type="text/html"\r\n\r\n--B\r\n${body}\r\n--B--`;
  assert.match(extractHtml(mhtml), /<p>—<\/p>/);
});

test("every secret name is scrubbed in both cookie and JSON form, and caught in both", () => {
  const names = ["ct0", "auth_token", "oauth_token", "access_token", "session_token", "csrf_token"];
  for (const name of names) {
    for (const planted of [
      `<script>document.cookie="${name}=abcdef0123456789abcdef"</script>`,
      `<script>window.__x={"${name}":"abcdef0123456789abcdef"}</script>`
    ]) {
      assert.throws(
        () => assertScrubbed(planted),
        /still contains/,
        `the leak guard missed ${name} in ${planted.includes("cookie") ? "cookie" : "JSON"} form`
      );
      const { html } = scrub(planted);
      assert.ok(!html.includes("abcdef0123456789abcdef"), `${name} survived the scrub`);
      assert.doesNotThrow(() => assertScrubbed(html), `${name} scrubbed but still trips the guard`);
    }
  }
});

/**
 * The selector registry, read as the exported array rather than as the text of the file that
 * declares it.
 *
 * The old form sliced `selectors.ts` between two export names and split the slice on `"  {"`, so
 * a reformat, a helper inserted between the two exports, or an entry written on one line would
 * silently drop surfaces from the check. Iterating `SURFACE_SELECTORS` cannot miss one.
 */
test("every registered surface declares a selector, a fallback, a note and its owning feature", async () => {
  const { SURFACE_SELECTORS } = await importSourceModule("src/platform/selectors.ts");

  assert.ok(
    SURFACE_SELECTORS.length >= 20,
    `expected the expanded registry, saw ${SURFACE_SELECTORS.length} surfaces`
  );
  assert.equal(
    new Set(SURFACE_SELECTORS.map((entry) => entry.surface)).size,
    SURFACE_SELECTORS.length,
    "two surfaces share a name; Trust reports them by name and one would be unreachable"
  );

  const incomplete = [];
  for (const entry of SURFACE_SELECTORS) {
    for (const field of ["stable", "fallback", "note", "churnRisk", "feature"]) {
      if (typeof entry[field] !== "string" || entry[field].trim().length === 0) {
        incomplete.push(`${entry.surface ?? "(unnamed)"}: ${field}`);
      }
    }
  }
  // A surface with no fallback degrades to nothing the moment X renames its test id; one with no
  // note or feature leaves the reader of a degraded Trust report with nowhere to go.
  assert.deepEqual(incomplete, []);
});

test("the surfaces features depend on are present in a capture, not invented", async () => {
  const { SURFACE_SELECTORS } = await importSourceModule("src/platform/selectors.ts");
  const home = await readFile(path.join(root, "_decoded/home.html"), "utf8");
  const status = await readFile(path.join(root, "_decoded/status.html"), "utf8");
  const captures = home + status;

  // Every test id the registry claims as a *stable* anchor has to exist in the ground truth. A
  // selector nobody can point at in a capture is exactly what this project refuses to ship.
  // Fallbacks are exempt: they exist for the shape X has not shipped yet.
  const claimed = new Set();
  for (const entry of SURFACE_SELECTORS) {
    for (const match of entry.stable.matchAll(/data-testid="([A-Za-z0-9_-]+)"/g)) {
      claimed.add(match[1]);
    }
  }
  assert.ok(claimed.size >= 10, `only ${claimed.size} test ids were read from the registry`);

  const missing = [...claimed].filter((id) => !captures.includes(`data-testid="${id}"`));
  assert.deepEqual(missing, [], `the registry claims test ids no capture contains: ${missing.join(", ")}`);
});
