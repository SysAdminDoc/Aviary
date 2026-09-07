import { importSourceModule } from "./helpers/source-import.mjs";
import { captureHtml, captureSchema, captureUrl } from "./helpers/synthetic-capture.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

import { captureAgeReport, listFixtureFiles, readCaptureManifest } from "../tools/capture-manifest.mjs";
import { assertScrubbed, extractHtml, scrub } from "../tools/capture-decode.mjs";
import { generateCaptureDocument, readDomSchema } from "../tools/fixture-generator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["home", "status"]) {
  test(`${name} fixture exposes stable X surfaces`, async () => {
    const html = await captureHtml(name);

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
// The schema is the authority every selector is proved against, so it needs a date. Without one, a
// blocked item's "measured: 0 hits" silently means "0 hits as X was on the observation date", which
// is how three months of drift stayed invisible until 2026-08-15. Regenerating markup from the
// schema does not make the observation newer, which is the whole reason the date lives on
// `derivedFrom` and not on the generated files.

test("the schema records the observation date, and no saved page is left in the tree", async () => {
  const manifest = await readCaptureManifest();
  assert.equal(manifest.captures.length, 1);
  assert.equal(manifest.captures[0].file, "dom-schema.json");
  assert.ok(manifest.captures[0].route, "the schema must record the routes it was derived from");
  assert.ok(manifest.captures[0].source, "the schema must record what it was derived from");

  // A saved authenticated page carries a real handle, display name and post bodies. It is decoded,
  // measured into the schema, and discarded; one left behind is a mistake, not a fixture.
  assert.deepEqual(
    await listFixtureFiles(),
    [],
    "a saved capture came back into _decoded/ — decode it into dom-schema.json and delete it"
  );
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

test("a schema missing its observation date or ceiling is rejected", async () => {
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

test("the ceiling and the waiver cannot be widened into nothing", async () => {
  // Both live in the same file as the fixture data, and one character could have moved the waiver
  // to 2027 or the ceiling to 9000 with every gate still green. A ceiling is only a ceiling while
  // it is bounded, and a waiver is only a deferral while it expires near the observation it defers.
  const manifest = await readCaptureManifest();
  assert.ok(
    manifest.ceilingDays <= 120,
    `a ${manifest.ceilingDays}-day ceiling is not a ceiling on evidence about a site that changes weekly`
  );
  if (manifest.acknowledgedStaleUntil) {
    const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
    const extraDays = Math.round(
      (day(manifest.acknowledgedStaleUntil) - day(manifest.captures[0].capturedOn)) / 86_400_000
    );
    assert.ok(
      extraDays <= manifest.ceilingDays * 2,
      `the waiver runs ${extraDays} days past the observation, which is a permanent bypass wearing a date`
    );
  }
});

test("regenerating the fixtures cannot move the observation date", async () => {
  // The failure this exists to prevent: someone regenerates markup, sees a fresh file, and treats
  // the selector evidence as fresh too. Generation reads the date; nothing about it writes one.
  const before = await readCaptureManifest();
  const first = await captureHtml("home");
  const second = generateCaptureDocument(await readDomSchema(), "home");
  const after = await readCaptureManifest();

  assert.equal(first, second, "the generator must be deterministic");
  assert.equal(after.captures[0].capturedOn, before.captures[0].capturedOn);
  assert.equal(before.captures[0].capturedOn, "2026-05-19", "the recorded observation, not today");
});

test("the generated documents carry no real identity", async () => {
  // The reason the saved captures could not stay: a handle, a display name, a post body and a
  // media id belonging to a person who did not agree to be in this repository.
  for (const route of ["home", "status"]) {
    const html = await captureHtml(route);
    for (const handle of html.matchAll(/@([A-Za-z0-9_]+)/g)) {
      assert.match(handle[1], /^fixture_/, `${route} carries a handle that is not synthetic`);
    }
    // Both media hosts, not only the image one: a real video id would have passed unnoticed.
    for (const media of html.matchAll(/(?:pbs|video)\.twimg\.com\/[a-z_0-9]+\/([A-Za-z0-9_-]+)/g)) {
      assert.match(media[1], /^AviaryFixture|^1900000000000000/, `${route} carries a media id that is not synthetic`);
    }
    for (const id of html.matchAll(/\/status\/(\d+)/g)) {
      assert.match(id[1], /^1900000000000000/, `${route} carries a post id that is not synthetic`);
    }
  }
});

test("the capture decoder extracts and scrubs a saved MHTML", async () => {
  // The decoder still runs, on the operator's machine, on a page that is never committed. It is
  // exercised against a synthetic MHTML for exactly that reason.
  const page = [
    "<html><head></head><body>",
    '<div data-testid="primaryColumn"><article data-testid="tweet">fixture</article></div>',
    "</body></html>"
  ].join("");
  const mhtml = [
    'Content-Type: multipart/related; boundary="B"; type="text/html"',
    "",
    "--B",
    "Content-Type: text/html",
    "",
    page,
    "--B--"
  ].join("\r\n");

  const html = extractHtml(mhtml);
  assert.match(html, /data-testid="primaryColumn"/, "decoded output should be the page itself");

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
  assert.doesNotMatch(html, /â/, "mojibake signature must not appear");
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

test("the surfaces features depend on are present in the schema, not invented", async () => {
  const { SURFACE_SELECTORS } = await importSourceModule("src/platform/selectors.ts");
  const schema = await captureSchema();
  const documents = (await captureHtml("home")) + (await captureHtml("status"));

  // Every test id the registry claims as a *stable* anchor has to be a test id the schema records
  // as observed, and has to survive into the generated documents. A selector nobody can point at
  // in an observation is exactly what this project refuses to ship. Fallbacks are exempt: they
  // exist for the shape X has not shipped yet.
  const claimed = new Set();
  for (const entry of SURFACE_SELECTORS) {
    for (const match of entry.stable.matchAll(/data-testid="([A-Za-z0-9_.-]+)"/g)) {
      claimed.add(match[1]);
    }
  }
  assert.ok(claimed.size >= 10, `only ${claimed.size} test ids were read from the registry`);

  const recorded = new Set(Object.values(schema.testIds));
  const unrecorded = [...claimed].filter((id) => !recorded.has(id));
  assert.deepEqual(unrecorded, [], `the registry claims test ids the schema does not record: ${unrecorded.join(", ")}`);

  const missing = [...claimed].filter((id) => !documents.includes(`data-testid="${id}"`));
  assert.deepEqual(missing, [], `the registry claims test ids no generated document contains: ${missing.join(", ")}`);
});

test("a renamed test id in the schema makes the owning surface report missing", async () => {
  // The proof that the generated fixtures can still fail. Without it, "every surface is healthy"
  // could mean the documents happen to contain everything, or it could mean the check is inert.
  // "Who to follow" is the surface chosen because its fallback does not match a generated
  // document either, so a renamed test id has nowhere left to degrade to.
  const schema = await readDomSchema();
  const renamed = structuredClone(schema);
  renamed.testIds.userCell = "UserCell_renamed_by_x";

  const temp = await mkdtemp(path.join(tmpdir(), "aviary-selector-health-"));
  const bundle = path.join(temp, "selectors.js");
  await build({
    entryPoints: [path.join(root, "src/platform/selectors.ts")],
    outfile: bundle,
    bundle: true,
    format: "iife",
    globalName: "AviarySelectors",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const report = async (source) => {
      const page = await browser.newPage();
      await page.setContent(generateCaptureDocument(source, "home"));
      await page.addScriptTag({ path: bundle });
      const health = await page.evaluate(() =>
        AviarySelectors.getSelectorHealthForRoute(document, "home").map((entry) => ({
          surface: entry.surface,
          matched: entry.matched,
          feature: entry.feature
        }))
      );
      await page.close();
      return health;
    };

    const healthy = (await report(schema)).find((entry) => entry.surface === "Who to follow");
    assert.equal(healthy.matched, "stable", "control: the recorded test id must match on a generated document");

    const broken = (await report(renamed)).find((entry) => entry.surface === "Who to follow");
    assert.equal(broken.matched, "missing", "a renamed test id must report its surface missing");
    assert.equal(
      broken.feature,
      "Hide follow suggestions",
      `the report must name the feature that stops working, saw ${broken.feature}`
    );
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("the dated upstream selector comparison is complete for adopted equivalents", async () => {
  const { SELECTOR_COMPARISON, SURFACE_SELECTORS } = await importSourceModule("src/platform/selectors.ts");
  assert.equal(new Set(SELECTOR_COMPARISON.map((entry) => entry.surface)).size, SELECTOR_COMPARISON.length);
  for (const entry of SELECTOR_COMPARISON) {
    assert.match(entry.checkedOn, /^2026-09-07$/);
    assert.ok(entry.source && entry.license && entry.reference.startsWith("https://github.com/"));
    if (entry.equivalent) assert.ok(entry.disagreement !== undefined, `${entry.surface} must state agreement or disagreement`);
  }
  for (const surface of ["App root", "Tweet", "Media photo", "Video", "Promoted placement", "Profile photo grid", "Videos plain tweet entries"]) {
    assert.ok(SELECTOR_COMPARISON.some((entry) => entry.surface === surface), `missing comparison for ${surface}`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <article data-testid="tweet"><div>plain tweet entry</div><div data-testid="placementTracking"></div></article>
        <div data-testid="profile-photo-grid-123"><img src="https://pbs.twimg.com/media/fixture?format=jpg"></div>
      </main>
    `);
    const tested = SURFACE_SELECTORS.filter((entry) => ["Tweet", "Media photo", "Promoted placement"].includes(entry.surface));
    const counts = await page.evaluate((entries) => Object.fromEntries(entries.map((entry) => [entry.surface, document.querySelectorAll(entry.fallback).length])), tested);
    assert.ok(counts.Tweet > 0, "plain tweet fallback must match a structural article");
    assert.ok(counts["Media photo"] > 0, "profile photo grid media fallback must match an image");
    assert.ok(counts["Promoted placement"] > 0, "placement fallback must match the observed ad marker");
  } finally {
    await browser.close();
  }
});

/**
 * What the generated document contains, derived from the route's cell list rather than from the
 * counts it is about to be compared against.
 *
 * The first version measured a set of keys it chose itself and compared each against
 * `observedCounts`. Two things went wrong. The generator filled the sidebar with
 * `observedCounts.carets - observedCounts.posts` fabricated caret buttons, so that comparison was
 * the schema agreeing with itself -- setting the schema to 137 would have injected 128 carets and
 * still passed. And the two counts the generated document genuinely does not reproduce, `cells`
 * and `metricContainers` on the conversation route, were exactly the two keys the measured object
 * left out, so nothing said so.
 */
function expectedFromCells(route) {
  const posts = route.cells.filter((cell) => cell.kind === "post");
  const quotes = posts.filter((cell) => cell.quote);
  return {
    cells: route.cells.length,
    posts: posts.length,
    postTexts: posts.length + quotes.length,
    photos: posts.filter((cell) => cell.media === "photo").length,
    videoPlayers: posts.filter((cell) => cell.media === "video").length,
    videoComponents: posts.filter((cell) => cell.media === "video").length,
    verifiedIcons:
      posts.filter((cell) => cell.verified).length + quotes.filter((cell) => cell.quotedVerified).length,
    authorNames: posts.length + quotes.length,
    placements: posts.filter((cell) => cell.promoted).length,
    userCells: route.cells
      .filter((cell) => cell.kind === "whoToFollow")
      .reduce((total, cell) => total + cell.userCells, 0),
    trends: 4,
    carets: posts.length,
    metricContainers: posts.length * 4
  };
}

test("every generated route matches the composition its cells describe", async () => {
  const schema = await captureSchema();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, route] of Object.entries(schema.routes)) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(await captureUrl(name));
      const measured = await page.evaluate((ids) => {
        const n = (selector) => document.querySelectorAll(selector).length;
        return {
          cells: n(`[data-testid="${ids.cell}"]`),
          posts: n(`[data-testid="${ids.post}"]`),
          postTexts: n(`[data-testid="${ids.postText}"]`),
          photos: n(`[data-testid="${ids.photo}"]`),
          videoPlayers: n(`[data-testid="${ids.videoPlayer}"]`),
          videoComponents: n(`[data-testid="${ids.videoComponent}"]`),
          verifiedIcons: n(`[data-testid="${ids.verifiedIcon}"]`),
          authorNames: n(`[data-testid="${ids.authorName}"]`),
          placements: n(`[data-testid="${ids.placement}"]`),
          userCells: n(`[data-testid="${ids.userCell}"]`),
          trends: n(`[data-testid="${ids.trend}"]`),
          carets: n(`[data-testid="${ids.caret}"]`),
          metricContainers: n(`[data-testid="${ids.metricContainer}"]`)
        };
      }, schema.testIds);
      await page.close();

      // The document has to match what the cell list says it should be. Neither side is derived
      // from the other, so this can fail.
      assert.deepEqual(measured, expectedFromCells(route), `${name}: generated document does not match its cells`);

      // And every count the capture recorded has to be accounted for, exactly or with a reason.
      const observed = route.observedCounts;
      const reproduction = route.reproduction;
      for (const key of Object.keys(observed)) {
        if (key === "$note") continue;
        const rule = reproduction[key];
        assert.ok(rule, `${name}.${key} has no entry in reproduction, so a mismatch would go unsaid`);
        if (rule === "exact") {
          assert.equal(
            measured[key],
            observed[key],
            `${name}.${key}: generated ${measured[key]}, capture recorded ${observed[key]}`
          );
          continue;
        }
        assert.ok(rule.length >= 30, `${name}.${key} needs a real reason, not "${rule}"`);
        assert.ok(
          measured[key] < observed[key],
          `${name}.${key} claims to reproduce fewer than the capture, but generated ${measured[key]} against ${observed[key]}`
        );
      }
      for (const key of Object.keys(reproduction)) {
        if (key === "$comment") continue;
        assert.ok(key in observed, `${name}.${key} is described in reproduction but never observed`);
      }
    }
  } finally {
    await browser.close();
  }
});

test("the head and post facts features read are recorded, not decoration", async () => {
  // These three assertions used to read a real saved page: evidence that X still shipped the thing
  // the feature depends on. Against a generated document they would only prove the generator has a
  // string in it, so the schema records each fact and the document has to carry what it recorded.
  const schema = await captureSchema();
  assert.equal(typeof schema.observedHead.iconRel, "string");
  assert.ok(schema.observedHead.iconRel.length > 0);
  assert.ok(schema.observedHead.iconHref.startsWith("https://"));
  assert.equal(typeof schema.observedHead.timeAttribute, "string");

  for (const [name, route] of Object.entries(schema.routes)) {
    const html = await captureHtml(name);
    assert.ok(
      html.includes(`<link rel="${schema.observedHead.iconRel}"`),
      `${name} must carry the icon link the schema recorded`
    );
    assert.ok(
      html.includes(`<${"time"} ${schema.observedHead.timeAttribute}=`),
      `${name} must carry the time attribute the schema recorded`
    );
    assert.ok(html.includes(`lang="${route.lang}"`), `${name} must carry the recorded document language`);
  }

  // A route that lost its recorded language must stop the generator rather than render
  // `lang="undefined"` into a document a test then matches.
  const broken = structuredClone(await readDomSchema());
  delete broken.routes.home.lang;
  assert.throws(() => generateCaptureDocument(broken, "home"), /missing lang/);
});
