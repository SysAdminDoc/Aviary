# Aviary ROADMAP

Version: `1.37.0`

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

## Research-Driven Additions (2026-08-14)

### P2, high-value features

- [ ] F118, P2, Media download depth: downloaded badges, text sidecar, batch-from-library
  Why: the install-weighted greasyfork market is media-first; TMH's backlog names exactly these (downloaded-media highlighting #126, tweet-text sidecar #283, batch #137), and Aviary already has downloadHistory, filename templates, and captured records to build on without new API calls.
  Evidence: TwitterMediaHarvest issues; RESEARCH.md Competitive (ban-risk line: batch consumes captured/library records only).
  Touches: src/features/media/* (badge pass keyed on downloadHistory), export/collector records, library UI (batch action), settings.
  Acceptance: previously saved media shows a subtle marker; optional .json/.txt sidecar per save; "download all captured media for this collection" works checkpointed with zero originated GraphQL calls.
  Complexity: L

- [ ] F129, P3, Per-module custom CSS escape hatch
  Why: table stakes in OldTwitter/TUIC/GT2 lineage for power users; bounded per-module scoping keeps it reversible and off the support path.
  Evidence: TUIC CSS packs; OldTwitter custom CSS; RESEARCH.md Competitive.
  Touches: settings (per-module css string), theme/feature style injection, Trust copy (unsupported-styles disclaimer).
  Acceptance: user CSS applies within a module's scope attribute, survives reload, and is excluded from bug-report expectations; off by default.
  Complexity: M
  Note (2026-08-15): build the injection on CSS `@scope` (Chrome 118 / Firefox 146 / Safari 26.4, and esbuild parses it since 0.27.3) rather than an attribute-prefix rewrite. If Aviary ever publishes, the store-compliant route for user-supplied *script* is the `chrome.userScripts` `USER_SCRIPT` world, which is exempt from page CSP, but that needs manifest floors raised, so keep this item CSS-only.

## Research-Driven Additions (2026-08-15)

### P1, trust, reliability, and measured defects

### P2, features

- [ ] F145, P2, Portable rule sets
  Why: `src/features/filtering/rules.ts` has no import or export path, so a rule set cannot be shared, backed up outside settings, or restored to a second profile, and rule packs are how every rule-engine competitor grows.
  Evidence: `src/features/filtering/rules.ts` exports only `compileRules`/`evaluateRules`; control-panel-for-twitter#864, rxliuli's importable rule packs.
  Touches: `src/features/filtering/rules.ts`, Filtering panel, library backup, settings export.
  Acceptance: a rule set exports to and imports from a documented plain-text or JSON form, reports parse errors per line before applying, previews what a paste would add or replace, and rides the existing backup.
  Note (2026-08-19): F204 put the title and the lifetime *inside* the rule line rather than beside
  it, precisely so this item has nothing extra to carry, the plain-text form already round-trips
  both. A JSON form would have to reproduce them as fields; prefer the text form.
  Complexity: M

- [ ] F147, P2, WACZ export and self-replay
  Why: Aviary emits raw uncompressed WARC while the browser-side archiving ecosystem has standardized on WACZ, whose client-side replay engine means an Aviary archive would open in every Webrecorder tool for a packaging change rather than a capture change.
  Evidence: WACZ 1.1.1 + CDXJ 0.1.0 specs, read 2026-08-15, implementable from this item without re-research. Layout: `archive/` (>=1 WARC), `indexes/` (>=1 CDXJ), `pages/pages.jsonl`, `datapackage.json` (`profile: "data-package"`, `wacz_version: "1.1.1"`, `resources[]` each name/path/hash/bytes with `sha256:` prefix), plus `datapackage-digest.json` `{path, hash-of-datapackage.json}`. CDXJ line = `<SURT> <YYYYMMDDHHMMSS> <JSON: url,digest,mime,status,filename,offset,length>`, lines sorted in LC_ALL=C byte order; SURT = lowercased host reversed comma-form (`com,example)/path`). pages.jsonl header `{"format":"json-pages-1.0","id":"pages","title":"All Pages"}`, entries need `url` + RFC3339 `ts`. Plain uncompressed `.warc` is spec-valid, gzip is optional, and if ever added it must be per-record so offset/length address one member.
  Touches: `src/features/export/warc.ts`, a new WACZ packager, export format list, docs/FAQ.md.
  Acceptance: the WACZ validates against the spec and opens in replayweb.page; opt-in beside WARC; storage cost stated before the run. CRITICAL: the `archive/` and `indexes/` members must go through `buildStoreZip` (STORE), not the F137 DEFLATE path, replay reads records by offset/length inside the member, which a deflated member cannot serve. Do not vendor wabac.js (AGPLv3): self-replay means linking to replayweb.page, not embedding the engine.
  Depends on: F137 (shipped 2026-08-15, the writer now exposes both `buildZip` and `buildStoreZip`; this item needs the STORE path).
  Note (2026-08-17): two replay-correctness corrections found before build, both from primary specs.
  (a) A response-only WARC is not replayable for anything POSTed, WARC 1.1 pairs `request` and
  `response` through `WARC-Concurrent-To`, and pywb's POST replay works by matching adjacent request
  records. (b) More decisively, pywb's POST-body canonicalization does not cover JSON/GraphQL bodies at
  all, and its form-urlencoded path is documented as broken against the outbackcdx fix
  (webrecorder/pywb#768). So captured GraphQL written as `response` records will not replay in
  replayweb.page. Write GraphQL captures as **`resource` records with a synthetic URI**, and reserve
  `response` records for genuine HTTP GETs (media, images). Also add a `warcinfo` record first in each
  file, keep `WARC-Payload-Digest` and `WARC-Block-Digest` distinct (payload digest must not be written
  on records with no well-defined payload), and consider `revisit` records with
  `identical-payload-digest` for cross-export dedup, that is the standards-blessed answer to the same
  avatar appearing in thousands of captures, and it pairs with F189.
  Complexity: L

- [ ] F148, P2, Catch-up digest over the seen-post store
  Why: v1.25.0 shipped the hard half, a bounded record of which posts have already gone past, and the best reading-mode idea in the adjacent field is what sits on top of it: a time-bounded digest of what is new, grouped by author.
  Evidence: `src/features/filtering/seen-posts.ts`; cheeaun/phanpy Catch-up (★1478).
  Touches: `src/features/filtering/seen-posts.ts`, a new reading surface, Layout settings.
  Acceptance: a digest built only from the local seen record and already-rendered posts, zero originated requests, groups unseen posts by author over a chosen window, respects active filters, and shows filter reasons from F144 where a post was suppressed.
  Depends on: F144, shipped 2026-08-19. `judge()` in `src/features/filtering/predicates.ts`
  returns `{ action, cause }`, and the engine writes the localized sentence to
  `data-av-filter-reason`; a digest can read the same verdict rather than inventing its own.
  Note (2026-08-18): the reference implementation is Phanpy's Catch-up
  (https://github.com/cheeaun/phanpy/blob/main/src/pages/catchup.jsx) and it is detailed enough to build
  from without re-research. Window: a slider of 13 ranges (last 1h..12h, plus "beyond 12 hours"). Category
  chips with live counts: Original / Replies / Quotes / Reposts / Followed tags / Filtered. Five sort axes
  cover time, replies, likes, reposts, and **density**, where
  `density = (textLen + spoilerLen + pollLen)/140 + 8*mediaCount + 8*(hasCard ? 1 : 0)`; ascending puts
  cheap-to-read first. Optional grouping by author, authors ordered by post count descending. A Top Links
  pane deduped by URL, ranked by sharer count then reposts then likes, keeping links shared more than once
  or the top 10, each showing "Shared by [avatars]" where clicking a sharer filters to them. One-line post
  peeks with media as small thumbnails. Crucially it **marks nothing read**, it persists only the filter
  selection and scroll position, and ends with "That's all." Aviary's version is a render of the local
  seen store rather than a fetch, so the honest framing is "everything Aviary saw", not "everything posted".
  Pair with F203, which supplies the read marker Catch-up deliberately does not use.
  Complexity: L

- [ ] F154, P2, Mirror bookmarks locally as they render, and export them in bulk
  Why: bookmarks are the clearest unserved need in the archiving communities, users report collections shrinking from hundreds to about twenty, and the standing explanation is that X does not delete them server-side, they simply stop being rendered (one third-party client listed five digits of bookmarks the UI would not show). Aviary already has a bookmark library and passive GraphQL capture, so mirroring what X hands the page needs no originated call.
  Evidence: r/Twitter 1uyh6kw (2026-07-16), 1vbkkzr (2026-07-31), 1vlyntp (2026-08-12); r/DataHoarder 1vo86y2 (2026-08-14); HN 47697679 (2026-04-08, a Show HN bookmark-export one-off, people build this themselves); twitter-web-exporter's bookmark-cap bypass is the same mechanism. Verified 2026-08-15: `network-capture.ts` persists any GraphQL operation when `preserveRawPayloads` is on, so bookmark payloads already reach the store, this is a reader over captured data, not a new capture path.
  Touches: `src/features/export/network-capture.ts` (bookmark operations), `src/features/library/`, export formats, Library panel.
  Acceptance: bookmarks seen in a captured payload are mirrored into the local library with their timestamp, survive disappearing from X's UI, and export in bulk; the mirror records only what X sent to the page, with zero originated requests; the panel states plainly that it can only hold what has been scrolled past.
  Complexity: M

- [ ] F150, P2, Media follow-ons beyond F118
  Why: the media backlog of the benchmark saver names four things Aviary can serve from records it already holds, without a single originated call.
  Evidence: TwitterMediaHarvest#336 (subtitles), #103 (audio-only), #316 (group by account), #323 (history export by date range).
  Touches: `src/features/media/*`, `history.ts`, filename template tokens, Media panel.
  Acceptance: each capability works only from captured or already-downloaded records; download history exports over a chosen date range; grouping is a filename-template token rather than a new store.
  Depends on: F118.
  Complexity: M

### P3, toolchain

- [ ] F151, P3, Typecheck on the native TypeScript compiler
  Why: `npm run typecheck` is pure `tsc --noEmit`, nothing consumes the programmatic API, so it can move to the Go-native compiler for an 8 to 12× faster gate while TypeScript 6 stays installed for the lint parser, which cannot run on 7.0 until 7.1 restores the API.
  Evidence: TypeScript 7.0 GA 2026-07-08; typescript-eslint#10940; package.json scripts.
  Touches: package.json (`typecheck` script, devDependency), tsconfig defaults that changed in 7.0.
  Acceptance: `npm run typecheck` runs on the native compiler and reports the same diagnostics as the TypeScript 6 pin on a deliberately broken file; lint still runs on the TypeScript 6 parser; local verification time drops measurably.
  Note (2026-08-18): **demote, the premise holds but the payoff was measured and it is 1.4 seconds.**
  The parser constraint is confirmed: `@typescript-eslint/parser@8.67.0` declares
  `peerDependencies.typescript "<6.1.0"`, and TS 7.0 ships no programmatic API (it lands in 7.1). The
  acceptance criterion was run: against this repo's `src/` plus a deliberately broken file, TS 6.0.3 and
  TS 7.0.2 emitted byte-identical diagnostics, at **1.288s vs 0.276s**, and TS 7 needed no tsconfig
  changes. But the whole gate is ~8.6s (`typecheck` 1.63s, `lint` 2.21s, `build` 0.25s, 502 tests 4.53s),
  so the 8 to 12× multiplier applies to 1.6 seconds. The cost is a dual-TypeScript install plus a real trap:
  under the alias layout `node_modules/.bin/tsc` still resolves to 6.x, so a bare `tsc --noEmit` silently
  keeps using the old compiler and the migration looks done when it is not. Revisit at TS 7.1, when the
  parser can move and this collapses to a single-package bump.
  Complexity: S

## Research-Driven Additions (2026-08-15, second pass)

Internal audit of the subsystems no prior pass had examined, plus the code added earlier on 2026-08-15. Findings verified against source before listing; file:line cited on each.

### P2, reliability

### P3, small measured defects

## Research-Driven Additions (2026-08-16)

Focused comparison of 46 primary sources for feed image/video download behavior. See RESEARCH.md.

## Research-Driven Additions (2026-08-17)

General pass over the subsystems no prior research examined (the 2026-08-16 pass was media-only).
Every defect below was read at the cited line; the five marked (re-checked) were independently
confirmed a second time. See RESEARCH.md.

### P1, measured defects, root cause first

### P1, trust and verification

### P2, platform primitives that delete hand-rolled code

- [ ] F185, P2, Move menus, toasts and the panel to the Popover API
  Why: it is free at both declared manifest floors, Chrome 116 is exactly `minimum_chrome_version`, and
  Firefox 125 is below the 128 floor, and it replaces hand-rolled top-layer work with platform
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

### P2, archive fidelity

- [ ] F188, P2, Sign and self-describe archive packages
  Why: WACZ carries a `datapackage-digest.json` whose anonymous-ECDSA scheme was designed for exactly
  Aviary's situation, a decentralized tool with no domain certificate, and ReplayWeb.page renders an
  integrity badge when it validates. Combined with the per-file SHA-256 resource list Aviary already
  computes for its manifest, this turns an export into something a third party can verify without
  trusting the exporter, using WebCrypto and no runtime dependency.
  Evidence: https://github.com/webrecorder/wacz-auth-spec/blob/main/spec.md (read 2026-08-17);
  https://specs.webrecorder.net/wacz/1.1.1/ `datapackage.json` resources block.
  Touches: the F147 WACZ packager, `src/features/export/assets.ts` (digests already exist),
  Export panel copy, `docs/FAQ.md`.
  Acceptance: a signed package validates against the spec and shows a verified badge in
  replayweb.page; the keypair is generated and stored locally, is exportable, and is excluded from
  redacted backups; signing is opt-in and an unsigned package remains spec-valid. SHA-256 only.
  py-wacz offers MD5 and it must not be used.
  Depends on: F147.
  Complexity: M

- [ ] F190, P2, Repair X archive imports from the captured corpus
  Why: X's own export is documented as losing four things Aviary can restore locally, t.co links are
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

- [ ] F191, P2, Fuse lexical ranking into local search
  Why: the local library search and the opt-in semantic index are separate paths, and pure vector
  ranking is worst exactly where this corpus is queried most, exact handles, exact phrases, and rare
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

## Research-Driven Additions (2026-08-18)

Completes the 2026-08-17 pass, which lost most of its external streams to an API limit. Defects
below were read at the cited line. See RESEARCH.md.

### P1, accessibility

### P1, delivery integrity

### P2, leapfrog

- [ ] F202, P2, Read X's "Under the Hood" export locally
  Why: on 2026-08-13 X began letting eligible users download a JSON of aggregate stats showing whether
  visibility-limiting labels were applied to their account or posts in the past month. It is a file the
  user already has, so reading it originates nothing and crosses no line Aviary draws, and nobody has
  built a reader. Aviary already owns the surfaces this needs: a local library, an import path, and a
  panel to render it in.
  Evidence: https://techcrunch.com/2026/08/13/x-open-sources-its-ranking-algorithm-letting-users-see-if-theyve-been-shadowbanned/ ;
  https://github.com/xai-org/x-algorithm (Apache-2.0).
  Touches: `src/features/library/archive-import.ts` (same import shape), a new Trust or Library surface,
  export formats.
  Acceptance: the user picks the JSON X gave them and sees which labels were applied and when, held
  locally and included in library backup; month-over-month comparison works from stored reports; the
  panel states plainly that this is X's own summary of itself and that the published ranking weights are
  not proof of what runs in production, the export is the user's data, the weights are not.
  Complexity: M

### P2, local reading, all zero-network

- [ ] F203, P2, A read marker, a "new since you last looked" line, and hide-seen
  Why: `seen-posts.ts` already records what has gone past, and the highest-value thing to build on it is
  the oldest idea in feed reading: a position marker. Mastodon's markers API is the reference schema
  (`last_read_id` per surface) and X's snowflake ids are ordinal, so "newer than" needs no timestamps.
  NetNewsWire's per-feed read filter is the interaction, and its stated rationale for making unread
  counts optional, that badges are "distracting, less meaningful, or even stressful", is the right
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

- [ ] F207, P2, Rebuild threads from what has already been captured
  Why: "archive a thread including all the replies" is a standing unmet request, and Aviary is unusually
  well placed: it already persists GraphQL payloads and `viewer.ts` already groups exported records by
  `conversationId`, but nothing reconstructs a chain for reading. The algorithm is published, merge
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

### P1, toolchain and claims (added 2026-08-18, second pass)

- [ ] F211, P2, Import the sources under test instead of bundling them first
  Why: 82 of 91 test files bundle through esbuild and import the result, which puts a build step between
  every assertion and the code it describes, and is part of why so many tests fell back to regexing
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
  regress. Do this for directness, not speed, the suite is already ~4.5s.
  Note (2026-08-18): F182 landed first, so this no longer blocks it. The 13 driven test files it
  added all bundle through esbuild, which is more surface for this to convert but also a clearer one:
  every new file uses the same helper shape.
  Complexity: L
