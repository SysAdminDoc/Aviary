import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * How much the local library holds, what a cap does about it, and what a capture keeps.
 *
 * The measured total and the browser's usage figure are different numbers and are kept apart on
 * purpose: the browser counts index overhead and every other store on the origin, and the Storage
 * Standard calls its own answer approximate. A cap warns and never deletes, because this library is
 * routinely the only copy of what is in it. A capture setting decides what the next capture keeps
 * and leaves everything already stored alone.
 */

function fixtureRecord(overrides = {}) {
  return {
    tweetId: "1900000000000000001",
    handle: "fixture_alpha",
    text: "Synthetic fixture post.",
    permalink: "https://x.com/fixture_alpha/status/1900000000000000001",
    media: [],
    ...overrides
  };
}

test("a measured breakdown is the sum of its collections, with the browser's split kept separate", async () => {
  const { measureStoredBytes } = await importSourceModule("src/platform/durable-storage.ts");

  // The measurement is serialized length, which is the number an export of that collection writes.
  assert.equal(measureStoredBytes({ a: 1 }), 7);
  assert.equal(measureStoredBytes("héllo"), 8, "a multibyte character weighs more than one byte");
  assert.equal(measureStoredBytes(undefined), 0, "a value with no serialization weighs nothing");

  const circular = {};
  circular.self = circular;
  assert.equal(measureStoredBytes(circular), 0, "an unserializable value must not throw");
});

test("a storage cap warns, and says which side of the line the library is on", async () => {
  const { storageCapReport } = await importSourceModule("src/platform/durable-storage.ts");

  assert.equal(storageCapReport({ capBytes: 0, storedBytes: 9_000_000 }).state, "off");
  assert.equal(storageCapReport({ capBytes: 10_000_000, storedBytes: 4_000_000 }).state, "under");
  assert.equal(
    storageCapReport({ capBytes: 10_000_000, storedBytes: 9_000_000, incomingBytes: 2_000_000 }).state,
    "would-cross"
  );
  assert.equal(storageCapReport({ capBytes: 10_000_000, storedBytes: 12_000_000 }).state, "over");

  // An asset of unknown size contributes nothing rather than a guess, so the report under-warns
  // instead of warning about bytes that may not exist.
  assert.equal(
    storageCapReport({ capBytes: 10_000_000, storedBytes: 9_000_000 }).state,
    "under",
    "with no known incoming bytes, being close to the cap is not crossing it"
  );

  // A cap below a megabyte would fire on the first capture of anything, so it is refused.
  const { normalizeSettings, DEFAULT_SETTINGS } = await importSourceModule("src/platform/settings.ts");
  assert.equal(normalizeSettings({ export: { storageCapBytes: 500 } }).export.storageCapBytes, 0);
  assert.equal(normalizeSettings({ export: { storageCapBytes: -5 } }).export.storageCapBytes, 0);
  assert.equal(
    normalizeSettings({ export: { storageCapBytes: 5_000_000_000_000 } }).export.storageCapBytes,
    0,
    "a cap larger than any disk is not a cap"
  );
  assert.equal(normalizeSettings({ export: { storageCapBytes: 2_000_000_000 } }).export.storageCapBytes, 2_000_000_000);
  assert.equal(DEFAULT_SETTINGS.export.storageCapBytes, 0, "the cap is off until someone sets one");
});

test("the capture-size settings are off by default and reject a value the panel cannot offer", async () => {
  const { normalizeSettings, DEFAULT_SETTINGS } = await importSourceModule("src/platform/settings.ts");

  assert.equal(DEFAULT_SETTINGS.export.captureImageScale, 1, "captures keep the original by default");
  assert.equal(DEFAULT_SETTINGS.export.capturePosterFramesOnly, false);

  for (const scale of [1, 0.75, 0.5, 0.25]) {
    assert.equal(normalizeSettings({ export: { captureImageScale: scale } }).export.captureImageScale, scale);
  }
  // A restored backup asking for 0.03 would store an image nobody can read while the record still
  // claims to be a capture of that post.
  for (const bad of [0.03, 0, -1, 2, "half", null]) {
    assert.equal(
      normalizeSettings({ export: { captureImageScale: bad } }).export.captureImageScale,
      1,
      `${JSON.stringify(bad)} must fall back to the original`
    );
  }
});

test("a cleanup preview names the heaviest records and what removing them frees", async () => {
  const { previewCleanup, recordStoredBytes } = await importSourceModule(
    "src/features/library/cleanup-preview.ts"
  );

  const heavy = fixtureRecord({
    tweetId: "1900000000000000002",
    media: [
      { kind: "photo", url: "https://pbs.twimg.com/media/A", captureStatus: "captured-bytes", byteLength: 5_000_000 },
      { kind: "photo", url: "https://pbs.twimg.com/media/B", captureStatus: "captured-bytes", byteLength: 3_000_000 }
    ]
  });
  const light = fixtureRecord({
    tweetId: "1900000000000000003",
    media: [
      { kind: "photo", url: "https://pbs.twimg.com/media/C", captureStatus: "captured-bytes", byteLength: 12_000 }
    ]
  });
  // A reference weighs nothing: those bytes are not on this disk, so removing the record frees none.
  const referenced = fixtureRecord({
    tweetId: "1900000000000000004",
    media: [{ kind: "photo", url: "https://pbs.twimg.com/media/D", captureStatus: "remote-reference", byteLength: 9_000_000 }]
  });

  assert.equal(recordStoredBytes(heavy), 8_000_000);
  assert.equal(recordStoredBytes(referenced), 0, "a remote reference occupies nothing locally");

  const preview = previewCleanup([light, heavy, referenced], { bucketHint: "tweets", largestCount: 2 });
  assert.equal(preview.storedBytes, 8_012_000);
  assert.equal(preview.freeableBytes, 8_012_000);
  assert.deepEqual(
    preview.largest.map((entry) => entry.tweetId),
    ["1900000000000000002", "1900000000000000003"],
    "the heaviest record has to come first, or the list does not help anyone decide"
  );

  // Protecting the heavy record must take its bytes out of what this promises to free.
  const guarded = previewCleanup([light, heavy, referenced], {
    bucketHint: "tweets",
    protectedTweetIds: ["1900000000000000002"]
  });
  assert.equal(guarded.storedBytes, 8_012_000, "a protected record still occupies its bytes");
  assert.equal(guarded.freeableBytes, 12_000, "but they are not bytes this offers to free");
});

test("a capture setting changes the next capture and nothing already stored", async () => {
  const { captureExportRecordMedia } = await importSourceModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg", "content-length": String(bytes.byteLength) }),
      async arrayBuffer() {
        return bytes.buffer.slice(0);
      }
    });

    const stored = fixtureRecord({
      media: [
        {
          kind: "photo",
          url: "https://pbs.twimg.com/media/AviaryFixture?format=jpg&name=orig",
          captureStatus: "captured-bytes",
          byteLength: 999,
          sha256: "already-stored"
        }
      ]
    });
    const before = JSON.parse(JSON.stringify(stored));

    // Capturing a fresh record with a downscale set must not reach back into the one that is
    // already stored. The input object is checked for mutation, because a record is the only copy.
    await captureExportRecordMedia(fixtureRecord({
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/Other?format=jpg&name=orig" }]
    }), { imageScale: 0.5 });
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), before, "an unrelated stored record must not change");

    // With no image decoder in this runtime the downscale cannot run, so the original bytes are
    // kept and no reduction is claimed. Claiming one that did not happen is the failure to avoid.
    const captured = await captureExportRecordMedia(
      fixtureRecord({ media: [{ kind: "photo", url: "https://pbs.twimg.com/media/AviaryFixture?format=jpg&name=orig" }] }),
      { imageScale: 0.5 }
    );
    const photo = captured.media[0];
    assert.equal(photo.captureStatus, "captured-bytes");
    if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.OffscreenCanvas !== "function") {
      assert.equal(photo.byteLength, bytes.byteLength, "with no decoder the original bytes are kept");
      assert.equal(photo.reduction, undefined, "and no reduction is claimed");
    } else {
      assert.equal(photo.reduction?.imageScale, 0.5);
      assert.equal(photo.reduction?.originalByteLength, bytes.byteLength);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("poster-frames-only captures the still and says the video was left out", async () => {
  const { captureExportRecordMedia } = await importSourceModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;
  const poster = "https://pbs.twimg.com/amplify_video_thumb/1900000000000000901/img/AviaryFixture.jpg";
  const requested = [];

  try {
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      const bytes = new Uint8Array([9, 9, 9]);
      return {
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg", "content-length": String(bytes.byteLength) }),
        async arrayBuffer() {
          return bytes.buffer.slice(0);
        }
      };
    };

    const record = fixtureRecord({
      media: [
        {
          kind: "video",
          url: "https://video.twimg.com/amplify_video/1900000000000000901/vid/avc1/1280x720/AviaryFixture.mp4",
          poster,
          type: "video/mp4"
        }
      ]
    });

    const captured = await captureExportRecordMedia(record, { posterFrameOnly: true });
    const video = captured.media[0];
    assert.deepEqual(requested, [poster], "the video itself must not be fetched at all");
    assert.equal(video.reduction?.posterFrameOnly, true, "the record has to say the video was left out");
    assert.equal(video.captureStatus, "captured-bytes");

    // Control: with the setting off, the video is what gets fetched.
    requested.length = 0;
    await captureExportRecordMedia(record, {});
    assert.deepEqual(
      requested,
      ["https://video.twimg.com/amplify_video/1900000000000000901/vid/avc1/1280x720/AviaryFixture.mp4"],
      "control: without the setting the video is captured"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a capture that was not re-encoded keeps the type the page observed", async () => {
  // `captureMediaBytes` defaults a missing `Content-Type` to `application/octet-stream`, and that
  // value goes straight into the ZIP entry and the WARC record. Letting the response header win
  // over the DOM-observed type on the untouched path put the wrong MIME on every capture from a
  // host that omits the header.
  const { captureExportRecordMedia } = await importSourceModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({}),
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      }
    });
    const captured = await captureExportRecordMedia(
      fixtureRecord({
        media: [
          { kind: "video", url: "https://video.twimg.com/amplify_video/1/vid/a.mp4", type: "video/mp4" }
        ]
      })
    );
    assert.equal(captured.media[0].type, "video/mp4", "the observed type must survive a missing header");
    assert.notEqual(captured.media[0].type, "application/octet-stream");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a poster capture is recorded as a still, and says how much it left out", async () => {
  const { captureExportRecordMedia } = await importSourceModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;
  const poster = "https://pbs.twimg.com/amplify_video_thumb/1900000000000000901/img/AviaryFixture.jpg";

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg", "content-length": "3" }),
      async arrayBuffer() {
        return new Uint8Array([9, 9, 9]).buffer;
      }
    });

    const captured = await captureExportRecordMedia(
      fixtureRecord({
        media: [
          {
            kind: "video",
            url: "https://video.twimg.com/amplify_video/1900000000000000901/vid/a.mp4",
            poster,
            type: "video/mp4",
            byteLength: 48_000_000
          }
        ]
      }),
      { posterFrameOnly: true }
    );

    const entry = captured.media[0];
    // A consumer keying off `kind` or `url` must not read a still as the video it replaced.
    assert.equal(entry.kind, "thumbnail");
    assert.equal(entry.url, poster);
    assert.equal(entry.type, "image/jpeg");
    assert.equal(entry.reduction?.posterFrameOnly, true);
    assert.equal(
      entry.reduction?.replacedByteLength,
      48_000_000,
      "the size of what was left out, not the size of the still that replaced it"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("poster-frames-only stores nothing when the video has no poster", async () => {
  // Storing the whole video with nothing on the record is the failure: someone who turned this on
  // to stay under a storage cap would get the full file and no trace of why.
  const { captureExportRecordMedia } = await importSourceModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;
  const requested = [];

  try {
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        headers: new Headers({ "content-type": "video/mp4", "content-length": "3" }),
        async arrayBuffer() {
          return new Uint8Array([1, 2, 3]).buffer;
        }
      };
    };

    const captured = await captureExportRecordMedia(
      fixtureRecord({
        media: [
          { kind: "video", url: "https://video.twimg.com/amplify_video/1/vid/no-poster.mp4", type: "video/mp4" }
        ]
      }),
      { posterFrameOnly: true }
    );

    const entry = captured.media[0];
    assert.deepEqual(requested, [], "nothing may be fetched when the setting cannot be honoured");
    assert.equal(entry.captureStatus, "remote-reference");
    assert.equal(entry.reduction?.posterMissing, true, "the record has to say why nothing was stored");
    assert.match(entry.captureError ?? "", /no poster/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a re-capture with the setting off drops a reduction the record used to carry", async () => {
  const { captureExportRecordMedia } = await importSourceModule("src/features/media/downloader.ts");
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg", "content-length": "3" }),
      async arrayBuffer() {
        return new Uint8Array([4, 5, 6]).buffer;
      }
    });

    const captured = await captureExportRecordMedia(
      fixtureRecord({
        media: [
          {
            kind: "photo",
            url: "https://pbs.twimg.com/media/AviaryFixture?format=jpg&name=orig",
            // What a previous run wrote, when the setting was on.
            reduction: { imageScale: 0.25, originalByteLength: 900_000 }
          }
        ]
      }),
      {}
    );

    assert.equal(
      captured.media[0].reduction,
      undefined,
      "a record must not keep claiming a reduction the capture that just ran did not make"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the downscale actually runs where a browser can decode an image", async () => {
  // Node has no image decoder, so the case above only ever exercises the fallback. This drives the
  // real path: a 200 by 100 PNG captured at half scale has to come back 100 by 50, and the record
  // has to carry both the scale and the size it started from.
  const temp = await mkdtemp(path.join(tmpdir(), "aviary-downscale-"));
  const outfile = path.join(temp, "downloader.js");
  const browser = await chromium.launch({ headless: true });
  try {
    const entry = path.join(temp, "entry.ts");
    await writeFile(
      entry,
      `export { captureExportRecordMedia } from ${JSON.stringify(
        path.resolve(root, "src/features/media/downloader.ts").replace(/\\/g, "/")
      )};`,
      "utf8"
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "iife",
      globalName: "AviaryCapture",
      platform: "browser",
      target: "es2022",
      logLevel: "silent"
    });

    // A served https origin, not `about:blank`: `crypto.subtle` only exists in a secure context,
    // and the capture hashes what it stores, so on a blank page every capture fails with
    // "Asynchronous SHA-256 is unavailable" before the downscale is ever reached.
    const page = await browser.newPage();
    await page.route("https://fixture.invalid/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body></body>" })
    );
    await page.goto("https://fixture.invalid/");
    await page.addScriptTag({ content: await readFile(outfile, "utf8") });

    const result = await page.evaluate(async () => {
      const source = new OffscreenCanvas(200, 100);
      const context = source.getContext("2d");
      context.fillStyle = "#3366cc";
      context.fillRect(0, 0, 200, 100);
      const original = new Uint8Array(await (await source.convertToBlob({ type: "image/png" })).arrayBuffer());

      globalThis.fetch = async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/png", "content-length": String(original.byteLength) }),
        async arrayBuffer() {
          return original.buffer.slice(0);
        }
      });

      const captured = await AviaryCapture.captureExportRecordMedia(
        {
          tweetId: "1900000000000000001",
          handle: "fixture_alpha",
          text: "Synthetic fixture post.",
          permalink: "https://x.com/fixture_alpha/status/1900000000000000001",
          media: [{ kind: "photo", url: "https://pbs.twimg.com/media/AviaryFixture?format=png&name=orig" }]
        },
        { imageScale: 0.5 }
      );
      const photo = captured.media[0];
      let decoded = null;
      let decodeError = null;
      try {
        decoded = await createImageBitmap(new Blob([photo.bytes], { type: photo.type }));
      } catch (error) {
        decodeError = String(error);
      }
      return {
        width: decoded?.width ?? null,
        height: decoded?.height ?? null,
        reduction: photo.reduction,
        originalBytes: original.byteLength,
        type: photo.type,
        captureStatus: photo.captureStatus,
        captureError: photo.captureError ?? null,
        byteLength: photo.byteLength ?? null,
        hasBytes: photo.bytes instanceof Uint8Array,
        decodeError
      };
    });

    assert.equal(result.width, 100, "half of 200 pixels wide");
    assert.equal(result.height, 50, "half of 100 pixels tall");
    assert.equal(result.reduction.imageScale, 0.5);
    assert.equal(result.reduction.originalByteLength, result.originalBytes);
    assert.equal(result.type, "image/png", "a lossless source stays lossless");
  } finally {
    await browser.close();
    await rm(temp, { recursive: true, force: true });
  }
});
