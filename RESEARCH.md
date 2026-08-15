# Research — Aviary for X

Date: 2026-08-15 — replaces all prior research (previous pass: 2026-08-14, whose conclusions were
drained into v1.22.0–v1.23.0 and are archived in CHANGELOG.md).

## Executive Summary

Aviary is a local-first desktop X enhancer shipping a readable userscript and an MV3 extension
(Chrome + Firefox) from one 40k-line TypeScript source with zero runtime dependencies, at v1.23.0
with a two-item roadmap. Its discipline — a selector ships only if it can be proved against a
captured DOM fixture — is the strongest thing about it and is now also its binding constraint: the
only ground truth in the repository, `_decoded/home.html` and `_decoded/status.html`, is dated
**2026-05-19**, and X shipped a post-media redesign on or before **2026-08-11**
(control-panel-for-twitter#917/#918/#919, opened 2026-08-11 to 08-13). The project cannot see the
current X. Nothing warns that the fixture is stale, and no tooling or documented procedure exists to
refresh it. That is the highest-value work available, because it is what gates roughly eight blocked
items and every response to X's ongoing churn.

Beneath that, this pass found three measured engineering defects that no previous pass caught: the
translation catalog is **54.3% of a 1.86 MB bundle parsed at `document-start` on every X page**; the
ZIP writer emits **STORE (uncompressed) archives assembled whole in memory** while the ZIP *reader*
already uses the browser's own DEFLATE; and README/FAQ document **nothing** added in v1.22.0 or
v1.23.0 because the docs gate only checks version strings.

Top opportunities in priority order:
1. Refresh the capture set and make its age a gate — P0, unblocks a family of items.
2. Point the update URLs at the renamed repository, and gate that against `origin` — P0.
3. Bind the docs gate to the settings surface; README/FAQ are two releases behind — P1.
4. Extend selector health from 10 surfaces to every selector a feature depends on — P1.
5. DEFLATE the ZIP writer via `CompressionStream` (reader half already exists) — P1.
6. Move the i18n catalog off the `document-start` parse path — P1.
7. Restore what X's August 2026 redesign changed, while the category leader is 41 days idle — P1.
8. Replace source-regex accessibility assertions with a rendered pass — P1.
9. Show *why* a post was filtered, and make rules portable — P2.
10. WACZ as the archival container, for Webrecorder-ecosystem replay — P2.
11. Catch-up digest over the seen-post store shipped in v1.23.0 — P2.

## Product Map

- Core workflows: (a) install → ads suppressed and media save buttons live, everything else off;
  (b) declutter/theme through a 13-page Control Center with transactional Save/Revert; (c) filter
  and hide posts, now including a rule DSL and second-pass dimming; (d) save media at original
  quality; (e) capture-as-you-scroll → checkpointed export (ZIP/JSON/CSV/HTML/MD/XLSX/WARC plus a
  standalone viewer); (f) local library — bookmarks, notes, per-account colour tags, snapshots —
  with dry-run backup/restore.
- Personas: privacy-first desktop power user (primary); archivist (export/WARC pillar);
  declutter-only user (secondary).
- Platforms: desktop Chrome + Firefox. Mobile intentionally out of scope.
- Distribution: private GitHub repo tracking `dist/`; manual install; no store presence; Firefox
  add-on id is still the placeholder `aviary@example.local` (F125, operator-gated).
- Integrations, all opt-in and disclosure-gated: aria2, AI providers, embeddings, Obsidian/Notion,
  Mastodon/Bluesky crosspost.

## Competitive Landscape

Only projects carrying signal that changed since 2026-08-14, plus classes the prior pass missed.

- **Control Panel for Twitter** (insin, ★2584) — last push **2026-07-05**, 41 days before this pass,
  while three issues opened 2026-08-11..13 report a new X image-carousel and post layout (#918 👍6,
  #917 👍2, #919 👍9 "Remove all new changes"). Verified via GitHub API 2026-08-15. Learn: this is
  the demand window, and it is exactly the structural-restoration work Aviary does. Avoid: nothing
  new; its issue-churn tax stands. Its most-demanded unmet issue remains #204 settings sync (👍16,
  open since 2023) — Aviary's settings export already answers the local half.
- **twitter-web-exporter** (prinsss) — v1.4.1 2026-07-29 added DB import from an exported JSON dump
  with migrations, property-path filename patterns, byte-accurate filename truncation; a 2026-08-13
  commit adapts to profile-page API changes. Its #137 ("over 500 media items breaks ZIP export") is
  independent corroboration of Aviary's own in-memory archive ceiling. #143 wants Article capture —
  same surface Aviary has blocked for want of a fixture.
- **TwitterMediaHarvest** — no feature work since v4.5.7 (2026-06-18); July–August is dependency
  bumps only. Its backlog stays the media demand map: #137 batch-from-bookmarks, #74 filename
  tokens, #283 text sidecar, #126 downloaded-media highlighting (all already scoped as F118), plus
  #336 subtitles, #103 audio-only, #316 group-by-account, #323 history export by date range.
  **#54 asks for a self-diagnostic that tells the user whether the extension still works** — Aviary
  has that machinery internally and does not expose it. Learn: productize selector health.
- **XKit Rewritten** (architecture twin) — #1664 "Show tags on filtered posts" (👍4). Learn:
  a filtered post should say *why* it was filtered. Aviary's v1.23.0 rule DSL makes this cheap and
  it is the single best trust affordance a filter engine can have.
- **Webrecorder stack — the class the prior pass missed.** `archiveweb.page` (★1540, pushed
  2026-08-12) and `replayweb.page` (★969, pushed 2026-08-11) have standardized browser-side
  archiving on **WACZ**, with `wabac.js` doing fully client-side replay. Aviary emits raw
  uncompressed WARC. Learn: WACZ as the container buys replay in every Webrecorder tool for a
  packaging change, not a capture change. Avoid: full-fidelity WACZ capture as the *primary* path —
  it multiplies per-timeline storage and would cost Aviary the lightweight library that
  differentiates it. Opt-in export tier only.
- **Personal-archive search — a live rival class.** `Dicklesworthstone/xf` (★99, pushed 2026-08-14)
  does sub-millisecond FTS over an official X archive from the CLI; `TheExGenesis/community-archive`
  (★121, pushed 2026-08-15) publishes an open tweet-archive schema others build on;
  `timhutton/twitter-archive-parser` (★2438) is the canonical official-export parser and has been
  dormant since 2022. Learn: adopt the community-archive schema as an interop export and inherit its
  ecosystem; the dormant parser is an opening for Aviary's existing archive importer.
- **phanpy** (cheeaun, ★1478, Mastodon) — its "Catch-up" digest, a bounded time window grouped by
  author with visible filter reasons, is the best reading-mode idea in the adjacent field. Aviary
  shipped the seen-post store in v1.23.0, which is the hard half of it.
- **news-feed-eradicator** (★1483) — scheduled feed suppression. Aviary's v1.23.0 focus mode
  already reaches parity; no further action.
- **utags** (★367) — user-defined tags on arbitrary links with a merge model worth reading before
  extending account colours into free-form tags.
- **Distribution note**: `awesome-scripts/awesome-userscripts` (★3471, pushed 2026-08-13) is active
  and lists no X/Twitter enhancer of this class — a channel that exists the moment F125 is decided.

## Security, Privacy, and Reliability

- **The evidence base is three months old (Verified).** `_decoded/home.html` (2026-05-19, 315 KB)
  and `_decoded/status.html` (2026-05-19, 263 KB) are the whole ground truth; the two root `.mhtml`
  files decode to byte-equivalent content, so there is one capture generation, not two. Every
  "measured: 0 hits" conclusion in `Roadmap_Blocked.md` — Articles, relationship badges, reposts,
  sensitive media, "More From This Author" — is a statement about X as it was in May. X's August
  redesign is invisible here. There is no capture tooling in `tools/`, no documented refresh recipe,
  and no test that fails or warns on fixture age.
- **Uncompressed, in-memory archives (Verified).** `src/features/export/zip-store.ts:78` writes
  `method = STORE`; `buildStoreZip()` returns a single `Uint8Array` holding the whole archive; the
  file's own comments record hard ceilings of 65,535 entries and 4 GB per entry with no ZIP64.
  Meanwhile `src/features/export/zip-reader.ts:113-115` already uses
  `DecompressionStream("deflate-raw")`. The write side is asymmetric for no reason:
  `CompressionStream("deflate-raw")` is Baseline (Chrome 103 / Firefox 113 / Safari 16.4). WARC is
  emitted as plain uncompressed bytes rather than the `.warc.gz` the archival ecosystem expects.
  Corroborated externally by twitter-web-exporter#137.
- **Documentation claims are two releases behind (Verified).** README.md and docs/FAQ.md contain
  zero occurrences of focus mode, seen-post dimming, account colours, or the tab icon — every
  v1.23.0 feature. README's "the latest batch adds …" sentence was last edited 2026-08-09 (commit
  b9fec4f) and still describes the v1.18-era batch while the paragraph claims to describe v1.23.0.
  Root cause: `tests/docs-consistency.test.mjs` asserts only that PRIVACY.md and INSTALL.md carry
  the current version string, plus a blocklist of retired phrases. Nothing connects the settings
  surface to the prose, so a version bump passes while feature docs rot. For a project whose whole
  posture is "never claim what you cannot back", this is the highest-severity trust defect found.
- **Selector drift is watched for 10 surfaces out of 56 (Verified).** `SURFACE_SELECTORS` in
  `src/platform/selectors.ts` covers App root, Primary column, Sidebar, Tweet, Tweet text, Composer,
  Media photo, Video, Navigation, Grok. Features and UI reference **56 distinct `data-testid`
  selectors**, including `news_sidebar`, `GrokDrawer`, `trend`, `placementTracking`, `videoComponent`,
  `UserCell`, `toolBar`, `AppTabBar_Home_Link` and `app-text-transition-container`. A rename in any
  of the ~46 unwatched selectors silently disables its owning feature with no diagnostic — the exact
  failure the fixture discipline exists to prevent, occurring outside the fixture's reach.
- **Accessibility is asserted against source text, not behaviour (Verified).**
  `tests/audit-a11y.test.mjs` matches literal source strings such as
  `overlay.toggleAttribute("inert", !open)` in `src/ui/control-center.ts`. A rename breaks the test
  without a behaviour change; a real regression that preserves the string passes. Correcting the
  2026-08-14 pass: colour contrast **is** computed and gated in CI, in
  `tests/theme-matrix.test.mjs:134-138` (7:1 text, 4.5:1 muted) and `tests/audit-ui.test.mjs:16`.
  The gap is interaction and semantics, not contrast.
- **Toolchain and supply chain (Verified).** `engines.node` is `">=22"`, loose enough to admit
  releases superseded by the Node security releases of 2026-06-18 and 2026-07-29 (23 CVEs, 5 HIGH;
  fixed lines 22.23.2 / 24.18.1 / 26.5.1). Every major 2026 npm compromise — axios, keyv/cacheable,
  the node-gyp worm — executed through install scripts, and with zero runtime dependencies
  `npm ci --ignore-scripts` costs Aviary nothing and closes the class; it appears nowhere in CI or
  docs. esbuild 0.28.2, ESLint 10.8.1, @typescript-eslint 8.67.0 and Playwright 1.62.1 are current
  and clear. TypeScript **7.0** is GA (2026-07-08, Go-native, 8–12× faster) but ships no programmatic
  API until 7.1, so typescript-eslint cannot run on it — `npm run typecheck` is pure `tsc --noEmit`
  and can move to `tsgo` while TypeScript 6 stays installed for the lint parser.
- **Manager-ecosystem changes that touch the install path (Likely — vendor changelogs).**
  Tampermonkey 5.5.0 (2026-05-08) requires the Chrome 138+ "Allow user scripts" toggle before a
  script runs, and `GM_download` now prompts for the browser downloads permission unless the manager
  is in Native mode — a denial path `src/features/media/downloader.ts` should handle explicitly.
  Violentmonkey 2.46+ offers an opt-in "Alternative page mode" because default MV3 Violentmonkey
  does **not** deliver true `document-start`; Aviary's page agent depends on that timing. Needs live
  validation against `src/page/page-agent.ts`.
- **The repository was renamed and the update URLs did not follow (Verified).** Pushing on
  2026-08-15 returned "This repository moved. Please use the new location:
  https://github.com/SysAdminDoc/Aviary.git", and `gh api` confirms `SysAdminDoc/Aviary` is
  canonical. `package.json:11,13` still declares `SysAdminDoc/Twitter_Userscript`, and
  `tools/build.mjs` derives the metablock from that field, so `dist/aviary.user.js:7,22,23` name the
  pre-rename path. `github.com` follows renames; `raw.githubusercontent.com` — where `@updateURL`
  and `@downloadURL` point — does not. Harmless while the repository is private, and a dead update
  channel the moment F125 makes it public: the same defect F105 fixed on 2026-08-14, arriving by a
  different route because preflight validates the URL's shape but not that it matches `origin`.
- **Dead match targets (Likely).** Both manifests and the userscript metablock match
  `mobile.twitter.com` and `tweetdeck.twitter.com`, surfaces X retired in 2023. They widen the
  install permission prompt and match nothing.
- **Ban-risk line unchanged (policy).** Passive observation only; batch features consume already
  captured records. Every item below respects it.

## Architecture Assessment

- **The `document-start` bundle is majority translation table (Verified).** The built userscript is
  1,862,668 characters; `src/platform/i18n-catalog.ts` accounts for **1,011,863 of them — 54.3%**.
  Control Center UI adds a further ~11%. So roughly two thirds of what every X page load parses
  before first paint exists to render a settings panel that is usually never opened, and all nine
  locales ship to every user. Deferring the catalog (a lazily parsed JSON string, or a
  web-accessible chunk in the extension build) is the largest single performance lever available and
  touches one module boundary.
- **`src/ui/control-center.ts` is 3,529 lines** beside a partially extracted
  `src/ui/control-center/sections/{presets,reading,data,advanced}.ts`. The four section files still
  carry the dead 4-destination IA while the panel renders 13 destinations — the split was started
  and abandoned. Naming the files after what they render is the cheap half; finishing the extraction
  is the expensive half and is not urgent.
- **Build artifacts are committed on every commit, not every release (Verified).** `dist/` blobs
  total **542.6 MB** across history (93.4 MiB packed), of which 277.9 MB is 230 versioned extension
  ZIP blobs — incompressible, and rebuilt by `npm run verify` on each feature commit.
  `dist/aviary.user.js` must stay tracked because `@downloadURL` points at it; the ZIPs are release
  artifacts and need not be.
- **Test gaps**: no runtime accessibility pass (above); no fixture-age gate; `tools/` has no capture
  or capture-decode script, so refreshing ground truth is an undocumented manual chore.
- **Platform capabilities available and unused** (all Baseline unless noted, MDN compat data):
  `CompressionStream` (above), Web Locks (Chrome 69 / FF 96 / Safari 15.4 — no code
  coordinates two open X tabs writing the collector or DNR rules), `content-visibility`
  (Chrome 85 / FF 125 / Safari 18 — long library and timeline lists), CSS `@scope`
  (Chrome 118 / FF 146 / Safari 26.4 — real scoping for F129 instead of attribute prefixes), OPFS
  for streaming large exports. The extension-only wins — `chrome.userScripts` (whose `USER_SCRIPT`
  world is exempt from page CSP and is the only store-compliant route for user-supplied CSS/JS), the
  `browser` namespace alias in Chrome 148, DNR `topDomains` — all require raising
  `minimum_chrome_version` from 116 and gecko `strict_min_version` from 128 by 20–30 releases, and
  should wait for the F125 distribution decision.

## Rejected Ideas

- **WACZ as the primary capture format** (webrecorder) — full-fidelity capture multiplies per-timeline
  storage; ship WACZ as an opt-in export container over the existing store instead.
- **Bluesky/Mastodon feed enhancement** (twitter-web-exporter#123, TwitterMediaHarvest#195) — Aviary
  crossposts to them; enhancing their timelines is a different product.
- **Settings cloud sync** (cpft#204) — local-first; settings export serves it. Unchanged.
- **Mass block / mass delete / bulk unfollow** (rxliuli) — originates API calls; the March 2026 ban
  wave behaviour. Unchanged.
- **Keyboard shortcuts** (bluesky-shortcuts, OldTwitter) — standing house rule; preflight enforces.
- **Numeric engagement-threshold filtering** (cpft#850) — the rule DSL could express it, but Aviary
  can also *hide* those counts per metric, so a threshold read from the DOM is unreliable exactly
  when a user has configured it. Revisit only from a captured payload, not the rendered count.
- **Timer-driven filtering** (Twitter-UI-Customizer#229/#239/#278 report lag from it) — Aviary's
  observer-and-generation model is correct; do not add polling.
- **`x.com` → alternate-frontend redirection** — link *copying* as an alternate front-end is fine
  (below); redirecting the user's own session is the auth-loop breakage CPFT hit in #909.
- **Storage Buckets API** — Chromium-only with no Firefox signal; the dual-ship rules it out.
- **Firefox DNR smoke rewrite** — investigated and dropped: `tests/smoke/dnr-firefox.smoke.mjs:91`
  uses `declarativeNetRequest.testMatchOutcome`, which Firefox implements, and backs it with a real
  blocked request. No defect. Recorded so it is not re-investigated.

## Sources

Competitors / OSS (verified via GitHub API 2026-08-15 where numbered):
- https://github.com/insin/control-panel-for-twitter (issues #204 #430 #492 #522 #530 #605 #653 #850 #864 #875 #916 #917 #918 #919)
- https://github.com/prinsss/twitter-web-exporter (issues #52 #118 #123 #133 #137 #142 #143)
- https://github.com/EltonChou/TwitterMediaHarvest (issues #54 #74 #103 #126 #137 #167 #283 #316 #323 #336)
- https://github.com/AprilSylph/XKit-Rewritten (issues #1664 #2241)
- https://github.com/typefully/minimal-twitter · https://github.com/Ablaze-MIRAI/Twitter-UI-Customizer
- https://github.com/webrecorder/archiveweb.page · https://github.com/webrecorder/replayweb.page · https://github.com/webrecorder/wabac.js
- https://github.com/TheExGenesis/community-archive · https://github.com/Dicklesworthstone/xf · https://github.com/timhutton/twitter-archive-parser
- https://github.com/cheeaun/phanpy · https://github.com/jordwest/news-feed-eradicator · https://github.com/utags/utags
- https://github.com/harvard-lil/scoop · https://github.com/gildas-lormeau/SingleFile · https://github.com/ArchiveBox/archivebox-browser-extension
- https://github.com/awesome-scripts/awesome-userscripts · https://github.com/iipc/awesome-web-archiving

Platform / standards / toolchain:
- https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream · https://github.com/mdn/browser-compat-data
- https://developer.chrome.com/docs/extensions/reference/api/userScripts · https://developer.chrome.com/docs/extensions/whatsnew
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts
- https://developer.chrome.com/blog/cws-policy-updates-2026 · https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ · https://github.com/typescript-eslint/typescript-eslint/issues/10940
- https://github.com/evanw/esbuild/blob/main/CHANGELOG.md · https://github.com/eslint/eslint/releases · https://playwright.dev/docs/release-notes
- https://www.iso.org/standard/68004.html (WARC/1.1) · https://specs.webrecorder.net/wacz/latest/

Security:
- https://nodejs.org/en/blog/vulnerability/june-2026-security-releases · https://nodejs.org/en/blog/vulnerability/july-2026-security-releases
- https://www.cisa.gov/news-events/alerts/2026/04/20/supply-chain-compromise-impacts-axios-node-package-manager
- https://www.wiz.io/blog/keyv-and-cacheable-npm-supply-chain-attack · https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/
- https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr

Userscript managers:
- https://www.tampermonkey.net/changelog.php · https://github.com/violentmonkey/violentmonkey/releases · https://github.com/scriptscat/scriptcat/releases

## Open Questions

1. **Can the operator produce a refreshed authenticated capture?** F134 is written to be doable
   from an ordinary logged-in session with save-as-MHTML, but every downstream blocked item
   (Articles, reposts, sensitive media, relationship badges, "More From This Author", the August
   carousel) depends on which states that session happens to contain. If it cannot be produced,
   Aviary is frozen at May 2026's X and that should be stated in the README rather than implied.
2. **Publishing intent** (F125, unchanged from 2026-08-14) — it now also gates whether the manifest
   floors can rise far enough to use `chrome.userScripts`, and whether the awesome-userscripts
   listing is worth pursuing.
3. **Does default-mode Violentmonkey give Aviary true `document-start`?** If not, page-agent hooks
   install after X's first fetches in that manager, and the userscript build should say so.
