# Aviary ROADMAP

Version: `1.47.2`

Date: 2026-09-06

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

- [ ] F276, P1: Replace the remaining stale full-snapshot writes with merge-on-write deltas
  Why: serializing a stale snapshot does not preserve changes made by another tab. Settings, profiles, media queue, export jobs, and diagnostics retain this loss mode.
  Evidence: `src/main.ts:286`, `src/platform/profile.ts:210`, `src/features/media/queue.ts:280`, `src/features/export/jobs.ts:280`, `src/platform/diagnostics-store.ts:154`, `src/platform/storage-lock.ts:3-16`
  Touches: the five stores above, `src/platform/storage-lock.ts`, cross-tab storage tests
  Acceptance: each store persists additions, updates, removals, and explicit clears against the value read inside its transaction; deterministic two-context tests interleave both writers and retain both non-conflicting changes; a clear remains authoritative and stale state cannot resurrect an entry.
  Complexity: L
  Depends: F273 and F275.

- [ ] F277, P1: Retain terminal download results and reconcile browser IDs before resume
  Why: a fast completion is consumed before the button starts waiting, leaving it disabled for 300 seconds; after reload, Resume can also duplicate a retained browser transfer.
  Evidence: `src/features/media/media-buttons.ts:1185`, `src/features/media/download-watch.ts:82-98`, `src/features/media/queue.ts:69-90`, `src/features/media/batch-downloader.ts:549-633`; deterministic `settle -> terminal -> wait` reproduction returned complete then pending; https://developer.chrome.com/docs/extensions/reference/api/downloads
  Touches: extension background download query/completion messages, download watcher, post buttons, queue, batch downloader, history, ordering and reload tests
  Acceptance: terminal state is replayable to every consumer without double consumption; complete and interrupted events before the handoff response, between watcher calls, and afterward settle promptly without the five-minute timeout; completion/history is recorded once; a background query uses `downloads.search({ id })` to distinguish in-progress, complete, interrupted, and missing retained IDs; Resume never duplicates an in-progress or completed file and retries only failed or missing members; deterministic event-order tests and Chrome/Firefox restart tests cover all states.
  Complexity: M
  Depends: None. F327 supplies installed-extension lifecycle proof.

- [ ] F278, P1: Make legacy-profile adoption retry-convergent
  Why: adoption writes the profile-scoped destination before deleting the legacy key. A failure between the two leaves a destination that every later run skips, so the legacy key is never retired.
  Evidence: `src/platform/profile.ts:173-192`
  Touches: `src/platform/profile.ts`, durable migration metadata, profile tests, Control Center adoption status
  Acceptance: a per-key journal records source hash, destination profile, and phase; restart after any injected failure either completes the matching source deletion or reports a real conflict; a different destination value is never overwritten; the status reports moved, completed-after-retry, conflicted, and failed counts separately.
  Complexity: M
  Depends: F273 and F274.

- [ ] F279, P1: Disallow persistent private-browsing sessions
  Why: both extension manifests omit an incognito policy, so a user-enabled private session can write captured posts, notes, URLs, and integration state into shared persistent storage.
  Evidence: `src/extension/manifest.chrome.json`, `src/extension/manifest.firefox.json`; https://developer.chrome.com/docs/extensions/reference/manifest/incognito; https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/incognito
  Touches: both extension manifests, manifest contract tests, install and privacy documentation
  Acceptance: both packages declare `"incognito": "not_allowed"`; Chromium and Firefox manifest tests fail if it is removed; an isolated private-window smoke check shows the extension unavailable and no Aviary key changes; userscript documentation states that private-mode persistence depends on the manager until a standard signal exists.
  Complexity: S
  Depends: None.

- [ ] F280, P1: Scope the network shield to the tab that enabled it
  Why: the control is profile-scoped, but `src/extension/ad-rule.ts` replaces one extension-global dynamic rule. Two tabs with opposing profiles race and the last message changes both tabs.
  Evidence: `src/extension/ad-rule.ts`, `src/main.ts:161-300`; https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest; https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/declarativeNetRequest/updateSessionRules
  Touches: `src/extension/ad-rule.ts`, `src/entrypoints/extension-background.ts`, extension API types, DNR smoke tests
  Acceptance: the background owns session rules conditioned by `tabIds`; enabling one tab and disabling another blocks the promoted logger only in the enabled tab; navigation, tab close, profile switch, browser-session restart, and service-worker restart leave no stale rule; the userscript path remains document-local.
  Complexity: M
  Depends: None.

- [ ] F281, P1: Persist diagnostic codes without provider or page values
  Why: the page diagnostic store retains raw `message`, `error`, or `reason` detail values despite the privacy statement, while background task failures vanish into `console.warn` when the worker is suspended.
  Evidence: `src/platform/diagnostics-store.ts:36-55`, `src/features/ai/command-menu.ts:257-265`, `src/entrypoints/extension-background.ts:474-477`, `docs/PRIVACY.md:66`; https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  Touches: diagnostics types and store, provider call sites, extension background, options readiness UI, privacy tests and migration
  Acceptance: persisted page records contain authored message IDs, severity, time, and detail-key names only; migration deletes every stored `reason` value; a bounded background ring stores operation code, severity, and time without URLs, filenames, provider text, or exception strings; the options page can copy the merged redacted report after a worker restart; tests use sentinel secrets and prove none reach storage or clipboard.
  Complexity: M
  Depends: F273 for one extension-owned diagnostic source.

- [ ] F282, P1: Produce validator-clean CDXJ and WACZ packages
  Why: synthetic HTTPS resources are indexed with `status: "-"`, although CDXJ defines the field as an HTTP response status. Current tests check ordering and offsets but not external conformance or replay.
  Evidence: `src/features/export/warc.ts:103-183`, `src/features/export/wacz.ts:69-134`, `tests/wacz.test.mjs`; https://specs.webrecorder.net/cdxj/0.1.0/; https://specs.webrecorder.net/wacz/1.1.1/
  Touches: `src/features/export/warc.ts`, `src/features/export/wacz.ts`, WACZ worker, package metadata, preservation tests and fixtures
  Acceptance: every indexed entry resolves to the exact WARC offset and has a three-digit status; synthetic pages are valid HTTP 200 response records or are omitted from CDXJ; the package includes title, description, modified time, and first-page URL/date when available; the reference validator exits cleanly; ReplayWeb opens the first page and one captured media response in an isolated browser test.
  Complexity: M
  Depends: None.
  Research update 2026-09-05: when Aviary retained payload bytes but not the received status line and headers, emit `WARC-Type: resource` instead of the invented `HTTP/1.1 200 OK` block in `src/features/export/warc.ts`; use `createdAt` as the visible post time, label `capturedAt` separately, and keep `capturedAt` for `WARC-Date`. Evidence: https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/ and https://iipc.github.io/warc-specifications/guidelines/warc-implementation-guidelines/

### P2, Later

- [ ] F283, P2: Offer an observed-adaptive yt-dlp handoff when it improves saved quality
  Why: an observed adaptive rendition can exceed the best direct MP4 even when a progressive file exists, and adaptive-only posts need an actionable path.
  Evidence: `src/features/media/video-extract.ts`, `src/features/media/urls.ts`; https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py; https://www.rfc-editor.org/rfc/rfc8216
  Touches: observed media metadata, candidate selection, post actions, queue, integration network policy, authenticated local-helper protocol, packaging and failure tests
  Acceptance: adaptive-only media offers `Send to local yt-dlp` and `Copy yt-dlp command`; a direct 720p plus observed adaptive 1080p fixture labels the default as `Best direct MP4` and exposes the higher-quality helper option; the helper receives only the observed manifest, filename, and format policy, never a status URL, cookie, or bearer token for X discovery; the highest observed video and audio are merged without transcoding into MP4 when compatible, otherwise into a named compatible container; helper authorization rejects unauthenticated callers and does not create jobs through GET; missing, refused, running, completed, and failed states differ; direct downloading remains zero setup.
  Complexity: XL
  Depends: F277, F332, and F298. Authentic quality proof remains in `Roadmap_Blocked.md`.

- [ ] F284, P2: Store quality receipts and retry original images without premature fallback
  Why: completion history cannot identify original versus fallback quality, and transient CDN failures should not force a smaller image.
  Evidence: `src/features/media/history.ts`, `src/features/media/urls.ts:35-38`; https://github.com/mikf/gallery-dl/discussions/5034; https://gdl-org.github.io/docs/configuration.html#extractor-twitter-size
  Touches: candidate/result types, image URL normalization and retry policy, background completion messages, history schema, Media page, history export, migration and CDN-format fixtures
  Acceptance: each completed entry records a non-identifying quality label, known dimensions, bitrate, and MIME without retaining its source URL; post state and history show original, fallback, best direct, or quality unknown accurately; bounded retries keep `orig` after transient connection, timeout, or server failures, while permanent absence advances the documented fallback sequence; cancellation never falls back; Retry original later updates the receipt only after a new collision-safe file completes; legacy PNG/JPEG/WebP URLs with and without format queries preserve their validated source format and never silently request JPEG for PNG; historical entries migrate as unknown; fixtures verify requested URLs, actual content types, and the error classes.
  Complexity: M
  Depends: F277 and F332. F283 adds adaptive receipts when it lands.

- [ ] F285, P2: Fuzz the custom CSS and regex safety boundaries
  Why: both analyzers accept user input and have needed repeated bypass fixes. No current bypass was verified, so a seeded adversarial corpus is more justified than replacing either parser.
  Evidence: `src/features/appearance/custom-css.ts`, `src/features/filtering/regex-budget.ts`, commit history; https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS; https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/05-Testing_for_CSS_Injection
  Touches: both analyzers, deterministic corpus generators, worker timeout harness, parser tests
  Acceptance: at least 10,000 seeded mutations cover comments, escapes, nested functions, selector lists, lookarounds, backreferences, and nested quantifiers; accepted CSS cannot escape its allowed selector prefix or create an import/network rule; accepted regex cases finish the sentinel corpus within the worker budget; every discovered reducer case becomes a permanent fixture; the run is deterministic.
  Complexity: L
  Depends: None.

- [ ] F286, P2: Derive accessibility coverage from every shipped surface
  Why: the axe test hard-codes 13 destinations and omits Catch-up, while options, injected media controls, dialogs, toasts, and the archive viewer are not scanned.
  Evidence: `tests/a11y-axe.test.mjs:32-46`, `src/ui/control-center.ts:449-491`; https://www.w3.org/TR/WCAG22/; https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
  Touches: canonical Control Center section export, axe test, surface fixtures, options, media states, viewer, accessibility behavior tests
  Acceptance: the canonical 14-section manifest drives the test; dark, light, narrow, and forced-colors fixtures cover every destination plus options, post/media actions in all terminal states, dialogs, toasts, and viewer; zero serious or critical axe violations ship; focus entry, return, containment, announcements, and disabled-state semantics remain behavior-driven tests.
  Complexity: M
  Depends: None.
  Research update 2026-09-06: Use actual persisted-state fixtures for status semantics; visual normalization must not substitute for state assertions. Cover all 14 destinations, including Catch-up, through the same canonical manifest. Remove the settings harness's 1000-pixel minimum in this item so F302 can reuse its narrow tests.

- [ ] F287, P2: Localize extension-native surfaces from the shared catalog
  Why: the app has nine locales, but both manifests and the native media context menu remain English-only, and options duplicates locale-direction data.
  Evidence: `src/extension/manifest.chrome.json`, `src/extension/manifest.firefox.json`, `src/extension/media-context-menu.ts`, `src/entrypoints/extension-options.ts`; https://developer.chrome.com/docs/extensions/develop/ui/i18n
  Touches: build tooling, `_locales/<locale>/messages.json`, manifests, context menu, options locale bootstrap, packaging tests
  Acceptance: build generates complete message bundles for all nine locales; manifests use `__MSG_*` for name, description, and action title; context menu uses `i18n.getMessage()`; options reads shared direction metadata; packaging fails on a missing or stale message; Chrome and Firefox smoke tests prove one LTR and one RTL locale.
  Complexity: M
  Depends: None.

- [ ] F288, P2: Add a large-library and restart fault matrix
  Why: competitor failures cluster around tombstones, unknown media, large in-memory ZIPs, malformed rows, and service-worker restarts. Aviary has focused tests but no one release gate that combines these stresses.
  Evidence: `src/features/export/zip-store.ts`, `src/features/export/wacz-worker-client.ts`, `src/features/library/archive-import-jobs.ts`; https://github.com/prinsss/twitter-web-exporter/issues/124; https://github.com/gildas-lormeau/SingleFile/issues/1190
  Touches: synthetic fixture generator, export/import/media job harnesses, worker restart helpers, release matrix
  Acceptance: a deterministic 50,000-record corpus includes tombstones, unknown media, duplicate IDs, malformed rows, and missing bytes; search, backup, restore, ZIP, WARC/WACZ, and media selection complete or report row-level partials; one malformed record never aborts the job; forced content and service-worker restarts resume from checkpoints; Chromium peak heap stays below the documented test budget and any estimate refusal occurs before allocation.
  Complexity: L
  Depends: F273, F277, and F282.

- [ ] F289, P2: Replace the TypeScript 7 nightly with the stable compiler
  Why: the repository pins `@typescript/native-preview` even though stable TypeScript 7.0.2 now owns the CLI and Microsoft publishes a side-by-side TypeScript 6 API package for typescript-eslint.
  Evidence: `package.json:35-42`, `tests/native-typecheck.test.mjs`; https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
  Touches: `package.json`, lockfile, typecheck script, parity test, `CLAUDE.md`, README build instructions
  Acceptance: remove `@typescript/native-preview` and its platform packages; pin TypeScript 7.0.2 under a CLI alias and `@typescript/typescript6` under the `typescript` alias; `npm run typecheck` invokes stable `tsc --noEmit`; typescript-eslint still loads the TypeScript 6 API; compiler-parity, lint, build, and the full verify gate pass.
  Complexity: S
  Depends: None.
  Research update 2026-09-05: evaluate the update as one controlled set with typescript-eslint 8.69.0, ESLint 10.10.0, and globals 17.12.0; pin every accepted version and keep each current version if its upgrade breaks the compiler split. Evidence: https://github.com/microsoft/TypeScript/releases/tag/v7.0.2, https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.69.0, https://github.com/eslint/eslint/releases/tag/v10.10.0, https://github.com/sindresorhus/globals/releases/tag/v17.12.0
  Research update 2026-09-06: Pin the compatibility alias to published `@typescript/typescript6@6.0.2`, not the existing `typescript@6.0.3` version number. Verify the resolved API package satisfies typescript-eslint's `>=4.8.4 <6.1.0` peer range; do not install the native compiler as its API dependency. Evidence: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ and https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.69.0

- [ ] F290, P2: Make local releases atomic and reconcile the missing release ledger
  Why: GitHub has no releases for 1.38.0 through 1.44.1 or 1.46.0 despite exact version commits, and the current release steps can leave commit, tag, artifacts, and release metadata out of sync.
  Evidence: `package.json`, `tools/build.mjs`, `tools/preflight.mjs`, local git history; https://github.com/SysAdminDoc/Aviary/releases
  Touches: a local release tool, package script, artifact manifest/checksums, release tests and documentation
  Acceptance: one idempotent local command requires a clean tree, verifies aligned versions, cleans old artifacts, runs the full gate, builds signed ZIP/CRX outputs, creates and pushes the tag, publishes assets, and verifies remote checksums; rerun resumes after a network failure without duplicating the release; a report maps missing versions to exact commits; historical releases are created only from artifacts rebuilt and verified in temporary worktrees at those commits.
  Complexity: L
  Depends: F289 for the settled compiler command. This does not replace the Firefox identity and store-publication decision held as F125 in `Roadmap_Blocked.md`.

### P3, Under Consideration

- [ ] F291, P3: Generate documentation facts from runtime contracts
  Why: page counts, theme claims, panel widths, action names, and permission lists have drifted across README, FAQ, install, privacy, design QA, and logo prompts.
  Evidence: `README.md`, `docs/FAQ.md`, `docs/INSTALL.md`, `docs/PRIVACY.md`, `design-qa.md`, `LOGO_PROMPTS.md`, `tests/docs-consistency.test.mjs`
  Touches: those documents, settings-reference tooling, docs-consistency tests
  Acceptance: every document says 14 destinations, current dark/light behavior, current width tokens, current Download naming, and all required permissions including `contextMenus`; generated tables come from canonical section/settings metadata; stale Twitter Userscript branding is removed; a contract test fails on future count, permission, theme, or action-name drift.
  Complexity: S
  Depends: F279 and F287 so final permission and locale facts are stable.
  Research update 2026-09-05: use root `design-qa.md` and root `LOGO_PROMPTS.md`; the refresh must also reconcile 71 PNG baselines, 14 destinations, 36 registered modules, 21 selector surfaces, the available-width Wide mode, and screenshots that still display 1.47.0. Evidence: `README.md`, `design-qa.md`, `LOGO_PROMPTS.md`, `src/main.ts`, `src/platform/selectors.ts`, `tests/visual/baselines/`
  Research update 2026-09-06: Replace backup copy that says only the current profile is included, list `unlimitedStorage`, and state that ordinary extension removal deletes its local data. Chrome's 2026-08-01 disclosure policy covers local clipped content and observed responses; distinguish this from optional transmission rather than claiming no data handling. Source counts must be generated, not frozen to the figures in older notes. Evidence: `src/ui/control-center/sections/advanced.ts`; https://developer.chrome.com/blog/cws-policy-updates-2026?hl=en; https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies

- [ ] F292, P3: Export a static personal archive with RSS
  Why: Tweetback and Nitter validate independent local reading and feeds, while Aviary already has captured records, thread relationships, local media references, and a standalone viewer.
  Evidence: `src/features/export/viewer.ts`, `src/features/library/`; https://github.com/tweetback/tweetback; https://github.com/zedeus/nitter
  Touches: export formatters, viewer routes, thread reconstruction, RSS generator, ZIP packaging and tests
  Acceptance: one local export produces a static index, per-post pages, reconstructed thread links, copied media when bytes exist, explicit placeholders when they do not, and valid RSS 2.0; every page opens with network disabled; canonical links point to the original X URL while archive navigation stays local; repeated export is deterministic apart from the declared generated time.
  Complexity: L
  Depends: F282 and F288.

- [ ] F293, P3: Import a Scrollmark portable bundle without losing provenance
  Why: a concrete passive-archive import gives users a migration path without introducing a generic plugin system.
  Evidence: `src/features/library/archive-import.ts`, `src/features/library/archive-import-jobs.ts`; https://github.com/kmccleary3301/scrollmark/releases/tag/v1.5.0
  Touches: archive classifier, import jobs, provenance metadata, deduplication, fixture and round-trip tests
  Acceptance: checked-in scrubbed fixtures identify the bundle's declared schema version separately from the Scrollmark application release; support the canonical older v1.2-era bundle and current v1.5.0 export when their schemas differ; preview counts and unsupported fields, import posts/media references/tags, retain bounded unknown records with provenance, deduplicate canonical post/media IDs, and resume after interruption; malformed rows report errors without aborting valid rows; SQLite companion storage is not mistaken for the portable bundle.
  Complexity: M
  Depends: F288. F320 supplies bounded source staging.

- [ ] F294, P3: Add a reviewable selection step before large media batches
  Why: commercial tools and downloader communities repeatedly request bulk saving, but Aviary's captured-result action queues the whole local result set. A preview prevents accidental large jobs without adding a crawler or ZIP requirement.
  Evidence: `src/features/media/batch-downloader.ts`, `src/ui/control-center/sections/data.ts`; https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader; https://greasyfork.org/fil/scripts/529453-twitter-x-media-downloader/feedback
  Touches: local library result model, batch preview UI, queue checkpoint, media filters and tests
  Acceptance: the action opens a compact local-only list with select-all, per-item selection, media-kind and quality filters, collision-safe filenames, estimated file count, and unavailable-item reasons; only selected items enter the durable queue; Cancel writes nothing; the batch downloads individual files, never a required ZIP, and makes no new X timeline or GraphQL request.
  Complexity: M
  Depends: F277 and F284.

## Research-Driven Additions (2026-09-04)

### P1, Next

- [ ] F297, P1: Align browser floors with supported releases and actual API requirements
  Why: Firefox 128 is no longer a supported ESR, and the Chrome 116 rationale names documentId/world APIs not used by this code.
  Evidence: `src/extension/browser-floors.ts`, both manifests; https://www.firefox.com/en-US/firefox/153.0esr/releasenotes/; https://www.mozilla.org/en-US/security/advisories/mfsa2026-84/; https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version
  Touches: browser-floor constants, manifests, capability callers, floor tests, preflight, install documentation, release support table
  Acceptance: select and record a Firefox ESR receiving security updates on the implementation date and test it plus current stable; Firefox 140 must not be labeled unsupported merely because 153 exists, since 140 received fixes on 2026-09-01; derive the Chromium minimum from used APIs and tested compatibility; remove only fallbacks made unnecessary in every supported target, retaining feature detection needed by userscript managers; manifest and constants agree under preflight; explain any retained DNR workaround with a reproduced requirement; install docs and release notes name the last compatible build before either minimum increases.
  Complexity: M
  Depends: None.

- [ ] F298, P1: Remove optional panel and archive code from document-start delivery
  Why: the extension's approximately 2.33 MB content bundle has about 2.8 percent headroom under its 2.40 MB budget, while optional panel, archive, and catalog code loads on every page.
  Evidence: `tools/build.mjs`, `tools/preflight.mjs`, `src/platform/i18n-catalog.ts`, `src/ui/control-center.ts`, generated content bundle; https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources; https://www.extensionworkshop.com/documentation/publish/source-code-submission/
  Touches: build targets, delivery budgets, manifests, content entrypoint, panel/export/library entry points, composition tests, reviewer source package
  Acceptance: first prove lazy module loading from isolated content scripts at both declared browser floors; choose a compatible bootstrap/output format from that result rather than assuming IIFE output can split; keep protection, media controls, selector health, and launcher in the first chunk, loading panel/export/WACZ/viewer/catalog on demand; first-chunk bytes fall by at least 50 percent with budgets for every chunk; failed loads give a named recoverable error; expose exact required chunks to X matches only, use dynamic URLs only where supported, and never expose privileged modules; preserve the readable single-file userscript with its own budget; ship a deterministic source archive and reproduce it on Linux ARM64 with a pinned runtime satisfying package engines, since AMO's documented Node 24.14.0 does not.
  Complexity: L
  Depends: F297 for final browser-floor validation. Unblocks the delivery-size half of F283, F292, and F294.

- [ ] F299, P1: Report a selector break on the page, not only inside Advanced
  Why: selector health reacts only when "App root" or "Primary column" goes missing, and its only reaction is a diagnostics warning. Twenty-one surfaces are tracked, twelve marked high churn, and every one already names the feature it owns, so the data to say "Download is unavailable because X renamed the post action bar" exists and is discarded. With the update channel answering 404 (F183), a user on a broken build has no other way to find out.
  Evidence: `src/features/core/selector-health.ts:15` (`CRITICAL_SURFACES`), `:74-99` (warn-only), `src/ui/control-center/sections/advanced.ts:41` (the only UI consumer), `src/platform/selectors.ts:12-22` (every surface names its owning feature), `:125` and the twelve `churnRisk: "High"` entries; `Roadmap_Blocked.md` F183
  Touches: `src/features/core/selector-health.ts`, `src/features/core/feature-toast.ts`, the launcher in `src/features/core/control-center.ts`, `src/platform/selectors.ts`, `tests/selector-health-dashboard.test.mjs`, a new degraded-state test, `.github/ISSUE_TEMPLATE/bug_report.yml`
  Acceptance: a required surface missing on the current route marks the launcher with a non-blocking degraded state and opens to a list naming each missing surface and the feature it disables, in the user's locale; the signal appears once per distinct degradation rather than per mutation batch, and clears itself when the surface returns without a reload; a healthy route, a route where the surface is `inapplicable`, and a feature the user turned off never produce a signal; the panel offers a copy action producing a report with route, surface names, feature ids, and build version and no post content, handles, or URLs; a fixture with a renamed post action bar drives the whole path in a test.
  Complexity: M
  Depends: None.

- [ ] F301, P1: Cover the two untested modules that sit on privileged paths
  Why: `trusted-types.ts` is the only file exempted from preflight's repository-wide `innerHTML` ban and silently degrades to a string passthrough when `trustedTypes` is absent. `media-context-menu.ts` carries the message-shape validator for a cross-context download trigger, and `contextMenus` is a declared permission in both manifests. Neither is referenced by any test.
  Evidence: `src/platform/trusted-types.ts`, `tools/preflight.mjs` (the `platform/trusted-types.ts` exemption in the `innerHTML` scan), `src/extension/media-context-menu.ts` (`isMediaContextDownloadMessage`, `X_DOCUMENT_PATTERNS`), both manifests' `permissions` arrays; no match for either path across `tests/**/*.mjs`
  Touches: two new test files, `src/platform/trusted-types.ts`, `src/extension/media-context-menu.ts`, `tests/extension-background-api.test.mjs`
  Acceptance: a policy created where `trustedTypes` exists returns a `TrustedHTML` and refuses input the policy rejects; the fallback path is exercised explicitly and the test states that it is a passthrough, so the degradation is a recorded decision rather than an accident; `isMediaContextDownloadMessage` rejects a wrong type, a missing field, an extra field, a non-string URL, a non-X document URL, a `javascript:` and a `data:` URL, and a message from an unexpected sender, and each rejection is proved by mutating the validator and watching the test go red; a valid message still reaches the download path.
  Complexity: S
  Depends: None.

- [ ] F302, P1: Gate releases on artifact-matched visual, reflow, and browser smoke tests
  Why: verify omits separate visual/smoke scripts, settings captures accept a same-version stale bundle, and their harness refuses widths below 1000 pixels.
  Evidence: `package.json`, `tools/build.mjs`, `tools/preflight.mjs`, `tools/settings-visual-harness.mjs`; https://www.w3.org/WAI/WCAG22/Understanding/reflow.html; https://github.com/typefully/minimal-twitter/issues/257; https://playwright.dev/docs/release-notes
  Touches: release command, build/preflight ordering, capture harness, baseline manifests, smoke tests, install and development docs
  Acceptance: one release command runs typecheck, lint, tests, build, preflight, visual checks, and all smoke lanes, failing before publication on any failure; a fast development command names omitted lanes; rejected artifacts never remain as installable output; source fingerprints prove screenshots and smoke tests used the exact built source, not just a matching version; shifted baselines, stale same-version bundles, and over-budget output fail the gate; Home, search, profile, bookmarks, Status, Messages, compose, settings, and media overlays run at 320/768/1280/1920 CSS pixels plus 200 and 400 percent zoom; actual download controls work, focused controls remain visible, and Messages actions reserve usable width including scrollbar space; narrow captures cannot be skipped by a harness minimum.
  Complexity: M
  Depends: F286 for the canonical surface matrix. Evaluate Playwright 1.63.0's structured JSON ARIA and trace additions, but basic ARIA and forced-colors checks need no upgrade; its test-runner lock is not a Node test-runner lock.

### P2, Later

- [ ] F303, P2: Target the published WACZ specification and settle the signature interop story
  Why: preserve F282's corrected WACZ 1.1.1 target. The 1.2.0 draft carries "This document is a draft of a potential specification. It has no official standing of any kind", has not moved since 2022, and webrecorder/specs#124 proposes deleting it. Separately, `wacz-signing.ts` invents `ECDSA-P384-SHA256` with an Aviary-specific block, so no third-party tool can verify an Aviary signature even though a signing spec exists.
  Evidence: https://specs.webrecorder.net/wacz/1.1.1/ (Recommendation, 2021-06-03), https://specs.webrecorder.net/wacz/1.2.0/ (draft disclaimer), https://github.com/webrecorder/specs/issues/124, https://specs.webrecorder.net/wacz-auth/0.1.0/, https://specs.webrecorder.net/cdxj/0.1.0/ (seven required fields), https://github.com/webrecorder/py-wacz/releases (0.5.0, 2024-04-11), https://github.com/iipc/jwarc/releases (0.37.0, 2026-09-01); `src/features/export/wacz.ts:69-134`, `src/features/export/wacz-signing.ts:8-13,147-151`
  Touches: `src/features/export/wacz.ts`, `src/features/export/wacz-signing.ts`, `src/features/export/warc.ts`, the WACZ worker, `tests/wacz.test.mjs`, `tests/wacz-signing.test.mjs`, export panel copy, `docs/FAQ.md`
  Acceptance: `datapackage.json` declares `profile: "data-package"` and keeps `wacz_version`, `mainPageUrl`, and `mainPageDate`, and a test fails if a 1.2.0-draft field is introduced; every CDXJ line carries all seven required fields with a three-digit status; validation runs against py-wacz and is cross-checked against jwarc for the WARC records, with both versions recorded in the test output; the signature either conforms to the wacz-auth 0.1.0 anonymous format and verifies with an external verifier, or the panel and `docs/FAQ.md` state that the signature is verifiable only by Aviary and name the algorithm, and the export never uses the word signed without that qualification.
  Complexity: M
  Depends: None. Modifies F282: adopt the 1.1.1 target and the external cross-validator there rather than shipping the draft shape.

- [ ] F304, P2: Send the completion-limit parameter current OpenAI models accept
  Why: the OpenAI-compatible path always sends `max_tokens`, which reasoning models reject with `unsupported_parameter`. The user sees `Provider HTTP 400` with no explanation, on a correctly configured account.
  Evidence: `src/features/integrations/ai-provider.ts:114-120`, `:133-135` (the bare HTTP status message); https://developers.openai.com/api/reference/python/resources/chat/subresources/completions/methods/create; https://github.com/simonw/llm/issues/724
  Touches: `src/features/integrations/ai-provider.ts`, `src/features/integrations/usage.ts` (request-size estimate), `src/ui/control-center/sections/advanced.ts` provider copy, `tests/integration-usage.test.mjs`, a new provider-compatibility test
  Acceptance: a 400 naming an unsupported completion-limit parameter is retried once with the other parameter name and the working choice is remembered per configured endpoint, or the request sends `max_completion_tokens` first and falls back, whichever the fixture matrix shows costs fewer round trips; a provider error body that names a parameter or a model is surfaced to the user as a stated reason instead of a bare status, without persisting the provider text (see F281); the usage ledger charges one reservation for a retried pair, not two; fixtures cover a legacy chat model, a reasoning model, and a self-hosted OpenAI-compatible endpoint that accepts neither name.
  Complexity: S
  Depends: F281 for the redaction rule that governs how much of a provider error may be shown and stored.

- [ ] F305, P2: Fail preflight on a source export nothing references
  Why: the repository exports deliberately for testability, so an exported declaration does not prove that production, tests, or tools use it; a reference gate can detect abandoned entry points without relying on compiler visibility.
  Evidence: dead across `src/`, `tests/`, and `tools/`: `crossTabLocksAvailable` (`src/platform/storage-lock.ts:77`), `extractVideos` (`src/features/media/video-extract.ts`), `collectProfileAbout` (`src/features/export/collector.ts`), `buildEmbeddingDisclosure` (`src/features/integrations/usage.ts`), `extensionFor` (`src/features/media/urls.ts`), `defaultSnapshotForPreset` (`src/features/core/presets.ts`), `videoPlaybackBound` (`src/features/performance/video-playback.ts`), `AVIARY_FAVICON_URL` (`src/features/appearance/favicon.ts`), `TITLE_BADGE_PATTERN` (`src/features/appearance/title-badge.ts`)
  Touches: `tools/preflight.mjs`, the nine modules above, `tests/source-contracts.test.mjs`
  Acceptance: preflight reports every exported symbol in `src/` with no reference from `src/`, `tests/`, or `tools/`, and fails on any not named in a short allowlist that states why each entry exists; the nine current cases are deleted or wired up rather than allowlisted, and any test that only existed to reach a deleted symbol is deleted with it; planting a new unreferenced export makes preflight fail, and removing the check while an unreferenced export exists is proved to make it pass, so the gate cannot pass by finding nothing.
  Complexity: S
  Depends: None. Check the current reference graph before deleting any previously identified symbol; F328 can change the lock's exported contract.

- [ ] F306, P2: Generate synthetic capture fixtures so selector proof is not one operator session
  Why: every selector claim in the project rests on two `_decoded/` files dated 2026-05-19, which are 110 days old on 2026-09-06 against a 90-day ceiling and pass only on a waiver expiring 2026-09-30. After that `preflight` fails and takes `verify` with it, blocking releases unrelated to selectors. The same files carry a named account's handle and body text and are in git history, which is what F184 is about. A generator turns both problems into one.
  Evidence: `_decoded/captures.json` (`ceilingDays: 90`, `acknowledgedStaleUntil: "2026-09-30"`, both captures `capturedOn: "2026-05-19"`), `tools/capture-decode.mjs`, `src/platform/selectors.ts:12-22` (each surface names its owning feature), `.github/pull_request_template.md` (a capture is required as evidence for selector work), `Roadmap_Blocked.md` F134, F184, F237
  Touches: a new generator under `tools/`, a shape schema file beside `_decoded/captures.json`, `tools/preflight.mjs`, `tests/fixtures.test.mjs`, `tests/declutter-current-x.test.mjs`, the fixture helpers
  Acceptance: a schema records, per surface, the container nesting, test ids, roles, aria attributes, and repetition counts that Aviary depends on, and carries the capture date it was derived from; the generator produces deterministic synthetic Home and conversation documents from that schema with no real handle, display name, post body, image URL, or numeric id; every selector test that currently reads `_decoded/` passes against the generated documents; preflight ages the schema rather than the MHTML, so a refreshed capture updates the schema and is then discarded; a deliberately renamed test id in the schema makes the owning surface report missing, proving the fixtures can still fail; the real captures can be deleted from the working tree without any test losing coverage, which is the precondition F184 is waiting on.
  Complexity: L
  Depends: None. Reduces F134, F201, and F237 to a schema refresh and makes F184's history rewrite safe to sequence.
  Research update 2026-09-06: The capture age is 110 days on 2026-09-06. Regenerating synthetic markup must not refresh the source-observation date; keep authentic freshness and privacy cleanup distinct, so the generator cannot silently extend the 2026-09-30 waiver.

### P3, Under Consideration

- [ ] F307, P3: Make the outbound network policy fail closed
  Why: `network-policy.ts` initialises its predicate to permissive and relies on `main.ts` installing the real one at boot. Nothing currently calls an integration before that line and only the content bundle carries the guard, so this is hardening rather than a live defect, but the default contradicts the setting it enforces and the fix is one line.
  Evidence: `src/features/integrations/network-policy.ts:28` (`let localOnly: () => boolean = () => false`), `:35` (`resetLocalOnlyPolicy` restores permissive), `src/main.ts:236` (install point, after storage, profile, diagnostics, usage, and settings load); `assertOutboundAllowed` appears 9 times in `dist/extension-chrome/content.js` and 0 times in `options.js` and `background.js`
  Touches: `src/features/integrations/network-policy.ts`, `src/main.ts`, `tests/network-shield-gating.test.mjs`, integration tests that rely on the permissive default
  Acceptance: the module default refuses outbound work until a policy is installed, and the refusal names installation rather than the user setting so a boot-order bug is not misreported as local-only mode; every integration entry point still refuses correctly once the real predicate is installed; the test seam sets an explicit policy rather than restoring a permissive default; a test that boots far enough to reach an integration without reaching the install point is refused, and removing the install line makes that test fail.
  Complexity: S
  Depends: None.

### P1, Next

- [ ] F308, P1: Cross-check the selector registry against a maintained third-party X behaviour
  Why: every selector claim in the project is proved against captures dated 2026-05-19, and refreshing them needs an operator session. Webrecorder ships `browsertrix-behaviors` with a maintained X behaviour whose selector table was last updated 2026-08-25, which is a second, dated, independently maintained source for the same DOM that costs no authenticated capture and no request to X.
  Evidence: https://github.com/webrecorder/browsertrix-behaviors (v0.13.1, 2026-08-26), https://raw.githubusercontent.com/webrecorder/browsertrix-behaviors/main/src/site/twitter.ts (anchor-relative XPath off the `h1`, `promoted` skip rule, `expand` for "Show more", recursive quote descent, and a re-locate-after-mutation helper for X's recycled virtualized rows); `src/platform/selectors.ts` (21 surfaces, 12 `churnRisk: "High"`), `_decoded/captures.json`
  Touches: `src/platform/selectors.ts`, a comparison note or generated table under `docs/`, `tests/fixtures.test.mjs`, `Roadmap_Blocked.md` entries that a confirmed selector would unblock
  Acceptance: every Aviary surface whose selector has an equivalent in the third-party behaviour records that equivalent and the date it was checked, beside the existing `stable`/`fallback` pair; surfaces where the two disagree are listed with the disagreement stated rather than silently resolved in Aviary's favour; the comparison is a checked-in artifact with its own date, not a one-off; Aviary's own fallback chain gains any structural selector the comparison shows is more durable, proved by a fixture; nothing is copied that Aviary cannot prove against a fixture it holds, and if any selector is taken verbatim its upstream license and attribution are recorded beside it.
  Complexity: M
  Depends: None. Reduces what F134 and F139 must wait for without replacing the capture.
  Research update 2026-09-06: Add structural fixtures for `profile-photo-grid-*` Photos modules and plain tweet entries in Videos from twitter-web-exporter v1.4.3 (2026-08-31); distinguish absent metadata from no media. Exercise history/likes and recycled rows before attributing an actual feature failure to their route classification. External selectors supplement, never reset, authenticated capture age. Evidence: https://github.com/prinsss/twitter-web-exporter/commit/3e07f1e7ad7469c1bd6526b03bdcb90c495f25b1; https://github.com/EltonChou/TwitterMediaHarvest/issues/339; https://github.com/EltonChou/TwitterMediaHarvest/issues/355

- [ ] F309, P1: Test passive request boundaries and state account-risk limits accurately
  Why: direct network guards do not prove a UI action cannot trigger X's own requests, and passive observation does not establish an exemption from X's automation policy.
  Evidence: `src/platform/network.ts`, `src/page/page-agent.ts`, `src/features/media/downloader.ts`, `src/features/layout/force-following.ts`; https://help.x.com/en/rules-and-policies/x-automation; https://github.com/insin/control-panel-for-twitter/issues/931
  Touches: README, privacy/FAQ, page-agent and network-shield tests, outbound-boundary fixtures, controls that operate X's UI
  Acceptance: enumerate fetch/XHR/beacon call sites and exercise boot, media, route controls, and optional integrations with an observable network log; unconfigured integrations and passive capture originate no authenticated X discovery request and extract no session cookie or bearer token; tests distinguish Aviary's own requests from requests caused by operating X controls, explicitly classifying existing intentional navigation before promising a boundary; unrequested fetch-driving actions are removed or made explicit; disclosure distinguishes local observation, user-triggered CDN/helper transfers, optional transmission, and remaining policy risk, without guaranteeing account safety or legality.
  Complexity: M
  Depends: None. Keep F307's fail-closed startup guard separate.

### P2, Later

- [ ] F310, P2: Separate video quality, codec evidence, and compatibility output
  Why: a recognized codec does not prove a playable container, and choosing a lower-resolution file just because its codec is known violates best-quality downloading.
  Evidence: `src/features/media/video-extract.ts`, `src/features/media/history.ts`; https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py; https://github.com/yt-dlp/yt-dlp/pull/8826; https://github.com/yt-dlp/yt-dlp/issues/8117; https://github.com/yt-dlp/yt-dlp/issues/8750; https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/twitter.js
  Touches: variant types and ranking, metadata enrichment, quality receipts, Media history, optional helper policy, selection and playback fixtures
  Acceptance: quality rank prioritizes known resolution, then uses provenance-qualified bitrate and deterministic tie rules without inventing missing values; an unknown codec alone never demotes a higher-quality candidate; record codec evidence and its source separately from observed quality and proven playback; fixtures include higher-resolution unknown-codec media, inaccurate bitrate, and a named AVC stream in a defective container; history written before the change remains codec unknown; any compatibility action is explicit and keeps the original available; lossless remux preserves streams where possible and a required transcode is labeled with its quality cost, never offered as an original.
  Complexity: M
  Depends: F284 for receipts and F332 for same-URL metadata merging. F283 provides the optional helper boundary.

- [ ] F311, P2: Import old-vintage and Grailbird X archives, not only current ones
  Why: X's export has changed shape by accretion. Archives from roughly 2020 and earlier carry `data/tweet.js` rather than `tweets.js` and lack the four direct-message files; pre-2018 exports use the Grailbird layout entirely. Three separate third-party tools had this exact bug open or closed by 2026-09-05, and none of them was built to handle more than one vintage. Aviary's import path can win here cheaply.
  Evidence: https://github.com/JonathanSeriesX/twixodus/issues/1 (2026-08-28, maintainer: "They must have changed the data structure at some point between 2020 and 2024"), https://github.com/marcomaroni-github/twitter-to-bluesky/issues/93, https://github.com/tweetback/tweetback/issues/95, https://github.com/lhl/tweetxvault/blob/main/docs/GRAILBIRD.md, https://github.com/dogsheep/twitter-to-sqlite/issues/63 (the per-feature files X appended over time); `src/features/library/archive-import.ts`, `src/features/library/archive-import-jobs.ts`
  Touches: `src/features/library/archive-import.ts`, the archive classifier, `src/features/library/archive-types.ts`, new fixture archives, `tests/search-and-export-data.test.mjs`, import preview copy
  Acceptance: the classifier recognises the current layout, the `tweet.js` layout, and the Grailbird `data/js/tweets/YYYY_MM.js` layout, names which it found in the preview, and states which collections that vintage cannot contain rather than reporting them as empty; a fixture archive of each vintage imports with correct counts; an unrecognised layout is refused with the files it did find listed, never partially imported; records carry the source vintage so a later re-import of a newer export can supersede them by canonical post id.
  Complexity: M
  Depends: F293 for the shared source-provenance field.

- [ ] F312, P2: Audit the six authored themes under forced colors
  Why: `tests/forced-colors.test.mjs` drives the Control Center and nothing else, and its own docstring says the panel did not survive forced colors before it existed. The themes have never been checked. `theme.ts` carries 18 shadow and gradient declarations and no `forced-colors` block at all, and the user agent forces `box-shadow`, `text-shadow`, and non-url `background-image` to `none`, so any state expressed only through them disappears silently in Windows High Contrast.
  Evidence: `src/features/appearance/theme.ts` (18 matches for `box-shadow|text-shadow|background-image|linear-gradient`, 0 for `forced-colors`), `src/ui/control-center.ts` (4 `forced-colors` blocks), `tests/forced-colors.test.mjs:11-21` and its zero theme references; https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors
  Touches: `src/features/appearance/theme.ts`, `src/features/appearance/custom-css.ts`, `tests/forced-colors.test.mjs`, `tests/theme-matrix.test.mjs`
  Acceptance: the forced-colors test drives every authored palette plus Off, on both the timeline and a conversation route, reading computed style rather than checking that a media query exists; every element whose only affordance was a shadow, gradient, or background image gains a border or outline in a system color under `@media (forced-colors: active)`; selected, hovered, focused, filtered, and read states remain distinguishable from each other and from the default state in forced colors; a deliberately removed border makes the test fail.
  Complexity: M
  Depends: None.

- [ ] F313, P2: Cover the WCAG 2.2 criteria axe cannot check
  Why: the accessibility work is axe plus a behaviour suite, and axe covers neither focus obscured by a sticky element nor a drag-only interaction, and only partially covers target size. The Control Center has a sticky Save control on a scrolling page, which is the exact shape 2.4.11 exists for, and dense toggle rows are where 2.5.8 fails.
  Evidence: `README.md` ("settings stay in an isolated page draft until the sticky Save control commits the whole page"), `src/ui/control-center.ts`, `tests/a11y-axe.test.mjs`, `tests/a11y-behaviour.test.mjs`; https://www.w3.org/TR/WCAG22/ (2.4.11 Focus Not Obscured Minimum AA, 2.5.7 Dragging Movements AA, 2.5.8 Target Size Minimum AA, 3.3.7 Redundant Entry A)
  Touches: `tests/a11y-behaviour.test.mjs`, `src/ui/control-center.ts`, `src/ui/control-center/panel-context.ts`, section builders with reorderable lists
  Acceptance: a test tabs through every control on every destination at 1440x900 and at a viewport short enough to force scrolling, and fails if the focused element's box is fully covered by the sticky Save row or the rail; every interactive target measures at least 24 by 24 CSS pixels or is exempted by the spec's inline or spacing exception, with the exemption named; any reorderable list offers a single-pointer alternative to dragging and the test drives it; shrinking a control below 24 pixels or growing the sticky row to cover the focused row makes the test fail.
  Complexity: M
  Depends: F286 for the canonical section manifest that drives the sweep.

- [ ] F314, P2: Report Library storage use, cap it, and offer capture-time quality knobs
  Why: `refreshEstimate()` already reads usage and quota and the number reaches only the Advanced page. The cited archiver reports request usage visibility and storage limits. Capture-time controls can reduce new snapshots without changing stored originals.
  Evidence: `src/platform/durable-storage.ts:227-239`, `src/ui/control-center/sections/advanced.ts`, `src/features/library/cleanup-queue.ts`, `src/features/library/cleanup-preview.ts`; https://github.com/karakeep-app/karakeep/issues/1568 (cannot report disk used, open), https://github.com/linkwarden/linkwarden/issues/742 (hundreds of GB with no setting to bound it), https://github.com/gildas-lormeau/single-file-cli/releases (`--image-reduction-factor`)
  Touches: `src/platform/durable-storage.ts`, `src/features/library/cleanup-preview.ts`, `src/features/library/snapshots.ts`, `src/ui/control-center/sections/data.ts`, `src/platform/settings.ts`, retention tests
  Acceptance: a Library storage view shows total bytes and a per-collection breakdown from real measured sizes, with `usageDetails` used where the browser provides it and the absence stated where it does not; a user-set soft cap warns before a capture that would cross it and never deletes anything on its own; the existing cleanup preview names the largest items and what removing them frees; snapshot capture offers an image downscale factor and a poster-frames-only video mode, both off by default, both recorded on the stored record so a later export can say what was reduced; nothing already stored is altered by changing a capture setting.
  Complexity: M
  Depends: F336 for the persisted-state readout this view sits beside.
  Research update 2026-09-06: Do not infer that every peer lacks storage controls from a few issue threads. The local evidence is the missing Library breakdown and capture-size controls. Use F336's tri-state persistence result and actual quota limitations; storage estimates are approximate, not exact filesystem accounting.

- [ ] F315, P3: Emit an ActivityStreams 2.0 outbox alongside the local export
  Why: there is no converged cross-platform social-archive format to adopt, and the standards work has moved to IETF working groups that have shipped nothing usable. AS2 is the one widely parseable social-post schema with existing tooling, it is what Mastodon's own account export emits, and mapping to it costs one layer over records Aviary already holds.
  Evidence: https://docs.joinmastodon.org/user/moving/ (account archive is Activity Streams 2.0 JSON; note that Mastodon imports only the social graph, never posts, so this is an interop output rather than a migration path), https://dtinit.org/blog/2026/08/18/ietf-work-data-portability (PDPArchive is a mail, calendar, and contacts format still in a working group); `src/features/export/formatters.ts`, `src/features/export/types.ts`
  Touches: `src/features/export/formatters.ts`, `src/features/export/export-feature.ts`, export panel copy, `tests/export.test.mjs`, `tests/export-truthfulness.test.mjs`
  Acceptance: one export produces a valid AS2 `OrderedCollection` outbox whose items are `Create` activities wrapping `Note` objects with `id`, `published`, `content`, `attributedTo`, `inReplyTo` where known, and `attachment` entries pointing at the media files in the same package; a post whose original is unavailable is represented as a tombstone rather than omitted silently; the export states plainly that AS2 is an interop format and that no major platform currently imports posts from it; repeated export is deterministic apart from the declared generated time.
  Complexity: M
  Depends: F292, which builds the static export this shares its record mapping with.

## Research-Driven Additions (2026-09-05)

### P1, Next

- [ ] F318, P1: Mark a post seen only after visible dwell
  Why: the current scan records every rendered article immediately, including virtualized posts below the viewport, so dimming and Catch-up can claim the viewer saw content that never reached the screen.
  Evidence: `src/features/filtering/seen-posts-feature.ts` (`scan()` calls `store.mark()` without `IntersectionObserver` or `document.visibilityState`); https://github.com/phuaky/xrai uses 1,000 ms active dwell or a direct status open before marking content seen
  Touches: `src/features/filtering/seen-posts-feature.ts`, `src/features/filtering/seen-posts.ts`, Catch-up capture, `tests/seen-posts-dimming.test.mjs`, `tests/catch-up-capture.test.mjs`, a viewport fixture
  Acceptance: a timeline post is recorded only after at least 50 percent of its box, or 200 CSS pixels for a post taller than the viewport, stays visible for 1,000 continuous milliseconds while `document.visibilityState` is `visible`; direct navigation to that post's Status route records it immediately; fast scroll-through, background-tab time, detached or recycled nodes, and interrupted dwell do not mark it; two simultaneous candidates keep independent timers; disabling or destroying the feature cancels observers and timers and flushes only qualified IDs; existing stored IDs remain valid; tests use a controllable observer and clock and prove each boundary without sleeping.
  Complexity: M
  Depends: None. F276 separately protects simultaneous writes after a post qualifies as seen.

- [ ] F319, P1: Preserve protected and unknown audience state through export
  Why: portable output currently cannot distinguish a public post from content captured while its author was protected, so a shareable package can expose follower-only material without warning.
  Evidence: `src/features/export/types.ts` has no audience field; `src/features/export/thread-capture.ts` already reads `userLegacy` but drops its `protected` boolean; https://docs.x.com/x-api/fundamentals/data-dictionary and https://help.x.com/en/safety-and-security/public-and-protected-posts
  Touches: `src/features/export/types.ts`, `src/features/export/thread-capture.ts`, `src/features/export/collector.ts`, export preview and formatters, WARC/WACZ metadata, static viewer, backup and migration tests
  Acceptance: `ExportRecord` carries `audience: "public" | "protected" | "unknown"`; GraphQL capture maps a real boolean and DOM-only or old records remain `unknown`, never inferred public; local library backup retains all records unchanged; before HTML, Markdown, WARC, WACZ, ActivityStreams, or static share export, the preview reports public, protected, and unknown counts and excludes protected and unknown records until the user explicitly includes each group; JSON and CSV include the field and state their archival rather than share-oriented behavior; quoted-post media inherits its owning record's audience; round-trip tests cover all three states and an old record with no field.
  Complexity: M
  Depends: F282 for preservation-package validation. Extend F292 and F315 to consume the audience field when they land.

- [ ] F320, P1: Stage large archive imports without whole-file base64 duplication
  Why: a 256 MiB import is encoded into roughly 341 MiB of base64, persisted, decoded into another complete byte array, and then parsed, creating avoidable quota and memory failures before useful work begins.
  Evidence: `src/features/library/archive-import-jobs.ts` (`MAX_SOURCE_BYTES`, `encodeBase64`, `source()`), `src/features/library/archive-import.ts` (`MAX_ARCHIVE_BYTES`); https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system and https://web.dev/articles/origin-private-file-system
  Touches: archive import job and parser, ZIP reader, extension background storage API, userscript storage adapter, import progress and recovery UI, large-input and restart tests
  Acceptance: the extension stages source bytes in extension-owned OPFS or chunked IndexedDB through the background, never in X-origin storage; the userscript path stores fixed-size manager chunks; no chunk exceeds 4 MiB and no full-source base64 string is created; ZIP entries are consumed incrementally with compressed, per-entry inflated, and total inflated limits checked before allocation; pause, reload, browser-background restart, resume, cancel, success, and failure retain or remove chunks exactly as their job state requires; a deterministic 256 MiB boundary fixture completes or refuses before allocation with a specific limit reason; an allocator seam proves no parser allocation exceeds 8 MiB; imports at the current 256 MiB limit remain portable between Tampermonkey, Violentmonkey, Chrome, and Firefox through the existing export and re-import path.
  Complexity: L
  Depends: F288 for the large-library and restart harness and F328 for fenced background-owned coordination.

- [ ] F321, P1: Preserve post language and bidirectional isolation end to end
  Why: X exposes post language, but `ExportRecord` drops it, exported HTML hardcodes English, and mixed RTL content can reorder punctuation, handles, and links in portable output.
  Evidence: `src/features/export/types.ts`, `src/features/export/collector.ts`, `src/features/export/thread-capture.ts`, `src/features/export/formatters.ts` (`<html lang="en">`), `src/features/export/warc.ts`; https://www.w3.org/International/questions/qa-html-language-declarations.html and https://www.w3.org/International/articles/inline-bidi-markup/
  Touches: export record schema and migration, DOM and GraphQL collectors, JSON/CSV/HTML/Markdown/WARC formatters, offline viewer, search documents, export and accessibility tests
  Acceptance: collectors retain a canonical BCP 47 post language when X supplied one and store `null` when it did not; invalid tags never reach markup; JSON and CSV include the value; HTML, replay pages, and the viewer keep the shell locale on the document and render each post body with its own `lang` plus `dir="auto"` or an equivalent `bdi` boundary; Markdown preserves language in frontmatter without injecting raw HTML into post text; fixtures cover Arabic and Hebrew with Latin handles and punctuation, plus Japanese, Thai, Lao, Khmer, Myanmar, emoji, an invalid tag, and an old record with no language.
  Complexity: M
  Depends: None. Reuse F287's locale metadata when that item lands.

### P2, Later

- [ ] F322, P2: Replace draft `aria-description` with a real referenced description
  Why: the AI command menu's only item hints use an attribute absent from the WAI-ARIA 1.2 Recommendation, while a hidden DOM description works without adding visible hover help.
  Evidence: `src/features/ai/command-menu.ts:203`; https://www.w3.org/TR/wai-aria-1.2/ and https://w3c.github.io/aria/#aria-description
  Touches: `src/features/ai/command-menu.ts`, command-menu styles, accessibility behavior and axe tests
  Acceptance: every command menu item owns a unique hidden description element and references it with `aria-describedby`; no `aria-description`, `title`, visual tooltip, duplicate ID, or orphaned description remains after the menu closes; Playwright's accessibility snapshot exposes the command name and hint; mouse, touch, and focus behavior remain unchanged; a test opening and closing the menu repeatedly proves complete cleanup.
  Complexity: S
  Depends: None.
  Research update 2026-09-06: Basic accessibility snapshots already exist in the pinned Playwright release. This item can land independently of the 1.63.0 update; use the available description assertion API and verify the referenced DOM node.

- [ ] F323, P2: Segment local search with `Intl.Segmenter`
  Why: whitespace tokenization plus a CJK bigram fallback leaves Thai, Lao, Khmer, and Myanmar queries as oversized tokens, even though supported browsers provide locale-aware word boundaries.
  Evidence: `src/features/library/query-model.ts` (`tokenizeSearchText`); https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter, https://tc39.es/ecma402/#sec-intl-segmenter-constructor, https://www.unicode.org/reports/tr29/
  Touches: `src/features/library/query-model.ts`, index schema/version migration, search worker if applicable, tokenizer and ranking tests
  Acceptance: feature-detected `Intl.Segmenter` with word granularity supplies tokens for scripts without spaces while the existing deterministic tokenizer remains the fallback; handles, IDs, normalization, phrase matching, and Latin/CJK rankings do not regress; Thai, Lao, Khmer, and Myanmar fixtures find the same record from a contained word; index versioning rebuilds old indexes once and resumes safely after interruption; tests run both native and forced-fallback paths.
  Complexity: M
  Depends: F297 so the final browser floors define the required Segmenter behavior.

- [ ] F324, P2: Attribute mutation work and long frames to individual features
  Why: every active `apply()` runs serially after each mutation batch, but diagnostics cannot identify which feature makes scrolling or navigation stall.
  Evidence: `src/features/registry.ts` (`#runApply`), `src/platform/observer.ts` (`FLUSH_DELAY_MS = 120`, `MAX_BATCH_NODES = 400`); https://w3c.github.io/long-animation-frames/, https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing, https://web.dev/articles/optimize-long-tasks
  Touches: feature registry, observer diagnostics, redacted diagnostic store, Advanced performance view, deterministic registry and large-DOM tests
  Acceptance: each apply pass records feature ID, invocation count, total duration, maximum duration, and whether the pass was incremental or full in a bounded local ring; no selector, route URL, post text, handle, or DOM value is stored; Long Animation Frame data is correlated when supported and reported as unavailable otherwise; a reset control clears the aggregate immediately; a synthetic slow feature and a 400-node overflow identify the correct feature and pass type; a 20-run fixed registry benchmark reports enabled and disabled medians, and instrumentation adds no more than 5 percent or 0.25 ms per pass, whichever allowance is larger.
  Complexity: M
  Depends: F281 for the redacted diagnostic schema.

- [ ] F325, P2: Hide For You independently from opening Following
  Why: users may want the algorithmic tab gone, not merely bypassed once on arrival, and current `forceFollowing` deliberately leaves a manual switch back available.
  Evidence: `src/features/layout/force-following.ts`; https://github.com/yusukesaitoh/calm-twitter/issues/70 and https://github.com/alterebro/bye-for-you
  Touches: `src/features/layout/force-following.ts`, `src/platform/settings.ts`, Minimal preset, Reading controls, i18n catalog, route and teardown tests
  Acceptance: a separate `Hide For You tab` setting is enabled by the Minimal preset and can be changed without changing `forceFollowing`; on Home it selects Following before collapsing only the first tab to 0 by 0, using the known home tablist and position rather than translated text; profile, search, notifications, and custom-list tablists are untouched; if the strip has fewer than two tabs the feature does nothing and reports degraded selector health; disabling it restores the tab without navigation or reload; LTR, RTL, narrow, and touch fixtures pass.
  Complexity: S
  Depends: F299 for visible degraded-selector reporting.

- [ ] F326, P2: Stop reading unrelated storage on every lock poll
  Why: sharedLockRegisterStore().entries uses chrome.storage.local.get(null) at a 12 ms poll interval, deserializing the whole storage area to find a small register.
  Evidence: `src/platform/storage-lock.ts:357`, `SHARED_LOCK_POLL_MS`, `tests/storage-authority-browser.test.mjs`; https://developer.chrome.com/docs/extensions/reference/api/storage
  Touches: lock register discovery, storage authority, cross-tab tests, browser-model performance harness
  Acceptance: contender discovery reads only a safely coordinated per-lock roster or authority-owned index; replacing get(null) with getKeys() alone does not qualify because it still enumerates unrelated keys; a deterministic adapter seeded with 10,000 unrelated keys proves identical keys/values transferred per poll to an empty store, and repeated browser measurements report timing and variance; no lost or hidden contenders under concurrent index updates; correctness tests remain intact and realistic manager/extension measurements are labeled separately from shared-Map models.
  Complexity: M
  Depends: F328 so indexing cannot preserve the unfenced write defect.

### P1, Next

- [ ] F327, P1: Exercise real extension storage across worker termination and page freezing
  Why: the existing browser lanes replace extension storage with a Node binding and do not exercise an installed MV3 worker or a surviving stale page owner.
  Evidence: `tests/cross-tab-stores.test.mjs`, `tests/storage-authority-browser.test.mjs:216`; https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle; https://developer.chrome.com/docs/web-platform/page-lifecycle-api
  Touches: packaged-extension headless harness, actual background storage messages, lock recovery tests, source-fingerprint checks
  Acceptance: a disposable persistent Chromium profile loads the built Chrome extension and verifies its worker and actual extension-owned values; prove worker termination without a debugger keeping it alive, then resume or safely retry the interrupted transaction once; separately freeze a page holder past expiry, accept a newer owner's mutation, resume the old holder, and prove its stale commit cannot erase the new one; replay, rollback, and reacquisition are checked at acquire/renew/commit boundaries; the Firefox package gets equivalent real-storage restart tests with its actual background model, not a simulated MV3 worker; absent installation or unsupported lifecycle control is an explicit failure, never a passing model fallback.
  Complexity: L
  Depends: F328. Reuse the harness for F277; F335 owns userscript-manager installation.

## Research-Driven Additions (2026-09-06)

### P0, Now

- [ ] F329, P0: Reconcile a final sealed migration snapshot before source deletion
  Why: a legacy tab can commit between the initial snapshot and successful sealing, then close, allowing migration to delete data it never copied.
  Evidence: `src/extension/durable-storage-api.ts:289-329`; a real Chromium IndexedDB experiment returned databaseDeleted true while the destination retained the old note and the newer source note disappeared
  Touches: extension durable-storage migration and sealing, destination receipts, initialization/recovery status, real IndexedDB migration tests
  Acceptance: quiesce the source before the final read or re-read after sealing; compare every final key/value or tombstone and verify the destination receipt before deletion; a late writer that closes before sealing, an actually blocked writer, concurrent migrations, and conflicting destination changes retain all accepted data or leave a recoverable conflict with the source intact; inject failures before/after seal, final copy, receipt, and deletion; a successful migration's destination matches the sealed final state, not the initial snapshot; retries converge without blocking startup indefinitely.
  Complexity: M
  Depends: F328 for destination write authority. F278 remains the separate profile-adoption cleanup task.

- [ ] F330, P0: Persist applied-operation receipts so fallback replay cannot roll back newer data
  Why: a committed fallback operation whose legacy cleanup failed is re-staged on restart and can overwrite a newer healthy write.
  Evidence: `src/platform/durable-storage.ts:403-407,573-579`; a real IndexedDB experiment changed new healthy write back to old fallback after replay
  Touches: fallback journal schema, durable commit transaction, per-key ordering and tombstones, initialization reconciliation, recovery tests
  Acceptance: operation IDs and per-key ordering are committed atomically with values or removals; an acknowledged operation replay is a no-op after any newer healthy set/remove/clear; failures before staging, after value commit, during marker cleanup, and across restart never repeat its effect; receipt garbage collection occurs only when the operation cannot replay, not on an age timeout; bounded compaction preserves the ordering proof; schema migration keeps existing journal entries recoverable and exposes conflicts instead of choosing an older value.
  Complexity: M
  Depends: F328 for authoritative mutation ordering.

### P1, Next

- [ ] F331, P1: Retain bounded media metadata observed before feature startup
  Why: capture is enabled before awaited storage initialization, but responses delivered before the media consumer subscribes are discarded.
  Evidence: `src/main.ts:139-150`, `src/platform/page-bridge.ts:219-222`, `src/features/media/media-buttons.ts:93-94,257-270`; connected-bridge reproduction delivered zero early events and one post-subscription event
  Touches: boot sequencing, page-bridge media subscription, bounded metadata store, media feature lifecycle, startup integration tests
  Acceptance: with storage initialization paused, deliver the first valid fetch and XHR media responses, then finish boot and render a blob-backed post; Download can select the already-observed direct MP4 without another X request or another response; install the consumer before enabling capture or replay a bounded extracted-metadata queue exactly once; explicit record/byte limits and a value-free overflow code prevent unbounded retention; no raw response, cookie, or credential is buffered; duplicates, late subscribers, disabled settings, teardown, and reinitialization have deterministic cleanup and no cross-post leakage.
  Complexity: M
  Depends: None. F332 ensures retained candidates keep their richest metadata.

- [ ] F332, P1: Enrich repeated media URLs before choosing the best video
  Why: the current source is added without bitrate or dimensions and blocks richer same-URL metadata, causing an observed 1080p file to lose to 360p.
  Evidence: `src/features/media/video-extract.ts:80-85,183-185`, `src/features/media/media-metadata.ts:375-389`; deterministic 1080p/8 Mbps plus 360p/0.5 Mbps fixture selected 360p
  Touches: validated variant merge, observed metadata cache, candidate ranking, post and quoted-media ownership, queue snapshot refresh, video-selection tests
  Acceptance: merge evidence by the same validated normalized URL without dropping signed query parameters or combining different resources; retain dimensions, bitrate, MIME, codec, and provenance, never replacing a known field with missing data; define deterministic precedence for conflicting sources without mutating caller input; insertion order does not change the result; later enrichment invalidates cached choice and updates an unstarted queue candidate; currentSrc 1080p plus its richer metadata and separate 360p selects 1080p across Home, Status, quoted-post, and replayed-metadata fixtures; unknown metadata remains explicitly unknown.
  Complexity: M
  Depends: None. Keep F310's broader quality/compatibility policy separate.

- [ ] F333, P1: Bound the complete backup envelope to the production parser limit
  Why: individually valid collections can produce a backup larger than the 100 MiB limit enforced by restore.
  Evidence: `src/features/core/library-backup.ts:283-299,753`; creation has collection limits but no aggregate encoded-envelope limit
  Touches: backup sizing/serialization, export action feedback, production parser, multi-profile size tests
  Acceptance: count the final UTF-8 envelope including profile metadata, checksums, punctuation, and multibyte values against the parser's shared limit; reject oversized output before download handoff and without an unbounded extra allocation; the exact final count is rechecked before emission; every emitted artifact passes the production parser; tests cover limit minus one, exact limit, limit plus one, multibyte strings, and multiple individually valid collections; refusal identifies the limit and leaves the library unchanged; raising the ceiling alone is not a fix.
  Complexity: M
  Depends: None. Use F334's final schema envelope when both changes are integrated.

- [ ] F334, P1: Version backup checksum changes and preserve profile credentials on restore
  Why: the changed parser rejects an envelope using the existing schema-2 checksum formula, while redacted restore must not replace each destination profile's credentials or signing identity.
  Evidence: `src/features/core/library-backup.ts` and `tests/library-backup.test.mjs`; the committed encoder generated a schema-2 bookmark backup accepted by its own parser and rejected by the changed parser, which now includes profile roster/active ID without changing the version
  Touches: backup schema and versioned checksum dispatch, profile identity mapping, restore/rollback, signing-key policy, explicit credential-export action and tests
  Acceptance: retain fixtures produced by schema 1 and the existing schema-2 implementation; introduce an explicit new schema version for the expanded checksum envelope and dispatch its checksum formula strictly by declared version; old fixtures import with historical semantics, while altered profile IDs/roster/active ID with an unchanged checksum fail new-version integrity verification; do not accept alternate checksum formulas for one declared version or describe an unkeyed checksum as authentication; redacted multi-profile restore preserves destination credentials by stable profile ID, and missing signing material never silently clears or replaces the destination identity; explicit sensitive export accurately states what it includes; injected partial-restore failures restore original credentials and profile selection, with existing signing-conflict policy exercised.
  Complexity: M
  Depends: F328 for exclusive restore and F333 for complete-envelope limits.

- [ ] F335, P1: Test installed Tampermonkey and Violentmonkey storage instead of substitutes
  Why: manager-named browser lanes use a shared Node Map and cannot prove real GM persistence, value-change delivery, or cross-origin coordination.
  Evidence: `tests/storage-authority-browser.test.mjs:216`; https://www.tampermonkey.net/documentation.php; https://violentmonkey.github.io/api/gm/
  Touches: disposable manager-install harness, generated userscript verification, real storage/restart tests, test naming and validation documentation
  Acceptance: load pinned, provenance-verified manager packages and the generated userscript in isolated profiles; exercise two permitted origins with synthetic routes and the managers' real GM APIs, never replacing them with bindings or Maps; read/write contention, value-change delivery where used, browser restart, interrupted restore, expiry, and resumed stale owners preserve the authoritative outcome; record actual manager/browser versions and source fingerprint; a missing installation or unavailable lifecycle control fails explicitly; label existing model lanes honestly; no authenticated X traffic or user's active profile/display is used.
  Complexity: L
  Depends: F328. F327 owns the extension installation and background lifecycle lanes.

### P2, Later

- [ ] F336, P2: Preserve persisted storage status across the background bridge
  Why: the background estimate can report persisted true, but the content adapter drops it and the UI shows unknown.
  Evidence: `src/extension/durable-storage-api.ts:150-158`; adapter reproduction transformed usage 123, quota 456, persisted true into only usage and quota
  Touches: estimate message type, extension durable-storage adapter, Advanced status rendering, bridge and persistence lifecycle tests
  Acceptance: true, false, and unavailable traverse the actual background client without coercion; status text distinguishes all three and never promises backup or uninstall protection; tests cover initial boot, content reload, and background restart, plus unsupported storage APIs; screenshot normalization is not accepted as state proof, and the visible status matches an independently read backend result.
  Complexity: S
  Depends: None. F314 reuses this result.
