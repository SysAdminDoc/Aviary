import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abs = (file) => path.resolve(root, file).replace(/\\/g, "/");

async function loadBundle() {
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-bookmark-capture-"));
  const entry = path.join(temp, "entry.ts");
  const output = path.join(temp, "module.mjs");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(
    entry,
    [
      `export * from ${JSON.stringify(abs("src/features/library/bookmark-capture.ts"))};`,
      `export * from ${JSON.stringify(abs("src/features/library/bookmarks.ts"))};`
    ].join("\n"),
    "utf8"
  ));
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "silent"
  });
  const module = await import(`${pathToFileURL(output).href}?v=${Date.now()}-${Math.random()}`);
  return { module, cleanup: () => rm(temp, { recursive: true, force: true }) };
}

test("bookmark GraphQL parsing keeps only tweet records and never fetches media", async () => {
  const { module, cleanup } = await loadBundle();
  try {
    const response = {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [{
              entries: [{
                bookmark_created_at: "2026-08-21T12:34:56Z",
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        rest_id: "1001",
                        legacy: {
                          id_str: "1001",
                          full_text: "Saved from the bookmark feed",
                          created_at: "Thu Aug 21 10:00:00 +0000 2026"
                        },
                        core: {
                          user_results: {
                            result: { legacy: { screen_name: "Alice" } }
                          }
                        },
                        quoted_status_result: {
                          result: {
                            rest_id: "1001",
                            legacy: { id_str: "1001", full_text: "duplicate quote" }
                          }
                        }
                      }
                    }
                  }
                }
              }]
            }]
          }
        }
      }
    };
    const records = module.parseCapturedBookmarks(
      JSON.stringify(response),
      "Bookmarks",
      "2026-08-21T12:35:00Z",
      "https://x.com/i/api/graphql/Bookmarks"
    );
    assert.deepEqual(records, [{
      tweetId: "1001",
      handle: "alice",
      text: "Saved from the bookmark feed",
      url: "https://x.com/alice/status/1001",
      capturedAt: "2026-08-21T12:34:56.000Z",
      sourceOperation: "Bookmarks"
    }]);
    assert.deepEqual(module.parseCapturedBookmarks("{}", "HomeTimeline", "2026-08-21T12:35:00Z"), []);
  } finally {
    await cleanup();
  }
});

test("mirrored bookmarks preserve user metadata and export both formats", async () => {
  const { module, cleanup } = await loadBundle();
  try {
    const data = new Map();
    const storage = {
      async get(key, fallback) {
        return data.has(key) ? structuredClone(data.get(key)) : structuredClone(fallback);
      },
      async set(key, value) {
        data.set(key, structuredClone(value));
      },
      async remove(key) {
        data.delete(key);
      }
    };
    const store = new module.BookmarkStore(storage);
    await store.upsert({
      tweetId: "1001",
      handle: "alice",
      text: "manual copy",
      tags: ["reading"],
      folder: "later",
      notes: "keep this note"
    });
    const mirrored = await store.mirror([
      {
        tweetId: "1001",
        handle: "alice",
        text: "updated from X",
        url: "https://x.com/alice/status/1001",
        capturedAt: "2026-08-21T12:34:56Z",
        sourceOperation: "Bookmarks"
      },
      {
        tweetId: "1002",
        handle: "bob",
        text: "=|formula",
        capturedAt: "2026-08-21T12:35:56Z",
        sourceOperation: "BookmarkFolderTimeline"
      }
    ]);
    assert.equal(mirrored, 2);
    const entries = store.list();
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.find((entry) => entry.tweetId === "1001"), {
      ...entries.find((entry) => entry.tweetId === "1001"),
      text: "updated from X",
      tags: ["reading"],
      folder: "later",
      notes: "keep this note",
      source: "captured",
      sourceOperation: "Bookmarks"
    });
    const artifacts = module.buildBookmarkExportArtifacts(entries);
    assert.equal(artifacts.length, 2);
    assert.match(new TextDecoder().decode(artifacts[0].data), /"count": 2/);
    assert.match(new TextDecoder().decode(artifacts[1].data), /sourceOperation/);
    assert.match(new TextDecoder().decode(artifacts[1].data), /'=\|formula/);
  } finally {
    await cleanup();
  }
});
