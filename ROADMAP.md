# Aviary ROADMAP

Version: `1.23.0`

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

- [ ] F136 — P1 — Watch every selector a feature depends on, and show the user
  Why: selector health watches 10 surfaces while features reference 56 distinct `data-testid` selectors, so a rename in any of the ~46 unwatched ones silently disables its owning feature. It is also the most-requested thing in a rival's backlog: a way for the user to check whether the tool still works.
  Evidence: `src/platform/selectors.ts` SURFACE_SELECTORS (10 entries) vs 56 distinct testids across `src/features` and `src/ui`; TwitterMediaHarvest#54.
  Touches: `src/platform/selectors.ts`, `src/features/core/selector-health.ts`, the Trust page, per-feature `getStatus()`.
  Acceptance: every selector a feature relies on is registered with its owning feature id and relevance; Trust lists which features are healthy, degraded, and why, on the live page; a deliberately broken selector shows up there and in `getStatus()` rather than failing silently.
  Complexity: M

- [ ] F137 — P1 — Compress archives with the browser's own DEFLATE
  Why: `zip-store.ts` writes `method = STORE` and assembles the whole archive as one `Uint8Array`, while `zip-reader.ts` already inflates with `DecompressionStream("deflate-raw")`. The write side is asymmetric for no reason; text-heavy exports (JSON/CSV/HTML/WARC/XLSX) compress several-fold, and the in-memory ceiling is a real reported failure in the closest analog.
  Evidence: `src/features/export/zip-store.ts:78`, `src/features/export/zip-reader.ts:113-115`; `CompressionStream("deflate-raw")` Baseline (Chrome 103 / Firefox 113 / Safari 16.4); twitter-web-exporter#137 ("over 500 media items breaks ZIP export").
  Touches: `src/features/export/zip-store.ts`, `xlsx.ts`, `export-feature.ts`, `warc.ts` (`.warc.gz` via `CompressionStream("gzip")`), `tests/export.test.mjs`.
  Acceptance: archives round-trip through Aviary's own reader and an external unzip; XLSX still opens in Excel; a size assertion proves compression on a text-heavy fixture; the entry/size ceilings either gain ZIP64 or report the limit before the run rather than throwing part-way.
  Complexity: M

- [ ] F138 — P1 — Take the translation catalog off the document-start path
  Why: the built userscript is 1,862,668 characters and `src/platform/i18n-catalog.ts` is 1,011,863 of them — 54.3% — parsed synchronously on every X page load before first paint, to serve a settings panel that is usually never opened. All nine locales ship to every user.
  Evidence: measured against `dist/aviary.user.js` 2026-08-15 (module-boundary sizes in RESEARCH.md Architecture); `@run-at document-start` in the metablock and `run_at: document_start` in both manifests.
  Touches: `src/platform/i18n-catalog.ts`, `src/platform/i18n.ts`, `tools/build.mjs` (emit the catalog as a deferred payload — a lazily parsed JSON string in the userscript, a web-accessible chunk in the extension), boot path.
  Acceptance: the document-start payload drops by at least half; panel copy still resolves on first open with no visible delay; the i18n extract/sync pipeline and the drift tests still pass unchanged; the userscript remains a single readable file.
  Complexity: L

- [ ] F139 — P1 — Restore what X's August 2026 media redesign changed
  Why: X replaced the 2x2 multi-image grid with an Instagram-style carousel (2026-08-11) and removed the desktop profile media grid, defaulting the Media tab to Videos and moving Likes into a dropdown (2026-08-13). These are the two highest-engagement X-UI complaint threads of the window — 235 points/82 comments and 61 points/17 comments — both carrying explicit unmet demand ("trying to find an extension to revert this", "waiting for some hero on Greasyfork/Github"), and the category leader has not pushed since 2026-07-05. The carousel additionally fails to render media on Firefox 153, which nothing currently fixes.
  Evidence: control-panel-for-twitter#917/#918/#919 (GitHub API, 2026-08-15); r/Twitter 1vng9ak and 1vlugpd (2026-08-13, 2026-08-11); Firefox render break corroborated 2026-08-14 (RESEARCH.md Sources). Working community fixes name the flags: `rweb_media_carousel_enabled` (uBO scriptlet) and `responsive_web_profile_redesign_enabled` (a trusted `$replace=` filter most users cannot enable — an in-page flip is strictly better).
  Touches: `src/features/layout/`, the page agent (flag write before X's first read), settings, `_decoded/` fixtures, feature tests, Roadmap_Blocked.md F115.
  Acceptance: each restored behaviour is verified against the refreshed capture from F134 and fixture-tested; flag names live in a data file that can be updated without a rebuild, never compiled into a feature; a flag that no longer exists degrades loudly through selector health rather than silently doing nothing; anything the capture does not contain goes to Roadmap_Blocked.md with its measurement rather than shipping on a guess.
  Depends on: F134, F115's re-entry condition.
  Complexity: L

- [ ] F140 — P1 — Test accessibility by rendering, not by reading source
  Why: `tests/audit-a11y.test.mjs` asserts literal source strings such as `overlay.toggleAttribute("inert", !open)`, so a rename fails a passing behaviour and a real regression that keeps the string passes. Contrast is already gated properly in `theme-matrix.test.mjs`; interaction and semantics are not.
  Evidence: `tests/audit-a11y.test.mjs:11-28`; `tests/theme-matrix.test.mjs:134-138`.
  Touches: `tests/audit-a11y.test.mjs`, the existing Playwright harness under `tests/visual/`.
  Acceptance: the panel is mounted and driven — focus order, `inert` on close, Escape, focus return, modal semantics, and every control's accessible name are read from the live accessibility tree; the source-regex assertions are deleted, not kept alongside.
  Complexity: M

- [ ] F141 — P1 — Close the install-script supply-chain class and pin the Node floor
  Why: every major 2026 npm compromise executed through install scripts, and with zero runtime dependencies `--ignore-scripts` costs nothing. `engines.node` is `">=22"`, loose enough to admit releases superseded by the June and July 2026 Node security releases.
  Evidence: package.json:14-16; Node security releases 2026-06-18 and 2026-07-29; CISA axios alert 2026-04-20; keyv/cacheable and node-gyp worm write-ups (RESEARCH.md Sources).
  Touches: package.json, `.github/workflows/smoke.yml`, docs/INSTALL.md, README development section.
  Acceptance: CI installs with `npm ci --ignore-scripts` and still passes the full verify chain; `engines.node` names a patched floor; the contributor docs say why.
  Complexity: S

- [ ] F142 — P1 — Stop committing build artifacts on every commit
  Why: `dist/` blobs total 542.6 MB across history (93.4 MiB packed), of which 277.9 MB is 230 versioned extension-ZIP blobs — incompressible, and rebuilt by `npm run verify` on every feature commit rather than every release.
  Evidence: measured over `git rev-list --objects --all` 2026-08-15; `git count-objects -vH` size-pack 93.42 MiB.
  Touches: .gitignore, `tools/preflight.mjs` or the release recipe in CLAUDE.md.
  Acceptance: `dist/extension-*-v*.zip` is untracked and produced at release time; `dist/aviary.user.js` stays tracked because `@downloadURL` resolves to it, but is refreshed on release commits rather than every commit; the release recipe states where the ZIPs go. History rewriting is explicitly out of this item.
  Complexity: S

- [ ] F143 — P1 — Drop the match targets X retired
  Why: both manifests and the userscript metablock match `mobile.twitter.com` and `tweetdeck.twitter.com`, surfaces X retired in 2023. They widen the install permission prompt — the thing that scares users off an extension — and match nothing.
  Evidence: `src/extension/manifest.chrome.json`, `manifest.firefox.json`, `tools/build.mjs` metablock; `dist/aviary.user.js` header.
  Touches: both manifests, the metablock in `tools/build.mjs`, `tests/release-matrix.test.mjs` route list, docs/INSTALL.md, docs/PRIVACY.md.
  Acceptance: each declared host is confirmed to still serve an X surface before the list is trimmed; the permission prompt shrinks accordingly; route tests cover only surviving hosts.
  Complexity: S

- [ ] F153 — P1 — Prove Aviary's refusals exclude X's detection probes, and say so
  Why: the community fix for X's ad-blocker notice is not to hide anything — it is to stop blocking two XHRs, `x.com/i/api/1.1/flow/viewer.json` and `x.com/i/api/*/viewer_context.json`. The reported trigger is a probe request *failing*, not an ad rendering, and the reported symptom is often not the banner at all but "An error has occurred but it's not your fault", a blank feed, or search returning nothing — which users misread as an X outage. Aviary's `privacy.networkShield` refuses exactly one logger, so it should be provably clear of both probes; that is worth asserting rather than assuming, because it is the difference between "safe by design" and "safe by luck".
  Evidence: r/Twitter 1uya7kz and 1uz8yjf (2026-07-16/17), including the allowlist comment; PiunikaWeb 2026-07-10. Community claim — the endpoint behaviour needs one devtools session to confirm.
  Touches: `src/features/privacy/ad-protection.ts`, the DNR rule set, `tests/dnr-ad-protection.test.mjs`, Trust copy.
  Acceptance: a test names both probe URLs and asserts neither is matched by any Aviary rule or page-world stub, in both builds; Trust states which single request Aviary refuses and which it deliberately does not; the co-installed-blocker case is documented, since a second blocker was the actual cause in at least one report.
  Complexity: S

### P2 — features

- [ ] F144 — P2 — Say why a post was filtered
  Why: a filter that hides silently is indistinguishable from a bug, and the v1.23.0 rule DSL already knows which condition matched. It is the single best trust affordance a filter engine can add, and the same request is open against the closest architectural twin.
  Evidence: XKit-Rewritten#1664 (👍4); `src/features/filtering/rules.ts` `evaluateRules` already returns the deciding rule.
  Touches: `src/features/filtering/rules.ts`, `filter-engine.ts`, `hidden-posts-feature.ts`, the dim/hide affordance, Filtering panel.
  Acceptance: a hidden or dimmed post names the rule or predicate that caught it, in text, on hover or reveal; the reason is derived from the decision rather than recomputed; nothing is stored per post.
  Complexity: M

- [ ] F145 — P2 — Portable rule sets
  Why: `src/features/filtering/rules.ts` has no import or export path, so a rule set cannot be shared, backed up outside settings, or restored to a second profile — and rule packs are how every rule-engine competitor grows.
  Evidence: `src/features/filtering/rules.ts` exports only `compileRules`/`evaluateRules`; control-panel-for-twitter#864, rxliuli's importable rule packs.
  Touches: `src/features/filtering/rules.ts`, Filtering panel, library backup, settings export.
  Acceptance: a rule set exports to and imports from a documented plain-text or JSON form, reports parse errors per line before applying, previews what a paste would add or replace, and rides the existing backup.
  Complexity: M

- [ ] F146 — P2 — Search the Control Center
  Why: 13 destinations and well over a hundred controls, with no way to find one by name; asking for settings search is a standing request against the comparable panel.
  Evidence: control-panel-for-twitter#430; `src/ui/control-center.ts` renders 13 destinations.
  Touches: `src/ui/control-center.ts`, `src/ui/control-center/sections/*`, i18n catalog.
  Acceptance: typing filters rows across every destination by label and description, states which destination each match lives in, is reachable without a keyboard shortcut, and clears back to the full panel.
  Complexity: M

- [ ] F147 — P2 — WACZ export and self-replay
  Why: Aviary emits raw uncompressed WARC while the browser-side archiving ecosystem has standardized on WACZ, whose client-side replay engine means an Aviary archive would open in every Webrecorder tool for a packaging change rather than a capture change.
  Evidence: webrecorder/archiveweb.page (★1540) and replayweb.page (★969), both pushed within days of 2026-08-15; WACZ spec (RESEARCH.md Sources); `src/features/export/warc.ts` writes plain records.
  Touches: `src/features/export/warc.ts`, a new WACZ packager over the ZIP writer, export format list, docs/FAQ.md.
  Acceptance: the WACZ validates against the published spec, contains the CDXJ index and datapackage, opens in replayweb.page, and is an opt-in format beside WARC rather than a replacement; storage cost is stated in the panel before the run.
  Depends on: F137 (the ZIP writer it packages with).
  Complexity: L

- [ ] F148 — P2 — Catch-up digest over the seen-post store
  Why: v1.23.0 shipped the hard half — a bounded record of which posts have already gone past — and the best reading-mode idea in the adjacent field is what sits on top of it: a time-bounded digest of what is new, grouped by author.
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
  Evidence: r/Twitter 1uyh6kw (2026-07-16), 1vbkkzr (2026-07-31), 1vlyntp (2026-08-12); r/DataHoarder 1vo86y2 (2026-08-14); twitter-web-exporter's bookmark-cap bypass is the same mechanism.
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
  Touches: package.json (`typecheck` script, devDependency), `.github/workflows/smoke.yml`, tsconfig defaults that changed in 7.0.
  Acceptance: `npm run typecheck` runs on the native compiler and reports the same diagnostics as the TypeScript 6 pin on a deliberately broken file; lint still runs on the TypeScript 6 parser; CI time drops measurably.
  Complexity: S
