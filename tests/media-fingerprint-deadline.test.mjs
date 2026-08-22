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
