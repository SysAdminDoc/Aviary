# Research: Aviary
Date: 2026-09-22. Replaces all prior research.

## Executive Summary

Aviary v1.52.2 is a local-first X enhancer shipped from one TypeScript tree as a readable
userscript and Chromium and Firefox MV3 packages. Reading controls, ad removal and media downloads
all live in one Control Center, alongside a searchable local library, preservation exports and
account cleanup. It's in its strongest shape yet. The storage, download and backup defects the
2026-09-06 pass found are closed (F276 to F336 in `CHANGELOG.md`). The 2026-09-21 wide-layout pass
was checked against a signed-in account. `npm test` ran 1,209 tests on 2026-09-22, and all 12
failures reproduced as machine contention: the three affected files passed 20 of 20 when run
serially.

The weak spot has moved. It's no longer storage. It's the newest destructive feature, Delete X
activity, and the build's own evidence clock. One click on a fresh install deletes everything, and
the DOM observation that every selector claim rests on stops satisfying preflight on 2026-10-01.
The highest-value direction is to make cleanup safe by default without adding the confirmation
dialog the owner removed, refresh the observation while a signed-in session is available, then
use that same session to ship the flag-based layout reversion that the biggest competitor already
proves works.

Priority order:

1. **F337, cleanup starts with nothing selected.** `defaultAccountCleanupCategories()` turns on
   all five categories, so Run on a new profile deletes posts and replies permanently.
2. **F338, refresh the DOM observation before 2026-09-30.** After that, `verify:fast`, the release
   gate and `release:local` all fail at preflight. Signed-in sessions ran on 2026-09-20 and
   2026-09-21, so Roadmap_Blocked's "nothing here can be fixed from this machine" no longer holds.
3. **F339, say on the page that deleted posts can't be restored.** X's automation rules require
   exactly that of bulk-delete tools, and the page never says it.
4. **F366, read author handles from X's current `core` user shape.** Cyd's captures show X moved
   author fields out of `legacy`, and both of Aviary's passive parsers only look there.
5. **F340, escape every PowerShell quote in the copied yt-dlp command.** Typographic quotes in post
   text can break out of the quoted filename when a template uses `{text}`.
6. **F341, raise the Chromium floor to 111.** The manifest's `world: "MAIN"` key doesn't exist
   before Chrome 111, so on 102 to 110 the page agent runs in the wrong world while the docs
   claim support.
7. **F342, verify and ship flag-based reversion of the carousel and profile media tab.** Control
   Panel for Twitter (300,000 Chrome users) has done it since 2026-08-17 by wrapping
   `featureSwitches.isTrue`. It's the most requested fix in the category.
8. **F343, a text-free "copy structural observation" action,** so the next refresh is a click and
   no private page ever touches disk.
9. **F344 and F345, docs and panel copy that users can actually read.** Install links still point
   at v1.49.5, and the filter-rule grammar is clipped to two lines.

## Product Map

- **Core workflows.**
  - Read a quieter X: Noir and Wide are the install defaults since 1.52.0, with filters, hidden
    posts, seen-post dimming, a reading marker, Catch up, Back restoration and long-post
    expansion.
  - Save media from a post, individually or in a batch, with a queue, history and quality
    receipts.
  - Keep a local library: bookmarks with notes, captured posts, search, and exports to JSON, CSV,
    Markdown, HTML, XLSX, a static site, ActivityStreams, WARC and WACZ. X archive and Scrollmark
    imports sit alongside.
  - Delete account activity: bookmarks, likes, reposts, replies and posts, by driving X's own
    controls in the signed-in tab.
  - Sources: `src/ui/control-center/section-manifest.ts`, `src/features/`, `docs/FEATURES.md`.
- **Personas.** Daily readers who want less noise, media collectors, researchers keeping
  searchable records, and people cleaning up or leaving the account. This is an interpretation of
  the shipped presets (Quiet Reader, Media Archivist, Creator, Researcher), not survey data.
- **Platforms and distribution.** Chromium 102+ and Firefox 140+ by declaration (F341 corrects the
  Chromium number). Sideloaded ZIPs, plus a userscript that self-updates from raw GitHub. There's no
  store listing, and the Firefox build is a temporary add-on with the placeholder id
  `aviary@example.local`. Sources: `src/extension/manifest.*.json`, `README.md`, `docs/INSTALL.md`.
- **Data flows.** A MAIN-world page agent passively observes GraphQL responses X already requested
  and hands bounded metadata to the isolated world through a nonce-checked MessagePort
  (`src/page/page-agent.ts`, `src/platform/page-bridge.ts`). Durable data lives in
  background-owned IndexedDB or userscript-manager storage (`src/platform/durable-storage.ts`).
  Outbound traffic is off until a policy is installed (`src/features/integrations/network-policy.ts`).
  The optional flows are media fetches, an AI provider, webhooks, Mastodon crossposting and a
  loopback yt-dlp helper.

## Competitive Landscape

**Control Panel for Twitter** is the category leader: 300,000 Chrome users, 54,029 on AMO, and
v4.24.2 released 2026-09-22.
- **Learn:**
  - It reverts X's carousel, profile redesign and native emoji by forcing four `featureSwitches`
    flags off at runtime (v4.24.0, 2026-08-17). That's field evidence for F342.
  - It hides Premium replies with exceptions for accounts you follow, and adds "Add muted word" to
    the post menu.
  - Its `v5` branch is moving "mute words anywhere" behind a paid Pro account, so the free
    alternative gets more valuable.
- **Avoid:** its `rweb_age_assurance_flow_enabled` override, `bypassAgeVerification` on by default,
  and `fastBlock`. Its separate-retweets tab kept loading posts until an account was locked (#931).

**OldTwitter** is a replacement client at 1.9.8.1 (2026-08-11) with 80,000 users.
- **Learn:** per-user auto-translate, and "why is this in my timeline" labels.
- **Avoid:** its own API calls, which draw restriction reports (#1332).

**Minimal Theme for X (Typefully)** and **Calm Twitter** show that width and declutter alone keep
50,000 users.
- **Learn:** Writer Mode, and hiding the floating Chat launcher.
- **Avoid:** Minimal's changelog gap (#222). Aviary's dated CHANGELOG is already better.

**BetterX (Greasy Fork)** is the closest feature match: seen-post capture with search, starred and
pinned posts, keyword highlighting, and deleted-post detection (v3.6.0, 2026-09-22).
- **Learn:** deleted-post detection fits Aviary's seen history. It's under consideration below.
- **Avoid:** its age-gate bypass.

**X-Posed and Country Filter for X** filter by X's "Account based in" data.
- **Learn:** Country Filter reads X's own metadata without making requests and never hides
  followed accounts.
- **Avoid:** X-Posed copies authorization headers, calls AboutAccountQuery itself and feeds a
  shared cache. AMO reviews report bans on 2026-07-29, 08-26 and 09-04.

**Grok, AI-reply and Premium hiders** (Grok Be Gone, noGrok, X AI Reply Hider, Hide Verified Users,
Blue Blocker) show demand for hiding Grok and Premium content. Aviary's rules already express
`handle is grok`, but only for readers who know the syntax. F361 makes it a toggle.
- **Avoid:** Blue Blocker's auto-block, which was followed by automation suspensions (#434), and
  paid tiers that send reply text to a server.

**uBlock Origin and AdGuard lists** (UTDDavid, uAssets annoyances, AdGuard annoyances) plus
**Swakshan/X-Flags**, which diffs X's web flags daily. A flag name can change on any given day,
which is why F342 keeps flag names in data and reports drift.

**TwitterMediaHarvest** (v4.5.7, 2026-06-18).
- **Learn:** bound every capture cache (#328), check for extensions that overwrite filenames (#368).
- **Avoid:** its Likes-tab state bug after the move to History (#355).

**twitter-web-exporter** (v1.4.3, 2026-08-31).
- **Learn:** property-path filename patterns and byte-aware truncation (v1.4.1), and its
  no-automation policy (#120).
- **Avoid:** in-memory ZIPs that fail above roughly 500 to 1,000 media (#137).

**Scrollmark** (v1.5.0, 2026-08-25) keeps a canonical SQLite archive in a local companion.
- **Learn:** zero-friction pairing. Its #4 complains that pairing is too hard.

**gallery-dl and yt-dlp** keep repairing X's request-signing header (gallery-dl 1.32.10 to 1.32.13;
yt-dlp #17105, where maintainers declined to forge `X-Client-Transaction-ID`). Aviary's passive
capture never needs that header. That's a durable advantage worth keeping.

**Cyd** is open-source, local and desktop (v1.2.4, 2026-09-22). It's the closest cleanup analogue.
- **Learn:**
  - It filters posts by age and by maximum likes or reposts.
  - It imports the archive, saves an HTML archive before deleting, and counts what isn't archived
    yet.
  - Its request log records method, URL and status only.
- **Avoid:** it sends X's delete mutations directly, and users report suspensions (#641, #668). It
  also silently indexed zero tweets when routes moved to `/i/history` (#693).

**tweetXer, Redact, CleanMyX, TweetDelete and TweetDeleter** make up the commercial and script
cleanup field.
- **Learn:**
  - Date filters are nearly universal.
  - "Keep if over N likes" appears in five tools.
  - CleanMyX's 10-item test run is a preview without a dialog. Aviary's batch limit under Advanced
    options already allows that.
- **Avoid:** TweetDelete and TweetDeleter both carry flagged Trustpilot pages with billing and
  incomplete-deletion complaints.

**Adjacent tools worth borrowing from.**
- **Leaving X, and self-hosting:**
  - Sky Follower Bridge reads X's Following and Followers pages to rebuild a graph on Bluesky.
  - Porto imports an extracted X archive into Bluesky by date range. ianklatzco's importer
    documents that Bluesky shows `indexedAt`, not the original date, so posting on someone's
    behalf spams followers.
  - Karakeep, Linkwarden and Raindrop import Netscape HTML or a fixed CSV, never X directly.
    That's F368.
- **Shared lists:** SponsorBlock's downloadable database, the uBlock Shorts list people subscribe
  to by raw URL (1,172 points on HN), and Bluesky's stackable moderation (one action per
  subscribed list) all suggest a shape for shared Aviary rule files. Subscribable lists stay under
  consideration.
- **Explaining filters:** Bouncer's "why each post was filtered" chip matches the reason strip
  Aviary already shows under `filter.showReason`.

**Community signal, 2026-06 to 2026-09-22.** Reddit came through the Arctic Shift archive, because
reddit.com blocked fetches, so scores are snapshots.
- **The media grid is the loudest complaint.**
  - The carousel post scored 61/17 on 2026-08-11. A grid-restoring extension scored 124/55 on
    2026-08-14.
  - x-media-grid-restore sets the same two flags before X's app starts, which is independent
    confirmation for F342.
  - A roughly 12,000-install Greasy Fork downloader lost its buttons on image pages on 2026-09-03.
- **Following became ranked.** It defaults to "Popular" since February 2026 (F367).
- **Bots, spam replies and Grok.** X removed 42,000 chatbot reply accounts, with visible false
  positives. People trade bot-phrase lists to mute, which feeds the case for shared rule files.
- **Likes, bookmarks and leaving.**
  - Likes moved into History, and users report "everything before May this year has no likes".
  - The how-to-quit and archive-first advice is widely shared (2,530 upvotes on r/BlueskySocial,
    184 likes on Bluesky).
- **Deletion pain.** Users report multi-hour runs that leave 100 to 157 items behind, which is
  F350's case.
- **X's legal posture hardened against hosted tools.**
  - Nitter received a cease-and-desist on 2026-08-24 (HN, 1,214 points).
  - XCancel went dark again on 2026-09-15.
  - twitterwebviewer.com shut down at X's request on 2026-08-28.
  - Aviary's no-server, no-own-requests boundary is the right place to stand.
- **Accessibility.**
  - An AppleVis thread (2026-07-29) has blind users leaving X's app for the web because VoiceOver
    can't hold focus on posts. That makes Aviary's forced Following, deduplication and ad removal
    accessibility features.
  - No maintained X alt-text tool exists: Alt or Not stopped in 2022, and Greasy Fork's only
    script has 43 installs. That's F365.
- **Language demand.** Chinese-language reviews dominate the feedback on the most-installed X media
  downloader userscript. Control Panel for Twitter ships `zh_CN`, and Aviary's nine locales don't
  include Chinese. That's F369.

The pattern that matters most: in June to September 2026, lock and suspension reports cluster on
tools that make their own requests or act in bulk (OldTwitter, X-Posed, Blue Blocker, Cyd, tweetXer,
CPFT #931). Passive DOM tools don't show up in them. Aviary's refusal list is right. Account cleanup
is the one Aviary feature that sits on the risky side of that line. That's why F339 and F346 to
F350 treat it with more care than a reading aid.

## Reported Issues

The tracker was re-checked on 2026-09-22: issues enabled, zero open or closed issues, zero pull
requests, discussions disabled, and the repository isn't a fork. There's no public report to
prioritize, so this pass ranks defects found in code, in tests, and in peer trackers.
[Issues](https://github.com/SysAdminDoc/Aviary/issues), [pull requests](https://github.com/SysAdminDoc/Aviary/pulls).

Defects found locally (Verified by reading the code unless noted):

- **One-click full deletion.** `src/features/account-cleanup/state.ts:235-239` returns all five
  categories as true. `normalizeAccountCleanupSettings` treats a missing value as true (`:248`),
  and `src/ui/control-center.ts:740-742` seeds the page from that default. The committed baseline
  `tests/visual/baselines/settings/control-center-account-dark-1440x900.png` shows all five ticked
  beside Run. F337.
- **No irreversibility statement on the page.** `src/ui/control-center/sections/account.ts` has no
  "restore", "recover" or "permanent" copy. Only `README.md:114` says it. F339.
- **Copied command injection (Verified at parse level by the internal scan, not executed).**
  - `quotePowerShell` doubles only ASCII `'` (`src/features/media/yt-dlp-helper.ts:233-235`).
  - `helperRequest` renders the user's filename template, including `{text}`, into that argument
    (`src/features/media/media-buttons.ts:866-886`).
  - `sanitizeSegment` strips `<>:"/\|?*` and control characters only
    (`src/features/media/template.ts:12,53-55`).
  - PowerShell treats U+2018 to U+201B as single quotes. The default template
    `{handle}_{tweetId}_{index}` is safe. F340.
- **Author fields in the old shape only (Likely).**
  - Cyd #707 (2026-09-14) reports, from its own captures, that X moved post author fields from the
    user's `legacy` object into `core`.
  - `bookmark-capture.ts:93-98` returns `user_results.result.legacy` first.
    `thread-capture.ts:75-77,134-139` reads `result` and `result.legacy` but never `result.core`.
  - Every fixture uses the old shape (`tests/bookmark-capture.test.mjs:75,118`,
    `tests/thread-capture.test.mjs:32`).
  - If X serves the new shape, captured bookmarks and posts lose handles and names without an
    error. F366.
- **Untranslated cleanup status.** "Deletion complete.", "Deletion paused." and "Deletion is
  running." are literals in `account-cleanup-feature.ts:205-214`, and runner messages in
  `runner.ts:393-724` bypass the catalog. The "1,375 of 1,375 strings" claim is true of the
  catalog, not of what these eight locales see. F351.
- **Unbounded stale retry.** A `stale` outcome continues without a counter
  (`runner.ts:582`). Each retry waits the pacing delay (`runner.ts:533`), and the 60-scan hard stop
  counts scrolls only (`runner.ts:476`). F346.
- **Substring target lookup.** `findAccountCleanupArticleByStatusId` uses
  `a[href*="/status/<id>"]` (`dom.ts:237-240`). It can return an article that links to the target
  (a quote of it) or an id that shares the prefix. Harmless while every category deletes
  everything, but unsafe once F348 adds keep-rules. F347.
- **A mid-run null handle doesn't block** (`runner.ts:459-460`). Only a different non-null handle
  does. `docs/FEATURES.md:478-479` says a changed account blocks the run. F346.
- **Stale install links.** `docs/INSTALL.md:6,74,194` link v1.49.5 under the heading "Install
  Aviary 1.52.2". `tools/version-markers.mjs` doesn't declare release links. F344.
- **Clipped help.** `.av-row-description` is clamped to two lines everywhere
  (`src/ui/control-center.ts:3837-3845`). The filter-rule grammar at
  `sections/reading.ts:551` is cut after "operators..." in the committed filtering baseline. F345.
- **Anthropic provider.**
  - `callAnthropic` doesn't send `anthropic-dangerous-direct-browser-access: true`
    (`src/features/integrations/ai-provider.ts:103-117`). Anthropic rejects browser-origin calls
    without it.
  - The userscript fetches from the page, where x.com's CSP governs `connect-src`.
  - Likely broken, needs live validation. F352.
- **Transient validation feedback.** An out-of-range value gets the footer line "Fix invalid values
  before saving." and a native `reportValidity()` bubble (`src/ui/control-center.ts:1556-1560`).
  The field gets no lasting message or `aria-invalid`, as the committed error-state baseline shows.
  F355.
- **English-only media layout hook.** `html.av-media-layout-grid ... [aria-label="Image"]`
  (`src/features/media/media-presentation.ts:102`) matches English X only, and it predates the
  carousel. F358.

Peer-tracker reports that shape requirements:
- Cyd #693: indexing silently returned zero after the `/i/history` move. Aviary's routes already
  accept `/i/history` and `/i/history/likes` (`state.ts:4-58`).
- CPFT #931: auto-loading led to an account lock.
- TMH #355: Likes state went wrong after History.
- twitter-web-exporter #137: ZIP export fails at scale. Aviary refuses above its measured budget
  (F288) instead.
- tweetXer's README: older Likes may be unreachable. Aviary's live run removed 2,868, so treat
  that as a reporting requirement, F350, not a blocker.

Stale records, not defects:
- `CLAUDE.md:158-161` lists `tests/cross-tab-stores.test.mjs` as failing. It passed on 2026-09-22.
- `Roadmap_Blocked.md:97-115` still describes the `media.sensitive` control, which was removed in
  v1.13.0.
- `docs/FAQ.md:213` says XLSX is supported "in 1.16.0".

## Security, Privacy, and Reliability

- **Deletion safety.** F337, F339, F346, F347 and F349. X's automation rules say scripting the
  site can lead to suspension, that posts may not be liked in an automated manner, and that
  bulk-delete apps "must also clearly state that posts are not recoverable once deleted"
  (help.x.com, Wayback 2026-08-03). Pacing lowers risk, but it isn't a policy exemption. F339 puts
  the required statement on the page.
- **Build clock.** `_decoded/dom-schema.json` records 2026-05-19 with
  `acknowledgedStaleUntil: "2026-09-30"`.
  - `tools/capture-manifest.mjs:121-129` expires the waiver at local midnight on 2026-10-01, and
    `tools/preflight.mjs:373-381` then fails.
  - The schema's `layout` still describes a 600px `primaryColumn` (`dom-schema.json` `layout`),
    while the 2026-09-21 signed-in pass found X nesting its stream in a separate 600px lane inside
    a wider column (`CHANGELOG.md` 1.52.0).
  - The fixture generator is therefore known to disagree with live X on at least one structure.
    F338 and F343.
- **Local helper.**
  - `tools/yt-dlp-helper.mjs` gates jobs on a bearer token, but compares it with a plain string
    check (`:196-199`), reflects any Origin (`:210-215`) and doesn't check Host, which leaves it
    reachable by DNS rebinding if the token leaks.
  - Chrome 142 added a Local Network Access prompt for public-origin requests to loopback, and
    Chrome 145 split out `loopback-network`. The helper `fetch` runs from the x.com content context
    (`src/features/media/yt-dlp-helper.ts:154,188`), and in the userscript it also meets x.com's
    `connect-src`.
  - F353, needs live validation.
- **Verified non-issues.**
  - x.com added `script-src-attr 'none'` between 2026-08-01 and 2026-08-22, but nothing in `src/`
    sets an inline `on*` attribute.
  - `npm audit` on the pinned set reports zero advisories.
  - No `eval`, `Function`, `innerHTML` or `insertAdjacentHTML` in `src/`, and preflight enforces
    the last two.
  - The page-agent handshake is nonce plus MessagePort (`src/page/page-agent.ts:509-560`).
- **Missing guardrails.**
  - No local copy before deletion (F349), and no report of what cleanup couldn't reach (F350).
  - The options page says "Nothing leaves your browser." (`src/extension/options.html:29,107`),
    but `docs/PRIVACY.md` documents optional outbound integrations. F362.
- **Recovery.** Cleanup can't be undone, and that's the whole argument for F349. The library backup
  and profile migration paths are already receipt-based (F278, F334). No new rollback work is
  proposed there.

## Architecture Assessment

- **Budgets are the real constraint on new UI.**
  - On 2026-09-22 the extension panel chunk measured 2,416,860 of 2,430,000 bytes, which is 0.5%
    headroom. `aviary.user.js` measured 2,905,273 of 2,935,000, which is 1.0%.
  - Both existing P2 items (gallery, image card) will breach them.
  - Split the panel chunk by destination first (F357). The userscript can't lazy-load, so its
    budget needs a deliberate decision rather than a quiet bump.
- **Control Center size.**
  - `src/ui/control-center.ts` is 4,601 lines, up from 3,944 on 2026-08-22, and it's the most-changed
    `src/` file in the last 200 commits (40 touches).
  - `sections/data.ts` (2,262) and `sections/advanced.ts` (1,411) follow.
  - The stylesheet and the row builders (`toggleRow`, `textareaRow`, around `:2190-2360`) are
    natural extraction seams, and F357's per-destination split needs them anyway.
- **Floors.**
  - `src/extension/browser-floors.ts` says Chrome 102 supports the manifest MAIN-world key.
    MDN browser-compat-data records Chrome 111 (Firefox 128). F341.
  - Firefox ESR 140 reaches end of life on 2026-10-13, and ESR 153 is current. The module's own
    argument against 153 ("would incorrectly label Firefox 140 unsupported") expires that day. F359.
- **Selectors that can't be localized.** `dom.ts:333,354`, `predicates.ts:69,71` and
  `media-presentation.ts:102` use English aria text as a primary or fallback match. Cleanup's
  delete-label list covers 15 languages and fails closed. The media layout hook fails silently.
  F358.
- **Structural filters see inside quotes.** Hide rules build
  `${UNDECIDED}:has(${selectors})` (`src/features/filtering/filter-engine.ts:522`), which matches a
  badge or media inside a quoted post. `features/filtering/reply-media.ts` explicitly excludes
  quotes, so the two paths disagree. F354, likely, test first.
- **Test gaps.**
  - Fifteen of 172 source files have no test referencing them. The largest is
    `account-cleanup-feature.ts`, 235 lines, which owns auto-resume and the audit.
  - `account-cleanup/runner.ts` (843 lines) and `dom.ts` (463) have one test file each.
  - Untested runner paths: challenge detection, an account change mid-scan, `stale` and `skipped`
    outcomes, and lease loss.
  - Full `npm test` is sensitive to parallel browser lanes on this machine (12 contention
    failures, 20 of 20 serial), the same lesson `test:visual` already encodes with
    `--test-concurrency=1`.
- **Dependencies (npm registry, 2026-09-22).**
  - Behind: eslint 10.8.1 (10.11.0 out), typescript-eslint 8.67.0 (8.70.1), Playwright 1.62.1
    (1.63.0, which bundles Chromium 153 and Firefox 155), globals 17.11.0 (17.12.0), and the Node
    pin 24.18.1 (24.21.0).
  - Current: esbuild 0.28.2, @axe-core/playwright 4.13.0, TypeScript 7.0.2, and the
    `@typescript/typescript6` 6.0.2 alias, which stays because typescript-eslint's peer range still
    stops below 6.1.
  - `npm audit` is clean. The engines floors already match the 2026-07-29 Node security release.
  - The manager lane pins Violentmonkey 2.47.0, while 2.49.0 (2026-09-06) is stable and fixes MV3
    execution order. Tampermonkey 5.5.0 is still the latest stable. F360.
- **Documentation gaps.**
  - Version markers don't cover release links (F344).
  - `{date}` in filenames is the download date, not the post date (`media-buttons.ts:877`,
    `batch-downloader.ts:295,403`), and `docs/FEATURES.md:284` doesn't say which (F364).
  - `integrations.mastodon.visibility` is read (`src/features/integrations/crosspost.ts:239`) but
    can't be set from the panel (F363).

### Category decisions

- **Security:** F340, F352, F353, F356.
- **Accessibility:** F345, F355 and F365, beyond the existing axe, forced-colors and WCAG 2.2
  sweeps (F286, F312, F313).
- **i18n:** F351, F358 and F369. Ad labels in X UI languages beyond Aviary's nine locales stay
  blocked on evidence (F132).
- **Data correctness:** F366.
- **Migration off X:** F368. Follow-graph export for people leaving (Sky Follower Bridge's use
  case) is under consideration below.
- **Observability:** F343 turns selector health into a refresh tool.
- **Testing:** F346 and F354.
- **Docs:** F344, F362, F364.
- **Distribution and upgrade:** F341, F356, F359. F125 still needs an owner decision, but the
  research narrows it:
  - AMO's unlisted channel signs a permanently installable XPI without a public listing.
  - `data_collection_permissions` is required for new submissions, listed or unlisted, since
    2025-11-03.
  - Chrome no longer allows local CRX installs on Windows or macOS, so the ZIP stays primary.
- **Plugin ecosystem, multi-user, offline, mobile:** deliberately unchanged.
  - Profiles already cover multi-user.
  - The library and exports already cover offline use.
  - Firefox for Android isn't declared and nothing here justifies adding it.
  - Subscribable community lists are under consideration below, not planned.

## Rejected Ideas

- **Age-gate or sensitive-media bypass**, and forcing `rweb_age_assurance_flow_enabled` off (CPFT,
  BetterX, InsensitiveX). They reveal material the reader didn't ask for, and the refusal is already
  recorded in `docs/USERSCRIPT_REVIEW.md`.
- **Account location via AboutAccountQuery, copied headers or a shared cache** (X-Posed). This means
  making its own requests and copying tokens, and ban reports followed. A passive "based in" field
  stays under consideration only if X renders it in a response the page already requests.
- **Sending X's delete mutations directly** instead of driving the UI (Cyd, tweetXer). It's faster,
  but that's exactly the traffic behind the 2026 suspension reports, and it would break the
  no-own-requests boundary.
- **Re-liking old posts in order to unlike them** (tweetXer README). That's spam-like engagement
  X's rules name directly.
- **A confirmation dialog or arming phrase for cleanup.** The owner removed them in v1.51.1. F337
  and F339 get safety from defaults and copy instead.
- **Scheduled or recurring deletion** (TweetDelete, Redact, Circleboom). Aviary would have to run
  unattended against a signed-in session, which is automation in the plainest sense.
- **Forging `X-Client-Transaction-ID` or other request signing** (gallery-dl, yt-dlp #17105). It
  isn't needed for passive capture.
- **Auto-block of Premium accounts** (Blue Blocker #434) and **one-click block in the post bar**.
  Both change relationships, and both have suspension reports.
- **Paid "mute anywhere" parity through a server** (CPFT v5, AI Reply Hider). Aviary's rules already
  run locally.
- **Posting an X archive to Bluesky or Mastodon on the user's behalf** (Porto, ianklatzco's
  importer, Dumbo). Bluesky shows the import time rather than the original date, and the posts
  flood followers' timelines. Plain import files (F368) serve people leaving without that
  side effect.
- **Plain-language filtering through a local model** (Bouncer). It's a large download and a WebGPU
  dependency for a problem Aviary's rules and the "why hidden" strip already cover.
- **Compressing the userscript's locale catalogs into base64 blobs** to buy budget. It defeats the
  readable-userscript principle and risks Greasy Fork's obfuscation rule.
- **Under consideration, not planned:**
  - Subscribable community filter lists (icicle, SponsorBlock-style). Outbound fetch of remote
    content, needs a policy decision.
  - A paginated or "stop after N posts" timeline (CPFT #916).
  - Detecting deleted posts from seen history (BetterX).
  - A conflicting-extension notice in Trust (TwitterMediaHarvest #368).
  - A follow-graph CSV built from the Following and Followers pages a reader has already scrolled
    (Sky Follower Bridge). It's passive, but relationship data needs its own privacy note.
  - Lossless MP4 remux through the helper for X's new muxer (cobalt #1399). Needs live evidence
    that Aviary's saved files are affected.

## Sources

### Direct competitors and reading tools
- https://github.com/insin/control-panel-for-twitter/releases
- https://github.com/insin/control-panel-for-twitter/blob/master/script.js
- https://github.com/insin/control-panel-for-twitter/issues/931
- https://github.com/insin/control-panel-for-twitter/issues/941
- https://github.com/insin/control-panel-for-twitter/issues/916
- https://github.com/insin/control-panel-for-twitter/compare/master...v5
- https://chromewebstore.google.com/detail/control-panel-for-twitter/kpmjjdhbcfebfjgdnpjagcndoelnidfj
- https://github.com/dimdenGD/OldTwitter
- https://github.com/dimdenGD/OldTwitter/issues/1332
- https://github.com/typefully/minimal-twitter
- https://github.com/yusukesaitoh/calm-twitter/releases
- https://greasyfork.org/en/scripts/588748
- https://github.com/xaitax/x-account-location-device
- https://chromewebstore.google.com/detail/country-filter-for-x-twit/cocohplmilpblbkoikolbhakjipccioa
- https://github.com/kheina-com/Blue-Blocker/issues/434
- https://github.com/UTDDavid/Adblock-Filters
- https://github.com/Swakshan/X-Flags
- https://greasyfork.org/en/scripts/591463-x-media-grid-restore

### Media, archive and cleanup tools
- https://github.com/EltonChou/TwitterMediaHarvest/releases
- https://github.com/EltonChou/TwitterMediaHarvest/issues/328
- https://github.com/EltonChou/TwitterMediaHarvest/issues/355
- https://github.com/EltonChou/TwitterMediaHarvest/issues/368
- https://github.com/prinsss/twitter-web-exporter/releases
- https://github.com/prinsss/twitter-web-exporter/issues/120
- https://github.com/prinsss/twitter-web-exporter/issues/137
- https://github.com/kmccleary3301/scrollmark/issues/4
- https://github.com/mikf/gallery-dl/blob/master/CHANGELOG.md
- https://github.com/yt-dlp/yt-dlp/issues/17105
- https://github.com/imputnet/cobalt/issues/1399
- https://github.com/lockdown-systems/cyd/releases/tag/v1.2.4
- https://github.com/lockdown-systems/cyd/issues/693
- https://github.com/lockdown-systems/cyd/issues/668
- https://github.com/lockdown-systems/cyd/pull/717
- https://cyd.social/pricing/
- https://github.com/Lucahammer/tweetXer
- https://github.com/Lucahammer/tweetXer/issues/42
- https://redact.dev/pricing
- https://chromewebstore.google.com/detail/bulk-delete-tweets-unfoll/gpddblelbllagfcnhoadnfdbeanfmndi
- https://www.trustpilot.com/review/tweetdelete.net
- https://github.com/nanot1m/tweet-ldr

### Community signal and adjacent tools
- https://techcrunch.com/2026/08/25/x-sends-cease-and-desist-to-open-source-project-nitter-over-alleged-scraping/
- https://news.ycombinator.com/item?id=49437283
- https://techcrunch.com/2026/09/15/nitter-and-xcancel-are-dead-again-after-xs-latest-legal-actions/
- https://www.reddit.com/r/Twitter/comments/1vlugpd/
- https://www.reddit.com/r/Twitter/comments/1vomiky/
- https://github.com/QuantumDeus/x-media-grid-restore
- https://greasyfork.org/en/scripts/528890/feedback
- https://piunikaweb.com/2026/02/15/x-following-feed-not-in-chronological-order-heres-what-we-know/
- https://www.reddit.com/r/userscripts/comments/1vo8eym/
- https://techweez.com/2026/09/03/x-ai-generated-bot-replies/
- https://www.reddit.com/r/Twitter/comments/1vo09t7/
- https://www.reddit.com/r/Twitter/comments/1uobnt4/
- https://www.reddit.com/r/BlueskySocial/comments/1w2r1c5/
- https://github.com/lockdown-systems/cyd/issues/707
- https://github.com/kawamataryo/sky-follower-bridge
- https://github.com/Nester-xyz/Porto
- https://github.com/ianklatzco/twitter-to-bsky
- https://docs.karakeep.app/using-karakeep/import/
- https://docs.linkwarden.app/Usage/upload-from-singlefile
- https://help.raindrop.io/import
- https://github.com/omnivore-app/omnivore
- https://github.com/ajayyy/SponsorBlockServer
- https://news.ycombinator.com/item?id=47016443
- https://bsky.social/about/blog/03-12-2024-stackable-moderation
- https://github.com/imbue-ai/bouncer
- https://www.applevis.com/forum/ios-ipados/voiceover-cant-reliably-navigate-posts-x-app
- https://www.abitofaccess.com/alt-or-not
- https://github.com/bluesky-social/social-app/issues/4155
- https://github.com/insin/control-panel-for-twitter/tree/master/_locales
- https://github.com/iipc/awesome-web-archiving
- https://github.com/mundane799699/awesome-twitter-tools
- https://github.com/fregante/Awesome-WebExtensions

### X platform and policy
- https://web.archive.org/web/20260803124103/https://help.x.com/en/rules-and-policies/x-automation
- https://web.archive.org/web/20260919163056/https://help.x.com/en/using-x/delete-posts
- https://web.archive.org/web/20260914203700/https://help.x.com/en/rules-and-policies/x-limits
- https://docs.x.com/x-api/fundamentals/rate-limits
- https://web.archive.org/web/20260822032142/https://x.com/
- https://piunikaweb.com/2026/05/25/x-replaces-media-tab-with-videos/
- https://piunikaweb.com/2026/07/10/x-ad-blocker-warning-browser-users/
- https://techcrunch.com/2026/05/13/x-launches-a-history-tab-for-bookmarks-likes-videos-and-articles/
- https://www.macrumors.com/2026/09/14/xchat-app-disappears-from-app-store/

### Browser platform and standards
- https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/content_scripts.json
- https://developer.chrome.com/blog/local-network-access
- https://developer.chrome.com/blog/cws-policy-updates-2026
- https://developer.chrome.com/blog/chrome-userscript
- https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions
- https://developer.chrome.com/blog/chrome-two-week-release
- https://whattrainisitnow.com/release/?version=esr
- https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/develop/extensions-and-the-add-on-id/
- https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem
- https://specs.webrecorder.net/wacz/1.2.0/
- https://github.com/iipc/warc-specifications/issues/116
- https://github.com/webrecorder/py-wacz/releases/tag/v0.6.0
- https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/
- https://github.com/kenzo47/ThunderClaude/issues/1

### Dependencies and managers
- https://github.com/microsoft/playwright/releases/tag/v1.63.0
- https://github.com/eslint/eslint/releases
- https://github.com/typescript-eslint/typescript-eslint/releases
- https://github.com/nodejs/node/releases/tag/v24.21.0
- https://nodejs.org/en/blog/vulnerability/july-2026-security-releases
- https://github.com/advisories/GHSA-g7r4-m6w7-qqqr
- https://www.tampermonkey.net/changelog.php
- https://github.com/violentmonkey/violentmonkey/releases
- https://greasyfork.org/en/help/code-rules

## Open Questions

- **Owner decision, blocks F125 only:** publish through AMO's unlisted channel, a public listing, or
  neither. Every engineering step that doesn't depend on the answer is split out into F356.
- **Owner availability, blocks F338 and F342:** a signed-in session for one capture before
  2026-09-30. If that can't happen, the only compliant fallback is a new dated waiver with its
  reason, which the schema's own rules allow.
- **Needs live validation:** whether the Anthropic call (F352) and the loopback helper (F353) work
  from x.com in current Chrome and Firefox, and whether X's new MP4 muxer (cobalt #1399) affects
  files Aviary saves.
