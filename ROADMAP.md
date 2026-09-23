# Aviary ROADMAP

Version: `1.52.2`

Date: 2026-09-22

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

The live account cleanup repair, Control Center clarity, userscript review, and signed-in visual
audit are recorded in [CHANGELOG.md](CHANGELOG.md). Browser-store distribution and unrelated X
surface captures remain tracked in [Roadmap_Blocked.md](Roadmap_Blocked.md).

## Research-Driven Additions

Evidence for every item is in [RESEARCH.md](RESEARCH.md) (2026-09-22). Items continue the F-number
scheme from F336.

### P1

### P2

- [ ] P2, F353: Reach the yt-dlp helper from the extension background and harden it
  Why: Chrome 142 prompts before a public origin reaches loopback, and 145 made loopback its own permission. The helper `fetch` runs from the x.com content context, and the helper reflects any Origin, checks no Host, and compares its token with a plain string check. Status: Needs live validation.
  Evidence: developer.chrome.com/blog/local-network-access, `src/features/media/yt-dlp-helper.ts:154,188`, `tools/yt-dlp-helper.mjs:196-199,210-215`.
  Touches: `src/entrypoints/extension-background.ts` (a proxied helper message), both manifests (optional `http://127.0.0.1/*`), `src/features/media/yt-dlp-helper.ts`, `tools/yt-dlp-helper.mjs`, helper tests, the helper section of `docs/INSTALL.md`.
  Acceptance: Extension builds reach the helper from the background worker, and a Chromium smoke lane with the helper on a random port shows no x.com loopback prompt. The helper refuses a foreign Host, refuses Origins outside x.com, twitter.com and the extension origin, and uses `crypto.timingSafeEqual`. Each refusal has a test.
  Complexity: M

- [ ] P2, F356: Declare Firefox `data_collection_permissions`
  Why: AMO has required the key for every new submission, listed or unlisted, since 2025-11-03. It's supported from Firefox 140, Aviary's floor. This is the part of F125 that needs no distribution decision.
  Evidence: blog.mozilla.org/addons 2025-10-23, extensionworkshop.com signing and distribution overview, `src/extension/manifest.firefox.json` `browser_specific_settings`.
  Touches: `src/extension/manifest.firefox.json`, `tools/preflight.mjs`, `docs/PRIVACY.md`, the integration enable paths (request optional data collection on Firefox), tests.
  Acceptance: The manifest declares `required: ["none"]` plus optional categories matching each opt-in integration in `docs/PRIVACY.md`. Enabling an integration in Firefox requests its category. A pinned `web-ext lint` run against the built package reports no data-collection error. Preflight fails if the declaration and the privacy map disagree.
  Complexity: M

- [ ] P2, F349: Keep a local library copy of each post before deleting it
  Why: Deletion can't be undone. Cyd and Redact both keep a local archive of what they delete, and Aviary already owns a searchable library.
  Evidence: cyd.social pricing and features, redact.dev pricing, `src/features/library/`, README "Keep a copy you can use later".
  Touches: `src/features/account-cleanup/runner.ts` (a capture step before post and reply deletes), the library capture store, `sections/account.ts`, tests.
  Acceptance: With the option on (the default for posts and replies), each deleted item's visible record (text, time, media URLs, permalink) is in the library, tagged "Deleted by cleanup", before its delete click. A test that makes the capture fail proves the delete is skipped rather than run uncaptured.
  Complexity: M

- [ ] P2, F348: Add keep-rules to Delete X activity
  Why: Date cutoffs appear in eight of the cleanup tools reviewed and "keep if over N likes" in five. Aviary can only delete a whole category.
  Evidence: Cyd (days old, max likes and reposts), Redact, CleanMyX, Circleboom, Twitter Archive Eraser. `src/features/account-cleanup/state.ts:115-120` holds only categories, pacing and `maxActions`.
  Touches: `state.ts` (settings schema and normalizer), `runner.ts` (evaluate before acting, count kept items), `dom.ts` (read `time[datetime]` and metric counts), `sections/account.ts` Advanced options, catalog strings, tests.
  Acceptance: "Only items older than N days", "Keep posts with at least N likes or reposts" and "Keep my pinned post" apply to posts, replies and reposts. Likes and bookmarks apply the date rule only where the route shows a date, and say so otherwise. A DOM test proves a kept item never receives a delete click. Stats report kept counts. Depends on F347.
  Complexity: M/L

- [ ] P2, F350: Report what cleanup couldn't reach, and optionally finish it from an X archive
  Why: The profile timeline historically stops near the latest 3,200 posts, and long Likes lists omit items. Aviary's own fresh pass found 104 Likes the first pass missed. "Deletion complete." can hide a remainder.
  Evidence: docs.x.com timelines introduction (3,200 limit), tweetXer README on older Likes, `CHANGELOG.md` 1.51.2 (104 omitted Likes), Cyd archive import. Archive ids are already parsed by `src/features/library/archive-import.ts`.
  Touches: `runner.ts` (read the profile's post count before and after), `state.ts`, the `sections/account.ts` completion summary, an optional archive-driven pass over `/<handle>/status/<id>` pages.
  Acceptance: When the profile still shows posts after completion, the summary states the count as unreachable from the timeline instead of "complete". With an imported archive, an optional pass visits each remaining id's status page one at a time, uses the same fail-closed delete detection and pacing, and reports a per-id outcome.
  Complexity: L

- [ ] P2, F357: Split the extension panel chunk by destination before adding more UI
  Why: On 2026-09-22 the panel chunk had 0.5% budget headroom and the userscript 1.0%. The gallery and image-card items below can't land without breaching both.
  Evidence: the preflight run of 2026-09-22 (`extension-panel.js` 2,416,860 of 2,430,000 bytes, `aviary.user.js` 2,905,273 of 2,935,000), budgets in `tools/preflight.mjs`, the F298 lazy-delivery design.
  Touches: `tools/build.mjs`, `src/ui/control-center.ts` (dynamic section builders), `src/ui/control-center/section-manifest.ts`, `web_accessible_resources` in both manifests, `tools/preflight.mjs`, bundle and smoke tests.
  Acceptance: Specialist destinations load their builders on first open. The always-loaded panel chunk shrinks by at least 25%. Budgets are re-baselined with at least 10% headroom. The userscript budget decision, raised with a stated reason or trimmed, is written in the budget's comment in `tools/preflight.mjs`.
  Complexity: L

- Build a dedicated profile media gallery with keyboard and screen-reader navigation, ownership
  labels, duplicate handling, and fixture coverage for X's current profile Media routes.
  Research note (2026-09-22): Build it from captured library records rather than DOM tiles. That
  sidesteps the unverified Photos and Videos structure (F201), matches Scrollmark's masonry view
  and xGrid's duplicate detection, and fits after F357 frees budget.
- Render a post-to-image card locally with explicit author, timestamp, permalink, media ownership,
  alt text, and a copy or download action. Add visual baselines before exposing it in the post bar.
  Research note (2026-09-22): None of the card tools reviewed (tweet-ldr, xshots, TweetPik) carry
  alt text, which is Aviary's edge. Write the PNG inside the click handler (Chrome 107+ needs the
  gesture), feature-detect with `ClipboardItem.supports`, and copy the permalink with the image as
  tweet-ldr does. Depends on F357.

### P3

- [ ] P3, F359: Raise the Firefox floor to 153 ESR after 2026-10-13
  Why: ESR 140 reaches end of life on 2026-10-13, which removes the reason `browser-floors.ts` gives for staying on 140.
  Evidence: whattrainisitnow.com ESR schedule, `src/extension/browser-floors.ts` ("Raising the floor to 153 would incorrectly label Firefox 140 unsupported").
  Touches: `src/extension/browser-floors.ts`, `src/extension/manifest.firefox.json` `strict_min_version`, `tests/browser-floors.test.mjs`, INSTALL and README compatibility lines.
  Acceptance: On or after 2026-10-13 the floor is 153.0. Detection branches are removed only for features now under both floors (Navigation API and URLPattern with F341's Chrome 111). Tests pass on Firefox 153 ESR and current release.
  Complexity: S

- [ ] P3, F361: Add a "Hide replies from @grok" toggle
  Why: Hiding Grok replies is table stakes across Grok Be Gone (2,000 users), noGrok, X AI Reply Hider and Control Panel for Twitter. Aviary's Grok setting hides interface chrome only, and `handle is grok` works only for readers who know the rule syntax.
  Evidence: the Chrome Web Store and AMO listings in RESEARCH.md, `layout.hideGrok` in `src/platform/settings.ts:298,507`, the rule fields in `src/features/filtering/rules.ts:26-63`.
  Touches: `src/platform/settings.ts` and normalizer, `src/features/filtering/filter-engine.ts`, `src/ui/control-center/sections/reading.ts`, the Quiet Reader preset, catalog strings, tests.
  Acceptance: The toggle, off by default, hides posts authored by `@grok` (case-insensitive handle match) on every filtered surface. Quiet Reader enables it. A generated reply by `@grok` disappears and an ordinary reply mentioning Grok doesn't.
  Complexity: S

- [ ] P3, F364: Add a `{postDate}` filename token and document `{date}`
  Why: `{date}` is the download date in UTC, not the post date, and the feature reference doesn't say which. Archivists sort by post date.
  Evidence: `src/features/media/media-buttons.ts:877`, `src/features/media/batch-downloader.ts:295,403`, `docs/FEATURES.md:284`, twitter-web-exporter v1.4.1 property-path filename patterns.
  Touches: `src/features/media/template.ts`, the call sites above, `docs/FEATURES.md`, template tests.
  Acceptance: `{postDate}` renders the owning post's `time[datetime]` date, or the captured record's, and falls back to the literal `unknown-date` when neither exists. FEATURES says `{date}` is the download date. Existing templates render unchanged.
  Complexity: S

- [ ] P3, F362: Correct "Nothing leaves your browser" on the options page
  Why: The options page makes a blanket claim, while `docs/PRIVACY.md` documents media fetches and optional outbound integrations. Chrome's 2026-08-01 policy requires disclosures to match data handling.
  Evidence: `src/extension/options.html:29,107`, `src/platform/i18n-catalog.ts:1329,1350`, `docs/PRIVACY.md`, developer.chrome.com/blog/cws-policy-updates-2026.
  Touches: `src/extension/options.html`, catalog and locales, `tests/extension-options-page.test.mjs`, options baselines.
  Acceptance: The copy says media downloads come straight from X's servers and that nothing is sent anywhere else unless an integration is turned on. It's translated, with baselines refreshed.
  Complexity: S

- [ ] P3, F363: Expose or retire `integrations.mastodon.visibility`
  Why: The setting is normalized and read, but no control sets it and no document mentions it, so it changes only through a settings import.
  Evidence: `src/platform/settings.ts:1139`, `src/features/integrations/crosspost.ts:239`, `src/ui/control-center/sections/advanced.ts:616-711`.
  Touches: `sections/advanced.ts`, `docs/FEATURES.md`, `docs/FAQ.md` settings reference through `npm run docs:settings`, tests.
  Acceptance: Connections shows a visibility select (public, unlisted, private, direct) that round-trips through Save and Revert, and the settings reference lists it. Alternatively the key is removed with a migration and a test.
  Complexity: S

- [ ] P3, F355: Show persistent inline messages for invalid fields
  Why: An out-of-range value surfaces only the footer status and a transient native bubble. The field itself carries no lasting message or `aria-invalid`.
  Evidence: `src/ui/control-center.ts:1556-1560`, baseline `tests/visual/baselines/settings/control-center-state-error-dark-1440x900.png`, WCAG 2.2 success criterion 3.3.1.
  Touches: `src/ui/control-center.ts` row builders, `tests/a11y-behaviour.test.mjs`, the error-state baseline.
  Acceptance: An invalid field gets `aria-invalid="true"` and a visible message naming the accepted range, linked through `aria-describedby`. Both clear when the value becomes valid. An axe run of the error state stays clean.
  Complexity: S

- [ ] P3, F369: Add Simplified Chinese
  Why: Chinese-language reviews dominate the feedback on the most-installed X media userscript, and Control Panel for Twitter ships `zh_CN`. Aviary's nine locales don't include Chinese, although cleanup's delete-label list already does.
  Evidence: greasyfork.org/en/scripts/528890/feedback, the CPFT `_locales` directory, `src/platform/i18n-runtime.ts` (`LocaleCode`), `src/features/account-cleanup/dom.ts:29-53`.
  Touches: `src/platform/i18n-runtime.ts`, `src/platform/i18n.ts` (its duplicated locale table), the catalog, native `_locales` generation in `tools/build.mjs`, `tests/i18n.test.mjs`.
  Acceptance: `zh-CN` covers every catalog string and every native message, and the locale gate passes. The duplicated tables in `i18n-runtime.ts` and `i18n.ts` become one. Bundle budgets hold, so this depends on F357.
  Complexity: M

- [ ] P3, F371: Let the reader review bookmarks and captured posts saved while X's user shape was misread
  Why: From X's 2026-07-28 user-object change until F366, mirrored bookmarks and captured posts were stored with no handle, and every account in a bookmark response became an empty bookmark under the account's id. Those rows stay in existing libraries after the fix.
  Evidence: F366's mutation run reproduced the phantom `{tweetId: "5005", handle: null, text: "", url: "https://x.com/i/status/5005"}` from a July 2026 bookmark response. twitter-web-exporter commit of 2026-07-28 dates the change. `src/features/library/bookmarks.ts` `BookmarkStore.mirror`.
  Touches: `src/features/library/bookmarks.ts`, the Saved posts section, catalog strings, tests.
  Acceptance: Saved posts can filter to mirrored rows with no handle captured on or after 2026-07-28, and lists them for review with a single "Remove selected" action. Nothing is deleted automatically, because a media-only post captured under the bug looks the same as a phantom. A fixture with both kinds proves neither is removed without selection.
  Complexity: S/M

- [ ] P3, F360: Refresh pinned development dependencies
  Why: eslint 10.11.0, typescript-eslint 8.70.1, Playwright 1.63.0 (Chromium 153, Firefox 155), globals 17.12.0 and Node 24.21.0 are out. Violentmonkey's stable is 2.49.0 (2026-09-06), with an MV3 execution-order fix, while the manager lane still installs 2.47.0. Tampermonkey 5.5.0 is still the current stable. The typescript-eslint peer range still stops below TypeScript 6.1, so the TypeScript 6 API alias stays.
  Evidence: the npm registry and GitHub releases listed in RESEARCH.md, github.com/violentmonkey/violentmonkey/releases, `package.json`, `.node-version`, `tests/smoke/userscript-manager-lifecycle.smoke.mjs:49-51`.
  Touches: `package.json`, `package-lock.json`, `.node-version`, `tests/smoke/userscript-manager-lifecycle.smoke.mjs` (URL, version and pinned hash), any new lint findings.
  Acceptance: Exact pins updated and `npm audit` clean. The manager lane installs a hash-pinned Violentmonkey 2.49.0. `npm run verify:release` passes on the new set. Lint findings from the stricter `new-cap` and `no-unsafe-finally` rules are fixed, not suppressed.
  Complexity: S/M
