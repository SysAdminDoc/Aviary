import assert from "node:assert/strict";
import test from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

test("post language is canonicalized at the boundary and invalid tags become null", async () => {
  const { normalizePostLanguage } = await importSourceModule("src/features/export/language.ts");
  assert.equal(normalizePostLanguage("AR"), "ar");
  assert.equal(normalizePostLanguage("zh-hant-tw"), "zh-Hant-TW");
  assert.equal(normalizePostLanguage("ja"), "ja");
  assert.equal(normalizePostLanguage("not a language"), null);
  assert.equal(normalizePostLanguage("<script>alert(1)</script>"), null);
  assert.equal(normalizePostLanguage("en_US"), null);
});

test("GraphQL language survives capture and every portable representation", async () => {
  const { parseCapturedThreadRecords } = await importSourceModule("src/features/export/thread-capture.ts");
  const { formatExport } = await importSourceModule("src/features/export/formatters.ts");
  const { buildWarcArchive } = await importSourceModule("src/features/export/warc.ts");
  const { buildExportViewer } = await importSourceModule("src/features/export/viewer.ts");
  const body = JSON.stringify({
    data: {
      home: {
        instructions: [{
          entries: [{
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    rest_id: "1",
                    legacy: {
                      full_text: "שלום, @alice!",
                      lang: "he",
                      created_at: "Wed Aug 22 12:00:00 +0000 2026"
                    },
                    core: { user_results: { result: { legacy: { screen_name: "bob", name: "Bob" } } } }
                  }
                }
              }
            }
          }]
        }]
      }
    }
  });
  const captured = parseCapturedThreadRecords(body, "HomeTimeline", "2026-09-07T12:00:00Z");
  assert.equal(captured[0].language, "he");
  const invalid = [{
    ...captured[0],
    language: "<b>bad</b>",
    text: "مرحبا, @alice!"
  }];
  const json = JSON.parse(new TextDecoder().decode(formatExport("json", invalid).data));
  assert.equal(json.records[0].language, null);
  const csv = new TextDecoder().decode(formatExport("csv", captured).data);
  assert.match(csv, /language,audience/);
  assert.match(csv, /,he,/);
  const html = new TextDecoder().decode(formatExport("html", captured).data);
  assert.match(html, /<html lang="en" dir="ltr">/);
  assert.match(html, /<p lang="he" dir="auto"><bdi dir="auto">שלום, @alice!<\/bdi><\/p>/);
  const markdown = new TextDecoder().decode(formatExport("markdown", captured).data);
  assert.match(markdown, /---\nlanguage: he\n---/);
  assert.ok(!markdown.includes("<bdi>"));
  const warc = new TextDecoder().decode(buildWarcArchive(captured).data);
  assert.match(warc, /<html lang="en" dir="ltr">/);
  assert.match(warc, /<p lang="he" dir="auto"><bdi dir="auto">שלום, @alice!<\/bdi><\/p>/);
  const viewer = new TextDecoder().decode(buildExportViewer(captured));
  assert.match(viewer, /"language":"he"/);
  assert.match(viewer, /body\.dir = "auto"/);
});

test("archive language fields retain Arabic, Japanese, Thai, and invalid values safely", async () => {
  const { buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
  const { importOfficialArchive } = await importSourceModule("src/features/library/archive-import.ts");
  const payload = new TextEncoder().encode(JSON.stringify([
    { tweet: { id_str: "ar", full_text: "مرحبا", lang: "ar" } },
    { tweet: { id_str: "ja", full_text: "こんにちは", lang: "ja" } },
    { tweet: { id_str: "th", full_text: "สวัสดี", lang: "th" } },
    { tweet: { id_str: "bad", full_text: "bad", lang: "<invalid>" } }
  ]));
  const archive = buildStoreZip([
    { filename: "data/tweets.js", data: new TextEncoder().encode(`window.YTD.tweets.part0 = ${new TextDecoder().decode(payload)}`) }
  ]);
  const result = await importOfficialArchive(archive);
  assert.deepEqual(result.records.map((record) => record.language), ["ar", "ja", "th", null]);
});
