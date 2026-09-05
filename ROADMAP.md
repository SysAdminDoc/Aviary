# Aviary ROADMAP

Version: `1.47.2`

Date: 2026-08-23, extended 2026-09-05

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

- [ ] F277, P1: Reconcile retained browser downloads before resume
  Why: a running queue item is changed to paused after reload but keeps its browser `downloadId`; Resume starts another transfer without checking whether the first is still running or already complete.
  Evidence: `src/features/media/queue.ts:69-90`, `src/features/media/batch-downloader.ts:549-633`, `src/entrypoints/extension-background.ts`; https://developer.chrome.com/docs/extensions/reference/api/downloads
  Touches: `src/entrypoints/extension-background.ts`, `src/features/media/download-watch.ts`, `src/features/media/queue.ts`, `src/features/media/batch-downloader.ts`, background and reload tests
  Acceptance: a background query message calls `downloads.search({ id })`; queue load maps the retained ID to in-progress, complete, interrupted, or missing; Resume never creates a second transfer for in-progress or complete; interruption retains retry candidates; content reload and service-worker restart tests cover every state in Chrome and Firefox.
  Complexity: M
  Depends: None.

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

- [ ] F283, P2: Add an explicit adaptive-only yt-dlp handoff
  Why: Aviary selects the best observed complete progressive MP4 but rejects HLS, DASH, and fragments. yt-dlp handles adaptive renditions and audio/video merge, so it is the maintained path when no complete MP4 exists.
  Evidence: `src/features/media/video-extract.ts`, `src/features/media/urls.ts`; https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py; https://www.rfc-editor.org/rfc/rfc8216
  Touches: page media metadata, `src/features/media/video-extract.ts`, media actions and queue, integration network policy, a small signed local-helper protocol, packaging docs and tests
  Acceptance: an adaptive-only fixture shows `Send to local yt-dlp` and `Copy yt-dlp command` instead of a disabled Download button; the helper receives only the already-observed manifest URL, filename, and format policy; the highest video plus audio lands as MP4; no cookie, bearer token, or authenticated X request is used; helper missing, refused, running, completed, and failed states remain distinct; progressive MP4 stays the zero-setup default.
  Complexity: XL
  Depends: F277. This does not replace the live-X video-quality proof held in `Roadmap_Blocked.md`.

- [ ] F284, P2: Store a quality receipt and retry original image fallbacks
  Why: history can prove that a file completed but cannot say whether it was `orig`, `4096x4096`, a specific pixel size, or a progressive bitrate. A user cannot tell when a fallback should be retried.
  Evidence: `src/features/media/history.ts`, `src/features/media/urls.ts`; https://docs.x.com/x-api/enterprise-gnip-2.0/fundamentals/data-dictionary; https://github.com/mikf/gallery-dl/discussions/5034
  Touches: media candidate/result types, extension background completion message, history schema, Media page, JSON/CSV history export, migration tests
  Acceptance: each completed entry records a non-identifying candidate label plus known dimensions, bitrate, and MIME type without storing the source URL; the post state and Media history show the exact receipt; an `orig` failure followed by `4096x4096` is marked as fallback; Retry original later creates a collision-safe new file only after `orig` succeeds and updates the receipt; old history migrates as quality unknown.
  Complexity: M
  Depends: F277. F283 adds the adaptive receipt label when it lands.

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
  Research update 2026-09-05: the real files are root `design-qa.md` and root `LOGO_PROMPTS.md`, not the two `docs/` paths above; the refresh must also reconcile 71 PNG baselines, 14 destinations, 36 registered modules, 21 selector surfaces, the available-width Wide mode, and screenshots that still display 1.47.0. Evidence: `README.md`, `design-qa.md`, `LOGO_PROMPTS.md`, `src/main.ts`, `src/platform/selectors.ts`, `tests/visual/baselines/`

- [ ] F292, P3: Export a static personal archive with RSS
  Why: Tweetback and Nitter validate independent local reading and feeds, while Aviary already has captured records, thread relationships, local media references, and a standalone viewer.
  Evidence: `src/features/export/viewer.ts`, `src/features/library/`; https://github.com/tweetback/tweetback; https://github.com/zedeus/nitter
  Touches: export formatters, viewer routes, thread reconstruction, RSS generator, ZIP packaging and tests
  Acceptance: one local export produces a static index, per-post pages, reconstructed thread links, copied media when bytes exist, explicit placeholders when they do not, and valid RSS 2.0; every page opens with network disabled; canonical links point to the original X URL while archive navigation stays local; repeated export is deterministic apart from the declared generated time.
  Complexity: L
  Depends: F282 and F288.

- [ ] F293, P3: Import a Scrollmark portable bundle without losing provenance
  Why: Scrollmark is the closest passive local archive peer and already emits a portable bundle. Supporting one external format gives users a practical migration path without creating a generic plugin system.
  Evidence: `src/features/library/archive-import.ts`, `src/features/library/archive-import-jobs.ts`; https://github.com/kmccleary3301/scrollmark/releases/tag/v1.2.0
  Touches: archive classifier, import jobs, source metadata, deduplication, fixture and round-trip tests
  Acceptance: Aviary recognizes a canonical Scrollmark v1.2 bundle, previews counts and unsupported fields, imports posts/media references/tags with source provenance, preserves unknown records in a bounded raw sidecar, deduplicates by canonical post/media ID, and resumes after interruption; malformed entries become row errors instead of aborting the import.
  Complexity: M
  Depends: F273 and F288.

- [ ] F294, P3: Add a reviewable selection step before large media batches
  Why: commercial tools and downloader communities repeatedly request bulk saving, but Aviary's captured-result action queues the whole local result set. A preview prevents accidental large jobs without adding a crawler or ZIP requirement.
  Evidence: `src/features/media/batch-downloader.ts`, `src/ui/control-center/sections/data.ts`; https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader; https://greasyfork.org/fil/scripts/529453-twitter-x-media-downloader/feedback
  Touches: local library result model, batch preview UI, queue checkpoint, media filters and tests
  Acceptance: the action opens a compact local-only list with select-all, per-item selection, media-kind and quality filters, collision-safe filenames, estimated file count, and unavailable-item reasons; only selected items enter the durable queue; Cancel writes nothing; the batch downloads individual files, never a required ZIP, and makes no new X timeline or GraphQL request.
  Complexity: M
  Depends: F277 and F284.

## Research-Driven Additions (2026-09-04)

Research date 2026-09-04, against `1.47.0` plus the uncommitted cross-origin lock work at `b9b6ec9`. IDs continue from F294. Findings that only correct an existing item are noted inline on that item rather than duplicated here.

### P0, Now

- [ ] F297, P1: Raise the Firefox floor off the end-of-life 128 line
  Why: `browser-floors.ts` justifies the 128 floor with "128 is also an ESR line, and that is the deciding half of the choice". Firefox 128 reached end of life on 2025-09-16, so the floor now supports only an unpatched browser and excludes nobody who is on a supported ESR. Raising it also retires every platform detection branch the module tracks.
  Evidence: `src/extension/browser-floors.ts:20-26,44-53`, `src/extension/manifest.firefox.json` (`strict_min_version: "128.0"`); https://endoflife.date/firefox (ESR 128 ended 2025-09-16; ESR 140 security support ends 2026-09-29; ESR 153 released 2026-07-21); https://support.mozilla.org/en-US/kb/firefox-esr-release-cycle
  Touches: `src/extension/browser-floors.ts`, `src/extension/manifest.firefox.json`, `tests/browser-floors.test.mjs`, `tools/preflight.mjs`, `docs/INSTALL.md`, README support table, plus every call site guarded by `isUnderFloor`
  Acceptance: `FIREFOX_FLOOR` names a Firefox line still receiving security updates on the day of the change, with the endoflife.date figure and that date recorded in the module comment; `PLATFORM_FEATURE_FLOORS` is re-derived against the new floor and each entry that becomes `underFloor` has its detection branch and fallback deleted rather than left dead; preflight still fails if the manifest and the module disagree; the Firefox smoke lane runs against the new floor; `dnr-empty-rules.json` and the comment explaining it are removed if the compatibility reason no longer applies at the new floor, or kept with a restated reason if it does.
  Complexity: M
  Depends: None.
  Research update 2026-09-05: stage both browser floors in the same compatibility review. Chrome 116 is also from 2023, and raising `minimum_chrome_version` silently stops updates for users below the new floor, so release notes and the support table must name the last compatible build. Evidence: https://developer.chrome.com/docs/extensions/reference/manifest/minimum-chrome-version and https://developer.chrome.com/blog/chrome-two-week-release

- [ ] F298, P1: Split delivery so the panel and archive code leave the document-start path
  Why: the extension content bundle is 2,320,580 bytes against a 2,400,000 budget, which is 3.3 percent headroom, and there is no code splitting anywhere. The Control Center, export and WACZ machinery, archive viewer, and the 608 kB i18n catalog all load at `document_start` on every X page even though most sessions open none of them. Nearly every queued feature fails preflight before it fails review.
  Evidence: `tools/preflight.mjs:28-43,555-576`; `dist/extension-chrome/content.js` 2,320,580 bytes and `dist/aviary.user.js` 2,321,512 bytes on 2026-08-23; `grep -rn "await import(" src` returns nothing; `tools/build.mjs:142-160` (`minify: false` for both content targets), `:101-113` (the WACZ worker is already built separately and minified); `src/platform/i18n-catalog.ts` 608,650 bytes, `src/ui/control-center.ts` 131,805 bytes
  Touches: `tools/build.mjs`, `tools/preflight.mjs`, both manifests (`web_accessible_resources`), `src/entrypoints/extension-content.ts`, `src/features/core/control-center.ts`, export and library feature entry points, `tests/injected-ui-contract.test.mjs`, a new delivery-composition test
  Acceptance: measure first whether a dynamic `import()` of a web-accessible resource works from an isolated-world content script at both browser floors, and record the answer, because esbuild's `iife` output cannot code-split and a positive result forces the extension content target to `esm`; then the extension boots from a document-start bundle that carries ad protection, selector health, the feature registry, media controls, and the launcher, and loads the Control Center, export, WACZ, archive viewer, and translation catalog on first use from `web_accessible_resources`; measured first-chunk bytes drop by at least 50 percent and each chunk gets its own budget in `DELIVERY_BUDGETS`; the userscript keeps one readable file and its own budget, because that is its product promise; a lazy chunk that fails to load reports a named error in the panel rather than a dead control; the extension content bundle is minified while the userscript is not, and the build states why for each.
  Complexity: L
  Depends: None. Unblocks the delivery-size half of F283, F292, and F294.
  Research update 2026-09-05: expose exact chunks only to X matches, use `use_dynamic_url` where supported, and never expose background or privileged modules; ship a deterministic source archive and prove the AMO reviewer build on the documented Linux ARM64, Node 24, npm 11 environment. Evidence: https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources and https://extensionworkshop.com/documentation/publish/source-code-submission/

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

- [ ] F302, P1: Put the visual and smoke lanes inside the release gate
  Why: `npm run verify` is typecheck, lint, node tests, build, preflight. The visual lane and all four smoke lanes are separate scripts, so the highest-churn baseline files in the repository are outside the command the project treats as its gate. `npm run build` on its own also emits an over-budget or metablock-mismatched artifact, because preflight runs after it rather than inside it.
  Evidence: `package.json` scripts `verify`, `test:visual`, `smoke`; `tests/visual/baselines/settings/*` among the most-touched files in the last 300 commits; `tools/preflight.mjs:318,555-576`
  Touches: `package.json`, `tools/preflight.mjs`, `tools/build.mjs`, `docs/INSTALL.md` and README development sections
  Acceptance: one named release command runs typecheck, lint, node tests, build, preflight, the visual lane, and every smoke lane, and fails on any of them; a fast development command keeps the current `verify` scope and says in its output which lanes it did not run; the build refuses to leave an artifact on disk that preflight would reject; a deliberately shifted baseline and a deliberately over-budget bundle each fail the release command before anything is published.
  Complexity: M
  Depends: None.
  Research update 2026-09-05: add full-width reflow cases for Home, search, profile, bookmarks, Status, Messages, compose, settings, and media overlays at 320, 768, 1280, and 1920 CSS pixels plus 200% and 400% zoom; use Playwright 1.63.0 forced-colors and ARIA snapshots after deliberate rebaselining. Evidence: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html and https://github.com/microsoft/playwright/releases/tag/v1.63.0

### P2, Later

- [ ] F303, P2: Target the published WACZ specification and settle the signature interop story
  Why: F282 names WACZ 1.2.0. That draft carries "This document is a draft of a potential specification. It has no official standing of any kind", has not moved since 2022, and webrecorder/specs#124 proposes deleting it. Separately, `wacz-signing.ts` invents `ECDSA-P384-SHA256` with an Aviary-specific block, so no third-party tool can verify an Aviary signature even though a signing spec exists.
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
  Why: the repository exports deliberately for testability, so "exported" carries no signal about use, and nine symbols are now dead repository-wide. One of them, `crossTabLocksAvailable`, was actively edited by the in-flight storage change while being called by nothing, which is exactly how a modified-but-dead symbol survives review.
  Evidence: dead across `src/`, `tests/`, and `tools/`: `crossTabLocksAvailable` (`src/platform/storage-lock.ts:77`), `extractVideos` (`src/features/media/video-extract.ts`), `collectProfileAbout` (`src/features/export/collector.ts`), `buildEmbeddingDisclosure` (`src/features/integrations/usage.ts`), `extensionFor` (`src/features/media/urls.ts`), `defaultSnapshotForPreset` (`src/features/core/presets.ts`), `videoPlaybackBound` (`src/features/performance/video-playback.ts`), `AVIARY_FAVICON_URL` (`src/features/appearance/favicon.ts`), `TITLE_BADGE_PATTERN` (`src/features/appearance/title-badge.ts`)
  Touches: `tools/preflight.mjs`, the nine modules above, `tests/source-contracts.test.mjs`
  Acceptance: preflight reports every exported symbol in `src/` with no reference from `src/`, `tests/`, or `tools/`, and fails on any not named in a short allowlist that states why each entry exists; the nine current cases are deleted or wired up rather than allowlisted, and any test that only existed to reach a deleted symbol is deleted with it; planting a new unreferenced export makes preflight fail, and removing the check while an unreferenced export exists is proved to make it pass, so the gate cannot pass by finding nothing.
  Complexity: S
  Depends: F300, so `crossTabLocksAvailable` is resolved by the change that touched it.

- [ ] F306, P2: Generate synthetic capture fixtures so selector proof is not one operator session
  Why: every selector claim in the project rests on two `_decoded/` files dated 2026-05-19, which are 109 days old against a 90-day ceiling and pass only on a waiver expiring 2026-09-30. After that `preflight` fails and takes `verify` with it, blocking releases unrelated to selectors. The same files carry a named account's handle and body text and are in git history, which is what F184 is about. A generator turns both problems into one.
  Evidence: `_decoded/captures.json` (`ceilingDays: 90`, `acknowledgedStaleUntil: "2026-09-30"`, both captures `capturedOn: "2026-05-19"`), `tools/capture-decode.mjs`, `src/platform/selectors.ts:12-22` (each surface names its owning feature), `.github/pull_request_template.md` (a capture is required as evidence for selector work), `Roadmap_Blocked.md` F134, F184, F237
  Touches: a new generator under `tools/`, a shape schema file beside `_decoded/captures.json`, `tools/preflight.mjs`, `tests/fixtures.test.mjs`, `tests/declutter-current-x.test.mjs`, the fixture helpers
  Acceptance: a schema records, per surface, the container nesting, test ids, roles, aria attributes, and repetition counts that Aviary depends on, and carries the capture date it was derived from; the generator produces deterministic synthetic Home and conversation documents from that schema with no real handle, display name, post body, image URL, or numeric id; every selector test that currently reads `_decoded/` passes against the generated documents; preflight ages the schema rather than the MHTML, so a refreshed capture updates the schema and is then discarded; a deliberately renamed test id in the schema makes the owning surface report missing, proving the fixtures can still fail; the real captures can be deleted from the working tree without any test losing coverage, which is the precondition F184 is waiting on.
  Complexity: L
  Depends: None. Reduces F134, F201, and F237 to a schema refresh and makes F184's history rewrite safe to sequence.

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

- [ ] F309, P1: State the account-safety and legal posture as a tested claim
  Why: X Corp sent cease-and-desist letters to Nitter and its instance operators on 2026-08-24 citing API circumvention and session-token access, and the repository was archived on 2026-08-26. Separately, a UI-driving X extension has been reported causing account locks, and a downloader's users have had accounts permanently suspended. Aviary's boundary already differs from all of these, but the boundary is described in prose and proved only indirectly.
  Evidence: https://github.com/zedeus/nitter (archived 2026-08-26; README quotes the 2026-08-24 letters), https://techcrunch.com/2026/08/25/x-sends-cease-and-desist-to-open-source-project-nitter-over-alleged-scraping/, https://github.com/insin/control-panel-for-twitter/issues/931 (2026-08-28, "Showing retweets in separate tabs can accidentally trigger account lock due to excess requests"), https://codeberg.org/mikf/gallery-dl/issues/316 (2026-08-01, two accounts permanently suspended); `src/platform/network.ts` (no request to `x.com`), `src/page/page-agent.ts:191` (observation only), `src/features/media/downloader.ts:84,337` (the only X-adjacent fetches, both to media CDNs)
  Touches: README, `docs/PRIVACY.md`, `docs/FAQ.md`, `tests/page-agent.test.mjs`, `tests/network-shield.test.mjs`, a new outbound-boundary contract test
  Acceptance: a single contract test enumerates every `fetch`, `XMLHttpRequest`, and `sendBeacon` call site reachable from a booted app and fails if any new one targets an `x.com`, `api.x.com`, or `twitter.com` origin; a second test proves no Aviary control causes X's own client to issue a request the user did not initiate, driven against a fixture rather than asserted in prose; README and `docs/PRIVACY.md` state in one place that Aviary reads a session the user is already in, extracts no cookie or bearer token, originates no authenticated X request, and replaces no X surface for a logged-out visitor, each sentence pointing at the test that holds it.
  Complexity: S
  Depends: None.

### P2, Later

- [ ] F310, P2: Record the saved video's codec, and stop preferring an unplayable rendition
  Why: Aviary picks the highest-bitrate complete progressive MP4. yt-dlp deliberately sorts HLS ahead of higher-bitrate progressive HTTP for X because the progressive variant's codec is not known in advance and some of them produce files common players refuse. Aviary therefore has a quality rule that can select a file the user cannot open, and no way to tell afterwards.
  Evidence: `src/features/media/video-extract.ts` (highest numeric bitrate among complete direct MP4 candidates), `src/features/media/history.ts`; https://github.com/yt-dlp/yt-dlp/issues/8117 ("Some Twitter/X videos download an mp4 that doesn't play in VLC"), yt-dlp's X format sort `('res', 'proto:m3u8', 'br', 'size')`
  Touches: `src/features/media/video-extract.ts`, `src/features/media/media-metadata.ts`, `src/features/media/history.ts`, `tests/media-video-targets.test.mjs`, `tests/video-and-presentation.test.mjs`
  Acceptance: the observed variant's codec string is read from the URL path or the media entity where X exposes it and recorded on the completed download beside the bitrate; a variant whose codec is unknown is never preferred over a lower-bitrate variant whose codec is known-good, and the rule states which codecs it treats as known-good and why; the post state and Media history show the recorded codec; a fixture with a higher-bitrate unknown-codec variant and a lower-bitrate known-good one selects the second; history written before this change migrates as codec unknown.
  Complexity: M
  Depends: F284, which adds the receipt this writes into.

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
  Why: `refreshEstimate()` already reads usage and quota and the number reaches only the Advanced page. Users of every comparable local archiver ask for the same two things and none has shipped them: tell me how much disk this is using, and let me bound it. SingleFile's answer to snapshot bloat is per-asset quality at capture time rather than pruning afterwards, which is cheaper and reversible in the only direction that matters.
  Evidence: `src/platform/durable-storage.ts:227-239`, `src/ui/control-center/sections/advanced.ts`, `src/features/library/cleanup-queue.ts`, `src/features/library/cleanup-preview.ts`; https://github.com/karakeep-app/karakeep/issues/1568 (cannot report disk used, open), https://github.com/linkwarden/linkwarden/issues/742 (hundreds of GB with no setting to bound it), https://github.com/gildas-lormeau/single-file-cli/releases (`--image-reduction-factor`)
  Touches: `src/platform/durable-storage.ts`, `src/features/library/cleanup-preview.ts`, `src/features/library/snapshots.ts`, `src/ui/control-center/sections/data.ts`, `src/platform/settings.ts`, retention tests
  Acceptance: a Library storage view shows total bytes and a per-collection breakdown from real measured sizes, with `usageDetails` used where the browser provides it and the absence stated where it does not; a user-set soft cap warns before a capture that would cross it and never deletes anything on its own; the existing cleanup preview names the largest items and what removing them frees; snapshot capture offers an image downscale factor and a poster-frames-only video mode, both off by default, both recorded on the stored record so a later export can say what was reduced; nothing already stored is altered by changing a capture setting.
  Complexity: M
  Depends: F295 for the persisted-state readout this view sits beside.

- [ ] F315, P3: Emit an ActivityStreams 2.0 outbox alongside the local export
  Why: there is no converged cross-platform social-archive format to adopt, and the standards work has moved to IETF working groups that have shipped nothing usable. AS2 is the one widely parseable social-post schema with existing tooling, it is what Mastodon's own account export emits, and mapping to it costs one layer over records Aviary already holds.
  Evidence: https://docs.joinmastodon.org/user/moving/ (account archive is Activity Streams 2.0 JSON; note that Mastodon imports only the social graph, never posts, so this is an interop output rather than a migration path), https://dtinit.org/blog/2026/08/18/ietf-work-data-portability (PDPArchive is a mail, calendar, and contacts format still in a working group); `src/features/export/formatters.ts`, `src/features/export/types.ts`
  Touches: `src/features/export/formatters.ts`, `src/features/export/export-feature.ts`, export panel copy, `tests/export.test.mjs`, `tests/export-truthfulness.test.mjs`
  Acceptance: one export produces a valid AS2 `OrderedCollection` outbox whose items are `Create` activities wrapping `Note` objects with `id`, `published`, `content`, `attributedTo`, `inReplyTo` where known, and `attachment` entries pointing at the media files in the same package; a post whose original is unavailable is represented as a tombstone rather than omitted silently; the export states plainly that AS2 is an interop format and that no major platform currently imports posts from it; repeated export is deterministic apart from the declared generated time.
  Complexity: M
  Depends: F292, which builds the static export this shares its record mapping with.

## Research-Driven Additions (2026-09-05)

Research date 2026-09-05, against `1.47.2` at `9a5970a` plus the shelved cross-origin storage-authority work described by F300. IDs continue from F315. The existing items above carry inline research updates where new evidence changed their acceptance criteria.

### P0, Now

- [ ] F317, P0: Suppress hover-only help and profile cards in Minimal mode
  Why: Aviary no longer authors native `title` tooltips, but X still opens visual tooltips and profile cards when the pointer rests on controls, names, and avatars, which directly contradicts the user's minimal-UI request.
  Evidence: no `hoverCardParent` or visual tooltip suppression exists in `src/` or `tests/`; `src/features/core/presets.ts` defines the Minimal preset; https://www.reddit.com/r/uBlockOrigin/comments/1hzxmcr/block_twitterx_profile_name_hover_over/ and https://github.com/Bl4Cc4t/GoodTwitter2/issues/575 report the same hover-card failure; https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
  Touches: `src/features/layout/declutter.ts`, `src/features/core/presets.ts`, `src/platform/settings.ts`, `src/ui/control-center/sections/reading.ts`, injected UI modules, lifecycle and accessibility tests, a sanitized hover-card fixture
  Acceptance: an independent `Suppress hover previews` setting is enabled by the Minimal preset; with it enabled, resting the pointer for at least 1 second on every Aviary control and representative X navigation button, post action, avatar, and author name produces no browser title, visual `[role="tooltip"]`, or `[data-testid="hoverCardParent"]`; click-opened menus, dialogs, validation messages, focus outlines, visible labels, `aria-label`, and `aria-describedby` remain intact; disabling the setting restores every X `title` value Aviary removed and stops suppressing newly inserted hover portals; touch-only fixtures do not gain pointer listeners; a contract test covers all Aviary-injected controls and fails when a new native `title` is introduced.
  Complexity: M
  Depends: None.

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
  Depends: F288 for the large-library and restart harness and F300 for background-owned coordination.

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
  Depends: F302 for the Playwright 1.63 accessibility snapshot.

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

- [ ] F326, P2: Stop re-reading the whole storage area on every lock poll
  Why: a waiting contender calls `store.entries(prefix)`, which for the extension backend is `chrome.storage.local.get(null)` -- the entire area, deserialized, every 12 ms. Measured on 2026-09-05: the Firefox extension lane of `tests/storage-authority-browser.test.mjs` takes 196s while the Chrome extension lane takes 3s and the Tampermonkey lane 2.5s, against the same crash matrix. The register is the only thing that differs, and it scales with how much the user has stored, so the cost lands hardest on exactly the large libraries the lock exists to protect.
  Evidence: `src/platform/storage-lock.ts` (`sharedLockRegisterStore().entries` uses `get(null)`; `readLockContenders` runs it per poll at `SHARED_LOCK_POLL_MS` = 12), `node --test tests/storage-authority-browser.test.mjs` on 2026-09-05 (Chrome 3002ms, Firefox 195940ms, Tampermonkey 2530ms, Violentmonkey 13532ms)
  Touches: `src/platform/storage-lock.ts`, `tests/cross-tab-stores.test.mjs`, `tests/storage-authority-browser.test.mjs`
  Acceptance: contender discovery reads only keys under the lock's own prefix, using an index key or a per-lock roster rather than a full-area scan; a store seeded with 10,000 unrelated keys costs no more per poll than an empty one, measured rather than asserted; the Firefox extension lane finishes within the same order of magnitude as the Chrome lane; every existing register test still passes unchanged.
  Complexity: M
  Depends: None.

- [ ] F327, P2: Drive the lock through a real suspended service worker
  Why: `tests/cross-tab-stores.test.mjs` proves the register keeps no in-memory authority by discarding the module between phases, which is the right property but a simulation of it. The fidelity gap is a real MV3 worker: registration timing, `chrome.storage` waking the worker mid-transaction, and listeners attached after an asynchronous boot are not exercised anywhere.
  Evidence: `tests/cross-tab-stores.test.mjs` ("a lock survives losing every scrap of in-memory state"), `tests/storage-authority-browser.test.mjs` (models the background as a Node-side binding, not a worker); https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  Touches: a packaged-extension test harness, `tests/storage-authority-browser.test.mjs`
  Acceptance: a headless Chromium launched with `channel: "chromium"` and `launchPersistentContext` loads the built `dist/extension-chrome` and reports its service worker; the worker is stopped between lock acquire, renew, and commit and the transaction still completes exactly once; a lease left by a worker killed mid-transaction is reclaimed only after it expires; the test fails if the extension does not actually load, so a silent no-load cannot pass as green.
  Complexity: M
  Depends: None. A bare `headless: true` loads no extension at all; `channel: "chromium"` is the form that works.
