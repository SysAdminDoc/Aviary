import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const GENERATED = new Date("2026-09-07T10:30:00Z");

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

function records() {
  return [
    {
      tweetId: "9",
      handle: "archivist",
      displayName: "Archivist",
      text: "the root of the thread",
      capturedAt: "2026-08-12T12:00:00Z",
      createdAt: "2026-08-11T09:15:00Z",
      surface: "home",
      permalink: "https://x.com/archivist/status/9",
      conversationId: "9",
      rootId: "9",
      language: "en",
      audience: "public",
      media: [
        {
          kind: "photo",
          url: "https://pbs.twimg.com/media/kept.png",
          captureStatus: "captured-bytes",
          type: "image/png",
          altText: "a kept picture",
          width: 1,
          height: 1,
          assetPath: "media/000001-photo.png"
        },
        {
          kind: "photo",
          url: "https://pbs.twimg.com/media/missing.jpg",
          captureStatus: "remote-reference"
        }
      ]
    },
    {
      tweetId: "10",
      handle: "archivist",
      displayName: "Archivist",
      text: "the reply",
      capturedAt: "2026-08-12T12:01:00Z",
      createdAt: "2026-08-11T09:20:00Z",
      surface: "home",
      permalink: "https://x.com/archivist/status/10",
      parentId: "9",
      conversationId: "9",
      rootId: "9",
      audience: "public",
      media: []
    },
    {
      // Its parent was never captured, so the outbox has to say the parent existed.
      tweetId: "11",
      handle: "elsewhere",
      displayName: "Elsewhere",
      text: "a reply to something this archive never got",
      capturedAt: "2026-08-12T12:02:00Z",
      createdAt: "2026-08-11T10:00:00Z",
      surface: "home",
      permalink: "https://x.com/elsewhere/status/11",
      parentId: "5",
      conversationId: "5",
      rootId: "5",
      audience: "public",
      media: []
    }
  ];
}

test("the outbox is a valid AS2 OrderedCollection of Create activities wrapping Notes", async () => {
  const { buildActivityStreamsOutbox } = await importSourceModule("src/features/export/activitystreams.ts");
  const outbox = buildActivityStreamsOutbox(records(), { generatedAt: GENERATED, id: "urn:x-aviary:outbox:test" });

  assert.equal(outbox["@context"], "https://www.w3.org/ns/activitystreams");
  assert.equal(outbox.type, "OrderedCollection");
  assert.equal(outbox.id, "urn:x-aviary:outbox:test");
  assert.equal(outbox.published, "2026-09-07T10:30:00.000Z");
  assert.equal(outbox.totalItems, outbox.orderedItems.length);

  const creates = outbox.orderedItems.filter((item) => item.type === "Create");
  assert.equal(creates.length, 3);
  for (const create of creates) {
    assert.equal(create.object.type, "Note");
    assert.ok(create.object.id, JSON.stringify(create));
    assert.ok(create.object.published, JSON.stringify(create));
    assert.ok(create.object.content, JSON.stringify(create));
    assert.ok(create.object.attributedTo, JSON.stringify(create));
    assert.equal(create.actor, create.object.attributedTo);
  }

  const root = creates.find((item) => item.object.id === "https://x.com/archivist/status/9");
  assert.ok(root, JSON.stringify(outbox.orderedItems.map((item) => item.id)));
  assert.equal(root.object.attributedTo, "https://x.com/archivist");
  assert.equal(root.object.published, "2026-08-11T09:15:00.000Z");
  assert.deepEqual(root.object.contentMap, { en: "the root of the thread" });
  assert.equal(root.object.inReplyTo, undefined, "a root post must not claim a parent");

  // inReplyTo resolves to the parent's own address when the parent is in the export, and to its
  // identifier when it is not.
  const reply = creates.find((item) => item.object.id === "https://x.com/archivist/status/10");
  assert.equal(reply.object.inReplyTo, "https://x.com/archivist/status/9");
  const orphan = creates.find((item) => item.object.id === "https://x.com/elsewhere/status/11");
  assert.equal(orphan.object.inReplyTo, "urn:x-aviary:post:5");

  // Attachments: the captured one points into the package, the uncaptured one says it does not.
  assert.equal(root.object.attachment.length, 2);
  const [kept, absent] = root.object.attachment;
  assert.equal(kept.type, "Image");
  assert.equal(kept.url, "media/000001-photo.png");
  assert.equal(kept.mediaType, "image/png");
  assert.equal(kept.name, "a kept picture");
  assert.equal(kept.summary, undefined, "a file in the package needs no excuse");
  assert.equal(absent.url, "https://pbs.twimg.com/media/missing.jpg");
  assert.match(absent.summary, /bytes were not captured/);
});

test("a post the archive never captured is a tombstone rather than a silent hole", async () => {
  const { buildActivityStreamsOutbox } = await importSourceModule("src/features/export/activitystreams.ts");
  const outbox = buildActivityStreamsOutbox(records(), { generatedAt: GENERATED });

  const tombstones = outbox.orderedItems.filter((item) => item.type === "Tombstone");
  assert.equal(tombstones.length, 1, JSON.stringify(outbox.orderedItems.map((item) => item.type)));
  assert.equal(tombstones[0].id, "urn:x-aviary:post:5");
  assert.equal(tombstones[0].formerType, "Note");
  assert.match(tombstones[0].summary, /never captured/);
  // A time the archive does not know must not be invented.
  assert.equal(tombstones[0].deleted, undefined);
  assert.equal(outbox.totalItems, 4, "the tombstone counts toward the collection");

  // Ordered by post id, tombstone included. Appending the tombstones after the posts would put a
  // reply ahead of the post it replies to.
  assert.deepEqual(
    outbox.orderedItems.map((item) => item.object?.id ?? item.id),
    [
      "urn:x-aviary:post:5",
      "https://x.com/archivist/status/9",
      "https://x.com/archivist/status/10",
      "https://x.com/elsewhere/status/11"
    ]
  );

  // Capture the parent and the tombstone goes away, which is what proves it tracked the gap
  // rather than every id that was ever mentioned.
  const complete = buildActivityStreamsOutbox(
    [
      ...records(),
      {
        tweetId: "5",
        handle: "elsewhere",
        displayName: "Elsewhere",
        text: "the parent, captured after all",
        capturedAt: "2026-08-12T12:03:00Z",
        createdAt: "2026-08-11T09:59:00Z",
        surface: "home",
        permalink: "https://x.com/elsewhere/status/5",
        conversationId: "5",
        rootId: "5",
        audience: "public",
        media: []
      }
    ],
    { generatedAt: GENERATED }
  );
  assert.equal(complete.orderedItems.filter((item) => item.type === "Tombstone").length, 0);
  assert.equal(
    complete.orderedItems.find((item) => item.object?.id === "https://x.com/elsewhere/status/11").object.inReplyTo,
    "https://x.com/elsewhere/status/5"
  );
});

test("the outbox states what AS2 is and is not, in the file itself", async () => {
  const { buildActivityStreamsOutbox } = await importSourceModule("src/features/export/activitystreams.ts");
  const outbox = buildActivityStreamsOutbox(records(), { generatedAt: GENERATED });
  assert.match(outbox.summary, /interoperability format/i);
  assert.match(outbox.summary, /not a migration path/i);
  assert.match(outbox.summary, /No major platform currently imports posts/i);
  assert.match(outbox.summary, /Mastodon/);
});

test("a repeated outbox is byte-identical apart from the declared generated time", async () => {
  const { serializeActivityStreamsOutbox } = await importSourceModule("src/features/export/activitystreams.ts");
  const decode = (bytes) => new TextDecoder().decode(bytes);

  const first = decode(serializeActivityStreamsOutbox(records(), { generatedAt: GENERATED }));
  const again = decode(serializeActivityStreamsOutbox(records(), { generatedAt: GENERATED }));
  assert.equal(again, first);

  const shuffled = decode(serializeActivityStreamsOutbox([...records()].reverse(), { generatedAt: GENERATED }));
  assert.equal(shuffled, first, "the outbox must not depend on the order records arrive in");

  const later = decode(serializeActivityStreamsOutbox(records(), { generatedAt: new Date("2027-01-02T03:04:05Z") }));
  assert.notEqual(later, first);
  assert.equal(
    later.replaceAll("2027-01-02T03:04:05.000Z", "2026-09-07T10:30:00.000Z"),
    first,
    "the generated time must be the only difference"
  );
});

test("the export package carries the outbox beside everything else", async () => {
  const { buildExportZip } = await importSourceModule("src/features/export/export-feature.ts");
  const { readZip } = await importSourceModule("src/features/export/zip-reader.ts");
  const withBytes = records().map((record) => ({
    ...record,
    media: record.media.map((media) =>
      media.captureStatus === "captured-bytes" ? { ...media, assetPath: undefined, bytes: PNG } : media
    )
  }));

  const entries = await readZip(await buildExportZip(withBytes, ["json"], "aviary"));
  const outboxEntry = entries.find((entry) => entry.filename === "aviary/outbox.json");
  assert.ok(outboxEntry, entries.map((entry) => entry.filename).join(", "));

  const outbox = JSON.parse(new TextDecoder().decode(outboxEntry.data));
  assert.equal(outbox.type, "OrderedCollection");
  const attachments = outbox.orderedItems.flatMap((item) => item.object?.attachment ?? []);
  const packaged = attachments.filter((entry) => !/^https?:/i.test(entry.url));
  assert.equal(packaged.length, 1, JSON.stringify(attachments));

  // The attachment path names a file that is actually in the ZIP, which is the whole claim.
  const names = new Set(entries.map((entry) => entry.filename));
  assert.ok(names.has(`aviary/${packaged[0].url}`), `${packaged[0].url} is not in the package`);

  // The manifest and the outbox agree about when the export happened.
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.find((entry) => entry.filename === "aviary/manifest.json").data)
  );
  assert.equal(manifest.generatedAt, outbox.published);
});

test("a post captured under another conversation is not tombstoned as missing", async () => {
  const { buildActivityStreamsOutbox } = await importSourceModule("src/features/export/activitystreams.ts");
  const base = {
    handle: "archivist",
    displayName: "Archivist",
    text: "t",
    capturedAt: "2026-08-12T12:00:00Z",
    surface: "home",
    permalink: null,
    media: [],
    audience: "public"
  };

  // Thread reconstruction works on connected components, so a record that names a root it is not
  // linked to reports that root as a gap even when the export holds it. Trusting the gap alone
  // would tombstone a post whose content is right there in the same file.
  const outbox = buildActivityStreamsOutbox(
    [
      { ...base, tweetId: "5", conversationId: "cA", rootId: "5", text: "the post that is present" },
      { ...base, tweetId: "11", conversationId: "cB", rootId: "5", text: "the post that names it" }
    ],
    { generatedAt: GENERATED }
  );

  assert.deepEqual(
    outbox.orderedItems.filter((item) => item.type === "Tombstone").map((item) => item.id),
    [],
    JSON.stringify(outbox.orderedItems.map((item) => [item.type, item.object?.id ?? item.id]))
  );
  assert.equal(outbox.totalItems, 2);
});
