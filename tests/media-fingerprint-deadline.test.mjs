import { importSourceModule } from "./helpers/source-import.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

test("fingerprinting budget includes exact hashing and optional image decoding", async () => {
  const { fingerprintMediaDownload } = await importSourceModule(
    "src/features/media/downloader.ts"
  );
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const largeBytes = new Uint8Array(48 * 1024 * 1024);

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(largeBytes.byteLength)
      }),
      async arrayBuffer() {
        return largeBytes.buffer;
      }
    });
    const hashStartedAt = Date.now();
    const hashResult = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/large?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: false,
      timeoutMs: 1
    });
    assert.ok(Date.now() - hashStartedAt < 150, "exact hashing escaped the total deadline");
    assert.equal(hashResult.exactHash, undefined);

    const tinyBytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(tinyBytes.byteLength)
      }),
      async arrayBuffer() {
        return tinyBytes.buffer;
      }
    });
    globalThis.createImageBitmap = async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { close() {} };
    };
    const decodeStartedAt = Date.now();
    const decodeResult = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/decode?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: true,
      timeoutMs: 20
    });
    assert.ok(Date.now() - decodeStartedAt < 150, "perceptual decoding escaped the total deadline");
    assert.equal(decodeResult.perceptualHash, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCreateImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

/**
 * The behaviour, not the clock.
 *
 * The wall-clock assertion above is the budget's contract, but it is a poor regression guard for
 * the yield that makes the budget reachable: removing the yield exceeded 150 ms in only one of
 * twenty-six fresh-process runs on this machine, because whether the 1 ms timer fires before the
 * synchronous 48 MB copy inside `sha256HexAsync` is a coin flip. This asserts the thing that is
 * deterministic -- with the deadline already gone, the hash must not be computed at all.
 */
test("an expired deadline does no hashing, whatever the clock says", async () => {
  const { fingerprintMediaDownload } = await importSourceModule(
    "src/features/media/downloader.ts"
  );
  const originalFetch = globalThis.fetch;
  const originalDigest = globalThis.crypto.subtle.digest;
  const largeBytes = new Uint8Array(48 * 1024 * 1024);
  let digests = 0;

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(largeBytes.byteLength)
      }),
      async arrayBuffer() {
        return largeBytes.buffer;
      }
    });
    globalThis.crypto.subtle.digest = function patched(...args) {
      digests += 1;
      return originalDigest.apply(this, args);
    };

    const expired = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/large?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: false,
      timeoutMs: 1
    });
    assert.equal(expired.exactHash, undefined, "an expired budget cannot produce a hash");
    assert.equal(digests, 0, "and must not have paid for one either");

    // Control: with a budget it can meet, the same call does hash.
    digests = 0;
    const tinyBytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(tinyBytes.byteLength)
      }),
      async arrayBuffer() {
        return tinyBytes.buffer;
      }
    });
    const hashed = await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/small?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: false,
      timeoutMs: 5_000
    });
    assert.ok(hashed.exactHash, "control: a real budget must still hash");
    assert.ok(digests > 0, "control: and must call the digest");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.crypto.subtle.digest = originalDigest;
  }
});
