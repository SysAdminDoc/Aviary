# Research: Aviary

Date: 2026-08-23. Replaces all prior research.

Version reviewed: `1.47.0`

Confidence labels used below:

- **Verified** means the claim was confirmed in this repository or a primary source.
- **Likely** means independent community or market evidence agrees, but the claim was not reproduced locally.
- **Assumption** means a product choice is proposed from the evidence.
- **Needs live validation** means an authenticated current X session or external distribution environment is required.

## Executive Summary

**Verified:** Aviary is a mature, local-first X enhancer delivered as a readable userscript and Chrome/Firefox Manifest V3 extension. It already has the premium visual pass, conspicuous feed download controls, original-image fallback, highest observed progressive-MP4 selection, media queues and history, local capture and search, and WARC/WACZ export. Its strongest direction is therefore reliability and truthfulness, not another visual rewrite. The most serious new finding is that `src/main.ts` opens IndexedDB from the extension content script, which Chrome documents as host-page storage, while `src/entrypoints/extension-options.ts` opens the same database name from the extension origin. This can expose local records to x.com page code and split the dataset between two origins. After that boundary is fixed, the highest-value product work is restart-safe download reconciliation, an explicit adaptive-video handoff, and quality receipts that say exactly what file was saved.

Priority order:

1. **Verified:** move extension durable storage to one extension-owned background database and migrate host-origin data without loss.
2. **Verified:** make the fallback journal, restore path, and remaining full-snapshot writers atomic across tabs.
3. **Verified:** reconcile a retained browser download ID before resuming, so reload cannot create a duplicate file.
4. **Verified:** prevent private-session persistence and remove raw diagnostic values that contradict `docs/PRIVACY.md`.
5. **Verified:** correct CDXJ response status values and gate WACZ output with an external validator and ReplayWeb smoke test.
6. **Likely:** add an explicit local yt-dlp path for adaptive-only video without cookies, pasted tokens, or browser-side transcoding.
7. **Verified:** record non-identifying quality provenance and let a fallback image be retried at original quality later.
8. **Verified:** close accessibility, native localization, large-library, release, compiler, and documentation coverage gaps.

## Product Map

- **Verified, core workflows:** make X easier to read; widen and simplify timelines, replies, and threads; filter or hide posts reversibly; save post media; keep a local searchable library; export portable archives.
- **Verified, users:** privacy-conscious readers, media collectors, archivists, and people who want a quieter high-density X interface.
- **Verified, platforms:** a userscript plus Chrome 116 and Firefox 128 Manifest V3 packages. The extension requests `downloads` and media-host access only from its permissions page.
- **Verified, data flow:** `src/main.ts` boots a feature registry, observes X responses already delivered to the page, stores profile-scoped state, and hands explicit downloads to `src/entrypoints/extension-background.ts`. Optional Aria2, crosspost, provider, and embedding integrations remain user-configured.
- **Verified, philosophy:** no X cookies or bearer-token extraction, no originated authenticated X requests, no remote code, narrow permissions, reversible UI changes, and local-first records.

### Current interface and download baseline

- **Verified:** `docs/audit/2026-08-22-premium-final/` covers all 14 Control Center destinations in dark and light themes, the extension options page, 1440x900 and 1920x1080 X layouts, and desktop/mobile media controls. The current flat hierarchy, spacing, type scale, full-width thread layout, and filled Download action are coherent. Another visual-system rewrite is not supported by the evidence.
- **Verified:** the earlier grey permission-button and inline-script CSP failure is not open work in this build. `src/extension/options.html` loads a packaged external script, `tests/extension-options-page.test.mjs` drives the permission flow, and `tools/preflight.mjs` rejects inline extension scripts. The remaining download risk is lifecycle recovery after a page or worker restart.
- **Verified:** `src/features/media/media-buttons.ts` provides a labeled post action and per-asset controls. Narrow feeds move Download into a full-width row. Statuses distinguish running, completed, failed, duplicate, opened, and permission-required states.

### Best-quality image and video findings

- **Verified, images:** X documents that a bare media URL defaults to a smaller rendition and that the current form is `<base>?format=<format>&name=<name>`. `src/features/media/urls.ts` tries the source format with `name=orig`, then `name=4096x4096`. This matches the leading direct-download tools and gallery-dl's ordered fallback strategy. The saved extension must come from the actual format or response MIME type, never a suffix such as `.jpg_orig`.
- **Verified, progressive video:** X media entities expose variants with content type and bitrate. `src/features/media/video-extract.ts` chooses the highest numeric bitrate among complete direct MP4 candidates that Aviary passively observed. This is the correct zero-setup browser path and must remain the default.
- **Verified, adaptive video gap:** Aviary rejects `.m3u8`, `.mpd`, `.m4s`, and fragment-only candidates. yt-dlp parses HLS/DASH renditions and merges audio/video, while gallery-dl either chooses the highest direct bitrate or delegates video work to yt-dlp. Aviary can therefore promise the best observed progressive MP4, not the absolute best rendition for every post.
- **Assumption:** the safest improvement is an explicit local yt-dlp handoff for an already-observed adaptive manifest. The fallback must remain visible and opt-in, use no X cookie or pasted token, and never label a copied command or opened helper as a completed download.
- **Verified:** current media history stores hashes and timestamps but no candidate label, dimensions, or bitrate. A quality receipt can add `original`, `4096x4096 fallback`, pixel dimensions, or progressive bitrate without retaining the source URL.
- **Needs live validation:** the authenticated X captures in `fixtures/current-x/` date from 2026-05-19. `Roadmap_Blocked.md` already holds current-X route and video-quality proof work, and its temporary capture waiver expires on 2026-09-30. No claim of universal 2026-08-23 feed coverage is justified until that capture is refreshed.

## Competitive Landscape

- **[Media Harvest](https://github.com/EltonChou/TwitterMediaHarvest), Verified:** one-click media saving, original files, native placement, naming, and conflict diagnostics set the direct-download baseline. Its changelog shows repeated X parsing, quote, modal, cache, and missing-button repairs. Learn from the maintenance record and bounded caches. Avoid response hooks that can break X initialization.
- **[Twitter Click'n'Save](https://github.com/AlttiRi/twitter-click-and-save) and [x-loader](https://github.com/paytonison/x-loader), Verified:** both validate original images, highest direct MP4 bitrate, deterministic names, and local history. Aviary already matches these table stakes. Avoid hover-only discovery and x-loader's cookie/token access.
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [gallery-dl](https://github.com/mikf/gallery-dl), Verified:** they lead on adaptive formats, templates, archives, retry behavior, and extractor maintenance. Learn from their format sorting and explicit partial states. Avoid importing their cookie-heavy crawler model into the browser extension.
- **[X Video Saver](https://chromewebstore.google.com/detail/x-twitter-video-saver-one/cdiepbclbdekidfbjkiiapppmepoafpa?hl=en-US), [Downie](https://software.charliemonroe.net/trial/downie/v4/rnotes.html), and [4K Video Downloader Plus](https://www.4kdownload.com/products/videodownloader), Verified:** commercial products monetize unlimited jobs, quality choice, naming, cloud destinations, history, post-processing, and support. Learn from clear quality selection and browser handoff. Avoid accounts, redirects, and cloud dependence in the core click path.
- **[Control Panel for Twitter](https://github.com/insin/control-panel-for-twitter) and [Minimal Twitter](https://github.com/typefully/minimal-twitter), Verified:** these validate declutter, width, count hiding, themes, and rapid compatibility fixes. Aviary's 2026-08-22 UI already covers the useful overlap. Avoid route rewriting, undocumented flags, and hosted downloader dependencies.
- **[OldTwitter](https://github.com/dimdenGD/OldTwitter), [OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck), and [Nitter](https://github.com/zedeus/nitter), Verified:** replacement clients offer chronology, columns, RSS, and independent reading. Their recurring security-header, private-API, account, and rate-limit failures argue against replacing X or pooling credentials.
- **[Twitter Web Exporter](https://github.com/prinsss/twitter-web-exporter), [Scrollmark](https://github.com/kmccleary3301/scrollmark), and [xarchive](https://github.com/sytelus/xarchive), Verified:** passive capture, durable jobs, portable bundles, local search, and explicit gaps are the correct archive shape. Aviary already covers most of it. Learn from canonical bundle import and malformed-row isolation. Avoid monolithic in-memory ZIPs and service-worker-only state.
- **[ArchiveWeb.page](https://archiveweb.page/) and [SingleFile](https://github.com/gildas-lormeau/SingleFile), Verified:** one-click preservation and WACZ replay are useful reference points. Aviary should validate its existing structured WACZ output rather than add debugger permission or serialize an entire feed into one HTML blob.
- **[Dewey](https://getdewey.co/), [Raindrop](https://raindrop.io/pro), and [Pagefreezer](https://www.pagefreezer.com/social-media-archiving/), Verified:** paid value clusters around search, annotations, permanent copies, backups, integrity, and export. Aviary should keep those local and portable instead of adding a required account.
- **[Tweetback](https://github.com/tweetback/tweetback), [ADHX](https://github.com/itsmemeworks/adhx), and [OmniSaver](https://github.com/yelosheng/omnisaver), Verified:** static archives, RSS, triage, and mobile share targets are useful adjacent ideas. Static local export fits. A server-backed social archive or mobile claim does not fit until a tested platform path exists.

### Repeated user signal

- **Likely:** users repeatedly value a visible native button, no redirect, no sign-in, original images, highest video quality, deterministic filenames, mixed-media coverage, and a state that explains failure. Firefox, Greasy Fork, Reddit, and Mozilla support reports repeatedly complain about missing buttons, endless spinners, links that only play, external tabs, wrong extensions, and regressions limited to feed versus detail pages.
- **Likely:** whole-account crawling and token-pasting attract demand but also produce abandonment, rate limits, setup failures, and trust concerns. Aviary's visible/captured-only boundary remains the better fit.
- **Likely:** localization helps adoption. Mozilla's Control Panel for Twitter spotlight attributes substantial growth in Japan to translated UI, while Aviary's native manifest and context-menu text remain English-only.

## Reported Issues

- **Verified:** `SysAdminDoc/Aviary` has issues enabled but no open or closed issues, no pull requests, and discussions disabled as of 2026-08-23. There is no tracker backlog to import.
- **Verified:** the repository owner's 2026-08-22 report about a disabled permissions control and CSP violation was addressed in the current options page and its behavior tests. It is not repeated in the roadmap.
- **Needs live validation:** current X route coverage, the August media redesign, sensitive-media markup, and absolute video-quality proof remain in `Roadmap_Blocked.md`. Creating duplicate roadmap items would not unblock them.

## Security, Privacy, and Reliability

- **Verified, P0:** `src/entrypoints/extension-content.ts` calls `boot()`, `src/main.ts` creates the default IndexedDB backend, and Chrome states that web storage called from a content script belongs to the host page. `src/entrypoints/extension-options.ts` creates the same database from the extension origin. The content and options surfaces therefore do not share one database, and scripts running on x.com can address the host-origin database. The keys in `src/platform/durable-storage.ts` include settings, notes, queues, captured archives, and the WACZ signing identity. No evidence that X reads the database was found.
- **Verified, P0:** `DurableStorageGateway.#markPending()` performs an unlocked read-modify-write of `aviary.durable.pending`. Concurrent fallback writes can erase each other's markers, so a later healthy boot can restore stale backend data.
- **Verified, P1:** `restoreLibraryBackup()` holds `aviary.library.restore`, while normal stores hold unrelated per-key locks. A normal write can occur during snapshot, restore, or rollback and then be overwritten.
- **Verified, P1:** settings, profiles, media queue, export jobs, and diagnostics still persist full in-memory snapshots in `src/main.ts`, `src/platform/profile.ts`, `src/features/media/queue.ts`, `src/features/export/jobs.ts`, and `src/platform/diagnostics-store.ts`. A lock serializes stale replacements but does not merge them.
- **Verified, P1:** both manifests omit an `incognito` policy. If a user enables the extension in private browsing, the default spanning behavior can persist private-session records into shared extension storage. The safe current choice is `not_allowed` until a memory-only mode exists.
- **Verified, P1:** `src/platform/diagnostics-store.ts` persists `details.message`, `details.error`, or `details.reason`, while `docs/PRIVACY.md` promises detail-field names and never values. Provider and system error strings can therefore survive for seven days. Existing stored values also need removal.
- **Verified, P1:** `src/extension/ad-rule.ts` models the network shield as one extension-global dynamic rule, but the control is profile-scoped. Two tabs with opposite profiles race. Session DNR rules support `tabIds`, which makes per-tab enforcement possible without broader access.
- **Verified, P2:** `src/features/filtering/regex-budget.ts` and `src/features/appearance/custom-css.ts` are large hand-written analyzers around user input. Commit history shows repeated bypass fixes. No current bypass was found, so the supported action is differential and mutation testing, not a parser rewrite.
- **Verified:** `npm audit` reported zero known vulnerabilities across the current dependency tree on 2026-08-23. esbuild 0.28.2 is above the fixed ranges in the reviewed advisories. The public Playwright binary-integrity report is closed and unconfirmed, so it does not justify an emergency dependency change.

## Architecture Assessment

- **Verified:** the extension needs one storage authority. Put IndexedDB in `src/entrypoints/extension-background.ts` behind a typed request API, keep content/options as clients, and migrate existing host-origin records only after a checksum-confirmed copy. The userscript must use manager-owned storage or explicitly refuse oversized persistence, not silently write account data into x.com IndexedDB.
- **Verified:** storage operations need a lock hierarchy. Ordinary writers should take a shared restore gate plus a per-store write lock, while restore takes the exclusive gate. Snapshot stores must merge deltas against the value read inside the lock.
- **Verified:** `src/features/media/queue.ts` turns a persisted running job into paused while retaining `downloadId`. Resume starts a new download because the background has no status-query message. Chrome download IDs persist across browser sessions and `downloads.search({id})` can reconcile them.
- **Verified:** `src/platform/profile.ts#adoptLegacyIntoActive()` writes the destination and then removes the source. A failure between those steps causes later runs to see the destination, skip the key, and leave legacy data forever. A per-key migration journal makes the operation retry-convergent.
- **Verified:** synthetic HTTPS records in `src/features/export/warc.ts` are indexed with CDXJ `status: "-"`, although the field is the HTTP response status. `src/features/export/wacz.ts` also omits stable contextual metadata fields. Conformance needs an external validator and replay test, not more internal shape assertions.
- **Verified:** `tests/a11y-axe.test.mjs` manually lists 13 destinations and omits `catchup`; it does not cover options, injected download controls, dialogs, toasts, or the archive viewer. The canonical section registry should drive the matrix.
- **Verified:** manifests and `src/extension/media-context-menu.ts` hard-code English. `_locales`, `__MSG_*`, and `chrome.i18n` can reuse the existing nine-locale catalog.
- **Verified:** stable TypeScript 7.0.2 supersedes `@typescript/native-preview`. Microsoft's side-by-side guidance supports TypeScript 7 for the CLI and `@typescript/typescript6` under the `typescript` alias for tools that still need the TypeScript 6 API.
- **Verified:** release notes for TypeScript, typescript-eslint, ESLint, esbuild, Playwright, axe-core, and globals were reviewed on 2026-08-23. Only the stable TypeScript transition changes an Aviary capability. ESLint 10.9.0 is a routine patch, and the other pinned packages are current.
- **Verified:** GitHub releases exist for 1.37.0, 1.45.0, and 1.47.0, but not 1.38.0 through 1.44.1 or 1.46.0, even though exact version commits exist. A local release command should build, verify, tag, publish, and verify the remote record as one recoverable transaction.
- **Verified:** public documentation has measurable drift. `docs/FAQ.md` still generates 12-page settings copy while the app has 14 destinations, and older design/branding text carries obsolete widths, themes, or product names. Documentation tests should read canonical runtime values.

## Rejected Ideas

- **Verified, rejected:** cookie, `auth_token`, CSRF, bearer-token, or private GraphQL crawling. x-loader, gallery-dl, OldTwitter, OldTweetDeck, and several userscripts show the maintenance and trust cost. It conflicts with Aviary's passive boundary.
- **Verified, rejected:** a hosted redirect downloader as the primary path. Minimal Twitter removed one for performance and focus costs, while store reviews repeatedly identify redirects, ads, dead links, and sign-ins as failures.
- **Verified, rejected:** broad multi-site permissions or a generic downloader. Aviary's narrow X and optional media-host permissions are a competitive trust advantage.
- **Verified, rejected:** browser-side ffmpeg/WASM for adaptive video. It adds a large executable payload, memory pressure, and packaging risk. A local yt-dlp handoff is the smaller, maintained path.
- **Verified, rejected:** automatic profile or whole-account crawling. It would originate X requests, make partial completion hard to state honestly, and duplicate current rate-limit failures.
- **Assumption, rejected:** a public plugin marketplace or remotely loaded plugin system. Remote code conflicts with store policy, and in-process plugins would expand the attack surface without recurring user demand. Fixed local integrations remain sufficient.
- **Assumption, rejected:** multi-user or cloud accounts in the core product. Browser profiles and Aviary profiles already provide separation. Portable local backup is a better fit than server-side identity.
- **Needs live validation, rejected for now:** marketing mobile support. Demand exists, but no current Android/iOS browser matrix is verified and token-pasting workarounds are unacceptable.
- **Verified, rejected:** another broad UI redesign. The 2026-08-22 captures already show the requested compact, premium, full-width system. Remaining interface work belongs to error, recovery, accessibility, and native localization states.

## Sources

### Direct open-source competitors

- https://github.com/insin/control-panel-for-twitter
- https://github.com/insin/control-panel-for-twitter/releases/tag/v4.24.0
- https://github.com/typefully/minimal-twitter
- https://github.com/typefully/minimal-twitter/pull/244
- https://github.com/dimdenGD/OldTwitter
- https://github.com/dimdenGD/OldTweetDeck
- https://github.com/zedeus/nitter
- https://github.com/AlttiRi/twitter-click-and-save
- https://github.com/paytonison/x-loader
- https://github.com/EltonChou/TwitterMediaHarvest
- https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader
- https://github.com/mikf/gallery-dl
- https://github.com/yt-dlp/yt-dlp
- https://github.com/prinsss/twitter-web-exporter
- https://github.com/kmccleary3301/scrollmark
- https://github.com/sytelus/xarchive
- https://github.com/lhl/tweetxvault
- https://github.com/webrecorder/archiveweb.page
- https://github.com/gildas-lormeau/SingleFile
- https://github.com/tweetback/tweetback

### Commercial and closed-source products

- https://chromewebstore.google.com/detail/x-twitter-video-saver-one/cdiepbclbdekidfbjkiiapppmepoafpa?hl=en-US
- https://www.4kdownload.com/products/videodownloader
- https://software.charliemonroe.net/help/downie/?article=extensions
- https://software.charliemonroe.net/trial/downie/v4/rnotes.html
- https://help.circleboom.com/twitter/getting-started/plans-and-pricing-circleboom-twitter
- https://getdewey.co/how-to-use/export-bookmarks/
- https://raindrop.io/pro
- https://www.pagefreezer.com/social-media-archiving/

### Adjacent projects and awesome lists

- https://github.com/itsmemeworks/adhx
- https://github.com/yelosheng/omnisaver
- https://github.com/iipc/awesome-web-archiving
- https://github.com/hridaydutta123/awesome-twitter-tools
- https://github.com/ruarxive/awesome-digital-preservation

### Community and support signal

- https://greasyfork.org/fil/scripts/529453-twitter-x-media-downloader/feedback
- https://addons.mozilla.org/en-US/firefox/addon/twitter-image-video-downloader/reviews/
- https://support.mozilla.org/en-US/questions/1569263
- https://www.reddit.com/r/DataHoarder/comments/16i7f1e/twitter_media_downloader_browser_extension_has/
- https://www.reddit.com/r/windowsapps/comments/1smynpt/any_free_tools_to_download_videos_from_x_twitter/
- https://news.ycombinator.com/item?id=46284266
- https://lobste.rs/s/llf3mg/lobste_rs_has_had_js_error_here_is
- https://stackoverflow.com/questions/32145166/get-video-from-tweet-using-twitter-api
- https://stackoverflow.com/questions/66211050/twitter-api-v2-video-url

### Standards and platform APIs

- https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/reference/api/downloads
- https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest
- https://developer.chrome.com/docs/extensions/reference/manifest/incognito
- https://developer.chrome.com/docs/extensions/develop/ui/i18n
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://w3c.github.io/web-locks/
- https://www.w3.org/TR/IndexedDB-3/
- https://docs.x.com/x-api/fundamentals/data-dictionary
- https://docs.x.com/x-api/enterprise-gnip-2.0/fundamentals/data-dictionary
- https://www.rfc-editor.org/rfc/rfc8216
- https://github.com/webrecorder/specs/blob/main/wacz/1.2.0/index.md
- https://specs.webrecorder.net/cdxj/0.1.0/
- https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/
- https://www.w3.org/TR/WCAG22/

### Academic and engineering research

- https://arxiv.org/abs/2406.12710
- https://arxiv.org/abs/2404.06827
- https://arxiv.org/abs/1901.03397
- https://arxiv.org/abs/2406.00374
- https://blog.mozilla.org/addons/2024/04/04/developer-spotlight-control-panel-for-twitter/

### Dependencies and security advisories

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- https://github.com/typescript-eslint/typescript-eslint/releases
- https://github.com/microsoft/playwright/releases
- https://github.com/eslint/eslint/releases
- https://github.com/evanw/esbuild/releases
- https://github.com/dequelabs/axe-core/releases
- https://github.com/sindresorhus/globals/releases
- https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99
- https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr
- https://github.com/evanw/esbuild/security/advisories/GHSA-gv7w-rqvm-qjhr
- https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/05-Testing_for_CSS_Injection
- https://developer.chrome.com/docs/webstore/user_data

## Open Questions

- **Needs live validation:** which current X routes expose direct MP4 variants, which expose only adaptive manifests, and whether multi-video, quote, reply, modal, GIF, and profile-media surfaces still share the same response shapes after 2026-08-13.
- **Needs live validation:** practical capacity, transaction behavior, and cross-manager portability of Tampermonkey and Violentmonkey storage for the userscript's largest durable collections. This affects the userscript backend chosen in F273, not the extension-origin fix.
- **Needs live validation:** Chrome Web Store and Mozilla review treatment for an optional localhost yt-dlp helper. The copy-command fallback can ship without that review dependency.
