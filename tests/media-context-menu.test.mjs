import assert from "node:assert/strict";
import { test } from "node:test";
import { importSourceModule } from "./helpers/source-import.mjs";

test("media context messages require exact fields, an X document, and the extension sender", async () => {
  const {
    isMediaContextDownloadMessage,
    isMediaContextPermissionDeniedMessage,
    isSupportedXDocumentUrl,
    MEDIA_CONTEXT_DOWNLOAD_MESSAGE,
    MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE
  } = await importSourceModule("src/extension/media-context-menu.ts", { fresh: true });
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { id: "aviary-test" } };
  const valid = {
    type: MEDIA_CONTEXT_DOWNLOAD_MESSAGE,
    documentUrl: "https://x.com/home"
  };
  const sender = { id: "aviary-test" };

  try {
    assert.equal(isMediaContextDownloadMessage(valid, sender), true);
    assert.equal(
      isMediaContextPermissionDeniedMessage(
        { type: MEDIA_CONTEXT_PERMISSION_DENIED_MESSAGE, documentUrl: valid.documentUrl },
        sender
      ),
      true
    );
    assert.equal(isSupportedXDocumentUrl("https://twitter.com/status/123"), true);
    assert.equal(isSupportedXDocumentUrl("https://pro.x.com/home"), true);

    const rejected = [
      ["wrong type", { ...valid, type: "OTHER" }, sender],
      ["missing document URL", { type: valid.type }, sender],
      ["extra field", { ...valid, extra: true }, sender],
      ["non-string URL", { ...valid, documentUrl: 42 }, sender],
      ["non-X document", { ...valid, documentUrl: "https://example.com/" }, sender],
      ["javascript URL", { ...valid, documentUrl: "javascript:alert(1)" }, sender],
      ["data URL", { ...valid, documentUrl: "data:text/html,<p>x</p>" }, sender],
      ["unexpected sender", valid, { id: "another-extension" }],
      ["missing sender", valid, undefined]
    ];
    for (const [label, message, messageSender] of rejected) {
      assert.equal(
        isMediaContextDownloadMessage(message, messageSender),
        false,
        `${label} must not reach the context download path`
      );
    }
  } finally {
    globalThis.chrome = originalChrome;
  }
});
