# Install

Aviary ships in three forms. Pick whichever fits your workflow.

## 1. Userscript (recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), or any other compatible manager.
2. Open `dist/aviary.user.js` from this repository (or a GitHub raw URL once a release lands).
3. The manager will prompt to install. Confirm.

The userscript is readable, never minified, and lists every grant in its `==UserScript==` block:

- `GM_getValue`, `GM_setValue`, `GM_deleteValue` — local settings storage.
- `GM_download` — direct image / video / GIF saves with the configured filename.
- `@connect pbs.twimg.com` and `@connect video.twimg.com` — required for cross-origin downloads.

## 2. Chrome / Edge / Brave extension (developer load)

1. Run `npm run verify`. The build emits `dist/extension-chrome/` and `dist/extension-chrome-v<version>.zip`.
2. Open `chrome://extensions/`, enable **Developer mode**, then either:
   - Click **Load unpacked** and pick `dist/extension-chrome/`, **or**
   - Drag the `.zip` archive onto the page (Chromium 75+ requires unpacked loading for self-signed CRX).
3. Pin Aviary from the extensions menu so the Control Center launcher is reachable.

The first time you click an Aviary Save / Video / Thumb button the browser will prompt for the optional `downloads` permission. Decline freely — Aviary will fall back to an anchor download.

## 3. Firefox extension (temporary load)

Requires Firefox 128 or newer: Aviary ships a `"world": "MAIN"` content script, which is what lets it see X's own network requests, and 128 is the first release to support it.

1. Build as above.
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on…** and select `dist/extension-firefox/manifest.json`.
4. Refresh `x.com`; the Control Center launcher appears in the bottom-right.

## Updating

- Userscript: pull a newer raw URL or re-open `dist/aviary.user.js`. Versions are visible in the `==UserScript==` banner and in the Control Center status row.
- Extension: re-run `npm run verify` and click the refresh icon on the `chrome://extensions/` card (or re-load the temp add-on in Firefox).

## Uninstall

All Aviary state lives in your browser's local storage. Removing the extension or userscript wipes:

- Settings (`aviary.settings.v1`)
- Media history (`aviary.media.history.v1`)
- Export checkpoints (`aviary.export.checkpoints.v1`)
- GraphQL query cache (`aviary.queryIds.v1`)
- Audit log (`aviary.audit.v1`)
- Account notes (`aviary.userNotes.v1`)

No data is uploaded anywhere. There is no telemetry. The Control Center's "Export settings" action is the only way to move state between profiles.
