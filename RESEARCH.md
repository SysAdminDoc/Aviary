# Research — Aviary

Date: 2026-08-17 — replaces the 2026-08-16 feed-media research, whose findings shipped in v1.26.0/v1.27.1 or moved to ROADMAP.md (F169, F170).

Scope: a general product/engineering pass over the subsystems the media-focused passes never examined. Confidence is labelled per claim: **Verified** (read in this repo or fetched from a primary source during this pass), **Likely** (secondary source), **Needs live validation** (requires an operator session on live X).

## Executive Summary

Aviary at v1.27.1 is a genuinely mature local-first X enhancer: 118 TypeScript modules, 41k LOC, zero runtime dependencies, 502 passing tests, clean typecheck and lint, an enforced no-innerHTML/no-eval/no-`<all_urls>` preflight, and a philosophy that is unusually well policed by its own test suite. Its strongest shape is the one it already chose — passive GraphQL observation plus reversible DOM work — which is the only design in this field with a durable half-life (Nitter, twarc, snscrape and twint all died of the alternative).

The gap is not features. It is that a finished product has no users and a handful of correctness defects that its source-text test suite structurally cannot catch.

Top opportunities, in priority order:

1. **The product is undistributed and its update channel is dead.** `github.com/SysAdminDoc/Aviary` and the shipped `@updateURL`/`@downloadURL` both return HTTP 404 — the repo is private (0 stars, 0 forks, 0 issues, 3 releases nobody can fetch). Every other item is downstream of this. Tracked as blocked (F125, operator decision); the *engineering* halves are actionable now.
2. **Filtered posts never collapse their timeline row.** `filter-engine.ts:206` writes the attribute with the wrong value; the CSS never matches. Filtering leaves a full-height blank gap for every hidden post — the exact defect hidden-posts was built to avoid.
3. **A daily AI/embedding budget of `0` means unlimited, not blocked.** `usage.ts` collapses "unset" and "explicit zero" to the same value; the guard is `> 0`. A user capping spend at zero removes the cap.
4. **Any page script can disable ad protection or uninstall the page agent.** The bridge broadcasts its session nonce via `postMessage(envelope, "*")`; the agent then honours `config` and `teardown` from anyone replaying it.
5. **36% of the test suite asserts on source text, not behaviour.** 33 of 91 files regex over `src/`. A rename fails a working feature; a real regression that preserves the literal string passes. "502 tests" is worth materially less than it reads.
6. **The DOM captures expire 2026-09-30 and then preflight fails hard.** They are already 90 days stale, they block ~9 roadmap items, and they contain a real user's handle and post text in tracked git history — which also blocks ever making the repo public.
7. **The Popover API is free at both manifest floors and deletes the most code** (Chrome 116 = the declared floor exactly; Firefox 125 < 128). Top-layer rendering, light-dismiss and focus management, without the z-index fight against x.com's stacking contexts.
8. **The i18n catalog is 53.9% of the shipped bundle** — measured, not estimated. Refines F138's rationale (below), which named the wrong cost.
9. **WACZ is the packaging the archiving ecosystem standardised on**, and F147's current design has a replay-correctness bug worth fixing before it is built.
10. **Archive-import fidelity** — t.co expansion and numeric-ID→handle backfill are documented failures of X's own export that Aviary can fix from its captured corpus with zero originated requests.

## Product Map

- **Core workflows** — (1) read a de-advertised, decluttered, optionally re-themed X; (2) filter or hide posts reversibly, per route; (3) save media at original quality in one click; (4) capture and export what you have already scrolled past, in portable formats; (5) keep a local library — bookmarks, notes, snapshots, imported X archives — that outlives what X renders.
- **Personas** — the privacy-motivated reader (ad/telemetry refusal, no account risk); the archivist/data-hoarder (export, WARC, archive import, media at `orig`); the power reader (filters, hide-and-remember, presets, themes).
- **Platforms** — readable userscript (Tampermonkey/Violentmonkey; `@run-at document-start`) and MV3 extension for Chrome ≥116 and Firefox ≥128. Desktop-first; verification viewport 1440×900 with a 1920×1080 check. **Distribution today: none.**
- **Integrations and data flow** — everything local by default. Opt-in outbound paths are Aria2 JSON-RPC, Bluesky/Mastodon crosspost, an AI provider, and an embeddings endpoint. The trust boundary is absolute and enforced in review: observe responses X already made; never originate an authenticated call, read a cookie, or extract a token.

## Competitive Landscape

Full per-competitor detail from the 2026-08-14 ecosystem pass is in the vault note `Research/X Enhancer Ecosystem 2026-08-14.md`; the media-downloader field is covered in ROADMAP F118/F150/F169/F170. Not restated here. What follows is what this pass adds.

**Control Panel for Twitter (~2.6k★) / uBO x.com filter lists** — the safe DOM layer. No ban reports across the community. *Learn:* rule-based filtering with importable rule packs is table stakes (supports F145). *Avoid:* nothing; this is the lane Aviary is already in.

**OldTwitter (~2.7k★)** — replaces the client, eats ban waves (March 2026 "inauthentic behavior" wave, issue #1222, 152 comments). *Learn:* nothing about architecture. *Avoid:* the entire API-layer approach. This is the empirical basis for Aviary's passive-capture rule.

**tweetxvault** — the closest direct competitor to Aviary's *library* half: bookmarks + likes + tweets into LanceDB, hybrid BM25 + MiniLM-384d + rerank search, X archive ZIP import, self-contained HTML viewer export. *Learn:* two things. (a) **Hybrid search beats pure-semantic** — exact-handle and exact-phrase queries are where vector-only search fails, which is precisely Aviary's current semantic-search shape. (b) It **auto-discovers GraphQL queryIds by parsing X's own JS bundles**, which survives queryId rotation without originating a call. *Avoid:* it originates authenticated GraphQL with the user's cookies — the line Aviary refuses — and is Linux/macOS only.

**ArchiveWeb.page (Webrecorder, ~1.5k★)** — the reference architecture for Aviary's extension half: in-browser capture → IndexedDB → WARC **and WACZ** export, replayed by wabac.js. *Learn:* the whole packaging and replay story (see F147 correction below). *Avoid:* it needs `chrome.debugger`; unreachable from a userscript, and Aviary's GraphQL tap is the userscript-legal equivalent.

**Scoop (Harvard LIL) and Bellingcat auto-archiver** — evidentiary capture. *Learn:* capture *attachments* as first-class outputs (screenshot, PDF, DOM snapshot, TLS cert chain, provenance summary) and an enricher chain (hash → perceptual hash → timestamp → sign). RFC3161 timestamping is free, accountless, and answers "did this post really say this on this date." *Avoid:* porting their Python/Playwright/Docker weight; take the concepts only.

**SingleFile (~22.2k★)** — *Learn:* the self-extracting ZIP (a file that is simultaneously a valid ZIP and a valid HTML page, opening in any browser with no viewer and no extension) is the ideal single-thread share format. *Avoid:* data-URI-everything inflates size ~33% and produces no replay index.

**gallery-dl** — *Learn:* its `--download-archive` is documented as *not* deduplicating across different source URLs pointing to the same image. Aviary's URL-keyed download history has the identical gap; content-hash plus perceptual hash is the fix.

**timhutton/twitter-archive-parser** — the best documented list of what X's own export gets wrong: t.co links preserved unexpanded, DM/mention participants stored as bare numeric IDs, media downscaled from originals, likes stored as text+link that dies with the source, and **bookmarks omitted entirely**. *Learn:* every one of these is a fix Aviary can make locally. The bookmarks omission is the single strongest positioning argument the README does not currently make.

**Dead ends, with evidence** — snscrape (dead), twint (archived), twarc (README: "no longer actively supported after changes to Twitter's API quotas made it unusable", 1.4k★ and Mellon-funded, still dead), Nitter (guest tokens removed 2024-01-31; no drop-in replacement in 2026), Conifer (Rhizome twilight announced 2025-12-15; capture halts May 2026). Every one died of depending on an access path X controlled. **Confidence: Verified.** This is the strongest available evidence that Aviary's passive design is correct and should not be relaxed for any feature.

## Security, Privacy, and Reliability

Findings below were read in source during this pass. The five marked **Verified (re-checked)** were reported by an audit pass and then independently confirmed by me against the cited lines.

### High

- **`src/features/filtering/filter-engine.ts:206` — filtered posts leave a blank row.** `cell.toggleAttribute(CELL_RESULT_ATTR, hasHiddenArticle)` sets the attribute to `""`; the stylesheet at `:237` matches `[data-av-filter-cell-hidden="1"]`. The value never matches, so the owning `cellInnerDiv` is never collapsed. The article hides (that rule keys off `RESULT_ATTR="hide"` and works), leaving a full-height gap — the exact behaviour `hidden-posts-feature.ts` exists to prevent. **Verified (re-checked).**
- **`src/features/integrations/usage.ts:171, 344-347` — a zero budget disables the budget.** `finiteLimit(undefined)` and `finiteLimit(0)` both return `0`, and both guards read `if (limit > 0 && …)`. Setting the daily AI/embedding cap to zero to stop all spend yields unlimited spend. This inverts a user's spending intent, which is a sharper failure than the "settings that claim what they don't do" class the project already polices. **Verified (re-checked).**
- **`src/page/page-agent.ts:438-461` with `src/platform/page-bridge.ts:161,236` — the page can turn off ad protection.** The bridge posts envelopes containing `sessionNonce` with `target.postMessage(envelope, "*")`. Any page script listening for one `message` learns the nonce, after which the agent accepts `{kind:"config", blockAds:false}` or `{kind:"teardown"}` — silently disabling the default-on ad guard or uninstalling the agent. This is **distinct from and strictly worse than F161**, which covers only a squatter winning the first `hello`: this works even when the genuine bridge wins the race. The isolated world stays protected; what is lost silently is ad protection. **Verified (re-checked).**
- **`src/features/performance/pause-offscreen-video.ts:16,72,89` — session-lifetime video retention.** `#tracked` (`Set<HTMLVideoElement>`) and `#resumable` (`Map`) hold strong references; entries are added at `:72` and cleared only in `stop()` at `:89`. There is no `isConnected` check, no `delete`, no `unobserve` anywhere in the file. Infinite scroll therefore retains every detached `<video>` for the whole session. **Verified (re-checked).**
- **`src/features/filtering/hidden-posts-feature.ts:304-312` — reflow feedback loop.** `nudgeReflow()` dispatches a synthetic global `resize`; X's virtualizer relayouts, producing childList mutations that drive `applyAll` → `collapse()` → another `resize`. Self-sustaining for as long as a hidden post is on screen. **Likely** — mechanism read in source; the loop needs a live page to observe.

### Medium

- **`src/entrypoints/extension-options.ts:36` — the options page is permanently English.** It reads `chrome.storage.local.get("aviary.settings.v1")`, but settings are written through the profile gateway as `aviary.profile.<id>.settings.v1` (`profile.ts:175-186`) into the durable IndexedDB backend. The lookup always misses and falls back to `"en"` regardless of the chosen locale — in a project that ships a 9-locale catalog and tests locale drift. **Verified (re-checked).**
- **Unguarded user regex → catastrophic backtracking.** `predicates.ts:170-187` and `rules.ts:165-178` both compile user input with bare `new RegExp(…)` and run `.test()` synchronously per article per mutation batch. A rule like `/(a+)+b/` freezes the tab on the first long post. `RegExp.escape` is Baseline (2025-05-01) for the literal path; the pattern path needs a complexity budget.
- **`src/features/filtering/seen-posts-feature.ts:29-32,57` — two defects.** The store is constructed only in `init`, so enabling `filter.dimSeenPosts` after boot leaves `apply` returning early forever until reload. And `await store?.flush(…)` awaits `undefined` — `flush` returns `void` and only queues onto a private tail chain — so `destroy` resolves before the write lands, which is the data loss its own comment claims to prevent.
- **Credentialed requests to plaintext endpoints.** `ai-provider.ts:68-76,106-110` and `semantic-search.ts:216-221` accept any `http:` or `https:` URL and send `x-api-key`/`Bearer` to it. A typo'd `http://` endpoint transmits the key in cleartext. No host allowlist, no TLS requirement.
- **`src/main.ts:252-279` with `src/features/registry.ts:76-87` — unserialized `applyAll`.** Three callers fire `void registry.applyAll(...)`; `applyAll` awaits per feature, so passes interleave at microtask boundaries and module-level guards (`lastAppliedVersion`, `compiledSignature`) set by one pass make the other skip a rescan it needed.
- **`src/extension/ad-rule.ts:87-96` — rule/mirror ordering.** The DNR rule is committed first, then a failing `storage.set` throws; the rule stays applied while the caller reports failure and the mirror holds the old value, so the next `restoreDynamicAdRule` reverts a rule the user actually enabled.
- **`src/features/filtering/hidden-posts-feature.ts:220-231` — recycled-article key cache.** The derived key is cached on `data-av-post-key`; X's virtualizer reuses article nodes, so a recycled article can keep a previous post's key and collapse an unrelated post.
- **`src/page/page-agent.ts:719-729` — encode-before-size-check.** `new TextEncoder().encode(body)` runs over the entire response on the page's main thread for every GraphQL XHR before any size check, and `captureMediaMetadata` defaults to `true` (`:365`). A cheap UTF-16 length upper bound should gate it.

### Deadlines and privacy exposure

- **`_decoded/captures.json` — `acknowledgedStaleUntil: "2026-09-30"`.** Captures are dated 2026-05-19, past the declared 90-day `ceilingDays`. After the waiver date `tools/preflight.mjs:185-192` moves from warning to hard failure, which breaks `npm run verify` — the project's only release gate. It also blocks ~9 items in Roadmap_Blocked.md. **Verified.** Tracked as F134 (operator half); no duplicate item added.
- **`_decoded/` is tracked in git (26 files) and contains real user content** — `redacted-account on X_ _Millenial men got absolutely bodied…_ _ X.mhtml`, a full MHTML capture with handle and post body, plus `home.html`. This contradicts the fixture policy the repo enforces elsewhere (`tests/fixtures/ad-corpus/` stores "no handles, post text, account/tweet ids…"), and it is in history, so it survives deletion. It is a hard blocker on the "make the repo public" branch of F125. **Verified.**
- **Legal posture.** X's ToS effective 2026-01-15 reportedly bars crawling or scraping "in any form, for any purpose" without written consent and adds liquidated damages of $15,000 per 1,000,000 posts for anyone who "requests, views, or accesses" over 1M posts in 24 hours — the verb *views* is drafted to reach client-side tools. Case law splits on logged-out (defensible: *X Corp. v. Bright Data*, N.D. Cal. 2024-05-09) versus logged-in against accepted terms (*hiQ v. LinkedIn* lost on contract). Aviary runs authenticated, so the exposure is contractual, not CFAA. **Confidence: Likely** — secondary sources; the ToS text itself was not fetched. The engineering consequence is that Aviary's never-originate rule is already the correct mitigation and should be documented as a deliberate legal posture, not only an engineering one.

### Already mitigated — do not re-propose

- **Trusted Types.** Went Baseline 2026-02-24. If x.com ever sets `require-trusted-types-for 'script'`, MAIN-world `page.js` would throw on any HTML sink — but `tools/preflight.mjs` and `tests/source-contracts.test.mjs` already fail the build on `innerHTML`/`insertAdjacentHTML` outside the one policy wrapper. The exposure is closed. No action.
- **Local encryption.** Removed deliberately (`privacy.encryptVault`, v1.10.0): a key stored beside its ciphertext protects nothing when X's own session cookie sits in the same profile. Do not revisit.

## Architecture Assessment

- **The i18n catalog dominates the bundle — measured.** `PANEL_CATALOG` is 8 non-English locales × 934 keys. In the built userscript it occupies bytes 53,171–1,078,924: **1,025,753 of 1,903,855 bytes, 53.9%**. It executes in **6.6 ms** and retains **2.84 MB** of heap, in every tab, on every X page load, to serve a settings panel usually never opened. **This refines F138, which named the wrong cost**: V8 lazily compiles function bodies, so compiling the whole 1.9 MB script costs only ~4 ms — the catalog is a top-level object literal that must be fully materialised at module execution, so the real costs are retained heap, module-execution time, and 54% of every update download. Measured 2026-08-17 against `dist/aviary.user.js`. **Verified.**
- **The Control Center is the churn epicentre** — 70 commits on `src/ui/control-center.ts` (3,536 LOC) plus 38 on `src/features/core/control-center.ts` (1,215 LOC) plus 35 on `src/ui/control-center/`, the most-churned subsystem by a wide margin, with `sections/data.ts` at 1,256 LOC and `sections/advanced.ts` at 1,121. The split into `sections/` was the right move and is incomplete; the 3.5k-LOC root file is still the single largest hand-written module.
- **The test suite's foundation is weaker than its count.** 33 of 91 files read `src/*.ts` as text and assert with regex — roughly 350 assertions, concentrated in `v1.8.0.test.mjs` (87), `audit-ui.test.mjs` (40), `audit-2026-08-07.test.mjs` (32), `source-contracts.test.mjs` (23), `audit-a11y.test.mjs` (20). Four are frozen version-named audits (`v1.0.0`, `v1.1.0`, `v1.6.0`, `v1.8.0`) at a project now on 1.27.1. F140 addresses only the a11y file. **Verified.** Note the distinction: `source-contracts.test.mjs` is *legitimately* source-text (it enforces bans like "no `innerHTML` anywhere"), and should stay. The problem is the behavioural assertions written as source regexes.
- **Modules with no direct test**: `page-bridge`, `collector`, `snapshots-feature`, `media-context-menu`, `extension-content`, `extension-page`, `panel-context`, `feature-i18n`, `archive-types`, `build-version`, `constants`. `page-bridge` is the notable one given the nonce finding above.
- **Platform primitives that would delete hand-rolled code.** Verified against webstatus.dev/MDN/caniuse during this pass. Safe at *both* declared floors (Chrome 116, Firefox 128) today: **Popover API** (Chrome 116 exactly, FF125 — top-layer menus/toasts, light-dismiss and focus handling, no z-index fight with x.com's stacking contexts); **`:has()`** (structural filter predicates move from the MutationObserver hot path into a static stylesheet); **`inert`** (already used); **Web Locks** (already the basis of F162); **`structuredClone`**; **Compression Streams**; **OPFS** + `navigator.storage.persist()`; **`Intl.Segmenter`**. Above the Firefox 128 floor and needing a fallback branch or a floor bump: **Navigation API** (FF147 — replaces `history` monkey-patching), **`URLPattern`** (FF142), **`@scope`** (FF146; basic `@scope` is Chrome 118 — note F129 already plans on this), **`content-visibility`** (FF130), **`RegExp.escape`** (FF134), **`light-dark()`** (Chrome 123 is the blocker, not Firefox). Not adoptable: `showSaveFilePicker` (Firefox position is "harmful", never shipped; Safari never) — but it is a legitimate **Chrome-only** upgrade in the *userscript* lane, which has no downloads API at all and currently degrades to an anchor.
- **F147 (WACZ) has a replay-correctness bug in its current design.** Two corrections, both from primary specs read this pass. (a) A response-only WARC is not replayable for anything POSTed; WARC 1.1 pairs `request` and `response` via `WARC-Concurrent-To`, and pywb's POST replay works by matching adjacent request records. (b) More importantly, **pywb's POST-body canonicalization does not cover JSON/GraphQL bodies at all** and its form-urlencoded path is documented as broken against the outbackcdx fix. So GraphQL captures written as `response` records will not replay in ReplayWeb.page. They should be written as **`resource` records with a synthetic URI**, and only genuine HTTP GETs (media, images) should be response records. F147's existing STORE-vs-DEFLATE note remains correct and critical.

## Rejected Ideas

- **Vendoring an embeddings model for fully-local semantic search** — attractive, and tweetxvault proves hybrid search is the right target, but the research stream that would have quantified in-browser model size, latency and memory failed before returning. Proposing it now would be an unsourced guess against a zero-runtime-dependency constraint. Reduced to the sourced half (BM25 fusion, F199) and an open question.
- **Parsing X's HLS variant playlists and remuxing segments to MP4 in-page** — technically possible for H.264/AAC and would beat the progressive-MP4 ceiling, but it is a media pipeline inside a content script, and the prior pass already rejected buffering whole videos in memory. Source: Scoop sidesteps this by shelling out to yt-dlp, which Aviary cannot do.
- **`chrome.debugger`-based capture (ArchiveWeb.page's model)** — strictly more capable, but unavailable to the userscript lane and a large permission escalation for the extension. Aviary's GraphQL tap is the correct equivalent.
- **Speculation Rules** — Chrome-only, and an injected `<script type="speculationrules">` is subject to x.com's `script-src` CSP. Near-zero value for an SPA overlay.
- **Storage Buckets** — Chrome-only; `navigator.storage.persist()` is Baseline and covers the eviction need.
- **Temporal API** — Chrome 144 / FF139 / no Safari. `Intl.RelativeTimeFormat` and `Intl.DurationFormat` already cover the need.
- **`CloseWatcher`** — no Safari, FF149; Popover's built-in light-dismiss covers the case without a key handler, which also keeps the no-hotkeys policy clean.
- **A Trusted Types hardening item** — the sinks it would defend are already banned by preflight. See "Already mitigated".
- **Auto-fetching assets the user never scrolled to** (browsertrix `autofetch`) — would improve archive completeness, but it originates requests X did not make. Directly across the ban-risk line.
- **MD5 anywhere in archive manifests** (offered by py-wacz) — SHA-256 only.
- **Vendoring wabac.js for self-replay** — already rejected in F147 on AGPLv3 grounds; still correct. Link to replayweb.page instead.

## Sources

Prior passes not restated: vault `Research/X Enhancer Ecosystem 2026-08-14.md` (market, X platform, extension platform, community demand); repo git history at `c142ddf`; `Roadmap_Blocked.md`.

Archiving formats and provenance:
- https://specs.webrecorder.net/wacz/1.1.1/
- https://github.com/webrecorder/wacz-auth-spec/blob/main/spec.md
- https://iipc.github.io/warc-specifications/specifications/warc-format/warc-1.1/
- https://github.com/webrecorder/pywb/wiki/POST-request-replay
- https://github.com/webrecorder/pywb/issues/768
- https://github.com/webrecorder/warcio.js/blob/main/README.md
- https://github.com/webrecorder/py-wacz
- https://replayweb.page/docs/embedding/
- https://auto-archiver.readthedocs.io/en/latest/modules/autogen/enricher/timestamping_enricher.html
- https://auto-archiver.readthedocs.io/en/latest/modules/autogen/enricher/pdq_hash_enricher.html
- https://github.com/harvard-lil/scoop

Comparable projects:
- https://github.com/lhl/tweetxvault
- https://github.com/timhutton/twitter-archive-parser
- https://github.com/webrecorder/archiveweb.page
- https://github.com/gildas-lormeau/SingleFile
- https://github.com/mikf/gallery-dl/discussions/7717
- https://github.com/DocNow/twarc
- https://webrecorder.net/blog/2025-12-18-conifer-twilight/
- https://en.wikipedia.org/wiki/Nitter

Web platform baselines:
- https://api.webstatus.dev/v1/features/scope
- https://developer.mozilla.org/en-US/docs/Web/API/Popover_API
- https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API
- https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker
- https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
- https://caniuse.com/css-cascade-scope
- https://developer.chrome.com/blog/new-in-chrome-118

Legal posture (secondary, unverified against primary ToS text):
- https://sociavault.com/blog/web-scraping-legality-court-cases-public-vs-private-data
- https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn

## Open Questions

1. **Is Aviary published or private?** F125's blocker, restated because it now gates more than distribution: a public repo requires purging `_decoded/` real-user captures from history first, and the CWS/AMO listing work has a lead time. Until answered, the shipped `@updateURL` advertises a channel that 404s.
2. **Is a fully-local embedding path viable in a content script without a runtime dependency?** Needs model size, cold-start latency, and peak memory for a browser-resident small embedding model, measured — not assumed. Blocks choosing between F199 (BM25 fusion, sourced) and a larger local-semantic bet.
3. **Does raising `gecko strict_min_version` from 128 to ~147 cost any real user?** With zero installs today the answer is trivially no, but it stops being free the moment F125 resolves toward publication. Deciding now unlocks Navigation API, `URLPattern`, `@scope`, and `content-visibility` unconditionally instead of behind detection branches.
4. **Which of the ~350 source-text assertions encode a real contract versus a frozen implementation detail?** Determines whether F196 is a conversion or a deletion, and cannot be answered without reading them.
