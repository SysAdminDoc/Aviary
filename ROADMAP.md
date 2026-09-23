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

### P0

- [ ] P0, F337: Start Delete X activity with no category selected
  Why: A fresh profile opens the page with all five categories on, so one Run click permanently deletes posts and replies. The page's own copy says "Select activity and press Run."
  Evidence: `src/features/account-cleanup/state.ts:235-239` and `:248` (a missing value normalizes to true), `src/ui/control-center.ts:740-742`, baseline `tests/visual/baselines/settings/control-center-account-dark-1440x900.png`. Every cleanup tool reviewed makes the user choose scope (Cyd, CleanMyX, Redact).
  Touches: `src/features/account-cleanup/state.ts`, `src/ui/control-center.ts`, `src/ui/control-center/sections/account.ts`, `tests/account-cleanup.test.mjs`, `tests/account-cleanup-dom.test.mjs`, account-page visual baselines, catalog strings for the disabled-Run hint.
  Acceptance: A new profile shows zero categories checked and a disabled Run with a one-line reason. Checking any category enables Run. A stored run keeps its explicit plan across reload, and a stored run missing a category key doesn't gain that category. No preview, phrase or confirmation step is added. A test pins the all-false default.
  Complexity: S

- [ ] P0, F338: Refresh the DOM observation before the 2026-09-30 waiver lapses
  Why: From 2026-10-01 local time preflight fails, which takes `verify:fast`, `verify:release` and `release:local` down with it. The schema also predates the separate 600px stream lane the 2026-09-21 signed-in pass found. This promotes Roadmap_Blocked F237 and folds in the F134 and F201 measurements, because signed-in sessions demonstrably ran on 2026-09-20 and 2026-09-21.
  Evidence: `_decoded/dom-schema.json` (`capturedOn` 2026-05-19, `acknowledgedStaleUntil` 2026-09-30), `tools/capture-manifest.mjs:121-129`, `tools/preflight.mjs:373-381`, `CHANGELOG.md` 1.52.0 "Signed-in checks covered Home, Search, Profile…".
  Touches: `_decoded/dom-schema.json` (`derivedFrom`, `layout`, `routes`), `tools/fixture-generator.mjs` if the stream-lane nesting needs a generated equivalent, the dated measurements in `Roadmap_Blocked.md`, `tests/fixtures.test.mjs`. The 2026-09-20 cleanup test ran in a hidden tab sharing the signed-in session, so this doesn't need the owner's visible browser. The MHTML save is the only step that does, and F343 removes it.
  Also settle in the same session: which user shape X serves (F366), whether the Following tab carries a sort control (F367), and the Media page's "Playlists rewritten" counter on an open video post (the video-quality item in `Roadmap_Blocked.md`).
  Acceptance: `npm run preflight` passes without a staleness warning on and after 2026-10-01. `capturedOn` is 2026-09-22 or later. `layout` records the inner stream lane. Every "measured: N hits" claim in `Roadmap_Blocked.md` carries the new date, including those that stay blocked. No decoded page remains in `_decoded/`. If no capture happens by 2026-09-30, the fallback is a new dated `acknowledgedStaleUntil` whose reason names the miss.
  Complexity: M (S once F343 lands)

### P1

- [ ] P1, F366: Read author handles and names from X's current `core` user shape
  Why: X moved post author fields out of the user's `legacy` object into `core`. Both passive parsers still read `result.legacy`, or fields `result` itself doesn't carry, so bookmarks and captured posts can silently lose handles and display names. Status: Likely. The parser gap is verified. X's shape change is Cyd's capture-backed report and should be confirmed in the F338 session.
  Evidence: lockdown-systems/cyd issue #707 (2026-09-14, "Post author fields moved out of the legacy sub-object into the core sub-object"). `src/features/library/bookmark-capture.ts:93-98` returns `result.legacy` first. `src/features/export/thread-capture.ts:75-77,134-139` never reads `result.core`. Every fixture uses the old shape (`tests/bookmark-capture.test.mjs:75,118`, `tests/thread-capture.test.mjs:32`, `tests/export-language.test.mjs:50`).
  Touches: `bookmark-capture.ts`, `thread-capture.ts`, any other reader of GraphQL user objects, those four test files plus a new fixture in the current shape.
  Acceptance: Both parsers take `screen_name` and `name` from `result.core` when present and fall back to `legacy`. A fixture with only `core` fields yields the right handle, display name and permalink. Old-shape fixtures still pass. The F338 session records which shape X serves on 2026-09-22 or later.
  Complexity: S

- [ ] P1, F340: Escape every PowerShell quote character in the copied yt-dlp command
  Why: PowerShell ends a single-quoted string at U+2018 to U+201B as well as ASCII `'`. A filename template that uses `{text}` puts post text inside that argument, and the user pastes the result into a terminal.
  Evidence: `src/features/media/yt-dlp-helper.ts:233-235` doubles only ASCII `'`. `src/features/media/media-buttons.ts:866-886` renders the template into `--output`. `src/features/media/template.ts:12` doesn't strip typographic quotes. `tests/yt-dlp-helper.test.mjs:39-46` covers ASCII only.
  Touches: `src/features/media/yt-dlp-helper.ts`, `tests/yt-dlp-helper.test.mjs`.
  Acceptance: A test builds the command from text containing `‘ ’ ‚ ‛ ' $ & ; ^` and a backtick. It asserts every quote variant is doubled, and when `pwsh` is available it parses the string with `[System.Management.Automation.Language.Parser]::ParseInput` into one command with the expected literal arguments. Output for the default template is byte-identical to the v1.52.2 output.
  Complexity: S

- [ ] P1, F341: Raise the Chromium floor to 111
  Why: The manifest `content_scripts[].world` key arrived in Chrome 111. On 102 to 110 `page.js` runs in the isolated world, so promoted-logging refusal and video-variant discovery silently stop while the docs claim support. That range isn't empty: Chrome 109 was the last release for Windows 7 and 8.1. Archive import's `DecompressionStream("deflate-raw")` also needs 103. An honest floor beats a silent downgrade.
  Evidence: MDN browser-compat-data `webextensions/manifest/content_scripts.json` (`world`: Chrome 111, Firefox 128). `src/extension/browser-floors.ts` header ("available at 102"). `src/extension/manifest.chrome.json` `minimum_chrome_version: "102"`. `src/features/export/zip-reader.ts:212`.
  Touches: `src/extension/browser-floors.ts`, `src/extension/manifest.chrome.json`, `tests/browser-floors.test.mjs`, `README.md` compatibility line, `docs/INSTALL.md`, the `docs-facts` blocks.
  Acceptance: `CHROME_FLOOR` and `minimum_chrome_version` are 111. The floor comment cites the compat-data value. README and INSTALL say Chromium 111+. `PLATFORM_FEATURE_FLOORS.underFloor` is recomputed. Preflight's manifest/floor agreement check passes.
  Complexity: S

- [ ] P1, F339: State on the Delete X activity page that deleted posts can't be restored
  Why: X's automation rules say bulk-delete apps "must also clearly state that posts are not recoverable once deleted". The page says only "Deletion starts immediately."
  Evidence: help.x.com X automation rules (Wayback 2026-08-03). `src/ui/control-center/sections/account.ts` contains no restore or recovery copy. `README.md:114` has it.
  Touches: `src/ui/control-center/sections/account.ts`, `src/platform/i18n-catalog.ts` plus locale sync through `tools/i18n-sync.mjs`, `docs/FEATURES.md`, account-page visual baselines.
  Acceptance: Near Run, in idle and running states, the page permanently says that deleted posts and replies can't be restored and that Aviary can't undo removed likes, reposts or bookmarks. It's translated in all nine locales. It's plain page text, not a dialog. A DOM test asserts it in both states.
  Complexity: S

- [ ] P1, F344: Fix stale install links and gate release links as version markers
  Why: The install guide sends users to v1.49.5 under a 1.52.2 heading. Chrome 138+ also gates userscript managers behind a per-extension "Allow User Scripts" toggle that no doc mentions.
  Evidence: `docs/INSTALL.md:6,74,194`. `tools/version-markers.mjs` declares no release-link marker. Chrome's userscript-manager guidance (developer.chrome.com/blog/chrome-userscript). `docs/FAQ.md:213` still says XLSX arrived "in 1.16.0".
  Touches: `docs/INSTALL.md`, `README.md` install table, `docs/FAQ.md`, `tools/version-markers.mjs`, `tests/version-markers.test.mjs`.
  Acceptance: Every `releases/tag/v…` and `releases/download/v…` link in README and INSTALL names the package version, and a new marker fails when one doesn't. The userscript install row and INSTALL explain the Allow User Scripts toggle for Chrome 138+. The FAQ answer no longer names an old version.
  Complexity: S

- [ ] P1, F345: Stop clipping Control Center help text
  Why: Every row description is clamped to two lines with no way to expand it. Most of the filter-rule grammar (operators, `dim:`, titles, expiry and the example) is invisible.
  Evidence: `src/ui/control-center.ts:3837-3845`, `src/ui/control-center/sections/reading.ts:551`, baseline `tests/visual/baselines/settings/control-center-filtering-dark-1440x900.png` (cut at "operators..." and "replacin...").
  Touches: `src/ui/control-center.ts` stylesheet, `src/ui/control-center/sections/reading.ts` (a visible rule-syntax reference), a clipping sweep in `tests/a11y-behaviour.test.mjs`, affected baselines.
  Acceptance: A sweep over every `section-manifest.ts` destination at 1440 and 768 px finds no `.av-row-description` whose `scrollHeight` exceeds `clientHeight` unless the row has an expand control. The full grammar and example are readable in place. A positive control that restores the clamp makes the sweep fail.
  Complexity: S/M

- [ ] P1, F343: Add a text-free "Copy structural observation" diagnostics action
  Why: As of v1.52.2, refreshing the schema needs a signed-in MHTML save, a decode, measurement and deletion of a private page, which is why it lapses. Selector health already knows every surface Aviary depends on.
  Evidence: the "Refreshing the DOM observation" procedure in the repo notes, `tools/capture-decode.mjs`, selector-health copy limited to build, route, anchors and feature ids (F299), and the `dom-schema.json` fields (`testIds`, `roles`, `aria`, `nesting`, `observedCounts`, `layout`).
  Touches: selector-health and diagnostics modules under `src/features/core/`, `src/ui/control-center/sections/advanced.ts` (Privacy & diagnostics), a schema-shape module shared with `tools/fixture-generator.mjs`, new tests.
  Acceptance: On the generated Home and status documents the action emits JSON that `tools/capture-manifest.mjs` accepts and that reproduces the committed schema's counts. A hostile fixture seeded with a handle, display name, post text, URL and status id proves none of them reach the output. Nothing is written to disk, and the labels are translated.
  Complexity: M

- [ ] P1, F342: Verify and ship flag-based reversion of the carousel and profile media tab
  Why: The carousel and the profile media-tab change are the most requested fixes in this category. Control Panel for Twitter has reverted both in production since 2026-08-17 by wrapping `featureSwitches.isTrue`. Aviary's F115 and F139 are blocked only on first-hand verification, which the F338 session supplies.
  Evidence: CPFT v4.24.0 release notes and `script.js`; the UTDDavid uBO list; Swakshan/X-Flags daily flag diffs; CPFT issues #906, #907, #922 to #928 and #942; `Roadmap_Blocked.md` F115 and F139.
  Touches: `src/page/page-agent.ts` (install the hook before X's first read), a flag data file as Roadmap_Blocked requires, `src/platform/settings.ts` plus the normalizer, selector health for drift, the Look & feel section, tests.
  Acceptance: In a signed-in session, forcing `rweb_media_carousel_enabled` and `responsive_web_profile_redesign_enabled` off before first read restores the multi-image grid and the profile media grid. Each flag has its own toggle, off by default. Flag names live in a data file. A flag that vanishes reports through selector health. `rweb_age_assurance_flow_enabled` is refused, and a test pins its absence from the data file. Depends on F338's session.
  Complexity: M

### P2

- [ ] P2, F347: Match cleanup targets by exact status id
  Why: The lookup uses a substring selector, so it can return an article that quotes the target or an id with the same prefix. That's harmless while every category deletes everything, and unsafe once F348 keeps some posts.
  Evidence: `src/features/account-cleanup/dom.ts:237-240`, `getPrimaryAccountCleanupStatus` at `dom.ts:71-80`.
  Touches: `src/features/account-cleanup/dom.ts`, `tests/account-cleanup-dom.test.mjs`.
  Acceptance: The lookup returns only the article whose primary status equals the id. Fixtures with a quote of the target rendered above it, and with a prefix-sharing id, both select the right article.
  Complexity: S

- [ ] P2, F346: Bound stale cleanup retries and cover the untested runner paths
  Why: A target that keeps returning `stale` loops forever at pacing speed. Several runner paths have no test. `docs/FEATURES.md` says an account change blocks the run, but a missing handle mid-run doesn't.
  Evidence: `src/features/account-cleanup/runner.ts:476,533,582` and `:459-460`, `docs/FEATURES.md:478-479`, `tests/account-cleanup.test.mjs:322` (pre-scan account change only). `account-cleanup-feature.ts` has no test.
  Touches: `src/features/account-cleanup/runner.ts`, `account-cleanup-feature.ts`, `tests/account-cleanup.test.mjs`, `docs/FEATURES.md`.
  Acceptance: Three consecutive `stale` outcomes for one id count as a failure and enter the existing recovery path. A handle that stays absent for a bounded wait blocks as `login_required`. Tests cover challenge detection mid-scan, a handle change mid-scan, `skipped`, `stale`, lease loss and controller auto-resume. FEATURES matches the code.
  Complexity: M

- [ ] P2, F351: Translate Delete X activity progress and catch runtime messages in the i18n gate
  Why: Eight locales see English progress for the one destructive feature. The extractor harvests `ctx.t` literals and `label:` lines, so runtime status prose passes the 100% coverage gate.
  Evidence: `src/features/account-cleanup/account-cleanup-feature.ts:205-214`, `runner.ts:393-724`, `src/ui/control-center/sections/account.ts:148,242-247`, `tools/i18n-extract.mjs`.
  Touches: the runner and controller (message ids with values instead of prose), `src/platform/i18n-catalog.ts` and locales, `sections/account.ts`, `tools/i18n-extract.mjs`, `tests/i18n.test.mjs`.
  Acceptance: Every cleanup phase renders translated in all nine locales, driven under `he` and `ja` in a test. A source contract fails when a new status string bypasses the catalog.
  Complexity: M

- [ ] P2, F354: Keep structural filter predicates out of quoted posts
  Why: Hide rules wrap selectors in one `:has()` over the whole article, so a badge or media inside a quoted post likely hides the outer post. The reply-media filter explicitly excludes quotes, so the two disagree. Status: Likely, test first.
  Evidence: `src/features/filtering/filter-engine.ts:522`, `STRUCTURAL_SELECTORS` in `src/features/filtering/predicates.ts`, `src/features/filtering/reply-media.ts`, the quote boundary declared in `src/features/media/extract.ts`.
  Touches: `filter-engine.ts`, `predicates.ts`, filter-engine tests.
  Acceptance: First, a fixture where an unverified, text-only post quotes a verified post carrying video, and `media is video` or the premium rule hides the outer post. Then selectors exclude the quote boundary and the fixture passes. Existing filter tests stay green.
  Complexity: S/M

- [ ] P2, F358: Replace the English-only media layout hook
  Why: Grid and stacked layouts engage only when X's aria-label reads the English "Image", and X moved multi-image posts to a carousel. Media Archivist and Creator presets set this layout.
  Evidence: `src/features/media/media-presentation.ts:102`, `Roadmap_Blocked.md` F139, `src/ui/control-center/sections/presets.ts`.
  Touches: `media-presentation.ts`, media-presentation tests, `tests/settings-claims.test.mjs`.
  Acceptance: The rule matches through test ids from `STRUCTURAL_SELECTORS`, proven on the generated Home document with `lang="ja"`. If the post-F338 carousel has no grid container, selector health reports the setting as unavailable instead of claiming an effect.
  Complexity: S/M

- [ ] P2, F368: Export bookmarks as Netscape bookmark HTML and Raindrop CSV
  Why: Karakeep, Linkwarden, linkding, Shaarli and every browser import Netscape bookmark HTML, and Raindrop imports a fixed CSV. None of them import X directly. Aviary's bookmark exports don't produce either format, so leaving X for a self-hosted tool takes a conversion script. Omnivore's shutdown showed users value a one-click full export more than an open-source label.
  Evidence: docs.karakeep.app import page, docs.linkwarden.app, help.raindrop.io/import (`url,folder,title,note,tags,created`), github.com/omnivore-app/omnivore. No `NETSCAPE-Bookmark` string anywhere in `src/`.
  Touches: `src/features/export/` (two formatters that reuse `text-safety.ts`), the Import & export section, `docs/FEATURES.md`, export tests.
  Acceptance: The Netscape file carries each bookmark's permalink, title from post text, `ADD_DATE` and tags, and imports cleanly into a browser in a smoke test. The Raindrop CSV uses the documented columns with notes and tags mapped. Both go through `safeExternalHref` and the shared escaping rules, and a hostile-text fixture proves it.
  Complexity: S

- [ ] P2, F367: Pin the Following tab to Recent when Following is forced
  Why: Since February 2026 the web Following tab defaults to a ranked "Popular" view with a Recent toggle. Aviary's force-Following selects the tab but can't choose the sort, so readers who asked for chronological order still get ranking. Control Panel for Twitter ships a Following sort, and a userscript to force Recent appeared on 2026-08-14.
  Evidence: piunikaweb.com 2026-02-15 (Following not chronological), reddit.com/r/userscripts (2026-08-14 "Sort By Recent"), CPFT feature list. `src/` has no "Recent" or "Popular" handling. The toggle's markup isn't in `_decoded/dom-schema.json`, so this depends on F338.
  Touches: the force-Following feature under `src/features/layout/`, `src/platform/selectors.ts`, the Reading section, catalog strings, tests on the refreshed schema.
  Acceptance: With force-Following on, Aviary selects Recent through X's own control, never by editing X's request, and doesn't override a reader who then picks Popular themselves. A missing control reports through selector health. It's verified in the F338 session.
  Complexity: M

- [ ] P2, F352: Make the Anthropic provider work from x.com, or say where it can't
  Why: Anthropic rejects browser-origin requests unless they carry `anthropic-dangerous-direct-browser-access: true`. The userscript's page-context fetch also meets x.com's `connect-src`.
  Evidence: `src/features/integrations/ai-provider.ts:103-117`, simonwillison.net 2024-08-23, ThunderClaude issue #1, x.com CSP headers (Wayback 2026-08-22).
  Touches: `ai-provider.ts`, the provider tests, the integrations section copy, `docs/PRIVACY.md`.
  Acceptance: The Anthropic request sends the header, asserted in a test. The userscript build either routes providers through the manager's request API or the Connections page states that providers are extension-only there. A dated live check per provider is recorded in CHANGELOG.
  Complexity: S/M

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

- [ ] P3, F365: Show whether a post's images carry alt text, and let filters use it
  Why: Blind and low-vision readers are moving from X's apps to the web. No maintained X alt-text tool exists: Alt or Not stopped in 2022, and Greasy Fork's only script has 43 installs. Aviary already keeps alt text in its exports.
  Evidence: applevis.com forum thread (2026-07-29), abitofaccess.com/alt-or-not, the Greasy Fork alt-text search, bluesky-social/social-app issue #4155. X's alt marker isn't in `_decoded/dom-schema.json`, so this depends on F338.
  Touches: `src/features/media/`, a new `alt` field in `src/features/filtering/rules.ts`, the Reading section, catalog strings, tests on the refreshed schema.
  Acceptance: An opt-in badge states "No description" on images X serves without alt text, as a labelled element screen readers announce. `media is photo and alt is missing` works as a rule. The marker comes from the refreshed capture, not from X's localized default alt string alone.
  Complexity: M

- [ ] P3, F369: Add Simplified Chinese
  Why: Chinese-language reviews dominate the feedback on the most-installed X media userscript, and Control Panel for Twitter ships `zh_CN`. Aviary's nine locales don't include Chinese, although cleanup's delete-label list already does.
  Evidence: greasyfork.org/en/scripts/528890/feedback, the CPFT `_locales` directory, `src/platform/i18n-runtime.ts` (`LocaleCode`), `src/features/account-cleanup/dom.ts:29-53`.
  Touches: `src/platform/i18n-runtime.ts`, `src/platform/i18n.ts` (its duplicated locale table), the catalog, native `_locales` generation in `tools/build.mjs`, `tests/i18n.test.mjs`.
  Acceptance: `zh-CN` covers every catalog string and every native message, and the locale gate passes. The duplicated tables in `i18n-runtime.ts` and `i18n.ts` become one. Bundle budgets hold, so this depends on F357.
  Complexity: M

- [ ] P3, F360: Refresh pinned development dependencies
  Why: eslint 10.11.0, typescript-eslint 8.70.1, Playwright 1.63.0 (Chromium 153, Firefox 155), globals 17.12.0 and Node 24.21.0 are out. Violentmonkey's stable is 2.49.0 (2026-09-06), with an MV3 execution-order fix, while the manager lane still installs 2.47.0. Tampermonkey 5.5.0 is still the current stable. The typescript-eslint peer range still stops below TypeScript 6.1, so the TypeScript 6 API alias stays.
  Evidence: the npm registry and GitHub releases listed in RESEARCH.md, github.com/violentmonkey/violentmonkey/releases, `package.json`, `.node-version`, `tests/smoke/userscript-manager-lifecycle.smoke.mjs:49-51`.
  Touches: `package.json`, `package-lock.json`, `.node-version`, `tests/smoke/userscript-manager-lifecycle.smoke.mjs` (URL, version and pinned hash), any new lint findings.
  Acceptance: Exact pins updated and `npm audit` clean. The manager lane installs a hash-pinned Violentmonkey 2.49.0. `npm run verify:release` passes on the new set. Lint findings from the stricter `new-cap` and `no-unsafe-finally` rules are fixed, not suppressed.
  Complexity: S/M
