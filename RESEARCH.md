# Research — Aviary for X

Date: 2026-08-14 — replaces all prior research (previous pass: 2026-08-13; its shipped conclusions are archived in CHANGELOG.md v1.18.0–v1.21.0).

## Executive Summary

Aviary is a local-first desktop X/Twitter enhancer shipping a readable userscript and an MV3
extension (Chrome + Firefox) from one TypeScript source, at v1.21.0 with a fully drained roadmap.
Its strongest shape is unmatched in the field: evidence-bounded ad suppression + WARC/XLSX/HTML
export + annotated local library + fixture-gated reversible modules — no competitor combines these.
The highest-value direction is (1) fixing distribution truth (the built userscript's auto-update
URLs point at a repository that does not exist), (2) closing the one structural feature gap vs.
every serious competitor (a rule-based filter engine), and (3) productizing feature-flag reversion
of X's 2026 redesigns — a recurring, currently unserved demand that Aviary's document-start page
agent is uniquely positioned to serve.

Top opportunities in priority order:
1. Repair the userscript `@updateURL`/`@downloadURL` (every install polls a dead repo) — P0.
2. Correct stale README claims (AI button, ROADMAP pointer, "store-ready") — P0.
3. Replace EOL toolchain (ESLint 9 died 2026-08-06) — P0.
4. Mitigate X's July-2026 anti-adblock detection exposure (DNR rule + fetch stub are visible) — P1.
5. Rule-based filter DSL with importable rule packs — the only table-stakes gap — P1.
6. "Restore old X" feature-flag reversion pack (media grid, carousel, profile redesign) — P1 leapfrog.
7. First-run onboarding + settings version envelope + persisted diagnostics (trust plumbing) — P1.
8. Media download UX depth: downloaded-badges, text sidecars, batch-from-library — P2.
9. Distribution decision: real AMO id, public release channel, update story — P2 (blocked on operator intent).
10. Declutter fast-follows: "More From This Author", tab-title badge, absolute timestamps — P1/P2.

## Product Map

- Core workflows: (a) install → ads suppressed + media save buttons by default, everything else
  off; (b) declutter/theme via Control Center (13 destinations, transactional Save/Revert);
  (c) filter/hide posts with undo; (d) save media (on-post buttons + right-click, original
  quality, direct MP4 via passive GraphQL capture); (e) capture-as-you-scroll → checkpointed
  export (ZIP/JSON/CSV/HTML/MD/XLSX/WARC + standalone viewer); (f) local library (bookmarks,
  notes, snapshots) with dry-run backup/restore.
- Personas: privacy-first desktop power user (primary; matches the operator); archivist
  (export/WARC pillar); declutter-only user (secondary).
- Platforms: desktop Chrome + Firefox; MV3 extension primary on Chrome (Tampermonkey MV3 opt-in
  friction), userscript first-class on Firefox/ScriptCat. Mobile intentionally out of scope.
- Distribution today: private GitHub repo tracking `dist/`; manual install only; no store
  presence; Firefox manifest id is a placeholder (`aviary@example.local`).
- Integrations (all opt-in, disclosure-gated): aria2, AI providers (Anthropic/OpenAI), semantic
  search embeddings, Obsidian/Notion export targets, crosspost (Mastodon/Bluesky).

## Competitive Landscape

- **Control Panel for Twitter** (insin, 2.6k★, v4.23.0 2026-07-05) — category leader; ~100
  toggles, 5 store targets incl. mobile Safari/Firefox Android, weekly churn-response releases.
  Learn: fast-follow cadence on X regressions is how it earned its base; per-option screenshots.
  Avoid: its permanent ~317-open-issue churn tax — Aviary should only add toggles a fixture can
  defend. Its most-upvoted unshipped request is settings sync (#204) — Aviary's profile export
  already serves this locally.
- **OldTwitter** (dimden, 2.7k★, v1.9.8 2026-08-11) — full client replacement calling private
  APIs. Learn: video download and customization demand. Avoid: its approach — the March 2026
  "inauthentic behavior" ban wave hit its users (#1222, 152 comments; #1153). The market split is
  "safe DOM-layer" vs "risky API-layer"; Aviary's passive-capture-only line is the moat. Never
  originate bulk API calls.
- **twitter-web-exporter** (prinsss, 2.7k★, v1.4.1 2026-07-29) — closest analog to the export
  pillar; exports bookmarks past the 800-item API cap, followers/lists/search from GraphQL
  interception. Learn: bookmark-cap-bypass framing; large-ZIP chunking failures (#137) validate
  Aviary's existing `zipChunkSize`. Aviary already exceeds it on WARC/XLSX/viewer/checkpoints.
- **TwitterMediaHarvest** (1.1k★, v4.5.7 2026-06-18) — media-saver benchmark. Its backlog is a
  demand map: batch-download bookmarks (#137), richer filename tokens (#74), tweet-text sidecar
  (#283), highlight already-downloaded media (#126). Its v4.5.7 fixed unbounded response-cache
  growth — Aviary already caps capture (50/500/50MB, `network-capture.ts:11-13`).
- **Twitter UI Customizer** (active, JP-first) — steal: reorder/add tweet action buttons,
  no-confirm actions, sidebar reordering, logo/favicon replacement.
- **Minimal Twitter** (Typefully, ~1k★, low maintenance) — cautionary: CSS that collaterally broke
  Grok history (#249) and Lists nav (#183); vanity-metric hiding and tab-title badge removal are
  its most-requested items (#242/#243).
- **XKit Rewritten** (Tumblr; architecture twin) — steal: mutual-relationship badges, seen-post
  dimming, absolute timestamps, per-post quick actions.
- **Sink It for Reddit / RES** (adjacent) — steal: RES filteReddit rule engine (field+op+value),
  per-user color tags, thread-depth color rails, focus/antiprocrastination mode, "zero data
  recorded" marketing posture.
- **rxliuli suite** (Mass Block Twitter, Feed Filter) — validates the rule-DSL demand and ships a
  novel companion: AI-generated importable filter rules from pasted URLs.
- **uBlock Origin X filters** — break exactly where Aviary is strong: localized "Ad" labels,
  randomized classes, `placementTracking` false positives. Aviary's evidence-bounded contract +
  drift diagnostics is unique in the field; keep it. Current uBO meta is hand-rewriting
  `__INITIAL_STATE__.featureSwitch` flags per redesign — demand signal for F115.
- **Commercial cluster** (X Filter Pro, Hide X.com Ads, XFeed Pro) — validates ad-hiding + focus
  mode + AI summarization as paid features. TidyFeed/Better X (cited in the 2026-08-13 pass) have
  no meaningful 2026 footprint — treat as negligible.
- **GoodTwitter2** (dead) — died of maximal-reskin surface + single maintainer + no test harness
  against continuous churn. Aviary's Noir-with-fixtures is the mitigations checklist GT2 lacked.
- **x-feed-cleaner** (same operator, v2.7.0) — internal harvest source: rule-based muting,
  hashtag/author mutes, quote-depth/stale-post filters, bookmark-first mode, thread collapse,
  reading mode all proved demand in the sibling repo and are absent from Aviary.

## Security, Privacy, and Reliability

- **Broken auto-update (Verified)**: `tools/build.mjs:347-348` writes
  `@updateURL`/`@downloadURL` → `raw.githubusercontent.com/aviary-x/aviary/main/dist/aviary.user.js`
  and `@namespace https://github.com/aviary-x`; the real remote is the private
  `SysAdminDoc/Twitter_Userscript`. Every installed userscript polls a URL that cannot serve it.
  `tools/preflight.mjs` does not validate these lines.
- **Anti-adblock exposure (Likely)**: X began testing an "ad blocker is preventing Personalized
  Timelines" warning (2026-07-10, PiunikaWeb; corroborated r/uBlockOrigin). It plausibly keys on
  blocked telemetry — exactly what Aviary's DNR logger rule and page-world logger stub do.
  DOM-hiding is detection-quiet. Needs: warning-surface detection, a DOM-only fallback mode, and
  Trust copy stating the tradeoff. Whether Aviary's exact block trips it: Needs live validation.
- **EOL toolchain (Verified)**: ESLint 9 hit end-of-life 2026-08-06; pinned 9.27.0 is
  unmaintained. `@typescript-eslint` 8.67.0 already supports ESLint 10. esbuild 0.28.2 and
  TypeScript 6.0 (bridge to Go-native 7.0) are low-risk upgrades. Playwright 1.62.1 is current
  and clear of CVE-2025-59288 (<1.55.1 only).
- **Settings payload has no version envelope**: `aviary.settings.v1` is a key name, not a
  versioned envelope (`src/platform/settings.ts`); a future breaking rename has only
  silent-fallback-to-default, no upgrade ladder. Durable storage has schema v1 + migration;
  settings should match.
- **Diagnostics are memory-only**: 200-event ring (`src/platform/diagnostics.ts`), lost on
  reload; boot failure sets `data-av-ready="error"` with no user-visible message.
- **CI gap**: `.github/workflows/smoke.yml` runs lint → matrix → build → visual → smoke but not
  `npm test` (unit suite) or `npm run preflight` — the main gate is local-only.
- **Ban-risk line (policy, evidence-backed)**: March 2026 ban waves hit API-originating tools
  (OldTwitter #1222/#1153). Aviary's passive capture observes, never originates — every future
  feature must stay on that side; batch features must consume already-captured records only.
- **Supply-chain posture is validated**: zero runtime deps + exact pins + lockfile is exactly the
  correct response to the 2025 npm chalk/debug and Shai-Hulud incidents. Consider
  `--ignore-scripts` in install docs.
- **Recovery**: library backup has dry-run/checksum/rollback (strong). Settings import lacks the
  same preview treatment (minor).

## Architecture Assessment

- **`FeatureModule.defaultEnabled` is a dead gate** — all 24 modules ship `true`; the
  `registry.ts:62` skip branch is unreachable; `statuses()` reports 24 "registered" regardless of
  user state. Remove or repurpose truthfully.
- **`src/features/export/viewer.ts` carries a second hand-maintained 9-locale table** (lines
  ~7-250) outside the extractor/catalog pipeline — a guaranteed drift path given the repo's
  documented i18n-extraction breakage history (5 prior incidents in CLAUDE.md).
- **Route detection monkey-patches history** — the Navigation API is Baseline as of Jan 2026
  (Chrome, Firefox 147, Safari 26.2); feature-detect with fallback in `src/platform/route.ts`.
- **Control Center file layout reflects the dead 4-section IA** (`sections/{presets,reading,data,advanced}.ts`
  render 13 destinations); the 5 undated mockups at `docs/mockups/` root depict that dead IA.
- **`performance.forceVideoQuality` is wired but unprovable** — MSE/`blob:` playback exposes no
  variant list (CLAUDE.md 2026-08-07); either prove an effect or remove the claim-shaped setting.
- **Test gaps**: `tests/audit-a11y.test.mjs` is largely source-regex, not runtime; no automated
  contrast sweep in CI. i18n ad-label locale list should be audited against X's full UI-locale
  set, not just Aviary's 9 panel locales.
- **Docs**: README badge row is a single version badge (house rule expects license/platform);
  README:307 and :325 are stale (see P0); `.github/` has no issue/PR templates.
- **Repo hygiene**: two ~700KB `.mhtml` captures at root (reference fixtures per prior session —
  relocate under `_decoded/` with the rest of the ground truth), tracked `work/` and 40KB
  `PROJECT_STATE.md` from the gitignore-reversal commit `39d513c`.

## Rejected Ideas

- Mass-block / mass-delete / bulk-unfollow (rxliuli, r/Twitter demand) — originates API calls;
  the exact behavior behind the March 2026 ban waves. Keeps Aviary on the safe DOM/passive side.
- Mobile/tablet support (CPFT's moat) — rejected by the desktop product scope (standing).
- Settings cloud sync (CPFT #204) — local-first philosophy; profiles + settings export serve it.
- Keyboard shortcuts (OldTwitter/RES parity) — standing house rule; preflight enforces.
- x.com→twitter.com redirect (CPFT feature) — auth-loop breakage on CPFT (#909), low value.
- Broad HomeTimeline/`pbs.twimg.com`/`video.twimg.com` blocking — breaks essential transport
  (2026-08-13 pass, re-confirmed).
- `placementTracking`-only ad selection — organic false positives (CLAUDE.md, uBO breakage).
- Full client replacement (OldTwitter approach) — ban risk + GoodTwitter2 failure mode.
- Hosted/subscription features (X Filter Pro model) — contradicts local-first identity.
- `privacy.encryptVault` — key-beside-ciphertext theater; removed v1.12.0, stays removed.
- AI summarization as default-on (X Filter Pro) — provider calls are disclosure-gated opt-in
  by design; no change.

## Sources

Competitors / OSS:
- https://github.com/insin/control-panel-for-twitter (+issues #204 #909 #913 #915 #917 #918 #919)
- https://github.com/dimdenGD/OldTwitter (+issues #1222 #1153 #1332)
- https://github.com/prinsss/twitter-web-exporter (+issues #52 #92 #116 #133 #137)
- https://github.com/EltonChou/TwitterMediaHarvest (+issues #74 #103 #126 #137 #283)
- https://github.com/Ablaze-MIRAI/Twitter-UI-Customizer
- https://github.com/typefully/minimal-twitter (+issues #183 #242 #243 #249)
- https://github.com/AprilSylph/XKit-Rewritten
- https://github.com/honestbleeps/Reddit-Enhancement-Suite · https://gosinkit.com/
- https://github.com/rxliuli/mass-block-twitter · https://rxliuli.com/project/twitter-filter/
- https://github.com/robonxt/CleanYourTwitter · https://github.com/Bl4Cc4t/GoodTwitter2
- https://xfilterpro.com/ · https://chromewebstore.google.com/detail/hide-xcom-ads/bapmhjebfdbdpjjfafnkfidijkjlkakf

Platform / standards:
- https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline
- https://developer.chrome.com/docs/extensions/reference/api/userScripts
- https://developer.chrome.com/blog/cws-policy-updates-2026
- https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts (AMO restriction)
- https://bugzil.la/1921353 (FF DNR persistence, fixed FF133)
- https://web.dev/blog/baseline-navigation-api
- https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ · https://endoflife.date/eslint
- https://github.com/evanw/esbuild/blob/main/CHANGELOG.md
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://github.com/advisories/GHSA-7mvr-c777-76hp (Playwright, cleared)

X platform / community (sentiment unless noted):
- https://piunikaweb.com/2026/07/10/x-ad-blocker-warning-browser-users/
- https://www.reddit.com/r/uBlockOrigin/comments/1vob8nh (media-tab flag reversion, 2026-08-14)
- https://www.reddit.com/r/uBlockOrigin/comments/1v2gxir ("More From This Author", 2026-07)
- https://www.reddit.com/r/uBlockOrigin/comments/1v0psbz (video login wall, 2026-07)
- https://www.reddit.com/r/Twitter/comments/1vev2k5 (ads unbearable even for Premium, 2026-08)
- https://www.reddit.com/r/firefox/comments/1p8wfc2 (X CountryBadge, 591 pts, 2025-11)
- https://www.reddit.com/r/Twitter/comments/1pvdf5u (art-to-gif Grok protection, 152 pts)
- https://news.ycombinator.com/item?id=45916525 (Tweeks trust-objection thread)
- https://scrapfly.io/blog/posts/how-to-scrape-twitter (GraphQL doc_id rotation)

## Open Questions

1. **Publishing intent**: is Aviary meant to go public (greasyfork/AMO/CWS) or stay a private
   personal build? F105's correct URL target and the whole F125 distribution item depend on it.
   Until answered, F105 should point at the real private repo's raw dist path.
2. **Does X's anti-adblock warning actually trigger on Aviary's exact logger block?** Needs an
   operator-authenticated session in the warning-test cohort; cannot be answered from fixtures.
3. Blocked-item captures (F032/F033, sensitive media, pre-roll correlation) remain
   operator-gated as specified in `Roadmap_Blocked.md` — unchanged by this pass.
