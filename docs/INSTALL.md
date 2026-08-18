# Install Aviary 1.28.0

Aviary ships as a readable userscript and as Manifest V3 extensions. Both builds run on X pages;
the extensions also provide a dedicated options page for optional browser permissions.

## Userscript (recommended for quick setup)

1. Install [Tampermonkey](https://www.tampermonkey.net/), [Violentmonkey](https://violentmonkey.github.io/), or another compatible manager.

   The metablock declares `@inject-into content`, which keeps Aviary out of the page's own scope.
   Under Violentmonkey that mode also means `unsafeWindow` refers to the content script's global
   rather than the page's, so Aviary's page-world observer cannot install there. Everything that
   works from the isolated world is unaffected — structural ad removal, themes, layout, filtering,
   hiding, exports, the library — but the observer's own contributions are not available: refusing
   X's promoted-content logging call before it reaches the network, refusing analytics beacons, and
   discovering direct video variants for the Video/GIF download controls. Aviary says so rather than
   claiming otherwise: Trust reports "This userscript manager does not give Aviary access to the
   page itself." The extension build is unaffected, because it declares a `"world": "MAIN"` content
   script instead.
2. Open `dist/aviary.user.js` from this repository, or the raw file from a release, in the manager.
3. Review and confirm the install prompt.

The userscript declares only the grants it uses:

- `GM_getValue`, `GM_setValue`, and `GM_deleteValue` for local settings/library storage.
- `GM_download` when the manager supplies it for privileged media saves.
- `unsafeWindow` for the page-world X GraphQL observer used by opt-in capture and media discovery.
- `@connect pbs.twimg.com` and `@connect video.twimg.com` for cross-origin media downloads.

No permission prompt is needed for the local prompt builder, snapshots, bookmarks, notes, archive
import, or local export formats. Provider integrations remain disabled until configured in the
Control Center.

## Chrome, Edge, or Brave (developer load)

1. Run `npm run verify`. The build emits `dist/extension-chrome/` and
   `dist/extension-chrome-v1.28.0.zip`. The ZIPs are build output and are not carried in git —
   build them, or take them from a release.
2. Open `chrome://extensions/` (or the equivalent extensions page), enable **Developer mode**, and
   choose **Load unpacked** with `dist/extension-chrome/`. A ZIP is a release artifact; Chromium
   developer loading uses the unpacked directory.
3. Pin Aviary if you want the extension entry point visible. The Control Center launcher itself
   appears on matching X pages.

Aviary asks for three hosts: `x.com`, `twitter.com`, and `pro.x.com`. The base permissions are
`storage` and host-scoped `declarativeNetRequestWithHostAccess`. The
latter lets the extension block only X's exact promoted-content logger under the already declared
X/Twitter host access; it does not add `<all_urls>` or the warning-bearing feedback permission.
`downloads` is optional and is requested only from the options page after you click **Grant
download access**. Optional media-host access for
`pbs.twimg.com` and `video.twimg.com` is requested separately by **Grant media hosts**. Both can be
revoked from the same page. Media buttons remain available without either optional grant; without
`downloads`, a cross-origin anchor may open the media instead of claiming it was saved.

To manage permissions later, open the extension's **Options** page from the extensions manager (or
the Aviary options link). The page reports live grant state and never writes settings or makes a
network request.

## Firefox (temporary load)

Firefox 128 or newer is required because the extension uses a Manifest V3 page-world content script
(`"world": "MAIN"`) to observe X's own loaded network responses. Build the extension, then:

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…**.
3. Choose `dist/extension-firefox/manifest.json`.
4. Refresh an `x.com` page.

The Firefox build has the same base, optional, and options-page permission flow as the Chromium
build. Its background runs as a Firefox MV3 event page and keeps an empty enabled ruleset solely for
Firefox 128–132 dynamic-rule restart compatibility. Temporary add-ons disappear when Firefox
restarts.

## Updating

- Userscript: the metablock's update URLs are derived from `package.json`'s `repository` field and
  point at that repository's `main` branch. `@updateURL` resolves to `dist/aviary.meta.js`, a
  metadata-only companion carrying the same metablock byte for byte, so a scheduled poll transfers
  under a kilobyte instead of the whole ~1.9 MB script; `@downloadURL` resolves to
  `dist/aviary.user.js` and is fetched only once a newer `@version` is seen. Manager auto-update
  only reaches either one once that repository is publicly readable; while the repository is private
  both raw URLs answer 404 and the manager silently reports no update. Until then, reopen the newer
  `dist/aviary.user.js` to upgrade in place.
- Extension: run `npm run verify`, then use the extension manager's reload button or reload the
  temporary add-on. Refresh open X tabs after updating the content script.

The version is visible in the userscript metadata, extension manifests, build artifacts, and the
Control Center status/about surface.

## Uninstall and data removal

Before uninstalling, use the Control Center clear actions for hidden posts, media history, audit,
snapshots, bookmarks, notes, cleanup queue, and semantic index as needed. **Export settings** only
moves preferences (with credentials redacted); it is not a full backup of the local library.
Settings are stored under the local `aviary.settings.v1` key; library collections use separate
versioned local stores.

Then remove the extension from the browser or delete the userscript from its manager. Browser
extension storage, IndexedDB, downloaded files, and manager values may survive removal, so use the
browser's extension/site-data controls and the userscript manager's storage controls if you need a
complete wipe. Revoke the optional download and media-host permissions from the extension options
page before removal when you want the grants gone immediately.

For the complete local data map and the opt-in network boundaries, see
[PRIVACY.md](PRIVACY.md). For behavior, export formats, integrations, and troubleshooting, see
[FAQ.md](FAQ.md).
