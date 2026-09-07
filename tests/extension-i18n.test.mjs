import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importSourceModule } from "./helpers/source-import.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("extension manifests use browser-native message placeholders", async () => {
  for (const name of ["manifest.chrome.json", "manifest.firefox.json"]) {
    const manifest = JSON.parse(await readFile(path.join(root, "src/extension", name), "utf8"));
    assert.equal(manifest.default_locale, "en");
    assert.equal(manifest.name, "__MSG_extensionName__");
    assert.equal(manifest.description, "__MSG_extensionDescription__");
    assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
  }
});

test("native extension copy is complete and the context menu resolves through browser i18n", async () => {
  const { NATIVE_I18N_COPY } = await importSourceModule("src/extension/native-i18n.ts");
  assert.deepEqual(Object.keys(NATIVE_I18N_COPY).sort(), [
    "actionTitle",
    "contextDownloadMedia",
    "extensionDescription",
    "extensionName"
  ]);

  const context = await readFile(path.join(root, "src/extension/media-context-menu.ts"), "utf8");
  assert.match(context, /chrome\?\.i18n\?\.getMessage/);
  assert.match(context, /contextDownloadMedia/);
});

test("extension options uses the shared locale direction metadata", async () => {
  const options = await readFile(path.join(root, "src/entrypoints/extension-options.ts"), "utf8");
  assert.match(options, /from "\.\.\/platform\/i18n-runtime\.ts"/);
  assert.match(options, /document\.documentElement\.dir = localeDirection\(locale\)/);
  assert.doesNotMatch(options, /RTL_LOCALES/);
});
