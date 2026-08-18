# Aviary ROADMAP

Version: `1.27.1`

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
  Complexity: L

- [ ] F149 — P2 — Copy a post link for an alternate front-end
  Why: a purely local text transform with steady demand, no request, and no risk — the mirror of the redirect feature that broke authentication elsewhere and is rejected.
  Evidence: control-panel-for-twitter#522 (👍8) and #641.
  Touches: post action row or the existing per-post menu, settings (chosen host, off by default).
  Acceptance: a copy action yields the same post's URL on a user-configured host; the default is X's own URL; nothing rewrites links X rendered and no navigation is redirected.
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

- [ ] F171 — P1 — Collapse the timeline row of a filtered post
  Why: `cell.toggleAttribute(CELL_RESULT_ATTR, hasHiddenArticle)` sets the attribute to `""`, but the
  stylesheet matches `[data-av-filter-cell-hidden="1"]`. The value never matches, so the article hides
  and its owning `cellInnerDiv` does not — every filtered post leaves a full-height blank gap, which is
  the exact defect `hidden-posts-feature.ts` was built to avoid.
  Evidence: `src/features/filtering/filter-engine.ts:206` vs `:237` (re-checked 2026-08-17).
  Touches: `src/features/filtering/filter-engine.ts`, a filtering fixture test that asserts computed
  display on the cell rather than on the article.
  Acceptance: a filtered post's `cellInnerDiv` computes to `display: none`; the following post moves
  into the slot; disabling the master toggle restores both; a test fails if the attribute value and
  the selector diverge again.
  Complexity: S

- [ ] F172 — P1 — Make a zero integration budget mean zero
  Why: `finiteLimit` maps both `undefined` and an explicit `0` to `0`, and every guard reads
  `if (limit > 0 && …)`. A user who sets the daily AI or embedding budget to zero to stop all spend
  gets unlimited spend instead. This inverts a stated user intent on a spending control, which is a
  sharper failure than the "setting claims what nothing implements" class the project already polices.
  Evidence: `src/features/integrations/usage.ts:171` (`finiteLimit`), guards at `:167-172`
  (re-checked 2026-08-17).
  Touches: `src/features/integrations/usage.ts`, the Integrations budget rows, `tests/integration-usage.test.mjs`.
  Acceptance: an explicit `0` blocks every request of that kind with a stated reason; "no limit" is a
  distinct, separately expressed value; the panel shows which of the two is in effect; a test covers
  zero, unset, and a positive limit.
  Complexity: S

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
  Complexity: M

- [ ] F174 — P1 — Release offscreen videos when they leave the DOM
  Why: `#tracked` and `#resumable` hold strong references to every `<video>` ever scanned and are
  cleared only in `stop()`. There is no `isConnected` check, no `delete`, and no `unobserve` anywhere
  in the file, so an infinite-scroll session retains every detached media element until teardown.
  Evidence: `src/features/performance/pause-offscreen-video.ts:16,72,89` (re-checked 2026-08-17).
  Touches: `src/features/performance/pause-offscreen-video.ts`, `tests/performance.test.mjs`.
  Acceptance: scanning N videos and removing them from the document leaves `trackedCount` at zero
  without calling `stop()`; the observer unobserves what it drops; resume behaviour for still-attached
  videos is unchanged.
  Complexity: S

- [ ] F175 — P1 — Break the hide/reflow loop and stop trusting a recycled article's cached key
  Why: two defects in the same file. `nudgeReflow()` dispatches a synthetic global `resize`, X's
  virtualizer relayouts, the resulting childList mutations drive `applyAll` → `collapse()` → another
  `resize`, and the cycle sustains itself while any hidden post is on screen. Separately the derived
  key is cached on `data-av-post-key`, and X reuses article nodes, so a recycled article can carry a
  previous post's key and collapse an unrelated post.
  Evidence: `src/features/filtering/hidden-posts-feature.ts:304-312` (nudge), `:220-231` (key cache).
  Touches: `src/features/filtering/hidden-posts-feature.ts`, hidden-post fixture tests.
  Acceptance: the nudge fires only when the collapsed-row count actually changed and is debounced past
  the observer's 120 ms flush, with a test that counts dispatches over a steady-state batch; a cached
  key is revalidated against the article's current `/status/<id>` before use.
  Complexity: M

- [ ] F176 — P1 — Bound user-supplied regex before it runs on every post
  Why: both rule paths compile user input with a bare `new RegExp(…)` and then `.test()` it
  synchronously for every article in every mutation batch. A pattern like `/(a+)+b/` freezes the tab on
  the first long post — a user can lock up X with a typo in their own filter list.
  Evidence: `src/features/filtering/predicates.ts:170-187` (used at `:98-103`),
  `src/features/filtering/rules.ts:165-178` (used at `:227-233`).
  Touches: one shared guarded compiler used by both files, the Filtering panel's per-line error
  reporting, `tests/filter-rules.test.mjs`.
  Acceptance: a pattern over a declared complexity or length budget is rejected at compile time and
  named in the panel's existing per-line error list rather than applied; a known catastrophic pattern
  is covered by a test that asserts the rule is refused, not that it completes; `RegExp.escape`
  (Baseline 2025-05-01) is used for the literal-keyword path.
  Complexity: M

- [ ] F177 — P1 — Make the seen-post store work after boot and actually flush on destroy
  Why: two defects. The store is constructed only inside `init`, so enabling `filter.dimSeenPosts`
  after boot leaves `apply` returning early forever until a reload — the setting silently does nothing.
  And `await store?.flush(…)` awaits `undefined`, because `flush` returns `void` and only queues onto a
  private tail chain, so `destroy` resolves before the write lands — which is precisely the data loss
  the comment above it claims to prevent.
  Evidence: `src/features/filtering/seen-posts-feature.ts:29-32,42-44` (construction), `:57` with
  `src/features/filtering/seen-posts.ts:67-84` (flush).
  Touches: `src/features/filtering/seen-posts-feature.ts`, `seen-posts.ts` (expose a settled/awaitable
  completion), the seen-post tests.
  Acceptance: toggling the setting on at runtime starts dimming without a reload; `destroy` resolves
  only after the pending write has landed, proven by a test that reads the store back after awaiting
  destroy.
  Complexity: S

- [ ] F178 — P1 — Require TLS for credentialed integration endpoints
  Why: both provider paths accept any `http:` or `https:` URL and send `x-api-key` / `Bearer` to it, so
  a typo'd `http://` endpoint transmits the user's API key in cleartext. Aviary redacts these same
  credentials on export; accepting a plaintext destination undoes that care.
  Evidence: `src/features/integrations/ai-provider.ts:68-76,106-110`,
  `src/features/integrations/semantic-search.ts:216-221`, `src/platform/settings.ts:880-891` (`urlValue`).
  Touches: `src/platform/settings.ts` (`urlValue` gains a scheme requirement for credentialed fields),
  the Integrations validation copy, settings tests.
  Acceptance: a credentialed endpoint that is not `https:` is rejected at save time with a stated
  reason and no request is made; a loopback host stays permitted for self-hosted providers if that is
  the decision, and the exception is written down.
  Complexity: S

- [ ] F179 — P1 — Serialize applyAll
  Why: three callers fire `void registry.applyAll(...)` with no coordination, and `applyAll` awaits each
  feature, so two passes interleave at microtask boundaries. Module-level guards such as
  `lastAppliedVersion` and `compiledSignature` are then set by one pass and make the other skip the
  rescan it needed — a whole class of "the feature did not re-apply after a settings change" bugs.
  Evidence: `src/main.ts:252-255,269-271,275-279` with `src/features/registry.ts:76-87`; guards at
  `src/features/filtering/hidden-posts-feature.ts:64-68`, `src/features/filtering/filter-engine.ts:108-111`.
  Touches: `src/features/registry.ts`, `src/main.ts`.
  Acceptance: concurrent requests coalesce into one in-flight pass plus at most one trailing run; a
  test that triggers three overlapping applies observes each feature applied to the final state and no
  guard-skipped rescan.
  Complexity: M

- [ ] F180 — P1 — Write the ad-rule mirror before the rule it mirrors
  Why: the dynamic DNR rule is committed first and the persisted mirror second, so a failing
  `storage.set` leaves the rule applied while the caller reports failure and the mirror still holds the
  previous value — and the next `restoreDynamicAdRule` reverts a rule the user actually enabled. Ad
  protection is default-on, so this fails toward less protection than the user asked for.
  Evidence: `src/extension/ad-rule.ts:87-96` with `src/main.ts:315-324`.
  Touches: `src/extension/ad-rule.ts`, `tests/dnr-ad-protection.test.mjs`.
  Acceptance: mirror and rule cannot disagree after any single failure — either the mirror is written
  first or the rule is rolled back when the mirror write fails; a test injects a failing storage write
  and asserts the post-restart state matches what the user chose.
  Complexity: S

- [ ] F181 — P1 — Localize the extension options page
  Why: the options page reads `chrome.storage.local.get("aviary.settings.v1")`, but settings are written
  through the profile gateway as `aviary.profile.<id>.settings.v1` into the durable IndexedDB backend.
  The lookup always misses and falls back to English, so the chosen locale never reaches the page — in a
  project that ships a 9-locale catalog and tests catalog drift.
  Evidence: `src/entrypoints/extension-options.ts:36` vs `src/platform/profile.ts:175-186`
  (re-checked 2026-08-17).
  Touches: `src/entrypoints/extension-options.ts`, a permissions-page locale test.
  Acceptance: choosing a non-English locale in the Control Center changes the options page on next
  open, including RTL direction; a test drives the real storage path rather than asserting the key
  string.
  Complexity: S

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

- [ ] F183 — P1 — Stop advertising an update channel that answers 404
  Why: the shipped metablock declares `@updateURL`/`@downloadURL` at
  `raw.githubusercontent.com/SysAdminDoc/Aviary/main/dist/aviary.user.js`, and both that URL and the
  repository page return HTTP 404 because the repository is private. Every installed copy polls a path
  that will never answer, and preflight cannot see it: it checks that the declared repository agrees
  with the `origin` remote, which it does. Agreement is not reachability. This is the engineering half
  of F125 and does not need the distribution decision — a metablock that omits an update channel is
  honest, one that names a dead one is not.
  Evidence: `curl` against both URLs returned 404 on 2026-08-17; `dist/aviary.user.js` metablock;
  `tools/preflight.mjs:207-215` (origin-agreement check only). Cross-reference F125 for the decision.
  Touches: `tools/userscript-meta.mjs`, `tools/preflight.mjs`, `docs/INSTALL.md`.
  Acceptance: either the metablock omits `@updateURL`/`@downloadURL` until a channel exists, or
  preflight verifies the declared URL actually resolves and fails when it does not; `docs/INSTALL.md`
  matches whichever is true.
  Complexity: S

- [ ] F184 — P1 — Remove real-user captures from the fixture set and its history
  Why: `_decoded/` is tracked and contains a full MHTML capture of a named account's post, handle and
  body text, plus a captured Home timeline. The repository enforces the opposite standard on its own
  synthetic fixtures, which store "no handles, post text, account/tweet ids, media, credentials,
  response bodies, or remote assets". Because it is in history, deleting the files does not remove it —
  so this is a hard prerequisite on the "make the repository public" branch of F125, and it should be
  done before that decision rather than during it.
  Evidence: `git ls-files _decoded` (26 files, 2026-08-17), `_decoded/captures.json` provenance block,
  `tests/fixtures/ad-corpus/` policy quoted in README.
  Touches: `_decoded/`, `_decoded/captures.json`, `tools/capture-decode.mjs` (scrub on decode),
  `.gitignore`, and a history rewrite.
  Acceptance: the tracked capture set carries no handle, display name, post body, avatar, or tweet id;
  the decode tool scrubs these on the way in so a future capture cannot reintroduce them; the selectors
  currently proved against these files are still proved; history no longer contains the originals.
  Depends on: sequence with F134's refreshed capture — scrub the tool first, then capture once, cleanly.
  Complexity: M

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
