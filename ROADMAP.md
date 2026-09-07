# Aviary ROADMAP

Version: `1.47.2`

Date: 2026-09-07

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

### P2, Later

- [ ] F283, P2: Offer an observed-adaptive yt-dlp handoff when it improves saved quality
  Why: an observed adaptive rendition can exceed the best direct MP4 even when a progressive file exists, and adaptive-only posts need an actionable path.
  Evidence: `src/features/media/video-extract.ts`, `src/features/media/urls.ts`; https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py; https://www.rfc-editor.org/rfc/rfc8216
  Touches: observed media metadata, candidate selection, post actions, queue, integration network policy, authenticated local-helper protocol, packaging and failure tests
  Acceptance: adaptive-only media offers `Send to local yt-dlp` and `Copy yt-dlp command`; a direct 720p plus observed adaptive 1080p fixture labels the default as `Best direct MP4` and exposes the higher-quality helper option; the helper receives only the observed manifest, filename, and format policy, never a status URL, cookie, or bearer token for X discovery; the highest observed video and audio are merged without transcoding into MP4 when compatible, otherwise into a named compatible container; helper authorization rejects unauthenticated callers and does not create jobs through GET; missing, refused, running, completed, and failed states differ; direct downloading remains zero setup.
  Complexity: XL
  Depends: F277 and F332. Authentic quality proof remains in `Roadmap_Blocked.md`.

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
  Depends: F288.

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

### P2, Later

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

### P2, Later

- [ ] F325, P2: Hide For You independently from opening Following
  Why: users may want the algorithmic tab gone, not merely bypassed once on arrival, and current `forceFollowing` deliberately leaves a manual switch back available.
  Evidence: `src/features/layout/force-following.ts`; https://github.com/yusukesaitoh/calm-twitter/issues/70 and https://github.com/alterebro/bye-for-you
  Touches: `src/features/layout/force-following.ts`, `src/platform/settings.ts`, Minimal preset, Reading controls, i18n catalog, route and teardown tests
  Acceptance: a separate `Hide For You tab` setting is enabled by the Minimal preset and can be changed without changing `forceFollowing`; on Home it selects Following before collapsing only the first tab to 0 by 0, using the known home tablist and position rather than translated text; profile, search, notifications, and custom-list tablists are untouched; if the strip has fewer than two tabs the feature does nothing and reports degraded selector health; disabling it restores the tab without navigation or reload; LTR, RTL, narrow, and touch fixtures pass.
  Complexity: S
  Depends: None. Selector-break reporting is available in the current build.

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

### P1, Next

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
