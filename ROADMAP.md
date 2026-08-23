# Aviary ROADMAP

Version: `1.47.0`

Date: 2026-08-23

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
  Evidence: `src/features/export/warc.ts:103-183`, `src/features/export/wacz.ts:69-134`, `tests/wacz.test.mjs`; https://specs.webrecorder.net/cdxj/0.1.0/; https://github.com/webrecorder/specs/blob/main/wacz/1.2.0/index.md
  Touches: `src/features/export/warc.ts`, `src/features/export/wacz.ts`, WACZ worker, package metadata, preservation tests and fixtures
  Acceptance: every indexed entry resolves to the exact WARC offset and has a three-digit status; synthetic pages are valid HTTP 200 response records or are omitted from CDXJ; the package includes title, description, modified time, and first-page URL/date when available; the reference validator exits cleanly; ReplayWeb opens the first page and one captured media response in an isolated browser test.
  Complexity: M
  Depends: None.

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
  Evidence: `README.md`, `docs/FAQ.md`, `docs/INSTALL.md`, `docs/PRIVACY.md`, `docs/DESIGN_QA.md`, `docs/LOGO_PROMPTS.md`, `tests/docs-consistency.test.mjs`
  Touches: those documents, settings-reference tooling, docs-consistency tests
  Acceptance: every document says 14 destinations, current dark/light behavior, current width tokens, current Download naming, and all required permissions including `contextMenus`; generated tables come from canonical section/settings metadata; stale Twitter Userscript branding is removed; a contract test fails on future count, permission, theme, or action-name drift.
  Complexity: S
  Depends: F279 and F287 so final permission and locale facts are stable.

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
