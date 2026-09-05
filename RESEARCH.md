# Research: Aviary

Date: 2026-09-05. Replaces all prior research.

Version reviewed: `1.47.2` at `9a5970a`, plus the shelved cross-origin storage-authority work described by F300.

Confidence labels:

- **Verified:** confirmed in this repository, its tracker, or a primary source.
- **Likely:** supported by independent current evidence but not reproduced in an authenticated X session.
- **Assumption:** a product decision inferred from the evidence.
- **Needs live validation:** requires current authenticated X or store-distribution access.

## Executive Summary

**Verified:** Aviary is a mature, local-first X enhancer with 36 registered feature modules (`src/main.ts`), 21 centralized selector surfaces (`src/platform/selectors.ts`), userscript and MV3 extension builds (`tools/build.mjs`), and broad local test coverage (`tests/`). Its strongest shape is passive enhancement: it reads the page and responses X already delivered, keeps the library on-device, and originates no authenticated X request (`src/page/page-agent.ts`, `src/platform/network.ts`). That boundary is more defensible than alternate clients or automated downloaders, whose current issue trackers show account locks, rate limits, and recurring frontend breakage. The highest-value direction is to finish the user's minimal-UI request at the real X DOM boundary, then protect the truth and recoverability of the local archive.

Priority order:

1. **Verified:** remove X's native 2 px reply connector. The 1.47.2 change removed only Aviary's former `::before` line, while `tests/smoke/current-x-status.html` contains no native connector node and `tests/conversation-theme.test.mjs` can pass without exercising the reported defect.
2. **Verified:** suppress hover-only UI, including X profile cards and visual tooltips, while preserving accessible names and click-opened menus. Aviary removed its own `title` attributes, but has no `hoverCardParent` or tooltip suppression path (`src/`, `tests/`; [GoodTwitter2 #575](https://github.com/Bl4Cc4t/GoodTwitter2/issues/575)).
3. **Verified:** complete F295 and F296 before describing the library as durable. Browser storage is evictable without persistence, and the current whole-library backup is profile-scoped and can create a payload larger than its own 100 MiB restore ceiling (`src/platform/durable-storage.ts`, `src/features/core/library-backup.ts`; [Chrome storage guidance](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)).
4. **Verified:** stop marking every rendered post as seen. `src/features/filtering/seen-posts-feature.ts` records an ID during the first scan even when the post is below the viewport; a visibility and dwell gate is required before Catch-up can claim the viewer saw it.
5. **Verified:** preserve protected or unknown audience state before share-oriented export. `ExportRecord` has no audience field even though captured GraphQL user records expose `protected` (`src/features/export/types.ts`, `src/features/export/thread-capture.ts`; [X data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary)).
6. **Verified:** make preservation output truthful. `src/features/export/warc.ts` synthesizes `HTTP/1.1 200 OK` for media when only payload bytes were retained and renders capture time as the post's visible time. F282 and F303 should require resource records for payload-only captures and separate authored time from capture time ([WARC 1.1](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/)).
7. **Verified:** remove base64 duplication from large archive imports. A 256 MiB source becomes roughly 341 MiB of base64 before decoding and parsing (`src/features/library/archive-import-jobs.ts`, `src/features/library/archive-import.ts`).
8. **Verified:** carry post language and bidirectional isolation through collection, search, HTML, Markdown, JSON, CSV, WARC, and the offline viewer. `ExportRecord` lacks post language and exported HTML hardcodes `lang="en"` (`src/features/export/types.ts`, `src/features/export/formatters.ts`).
9. **Verified:** replace the lone draft `aria-description` use with a DOM description referenced by `aria-describedby` (`src/features/ai/command-menu.ts`; [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)).
10. **Verified:** attribute mutation cost by feature before adding more document-start work. All active `apply()` functions run serially after each coalesced mutation batch, with no per-feature timing (`src/features/registry.ts`, `src/platform/observer.ts`; [Long Animation Frames](https://w3c.github.io/long-animation-frames/)).

## Product Map

- **Verified, core workflows:** declutter and restyle X, filter or hide posts reversibly, save media, collect a searchable local library, and export portable or replayable archives (`README.md`, `src/features/`).
- **Assumption, personas:** privacy-conscious readers, archivists, researchers, and media collectors who want a quieter X without handing an account or archive to another service (`README.md`, `docs/PRIVACY.md`).
- **Verified, platforms:** one readable userscript for Tampermonkey and Violentmonkey, plus Chrome and Firefox MV3 packages (`src/extension/manifest.chrome.json`, `src/extension/manifest.firefox.json`, `dist/README.md`). Chrome 116 and Firefox 128 are the declared floors, although F297 already records that the Firefox floor is obsolete (`src/extension/browser-floors.ts`).
- **Verified, distribution:** the repository is private, the Firefox ID is `aviary@example.local`, and the latest GitHub release is 1.47.0 while source is 1.47.2. F125, F183, and F290 already own those release and identity decisions (`src/extension/manifest.firefox.json`, `Roadmap_Blocked.md`, `ROADMAP.md`).
- **Verified, data flow:** DOM and already-delivered GraphQL observations become profile-scoped IndexedDB or userscript-manager records; export may fetch selected media CDN assets, and optional user-triggered integrations may contact configured providers (`src/main.ts`, `src/page/page-agent.ts`, `src/platform/durable-storage.ts`, `src/features/export/`, `src/features/integrations/`).

## Competitive Landscape

- **[Control Panel for Twitter](https://github.com/insin/control-panel-for-twitter), Verified:** strong granular decluttering and current releases. Learn from its narrow switches and viewport testing. Avoid request-generating features: [issue #931](https://github.com/insin/control-panel-for-twitter/issues/931) reports an account lock after rapid retweet traffic.
- **[Minimal Twitter](https://github.com/typefully/minimal-twitter), Verified:** proves demand for wide, borderless reading. Keep width rules route-aware because [issue #186](https://github.com/typefully/minimal-twitter/issues/186) made DM controls unreachable and [issue #257](https://github.com/typefully/minimal-twitter/issues/257) records another width regression.
- **[OldTwitter](https://github.com/dimdenGD/OldTwitter), Verified:** proves demand for a complete visual reset. Avoid its full-frontend replacement architecture because current gallery, timeline, and download breakages make X churn the product's main workload.
- **[OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck), Verified:** multi-column monitoring remains attractive. Avoid it because [issue #517](https://github.com/dimdenGD/OldTweetDeck/issues/517) reports sustained rate limits and [issue #551](https://github.com/dimdenGD/OldTweetDeck/issues/551) reports posting-related suspension risk.
- **[GoodTwitter2](https://github.com/Bl4Cc4t/GoodTwitter2), Verified:** its issues are a useful X-breakage feed. Learn from [issue #575](https://github.com/Bl4Cc4t/GoodTwitter2/issues/575), where hovercards caused accidental destructive clicks. Avoid replacing X's full shell.
- **[Calm Twitter](https://github.com/yusukesaitoh/calm-twitter), Verified:** focused low-noise controls fit Aviary. Its requests to hide For You separately and remove the account-switcher badge support small independent switches, not another preset-only bundle.
- **[Bookmark X](https://github.com/LucasDitchun/export-bookmarks-x-twitter), Verified:** atomic metadata writes, tombstones, serialized operations, and validated backups are the right durability baseline. Avoid packaged semantic runtimes until core recovery is settled.
- **[Siftly](https://github.com/viperrcrypto/Siftly), Verified:** per-post Markdown and Obsidian-friendly output are useful. Its live-pipeline, hardcoded route, Windows path, and API import issues support Aviary's passive capture and browser-download boundary.
- **[Twitter Web Exporter](https://github.com/prinsss/twitter-web-exporter), Verified:** current requests for chunked media ZIPs, Articles, folders, polls, and quote fidelity are a good export gap list. Aviary already covers most of it; borrow only failure-visible chunking and format fidelity.
- **[TwitterMediaHarvest](https://github.com/EltonChou/TwitterMediaHarvest), Verified:** original-quality media, captions, date ranges, and controlled directories carry real demand. Keep Aviary's simpler click-triggered path and bounded caches.
- **[X Enhancement Suite](https://github.com/tomchapin/x-enhancement-suite), Verified:** default-off toggles, full teardown, fixture-backed selectors, and zero-size removal align with Aviary. Preserve that reversibility when suppressing hover UI.
- **[xrai](https://github.com/phuaky/xrai), Verified:** its useful idea is requiring meaningful dwell before declaring a post seen. Reject its 19 GB model and probabilistic feed censorship.
- **[Dewey](https://getdewey.co/), Verified:** search, folders, notes, bulk previews, and portable exports show what bookmark users pay for. Aviary should keep equivalent value local and avoid cloud accounts, public collections, and recurring sync.
- **[Raindrop.io](https://raindrop.io/pro) and [Readwise Reader](https://readwise.io/read/), Verified:** permanent copies, reminders, full-text search, Markdown, and CSV are useful adjacent patterns. Avoid server-first indexing and automatic link crawlers; Raindrop documents crawler false positives for blocked and slow pages.
- **[X Premium and X Pro](https://help.x.com/en/using-x/x-premium), Verified:** X itself sells bookmark folders, reader mode, scheduling, multi-column monitoring, and multi-account operation. Aviary should compete on passive local ownership, not authenticated posting or team operations.
- **[Nitter](https://github.com/zedeus/nitter), Verified:** its 2026-08-26 archive after legal pressure is a boundary warning. Do not depend on proxy instances, session-token reuse, or out-of-browser X reconstruction.

## Reported Issues

**Verified:** GitHub issues are enabled, but the private tracker had zero open issues, zero closed issues, zero open pull requests, and no discussions on 2026-09-05 (`https://github.com/SysAdminDoc/Aviary/issues`). There are no issue numbers to carry into the roadmap.

- **Verified, fixed:** the wide canvas and Aviary-authored hover titles were addressed by `5b06866`. `tests/appearance-width-font.test.mjs` proves the feed fills available desktop width without horizontal overflow, and `tests/injected-ui-contract.test.mjs` proves the Hide button has no `title`.
- **Verified, still incomplete:** the user asked for all hover popups to disappear. The repository removes its own title attributes but has no rule or lifecycle for X's `[data-testid="hoverCardParent"]` or visual tooltip portals (`src/`, `tests/`). This is F317.
- **Verified, still incomplete:** the user still sees vertical reply lines. `9a5970a` removed Aviary's pseudo-element, but `tests/conversation-theme.test.mjs` only checks `getComputedStyle(replyCell, "::before").content`, and `tests/smoke/current-x-status.html` has an avatar image with no native connector subtree. **Likely:** current independent userstyles identify the real X node as a full-height 2 px element, but its generated `r-*` classes are not a stable selector ([current userstyle](https://gist.github.com/busybox11/f339f10da2b5f4a1a26c558663936699)). This is F316.
- **Needs live validation:** the 1.47.1 full-width rule is proved on Home and Status fixtures, not every authenticated route. F302 should include Messages, compose, settings, media overlays, high-density viewports, and 320 CSS pixel reflow before release ([WCAG Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)).

## Security, Privacy, and Reliability

- **Verified:** local extension storage remains best-effort because neither manifest requests `unlimitedStorage`; `refreshEstimate()` reports estimates but does not request or retain persistence (`src/extension/manifest.*.json`, `src/platform/durable-storage.ts`; [Chrome storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)). F295 should report persisted, best-effort, or unknown without false precision.
- **Verified:** F296 must also enforce round-trip compatibility. `createLibraryBackup()` can encode more than 100 MiB, while `parseLibraryBackup()` rejects anything above `MAX_LIBRARY_BACKUP_BYTES` (`src/features/core/library-backup.ts`). A build must never download a backup it cannot restore.
- **Verified:** captured user objects already expose enough information to retain protected status, but `ExportRecord` cannot represent public, protected, or unknown audience (`src/features/export/thread-capture.ts`, `src/features/export/types.ts`). X states that protected posts are intended for approved followers, so share-oriented exports need an explicit protected and unknown review step ([X protected posts](https://help.x.com/en/safety-and-security/public-and-protected-posts)).
- **Verified:** `warc.ts` fabricates an HTTP 200 response around retained media bytes. WARC response records are for the received protocol response; a payload-only capture belongs in a resource record unless actual status and headers were retained (`src/features/export/warc.ts`; [WARC 1.1](https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/), [IIPC guidance](https://iipc.github.io/warc-specifications/guidelines/warc-implementation-guidelines/)). F282 and F303 should hold this fix.
- **Verified:** F298 must expose exact lazy chunks only to X origins, use dynamic URLs where supported, and keep privileged modules private. Page-accessible extension resources are fetchable by the host and can reveal extension presence ([Chrome web-accessible resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)).
- **Verified:** the shelved F300 lock work must assume background suspension between events. Chrome service workers are not persistent, so leases, migrations, and listeners need idempotent state and synchronous listener registration (`src/entrypoints/extension-background.ts`; [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
- **Verified:** CWS rules enforced from 2026-08-01 require prominent disclosure of all handled data, including local-only data. New AMO submissions require `data_collection_permissions`, and the current Firefox ID is a placeholder (`docs/PRIVACY.md`, `src/extension/manifest.firefox.json`; [CWS 2026 policy](https://developer.chrome.com/blog/cws-policy-updates-2026), [Firefox browser-specific settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)). These refine F125, F183, F287, and F298 rather than creating another distribution item.
- **Verified:** X's 2026 automation policy says non-API website scripting may lead to permanent suspension. F309's no-extra-authenticated-request contract remains essential, especially after current competitor lock reports (`src/platform/network.ts`; [X automation policy](https://help.x.com/en/rules-and-policies/x-automation)).
- **Verified:** `npm audit --json` reported zero known vulnerabilities across 129 packages on 2026-09-05. The current esbuild 0.28.2 pin is beyond the cited development-server and binary-integrity advisories; do not downgrade it ([esbuild releases](https://github.com/evanw/esbuild/releases/tag/v0.28.2)).

## Architecture Assessment

- **Verified, DOM boundary:** `syncConversationStructure()` already stamps focal and reply cells without generated classes (`src/features/appearance/theme.ts`). Extend that bounded pass to identify the connector by avatar-gutter structure and measured 2 px geometry, stamp it, hide only the stamp, and remove the stamp on teardown. Historical DOM evidence and relative locators are more resilient than absolute or generated selectors ([EAGL](https://doi.org/10.1145/3818665), [Robula+](https://doi.org/10.1002/smr.1771)).
- **Verified, hover boundary:** native browser titles, X profile cards, visual role-tooltip portals, and click-opened menus are different contracts. F317 must suppress the first three without deleting `aria-label`, visible text, offscreen descriptions, menus, dialogs, or focus feedback (`src/features/layout/declutter.ts`, `src/features/core/presets.ts`; [WCAG hover content](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)).
- **Verified, seen-state correctness:** `scan()` marks every collected article immediately and does not use `IntersectionObserver` or `document.visibilityState` (`src/features/filtering/seen-posts-feature.ts`). Gate the write on meaningful visibility plus dwell and treat direct status navigation as an explicit read.
- **Verified, archive memory:** `ArchiveImportJobs.start()` stores a complete base64 source and `source()` decodes it back to a complete byte array (`src/features/library/archive-import-jobs.ts`). Extension-owned OPFS or chunked IndexedDB can stage bytes, but content-script storage belongs to the host origin, so the extension path must be background-owned and the userscript needs a manager-compatible chunk fallback ([OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)).
- **Verified, export model:** add audience and post-language provenance to `ExportRecord`; use `unknown` for DOM or legacy data that cannot prove either value (`src/features/export/types.ts`, `src/features/export/collector.ts`, `src/features/export/thread-capture.ts`). Do not convert missing evidence into `public` or `en`.
- **Verified, time semantics:** visible HTML, Markdown, and synthetic replay pages currently show `capturedAt` as the post time, despite `createdAt` already existing (`src/features/export/formatters.ts`, `src/features/export/warc.ts`). Show authored time when valid, label capture time separately, and retain capture time for `WARC-Date` ([ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)).
- **Verified, i18n:** HTML exports hardcode English and `tokenizeSearchText()` falls back to whitespace plus CJK bigrams (`src/features/export/formatters.ts`, `src/features/library/query-model.ts`). Capture valid BCP 47 language, render text with `dir="auto"` or `bdi`, and use feature-detected `Intl.Segmenter` for Thai, Lao, Khmer, and Myanmar ([Unicode text segmentation](https://www.unicode.org/reports/tr29/)).
- **Verified, accessibility API:** `src/features/ai/command-menu.ts` uses `aria-description`, which is not in the WAI-ARIA 1.2 Recommendation. A hidden DOM description referenced by `aria-describedby` works with the supported standard and adds no popup ([WAI-ARIA 1.3 draft](https://w3c.github.io/aria/#aria-description)).
- **Verified, performance:** `FeatureRegistry.#runApply()` awaits every active feature in registration order after 120 ms mutation coalescing, and a batch above 400 nodes becomes a full scan (`src/features/registry.ts`, `src/platform/observer.ts`). Add bounded local timing by feature ID before changing scheduling; never store page text or selectors in that diagnostic.
- **Verified, fixtures:** authoritative captures date to 2026-05-19 and are 109 days old on 2026-09-05, with a waiver ending 2026-09-30 (`_decoded/captures.json`). F306 still owns synthetic fixture generation, while F316 needs an immediate realistic connector fixture.
- **Verified, docs:** README says 60 screenshots and 13 destinations, while the tree has 71 PNG baselines and 14 destinations; `design-qa.md` still says Wide is 1120 px; F291 points to nonexistent `docs/DESIGN_QA.md` and `docs/LOGO_PROMPTS.md`; screenshots still display 1.47.0 (`README.md`, `design-qa.md`, `LOGO_PROMPTS.md`, `tests/visual/baselines/`). F291 should name the real paths and recapture all stale UI evidence.
- **Verified, dependencies:** Playwright 1.63.0 adds ARIA snapshots, trace accessibility snapshots, test locks, and forced-colors emulation, directly supporting F300, F302, F312, and F313. TypeScript 7.0.2, typescript-eslint 8.69.0, ESLint 10.10.0, and globals 17.12.0 are the controlled F289 update set ([Playwright 1.63.0](https://github.com/microsoft/playwright/releases/tag/v1.63.0)).

## Rejected Ideas

- **Verified:** reject a full alternate frontend, X Pro clone, posting scheduler, multi-account operator, or auto-refreshing columns. Current OldTweetDeck and Control Panel reports show rate-limit and account-lock risk ([OldTweetDeck #517](https://github.com/dimdenGD/OldTweetDeck/issues/517), [Control Panel #931](https://github.com/insin/control-panel-for-twitter/issues/931)).
- **Verified:** reject X API or OAuth integration, cookie extraction, session-token reuse, background profile crawling, and Nitter redirects. They contradict Aviary's passive local boundary and X's published automation rules ([X automation policy](https://help.x.com/en/rules-and-policies/x-automation), [Nitter](https://github.com/zedeus/nitter)).
- **Assumption:** reject cloud accounts, public collections, CRDT sync, team approvals, shared inboxes, and social CRM until exact local backup and single-profile durability are complete ([Dewey](https://getdewey.co/), [local-first software](https://www.inkandswitch.com/essay/local-first/)).
- **Assumption:** reject opaque AI or vision filtering that decides what disappears. The model cost, uninspectable mistakes, and censorship risk conflict with reversible named rules ([xrai](https://github.com/phuaky/xrai), [HN discussion](https://news.ycombinator.com/item?id=41538273)).
- **Assumption:** reject a generic element picker and automatic selector repair. User-made selectors become silent breakage; suggested changes should remain diagnostic until a fixture proves them ([Digital Habits Focus](https://github.com/ulyngs/digital-habits-focus), [hook-based locator study](https://doi.org/10.1016/j.jss.2023.111932)).
- **Verified:** reject blanket deletion of `aria-label`, descriptions, or focus feedback while removing hover UI. Remove visual hover content, not accessible names ([WAI tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)).
- **Assumption:** reject remote plugins, page-delivered code, and a general plugin marketplace. They enlarge the trust and distribution surface without helping passive local capture (`docs/PRIVACY.md`, `src/features/integrations/network-policy.ts`).
- **Verified:** reject automatic periodic broken-link checking. It creates network traffic and false positives for protected, blocked, local, or slow targets ([Raindrop broken-link caveats](https://help.raindrop.io/broken-links)).
- **Verified:** reject WACZ 1.2 as a target because it remains a draft; F303 correctly targets the 1.1.1 Recommendation ([WACZ 1.1.1](https://specs.webrecorder.net/wacz/1.1.1/), [WACZ 1.2 draft](https://specs.webrecorder.net/wacz/1.2.0/)).
- **Assumption:** reject Memento TimeGate and Web Annotation protocol work until a concrete importer or consumer exists ([RFC 7089](https://www.rfc-editor.org/rfc/rfc7089.html), [Web Annotation](https://www.w3.org/TR/annotation-model/)).
- **Verified:** reject naive content-script OPFS use. It would bind storage to X's origin, not Aviary's extension origin ([Chrome extension storage origins](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)).

## Sources

### Direct OSS and ecosystem

- https://github.com/insin/control-panel-for-twitter
- https://github.com/insin/control-panel-for-twitter/issues/931
- https://github.com/typefully/minimal-twitter
- https://github.com/typefully/minimal-twitter/issues/186
- https://github.com/typefully/minimal-twitter/issues/257
- https://github.com/dimdenGD/OldTwitter
- https://github.com/dimdenGD/OldTweetDeck/issues/517
- https://github.com/dimdenGD/OldTweetDeck/issues/551
- https://github.com/Bl4Cc4t/GoodTwitter2/issues/575
- https://github.com/Bl4Cc4t/GoodTwitter2/issues/602
- https://github.com/yusukesaitoh/calm-twitter
- https://github.com/alterebro/bye-for-you
- https://github.com/LucasDitchun/export-bookmarks-x-twitter
- https://github.com/viperrcrypto/Siftly
- https://github.com/prinsss/twitter-web-exporter
- https://github.com/EltonChou/TwitterMediaHarvest
- https://github.com/tomchapin/x-enhancement-suite
- https://github.com/phuaky/xrai
- https://github.com/zedeus/nitter
- https://github.com/webrecorder/browsertrix-behaviors
- https://github.com/hridaydutta123/awesome-twitter-tools
- https://github.com/topics/twitter-tools

### Commercial and adjacent products

- https://getdewey.co/
- https://getdewey.co/how-to-use/export-bookmarks/
- https://help.x.com/en/using-x/x-premium
- https://help.x.com/en/using-x/how-to-use-x-pro
- https://raindrop.io/pro
- https://help.raindrop.io/premium-features
- https://help.raindrop.io/broken-links
- https://readwise.io/read/
- https://docs.readwise.io/reader/docs/faqs/searching
- https://docs.readwise.io/readwise/docs/exporting-highlights/markdown-csv
- https://blog.mozilla.org/en/mozilla/building-whats-next/?pubDate=20250522
- https://www.zotero.org/support/zotero_data?s=export
- https://www.inkandswitch.com/essay/local-first/

### X, browser, distribution, and accessibility

- https://help.x.com/en/rules-and-policies/x-automation
- https://help.x.com/en/safety-and-security/public-and-protected-posts
- https://help.x.com/en/managing-your-account/accessing-your-x-data
- https://docs.x.com/x-api/fundamentals/data-dictionary
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources
- https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
- https://developer.chrome.com/blog/cws-policy-updates-2026
- https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
- https://www.w3.org/TR/wai-aria-1.2/
- https://w3c.github.io/aria/#aria-description

### Archives, language, and engineering research

- https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/
- https://iipc.github.io/warc-specifications/guidelines/warc-implementation-guidelines/
- https://specs.webrecorder.net/wacz/1.1.1/
- https://specs.webrecorder.net/wacz/1.2.0/
- https://specs.webrecorder.net/cdxj/0.1.0/
- https://www.w3.org/TR/activitystreams-core/
- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- https://tc39.es/ecma402/#sec-intl-segmenter-constructor
- https://www.unicode.org/reports/tr29/
- https://www.w3.org/International/questions/qa-html-language-declarations.html
- https://www.w3.org/International/articles/inline-bidi-markup/
- https://w3c.github.io/long-animation-frames/
- https://doi.org/10.1145/3818665
- https://doi.org/10.1002/smr.1771
- https://doi.org/10.1016/j.jss.2023.111932
- https://arxiv.org/abs/1709.09186
- https://arxiv.org/abs/2108.12092

### Dependencies, security, and community signal

- https://github.com/microsoft/playwright/releases/tag/v1.63.0
- https://github.com/microsoft/TypeScript/releases/tag/v7.0.2
- https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.69.0
- https://github.com/eslint/eslint/releases/tag/v10.10.0
- https://github.com/sindresorhus/globals/releases/tag/v17.12.0
- https://github.com/evanw/esbuild/releases/tag/v0.28.2
- https://github.com/evanw/esbuild/security/advisories/GHSA-gv7w-rqvm-qjhr
- https://nodejs.org/en/blog/vulnerability/july-2026-security-releases
- https://www.reddit.com/r/uBlockOrigin/comments/1hzxmcr/block_twitterx_profile_name_hover_over/
- https://www.reddit.com/r/DataHoarder/comments/1gq6dk4/currently_operational_tools_for_social_media/
- https://www.reddit.com/r/Twitter/comments/1u5g6z7/trouble_downloading_x_archive/
- https://www.reddit.com/r/Twitter/comments/1tvynrb/i_saved_2000_twitterx_bookmarks_and_never/
- https://news.ycombinator.com/item?id=47697679
- https://news.ycombinator.com/item?id=41538273
- https://lobste.rs/s/lugowa/do_you_back_up_internet_on_your_own_what_how

## Open Questions

None.
