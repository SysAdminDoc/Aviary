# Research: Aviary

Date: 2026-09-04. Replaces all prior research.

Version reviewed: `1.47.0` plus the uncommitted cross-origin storage-lock work on `main` at `b9b6ec9`.

Confidence labels used below:

- **Verified** means the claim was confirmed in this repository or a primary source.
- **Likely** means independent evidence agrees, but the claim was not reproduced locally.
- **Assumption** means a product choice is proposed from the evidence.
- **Needs live validation** means an authenticated current X session or an external distribution environment is required.

## Executive Summary

**Verified:** Aviary is a mature local-first X enhancer with a 50,637-line TypeScript source, 150 test files, and a delivery pipeline that already enforces size, metablock, permission, and documentation contracts. The 2026-08-23 research correctly identified the storage-authority problem and it is now largely fixed: F273 through F275 shipped, and an in-flight change on `main` replaces per-origin Web Locks with a shared bakery register so `x.com`, `twitter.com`, and `pro.x.com` coordinate as one storage scope. The 2026-08-22 visual system stands and needs no rework.

The new findings this pass are all about whether the local library survives, and whether the project can still ship. Aviary asks users to keep an archive in the browser but declares neither `unlimitedStorage` nor `navigator.storage.persist()`, so both Chrome and Firefox may evict the whole database under disk pressure. Its "full library backup" reads a profile-scoped gateway, so it captures one profile, omits the profile roster entirely, and omits the WACZ signing identity. The Firefox floor of 128 targets a browser that reached end of life on 2025-09-16. The content bundle sits at 96.7 percent of its own size budget with no code splitting, so most queued features cannot land without failing preflight first. And the fixture waiver expires on 2026-09-30, after which `npm run preflight` fails and takes `npm run verify` with it.

Priority order:

1. **Verified:** make local storage non-evictable and say so, or stop describing the library as durable.
2. **Verified:** make a library backup restore the whole install, including every profile and the signing identity.
3. **Verified:** raise the Firefox floor off an end-of-life browser, which also retires eight platform detection branches.
4. **Verified:** split delivery so the Control Center, export, and library code leave the document-start path and the size budget stops gating the roadmap.
5. **Verified:** tell the user on the page when selector health degrades, instead of only in a diagnostics panel nobody opens during a break.
6. **Verified:** land the in-flight lock work with its test tracked, and cover `trusted-types.ts` and `media-context-menu.ts`.
7. **Verified:** target WACZ 1.1.1, which is the published Recommendation, rather than the abandoned 1.2.0 draft that F282 currently names.
8. **Verified:** put the visual and smoke lanes inside the release gate, and generate fixtures so selector proof stops depending on one authenticated capture.
9. **Verified:** state the account-safety and legal boundary as a tested claim rather than as prose, now that X has shut a comparable project down with lawyers.
10. **Verified:** close the accessibility gaps nothing currently measures, which are the six themes under forced colors and the three WCAG 2.2 criteria axe cannot check.

The ecosystem moved in Aviary's favour while this was true. X shut Nitter down with a cease-and-desist on 2026-08-24 and is migrating its frontend off webpack, which has broken the transaction-id pipeline every out-of-browser scraper depends on. A script running inside the user's own session needs none of that machinery, so the architecture Aviary already has is the one the field is being forced toward. What it should not do is inherit the field's habits: the boundary that makes Aviary safe is not written down as a test, and that is the cheapest item on this list.

## Product Map

- **Verified, core workflows:** read X with less noise, save post media at the best observed quality, filter and hide posts reversibly, keep a local searchable library, and export portable archives.
- **Verified, personas:** privacy-conscious readers, media collectors, archivists, and people who want a quieter high-density X.
- **Verified, platforms:** one userscript for Tampermonkey and Violentmonkey, plus MV3 packages for Chrome 116 and Firefox 128. Distribution is sideload only; the Firefox `gecko.id` is still the placeholder `aviary@example.local` (`src/extension/manifest.firefox.json`).
- **Verified, data flow:** `src/main.ts` boots a 34-module feature registry against a profile-scoped storage gateway over an extension-owned IndexedDB, observes X's own responses through a `world: "MAIN"` page agent, and hands explicit downloads to the background worker. Aviary originates no request to `x.com`. The only X-adjacent fetches are in `src/features/media/downloader.ts:84,337` against `pbs.twimg.com` and `video.twimg.com`, both optional host permissions.
- **Verified, philosophy:** no cookie or token extraction, no originated authenticated X requests, no remote code, narrow permissions, reversible UI changes, local-first records, and claims that the test suite can measure.

## Competitive Landscape

The 2026-08-23 landscape survey remains accurate and is not repeated here. What changed since, and what it means:

- **[Control Panel for Twitter](https://github.com/insin/control-panel-for-twitter), Verified:** v4.24.0 shipped 2026-08-17 and "Added options to revert media carousel and profile tab changes using X's own feature flags." That is the exact mechanism `Roadmap_Blocked.md` holds as F115 and F139, and it upgrades the evidence from a community scriptlet to a maintained extension with a four-year record. It does not remove the capture requirement, because Aviary still has to see the flag applied before X's first read. The same release removed the twitter.com redirect option, because logging in through twitter.com now sets an `x.com` cookie, which independently confirms the reasoning already recorded for F149.
- **[Webrecorder specs](https://github.com/webrecorder/specs), Verified:** WACZ **1.1.1** (2021-06-03) is the published Recommendation. WACZ **1.2.0** carries the disclaimer "This document is a draft of a potential specification. It has no official standing of any kind," has had no movement since 2022, and webrecorder/specs#124 proposes removing it. Aviary's F282 currently names 1.2.0 as its target. It should name 1.1.1, keep `wacz_version`, keep `mainPageUrl` and `mainPageDate`, and keep `profile: "data-package"`.
- **[wacz-auth 0.1.0](https://specs.webrecorder.net/wacz-auth/0.1.0/), Verified:** a signing format already exists, covering anonymous ECDSA signatures and domain-ownership signatures, with `authsign` and `py-wacz --verify-auth` as reference verifiers. `src/features/export/wacz-signing.ts` invents `ECDSA-P384-SHA256` with an Aviary-specific `WaczSignatureData` shape, so no third-party tool can verify an Aviary-signed package. The spec itself is a draft and its verifier is alpha, so conforming is a judgement call, but claiming a signature without naming who can check it is not.
- **[py-wacz](https://github.com/webrecorder/py-wacz), Verified:** 0.5.0 released 2024-04-11, while ReplayWeb.page (2.5.3), wabac.js (2.27.3), warcio.js (2.4.12), and ArchiveWeb.page (0.17.1) all shipped on or about 2026-09-04. A validator gate built only on py-wacz is checking a two-year-old implementation. [jwarc 0.37.0](https://github.com/iipc/jwarc/releases) (2026-09-01) is the maintained independent cross-check for WARC 1.1.
- **[WARC](https://github.com/iipc/warc-specifications), Verified:** WARC 1.1 / ISO 28500:2017 is still current. No 1.2 exists in any form. Nothing to chase.
- **[prinsss/twitter-web-exporter](https://github.com/prinsss/twitter-web-exporter), Verified:** 2,687 stars, releasing near-weekly (v1.4.3 on 2026-08-31), and the same architecture as Aviary: a userscript that hooks the page's own fetch and XHR to read X's GraphQL responses. This is the competitor to watch. Its open issues are a ranked feature-demand list for Aviary: a ZIP export that survives past 500 media items (#137), quote-tweet payloads, Spaces recordings and polls (#133), Articles capture (#143), Premium bookmark folders (#142), and a run history (#139). Issue #41 is the cautionary one, where naive interception stopped X loading any timeline at all.
- **[gallery-dl](https://codeberg.org/mikf/gallery-dl), Verified:** development moved from GitHub to Codeberg on 2026-04-05 after a DMCA notice, and the GitHub tracker's 1,152 open issues are now stale. The prior research cited the GitHub URL. The live tracker also quantifies a limit worth repeating honestly: Codeberg #121 is a controlled experiment showing no single configuration retrieves a complete account, and #117 plus afkarxyz#106 independently show X's media timeline capping around 900 to 1,000 items regardless of pagination.
- **[timhutton/twitter-archive-parser](https://github.com/timhutton/twitter-archive-parser), Verified:** 2,437 stars, last commit 2022-11-29, 39 open issues, no releases ever. Its README is still the clearest public statement of why the official export is not enough, including that X ships images smaller than the ones you uploaded. Its open issues are all feature gaps rather than format breaks: local search, thread reconstruction, alt text, ongoing archives. Aviary already has most of them, which is the clearest evidence the lane is open rather than crowded.

## The X ecosystem in 2026

Three dated events changed the ground under this project since the last research pass.

- **Verified, 2026-08-24: X Corp sent cease-and-desist letters to Nitter and its instance operators**, citing the Texas Harmful Access by Computer Act and the Lanham Act over alleged API circumvention and access to session tokens. The repository was archived on 2026-08-26 after commits as recent as 2026-08-24, so this was a working project stopped by legal force rather than one that decayed. nitter.net and xcancel.com are both down. This is a positioning fact, not trivia: a tool that replaces X's frontend for logged-out visitors is now in a different legal category from one that enhances a session the user is already signed into. Aviary is firmly in the second category and every mechanism that keeps it there is already built. What is missing is saying so in one place and holding it with a test rather than with prose.
- **Verified, 2026: X is migrating its frontend off webpack, and the `ondemand.s` chunk map is gone.** A live fetch of `https://x.com/` on 2026-09-04 with three different user agents returns `twitter-site-verification` and `loading-x-anim` but no `"ondemand.s"`. Every out-of-browser tool that mints an `x-client-transaction-id` parses that chunk map, so gallery-dl is currently broken on it with an open issue (Codeberg #419, 2026-09-03) that its 2026-09-04 release does not fix. New headers are appearing in the same migration: `x-tfe-transaction-id`, `x-tfe-session-hash`, `x-tfe-user-assertion-signature`. **This is Aviary's structural advantage stated precisely.** An in-page script never mints a transaction ID, never needs a guest token, and never parses a bundle, because the page does all three for it. Aviary should never hardcode a query id, and `src/features/export/query-discovery.ts` already scans only script tags rather than fetching a bundle, so nothing here breaks it. One concrete defensive detail is worth adopting: a rotated query id returns **HTTP 404 with an empty body**, not a GraphQL error, so any handler that treats an empty 404 as a transport failure will misreport churn as a network problem.
- **Verified, 2026-09-04, live: X's media CDNs remain open without authentication, and `?name=orig` still returns full resolution.** A direct fetch of a `pbs.twimg.com` asset returns identical bytes for `orig`, `4096x4096`, and `large`, and a smaller body for `small`, which proves the parameter is honoured rather than ignored. `video.twimg.com` serves progressive MP4 unauthenticated with and without `?tag=27`. The login wall is on the API layer only, which inverts the usual assumption: discovering media URLs is the hard part and Aviary gets that for free by observing the page. The "orig is dead" folklore has no dated, falsifiable source behind it.

Two smaller findings from the same sweep bear on shipped behaviour:

- **Verified:** yt-dlp deliberately sorts HLS ahead of higher-bitrate progressive HTTP for X, because the progressive variant's codec is not known in advance and some of them produce files common players refuse to open (yt-dlp#8117). Aviary picks the highest-bitrate complete progressive MP4, so it inherits that risk and cannot currently say what codec it saved.
- **Verified:** X's own export has changed shape by accretion, and third-party tools break across vintages rather than on the current format. Archives from roughly 2020 and earlier carry `data/tweet.js` rather than `tweets.js` and lack the four direct-message files; pre-2018 exports use the Grailbird layout entirely. Three separate tools have this bug open or recently closed. The current schema is stable; cross-vintage handling is the gap, and it is cheap.

## Reported Issues

**Verified:** `SysAdminDoc/Aviary` is private, has issues enabled, and holds zero open issues, zero closed issues, zero pull requests, and discussions disabled as of 2026-09-04 (`gh repo view`, `gh issue list`). There is no external tracker backlog. `.github/ISSUE_TEMPLATE/bug_report.yml` exists and opens by telling reporters that X changes its markup, which is the right framing but has never been exercised.

The substitute intake is the repository's own history. `git log -300` is 111 `fix:` commits against 68 `feat:`, and the fix subjects name six recurring classes: cross-tab and cross-origin storage races, UI copy that outran the shipped behaviour, feature teardown leaks, regex and CSS sanitizer bypasses (five separate bypass fixes across two analyzers), selector churn against live X, and download terminal-state honesty. Every one of those already has a roadmap item or a shipped gate. The absence of user reports is not evidence of health here; it is evidence that the product has no users yet, which is what F125 and F183 are about.

## Security, Privacy, and Reliability

- **Verified, P0, new:** the local library is evictable. Neither manifest declares `unlimitedStorage`, and `navigator.storage.persist()` is never called anywhere in `src/` (`grep -rn "storage.persist" src/` returns nothing). Chrome's own extension storage documentation states that `unlimitedStorage` "exempts extensions from both quota restrictions and eviction" and that otherwise "storage can also be evicted under heavy memory pressure." `chrome.storage.local.QUOTA_BYTES` is 10,485,760 bytes and over-quota writes "fail immediately." MDN records the same limits for Firefox against the IndexedDB quota. Every durable key in `src/platform/durable-storage.ts:19-46`, which is captured posts, notes, bookmarks, snapshots, media history, the semantic index, and the WACZ signing key, sits in that best-effort bucket. `refreshEstimate()` reads `navigator.storage.estimate()` and reports usage, so the product measures the cliff without doing anything about it.
- **Verified, P0, new:** a library backup does not restore an install. `src/main.ts:200` builds `storage` as `createProfileStorageGateway(durableStorage, profileManager.activeId)`, that gateway is the `FeatureContext.storage` handed to every feature (`src/main.ts:313`), and `src/features/core/control-center.ts:422` calls `createLibraryBackup(ctx.storage, ...)`. `createProfileStorageGateway` rewrites every key to `aviary.profile.<id>.<suffix>` (`src/platform/profile.ts:216-219`). So the backup contains the active profile only. `LIBRARY_BACKUP_COLLECTIONS` (`src/features/core/library-backup.ts:52-77`) additionally omits six durable keys: `aviary.profiles.v1` and `aviary.profile.active.v1`, which are read unscoped through `#base` (`src/platform/profile.ts:88,168`), plus `aviary.waczSigning.v1`, `aviary.firstRun.v1`, `aviary.diagnostics.v1`, and `aviary.adObservations.v1`. Restoring on a fresh browser therefore loses every non-active profile, the profile roster, and the signing identity that previously exported WACZ packages were signed with.
- **Verified, P1, new:** Firefox 128 reached end of life on **2025-09-16** ([endoflife.date/firefox](https://endoflife.date/firefox)). The supported ESR lines on 2026-09-04 are 153 (released 2026-07-21) and 140, whose security support ends 2026-09-29. `src/extension/browser-floors.ts` states that "128 is also an ESR line, and that is the deciding half of the choice." That premise is now false, and the floor currently supports only an unpatched browser. Raising it is also the cheapest capability win available: at 153 every entry in `PLATFORM_FEATURE_FLOORS` becomes `underFloor: true`, retiring the detection branches for `content-visibility` (130), `RegExp.escape` (134), `URLPattern` (142), `@scope` (146), and the Navigation API (147).
- **Verified, P1, new:** a selector break is invisible on the page. `src/features/core/selector-health.ts:74-99` reacts only when a surface in `CRITICAL_SURFACES`, which is `{"App root", "Primary column"}`, goes missing, and its only reaction is `ctx.diagnostics.warn`. The snapshot reaches the UI in exactly one place, `src/ui/control-center/sections/advanced.ts:41`. Twenty-four surfaces are tracked with twelve marked `churnRisk: "High"` in `src/platform/selectors.ts`, and each names the feature it owns, so the data to tell a user "Download is off because X renamed the post action bar" already exists and is thrown away. With no working update channel (F183) a user on a broken build has no way to learn anything is wrong.
- **Verified, P2:** the WACZ signing private key is generated extractable (`crypto.subtle.generateKey(ECDSA_KEY_PARAMS, true, ...)`, `src/features/export/wacz-signing.ts:147-151`) and stored as base64 PKCS#8. That is a defensible choice because `exportKeypair()` makes the identity portable, and F273 moved it behind the extension origin so page code cannot reach it. It is not defensible together with the two findings above: an evicted database or a restored backup destroys the identity silently.
- **Verified, P2, new:** the OpenAI path sends `max_tokens` (`src/features/integrations/ai-provider.ts:114-120`). OpenAI deprecated that parameter for o-series and later reasoning models, which reject it with an `unsupported_parameter` error. Aviary surfaces the result as `Provider HTTP 400` with no explanation, so a correctly configured user sees an unexplained failure.
- **Verified, P2:** `redactDiagnostic` is exported from `src/platform/diagnostics-store.ts` and called by nothing in `src/`, `tests/`, or `tools/`. F281 already records that the store retains raw `message`, `error`, and `reason` values against the promise in `docs/PRIVACY.md:66`. An uncalled redaction helper is the mechanism of that finding, and F281 should reuse it rather than introduce a second one.
- **Verified, P2, new:** the six authored themes have never been checked under forced colors. `tests/forced-colors.test.mjs` drives the Control Center only, and its own docstring records that the panel did not survive forced colors before that test existed. `src/features/appearance/theme.ts` carries 18 `box-shadow`, `text-shadow`, `background-image`, and `linear-gradient` declarations and zero `forced-colors` blocks, while the user agent forces the first three to `none`. Any theme state carried only by a shadow or a gradient disappears silently in Windows High Contrast.
- **Verified, P2, new:** the accessibility suite cannot see three WCAG 2.2 AA criteria that this UI is shaped to fail. 2.4.11 Focus Not Obscured is exactly the sticky-Save-over-a-scrolling-page pattern the Control Center uses, 2.5.8 Target Size is where dense toggle rows fail, and 2.5.7 Dragging Movements applies to any reorderable list. Axe covers none of the first two reliably and none of the third.
- **Verified, P3:** the outbound network policy fails open. `src/features/integrations/network-policy.ts:28` initialises `localOnly` to `() => false` and `src/main.ts:236` installs the real predicate. Nothing currently calls an integration before that line, and the only bundle carrying `assertOutboundAllowed` is `content.js`, so this is hardening rather than a live defect. Default-deny costs one line.
- **Verified:** `npm audit` was clean on 2026-08-23 and the dependency set has not changed since. No new advisory affecting esbuild 0.28.2, ESLint 10.8.1, Playwright 1.62.1, or the pinned TypeScript packages was found for this pass.

## Architecture Assessment

- **Verified:** delivery is one chunk and the budget is nearly spent. `dist/extension-chrome/content.js` is 2,320,580 bytes against the 2,400,000 budget in `tools/preflight.mjs:40-43`, and `dist/aviary.user.js` is 2,321,512. That is 3.3 percent headroom. `grep -rn "await import(" src` returns nothing, so there is no code splitting at all: the Control Center (131,805 bytes of source in `src/ui/control-center.ts` alone), the export and WACZ machinery, the archive viewer, and the 608,650-byte i18n catalog all load at `document_start` on every X page. `tools/build.mjs:131,154` sets `minify: false` for both content targets, which is the right call for the userscript because readability is its product promise, and an unexamined inheritance for the extension, where nobody reads `content.js`. The documented next lever, compressing the catalog, was already rejected because it would force a decompress before the first translated render. Splitting is the lever that has not been tried, and the extension can do it through `web_accessible_resources` where the userscript cannot.
- **Verified:** the Control Center is the churn hotspot. `src/ui/control-center.ts` (88 touches in 300 commits), `src/features/core/control-center.ts` (53), and the four `sections/*` files together account for 218 of 300 commits, and `51df4f6` already split it once. `docs/PRIVACY.md` (51), `docs/INSTALL.md` (44), and `docs/FAQ.md` (34) churn alongside because panel copy is duplicated into prose, which is what F291 exists to fix.
- **Verified:** the release gate is narrower than it looks. `npm run verify` is typecheck, lint, `node --test tests/*.test.mjs`, build, preflight. The visual lane and all four smoke lanes are separate scripts, so the highest-churn baseline files in the repository are not checked by the command the project treats as its gate. `npm run build` alone will also emit an over-budget or metablock-mismatched artifact, because preflight runs after it rather than inside it.
- **Verified:** two security-adjacent modules have no test at all. `src/platform/trusted-types.ts` is the sole file exempted from preflight's repository-wide `innerHTML` ban, and it degrades to a string passthrough when `trustedTypes` is absent. `src/extension/media-context-menu.ts` carries `isMediaContextDownloadMessage`, the message-shape validator on a cross-context download trigger, and `contextMenus` is a declared permission in both manifests. Twelve other untested files exist but are types, three-line entrypoints, or covered indirectly.
- **Verified:** `tests/storage-authority-browser.test.mjs` is untracked and not ignored. It is 23,797 bytes and the only coverage for the new shared-register lock. Because `npm test` globs `tests/*.test.mjs`, it runs locally and would not exist for anyone who cloned. `crossTabLocksAvailable` in `src/platform/storage-lock.ts:77` was modified by the same in-flight change and is called by nothing.
- **Verified:** selector proof has a single point of failure with a date on it. `_decoded/captures.json` sets `ceilingDays: 90` and `acknowledgedStaleUntil: "2026-09-30"`; both captures are dated 2026-05-19, which is 108 days old on 2026-09-04. After 2026-09-30 preflight fails and `verify` fails with it, blocking releases that have nothing to do with selectors. The same files are also why F184 exists, because they contain a named account's handle and body text and are in git history. A generator that produces structurally faithful synthetic captures from a recorded shape schema would decouple the gate from an operator session and let the real capture be removed rather than merely re-taken.
- **Verified:** eight exported symbols are dead repository-wide (`extractVideos`, `collectProfileAbout`, `buildEmbeddingDisclosure`, `extensionFor`, `defaultSnapshotForPreset`, `videoPlaybackBound`, `AVIARY_FAVICON_URL`, `TITLE_BADGE_PATTERN`), alongside `crossTabLocksAvailable`. The repository deliberately exports for testability, so "exported" does not mean "used", and only a gate can keep the two apart.
- **Verified, correction to an existing item:** F291's Evidence line names `docs/DESIGN_QA.md` and `docs/LOGO_PROMPTS.md`. Neither path exists. The real files are `design-qa.md` and `LOGO_PROMPTS.md` at the repository root. F291's other claims hold: `docs/FAQ.md:247` still says "87 controls across 12 pages" against 14 destinations, and `docs/PRIVACY.md:40` still lists only `storage` and `declarativeNetRequestWithHostAccess` while both manifests also declare `contextMenus`.
- **Verified, correction to an existing item:** F286's premise is confirmed. `src/ui/control-center.ts:1231-1348` defines 14 section ids and `tests/a11y-axe.test.mjs:32-46` hard-codes 13, omitting `catchup`, while its own comment claims completeness. `design-qa.md` carries the same stale 13.

## Rejected Ideas

- **Verified, rejected:** adopting `chrome.userScripts`. The API exists for extensions that host third-party user scripts and configure `USER_SCRIPT` worlds for them. Aviary ships its own code in its own world and would gain nothing but a permission warning. Source: https://developer.chrome.com/docs/extensions/reference/api/userScripts
- **Verified, rejected:** targeting the WACZ 1.2.0 draft's shape changes (`profile: "wacz"`, dropping `wacz_version`, dropping `mainPageUrl`). The draft has no standing, has not moved since 2022, and webrecorder/specs#124 proposes deleting it.
- **Verified, rejected:** compressing the i18n catalog to buy budget headroom. Already evaluated in `tools/preflight.mjs`; it would force a decompress before the first translated render and cost the laziness that keeps the catalog off the document-start path. Splitting is the alternative that has not been tried.
- **Verified, rejected:** rewriting the regex or CSS analyzers. Five bypass fixes across two analyzers justify adversarial testing, which F285 already proposes. No current bypass was found, and a rewrite would discard five fixes worth of learned edge cases.
- **Verified, rejected:** replacing the fixture discipline with live scraping in tests. Aviary originates no request to `x.com`, and a test lane that did would be the one thing the privacy model forbids. The synthetic generator proposed below keeps the discipline and removes the operator dependency.
- **Assumption, rejected, carried forward:** cookie or token extraction, a hosted redirect downloader, browser-side ffmpeg for adaptive video, broad multi-site permissions, whole-account crawling, a remote plugin marketplace, cloud accounts, and another UI redesign. The 2026-08-23 reasoning for each still holds and nothing this pass changed it.
- **Verified, rejected:** vendoring ReplayWeb.page's `ui.js` and `sw.js` into the extension to get byte-accurate replay. The service worker registers at a scope where the server must answer 404, which is workable in the standalone viewer and awkward inside `chrome-extension://`, and it contradicts the zero-runtime-dependency rule that is the reason `npm ci --ignore-scripts` is safe here. Revisit only for the standalone viewer, and only after F303 proves the packages are conformant. Source: https://replayweb.page/docs/embedding/
- **Verified, rejected:** an in-browser generative model (WebLLM) for search or summarisation. It is WebGPU-only with no fallback and needs one to eight gigabytes of model weight to produce a text vector that a 25 MB embedding model produces better and faster. Source: https://github.com/mlc-ai/web-llm
- **Verified, rejected:** building SQLite WASM into the delivery just to get FTS5. FTS5 is not in the official WASM build and enabling it means maintaining a custom Emscripten build, against a bundle that already has 3.3 percent headroom, for a job the existing local BM25 ranking already does in pure TypeScript.
- **Verified, rejected:** `sqlite-vec` as a load-bearing dependency. It is pre-1.0 and its own npm package is labelled a demo with independent versioning that may change, while a brute-force dot product over 50,000 vectors at 384 dimensions completes in low tens of milliseconds.
- **Assumption, rejected:** restructuring the feature registry onto `init(signal: AbortSignal)` and declarative `include`/`exclude` route gating on the Refined GitHub model. Aviary already has per-feature `destroy`, `suspend`, `resume`, a shared batching observer in `src/platform/observer.ts`, and route relevance in `selectorRelevance`. The remaining delta is a refactor with no defect behind it. Source: https://github.com/refined-github/refined-github/issues/3084
- **Verified, rejected:** a subscribable community selector or filter list on the uBlock Origin model. It is the obvious answer to selector churn and the wrong one here: a private repository has no distribution point (F183), remote rule data is still a remote input that would need its own signing and abuse story, and the project has no user base to maintain a list. Revisit only after F125.

## Sources

### Platform and standards

- https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/reference/api/userScripts
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://endoflife.date/firefox
- https://support.mozilla.org/en-US/kb/firefox-esr-release-cycle

### Web archiving specifications and tooling

- https://specs.webrecorder.net/wacz/1.1.1/
- https://specs.webrecorder.net/wacz/1.2.0/
- https://specs.webrecorder.net/wacz-auth/0.1.0/
- https://specs.webrecorder.net/cdxj/0.1.0/
- https://github.com/webrecorder/specs/issues/124
- https://github.com/webrecorder/py-wacz/releases
- https://github.com/webrecorder/replayweb.page/releases
- https://github.com/webrecorder/archiveweb.page/releases
- https://github.com/iipc/warc-specifications
- https://github.com/iipc/jwarc/releases

### Competitors and ecosystem

- https://github.com/insin/control-panel-for-twitter/releases/tag/v4.24.0
- https://github.com/insin/control-panel-for-twitter/issues/931
- https://github.com/prinsss/twitter-web-exporter
- https://github.com/prinsss/twitter-web-exporter/issues/137
- https://github.com/prinsss/twitter-web-exporter/issues/133
- https://github.com/prinsss/twitter-web-exporter/issues/41
- https://codeberg.org/mikf/gallery-dl
- https://codeberg.org/mikf/gallery-dl/issues/419
- https://codeberg.org/mikf/gallery-dl/issues/316
- https://codeberg.org/mikf/gallery-dl/issues/121
- https://codeberg.org/mikf/gallery-dl/issues/117
- https://github.com/mikf/gallery-dl/issues/9374
- https://github.com/yt-dlp/yt-dlp/issues/8117
- https://github.com/yt-dlp/yt-dlp/pull/15432
- https://github.com/EltonChou/TwitterMediaHarvest/issues/358
- https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader/issues/106
- https://github.com/timhutton/twitter-archive-parser
- https://github.com/JonathanSeriesX/twixodus/issues/1
- https://github.com/marcomaroni-github/twitter-to-bluesky/issues/93
- https://github.com/tweetback/tweetback/issues/95
- https://github.com/lhl/tweetxvault/blob/main/docs/GRAILBIRD.md
- https://github.com/dogsheep/twitter-to-sqlite/issues/63
- https://github.com/mahrtayyab/tweety/issues/298
- https://github.com/vladkens/twscrape/issues/306
- https://github.com/fa0311/TwitterInternalAPIDocument

### The Nitter shutdown

- https://github.com/zedeus/nitter
- https://techcrunch.com/2026/08/25/x-sends-cease-and-desist-to-open-source-project-nitter-over-alleged-scraping/
- https://www.theregister.com/legal/2026/08/26/nitter-no-more-x-sends-in-the-lawyers-to-shut-down-open-source-project/5292548

### Adjacent local-first archiving

- https://github.com/webrecorder/browsertrix-behaviors
- https://raw.githubusercontent.com/webrecorder/browsertrix-behaviors/main/src/site/twitter.ts
- https://github.com/gildas-lormeau/single-file-cli/releases
- https://github.com/ArchiveBox/ArchiveBox/issues/704
- https://github.com/karakeep-app/karakeep/issues/1568
- https://github.com/linkwarden/linkwarden/issues/742
- https://readeck.org/en/blog/202512-2026-roadmap/
- https://replayweb.page/docs/embedding/
- https://github.com/refined-github/refined-github/issues/3084
- https://github.com/gorhill/uBlock/wiki/Static-filter-syntax
- https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ)
- https://developer.chrome.com/docs/extensions/develop/migrate/improve-security
- https://sponsor.ajay.app/about/
- https://github.com/mlc-ai/web-llm
- https://github.com/MinishLab/model2vec
- https://github.com/asg017/sqlite-vec
- https://docs.joinmastodon.org/user/moving/
- https://atproto.com/blog/repo-export
- https://dtinit.org/blog/2026/08/18/ietf-work-data-portability
- https://stashr.me/blog/download-twitter-archive

### Accessibility

- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/TR/wcag-3.0/
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency

### Provider APIs

- https://developers.openai.com/api/reference/python/resources/chat/subresources/completions/methods/create
- https://community.openai.com/t/inconsistent-handling-of-max-tokens-parameter-in-chat-completions-api/962030
- https://github.com/simonw/llm/issues/724

## Open Questions

- **Needs live validation:** whether adding `unlimitedStorage` changes the install prompt text in Chrome and Firefox for a sideloaded package. The permission is the correct fix either way, but the copy in `docs/INSTALL.md` and the permissions page depends on the answer.
- **Needs live validation:** which current X routes expose direct MP4 variants versus adaptive manifests only, and whether the 2026-08-11 carousel and 2026-08-13 profile changes altered the response shapes the page agent reads. Unchanged from 2026-08-23 and still gated on the capture in `Roadmap_Blocked.md`.
- **Needs live validation:** practical per-value capacity and transaction behaviour of Tampermonkey and Violentmonkey storage. Violentmonkey's MV3 build is still described by its own maintainers as unstable, so the userscript storage ceiling should be measured against both managers before the 16 MiB safety limit in `src/platform/storage.ts:32` is treated as the real one.
- **Assumption to settle before F303:** whether Aviary should conform to the wacz-auth 0.1.0 draft, whose verifier is alpha, or keep its own scheme and stop describing the output as a signature a third party can check. Both are defensible; shipping neither is not.
- **Needs live validation before F298:** whether a dynamic `import()` of a web-accessible resource works from an isolated-world content script on both floors, and what build format that forces. esbuild's `iife` output cannot code-split, so the extension content target would have to move to `esm` with the entry loaded as a module, which is a real constraint on the shape of the fix rather than a detail. Measure it before committing to the split boundary.
- **Assumption to settle before F308:** the license on `browsertrix-behaviors` and what attribution a lifted selector would require. The item is written as a cross-check that copies nothing without a fixture, so the question only becomes blocking if a selector turns out to be worth taking verbatim.
