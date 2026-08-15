# Research — Aviary for X

Date: 2026-08-15 (second pass, post-v1.24.0) — replaces all prior research, including the earlier
2026-08-15 pass, whose P0/P1 conclusions were drained into v1.24.0 the same day and are archived in
CHANGELOG.md.

## Executive Summary

Aviary is a local-first desktop X enhancer shipping a readable userscript and an MV3 extension
(Chrome + Firefox) from one TypeScript source with zero runtime dependencies, at v1.24.0 with 482
passing tests. The morning pass established that the stale capture set (2026-05-19) is the binding
constraint and v1.24.0 gave it a dated manifest, an expiring gate, and a one-command refresh. This
pass audited what no pass had ever examined — the storage layer, library backup, integrations, the
page agent, and the code shipped earlier the same day — and the headline is that **the capture
decoder itself has two defects that would poison the refreshed ground truth**: quoted-printable
decoding mangles every UTF-8 multibyte character (reproduced), and a cookie-shape `ct0=` value
passes both the scrub and its own leak guard. The operator capture everything waits on must not be
run until F155 lands. Beneath that, the audit found one genuine data-loss path (a transient
IndexedDB failure silently reverts a session's writes), one completeness hole (the seen-posts store
is invisible to migration, profiles, and backup), and a systemic cross-tab last-writer-wins hazard.
The external field did not move in the intervening hours — verified, not assumed.

Top opportunities in priority order:
1. Fix the capture decoder before the operator uses it (scrub gap + mojibake) — P0, F155.
2. Stop a transient IndexedDB failure from silently shedding a session's writes — P1, F156.
3. Register the seen-posts store in migration/profiles/backup — P1, F157.
4. Trigger CI on `_decoded/**` and `docs/**`, which its gates read — P2, F158.
5. Complete refused XHRs as errors; stop persisting failed imports' full archives; harden nonce
   adoption — P2, F159–F161.
6. Coordinate cross-tab store writes with Web Locks — P2, F162.
7. The carry-forward P1s: i18n catalog off the document-start path (54.4% of the v1.24.0 bundle,
   re-measured), rendered accessibility tests — F138, F140.
8. WACZ export — now fully specified in F147, no re-research needed; requires the STORE zip path.

## Product Map

- Core workflows: (a) install → ads suppressed, media save buttons live, everything else off;
  (b) declutter/theme via a 13-page Control Center with transactional Save/Revert and settings
  search; (c) filter with a rule DSL, per-post hide, seen-post dimming; (d) save media at original
  quality; (e) capture-as-you-scroll → checkpointed export (ZIP/JSON/CSV/HTML/MD/XLSX/WARC, DEFLATE
  since v1.24.0, standalone viewer); (f) local library (bookmarks, notes, colour tags, snapshots)
  with dry-run backup/restore.
- Personas: privacy-first desktop power user (primary); archivist; declutter-only user.
- Platforms: desktop Chrome + Firefox. Mobile out of scope.
- Distribution: private GitHub repo `SysAdminDoc/Aviary` (renamed 2026-08-15; update URLs and a
  preflight origin-match gate followed the same day). No store presence; Firefox id placeholder;
  all gated on the F125 operator decision.
- Integrations (opt-in, disclosure-gated): aria2, AI providers, embeddings, Obsidian/Notion,
  Mastodon/Bluesky crosspost.

## Competitive Landscape

- **The August window is still open and still unanswered (Verified 2026-08-15).** Freshness check
  across control-panel-for-twitter, twitter-web-exporter, TwitterMediaHarvest, OldTwitter: no
  release dated 2026-08-14/15. CPFT last pushed 2026-07-05 while its own issues #917/#918/#919
  (the carousel and profile-grid complaints) accumulate. The carousel actively breaks media
  rendering on Firefox 153 with no shipped fix anywhere. Blocked in this repo only by the capture
  (F139 in Roadmap_Blocked.md).
- **X Filter Pro** (CWS, v2.3.1 updated 2026-07-11, 12 users) — now markets itself "local-first"
  while paywalling AI summaries, engagement filters, and cloud sync at $2/mo. Direct positioning
  collision with Aviary's language; its user count says the label alone sells nothing. Learn: the
  paid tier across the whole field is AI + sync + filters — **export/archiving remains an
  uncontested axis**. Hide X.com Ads (10k users) abandoned since June 2024; XFeed Pro shipped
  nothing since 2026-06-19.
- **Extension-trust climate (HN, Verified):** "Chrome extensions spying on users" (474 pts,
  2026-02-11), ModHeader exfiltration (2026-07-12), and the xcancel-redirect thread (259 pts,
  2026-01-07) where several users say they refuse single-purpose extensions and write their own
  userscripts instead. Zero runtime deps + local-only + readable userscript is a marketable
  differentiator now, not hygiene — F125's listing copy should lead with specifics ("no backend,
  no proxy, no cloud"), since the generic label is already co-opted.
- **Bookmark demand keeps corroborating (Verified):** HN Show "export your X bookmarks and
  categorize them" (2026-04-08) joins the Reddit threads about silently shrinking bookmark
  collections. F154 is the matching item; its premise was verified against `network-capture.ts` —
  capture is operation-agnostic, so it is a reader over captured data, not a new capture path.
- **Webrecorder / WACZ** — the container question is settled at spec level (F147 now carries the
  full layout): plain uncompressed WARC is spec-valid, the CDXJ index must be C-collation sorted,
  and replay addresses records by offset/length — so the WACZ members must be STORED in the ZIP,
  deliberately bypassing the v1.24.0 DEFLATE path. wabac.js is AGPLv3: link, never vendor.
- **phanpy / XKit** — unchanged: Catch-up digest (F148) and filter-reason chips (F144) remain the
  best adjacent-field ideas. F144's sketch was corrected this pass: `FilterDecision` is a bare
  string union (`predicates.ts:16`), so the deciding rule is not yet exposed.

## Security, Privacy, and Reliability

Internal audit of previously unexamined subsystems (2026-08-15; every listed finding re-verified
against source, and the top three additionally reproduced or grep-confirmed):

- **Capture decoder corrupts multibyte text (Verified, reproduced).** `tools/capture-decode.mjs`
  decodes quoted-printable through per-byte `String.fromCharCode` over an already-UTF-8-decoded
  string: `=E2=80=94` becomes mojibake, so display names, non-English posts, and localized ad
  labels — the strings fixtures exist to measure — would be wrong in any refreshed capture. And the
  cookie-shape scrub omits `ct0=` (only the JSON shape is covered), so the CSRF token passes the
  scrub *and* the leak guard. Both must land before the operator refresh (F155). The committed
  fixtures predate the tool and are unaffected.
- **Sticky storage fallback silently reverts a session's writes (Verified against source).** One
  failed IndexedDB transaction flips the gateway to legacy for the whole session
  (`durable-storage.ts:261-266`) — but migration already emptied legacy, so the library reads
  blank, and writes made during the fallback session land where the next healthy boot never looks
  (`initialize` skips keys the backend already holds, `:108-119`). F156.
- **The seen-posts store is in none of the three registries (Verified, grep).**
  `aviary.seenPosts.v1` is absent from `DURABLE_STORAGE_KEYS`, `PROFILE_MIGRATION_KEYS`, and
  `LIBRARY_BACKUP_COLLECTIONS` — Backup claims completeness over a store it does not carry. F157,
  plus a scan test so the next store cannot repeat it.
- **Cross-tab writes are last-writer-wins everywhere (Verified, architectural).** Whole-state
  stores behind a load-once latch; the integration usage ledger's reserve step is a cross-tab
  TOCTOU (daily budget spendable N× with N tabs); the backup snapshot/rollback window can clobber
  a second tab. Web Locks is Baseline and unused. F162.
- **Page agent (Likely/Verified mix):** a refused XHR never completes — fetch fakes 204 and
  sendBeacon returns true, but `patchedSend` just returns, so an X retry queue gated on completion
  hangs (F159). Nonce adoption is first-hello-wins with an observable nonce, so a racing page
  script can own the agent and silently disable ad protection — a documented non-cryptographic
  boundary, but the failure should at least be visible (F161). Teardown restores `fetch` by
  assignment, destroying any wrapper installed after Aviary's (F165).
- **Archive import persists the full base64 source inside each job and rewrites the whole state
  per progress tick (Verified).** A failed 250 MB import pins ~333 MB in the value store until 12
  newer jobs evict it; multi-hundred-MB writes per tick. F160.
- **Clean results, recorded so nobody re-audits them:** the v1.24.0 DEFLATE writer is correct
  (method flags, CRC-over-originals, overflow guards); the ZIP reader's zip-bomb limits are real
  (25 MiB/entry, 100 MiB total, inflate capped at declared-vs-remaining); credential handling
  leaks nothing into backup (five secret paths redacted), diagnostics, or the audit log; crosspost
  attachment reads are byte-bounded and shape-checked.
- **Carried forward, still true:** X's anti-adblock detection looks like a failed probe
  (`flow/viewer.json`, `viewer_context.json` — Aviary provably refuses neither, tested since
  v1.24.0); the ban line is enforced on unsigned originated requests (OldTwitter #1126); Node
  floor pinned and `--ignore-scripts` shipped 2026-08-15.

## Architecture Assessment

- **i18n catalog is 54.4% of the built userscript** (1,020,588 of 1,876,871 chars, re-measured on
  the v1.24.0 bundle) parsed at `document-start` on every X page load. F138 remains the largest
  performance lever, unchanged in shape.
- **Accessibility is still asserted against source text** (`tests/audit-a11y.test.mjs`, six
  source-regex assertions; contrast is properly gated elsewhere). F140.
- **CI paths filter omits `_decoded/**` and `docs/**`** (`.github/workflows/smoke.yml:7-15`) while
  v1.24.0 added gates that read both — a capture refresh or a docs edit never triggers the
  workflow. F158.
- **The capture-age gate reads only the newest capture** (`tools/capture-manifest.mjs:66-75`), so
  one fresh capture masks a stale sibling; the waiver also expires against UTC day-end. F163.
- **`src/ui/control-center.ts` is 3,529 lines** beside a partially extracted sections/ directory —
  unchanged, not urgent.
- **Settings-reference residual risks** (noted, not defects): `SECTION_FILES` is a hardcoded list
  (a fifth section file would drop silently), and the 43 `actionRow` buttons sit outside the
  "every control" claim.

## Rejected Ideas

- Settings search (cpft#430) — **already implemented** (`av-search-input`, tested); proposed by the
  morning pass without checking, caught during the drain. Do not re-propose.
- WACZ as the primary capture format — storage multiplication; opt-in export tier only (standing).
- Vendoring wabac.js for self-replay — AGPLv3; link to replayweb.page instead (this pass).
- Mass block/delete/unfollow; mobile; cloud sync; keyboard shortcuts; x.com→twitter.com redirect;
  broad transport blocking; `placementTracking`-only ad selection; full client replacement; hosted
  subscriptions; `privacy.encryptVault`; AI summarization default-on — all standing rejections.
- Numeric engagement-threshold filtering (cpft#850) — unreliable exactly when count-hiding is on;
  revisit only from a captured payload (standing).
- Timer-driven filtering (TUIC lag reports) — the observer/generation model is correct (standing).
- Firefox DNR smoke rewrite — investigated 2026-08-15 (first pass): not a defect;
  `testMatchOutcome` is implemented by Firefox. Recorded so it is not re-investigated.
- Storage Buckets API — Chromium-only (standing).

## Sources

Audit (internal, verified against source 2026-08-15): `tools/capture-decode.mjs`,
`tools/capture-manifest.mjs`, `src/platform/durable-storage.ts`, `src/platform/profile.ts`,
`src/features/core/library-backup.ts`, `src/features/integrations/usage.ts`,
`src/page/page-agent.ts`, `src/platform/page-bridge.ts`,
`src/features/library/archive-import.ts` and `archive-import-jobs.ts`,
`src/features/filtering/*`, `src/features/export/zip-store.ts` and `zip-reader.ts`.

Specs / platform:
- https://specs.webrecorder.net/wacz/1.1.1/ · https://specs.webrecorder.net/cdxj/0.1.0/
- https://github.com/webrecorder/wabac.js (AGPLv3)
- https://docs.x.com/changelog (2026-07-21 mute/block events; 2026-08-13 video_total_views redefinition)

Competitors / field:
- https://github.com/insin/control-panel-for-twitter (#917 #918 #919; last push 2026-07-05)
- https://xfilterpro.com/ · https://chromewebstore.google.com/detail/x-filter-pro-%E2%80%94-ad-blocker/loggddhjkdbjmaeoklbihailihhbjibo
- https://addons.mozilla.org/en-US/firefox/addon/xfeed-pro/versions/ · https://chromewebstore.google.com/detail/hide-xcom-ads/bapmhjebfdbdpjjfafnkfidijkjlkakf
- https://github.com/prinsss/twitter-web-exporter · https://github.com/EltonChou/TwitterMediaHarvest · https://github.com/dimdenGD/OldTwitter

Community (sentiment; corroborating primaries in CHANGELOG entries):
- https://news.ycombinator.com/item?id=46524873 (xcancel redirect, 259 pts, extension trust)
- https://news.ycombinator.com/item?id=46973083 (287 spying extensions, 474 pts)
- https://news.ycombinator.com/item?id=47697679 (bookmark export Show HN, 2026-04-08)
- https://news.ycombinator.com/item?id=49189113 (X product-lead change 2026-08-05, selector-churn risk)
- https://timelessdimension7.wordpress.com/2026/08/14/ (carousel breaks Firefox 153)
- https://www.heyorca.com/blog/x-twitter-social-news · https://socialbee.com/blog/twitter-updates/ (July/Aug X UI roundups)

Prior-pass sources (Reddit signal, platform APIs, dependency and CVE detail, userscript managers,
Webrecorder landscape): carried from the 2026-08-15 first pass — see this file's git history and
CHANGELOG.md v1.24.0; not re-fetched, because the freshness check above came back empty.

## Open Questions

1. **The operator capture** — unchanged as the gate for ~9 blocked items, with one amendment from
   this pass: do not run `npm run capture:decode` until F155 lands, or the refreshed fixtures will
   carry mojibake and possibly a live `ct0`. The waiver in `_decoded/captures.json` still expires
   2026-09-30.
2. **Publishing intent (F125)** — unchanged; now also determines whether the extension-trust
   positioning (HN evidence above) becomes listing copy.
3. **Does default-mode Violentmonkey give the userscript true `document-start`?** Unchanged;
   runtime-only; determines whether the userscript build should disclose weaker page-agent timing
   under that manager.
