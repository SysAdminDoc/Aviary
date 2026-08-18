# Aviary ROADMAP

Version: `1.28.0`

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

## Research-Driven Additions (2026-08-14)

### P2 — high-value features

- [ ] F118 — P2 — Media download depth: downloaded badges, text sidecar, batch-from-library
  Why: the install-weighted greasyfork market is media-first; TMH's backlog names exactly these (downloaded-media highlighting #126, tweet-text sidecar #283, batch #137) — and Aviary already has downloadHistory, filename templates, and captured records to build on without new API calls.
  Evidence: TwitterMediaHarvest issues; RESEARCH.md Competitive (ban-risk line: batch consumes captured/library records only).
  Touches: src/features/media/* (badge pass keyed on downloadHistory), export/collector records, library UI (batch action), settings.
  Acceptance: previously saved media shows a subtle marker; optional .json/.txt sidecar per save; "download all captured media for this collection" works checkpointed with zero originated GraphQL calls.
  Complexity: L

- [ ] F129 — P3 — Per-module custom CSS escape hatch
  Why: table stakes in OldTwitter/TUIC/GT2 lineage for power users; bounded per-module scoping keeps it reversible and off the support path.
  Evidence: TUIC CSS packs; OldTwitter custom CSS; RESEARCH.md Competitive.
  Touches: settings (per-module css string), theme/feature style injection, Trust copy (unsupported-styles disclaimer).
  Acceptance: user CSS applies within a module's scope attribute, survives reload, and is excluded from bug-report expectations; off by default.
  Complexity: M
  Note (2026-08-15): build the injection on CSS `@scope` (Chrome 118 / Firefox 146 / Safari 26.4, and esbuild parses it since 0.27.3) rather than an attribute-prefix rewrite. If Aviary ever publishes, the store-compliant route for user-supplied *script* is the `chrome.userScripts` `USER_SCRIPT` world, which is exempt from page CSP — but that needs manifest floors raised, so keep this item CSS-only.

## Research-Driven Additions (2026-08-15)

### P1 — trust, reliability, and measured defects

- [ ] F138 — P1 — Take the translation catalog off the document-start path
  Why: the built userscript is 1,862,668 characters and `src/platform/i18n-catalog.ts` is 1,011,863 of them — 54.3% — parsed synchronously on every X page load before first paint, to serve a settings panel that is usually never opened. All nine locales ship to every user.
  Evidence: measured against `dist/aviary.user.js` 2026-08-15 (module-boundary sizes in RESEARCH.md Architecture); `@run-at document-start` in the metablock and `run_at: document_start` in both manifests.
  Touches: `src/platform/i18n-catalog.ts`, `src/platform/i18n.ts`, `tools/build.mjs` (emit the catalog as a deferred payload — a lazily parsed JSON string in the userscript, a web-accessible chunk in the extension), boot path.
  Acceptance: the document-start payload drops by at least half; panel copy still resolves on first open with no visible delay; the i18n extract/sync pipeline and the drift tests still pass unchanged; the userscript remains a single readable file.
  Note (2026-08-17): re-measured, and the stated rationale names the wrong cost. The catalog is now
  1,025,753 of 1,903,855 built bytes (53.9%, bytes 53,171–1,078,924 of `dist/aviary.user.js`), and it
  is 8 locales × 934 keys. But V8 lazily compiles function bodies, so compiling the whole 1.9 MB script
  costs only ~4 ms — "parsed synchronously before first paint" overstates it. `PANEL_CATALOG` is a
  top-level object literal, so what actually happens on every X page load in every tab is **6.6 ms of
  module execution and 2.84 MB of retained heap**, plus 54% of every update download. Keep the item;
  justify it on retained heap and update payload, and make the acceptance measure those rather than
  parse time.
  Complexity: L

- [ ] F140 — P1 — Test accessibility by rendering, not by reading source
  Why: `tests/audit-a11y.test.mjs` asserts literal source strings such as `overlay.toggleAttribute("inert", !open)`, so a rename fails a passing behaviour and a real regression that keeps the string passes. Contrast is already gated properly in `theme-matrix.test.mjs`; interaction and semantics are not.
  Evidence: `tests/audit-a11y.test.mjs:11-28`; `tests/theme-matrix.test.mjs:134-138`.
  Touches: `tests/audit-a11y.test.mjs`, the existing Playwright harness under `tests/visual/`.
  Acceptance: the panel is mounted and driven — focus order, `inert` on close, Escape, focus return, modal semantics, and every control's accessible name are read from the live accessibility tree; the source-regex assertions are deleted, not kept alongside.
  Complexity: M

### P2 — features

- [ ] F144 — P2 — Say why a post was filtered
  Why: a filter that hides silently is indistinguishable from a bug, and the v1.25.0 rule DSL already knows which condition matched. It is the single best trust affordance a filter engine can add, and the same request is open against the closest architectural twin.
  Evidence: XKit-Rewritten#1664 (👍4). Corrected 2026-08-15 (second pass): `FilterDecision` is a bare `"show" | "hide" | "dim"` union (`src/features/filtering/predicates.ts:16`) and `evaluateRules` (`rules.ts:185`) returns it directly — the deciding rule is NOT currently exposed. First step is widening the decision to carry its source (rule line / predicate name) without breaking `decide()`'s callers.
  Touches: `src/features/filtering/rules.ts`, `filter-engine.ts`, `hidden-posts-feature.ts`, the dim/hide affordance, Filtering panel.
  Acceptance: a hidden or dimmed post names the rule or predicate that caught it, in text, on hover or reveal; the reason is derived from the decision rather than recomputed; nothing is stored per post.
  Note (2026-08-18): two shipped models to copy the wording from. Mastodon requires every filter to carry
  a `title` precisely so the warning can name which filter matched, and separates the outcome into
  `warn` (show a placeholder naming the filter, expandable) / `hide` (never render) / `blur` (media only)
  — https://docs.joinmastodon.org/entities/Filter/. Bluesky goes further and names the *cause* as well as
  the rule: "Post Hidden by Muted Word", "Post Hidden by You", "Account Muted", 'Muted by "{list name}"'
  — https://github.com/bluesky-social/social-app/blob/main/src/lib/moderation/useModerationCauseDescription.ts.
  Aviary should render cause + rule title, offer peek-without-unhiding, and — since it already has a rule
  engine — a filter inspector that runs any visible post through every rule and reports which matched.
  F204 supplies the rule title this sentence needs.
  Complexity: M

- [ ] F145 — P2 — Portable rule sets
  Why: `src/features/filtering/rules.ts` has no import or export path, so a rule set cannot be shared, backed up outside settings, or restored to a second profile — and rule packs are how every rule-engine competitor grows.
  Evidence: `src/features/filtering/rules.ts` exports only `compileRules`/`evaluateRules`; control-panel-for-twitter#864, rxliuli's importable rule packs.
  Touches: `src/features/filtering/rules.ts`, Filtering panel, library backup, settings export.
  Acceptance: a rule set exports to and imports from a documented plain-text or JSON form, reports parse errors per line before applying, previews what a paste would add or replace, and rides the existing backup.
  Complexity: M

- [ ] F147 — P2 — WACZ export and self-replay
  Why: Aviary emits raw uncompressed WARC while the browser-side archiving ecosystem has standardized on WACZ, whose client-side replay engine means an Aviary archive would open in every Webrecorder tool for a packaging change rather than a capture change.
  Evidence: WACZ 1.1.1 + CDXJ 0.1.0 specs, read 2026-08-15 — implementable from this item without re-research. Layout: `archive/` (>=1 WARC), `indexes/` (>=1 CDXJ), `pages/pages.jsonl`, `datapackage.json` (`profile: "data-package"`, `wacz_version: "1.1.1"`, `resources[]` each name/path/hash/bytes with `sha256:` prefix), plus `datapackage-digest.json` `{path, hash-of-datapackage.json}`. CDXJ line = `<SURT> <YYYYMMDDHHMMSS> <JSON: url,digest,mime,status,filename,offset,length>`, lines sorted in LC_ALL=C byte order; SURT = lowercased host reversed comma-form (`com,example)/path`). pages.jsonl header `{"format":"json-pages-1.0","id":"pages","title":"All Pages"}`, entries need `url` + RFC3339 `ts`. Plain uncompressed `.warc` is spec-valid — gzip is optional, and if ever added it must be per-record so offset/length address one member.
  Touches: `src/features/export/warc.ts`, a new WACZ packager, export format list, docs/FAQ.md.
  Acceptance: the WACZ validates against the spec and opens in replayweb.page; opt-in beside WARC; storage cost stated before the run. CRITICAL: the `archive/` and `indexes/` members must go through `buildStoreZip` (STORE), not the F137 DEFLATE path — replay reads records by offset/length inside the member, which a deflated member cannot serve. Do not vendor wabac.js (AGPLv3): self-replay means linking to replayweb.page, not embedding the engine.
  Depends on: F137 (shipped 2026-08-15 — the writer now exposes both `buildZip` and `buildStoreZip`; this item needs the STORE path).
  Note (2026-08-17): two replay-correctness corrections found before build, both from primary specs.
  (a) A response-only WARC is not replayable for anything POSTed — WARC 1.1 pairs `request` and
  `response` through `WARC-Concurrent-To`, and pywb's POST replay works by matching adjacent request
  records. (b) More decisively, pywb's POST-body canonicalization does not cover JSON/GraphQL bodies at
  all, and its form-urlencoded path is documented as broken against the outbackcdx fix
  (webrecorder/pywb#768). So captured GraphQL written as `response` records will not replay in
  replayweb.page. Write GraphQL captures as **`resource` records with a synthetic URI**, and reserve
  `response` records for genuine HTTP GETs (media, images). Also add a `warcinfo` record first in each
  file, keep `WARC-Payload-Digest` and `WARC-Block-Digest` distinct (payload digest must not be written
  on records with no well-defined payload), and consider `revisit` records with
  `identical-payload-digest` for cross-export dedup — that is the standards-blessed answer to the same
  avatar appearing in thousands of captures, and it pairs with F189.
  Complexity: L

- [ ] F148 — P2 — Catch-up digest over the seen-post store
  Why: v1.25.0 shipped the hard half — a bounded record of which posts have already gone past — and the best reading-mode idea in the adjacent field is what sits on top of it: a time-bounded digest of what is new, grouped by author.
  Evidence: `src/features/filtering/seen-posts.ts`; cheeaun/phanpy Catch-up (★1478).
  Touches: `src/features/filtering/seen-posts.ts`, a new reading surface, Layout settings.
  Acceptance: a digest built only from the local seen record and already-rendered posts — zero originated requests — groups unseen posts by author over a chosen window, respects active filters, and shows filter reasons from F144 where a post was suppressed.
  Depends on: F144.
  Note (2026-08-18): the reference implementation is Phanpy's Catch-up
  (https://github.com/cheeaun/phanpy/blob/main/src/pages/catchup.jsx) and it is detailed enough to build
  from without re-research. Window: a slider of 13 ranges (last 1h..12h, plus "beyond 12 hours"). Category
  chips with live counts: Original / Replies / Quotes / Reposts / Followed tags / Filtered. Five sort axes
  — time, replies, likes, reposts, and **density**, where
  `density = (textLen + spoilerLen + pollLen)/140 + 8*mediaCount + 8*(hasCard ? 1 : 0)`; ascending puts
  cheap-to-read first. Optional grouping by author, authors ordered by post count descending. A Top Links
  pane deduped by URL, ranked by sharer count then reposts then likes, keeping links shared more than once
  or the top 10, each showing "Shared by [avatars]" where clicking a sharer filters to them. One-line post
  peeks with media as small thumbnails. Crucially it **marks nothing read** — it persists only the filter
  selection and scroll position — and ends with "That's all." Aviary's version is a render of the local
  seen store rather than a fetch, so the honest framing is "everything Aviary saw", not "everything posted".
  Pair with F203, which supplies the read marker Catch-up deliberately does not use.
  Complexity: L

- [ ] F149 — P2 — Copy a post link for an alternate front-end
  Why: a purely local text transform with steady demand, no request, and no risk — the mirror of the redirect feature that broke authentication elsewhere and is rejected.
  Evidence: control-panel-for-twitter#522 (👍8) and #641.
  Touches: post action row or the existing per-post menu, settings (chosen host, off by default).
  Acceptance: a copy action yields the same post's URL on a user-configured host; the default is X's own URL; nothing rewrites links X rendered and no navigation is redirected.
  Note (2026-08-18): demand is stronger than the original evidence showed, and the redirect alternative is
  now definitively dead. Beyond control-panel-for-twitter#522 (+8) and #641, the same ask is open as
  OldTweetDeck#212, and "Firefox extension to redirect x.com to xcancel.com" took 259 points / 162 comments
  on HN (2026-01-07). Meanwhile CPFT v4.24.0 (2026-08-17) *removed* its twitter.com redirect because
  logging in via twitter.com now sets an x.com cookie, and Nitter has been architecturally dead since X
  removed guest tokens (2024-01-31). That makes copy-time rewriting the only viable form of this feature —
  which is exactly what this item already scopes. Worth offering the common hosts (fxtwitter, vxtwitter,
  fixupx, xcancel) as presets rather than a bare text field.
  Complexity: S

- [ ] F154 — P2 — Mirror bookmarks locally as they render, and export them in bulk
  Why: bookmarks are the clearest unserved need in the archiving communities — users report collections shrinking from hundreds to about twenty, and the standing explanation is that X does not delete them server-side, they simply stop being rendered (one third-party client listed five digits of bookmarks the UI would not show). Aviary already has a bookmark library and passive GraphQL capture, so mirroring what X hands the page needs no originated call.
  Evidence: r/Twitter 1uyh6kw (2026-07-16), 1vbkkzr (2026-07-31), 1vlyntp (2026-08-12); r/DataHoarder 1vo86y2 (2026-08-14); HN 47697679 (2026-04-08 — a Show HN bookmark-export one-off, people build this themselves); twitter-web-exporter's bookmark-cap bypass is the same mechanism. Verified 2026-08-15: `network-capture.ts` persists any GraphQL operation when `preserveRawPayloads` is on, so bookmark payloads already reach the store — this is a reader over captured data, not a new capture path.
  Touches: `src/features/export/network-capture.ts` (bookmark operations), `src/features/library/`, export formats, Library panel.
  Acceptance: bookmarks seen in a captured payload are mirrored into the local library with their timestamp, survive disappearing from X's UI, and export in bulk; the mirror records only what X sent to the page, with zero originated requests; the panel states plainly that it can only hold what has been scrolled past.
  Complexity: M

- [ ] F150 — P2 — Media follow-ons beyond F118
  Why: the media backlog of the benchmark saver names four things Aviary can serve from records it already holds, without a single originated call.
  Evidence: TwitterMediaHarvest#336 (subtitles), #103 (audio-only), #316 (group by account), #323 (history export by date range).
  Touches: `src/features/media/*`, `history.ts`, filename template tokens, Media panel.
  Acceptance: each capability works only from captured or already-downloaded records; download history exports over a chosen date range; grouping is a filename-template token rather than a new store.
  Depends on: F118.
  Complexity: M

### P3 — toolchain

- [ ] F151 — P3 — Typecheck on the native TypeScript compiler
  Why: `npm run typecheck` is pure `tsc --noEmit` — nothing consumes the programmatic API — so it can move to the Go-native compiler for an 8–12× faster gate while TypeScript 6 stays installed for the lint parser, which cannot run on 7.0 until 7.1 restores the API.
  Evidence: TypeScript 7.0 GA 2026-07-08; typescript-eslint#10940; package.json scripts.
  Touches: package.json (`typecheck` script, devDependency), tsconfig defaults that changed in 7.0.
  Acceptance: `npm run typecheck` runs on the native compiler and reports the same diagnostics as the TypeScript 6 pin on a deliberately broken file; lint still runs on the TypeScript 6 parser; local verification time drops measurably.
  Note (2026-08-18): **demote — the premise holds but the payoff was measured and it is 1.4 seconds.**
  The parser constraint is confirmed: `@typescript-eslint/parser@8.67.0` declares
  `peerDependencies.typescript "<6.1.0"`, and TS 7.0 ships no programmatic API (it lands in 7.1). The
  acceptance criterion was run: against this repo's `src/` plus a deliberately broken file, TS 6.0.3 and
  TS 7.0.2 emitted byte-identical diagnostics, at **1.288s vs 0.276s**, and TS 7 needed no tsconfig
  changes. But the whole gate is ~8.6s (`typecheck` 1.63s, `lint` 2.21s, `build` 0.25s, 502 tests 4.53s),
  so the 8–12× multiplier applies to 1.6 seconds. The cost is a dual-TypeScript install plus a real trap:
  under the alias layout `node_modules/.bin/tsc` still resolves to 6.x, so a bare `tsc --noEmit` silently
  keeps using the old compiler and the migration looks done when it is not. Revisit at TS 7.1, when the
  parser can move and this collapses to a single-package bump.
  Complexity: S

## Research-Driven Additions (2026-08-15, second pass)

Internal audit of the subsystems no prior pass had examined, plus the code added earlier on 2026-08-15. Findings verified against source before listing; file:line cited on each.

### P2 — reliability

- [ ] F161 — P2 — Harden page-agent nonce adoption against a first-hello squatter
  Why: the agent adopts the first well-formed `hello` nonce and rejects later ones, and the winning nonce rides every envelope where any page script can read it — so a script that races the bridge owns the agent: the real bridge's `ready` never validates, features report agent-absent, and the squatter can `config` off the default-on ad guard or tear the agent down. The isolated world stays protected; what is lost silently is ad protection.
  Evidence: `src/page/page-agent.ts:386-398` (first-wins adoption), `src/platform/page-bridge.ts:108` (bridge drops mismatched nonces); mechanism confirmed 2026-08-15, a live race needs a runtime check.
  Touches: `src/page/page-agent.ts`, `src/platform/page-bridge.ts`, their tests.
  Acceptance: a `hello` arriving after the genuine bridge's cannot displace it, and a squatter arriving first is at minimum visible — the bridge detects an unadoptable agent and reports it through selector health / Trust instead of silently showing agent-absent; the design note states plainly that the boundary is not cryptographic and what it does and does not defend.
  Complexity: M

- [ ] F162 — P2 — Coordinate the stores two X tabs share
  Why: every whole-state store (hidden posts, seen posts, aria2 history, semantic index, usage ledger, archive jobs) loads once and persists full snapshots — two tabs are last-writer-wins, so a hide in tab A and a hide in tab B keep only one; the integration usage ledger's reserve step is a cross-tab TOCTOU that lets the daily AI byte budget be spent N times over; the backup snapshot/rollback window can clobber a second tab's writes. Web Locks is Baseline (Chrome 69 / Firefox 96 / Safari 15.4) and costs no dependency.
  Evidence: audit 2026-08-15 across `hidden-posts.ts`, `seen-posts.ts`, aria2 history, `semantic-search.ts`, `usage.ts:156-206`, `library-backup.ts:395-491`; RESEARCH.md platform table (Web Locks).
  Touches: `src/platform/storage.ts` (a lock-wrapping write path), the stores above, `library-backup.ts`.
  Acceptance: with two simulated writers, both writes survive (merge-on-write under a lock, or read-modify-write inside one); the usage ledger cannot exceed its budget across writers; backup restore holds the lock across snapshot, write, and verify; single-tab behaviour and performance are unchanged.
  Complexity: L

### P3 — small measured defects

## Research-Driven Additions (2026-08-16)

Focused comparison of 46 primary sources for feed image/video download behavior. See RESEARCH.md.

### P2 — download truth and edge coverage

- [ ] F169 — P2 — Track browser downloads through terminal state
  Why: `chrome.downloads.download()` confirms a handoff, not that the file completed; current feed
  feedback can therefore reach Saved before a later network interruption.
  Evidence: official Chrome downloads API; TwitterMediaHarvest indefinite-spinner and interrupted
  download reports.
  Touches: extension background download protocol, service-worker restart recovery, button states.
  Acceptance: Started and Saved are distinct; completion/interruption updates survive service-worker
  suspension; a failed transfer exposes Retry and never enters duplicate history.
  Complexity: M

- [ ] F170 — P2 — Preserve media ownership for quotes, cards, and attributed embeds
  Why: feed downloaders repeatedly report missing or misnamed quote/media-card downloads. Aviary's
  DOM extractor currently assigns every discovered descendant to the outer post identity.
  Evidence: Twitter Click'n'Save#7/#45; Twitter-X-Media-Copy-Download documented attributed-video
  limitation; quote structure in `_decoded/home.html`.
  Touches: `src/features/media/extract.ts`, captured metadata association, filename tests.
  Acceptance: quote/card media is either attributed to its own captured post identity or clearly
  excluded; the outer Download action never silently names another author's media as its own.
  Complexity: M

## Research-Driven Additions (2026-08-17)

General pass over the subsystems no prior research examined (the 2026-08-16 pass was media-only).
Every defect below was read at the cited line; the five marked (re-checked) were independently
confirmed a second time. See RESEARCH.md.

### P1 — measured defects, root cause first

- [ ] F173 — P1 — Stop the page from disabling ad protection or uninstalling the agent
  Why: the bridge broadcasts its session nonce with `postMessage(envelope, "*")`, and the agent then
  honours `config` and `teardown` from anyone who replays it — so a page script that listens for one
  message can set `blockAds:false` or tear the agent down. This is distinct from and strictly worse
  than F161: it works even when the genuine bridge wins the `hello` race, so the first-wins fix does
  not close it. What is lost silently is the default-on ad guard.
  Evidence: `src/platform/page-bridge.ts:161,236` (nonce broadcast), `src/page/page-agent.ts:438-461`
  (config/teardown accepted on nonce match) (re-checked 2026-08-17).
  Touches: `src/platform/page-bridge.ts`, `src/page/page-agent.ts`, a new `tests/page-bridge.test.mjs`
  (the module currently has no direct test).
  Acceptance: the control channel is a `MessageChannel` port transferred once, or an equivalent the
  page cannot observe after handshake; a replayed envelope captured from the page world changes
  nothing; `teardown` is not reachable from the page at all; the design note states plainly what the
  boundary does and does not defend.
  Depends on: coordinate with F161 — both touch the same handshake, land them together.
  Note (2026-08-18): two refinements. The threat model is narrower than feared on one axis — Chrome
  documents that `document_start` content scripts run "before any other DOM is constructed or any other
  script is run", so the page's own inline scripts cannot win the first-`hello` race; what is unordered is
  another *extension's* MAIN-world script. The replay half is unconditional and unaffected by that. Also,
  `page-bridge.ts:161` posts with `targetOrigin: "*"` — tightening it to the page origin is free and
  should land regardless of the channel redesign. Worth noting the userscript build already avoids the
  window bus entirely via the `PageAgentSink` direct callback (`page-bridge.ts:157`); only the extension
  build depends on `postMessage`, which narrows the fix surface.
  Complexity: M

### P1 — trust and verification

- [ ] F182 — P1 — Retire behavioural assertions written as source-text regexes
  Why: 33 of 91 test files read `src/*.ts` as text and assert with regex — roughly 350 assertions, so a
  rename fails a working feature while a real regression that preserves the literal string passes. The
  suite's 502-test count is worth materially less than it reads. F140 fixes only the a11y file; this is
  the systemic half. Note the legitimate exception: `source-contracts.test.mjs` enforces bans ("no
  `innerHTML` anywhere") and must stay source-text — the target is behavioural claims written as
  source regexes.
  Evidence: measured 2026-08-17 — `v1.8.0.test.mjs` (87 such assertions), `audit-ui.test.mjs` (40),
  `audit-2026-08-07.test.mjs` (32), `source-contracts.test.mjs` (23, exempt), `audit-a11y.test.mjs` (20,
  covered by F140). Four are frozen version-named audits at a project now on 1.27.1.
  Touches: the version-named audit files first, then `audit-ui.test.mjs` and `audit-2026-08-07.test.mjs`.
  Acceptance: each converted assertion drives the built module or the rendered DOM; assertions that
  encoded a frozen implementation detail rather than a contract are deleted rather than translated, and
  the deletion is stated in the commit; the remaining source-text tests are only ban checks and are
  named as such in one place.
  Depends on: F140 (same technique, smaller surface — land it first as the pattern).
  Complexity: L

### P2 — platform primitives that delete hand-rolled code

- [ ] F185 — P2 — Move menus, toasts and the panel to the Popover API
  Why: it is free at both declared manifest floors — Chrome 116 is exactly `minimum_chrome_version`, and
  Firefox 125 is below the 128 floor — and it replaces hand-rolled top-layer work with platform
  behaviour: top-layer rendering (no z-index contest with x.com's stacking contexts), light dismiss, and
  focus handling. Light dismiss also covers the Escape case without registering a key handler, which
  keeps the no-hotkeys policy clean rather than bending it.
  Evidence: MDN Popover API; Chrome 116 / Firefox 125 / Safari 17, Baseline Newly 2025-01-27 (verified
  against webstatus.dev 2026-08-17). Current floors in both manifests.
  Touches: `src/ui/control-center.ts` (overlay/panel), `src/features/core/feature-toast.ts`,
  `src/features/composer/composer-snippets.ts` (popover), `src/features/ai/command-menu.ts`,
  `tests/control-center-modal.test.mjs`, `tests/audit-a11y.test.mjs`, the 60 visual baselines.
  Acceptance: the panel, toasts, and both popovers use `popover` with no bespoke outside-click handler
  and no `z-index` above X's; `inert`/focus-return behaviour is unchanged or better, proven against the
  live accessibility tree rather than source text; visual baselines are regenerated and reviewed.
  Depends on: F140 (the a11y assertions this touches should be behavioural before they are rewritten).
  Complexity: M

- [ ] F186 — P2 — Push structural filter predicates into `:has()` stylesheets
  Why: the filter loop's shape is "MutationObserver fires → walk to the owning article → toggle a
  class", and every predicate that is purely structural collapses to one static CSS rule instead —
  removing that work from the mutation hot path entirely, which is the same path F175 and F179 are
  contending over. `:has()` is Baseline Widely available and safe at both floors.
  Evidence: MDN `:has()` — Chrome 105 / Firefox 121 / Safari 15.4, Baseline high 2026-06-19 (verified
  2026-08-17). Current predicate set in `src/features/filtering/predicates.ts`.
  Touches: `src/features/filtering/predicates.ts`, `filter-engine.ts` (CSS emission),
  `tests/filter-engine.test.mjs`.
  Acceptance: predicates that are structural are expressed as `:has()` rules and no longer run per
  article per batch; text- and rule-driven predicates stay in JS; the split is documented so a future
  predicate lands on the right side; measured mutation-batch work drops on the fixture timeline.
  Complexity: M

- [ ] F187 — P2 — Decide the Firefox floor
  Why: `strict_min_version: 128.0` is what forces a detection branch around Navigation API (FF147),
  `URLPattern` (FF142), `@scope` (FF146), `content-visibility` (FF130) and `RegExp.escape` (FF134) — and
  a fallback branch for each partly defeats the point of adopting them. With zero installs the bump
  costs nothing today; it stops being free the moment F125 resolves toward publication, so the decision
  is cheapest now.
  Evidence: version data verified against webstatus.dev/MDN/caniuse 2026-08-17; current
  `src/extension/manifest.firefox.json`. F129's note already assumes `@scope`.
  Touches: `src/extension/manifest.firefox.json`, `docs/INSTALL.md`, `tools/preflight.mjs` if the floor
  is asserted, and whichever of F129/F186 depend on it.
  Acceptance: the floor is stated with its reason in one place; every platform feature adopted after it
  either sits under the floor or carries a detection branch, and which one is true is written down
  rather than rediscovered.
  Complexity: S

### P2 — archive fidelity

- [ ] F188 — P2 — Sign and self-describe archive packages
  Why: WACZ carries a `datapackage-digest.json` whose anonymous-ECDSA scheme was designed for exactly
  Aviary's situation — a decentralized tool with no domain certificate — and ReplayWeb.page renders an
  integrity badge when it validates. Combined with the per-file SHA-256 resource list Aviary already
  computes for its manifest, this turns an export into something a third party can verify without
  trusting the exporter, using WebCrypto and no runtime dependency.
  Evidence: https://github.com/webrecorder/wacz-auth-spec/blob/main/spec.md (read 2026-08-17);
  https://specs.webrecorder.net/wacz/1.1.1/ `datapackage.json` resources block.
  Touches: the F147 WACZ packager, `src/features/export/assets.ts` (digests already exist),
  Export panel copy, `docs/FAQ.md`.
  Acceptance: a signed package validates against the spec and shows a verified badge in
  replayweb.page; the keypair is generated and stored locally, is exportable, and is excluded from
  redacted backups; signing is opt-in and an unsigned package remains spec-valid. SHA-256 only —
  py-wacz offers MD5 and it must not be used.
  Depends on: F147.
  Complexity: M

- [ ] F189 — P2 — Dedup media by content, not URL
  Why: the download history is keyed by URL, so the same image served at a different size or re-encoded
  by X counts as a new asset — the identical gap gallery-dl documents in its own archive
  ("prevents re-downloading but does not deduplicate across different source URLs pointing to the same
  image"). Aviary already computes SHA-256 for captured export assets, so the exact-match half is
  nearly free; a perceptual hash covers the re-encode case.
  Evidence: https://github.com/mikf/gallery-dl/discussions/7717;
  https://auto-archiver.readthedocs.io/en/latest/modules/autogen/enricher/pdq_hash_enricher.html
  (PDQ, 256-bit, stored as hex); `src/features/media/history.ts` key scheme.
  Touches: `src/features/media/history.ts`, `src/features/export/assets.ts`, the Media panel's dedup
  readout and "Clear download history".
  Acceptance: re-saving the same image at a different `name=` size is reported as a duplicate; the
  index stores hashes rather than growing per URL; the panel states which kind of match fired; the
  perceptual half is opt-in and its false-positive behaviour is stated.
  Complexity: M

- [ ] F190 — P2 — Repair X archive imports from the captured corpus
  Why: X's own export is documented as losing four things Aviary can restore locally — t.co links are
  preserved unexpanded (they hide origins and die with t.co), DM and mention participants are stored as
  bare numeric ids with no handle, media are downscaled from originals, and bookmarks are omitted
  entirely. Aviary already has `link-unshorten.ts`, an archive importer, and a captured GraphQL corpus
  that can resolve numeric ids to handles with zero originated requests.
  Evidence: https://github.com/timhutton/twitter-archive-parser (documented archive defects);
  `src/features/library/archive-import.ts`, `link-unshorten.ts`.
  Touches: `src/features/library/archive-import.ts`, `link-unshorten.ts`, the captured-record index,
  Library panel, README positioning.
  Acceptance: imported records show expanded destination URLs where the archive or corpus supplies one;
  numeric participant ids resolve to handles where the local corpus knows them and stay numeric,
  labelled, where it does not; nothing is fabricated and no request is originated; the panel states how
  many of each were resolved.
  Complexity: M

- [ ] F191 — P2 — Fuse lexical ranking into local search
  Why: the local library search and the opt-in semantic index are separate paths, and pure vector
  ranking is worst exactly where this corpus is queried most — exact handles, exact phrases, and rare
  tokens. The closest comparable local X vault runs BM25 and embeddings together and reranks. The
  lexical half needs no provider call, no key, and no runtime dependency, so it also gives local-only
  users a real improvement rather than an upsell.
  Evidence: https://github.com/lhl/tweetxvault (tantivy BM25 + MiniLM-384d + rerank);
  `src/features/library/local-search.ts`, `src/features/integrations/semantic-search.ts`.
  Touches: `src/features/library/local-search.ts`, `src/features/library/query-model.ts`,
  `src/features/integrations/semantic-search.ts` (fusion at rank time), Library panel.
  Acceptance: an exact handle or quoted phrase ranks first without any embedding configured; when the
  semantic index exists, results are fused rather than chosen by mode; the panel says which signals
  contributed; local-only mode still makes zero provider requests.
  Complexity: M

### P3 — repository hygiene

- [ ] F192 — P3 — Tag the releases that were never tagged
  Why: CHANGELOG.md documents 25 releases and git carries 3 tags, so v1.0.0 through v1.25.0 cannot be
  checked out, diffed, or bisected by reference — which matters most for the "when did this selector
  break" question this project asks constantly. Two releases also have no CHANGELOG entry at all.
  Evidence: `git tag` = v1.26.0, v1.27.0, v1.27.1 against 25 `## X.Y.Z` headings (2026-08-17);
  v1.7.0 and v1.15.0 missing from CHANGELOG despite a `chore: release v1.7.0` commit.
  Touches: git tags, `CHANGELOG.md`.
  Acceptance: every release named in CHANGELOG.md has a tag on the commit that bumped its version, or
  is explicitly recorded as untaggable with the reason; the two missing entries are written from their
  release commits.
  Complexity: S

- [ ] F193 — P3 — Stop carrying the extension bundles in git history
  Why: `dist/extension-chrome/content.js` and `dist/extension-firefox/content.js` are 1.9 MB each and
  tracked, and `npm run verify` rebuilds them on every commit touching `src/` — so each such commit
  writes ~3.8 MB of incompressible binary that nothing consumes. `.git` is 113 MB after 193 commits.
  This is the same reasoning that already removed the packaged ZIPs; the bundles were missed.
  `dist/aviary.user.js` must stay tracked — `@downloadURL` resolves to it, so it is the update channel.
  Evidence: `.gitignore` ZIP rationale; `ls -la dist/extension-*` (2026-08-17); `du -sh .git` = 113 MB.
  Touches: `.gitignore`, `docs/INSTALL.md` (load-unpacked instructions must say to build first),
  release artifact attachment.
  Acceptance: the extension bundle directories are untracked and built on demand; `dist/aviary.user.js`
  stays tracked; INSTALL's Chromium and Firefox load steps still work from a clean clone after one
  build; the bundles are attached to releases.
  Complexity: S

## Research-Driven Additions (2026-08-18)

Completes the 2026-08-17 pass, which lost most of its external streams to an API limit. Defects
below were read at the cited line. See RESEARCH.md.

### P1 — accessibility

- [ ] F196 — P1 — Assert accessibility by rendering, in the lane that already exists
  Why: a11y is currently verified by regexing source text (F140, F182), which cannot catch the two
  defects above. No major extension in this space — uBlock Origin, Dark Reader, Stylus, Refined GitHub
  — publishes accessibility checks, and Aviary already owns every prerequisite: Playwright 1.62.1,
  `launchPersistentContext`, local fixtures, and 60 committed baselines.
  Evidence: `tests/audit-a11y.test.mjs` source-string assertions; `tools/settings-visual-harness.mjs`
  harness; RESEARCH.md Architecture.
  Touches: a new axe lane beside `tests/visual/`, `package.json` scripts, devDependency (axe is the one
  place a dev-only dependency is worth it; runtime deps stay at zero).
  Acceptance: an automated pass runs against the mounted panel scoped to Aviary's injected selectors —
  never X's own DOM — across all 13 destinations plus the options page, in default and forced-colors
  states; violations fail the lane; what axe cannot detect is written down so the pass is not mistaken
  for full coverage.
  Distinct from F140, deliberately: F140 replaces hand-written source-regex assertions with driven
  interaction checks (focus order, `inert`, Escape, focus return) that no rule engine can express. This
  item adds the automated rule sweep — invalid ARIA, missing accessible names, contrast — across every
  destination. Land F140 first; it defines the harness this rides on. Neither subsumes the other.
  Note (2026-08-18): verified working against this repo's exact pins, with four mechanics worth knowing
  before starting. (1) `@axe-core/playwright` 4.13.0 peers on `playwright-core >=1.0.0`, which
  `playwright@1.62.1` satisfies, and it does **not** require `@playwright/test` — types only, so it runs
  under `node --test`. (2) `AxeBuilder` throws "Please use browser.newContext()" on a page from
  `browser.newPage()`; the existing harness is already fine because `launchPersistentContext` returns a
  context. (3) Shadow DOM scoping works and was proven end to end — `.include({ fromShadowDom:
  ["#av-control-center", ".av-panel"] })`, one selector per level; violations come back with a **nested
  array** `target`, so serialize it into the failure message. Axe supports open roots only, and
  `control-center.ts:454` uses `attachShadow({mode:"open"})`. (4) Axe skips hidden regions, so the panel
  must be open — which `launchSettingsVisualHarness()` already does. Also: `page.accessibility.snapshot()`
  was **removed** in Playwright 1.57.0 and `Locator.ariaRef()` in 1.60.0, so F140 must use
  `page.ariaSnapshot()` plus real `page.keyboard.press()` / `activeElement` checks. Expect Aviary's
  glassmorphism to generate `incomplete` contrast entries — pin that count so growth fails. Note that
  **no axe rule covers forced-colors breakage**; F194 is not redundant with this.
  Complexity: M

### P1 — delivery integrity

### P1 — breakage response

- [ ] F200 — P1 — A "which Aviary feature is breaking this page?" bisect
  Why: when X changes markup, the support question is always "which of ~27 features did this". A binary
  search over enabled features answers it in about five rounds instead of a linear hunt, and produces a
  feature id that feeds a prefilled report. VS Code ships exactly this for extensions; no site enhancer
  in this lineage has built it over its own features, so it is a genuine first. It is fully local, needs
  no network, registers no key handlers, and uses the existing reversible init/destroy contract.
  Evidence: VS Code Extension Bisect (https://code.visualstudio.com/blogs/2021/02/16/extension-bisect);
  survey of RES / CPFT / Vencord / Dark Reader / uBO found no equivalent; `src/features/registry.ts`
  already isolates and can enable/disable features individually.
  Touches: `src/features/registry.ts`, a Trust panel flow, `src/features/core/audit-log.ts`,
  `.github/ISSUE_TEMPLATE/bug_report.yml`.
  Acceptance: a Trust action disables half the enabled features, prompts "still wrong?" / "fixed", halves
  again, and names the culprit; the original settings are restored exactly whatever the user does,
  including abandoning midway; the result plus the existing content-free diagnostics compose a prefilled
  bug report; no confirmation dialogs, no shortcuts.
  Depends on: F199 (selector health should answer the common case first; bisect is for what it cannot).
  Complexity: M

### P2 — leapfrog

- [ ] F202 — P2 — Read X's "Under the Hood" export locally
  Why: on 2026-08-13 X began letting eligible users download a JSON of aggregate stats showing whether
  visibility-limiting labels were applied to their account or posts in the past month. It is a file the
  user already has, so reading it originates nothing and crosses no line Aviary draws — and nobody has
  built a reader. Aviary already owns the surfaces this needs: a local library, an import path, and a
  panel to render it in.
  Evidence: https://techcrunch.com/2026/08/13/x-open-sources-its-ranking-algorithm-letting-users-see-if-theyve-been-shadowbanned/ ;
  https://github.com/xai-org/x-algorithm (Apache-2.0).
  Touches: `src/features/library/archive-import.ts` (same import shape), a new Trust or Library surface,
  export formats.
  Acceptance: the user picks the JSON X gave them and sees which labels were applied and when, held
  locally and included in library backup; month-over-month comparison works from stored reports; the
  panel states plainly that this is X's own summary of itself and that the published ranking weights are
  not proof of what runs in production — the export is the user's data, the weights are not.
  Complexity: M

### P2 — local reading, all zero-network

- [ ] F203 — P2 — A read marker, a "new since you last looked" line, and hide-seen
  Why: `seen-posts.ts` already records what has gone past, and the highest-value thing to build on it is
  the oldest idea in feed reading: a position marker. Mastodon's markers API is the reference schema
  (`last_read_id` per surface) and X's snowflake ids are ordinal, so "newer than" needs no timestamps.
  NetNewsWire's per-feed read filter is the interaction, and its stated rationale for making unread
  counts optional — that badges are "distracting, less meaningful, or even stressful" — is the right
  default for a project that already ships a focus mode.
  Evidence: https://docs.joinmastodon.org/methods/markers/ ;
  https://netnewswire.com/help/ios/6.0/en/filters.html ; `src/features/filtering/seen-posts.ts` (no
  `lastRead`/marker concept today, checked 2026-08-18).
  Touches: `src/features/filtering/seen-posts.ts`, a new reading feature, Layout/Reading settings,
  library backup registration.
  Acceptance: a per-surface marker persists locally; a separator marks the first post newer than it, with
  an explicit "mark above as read" control; "hide posts I have already seen" is a per-surface toggle; no
  unread badge unless opted in; the marker advances only on explicit action or on a post leaving the
  viewport upward, never on mere render; injecting the separator never moves the reading position.
  Complexity: M

- [ ] F204 — P2 — Give filter rules a title and an expiry
  Why: every rule is permanent and anonymous today, so "mute this for a week" is impossible and a hidden
  post cannot name what caught it. Bluesky ships duration as four choices with an explicit "Expired →
  Renew" state; Mastodon requires a filter title precisely so the warning can say which filter matched.
  The title is also the prerequisite that makes F144's "why was this hidden" sentence readable rather
  than a raw pattern dump.
  Evidence: https://github.com/bluesky-social/social-app/blob/main/src/components/dialogs/MutedWords.tsx
  (value/targets/actorTarget/expiresAt); https://docs.joinmastodon.org/entities/Filter/ (title, context[],
  warn|hide|blur); `src/features/filtering/rules.ts` has neither concept.
  Touches: `src/features/filtering/rules.ts`, `predicates.ts`, the Filtering panel, settings schema and
  normalization, library backup.
  Acceptance: a rule carries an optional title and an optional expiry (24h / 7d / 30d / never); expired
  rules stop applying, are shown as expired with a one-click renew, and are never silently deleted; the
  title is what F144 shows on a suppressed post; existing untitled, non-expiring rules keep working
  unchanged through normalization.
  Depends on: F144 consumes the title; F145 must carry both fields through import/export.
  Complexity: M

- [ ] F205 — P2 — Filter on post shape, not just text
  Why: the most repeated filtering requests in this ecosystem are structural rather than lexical — hide
  replies, hide quote-posts, hide self-reposts, hide posts under an engagement floor — and every one of
  those predicates is already visible in the rendered DOM, so they cost a predicate each and no capture.
  Evidence: control-panel-for-twitter#916 / #882 / #850 / #452; Bluesky `feedViewPref`
  (`hideReplies`, `hideReposts`, `hideQuotePosts`, `hideRepliesByLikeCount`) in
  https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/actor/defs.json ; Ivory's
  composite shape filters.
  Touches: `src/features/filtering/predicates.ts`, the Filtering panel, settings schema.
  Acceptance: shape predicates are available per route alongside the existing rules and reuse the same
  hide/dim actions and the same reason reporting; an engagement floor accepts a number and states which
  metric it reads; nothing here requires a new capture or a new request.
  Note: self-repost filtering stays blocked — F033 in Roadmap_Blocked.md needs an authenticated fixture
  of the attribution row. Ship the predicates that current captures already prove.
  Complexity: S

- [ ] F206 — P2 — Let the timeline stop
  Why: infinite scroll is the one attention mechanism Aviary's focus mode does not touch, and an explicit
  pagination request is open on the closest competitor with no implementation anywhere in the field.
  Phanpy ships it as "Paginated timeline"; Elk ships `disableTimelineAutoloading`. It is a local DOM
  behaviour with no capture dependency.
  Evidence: control-panel-for-twitter#916 (2026-08-03, "Load some user-defined number of posts, and then
  either force 'show more' or introduce pagination"); Phanpy settings; Elk settings definition.
  Touches: a new layout feature, Layout settings, `src/features/layout/`.
  Acceptance: after a user-set number of posts the timeline stops extending and shows an explicit control
  to continue; the count and the control are visible; turning it off restores X's behaviour immediately;
  scroll position is never moved by the intervention.
  Complexity: M

- [ ] F207 — P2 — Rebuild threads from what has already been captured
  Why: "archive a thread including all the replies" is a standing unmet request, and Aviary is unusually
  well placed: it already persists GraphQL payloads and `viewer.ts` already groups exported records by
  `conversationId`, but nothing reconstructs a chain for reading. The algorithm is published — merge
  overlapping reply contexts found in the same batch, order replies after parents, flag participants who
  differ from the author to separate a self-thread from a conversation.
  Evidence: https://github.com/cheeaun/phanpy/blob/main/src/utils/timeline-utils.js (`groupContext`);
  r/DataHoarder 2026-08-14; `src/features/export/viewer.ts:206` already keys on `conversationId`;
  no reconstruction exists in `src/features/`.
  Touches: `src/features/export/network-capture.ts` (persist parent/root/author per post),
  `src/features/library/`, a reading surface, export formats.
  Acceptance: a captured thread renders as a continuous ordered read from local records only, with posts
  that were never captured shown as explicit gaps rather than silently omitted; consecutive same-author
  runs collapse in the timeline to a single expandable summary; export carries the reconstructed order;
  zero originated requests.
  Complexity: L

### P1 — toolchain and claims (added 2026-08-18, second pass)

- [ ] F211 — P2 — Import the sources under test instead of bundling them first
  Why: 82 of 91 test files bundle through esbuild and import the result, which puts a build step between
  every assertion and the code it describes — and is part of why so many tests fell back to regexing
  source text (F182). Node's type stripping is stable and available on the repo's existing floor, and the
  sources are already erasable-syntax-only (no enums, namespaces, parameter properties, or decorators), so
  `node --test` can import `src/**/*.ts` directly.
  Evidence: https://nodejs.org/api/typescript.html (unflagged since 22.18.0, stable 24.12.0; repo floor is
  22.23.2); verified 2026-08-18 by importing `src/platform/observer.ts` and `network.ts` directly under
  Node with no build step. Cost is mechanical: 351 relative specifiers are extensionless and type
  stripping requires explicit `.ts`, needing `allowImportingTsExtensions` and a `verbatimModuleSyntax`
  pass over 212 value-import sites.
  Touches: `tests/*.test.mjs` (the `importBundledModule` helper), `tsconfig.json`, import specifiers
  across `src/`.
  Acceptance: tests import the modules they describe with no bundling step; the esbuild harness is deleted
  rather than left beside the new path; the build itself still bundles as before; suite runtime does not
  regress. Do this for directness, not speed — the suite is already ~4.5s.
  Depends on: sequence before F182, which is easier to do well once tests can import real modules.
  Complexity: L
