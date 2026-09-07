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
  let fetches = 0;

  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: new Headers({
        "content-type": "image/jpeg",
        "content-length": String(largeBytes.byteLength)
      }),
      async arrayBuffer() {
        fetches += 1;
        // A real transfer, so the budget is definitely spent by the time the body arrives. With a
        // one-millisecond budget and an instant body the outcome turned on whether a timer or a
        // macrotask fired first, which is a coin flip rather than a contract.
        await new Promise((resolve) => setTimeout(resolve, 80));
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
      // Comfortably longer than the loop needs to start, and comfortably shorter than the body
      // takes to arrive, so the budget is spent for a reason rather than by scheduling luck.
      timeoutMs: 40
    });
    assert.equal(expired.exactHash, undefined, "an expired budget cannot produce a hash");
    // The caller is released when the budget runs out; the operation it started is still going.
    // Wait for the body to arrive before asking whether anything hashed it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(digests, 0, "and must not have paid for one either");
    // Without this the assertion above passes for the wrong reason: a call that broke before
    // fetching never reaches the hash, which proves nothing about the check that skips it.
    assert.equal(fetches, 1, "the body has to have been read, or nothing was skipped");

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

    // The yield itself, asserted as behaviour rather than as a stopwatch reading.
    //
    // `fetch` and `arrayBuffer` resolve through microtasks, which drain before any timer, so
    // without a deliberate yield the whole capture -- including a 48 MB copy and digest -- runs
    // before the event loop gets a turn and before any deadline can fire. A timer queued before
    // the call must therefore have run by the time the digest starts. Removing the yield from
    // `captureMediaBytes` makes this fail every time.
    let ticked = false;
    let tickedBeforeDigest = null;
    globalThis.crypto.subtle.digest = function patched(...args) {
      if (tickedBeforeDigest === null) tickedBeforeDigest = ticked;
      return originalDigest.apply(this, args);
    };
    setTimeout(() => {
      ticked = true;
    }, 0);
    await fingerprintMediaDownload({
      kind: "photo",
      url: "https://pbs.twimg.com/media/small?format=jpg&name=orig",
      mediaId: null,
      includePerceptual: false,
      timeoutMs: 5_000
    });
    assert.equal(
      tickedBeforeDigest,
      true,
      "the capture must give the event loop a turn before it pays for a hash"
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.crypto.subtle.digest = originalDigest;
  }
});
