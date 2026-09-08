# Research: Aviary
Date: 2026-09-06. Replaces all prior research.

## Executive Summary

Aviary v1.49.0 is a local-first X enhancement with feed-level media downloads, a compact Control Center, and a portable local archive. Its strongest direction is dependable capture and recovery, not another visual redesign. The current implementation can lose early video metadata, select a lower-resolution duplicate candidate, and leave a completed download disabled for five minutes. Storage experiments also found three independent lost-write paths. Fix those before adding formats or integrations. Evidence is in `src/main.ts`, `src/features/media/`, `src/platform/storage-lock.ts`, and `src/extension/durable-storage-api.ts`.

Priority order, with user impact scored from 1 to 5:

| Opportunity | Tier / impact / effort | Reason |
|---|---|---|
| Fence expired writers at the commit authority, F328 | Now / 5 / L | A resumed stale holder can erase another writer's accepted update. |
| Read migration's final snapshot after sealing, F329 | Now / 5 / M | A late note can disappear with the deleted source database. |
| Make fallback replay durably idempotent, F330 | Now / 5 / M | A retained old operation can replace a newer healthy write. |
| Retain early media observations, F331 | Next / 5 / M | A first feed response can be discarded before Download subscribes. |
| Preserve terminal download results, F277 refinement | Next / 5 / M | A completed transfer can leave Download disabled for 300 seconds. |
| Enrich duplicate video URLs before ranking, F332 | Next / 5 / M | An observed 1080p candidate can lose to 360p. |
| Enforce backup round-trip limits and versioned checksums, F333/F334 | Next / 5 / M | An emitted backup must remain readable and preserve destination credentials. |
| Prove real extension and userscript persistence, F327/F335 | Next / 4 / L | Shared-Map browser models cannot certify installed storage or lifecycle behavior. |
| Separate highest quality from compatibility, F283/F284/F310 | Later / 4 / M/XL | Unknown codec metadata is not a reason to silently save fewer pixels. |

This is correctness parity with reliable downloaders and archives. Aviary's useful distinction remains passive feed capture with local ownership, not a new crawler. See `README.md`, `src/page/page-agent.ts`, and `src/features/integrations/network-policy.ts`.

## Product Map

- Read X with themed, wider posts and conversations; configure 14 destinations and the extension options page. Sources: `src/ui/control-center.ts`, `src/features/appearance/theme.ts`, `tools/capture-theme.mjs`.
- Download observed video, GIF, and image media directly from posts; manage individual files through queue and history. Sources: `src/features/media/media-buttons.ts`, `batch-downloader.ts`, `history.ts`.
- Capture, search, annotate, import, and export a local library. Portable outputs include structured records and preservation packages. Sources: `src/features/library/`, `src/features/export/`.
- Back up profiles and connect optional user-configured services under the outbound policy. Sources: `src/features/core/library-backup.ts`, `src/platform/profile.ts`, `src/features/integrations/`.

The main users are daily feed readers, people collecting media, and researchers retaining searchable records. This is a product interpretation of those workflows, not a survey result. Chromium and Firefox extensions plus Tampermonkey/Violentmonkey userscripts share TypeScript modules. The package has no runtime dependencies; development uses esbuild, Node's test runner, and Playwright. `package.json`, both extension manifests, and `tools/build.mjs` define these contracts.

The repository is public as of 2026-09-06, MIT-licensed, and not a fork. Source is 1.48.0; the published release is 1.47.0. Distribution reconciliation belongs to F290 and the existing blocked release work. [Repository](https://github.com/SysAdminDoc/Aviary), [releases](https://github.com/SysAdminDoc/Aviary/releases).

## Competitive Landscape

| Reference | Learn | Avoid |
|---|---|---|
| TwitterMediaHarvest | One-click originals, per-file retry, bounded response caching. v4.5.7 fixes cache growth. | Highest bitrate alone is not a complete quality policy. |
| twitter-web-exporter | Passive response capture, selected-row export, explicit in-memory ZIP limits. v1.4.3 handles changed photo grids. | Treating an observed private response shape as stable. |
| yt-dlp | Resolution-first X format ordering, adaptive merging, subtitle handling. | Sending a status URL that triggers authenticated discovery when an observed manifest is enough. |
| gallery-dl | Original-image retries, fallback order, archive and naming discipline. | Downgrading after a transient connection failure. |
| Cobalt | Compact picker and selective lossless container repair. | Copying its 4096x4096 photo request as a universal original-quality rule. |
| Control Panel for Twitter | Maintained selector and clutter-control reference; v4.24.1 released 2026-09-05. | Assuming indirect X UI actions are request-free. |
| Minimal Twitter | Width controls and fewer decorative boundaries. Its Messages issue shows why action space matters. | Testing full width only for page overflow. |
| OldTwitter | Per-post downloads and explicit Firefox testing. | Replacing the entire client and inheriting its API maintenance burden. |
| GoodTwitter2 / calm-twitter | Historical layout alternatives and focused clutter reduction. | Using an uncertain-status legacy project as a current selector authority. |
| Bookmark X / Scrollmark | Checkpoints, canonical references, portable archives. Scrollmark adds a SQLite companion. | Treating temporary media URLs or page-origin storage as durable archives. |
| afkarxyz / FlandreDaisuki downloaders | Batch naming, pacing, asynchronous local-helper UX. | Copied session credentials or unauthenticated job-creation endpoints. |
| Dewey | Selected bookmark/media export is a paid product capability. | Importing cloud-account requirements into a local workflow. |
| Raindrop / Readwise Reader | Explicit backup boundaries and selective offline caching. | Calling a metadata export a complete media backup or promising every reply is captured. |
| SingleFile / Browsertrix | Capture budgets, preservation interoperability, independent structural fixtures. | Adding a crawler or copying code without license review. |

Sources are the named repositories and product documentation listed below. Historical [jdb8](https://github.com/jdb8/twitter-video-dl-extension) and [cosmicexplorer](https://github.com/cosmicexplorer/download-twitter-videos) downloaders were also inspected; their 2020 and 2016 maintenance dates make them prior art, not implementation dependencies.

The useful community signal is task-specific: DataHoarder reports describe low-quality batch results, duplicate work after restarts, and command-line friction. These support F277, F283, and F294, not a market-size claim. [Restart/quality complaint](https://www.reddit.com/r/DataHoarder/comments/1fdovxq/looking_for_a_twitterx_media_downloader_bulkbatch/), [command-line friction](https://www.reddit.com/r/DataHoarder/comments/1letaw5/twitter_bulk_media_downloading/).

## Reported Issues

**Verified tracker state, 2026-09-06:** issues are enabled, with no open issues, no closed issues returned, and no open pull requests; discussions are disabled. There is no upstream tracker because this is not a fork. No public issue cluster can be inferred. [Issues](https://github.com/SysAdminDoc/Aviary/issues), [pull requests](https://github.com/SysAdminDoc/Aviary/pulls).

The supplied disabled-download report has a concrete local failure consistent with the symptom: `download-watch.ts:98` consumes a terminal result before `media-buttons.ts:1185` calls `wait()`, which asks for it again. A deterministic complete-before-wait reproduction returned `complete` then `pending`. This proves a five-minute disabled-state path, not that every supplied console warning caused it. F277 owns the fix.

Peer reports add coverage requirements, not automatically Aviary bugs:

- Media Harvest #339 reports missing controls on older bookmarks; #355 reports history/likes state updating only on hover. Use metadata-not-observed recovery and route fixtures, F299/F308. Do not automate opening posts.
- Minimal Twitter #257 reports hidden Messages controls in full-width layout; OldTwitter #1347 reports a Firefox Download button doing nothing. Extend F302's actual-button and reflow checks.
- yt-dlp #8117 and #8750 concern container/playback failures. The affected URL already named AVC, so a known codec does not certify playback.
- Media Harvest #336 requests captions, which Aviary already captures through DOM and metadata paths. No duplicate feature item.
- yt-dlp #17105 requests complete Article media extraction. Multi-media ownership needs validation; it is not yet a demonstrated Aviary defect.

## Security, Privacy, and Reliability

Confidence labels distinguish source traces, deterministic models, and browser experiments.

### Lost-write paths

**Verified model, F328:** two independent storage-lock modules shared one register. Writer A read an empty value, paused past the lease, and writer B committed its update. Resuming A replaced B's value. `src/platform/storage-lock.ts:239-309` renews on timers without commit fencing. Chrome can freeze those timers. Checking ownership immediately before a write still leaves a check/write race. Enforce a generation at the resource accepting mutations; userscript storage needs stale-safe operations or a fail-closed path where exclusivity cannot be guaranteed. [Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [fencing analysis](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html).

**Verified Chromium IndexedDB experiment, F329:** migration copied a note, an old tab committed a newer note and closed, then sealing succeeded and deleted the source. The destination retained the old note. `src/extension/durable-storage-api.ts:289-329` verifies the initial snapshot, not a final sealed snapshot. Retain the source until final reconciliation and receipt verification; never overwrite a conflicting destination silently.

**Verified IndexedDB experiment, F330:** replay committed an old fallback value, legacy-marker removal failed, a healthy writer saved a newer value, and the next reconciliation restored the old fallback. `src/platform/durable-storage.ts:403-407,573-579` lacks durable applied-operation ordering. Store receipts atomically with values or tombstones; cleanup failure must not make an acknowledged operation new again.

These are distinct from profile-adoption cleanup F278 and ordinary stale full-snapshot writes F276. They are data-loss blockers even though `npm test` passes.

### Downloads and backups

**Verified connected-bridge experiment, F331:** a valid response before subscription produced zero delivered media events; a second response after subscription delivered one. Capture starts in `src/main.ts:139-150` before storage finishes, while the media consumer subscribes during feature initialization. `src/platform/page-bridge.ts:219-222` has no replay. Retain bounded extracted media metadata, not raw responses or credentials.

**Verified candidate experiment, F332:** `video-extract.ts:80-85,183-185` inserted a 1080p current source without dimensions, then dropped richer metadata for the same URL. A separate 360p variant won. `media-metadata.ts:375-389` also skips same-URL enrichment. Merge validated metadata before ranking and invalidate cached choices when it improves.

**Verified source trace, F333:** backup creation limits each collection, but the production parser rejects the entire encoded file above 100 MiB. `library-backup.ts:283-299,753` does not bound the emitted envelope. This needs aggregate UTF-8 boundary tests; no large-allocation experiment was used as evidence.

**Verified historical encoder test, F334:** the pending backup change extends checksum coverage to profile metadata but keeps schema version 2. The committed encoder produced a bookmark backup in memory that its own parser accepted; the changed parser rejected the same artifact with a manifest-checksum error. Keep historical fixtures when introducing the new schema. These unkeyed checksums detect accidental corruption, not an attacker who recomputes them. Stable profile IDs, destination credentials, and signing identity also need explicit restore tests. Sources: `src/features/core/library-backup.ts`, `tests/library-backup.test.mjs`. Do not weaken checksum validation by trying multiple formulas for one declared version.

**Verified bridge experiment, F336:** a storage estimate containing `persisted: true` emerged with only usage and quota. `src/extension/durable-storage-api.ts:150-158` drops the field. Preserve true, false, and unavailable separately.

Both manifests already request `unlimitedStorage`; do not re-propose the missing-permission diagnosis. Persistence is not a backup and does not protect against uninstall or disk failure. Chrome and Firefox have different quota and private-window behavior. F279 should disable extension private-mode use explicitly. [Chrome storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [Firefox storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local), [incognito](https://developer.chrome.com/docs/extensions/reference/manifest/incognito).

### Network and supply chain

F309 should prove Aviary's request boundary, not promise account or legal safety. X's automation policy says non-API scripting can lead to suspension; passive observation is not an exemption supplied by that policy. Retain no-cookie extraction and no authenticated-request discovery, audit indirect UI actions, and disclose optional outbound integrations. [X policy](https://help.x.com/en/rules-and-policies/x-automation), `src/page/page-agent.ts`, `src/platform/network.ts`.

Chrome's policy update effective 2026-08-01 includes local handling of clipped content and observed responses in disclosure requirements. Firefox submission declarations must distinguish local processing from optional transmission. F291 and blocked distribution work own those facts. [Chrome policy](https://developer.chrome.com/blog/cws-policy-updates-2026?hl=en), [Firefox manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).

The registry audit returned zero known advisories across 129 development packages on 2026-09-06. This is not proof of vulnerability absence. Keep F281's value-free diagnostics, F307's fail-closed default, F319's audience handling, and F282/F303's preservation validation. Sources: `package-lock.json`, `src/features/integrations/network-policy.ts`, `src/features/export/`.

## Architecture Assessment

### Quality policy

Correct F310: yt-dlp orders X formats by resolution, HLS preference, bitrate, then size. Its #8826 fix notes unreliable HTTP bitrate estimates. Cobalt's remux workaround addresses a time-bounded container defect. Neither supports automatically choosing lower quality because its codec is known. Record observed quality and codec certainty separately; an explicit compatibility output must not silently replace the best original. [Extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py), [format fix](https://github.com/yt-dlp/yt-dlp/pull/8826), [Cobalt](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/twitter.js).

Expand F283 beyond adaptive-only posts: a direct 720p MP4 must not hide an observed 1080p adaptive rendition. Offer the best direct file immediately and an explicit local-helper path for the higher rendition. Preserve audio and video without transcoding where the container permits it; report a different container when MP4 cannot carry the streams losslessly.

F284 should retry transient failures at original image quality before falling back after a permanent absence. `src/features/media/urls.ts:35-38` also turns a legacy `.png` path without a format query into `format=jpg`. The transformation is verified; the actual CDN byte consequence needs a format fixture. [gallery-dl behavior](https://github.com/mikf/gallery-dl/discussions/5034), [size configuration](https://gdl-org.github.io/docs/configuration.html#extractor-twitter-size).

### Validation and interface

**Verified headless inspection:** all 14 settings destinations and options were captured in dark and light; wide Status fixtures were checked in six palettes. The built interface uses flat rows, restrained borders, and readable grouping. Preserve this system. The useful gaps are terminal/error recovery, exact quality receipts, and full-width control clearance, not another page redesign. Sources: `tools/capture-settings.mjs`, `tools/capture-theme.mjs`, `tests/visual/baselines/`.

Those captures used the available 1.47.2 bundle and do not certify the pending source changes. The settings harness checks version rather than source identity, refuses widths below 1000, and normalizes storage status. F302 must verify artifact fingerprints and permit reflow cases; F336 must test real state without screenshot normalization. F286 should cover Catch-up and all non-panel surfaces; F313 should exercise focus visibility and target size beyond axe. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

**Verified automated result:** typecheck and all 920 tests passed. However, `tests/storage-authority-browser.test.mjs:216` substitutes a shared Node Map for extension and manager APIs. It is a cross-origin browser model, not installed Chrome/Firefox/Tampermonkey/Violentmonkey proof. F327 owns real extension lifecycle tests; F335 adds real manager persistence. No signed-in X download or installed-manager test was performed.

The two authentic captures date from 2026-05-19, 110 days before this research, beyond their 90-day ceiling; the waiver ends 2026-09-30. F306 should generate private-data-free fixtures without pretending a synthetic generation refreshes authentic evidence. F308 can add the changed `profile-photo-grid-*` and Videos structures now. Sources: `_decoded/dom-schema.json`, [exporter update](https://github.com/prinsss/twitter-web-exporter/commit/3e07f1e7ad7469c1bd6526b03bdcb90c495f25b1).

### Dependencies and delivery

| Change | Decision and owner |
|---|---|
| TypeScript 6.0.3 plus native preview | F289: stable 7.0.2 CLI alias, with exact `@typescript/typescript6@6.0.2` API compatibility alias. Current typescript-eslint requires TypeScript below 6.1. |
| typescript-eslint 8.67.0, ESLint 10.8.1, globals 17.11.0 | Evaluate 8.69.0, 10.10.0, and 17.12.0 together in F289; retain exact pins. |
| Playwright 1.62.1 | F302: evaluate 1.63.0. It adds structured JSON ARIA/trace features; basic ARIA snapshots and forced-colors testing already exist. Its new runner locking does not apply to Node's test runner. |
| axe 4.13.0, esbuild 0.28.2 | Current checked releases; no update task justified. |

Evidence: `package.json`, `tests/native-typecheck.test.mjs`, [TypeScript 7](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [typescript-eslint release](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.69.0), [Playwright releases](https://playwright.dev/docs/release-notes), and the dependency release URLs below.

The extension content bundle is approximately 2.33 MB against a 2.40 MB budget, leaving about 2.8 percent. F298 should lazy-load optional surfaces, with exact web-accessible chunks and a separate readable userscript budget. F297 should test a supported Firefox ESR and stable browser; Firefox 140 still received security fixes on 2026-09-01, so it is not already unsupported. The Chrome 116 floor comment names APIs the code does not use. Sources: `tools/preflight.mjs`, `src/extension/browser-floors.ts`, [Firefox advisory](https://www.mozilla.org/en-US/security/advisories/mfsa2026-84/).

AMO's documented reviewer runtime, Node 24.14.0 on Linux ARM64, is excluded by Aviary's engine range. Give reviewers a pinned compatible runtime instead of saying only Node 24. Source submission is needed for bundled code even without minification. [Submission requirements](https://www.extensionworkshop.com/documentation/publish/source-code-submission/), `package.json:14`.

### Category decisions

Security and reliability lead through F328-F334 and F279/F281. Accessibility remains F286/F312/F313; i18n is F287/F321-F323. Observability is F284/F299/F324/F336. Testing and release packaging belong to F288/F290/F297/F298/F302/F306/F327/F335. F291 owns documentation facts, including whole-profile backups, current permissions, and uninstall behavior.

Offline resilience needs replay and backup correctness before more cache capacity. Cross-tab/profile work is the relevant multi-user boundary, not cloud collaboration. Migration stays explicit through F278/F293/F311/F320/F334. Mobile gets responsive and touch coverage through F302, not a new native application. Plugin-ecosystem expansion is deferred in favor of one typed importer and one authenticated local-helper boundary. These dispositions follow the local-first architecture in `README.md`, `src/platform/profile.ts`, and `src/features/library/archive-import.ts`.

## Rejected Ideas

- Automatic scrolling, API discovery, and copied session tokens: conflict with the passive capture boundary and add account risk. Sources: afkarxyz and FlandreDaisuki READMEs, X automation policy.
- Codec certainty as a proxy for highest quality: contradicted by yt-dlp #8117/#8826 and Cobalt's selective remux repair.
- Mandatory cloud sync or a general plugin marketplace: adds credential, protocol, and recovery work before local durability is correct. Dewey and Readwise are comparisons, not architecture requirements.
- Replacing the X client or adding an iOS modification: [OldTwitter](https://github.com/dimdenGD/OldTwitter) and [BHTwitter](https://github.com/BandarHL/BHTwitter) inherit different API and attestation constraints; Aviary should retain augmentation.
- Raising storage ceilings as the sole backup fix: `library-backup.ts` must guarantee emitted-file round trips regardless of the chosen ceiling.
- Renewing leases more often or doing a pre-write ownership check: neither fences a delayed write at the accepting resource. Kleppmann's analysis and the local two-writer reproduction show why.
- Adding captions, ZIP export, or generic decluttering again: these already exist in `src/features/media/`, `src/features/export/`, and `src/features/layout/`; new work should target proved gaps.

## Sources

### Downloading and direct peers

- https://github.com/EltonChou/TwitterMediaHarvest
- https://github.com/EltonChou/TwitterMediaHarvest/releases/tag/v4.5.7
- https://github.com/EltonChou/TwitterMediaHarvest/issues/339
- https://github.com/EltonChou/TwitterMediaHarvest/issues/355
- https://github.com/EltonChou/TwitterMediaHarvest/issues/336
- https://github.com/prinsss/twitter-web-exporter/releases/tag/v1.4.3
- https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py
- https://github.com/yt-dlp/yt-dlp/pull/8826
- https://github.com/yt-dlp/yt-dlp/issues/8117
- https://github.com/yt-dlp/yt-dlp/issues/8750
- https://github.com/yt-dlp/yt-dlp/issues/17105
- https://github.com/mikf/gallery-dl/discussions/5034
- https://gdl-org.github.io/docs/configuration.html#extractor-twitter-size
- https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/twitter.js
- https://github.com/insin/control-panel-for-twitter/releases/tag/v4.24.1
- https://github.com/typefully/minimal-twitter/issues/257
- https://github.com/dimdenGD/OldTwitter/issues/1347
- https://github.com/Bl4Cc4t/GoodTwitter2
- https://github.com/yusukesaitoh/calm-twitter
- https://github.com/LucasDitchun/export-bookmarks-x-twitter
- https://github.com/kmccleary3301/scrollmark/releases/tag/v1.5.0
- https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader
- https://github.com/FlandreDaisuki/Twitter-Media-Downloader

### Product, community, and discovery

- https://getdewey.co/pricing/
- https://getdewey.co/how-to-use/export-bookmarks/
- https://help.raindrop.io/export
- https://docs.readwise.io/reader/docs/faqs/adding-new-content
- https://docs.readwise.io/reader/docs/faqs
- https://github.com/gildas-lormeau/SingleFile
- https://github.com/webrecorder/browsertrix-behaviors
- https://github.com/awesome-scripts/awesome-userscripts
- https://github.com/hridaydutta123/awesome-twitter-tools
- https://www.reddit.com/r/DataHoarder/comments/1fdovxq/looking_for_a_twitterx_media_downloader_bulkbatch/
- https://www.reddit.com/r/DataHoarder/comments/1letaw5/twitter_bulk_media_downloading/

### Standards, engineering, and platform policy

- https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- https://www.microsoft.com/en-us/research/publication/new-solution-dijkstras-concurrent-programming-problem/
- https://www.inkandswitch.com/essay/local-first/
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- https://w3c.github.io/web-locks/
- https://www.w3.org/TR/IndexedDB-3/
- https://html.spec.whatwg.org/multipage/web-messaging.html
- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- https://specs.webrecorder.net/wacz/1.1.1/
- https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/
- https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
- https://developer.chrome.com/docs/extensions/reference/manifest/incognito
- https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/blog/cws-policy-updates-2026?hl=en
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- https://www.extensionworkshop.com/documentation/publish/source-code-submission/
- https://help.x.com/en/rules-and-policies/x-automation
- https://www.tampermonkey.net/documentation.php
- https://violentmonkey.github.io/api/gm/

### Dependencies and browser support

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.69.0
- https://github.com/dequelabs/axe-core-npm/releases/tag/v4.13.0
- https://github.com/evanw/esbuild/releases/tag/v0.28.2
- https://github.com/eslint/eslint/releases/tag/v10.10.0
- https://github.com/sindresorhus/globals/releases/tag/v17.12.0
- https://playwright.dev/docs/release-notes
- https://www.mozilla.org/en-US/security/advisories/mfsa2026-84/
- https://www.firefox.com/en-US/firefox/153.0esr/releasenotes/

## Open Questions

- **Needs live validation:** the best observed direct/adaptive quality and recovery behavior on fresh signed-in X fixtures, including protected posts, current profile grids, and actual downloaded bytes. Synthetic fixtures cannot answer this; keep the existing authenticated-capture items in `Roadmap_Blocked.md`.
- **Needs installation validation:** actual extension/manager persistence under restart and freezing. F327/F335 can use disposable profiles; no user profile or active display is needed.
- Store identity and signing material remain external prerequisites for the existing blocked distribution tasks. They do not block the local correctness fixes.
