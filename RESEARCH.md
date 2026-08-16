# Research — Feed Media Downloads

Date: 2026-08-16. This replaces the 2026-08-15 general product research after the earlier findings
were implemented or transferred to the roadmap. This pass examined 46 distinct primary sources:
current source, releases, issue reports, store listings, and official browser/userscript APIs.

## Executive Summary

Before this release, Aviary v1.26.0 already owned the difficult half of reliable X media downloading: it captured the
GraphQL responses X has already requested at document start, associates direct media metadata with
rendered posts, rewrites attached-image URLs to original quality, rejects MediaSource `blob:`
handles, and ranks captured video variants. The remaining product gap is the feed interaction.
Controls are split across media tiles, and a video plus its poster can produce separate Video and
Thumb buttons. Established downloaders instead make one post-level action the primary path.

The recommended change is a persistent **Download** action in every media post's native action row.
One click should download all primary media in that post: every photo at `name=orig`, and every
video/GIF as the highest-bitrate direct MP4. Per-tile controls should remain for choosing one item
or a video thumbnail. The post action must show resolving, saving, partial-failure, success,
duplicate, permission, and retry states without disappearing.

This approach is both easier and safer than the alternatives. TwitterMediaHarvest (100,000 Chrome
users) clones a native action-row control and downloads the whole post. Two newer userscripts and a
small MV3 downloader independently converged on the same action-row pattern. All mature extractors
converge on original image URLs and progressive MP4 bitrate ranking. Aviary should borrow those
interaction and selection contracts while keeping its stronger passive-capture architecture: no
cookie access, token extraction, or new authenticated X requests.

## Product Map

- Primary workflow: scroll Home, Following, Search, Bookmarks, Lists, Profiles, or a conversation;
  see one persistent Download action on a media post; click once; receive the best directly
  downloadable file for each attached image/video/GIF.
- Secondary workflow: use the existing tile-level Save, Video/GIF, or Thumb action when only one
  asset is wanted.
- Quality contract: attached photos use the original image endpoint; videos/GIFs use the highest
  bitrate progressive MP4 in the captured response; `blob:` and playlist manifests are never
  presented as completed video files.
- Delivery contract: userscripts prefer `GM_download`; MV3 uses the optional browser downloads
  permission; Aria2 remains optional; filenames and duplicate history stay local.
- Trust boundary: reuse responses X already loaded. Do not read cookies, export tokens, scrape a
  bearer token, or originate tweet-detail calls just to resolve a button.

## Competitive Landscape

### 1. TwitterMediaHarvest

The strongest adoption signal is TwitterMediaHarvest: its Chrome listing reports 100,000 users and
4.5 stars. It finds the post action group, clones the reply control so the addition inherits X's
layout, swaps in a download icon, and downloads all available media in the post. Its parser filters
video variants to `video/mp4` and chooses the greatest bitrate; image files are converted to their
`orig` variant. Downloaded-state history, custom filenames, video thumbnails, and Aria2 are proven
adjacent features.

Its issue history also defines failure modes Aviary should avoid: action controls disappearing or
moving after X UI changes, styling collisions, request/auth failures, X anti-extension incidents,
large-history startup delays, and spinner states that never settle. Its active requests for saved
badges, bookmark batches, text sidecars, audio, and subtitles remain useful follow-ons, but the
current feed interaction should stay single-purpose.

### 2. Twitter Click'n'Save

This maintained userscript uses highly visible per-tile controls, download history, progress, and
careful image fallback. It tries `orig`, then `4096x4096`, then successively smaller served sizes;
it also probes JPG/PNG when the encoded format is ambiguous. Its API parser ignores HLS entries and
selects the largest numeric bitrate. The implementation proves the current Aviary tile controls are
valuable as a secondary precision tool, but its open button-overlap report and hover-led design
support moving Aviary's main action into the stable action row.

### 3. Twitter/X Media Downloader

This newer MIT userscript clones the last native action, downloads every media entity in a post,
uses `:orig` for photos, and chooses the highest-bitrate MP4 for video. It adds HEAD-based size
reporting and a local history panel. Its main lesson is convergence: one post action is simpler
than making a user identify whether a visible tile represents the actual video or only its poster.

### 4. Twitter-X-Media-Copy-Download

This actively maintained userscript appends media and link controls to the post action row and
supports copying, previewing, downloading, history, groups, and extensive gesture customization.
It validates the placement and multi-media workflow, but its click/long-press/middle-click/
right-click matrix is too opaque for Aviary. Aviary should retain one obvious left-click action,
explicit accessible text, and the existing native context-menu alternative.

### 5. X Video Downloader

This small MV3 extension uses a visible action-row Download button and highest-bitrate MP4
selection. Its direct streaming handoff to `chrome.downloads` is correct and avoids loading large
videos into memory. Its authentication design is not: it requests cookie access, reads the CSRF
token and all X cookies, extracts a bearer token, and originates v1.1/GraphQL requests. Aviary's
passive response capture achieves the same quality selection without expanding the credential or
account-action surface.

### 6. yt-dlp, gallery-dl, and cobalt

These are the extraction references. yt-dlp enumerates both progressive variants and HLS
renditions because it can merge/remux with a desktop media pipeline. gallery-dl defaults photos to
`orig`, falls back through `4096x4096` and smaller sizes, and can delegate videos to yt-dlp. cobalt
selects the largest progressive MP4 for direct output, uses HLS only for subtitle discovery, and
remuxes server-side when necessary. Aviary has no media transcoder, so its truthful browser-native
contract is the highest-bitrate progressive MP4 rather than an HLS master playlist.

### 7. Browser and userscript delivery APIs

Chrome's downloads API is the correct MV3 primitive and supports unique filenames, but it requires
the downloads permission. Chrome's own guidance recommends optional permissions requested from a
clear user gesture. `GM_download` is the correct userscript path, though manager behavior varies:
Violentmonkey documents both anchor-backed and browser-download modes. An HTML `download` attribute
cannot prove a save will happen, so Aviary must keep treating its cross-origin anchor path as
degraded.

## Security, Privacy, and Reliability

- Keep GraphQL capture passive. The competitor incidents cluster around authenticated API calls,
  token rotation, rate limits, and X detecting request behavior. Aviary already gets the required
  `extended_entities`/`video_info.variants` from responses X requested for the visible feed.
- Define “best video” precisely as the highest-bitrate saveable progressive MP4. An HLS master may
  describe more renditions or subtitles, but saving `.m3u8` does not produce a standalone video.
- Prefer original photos with `format=<source-format>&name=orig`. Preserve the encoded format and
  add a bounded fallback to `4096x4096`; do not silently turn a failed original into an unrelated
  thumbnail.
- Stream URL downloads through the browser API or userscript manager. Do not buffer whole videos
  into blobs/base64; one competitor documented tens of gigabytes of memory growth during batches.
- Use one action per post, not one primary action per representation. A video poster is useful, but
  it must stay an explicitly secondary Thumb download.
- Keep controls persistent and stateful. Open-source issue reports repeatedly identify vanished,
  overlapping, misplaced, or indefinitely spinning buttons as the dominant usability failures.
- Request optional download access from an explicit gesture and explain the grant. Aviary's
  dedicated options surface already does this; the post action must route permission failures
  there rather than opening the CDN and claiming success.

## Architecture Assessment

- `media-metadata.ts` is the correct source of truth. It bounds captured bodies/nodes/depth,
  merges variants, and keys by media/tweet/poster without storing credentials.
- `video-extract.ts` currently ranks every saveable URL together. It should rank direct MP4 above
  HLS/manifests, then bitrate, then dimensions. That matches the browser's actual deliverable.
- `extract.ts` already produces a post-level media collection. A post action can filter it to
  primary assets (`photo`, `video`) while leaving `thumbnail` to the tile control.
- `media-buttons.ts` has reusable queue, history, filename, permission, audit, and feedback logic,
  but the download operation is coupled to one tile button. Extracting a result-returning operation
  will let tile and post controls share the same truth without programmatically clicking controls.
- Current X captures prove the action group through a stable relationship: a post's
  `[data-testid="reply"]` lives inside its `[role="group"]`. Locating the group from the reply
  control is narrower than selecting the first arbitrary role group.
- The MutationObserver reconciliation already handles virtualized posts and late media metadata.
  The post action should use the same lifecycle markers and teardown path.

## Rejected Ideas

- Originating tweet-detail API calls, scraping bearer tokens, or reading session cookies — proven
  functional elsewhere, but materially worse for privacy, rate limits, and account safety.
- Saving an HLS master as the “best video” — it is a playlist, not a standalone video file.
- Fetching complete videos into memory before invoking the download manager — unnecessary and
  unsafe for large files or batches.
- Hiding the only download action until hover — reduces discovery and conflicts with touch use.
- Gesture multiplexing on one icon — powerful but undiscoverable; keep left click obvious and the
  context menu explicit.
- Removing tile controls — they remain the cleanest way to save one photo or a video poster.
- Sending post URLs to hosted downloader services — adds disclosure, availability, and privacy
  costs while Aviary already possesses the direct CDN metadata locally.

## Sources

Reference implementations and field evidence:
- https://github.com/EltonChou/TwitterMediaHarvest
- https://github.com/EltonChou/TwitterMediaHarvest/blob/main/src/contentScript/core/Harvester.ts
- https://github.com/EltonChou/TwitterMediaHarvest/blob/main/src/libs/XApi/parsers/tweetMedia.ts
- https://github.com/EltonChou/TwitterMediaHarvest/releases/tag/v4.5.7
- https://github.com/EltonChou/TwitterMediaHarvest/issues/146
- https://github.com/EltonChou/TwitterMediaHarvest/issues/120
- https://github.com/EltonChou/TwitterMediaHarvest/issues/293
- https://github.com/EltonChou/TwitterMediaHarvest/issues/137
- https://github.com/EltonChou/TwitterMediaHarvest/issues/126
- https://github.com/EltonChou/TwitterMediaHarvest/issues/336
- https://github.com/AlttiRi/twitter-click-and-save
- https://github.com/AlttiRi/twitter-click-and-save/blob/master/twitter-click-and-save.user.js
- https://github.com/AlttiRi/twitter-click-and-save/issues/20
- https://github.com/AlttiRi/twitter-click-and-save/issues/49
- https://github.com/AlttiRi/twitter-click-and-save/issues/57
- https://github.com/ShanksSU/twitter-media-downloader
- https://github.com/Startanuki07/Twitter-X-Media-Copy-Download
- https://github.com/Teylersf/x-video-downloader
- https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py
- https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/twitter.py
- https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/twitter.js
- https://chromewebstore.google.com/detail/media-harvest-x-twitter-m/hpcgabhdlnapolkkjpejieegfpehfdok
- https://greasyfork.org/en/scripts/430132-twitter-click-n-save
- https://github.com/FxEmbed/FxEmbed/issues/1282

Platform contracts:
- https://developer.chrome.com/docs/extensions/reference/api/downloads
- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download
- https://www.tampermonkey.net/documentation.php
- https://violentmonkey.github.io/api/gm/

## Open Questions

1. Does the CDN ever reject `name=orig` while accepting `4096x4096` for a currently visible feed
   image in the extension path? Userscript evidence says yes; an authenticated browser run should
   retain the fallback and record which candidate completed.
2. Chrome's download promise confirms dispatch, not completion. A later pass should decide whether
   the on-post final label says Started or whether the background tracks `downloads.onChanged` to
   completion across service-worker suspension.
3. Quote posts, article cards, and “From @user” embedded media need ownership fixtures before their
   filenames can always name the original media author rather than the outer post author.
