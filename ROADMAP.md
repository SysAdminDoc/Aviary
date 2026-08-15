# Aviary ROADMAP

Version: `1.24.0`

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
  Complexity: L

- [ ] F140 — P1 — Test accessibility by rendering, not by reading source
  Why: `tests/audit-a11y.test.mjs` asserts literal source strings such as `overlay.toggleAttribute("inert", !open)`, so a rename fails a passing behaviour and a real regression that keeps the string passes. Contrast is already gated properly in `theme-matrix.test.mjs`; interaction and semantics are not.
  Evidence: `tests/audit-a11y.test.mjs:11-28`; `tests/theme-matrix.test.mjs:134-138`.
  Touches: `tests/audit-a11y.test.mjs`, the existing Playwright harness under `tests/visual/`.
  Acceptance: the panel is mounted and driven — focus order, `inert` on close, Escape, focus return, modal semantics, and every control's accessible name are read from the live accessibility tree; the source-regex assertions are deleted, not kept alongside.
  Complexity: M

### P2 — features

- [ ] F144 — P2 — Say why a post was filtered
  Why: a filter that hides silently is indistinguishable from a bug, and the v1.24.0 rule DSL already knows which condition matched. It is the single best trust affordance a filter engine can add, and the same request is open against the closest architectural twin.
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
  Complexity: L

- [ ] F148 — P2 — Catch-up digest over the seen-post store
  Why: v1.24.0 shipped the hard half — a bounded record of which posts have already gone past — and the best reading-mode idea in the adjacent field is what sits on top of it: a time-bounded digest of what is new, grouped by author.
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
  Touches: package.json (`typecheck` script, devDependency), `.github/workflows/smoke.yml`, tsconfig defaults that changed in 7.0.
  Acceptance: `npm run typecheck` runs on the native compiler and reports the same diagnostics as the TypeScript 6 pin on a deliberately broken file; lint still runs on the TypeScript 6 parser; CI time drops measurably.
  Complexity: S

## Research-Driven Additions (2026-08-15, second pass)

Internal audit of the subsystems no prior pass had examined, plus the code added earlier on 2026-08-15. Findings verified against source before listing; file:line cited on each.

### P2 — reliability

- [ ] F158 — P2 — CI must trigger on the files its gates read
  Why: the workflow's paths filter lists `src/**`, `tests/**`, `tools/**` and configs, but not `_decoded/**` or `docs/**` — so a capture refresh (the highest-priority operator action) or a docs edit that breaks the FAQ settings reference never runs the workflow that gates them.
  Evidence: `.github/workflows/smoke.yml:7-15`, read 2026-08-15.
  Touches: `.github/workflows/smoke.yml`.
  Acceptance: pushes touching only `_decoded/**` or `docs/**` trigger the workflow; the paths list carries a comment naming which gate reads each entry.
  Complexity: S

- [ ] F159 — P2 — A blocked XHR must complete as an error, not vanish
  Why: the page agent's `patchedSend` returns without dispatching any completion event for a refused logger call, while the sibling fetch and sendBeacon paths deliberately fake benign completion — an X callback gating a retry queue on XHR completion would hang or back up.
  Evidence: `src/page/page-agent.ts:454-466` vs the fetch (204) and sendBeacon (`true`) paths; asymmetry confirmed 2026-08-15.
  Touches: `src/page/page-agent.ts`, page-agent tests.
  Acceptance: a refused XHR fires `readystatechange` to DONE with a network-error shape (status 0), consistent with how an offline request presents; the fetch and beacon behaviours are unchanged; a test drives an XHR through the patched path and observes completion.
  Complexity: S

- [ ] F160 — P2 — Stop persisting a failed import's full archive, and stop rewriting it per tick
  Why: each archive-import job records the entire base64 source (up to ~341 MB) inside the job store, `#persist` rewrites all retained jobs' state on every progress tick, and only `complete()` drops the source — failed, paused, and cancelled jobs pin their full copies until 12 newer jobs push them out. Multi-hundred-MB writes per tick, guaranteed quota failure on the fallback backends.
  Evidence: `src/features/library/archive-import-jobs.ts:100` (source in record), `:237-246` (full-state persist per tick); confirmed 2026-08-15.
  Touches: `src/features/library/archive-import-jobs.ts`, archive-import tests.
  Acceptance: the source is stored once under its own key and deleted on every terminal state, not only success; progress ticks write progress, not the archive; a failed 250 MB import leaves no orphaned source; resume still works.
  Complexity: M

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

- [ ] F163 — P3 — Gate every capture's age, and expire the waiver in local-day terms
  Why: the age gate reads only the newest capture, so one fresh `home.html` masks an arbitrarily stale `status.html`; and the waiver compares local time against a UTC day-end, expiring early evening of its stated day in US timezones.
  Evidence: `tools/capture-manifest.mjs:66-75`; confirmed 2026-08-15.
  Touches: `tools/capture-manifest.mjs`, `tests/fixtures.test.mjs`.
  Acceptance: the report carries per-capture over-ceiling state and preflight names each stale capture, not just the newest; the waiver covers the whole stated day in local time; the existing waiver tests pin both.
  Complexity: S

- [ ] F164 — P3 — Small-defect sweep, each verified at the cited line
  Why: four small defects from the 2026-08-15 audit, none worth a solo item, all cheap while the files are open.
  Evidence: `src/features/library/archive-import.ts:327-331` — `stripPrefix` eats everything to the first `=` anywhere, destroying un-prefixed pure-JSON input containing `=` (base64 padding, query strings); `src/features/filtering/seen-posts-feature.ts:54-57,156-165` — `destroy` clears the flush timer without flushing (up to 1.5 s of marks dropped) and leaves the module-level store populated; `src/features/filtering/hidden-posts-feature.ts:49-58` — every apply pass while disabled appends then removes a style element (DOM churn per mutation batch); `src/platform/profile.ts:103` — a `Date.now()`-plus-count id, the same collision pattern the repo's Learned notes fixed in bookmarks.
  Touches: those four files and their tests.
  Acceptance: each fix carries a test or a tightened assertion; `stripPrefix` only strips a leading `window.YTD`-shaped prefix; destroy flushes before clearing; the disabled path exits before touching the DOM; ids use `crypto.randomUUID()`.
  Complexity: S

- [ ] F165 — P3 — Uninstall the page agent's patches only if they are still Aviary's
  Why: teardown restores `window.fetch` and the XHR prototype by assignment, so a wrapper installed after Aviary's (X's own instrumentation, another extension) is silently destroyed with it.
  Evidence: `src/page/page-agent.ts:479-488`; mechanism confirmed 2026-08-15.
  Touches: `src/page/page-agent.ts`, page-agent tests.
  Acceptance: teardown restores the original only when the current value is Aviary's wrapper; otherwise it flips the wrapper inert and leaves the chain intact, and diagnostics say which path was taken.
  Complexity: S
