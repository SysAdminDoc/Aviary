import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("CSV export neutralizes spreadsheet formulas in attacker-controlled text", async () => {
  const { formatExport } = await importSourceModule("src/features/export/formatters.ts");

  const csv = new TextDecoder().decode(
    formatExport("csv", [
      record({ text: '=HYPERLINK("http://evil.example","click")' }),
      record({ text: "+1234567890", handle: "-lead" }),
      record({ text: "@SUM(A1:A2)" }),
      record({ text: "ordinary text, with a comma" })
    ]).data
  );

  const lines = csv.trim().split("\n");
  assert.ok(lines[1].includes(`'=HYPERLINK`), "leading = must be escaped to a literal");
  assert.ok(lines[2].includes("'+1234567890"), "leading + must be escaped");
  assert.ok(lines[2].includes("'-lead"), "leading - must be escaped");
  assert.ok(lines[3].includes("'@SUM(A1:A2)"), "leading @ must be escaped");
  assert.ok(!lines[4].includes("'ordinary"), "safe text must not be altered");
  // Quoting still applies for embedded commas.
  assert.ok(lines[4].includes('"ordinary text, with a comma"'));
});

test("HTML export drops non-http(s) hrefs instead of emitting them", async () => {
  const { formatExport } = await importSourceModule("src/features/export/formatters.ts");

  const html = new TextDecoder().decode(
    formatExport("html", [
      {
        ...record({ text: "hi" }),
        permalink: "javascript:alert(1)//status/1234567",
        media: [{ kind: "photo", url: "javascript:alert(2)" }]
      },
      {
        ...record({ text: "ok" }),
        permalink: "https://x.com/a/status/1234567",
        media: [{ kind: "photo", url: "https://pbs.twimg.com/media/abc?name=orig" }]
      }
    ]).data
  );

  assert.ok(!/href="javascript:/i.test(html), "javascript: URLs must never reach the export");
  assert.ok(html.includes('href="https://x.com/a/status/1234567"'));
  assert.ok(html.includes("https://pbs.twimg.com/media/abc?name=orig"));
});

test("XLSX export strips XML-illegal control characters", async () => {
  const { formatXlsx } = await importSourceModule("src/features/export/xlsx.ts");
  const { readStoreZip } = await importSourceModule("src/features/export/zip-reader.ts");

  const artifact = formatXlsx([record({ text: `bad${String.fromCharCode(7)}bell` })]);
  const sheet = readStoreZip(artifact.data).find((entry) =>
    entry.filename === "xl/worksheets/sheet1.xml"
  );
  const xml = new TextDecoder().decode(sheet.data);

  assert.ok(xml.includes("badbell"), "surrounding text is preserved");
  assert.ok(!xml.includes(String.fromCharCode(7)), "the control character must be gone");
  // Inline strings are never treated as formulas, so an = prefix is safe here.
  assert.ok(xml.includes('t="inlineStr"'));
});

test("normalizeImageUrl honours the preferOriginalImages preference", async () => {
  const { normalizeImageUrl } = await importSourceModule("src/features/media/urls.ts");
  const served = "https://pbs.twimg.com/media/ABCDEFGH?format=jpg&name=small";

  assert.equal(normalizeImageUrl(served).url.includes("name=orig"), true, "default stays original quality");
  assert.equal(
    normalizeImageUrl(served, { preferOriginal: true }).url.includes("name=orig"),
    true
  );

  const kept = normalizeImageUrl(served, { preferOriginal: false });
  assert.ok(kept.url.includes("name=small"), "served size is kept when the toggle is off");
  assert.ok(!kept.url.includes("name=orig"));

  // A URL with no name param still gets a sane bound rather than the raw thumbnail.
  const noName = normalizeImageUrl("https://pbs.twimg.com/media/ABCDEFGH?format=png", {
    preferOriginal: false
  });
  assert.ok(noName.url.includes("name=large"));
  assert.equal(noName.format, "png");
});

function record(overrides = {}) {
  return {
    tweetId: "1234567890",
    handle: "someone",
    displayName: "Some One",
    text: "hello",
    capturedAt: "2026-08-06T00:00:00.000Z",
    surface: "home",
    media: [],
    permalink: "https://x.com/someone/status/1234567890",
    ...overrides
  };
}
