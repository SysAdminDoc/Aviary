import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 as nodeCrc32 } from "node:zlib";
import { test } from "node:test";

/**
 * Builds a ZIP the way a normal zip tool would.
 *
 * Deliberately written with Node's zlib and its own CRC rather than Aviary's writer: a fixture
 * produced by the code under test proves only that it agrees with itself, and Aviary's writer
 * never compresses, which is exactly the case that was broken.
 */
function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const content = encoder.encode(file.content);
    const deflate = file.method === 8;
    const stored = deflate ? new Uint8Array(deflateRawSync(Buffer.from(content))) : content;
    const crc = nodeCrc32(Buffer.from(content)) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, deflate ? 8 : 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, content.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    chunks.push(local, stored);

    const centralEntry = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralEntry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, deflate ? 8 : 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, content.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralEntry.set(nameBytes, 46);
    central.push(centralEntry);

    offset += local.length + stored.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const entry of central) {
    chunks.push(entry);
    centralSize += entry.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  chunks.push(eocd);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

const TWEETS_JS = `window.YTD.tweets.part0 = ${JSON.stringify([
  {
    tweet: {
      id_str: "1750000000000000001",
      full_text: "A deflated post from the official archive.",
      created_at: "Tue Jan 16 12:00:00 +0000 2026"
    }
  }
])}`;

test("a DEFLATE-compressed archive — what X actually ships — imports", async () => {
  const { importOfficialArchive } = await importSourceModule(
    "src/features/library/archive-import.ts"
  );

  const archive = buildZip([{ name: "data/tweets.js", content: TWEETS_JS, method: 8 }]);
  const result = await importOfficialArchive(archive, "archive");

  assert.deepEqual(result.errors, [], "a standard zip must not error");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].text, "A deflated post from the official archive.");
  assert.equal(result.records[0].tweetId, "1750000000000000001");
  assert.deepEqual(result.warnings, [], "the CRC must verify against the inflated bytes");
});

test("archive repair expands only known links and labels known or unresolved participant ids", async () => {
  const { importOfficialArchive } = await importSourceModule(
    "src/features/library/archive-import.ts"
  );
  const assign = (name, value) => `window.YTD.${name}.part0 = ${JSON.stringify(value)}`;
  const archive = buildZip([
    {
      name: "data/tweets.js",
      content: assign("tweets", [
        {
          tweet: {
            id_str: "repair-1",
            full_text:
              "Archive https://t.co/fromArchive corpus https://t.co/fromCorpus unknown https://t.co/unknown unsafe https://t.co/unsafe",
            created_at: "Tue Jan 16 12:00:00 +0000 2026",
            entities: {
              urls: [
                {
                  url: "https://t.co/fromArchive",
                  expanded_url: "https://example.test/from-archive"
                },
                {
                  url: "https://t.co/unsafe",
                  expanded_url: "javascript:alert(1)"
                }
              ],
              user_mentions: [
                { id_str: "43" },
                { id_str: "88" }
              ]
            }
          }
        }
      ]),
      method: 8
    },
    {
      name: "data/direct-messages.js",
      content: assign("direct_messages", [
        {
          dmConversation: {
            conversationId: "43-99",
            messages: [
              {
                messageCreate: {
                  id: "message-repair-1",
                  senderId: "43",
                  recipientId: "99",
                  text: "Private message"
                }
              }
            ]
          }
        }
      ])
    }
  ]);
  const corpus = [
    {
      tweetId: null,
      handle: null,
      displayName: null,
      text: JSON.stringify({
        data: {
          user: { result: { rest_id: "43", legacy: { screen_name: "known_handle" } } },
          tweet: {
            legacy: {
              entities: {
                urls: [
                  {
                    url: "https://t.co/fromCorpus",
                    expanded_url: "https://example.test/from-corpus"
                  },
                  {
                    url: "https://t.co/fromArchive",
                    expanded_url: "https://example.test/stale-corpus-value"
                  }
                ]
              }
            }
          }
        }
      }),
      capturedAt: "2026-01-15T00:00:00.000Z",
      surface: "graphql:HomeTimeline",
      media: [],
      permalink: null
    }
  ];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("archive repair must stay offline");
  };

  try {
    const result = await importOfficialArchive(archive, "archive", corpus);

    assert.equal(fetchCalls, 0, "repair must never originate a request");
    assert.equal(
      result.records[0].text,
      "Archive https://example.test/from-archive corpus https://example.test/from-corpus unknown https://t.co/unknown unsafe https://t.co/unsafe"
    );
    assert.equal(result.records[0].handle, null, "a mentioned account must not be invented as the author");
    assert.deepEqual(result.records[0].participants, [
      { id: "43", handle: "known_handle", label: "@known_handle (user ID 43)", role: "mention" },
      { id: "88", handle: null, label: "Unresolved user ID 88", role: "mention" }
    ]);
    assert.deepEqual(result.collections.directMessages[0].sender, {
      id: "43",
      handle: "known_handle",
      label: "@known_handle (user ID 43)"
    });
    assert.deepEqual(result.collections.directMessages[0].recipients, [
      { id: "99", handle: null, label: "Unresolved user ID 99" }
    ]);
    assert.deepEqual(result.repairs, {
      archiveLinksExpanded: 1,
      corpusLinksExpanded: 1,
      participantIdsResolved: 1,
      participantIdsUnresolved: 2
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("archive repair ignores malformed and non-GraphQL checkpoint evidence", async () => {
  const { ArchiveRepairIndex } = await importSourceModule(
    "src/features/library/archive-repair.ts"
  );
  const index = new ArchiveRepairIndex([
    { surface: null, text: "{broken" },
    {
      surface: "graphql:HomeTimeline",
      text: "{broken",
      expandedUrls: [{
        shortUrl: "https://t.co/poison",
        destination: "https://poison.example/wrong",
        source: "local-corpus"
      }]
    },
    {
      surface: "archive",
      text: "ordinary checkpoint",
      expandedUrls: [{
        shortUrl: "https://t.co/poison",
        destination: "https://stale.example/wrong",
        source: "local-corpus"
      }]
    }
  ]);
  const records = [{
    tweetId: "repair-boundary",
    handle: null,
    displayName: null,
    text: "Keep https://t.co/poison",
    capturedAt: "2026-08-21T00:00:00.000Z",
    surface: "archive.tweets",
    media: [],
    permalink: null
  }];
  const collections = {
    profile: null,
    account: null,
    directMessages: [],
    media: [],
    followers: [],
    following: [],
    lists: []
  };

  const summary = index.repair(records, collections);
  assert.equal(records[0].text, "Keep https://t.co/poison");
  assert.equal(summary.corpusLinksExpanded, 0);
});

test("official archive collection files are classified, typed, and reported before commit", async () => {
  const { importOfficialArchive } = await importSourceModule(
    "src/features/library/archive-import.ts"
  );
  const assign = (name, value) => `window.YTD.${name}.part0 = ${JSON.stringify(value)}`;
  const archive = buildZip([
    {
      name: "data/tweets.js",
      content: TWEETS_JS,
      method: 8
    },
    {
      name: "data/direct-messages.js",
      content: assign("direct_messages", [
        {
          dmConversation: {
            conversationId: "conversation-1",
            messages: [
              {
                messageCreate: {
                  id: "message-1",
                  senderId: "sender-1",
                  recipientId: "recipient-1",
                  text: "A private archive message.",
                  createdAt: "2026-01-16T12:01:00.000Z"
                }
              }
            ]
          }
        }
      ])
    },
    {
      name: "data/media.js",
      content: assign("media", [
        {
          uploadMedia: {
            mediaId: "media-1",
            mediaUrl: "https://pbs.twimg.com/media/example.jpg"
          }
        }
      ])
    },
    {
      name: "data/follower.js",
      content: assign("follower", [
        { follower: { accountId: "follower-1", userLink: "https://twitter.com/alice" } }
      ])
    },
    {
      name: "data/following.js",
      content: assign("following", [
        { following: { accountId: "following-1", userLink: "https://x.com/bob" } }
      ])
    },
    {
      name: "data/lists.js",
      content: assign("lists", [
        { "lists-list": { listId: "list-1", name: "Research", description: "Useful accounts" } }
      ])
    },
    {
      name: "data/profile.js",
      content: assign("profile", [
        { profile: { screenName: "aviary", name: "Aviary", description: "Local first" } }
      ])
    },
    {
      name: "data/account.js",
      content: assign("account", [
        { account: { accountId: "account-1", username: "aviary", email: "local@example.test" } }
      ])
    },
    { name: "data/like.js", content: "window.YTD.like.part0 = not-json" },
    { name: "data/manifest.js", content: "window.__THAR_CONFIG = {};" }
  ]);

  const result = await importOfficialArchive(archive, "archive");

  assert.equal(result.records.length, 1, "authored posts retain the existing searchable path");
  assert.equal(result.collections.directMessages.length, 1);
  assert.deepEqual(result.collections.directMessages[0].recipientIds, ["recipient-1"]);
  assert.equal(result.collections.media[0].url, "https://pbs.twimg.com/media/example.jpg");
  assert.equal(result.collections.followers[0].handle, "alice");
  assert.equal(result.collections.following[0].handle, "bob");
  assert.equal(result.collections.lists[0].id, "list-1");
  assert.equal(result.collections.profile?.handle, "aviary");
  assert.equal(result.collections.account?.email, "local@example.test");
  assert.equal(result.recognizedFiles.length, 9);
  assert.deepEqual(result.skippedFiles, ["data/manifest.js"]);
  assert.deepEqual(result.malformedFiles, ["data/like.js"]);
  assert.ok(result.warnings.some((warning) => warning.includes("data/like.js")));
});

test("STORE entries still read, and mixed archives read both", async () => {
  const { readZip } = await importSourceModule("src/features/export/zip-reader.ts");

  const archive = buildZip([
    { name: "data/tweets.js", content: TWEETS_JS, method: 8 },
    { name: "data/manifest.js", content: "window.__THAR_CONFIG = {};", method: 0 }
  ]);
  const entries = await readZip(archive);

  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.crcOk, true, `${entry.filename} failed its CRC check`);
  }
  assert.match(new TextDecoder().decode(entries[1].data), /__THAR_CONFIG/);
});

test("readStoreZip still refuses compressed entries rather than returning garbage", async () => {
  const { readStoreZip, UnsupportedZipMethodError } = await importSourceModule(
    "src/features/export/zip-reader.ts"
  );

  const archive = buildZip([{ name: "data/tweets.js", content: TWEETS_JS, method: 8 }]);
  assert.throws(() => readStoreZip(archive), (error) => error instanceof UnsupportedZipMethodError);
});

test("a corrupted deflate stream is reported, not silently dropped", async () => {
  const { importOfficialArchive } = await importSourceModule(
    "src/features/library/archive-import.ts"
  );

  const archive = buildZip([{ name: "data/tweets.js", content: TWEETS_JS, method: 8 }]);
  // Corrupt the middle of the deflate stream, past the local header.
  archive[60] = archive[60] ^ 0xff;
  archive[61] = archive[61] ^ 0xff;

  const result = await importOfficialArchive(archive, "archive");
  assert.ok(
    result.errors.length > 0 || result.warnings.length > 0,
    "a broken archive must say so rather than importing zero records silently"
  );
});

test("ZIP inflation rejects an entry whose declared expansion exceeds the safety limit", async () => {
  const { readZip, ZipLimitError, ZIP_LIMITS } = await importSourceModule(
    "src/features/export/zip-reader.ts"
  );
  const archive = buildZip([
    {
      name: "data/oversized.js",
      content: "x".repeat(ZIP_LIMITS.maxEntryUncompressedBytes + 1),
      method: 8
    }
  ]);
  await assert.rejects(() => readZip(archive), (error) => error instanceof ZipLimitError);
});

test("archive import jobs rehydrate interrupted source and release it after completion", async () => {
  const { ArchiveImportJobStore, ARCHIVE_IMPORT_JOBS_KEY } = await importSourceModule(
    "src/features/library/archive-import-jobs.ts"
  );
  const source = new Uint8Array([0, 1, 2, 253, 254, 255]);
  const store = new Map();
  const storage = {
    async get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async set(key, value) {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    async remove(key) {
      store.delete(key);
    }
  };

  const jobs = new ArchiveImportJobStore(storage);
  const started = await jobs.start("fixture.zip", source);
  assert.deepEqual(await jobs.source(started.jobId), source);
  await jobs.markRunning(started.jobId);

  const reloaded = new ArchiveImportJobStore(storage);
  await reloaded.load();
  assert.equal(reloaded.get(started.jobId)?.status, "paused");
  assert.equal(reloaded.get(started.jobId)?.resumeOnBoot, true);
  assert.deepEqual(await reloaded.source(started.jobId), source);

  assert.deepEqual(await reloaded.resume(started.jobId), { ok: true });
  assert.deepEqual(await reloaded.cancel(started.jobId), { ok: true });
  assert.equal(await reloaded.complete(started.jobId, {
    filesParsed: 1,
    recordCount: 1,
    warningCount: 0,
    errorCount: 0
  }), false, "cancelled work must not become completed");
  assert.deepEqual(await reloaded.retry(started.jobId), { ok: true });
  assert.equal(await reloaded.complete(started.jobId, {
    filesParsed: 1,
    recordCount: 1,
    warningCount: 0,
    errorCount: 0
  }), true);
  assert.equal(await reloaded.source(started.jobId), null, "completed imports must release their ZIP source");

  const second = await reloaded.start("done.zip", source);
  assert.equal(await reloaded.complete(second.jobId, {
    filesParsed: 1,
    recordCount: 2,
    warningCount: 0,
    errorCount: 0
  }), true);
  assert.equal(await reloaded.source(second.jobId), null, "completed imports must release their ZIP source");
  assert.ok(store.has(ARCHIVE_IMPORT_JOBS_KEY));
});

test("typed archive collections persist separately from searchable tweet records and dedupe", async () => {
  const { ArchiveLibraryStore, ARCHIVE_LIBRARY_KEY } = await importSourceModule(
    "src/features/library/archive-library.ts"
  );
  const persisted = new Map();
  const storage = {
    async get(key, fallback) {
      return persisted.has(key) ? structuredClone(persisted.get(key)) : structuredClone(fallback);
    },
    async set(key, value) {
      persisted.set(key, structuredClone(value));
    },
    async remove(key) {
      persisted.delete(key);
    }
  };
  const collections = {
    profile: { handle: "aviary", displayName: "Aviary", bio: null, location: null, website: null, joinedAt: null },
    account: null,
    directMessages: [
      {
        id: "message-1",
        conversationId: "conversation-1",
        senderId: "43",
        recipientIds: ["99"],
        text: "private",
        createdAt: null,
        mediaUrls: []
      }
    ],
    media: [],
    followers: [],
    following: [],
    lists: []
  };

  const store = new ArchiveLibraryStore(storage);
  await store.merge(collections, "archive-1", {
    archiveLinksExpanded: 2,
    corpusLinksExpanded: 3,
    participantIdsResolved: 1,
    participantIdsUnresolved: 1
  });
  await store.merge(collections, "archive-2");
  assert.equal(store.snapshot().directMessages.length, 1);
  assert.deepEqual(store.snapshot().importedJobs, ["archive-1", "archive-2"]);
  assert.deepEqual(store.snapshot().lastRepair, {
    archiveLinksExpanded: 2,
    corpusLinksExpanded: 3,
    participantIdsResolved: 1,
    participantIdsUnresolved: 1
  });
  const detached = store.snapshot();
  detached.lastRepair.archiveLinksExpanded = 999;
  assert.equal(store.snapshot().lastRepair.archiveLinksExpanded, 2, "repair status must be a detached snapshot");
  assert.ok(persisted.has(ARCHIVE_LIBRARY_KEY));

  const reloaded = new ArchiveLibraryStore(storage);
  await reloaded.load();
  assert.equal(reloaded.snapshot().profile?.handle, "aviary");
  assert.equal(reloaded.snapshot().directMessages[0].text, "private");
  assert.equal(reloaded.snapshot().directMessages[0].sender.label, "Unresolved user ID 43");
  assert.equal(reloaded.snapshot().directMessages[0].recipients[0].label, "Unresolved user ID 99");
});

test("a reimport replaces stale participant repairs for the same direct message", async () => {
  const { ArchiveLibraryStore } = await importSourceModule(
    "src/features/library/archive-library.ts"
  );
  const persisted = new Map();
  const storage = {
    async get(key, fallback) {
      return persisted.has(key) ? structuredClone(persisted.get(key)) : structuredClone(fallback);
    },
    async set(key, value) {
      persisted.set(key, structuredClone(value));
    }
  };
  const message = (handle) => ({
    id: "message-repair-1",
    conversationId: "43-99",
    senderId: "43",
    recipientIds: ["99"],
    text: "private",
    createdAt: null,
    mediaUrls: [],
    sender: { id: "43", handle, label: `@${handle} (user ID 43)` },
    recipients: [{ id: "99", handle: null, label: "Unresolved user ID 99" }]
  });
  const collections = (handle) => ({
    profile: null,
    account: null,
    directMessages: [message(handle)],
    media: [],
    followers: [],
    following: [],
    lists: []
  });
  const store = new ArchiveLibraryStore(storage);

  await store.merge(collections("stale_handle"), "archive-old");
  await store.merge(collections("archive_handle"), "archive-new", {
    archiveLinksExpanded: 0,
    corpusLinksExpanded: 0,
    participantIdsResolved: 1,
    participantIdsUnresolved: 1
  });

  assert.equal(store.snapshot().directMessages[0].sender.handle, "archive_handle");
  assert.equal(store.snapshot().lastRepair.participantIdsResolved, 1);
});

test("typed archive collection writes do not mutate the live snapshot when persistence fails", async () => {
  const { ArchiveLibraryStore } = await importSourceModule(
    "src/features/library/archive-library.ts"
  );
  const storage = {
    async get(key, fallback) {
      return structuredClone(fallback);
    },
    async set() {
      throw new Error("quota exhausted");
    },
    async remove() {}
  };
  const store = new ArchiveLibraryStore(storage);
  await assert.rejects(
    () => store.merge({
      profile: { handle: "should-not-stick", displayName: null, bio: null, location: null, website: null, joinedAt: null },
      account: null,
      directMessages: [],
      media: [],
      followers: [],
      following: [],
      lists: []
    }, "archive-failed"),
    /quota exhausted/
  );
  assert.equal(store.snapshot().profile, null);
});

test("a progress tick no longer rewrites the archive it is reporting on", async () => {
  const { ArchiveImportJobStore, ARCHIVE_IMPORT_JOBS_KEY } = await importSourceModule(
    "src/features/library/archive-import-jobs.ts"
  );

  // A 2 MiB archive is enough to make the difference unmistakable without slowing the suite.
  const source = new Uint8Array(2 * 1024 * 1024);
  source.fill(7);

  let bytesWritten = 0;
  const values = new Map();
  const storage = {
    async get(key, fallback) {
      return values.has(key) ? structuredClone(values.get(key)) : fallback;
    },
    async set(key, value) {
      bytesWritten += JSON.stringify(value).length;
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    }
  };

  const jobs = new ArchiveImportJobStore(storage);
  const started = await jobs.start("archive.zip", source);

  const afterStart = bytesWritten;
  for (let tick = 1; tick <= 10; tick += 1) {
    await jobs.updateProgress(started.jobId, { filesParsed: tick, recordCount: tick * 100 });
  }
  const perTick = (bytesWritten - afterStart) / 10;

  assert.ok(
    perTick < source.byteLength / 10,
    `each progress tick wrote ${Math.round(perTick)} bytes; the archive is ${source.byteLength}`
  );
  // And the record itself must not be carrying the payload around.
  const record = values.get(ARCHIVE_IMPORT_JOBS_KEY);
  assert.equal(record.jobs[started.jobId].source, "", "the job record must not hold the archive");
  assert.deepEqual(await jobs.source(started.jobId), source, "the archive is still retrievable");
});

test("an un-prefixed archive entry containing '=' is not destroyed by prefix stripping", async () => {
  const { importOfficialArchive } = await importSourceModule("src/features/library/archive-import.ts");
  const { buildStoreZip } = await importSourceModule("src/features/export/zip-store.ts");
  const encoder = new TextEncoder();

  // Pure JSON, no `window.YTD` prefix, carrying base64 padding and a query string. The old
  // `^[^=]*=` pattern ate everything up to the first `=` anywhere, so this arrived as malformed.
  const tweets = JSON.stringify([
    { tweet: { id_str: "1", full_text: "media aGVsbG8= and https://x.com/i?a=b", created_at: "Wed Aug 12 00:00:00 +0000 2026" } }
  ]);
  const archive = buildStoreZip([{ filename: "data/tweets.js", data: encoder.encode(tweets) }]);

  const result = await importOfficialArchive(archive, "archive");
  assert.equal(result.records.length, 1, "the entry must parse rather than be reported malformed");
  assert.match(result.records[0].text, /aGVsbG8=/, "its content must survive intact");
});
