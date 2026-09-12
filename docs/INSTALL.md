# Install Aviary 1.49.5

Aviary ships as a readable userscript and as Manifest V3 extensions. Both builds run on X pages;
the extensions also provide a dedicated options page for optional browser permissions.

Start with the [v1.49.5 release downloads](https://github.com/SysAdminDoc/Aviary/releases/tag/v1.49.5).
You don't need Node or a source checkout to load the ZIP packages. The Chromium extension is the
most complete path; Firefox requires temporary loading, and userscript managers have the limits
below. Aviary isn't listed in a browser extension store.

## Userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), or another compatible manager.

   The metablock declares `@inject-into content`, which keeps Aviary out of the page's own scope.
   Under Violentmonkey that mode also means `unsafeWindow` refers to the content script's global
   rather than the page's, so Aviary's page-world observer cannot install there. Everything that
   works from the isolated world is unaffected, structural ad removal, themes, layout, filtering,
   hiding, exports, the library, but the observer's own contributions are not available: refusing
   X's promoted-content logging call before it reaches the network, refusing analytics beacons, and
   discovering direct video variants for the Video/GIF download controls. Aviary says so rather than
   claiming otherwise: Trust reports "This userscript manager does not give Aviary access to the
   page itself." The extension build is unaffected, because it declares a `"world": "MAIN"` content
   script instead.
2. Open the [raw userscript](https://raw.githubusercontent.com/SysAdminDoc/Aviary/main/dist/aviary.user.js)
   in the manager. Its repository path is `dist/aviary.user.js`.
3. Review and confirm the install prompt.

The userscript declares only the grants it uses:

- `GM_getValue`, `GM_setValue`, `GM_deleteValue`, and `GM_listValues` for local
  settings/library storage and cross-origin lock coordination.
- `GM_download` when the manager supplies it for privileged media saves.
- `unsafeWindow` for the page-world X GraphQL observer used by opt-in capture and media discovery.
- `@connect pbs.twimg.com` and `@connect video.twimg.com` for cross-origin media downloads.

Settings and library records stay in the userscript manager's value store. Aviary does not use
X's localStorage or IndexedDB for active userscript data. A single manager value is measured before
writing and is refused with a visible capacity error above 16 MiB, instead of failing silently.

How long those records survive is the manager's decision, not Aviary's. The extension can ask the
browser not to evict its database and does; a userscript has no equivalent request to make, so
Trust reports its persistence as unknown and the 16 MiB per-value ceiling is the only limit Aviary
can enforce for you. Export a library backup periodically. Private-mode persistence follows the
userscript manager too, because browsers do not expose a standard private-window signal to a
userscript. The extension packages declare `incognito: not_allowed` and do not run in private windows.

No permission prompt is needed for the local prompt builder, snapshots, bookmarks, notes, archive
import, Under the Hood JSON reader, or local export formats. Provider integrations remain disabled
until configured in the Control Center.

Read markers, per-surface seen-post hiding, and captured thread rebuilding are local features. The
thread reader uses only records already stored in the browser. They do not add an unread badge or
request another X endpoint.

## Optional adaptive video helper

Progressive MP4 downloads work without a helper. If Aviary has already observed a higher-quality
adaptive manifest, run the local companion from the repository:

```powershell
$env:AVIARY_YTDLP_TOKEN = "use-a-long-random-secret"
npm run yt-dlp:helper
```

Enable **Local yt-dlp handoff** in **Control Center -> Integrations**, keep the endpoint on the
loopback address, and enter the same secret. The helper needs `yt-dlp` on your PATH. Aviary sends
only the observed manifest URL, a filename, and the fixed best-video-plus-audio policy. It does not
send the X post URL, browser cookies, or bearer token. **Send to yt-dlp** waits for the local job
state and reports a refusal or failure instead of claiming the file was saved.

## Chrome, Edge, or Brave (developer load)

1. Download [the Chromium ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.49.5/extension-chrome-v1.49.5.zip)
   and extract it into a folder you'll keep. Source checkout users can instead run
   `npm ci --ignore-scripts`, then `npm run verify:release` to create `dist/extension-chrome/`.
2. Open `chrome://extensions/` (or the equivalent extensions page), enable **Developer mode**, and
   choose **Load unpacked**. Select the extracted folder containing `manifest.json`, or the built
   `dist/extension-chrome/` directory. Don't select the ZIP itself.
3. Pin Aviary if you want the extension entry point visible. The Control Center launcher itself
   appears on matching X pages.

The optional CRX3 release asset is self-signed for a stable extension identity. It isn't browser-store
approval and does not bypass Chrome or Edge installation policy. Use the ZIP for developer loading.

What the extension asks for, read from the manifests themselves:

<!-- docs-facts:start -->

<!-- Generated by tools/docs-facts.mjs from the manifests and the panel's own metadata.
     Edit those, then run `npm run docs:facts`. -->

Required permissions: `contextMenus`, `declarativeNetRequestWithHostAccess`, `scripting`, `storage`, `unlimitedStorage`.

Optional permissions: `downloads`, plus optional host access to `https://pbs.twimg.com/*`, `https://video.twimg.com/*`.

Host access: `https://pro.x.com/*`, `https://twitter.com/*`, `https://x.com/*`.

Both browser manifests declare exactly this set. Removing the extension the ordinary way deletes everything it stored, including the library.

<!-- docs-facts:end -->

`declarativeNetRequestWithHostAccess` lets the extension block only X's exact promoted-content
logger under the already declared X/Twitter host access; it does not add `<all_urls>` or the
warning-bearing feedback permission. `contextMenus` adds the one Download entry to the right-click
menu on X media, and `scripting` is what registers the content script. `unlimitedStorage` is the
permission half of asking the browser not to evict your library.

`downloads` is requested only from the options page after you click **Grant download access**, and
optional media-host access by **Grant media hosts**. Both can be revoked from the same page. Media
buttons remain available without either grant; without `downloads`, a cross-origin anchor may open
the media instead of claiming it was saved.

The extension's durable database belongs to its background origin. X content scripts and the
options page reach it through extension messages and therefore share the same active profile. An
upgrade checks and removes the older X-origin database after a verified copy; if copying fails, the
old database is kept for the next retry. If an old tab still has it open, Aviary seals the source,
continues booting, and recopies late writes before deletion on the next pass.

To manage permissions later, open the extension's **Options** page from the extensions manager (or
the Aviary options link). The page reports live grant state and never writes settings or makes a
network request.

The extension package includes browser-native message bundles for English, Spanish, Portuguese,
French, German, Japanese, Korean, Arabic, and Hebrew. The manifest, toolbar title, native media
context menu, and Options page follow the browser or Aviary locale without adding network access.

The release matrix also runs a deterministic 50,000-record library fixture. It measures a 128 MiB
Chromium heap budget, exercises backup/restore and ZIP/WARC/WACZ packaging, and forces content and
service-worker restart recovery. WACZ size estimates refuse an oversized export before allocating
a worker.

For a release, run `npm run release:local -- --plan` first. It reports the exact package commit for
each version whose tag or GitHub release is missing. `npm run release:local -- --publish` requires a
clean checkout, runs `verify:release`, builds the ZIP assets, signs and verifies the secondary
Chrome CRX3, writes a release manifest and SHA-256 checksums, then pushes the tag and uploads the
assets. Phase state is kept in local application data, so a network failure can be retried without
creating a second release. A historical version uses `--historical <version>` and is rebuilt in a
temporary worktree before any tag or asset is published. The stable self-host key is created at the
local application-data path on first use, or can be supplied with `--key`.

## Browser floors

Both floors are declared once, in `src/extension/browser-floors.ts`, and preflight fails the build
if either manifest disagrees with it.

| Build | Floor | Why |
| --- | --- | --- |
| Chromium | **102** | The `"world": "MAIN"` content script and `optional_host_permissions` used by Aviary. Declarative Net Request session rules and tab IDs are available earlier. |
| Firefox | **140** | The oldest maintained ESR line selected for this release. Firefox 140.15 received security fixes on 2026-09-01; Firefox 153 is the current ESR and Firefox 155 is the current stable smoke target. |

The floor is what decides whether a platform feature can be used directly. A feature is used
directly only when it is available at **both** floors; anything newer carries a runtime detection
branch and a fallback. `PLATFORM_FEATURE_FLOORS` in the same module records which of the two is
true for each feature, so the answer is looked up rather than re-derived:

| Feature | Chrome | Firefox | At both floors |
| --- | --- | --- | --- |
| `:has()` | 105 | 121 | no, needs a branch |
| Popover API | 116 | 125 | no, needs a branch |
| Web Locks | 69 | 96 | yes |
| `content-visibility` | 85 | 130 | yes |
| `RegExp.escape` | 136 | 134 | no, needs a branch |
| `URLPattern` | 95 | 142 | no, needs a branch |
| `@scope` | 118 | 146 | no, needs a branch |
| Navigation API | 102 | 147 | no, needs a branch |

Raising the Firefox floor to 153 would exclude the still-maintained 140 ESR line without removing
the feature detection needed for newer APIs. Versions were checked against the Firefox 153 ESR
release notes, the Firefox 140.15 security advisory, and the Chrome manifest documentation on
2026-09-06.

## Reproduce the source archive on Linux ARM64

`.node-version` pins Node 24.18.1, which is inside the package engine range. Select it before the
install so a host image with an older Node release does not produce a misleading build:

```sh
nvm install 24.18.1
nvm use 24.18.1
npm ci --ignore-scripts
npm run build
sha256sum dist/aviary-source-v1.49.5.zip
```

The source archive is a sorted, STORE-only ZIP with a fixed timestamp. It contains the checkout
inputs needed to reproduce the build, including the runtime icons. It leaves out `dist/`,
dependencies, temporary directories, review images and the historical concept archive. Use a full
Git checkout for repository tests and screenshot baselines. The extension's first chunk contains the page-safe protection and media path;
the exact X-matched panel chunk is web-accessible only where the manifest declares it.

## Firefox (temporary load)

Download and extract [the Firefox ZIP](https://github.com/SysAdminDoc/Aviary/releases/download/v1.49.5/extension-firefox-v1.49.5.zip), then:

1. Keep the extracted directory. If building from source, use `npm ci --ignore-scripts` and
   `npm run verify:release` first; `dist/extension-firefox/` isn't carried in Git.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on…**.
4. Choose the extracted `manifest.json`, or `dist/extension-firefox/manifest.json` for a source build.
5. Refresh an `x.com` page.

The Firefox build has the same base, optional, and options-page permission flow as the Chromium
build. Its background runs as a Firefox MV3 event page and keeps an empty enabled ruleset as a
compatibility anchor for the older Firefox dynamic-rule restart path covered by the extension tests.
Temporary add-ons disappear when Firefox restarts. The package is unsigned and the manifest still
contains a placeholder add-on id. It isn't a permanent AMO installation.

## Updating

- Userscript: the metablock's update URLs are derived from `package.json`'s `repository` field and
  point at that repository's `main` branch. `@updateURL` resolves to `dist/aviary.meta.js`, a
  metadata-only companion carrying the same metablock byte for byte, so a scheduled poll transfers
  under a kilobyte instead of the whole script; `@downloadURL` resolves to `dist/aviary.user.js`
  and is fetched only once a newer `@version` is seen. The repository has been public since
  2026-09-06, so both raw URLs resolve and a manager's scheduled poll sees new releases on its own.
  Reopening the newer `dist/aviary.user.js` still upgrades in place if you would rather not wait
  for the poll.
- Extension: back up the library, close X tabs, then extract the new matching ZIP into the same
  extension folder and use the extension manager's reload button. Source users can rebuild with
  `npm run verify:release`. Reload the temporary add-on in Firefox. Refresh X after updating.
  Don't remove and reinstall the extension just to update it; ordinary removal deletes its storage.

The version is visible in the userscript metadata, extension manifests, build artifacts, and the
Control Center status/about surface.

## Uninstall and data removal

Before uninstalling, use the Control Center clear actions for hidden posts, media history, audit,
snapshots, bookmarks, notes, cleanup queue, and semantic index as needed. **Export settings** only
moves preferences (with credentials redacted); it is not a full backup of the local library.
Settings are stored under the local `aviary.settings.v1` key; library collections use separate
versioned local stores.

Export a **full library backup** before removal if you want to keep your records. Ordinary extension
removal deletes its own storage and IndexedDB library. Downloaded files remain on disk. Userscript
values follow the manager's retention rules; use its storage controls when you want them removed.
An older install may also have X-origin migration data left after an interrupted upgrade. Check that
separately without clearing unrelated X data. You can revoke optional download and media-host
permissions from the extension's Options page while it is still installed.

For the complete local data map and the opt-in network boundaries, see
[PRIVACY.md](PRIVACY.md). For behavior, export formats, integrations, and troubleshooting, see
[FAQ.md](FAQ.md).
