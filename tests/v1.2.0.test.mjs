import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("buildWarcArchive emits ISO-28500 WARC/1.1 headers and a metadata record", async () => {
  const { buildWarcArchive, formatRecord } = await importBundledModule(
    "src/features/export/warc.ts"
  );

  const records = [
    {
      tweetId: "1",
      handle: "alpha",
      displayName: "Alpha",
      text: "hello",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      permalink: "https://x.com/alpha/status/1",
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/foo?name=orig", type: "jpg" }]
    }
  ];
  const artifact = buildWarcArchive(records);
  assert.equal(artifact.filename, "tweets.warc");
  assert.equal(artifact.contentType, "application/warc");
  const text = new TextDecoder().decode(artifact.data);
  assert.match(text, /^WARC\/1\.1/);
  assert.match(text, /WARC-Type: metadata/);
  assert.match(text, /WARC-Type: resource/);
  assert.match(text, /metadata:\/\/aviary/);
  assert.match(text, /https:\/\/x\.com\/alpha\/status\/1/);

  const block = formatRecord({ url: "https://example.com/", mime: "text/plain", body: "hi" });
  const decoded = new TextDecoder().decode(block);
  assert.match(decoded, /Content-Length: 2/);
  assert.match(decoded, /WARC-Target-URI: https:\/\/example\.com\//);
});

test("renderForExternalTarget produces Obsidian frontmatter and Notion headings", async () => {
  const { renderForExternalTarget } = await importBundledModule(
    "src/features/export/external-targets.ts"
  );

  const records = [
    {
      tweetId: "42",
      handle: "alpha",
      displayName: "Alpha",
      text: "Multi\nline\nbody",
      capturedAt: "2026-05-19T12:00:00Z",
      surface: "home",
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/foo?name=orig", type: "jpg" }],
      permalink: "https://x.com/alpha/status/42"
    }
  ];

  const clipboard = renderForExternalTarget("clipboard-markdown", records);
  assert.equal(clipboard.id, "clipboard-markdown");
  assert.ok(clipboard.payload);
  assert.match(clipboard.payload, /^# Aviary clipboard export/);
  assert.match(clipboard.payload, /@alpha/);

  const obsidian = renderForExternalTarget("obsidian", records);
  assert.ok(obsidian.artifact);
  const obsidianText = new TextDecoder().decode(obsidian.artifact.data);
  assert.match(obsidianText, /^---/);
  // Quoted since v1.9.0: frontmatter scalars are scraped page text and must not be able to
  // break or extend the block. Quoting also keeps a 19-digit tweet id a string -- YAML would
  // otherwise parse it as a number and lose the low digits.
  assert.match(obsidianText, /tweet_id: "42"/);
  assert.match(obsidianText, /#aviary/);

  const notion = renderForExternalTarget("notion", records);
  assert.ok(notion.artifact);
  const notionText = new TextDecoder().decode(notion.artifact.data);
  assert.match(notionText, /^# Aviary export/);
  assert.match(notionText, /## Alpha · @alpha/);

  const json = renderForExternalTarget("raw-json", records);
  assert.ok(json.artifact);
  const parsed = JSON.parse(new TextDecoder().decode(json.artifact.data));
  assert.equal(parsed.records[0].tweetId, "42");
});

test("AI_COMMANDS prompt templates do not invent sources or leak text outside the prompt body", async () => {
  const { AI_COMMANDS } = await importBundledModule(
    "src/features/ai/command-menu.ts"
  );
  assert.equal(AI_COMMANDS.length, 4);
  for (const command of AI_COMMANDS) {
    const prompt = command.promptTemplate("The OG sample text @alpha #demo");
    assert.match(prompt, /The OG sample text @alpha #demo/);
    assert.ok(prompt.length > 30);
  }
  const factcheck = AI_COMMANDS.find((c) => c.id === "factcheck");
  assert.match(factcheck.promptTemplate("sample"), /Do not invent sources/);
});

async function importBundledModule(relativePath) {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-v12-"));
  const outfile = path.join(temp, "module.mjs");
  try {
    await build({
      entryPoints: [path.join(root, relativePath)],
      outfile,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });
    return await import(`${pathToFileURL(outfile).href}?cache=${Date.now()}-${Math.random()}`);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}
