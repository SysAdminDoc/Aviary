# Research, Aviary

Date: 2026-08-18, replaces all prior research.

This pass completes the 2026-08-17 pass, which lost 6 of 10 external streams to an API limit. Internal findings from that pass that are still open (F171 to F193) are not restated here; this file carries what is new plus the standing conclusions. Confidence labels: **Verified** (read in this repo or fetched from a primary source), **Likely** (secondary source), **Needs live validation** (requires an operator session on live X).

## Executive Summary

Aviary at v1.27.1 is a mature local-first X enhancer, 118 TypeScript modules, 41k LOC, zero runtime dependencies, 502 passing tests, clean typecheck and lint, and a philosophy policed by its own preflight. Its passive-capture architecture is now demonstrably the *only* durable one in this field: in the 2026-05→08 window alone, OldTwitter users reported account locks and suspensions (issue #1222, 152 comments; #1332, 2026-08-08), OldTweetDeck was crippled by rate limits, X capped free accounts at 50 posts/day, and X's 2026-01-15 ToS added liquidated damages for anyone who "requests, **views**, or accesses" over 1M posts in 24 hours. Every tool that replicated X's API is bleeding; the tools that only observe are fine.

Two things changed the opportunity landscape in the last five days, and both favour Aviary:

1. **X open-sourced its ranking algorithm (Apache-2.0) and shipped a personal "Under the Hood" JSON export on 2026-08-13** showing whether visibility-limiting labels were applied to your account. **Nobody has built a local reader for it.** It is a file the user downloads, zero network, zero originated calls, which is precisely Aviary's shape. Caveat worth carrying into the build: HN's reaction to the algorithm release was sceptical, *"shared without weights so we only have so much visibility"*, *"How does anyone know if this is actually what is deployed to the live service?"*, so the **personal JSON export** (the user's own data) is the trustworthy half; the ranking weights are the speculative half and should not be presented as ground truth.
2. **X's profile/media redesign hit the web ~2026-08-13→16**, and it is revertible client-side through X's own feature flags. Nine near-identical userscripts appeared within five days (top one at 123 installs/day). This is the hottest live demand in the ecosystem and it corroborates two currently-blocked items.

Top opportunities, in priority order:

1. **The Control Center is unusable in Windows High Contrast.** The settings toggle signals on/off purely through author colours the UA discards under `forced-colors: active`, and its real checkbox is `opacity: 0; appearance: none`, suppressing the UA's own rendering. Zero forced-colors coverage exists.
2. **`aria-busy` is written as `""`, so the save transaction never announces as busy**, and it shares a root cause with the filter-engine defect (F171): half of all `toggleAttribute` calls target attributes that require a value.
3. **The userscript update path is broken twice over.** Beyond the 404 (F183), `@updateURL` points at the full 1.9 MB `.user.js` rather than a `.meta.js`, so every update poll downloads the whole bundle, against a documented Tampermonkey size limit on the update path specifically.
4. **Nothing gates delivery size.** No budget exists in preflight or build; the bundle grew 27 KB in two days.
5. **Selector health knows which feature is broken and never says so.** `selectors.ts` already declares feature ownership and health already computes match state, the join is simply missing.
6. **A feature-bisect wizard is unbuilt anywhere in this field** and directly attacks the project's #1 recurring pain (X DOM churn).
7. **Fully-local hybrid search is now viable in the extension**, and would let Aviary retire the only component that sends post text off-device.
8. **No major extension publishes accessibility CI.** Aviary already has the Playwright harness to be first.
9. **Batch media download probably broke this week**, incumbents report the Photos/Videos split broke exactly this.
10. **Local reading affordances** (read marker, rule expiry, shape filters, thread unroll) are well-evidenced, cheap, and entirely local.

**The positioning nobody has claimed.** Account-safety anxiety is now an explicit purchase blocker, asked twice in three days on a single r/Twitter thread ("Any chance using this will get your account banned?"), and OldTwitter demonstrably fails it (issue #1332, users reporting repeated temp locks that lift when the extension is disabled; the AMO listing was pulled and a third party re-uploaded it unofficially). **No incumbent promises "this cannot get your account restricted."** Aviary's DOM-only, never-originate architecture is precisely that promise, and it is unmade in this market. Two supporting facts: Media Harvest (100k users, the "good" incumbent) ships **no download history and no already-downloaded state**, both of which Aviary already has, and the 151k-install Twitter Media Downloader has been abandoned since 2024-01-03 with users hand-patching bearer tokens to keep it alive.

**Counter-signal, weighed deliberately.** Local-first architecture does not sell on its own. A 9-month retrospective from another local-first extension author (r/chrome_extensions, 2026-08-17) is blunt: *"Users weren't judging whether my architecture was local-first. They were judging the PDF they downloaded… Users may appreciate your architecture, but they experience your product through the result."* The same thread notes that enumerating narrow host permissions can *look* worse at install than `<all_urls>`, because the browser renders them as a long list, the fix being `optional_host_permissions` plus a runtime request behind a user gesture, **which Aviary already does** for `downloads` and the two media hosts. Read together: trust is necessary but not sufficient, and it should be argued through outcomes (files that land correctly, features that survive a redesign) rather than through architecture diagrams.

## Product Map

- **Core workflows**, (1) read a de-advertised, decluttered, re-themed X; (2) filter or hide posts reversibly, per route; (3) save media at original quality; (4) export what you scrolled past in portable formats; (5) keep a local library that outlives what X renders.
- **Personas**, the privacy-motivated reader; the archivist/data-hoarder; the power reader.
- **Platforms**, readable userscript (`@run-at document-start`) and MV3 extension, Chrome ≥116 / Firefox ≥128. Desktop-first, 1440×900 primary. **Distribution today: none** (private repo, 404 update URL).
- **Data flow**, local by default. Opt-in outbound: Aria2, Bluesky/Mastodon crosspost, AI provider, embeddings endpoint. The boundary is absolute: observe responses X already made; never originate an authenticated call, read a cookie, or extract a token.

**Distribution channels, when F125 resolves.** Hacker News is near-zero distribution for this category, every X-extension Show HN in 2026 scored 1 to 5 points. The audience is on **Reddit** (the r/Twitter grid-restore announcement took 167 upvotes / 70 comments in three days) and **Greasy Fork** (a grid-restore script went 0 → 354 installs at 132/day within 48 hours of publishing). Greasy Fork's code rules, no obfuscation, no minification, primary functionality must live in the posted source, describe Aviary's readable single-file build exactly, making its 1.9 MB bundle a compliance asset rather than a quirk. Two standing asks in this ecosystem are packaging, not features: self-distribution over AMO, and signed Firefox builds.

**Mobile is the loudest unserved gap and Aviary does not address it.** On the grid-restore thread it was the single most repeated unanswered question, *"won't work for phone browsers that don't allow for extensions. It's so frustrating trying to look through art on my phone"* (2026-08-15), plus separate Chrome-Android and iOS asks. Aviary is desktop-first by explicit design (1440×900 primary), though `mobile-touch.ts` and coarse-pointer affordances exist. Firefox for Android runs userscript managers, so the userscript build is the plausible path, but nothing verifies it there. Not proposed as work this pass; recorded so the omission is deliberate rather than accidental.

### X platform changes, 2026-05-01 → 2026-08-18 (Verified unless noted)

| Date | Change | Effect |
|---|---|---|
| 2026-02-12 | X **removed the "Dim" theme**; in-app dark-mode toggle removed March 2026 | Aviary's 6 dark palettes, including one named `dim`, now restore something X deleted. Headline feature, not a nicety |
| 2026-05-08 | Home/"Add Tweet"/X icons changed, desktop nav markup changed, "Chat"→"Messages" | **Breaks** selectors |
| 2026-05-16 | Free accounts capped at 50 posts / 200 replies / 400 follows per day | **Breaks** mass-block and unfollow tools; validates read-only |
| 2026-05-30 | **Communities shut down** | Obsoletes Communities features. Aviary references none, no debt |
| 2026-06-03 | API adds `paid_partnership` field | New filterable label in payloads |
| 2026-07-05 | "Manage timelines" button and "More From This Author" in threads | Breaks / opportunity |
| 2026-07-27 | X Money launched (US) | New sidebar surface |
| ~2026-08 | New **Grok upsell in the desktop sidebar** | May escape Aviary's `hideGrok`. **Needs live validation** |
| **2026-08-13** | **X open-sourced its ranking algorithm** (`xai-org/x-algorithm`, Apache-2.0, 31.8k★) **and shipped "Under the Hood"**, eligible users download a JSON of aggregate stats showing visibility-limiting labels applied to their account/posts | **Largest opportunity in the window** |
| **~2026-08-13→16** | **Profile/media redesign on web**: 3-column media grid removed, Media tab split into Photos/Videos (Videos default), multi-image posts become carousels. Revertible via `responsive_web_profile_redesign_enabled` and `rweb_media_carousel_enabled` | **Breaks + hottest demand** |
| 2026-08-17 | The twitter.com escape hatch closed, logging in via twitter.com now sets an x.com cookie | Redirect-based workarounds are dead |
| 2026-08-01 | **Chrome Web Store policy enforced**: user data "strictly necessary to the disclosed single purpose"; new ban on circumventing "safety guardrails… of AI-powered services" | Favours Aviary's posture; the AI provider runner needs careful single-purpose framing at listing time |
| 2026-07-15 | Musk pledged to open source "the entire codebase… no exceptions" | **Likely**, no repo, no deadline, no reviewers as of 2026-08-18. Do not plan against it |

**Bearing on two blocked items.** `Roadmap_Blocked.md` blocks **F115** ("Restore old X" feature-flag reversion) and **F139** (restore the Aug-2026 media redesign) because `featureSwitch` appears zero times in the 2026-05-19 captures and third-party scriptlets are not accepted as evidence. That rule still holds, but the evidence base is now much stronger: the two flag names are used by nine independent scripts with real install counts, and Control Panel for Twitter v4.24.0 (2026-08-17) states it reverts these surfaces "using X's own feature flags." This does not unblock them, only a capture does (F134, expiring 2026-09-30), but it raises their expected value considerably and should inform how F134's capture session is spent.

## Competitive Landscape

Prior detail (Control Panel for Twitter, OldTwitter, TUIC, uBO lists, TwitterMediaHarvest, twitter-click-and-save, phanpy, tweetxvault, ArchiveWeb.page, SingleFile, gallery-dl, twitter-archive-parser) is in the vault note `Research/X Enhancer Ecosystem 2026-08-14.md` and the 2026-08-17 pass. New signal only:

**mkubicek/xTap** (89★, MIT), patches `fetch`/XHR to observe GraphQL X already requested → daily JSONL. *"No scraping, no extra requests, just a tap on the data already flowing through."* **Aviary's architectural twin.** *Learn:* the framing is better than Aviary's own; the passive-tap story should be the README's first paragraph. *Avoid:* its stealth measures (randomized channel names, `toString()` overrides), evasion invites the adversarial relationship Aviary avoids.

**xaitax/X-Posed** (264★, 5,000+ Chrome users), inline country flags, device icons, VPN detection. *Learn:* account-provenance badges have real pull. *Avoid:* everything about how it works, it captures the session's authorization and CSRF headers, calls X's AboutAccount endpoint, and phones home to a 3.3M-entry shared cache. It is the clearest available demonstration of what Aviary refuses, and a direct differentiation target.

**asmyshlyaev177/X-Pat**, MV3, TypeScript + Preact, 2 runtime deps, **609 unit tests**, on the Chrome Web Store. *Learn:* it competes on engineering-quality positioning, which is Aviary's claimed ground, and it is actually distributed, which Aviary is not.

**Advanced Search for X** (1,163 installs, MIT), query-builder with two-way sync to X's search bar, drag-and-drop folders for saved searches, regex mute, local tagged bookmarking. *Learn:* the **search builder is a genuine gap** in Aviary's surface; its bookmark/filter half overlaps Aviary most closely of any competitor.

**Old Twitter Layout (2026)** (80,000 users, 4.5★, 32 locales), full client replacement. *Learn:* the demand for layout restoration is enormous. *Avoid:* the architecture; this is the class that eats ban waves.

**Refined GitHub**, the survival pattern worth copying: a 3-column `broken-features.csv` on GitHub Pages, fetched ≤6-hourly with `cache: 'no-store'`, whose rows **self-expire** once the user's version passes a `Minimum working version` column, plus a `strings.json` selector-override map. Remote *data*, never code, and short-circuited entirely on dev builds. *Learn:* the parser is the valuable part and works identically against a **locally bundled** copy, Aviary can have the disable-a-broken-feature machinery with zero network. *Avoid:* the remote channel itself by default; Dark Reader disabled its equivalent for all users because GitHub does not permit CDN use at scale and *"making requests to other resources would look suspicious"* to reviewers.

**Vencord**, patches declare `fromBuild`/`toBuild` ranges, `group: true` for all-or-nothing application, and fall back to the original module on throw; a headless CI job replays every patch against the live host on a schedule and bins failures into bad-patches / bad-finds / bad-starts. *Learn:* the triage taxonomy and the scheduled replay. *Adapt:* Aviary forbids GitHub Actions, so this must be a local scheduled lane on top of the existing Playwright smoke harness.

**Phanpy**, the reference for local reading UX. Catch-up digest with a 1 to 12h window slider, category chips with live counts, five sort axes including a **post-density metric** (`textLen/140 + 8·media + 8·card`), a Top Links pane, author grouping, and a deliberate refusal to mark anything read, ending in *"That's all."* *Learn:* nearly all of it; every mechanic computes from data Aviary already captures. *Adapt:* its column hotkeys (`1` to `9`, `[`/`]`) violate the no-shortcuts rule and must become click targets.

**Cyd** (Lockdown Systems / Lucy Parsons Labs, https://cyd.social/), local-first, open source, desktop **and mobile**, covering X and Bluesky: *"runs directly on your computer or phone, not on our servers… We don't have access to any of your accounts."* The closest philosophical peer to Aviary's archive half, and the tool r/Twitter now recommends for filtered bulk deletion. *Learn:* it occupies delete/backup/migrate and has no browsing UX, the two products are complements, not rivals, and Aviary should not chase account-mutation features it has forbidden itself. *Note:* it ships on mobile, which Aviary does not.

**Media Harvest** (100,000 users, 4.52★, MV3, scoped permissions), the incumbent Aviary most resembles. Its own store listing concedes *"without batch processing or file compression"*, and 2026-08 reviews ask for exactly what Aviary already ships: download history, already-downloaded state, and bulk selection. One review (2026-08-17) reports the Likes→History tab consolidation broke its download button. *Learn:* the gap it leaves, **tick-box multi-select over a scrolled media tab**, sitting between one-at-a-time (safe, tedious) and full-profile ripping (fast, gets you flagged), is explicitly requested and unserved.

**ShotBird**, a Twitter-adjacent screenshot extension, CWS-Featured in Jan 2025, whose ownership transferred to a new email between Dec 2025 and Mar 2026; it then used `declarativeNetRequest` to **strip CSP and X-Frame-Options headers** and inject fake Chrome-update malware. Delisted 2026-03-09. Together with Nano Adblocker (~300k users, Oct 2020), The Great Suspender (>2M installs, remotely disabled Feb 2021) and Stylish (~1.8M users, sent every URL visited with a persistent id, 2018), this is the dominant failure mode of the genre, and every case ran through either a transfer of publish rights or a pre-existing remote-code path. **Aviary's no-telemetry, no-remote-code posture is what makes it un-sellable and therefore un-poisonable**; that is a marketable trust claim, now backed by the CWS single-purpose rule.

## Security, Privacy, and Reliability

Findings from the 2026-08-17 pass (filter-engine cell collapse, zero-budget-means-unlimited, page-agent nonce replay, offscreen video retention, options-page locale, regex backtracking, seen-post flush, plaintext credential endpoints, unserialized `applyAll`, ad-rule ordering) remain open as F171 to F181. New this pass:

### High

- **The Control Center is not usable in forced-colors mode.** `src/ui/control-center.ts:3231-3262`, `.av-toggle` signals state through `border-color`, `background`, and a `::before` `background`, all author colours the UA forces to system colours under `forced-colors: active`. The real `<input type="checkbox">` is `opacity: 0; appearance: none` (`:3219-3229`), so the UA's own high-contrast checkbox rendering is suppressed too. The only surviving cue is a 14px knob translating 16px. There is **zero** forced-colors coverage in `src`, `tests`, or `tools`, and `box-shadow`, which the UA discards outright, is used 11× in `control-center.ts` and 14× in `theme.ts`. The visual harness already calls `page.emulateMedia({reducedMotion})` at `tools/settings-visual-harness.mjs:311`, so the parameter to cover this already exists. **Verified.**
- **`aria-busy` never announces.** `src/ui/control-center.ts:752`, `transactionBar.toggleAttribute("aria-busy", transactionSaving)` writes `aria-busy=""`. ARIA boolean attributes require the literal string `"true"`; an empty value falls back to the default, false. Screen readers are never told the save is in progress. **Verified.**
- **Root cause behind both that and F171.** All four `toggleAttribute` call sites: `control-center.ts:490` and `:716` use `inert` (a genuine HTML boolean, correct); `filter-engine.ts:206` and `control-center.ts:752` target attributes that require a value (**incorrect**). Half the uses are wrong, and a lint rule restricting the API to a known boolean allowlist prevents the class. **Verified.**

### Medium

- **`@updateURL` points at the full bundle.** The metablock declares both `@updateURL` and `@downloadURL` as `dist/aviary.user.js`; no `.meta.js` is generated anywhere in `tools/build.mjs` or `tools/userscript-meta.mjs`. Every update poll therefore transfers 1.9 MB instead of ~1 KB of metadata. Tampermonkey [#2285](https://github.com/Tampermonkey/tampermonkey/issues/2285) reports *"Message length exceeded maximum allowed length"* on script **update** where a fresh install succeeds, apparently size-linked. **Verified** for the repo facts; **Likely** for the size ceiling (single issue report, worth reproducing).
- **No delivery-size gate exists.** Neither `tools/preflight.mjs` nor `tools/build.mjs` asserts any size budget. The bundle went 1,876,875 → 1,903,859 bytes between 2026-08-15 and 2026-08-16 with no signal. In a repo that gates version strings, CSP, `innerHTML`, capture age and dependency pinning, this is the one unguarded axis. **Verified.**
- **Selector health cannot name the broken feature.** `src/platform/selectors.ts` declares `feature?: string` ("the feature that stops working when this selector stops matching") on **13 of 26** entries, and `requiredOn?: readonly RouteSurface[]` is declared but used **zero** times. `src/features/core/selector-health.ts` computes healthy/degraded and renders Trust rows, but nothing joins ownership to match state, so a user with a broken feature is told only that health is "degraded". **Verified.**
- **Batch media download may be broken.** Aviary's "Download all visible media" walks rendered tweets; X split the Media tab into Photos/Videos around 2026-08-13→16, and competitors report exactly this breakage ("batch downloading no longer works efficiently… only process individual tweets one at a time", Greasy Fork discussion, 2026-08-17). Aviary's captures predate the redesign, so no fixture can answer it. **Needs live validation.**

- **Ad protection is inert under Violentmonkey.** The metablock ships `@inject-into content`, and under that mode Violentmonkey documents `unsafeWindow` as the content script's own global rather than the page `window`. `pageWindowFromSandbox()` (`src/platform/page-bridge.ts:62-77`) correctly detects that and returns `undefined`, so the page agent never installs, taking the userscript's half of the default-on ad guard with it. The comment above that function names the exact failure: *"a feature that installs cleanly, reports itself healthy, and never sees a single request."* README and `docs/INSTALL.md` both list Violentmonkey as supported. The extension build is unaffected (`"world": "MAIN"`). **Verified 2026-08-18.**
- **The README overstates what `--ignore-scripts` defends.** README.md:101-105 says "every major npm compromise of 2026 … executed through" an install script. Of twelve incidents surveyed, install-hook delivery was blocked in seven, including ChainDrop (2026-08-04), which hit Aviary's exact `eslint → file-entry-cache → flat-cache → keyv` chain and missed by whole major versions, but chalk/debug, @redhat-cloud-services (which passed SLSA attestation) and AsyncAPI delivered from the **module body**, which the flag does not touch. The real defences there are zero runtime dependencies and `npm ci` against a committed lockfile, both of which Aviary has. In a repo whose test suite fails builds over settings that claim what nothing implements, its own security claim should meet the same bar.
- **`engines` admits end-of-life Node.** `">=22.23.2"` is satisfied by Node 25.x (EOL 2026-06-01, unpatched) and pre-LTS 26.x. The floor was picked specifically to clear the June and July 2026 Node security releases, so accepting an unpatched line defeats its purpose. Node 24 drops to maintenance 2026-10-20; Node 22 is EOL 2027-04-30. **Verified.**

### Already mitigated, do not re-propose

- **Per-feature error isolation.** `src/features/registry.ts:64-100`, `initAll`, `applyAll`, `destroyAll` and `statuses()` each wrap every feature in try/catch and route failures to diagnostics. Refined GitHub's headline resilience pattern is already implemented here.
- **Trusted Types.** Preflight and `source-contracts.test.mjs` already fail the build on `innerHTML`/`insertAdjacentHTML` outside the policy wrapper, so a host CSP turning on `require-trusted-types-for` cannot break the page world.
- **Local encryption.** Removed deliberately in v1.10.0; a key beside its own ciphertext protects nothing when X's session cookie shares the profile.
- **Chrome MV2 removal (2026-08-31).** Aviary is MV3. No exposure. Firefox has no MV2 deprecation plan and has committed to ≥12 months notice.
- **Dependency CVEs.** There are none the pins are exposed to. Six of seven devDependencies are already at the latest published version; TypeScript is deliberately one major behind for a confirmed reason. Every advisory against esbuild, Playwright and ESLint is out of range, withdrawn, or scoped to a dev-server feature this build never invokes (`tools/build.mjs` uses only the JS build API, never `serve()`). The lockfile has 120 packages, zero non-registry `resolved` URLs, and no `workspaces` field, so the `prepare`-despite-`--ignore-scripts` workspace bypass does not apply either. `esbuild` is the only package with a `postinstall`, and it is redundant because the platform binary arrives through `optionalDependencies`. **Verified 2026-08-18.** No action.
- **esbuild `target`.** Switching from `es2022` to `["chrome116","firefox128"]` was measured across the real entrypoint: 1,905,059 vs 1,905,076 bytes, and byte-identical output when probing `using`, `await using`, RegExp `v`-flag, static blocks, top-level await, import attributes and logical assignment. `es2022` is already conservative for these floors. **Verified non-finding**, recorded so it is not re-investigated.

## Architecture Assessment

- **The i18n catalog is 53.9% of the shipped bundle**, 1,025,753 of 1,903,855 bytes, 8 locales × 934 keys, 6.6 ms module execution and **2.84 MB retained heap per tab**, on every page load, to serve a panel usually never opened. Measured 2026-08-17. This is F138, whose rationale is corrected inline in ROADMAP.md; the new Tampermonkey update-size evidence strengthens it from a performance item to a delivery-integrity one.
- **The Control Center is the churn epicentre**, 70 commits on `src/ui/control-center.ts` (3,536 LOC) plus 38 on `features/core/control-center.ts` plus 35 on `ui/control-center/`. The `sections/` split was correct and is incomplete.
- **36% of the test suite asserts on source text**, 33 of 91 files regex over `src/`, ~350 assertions, four of them frozen version-named audits at a project on 1.27.1. F182 covers this; `source-contracts.test.mjs` is a legitimate exception (it enforces bans, not behaviour).
- **Modules with no direct test**: `page-bridge` (notable given F173), `collector`, `snapshots-feature`, `media-context-menu`, `extension-content`, `extension-page`, `panel-context`, `feature-i18n`.
- **Fully-local hybrid search is now viable in the extension lane.** A model2vec/potion static embedding is *not* a neural network, it is one float row per vocabulary token, so the entire forward pass is tokenize → gather → mean-pool → normalize, implementable in ~130 lines with no ONNX, no WASM, and no `wasm-unsafe-eval`. The published reference implementation uses potion-base-8M PCA'd to 128 dims, int8 with per-row scales: **4.2 MB total, 0.4 ms end-to-end query latency** (vs 23 MB and 18 ms for MiniLM-q8), cosine fidelity 0.999958 against the unquantized table, with an 80-line WordPiece tokenizer and RRF (k=60) fusion. Vector storage at 128-d int8 is 128 B/post, 12.8 MB for 100k posts. **This answers the 2026-08-17 open question directly.** Bundling it inline in the *userscript* is disqualifying (+55% even with an aggressively pruned vocabulary, against a bundle already near a documented update ceiling); in the *extension* it is a `web_accessible_resources` binary, bundled data, not remote code. The userscript path is an opt-in local file the user imports. Adopting it would let Aviary **retire the remote-embedding semantic search**, the only component that sends post text off-device.
- **Accessibility is verified by reading source, not by rendering**, and no major extension (uBlock Origin, Dark Reader, Stylus, Refined GitHub) publishes accessibility CI. Aviary already has Playwright, `launchPersistentContext`, local fixtures and 60 committed baselines; `@axe-core/playwright` scoped to injected selectors would put it ahead of the field for modest effort.

## Rejected Ideas

- **View Transitions for panel tab switches**, proposed by the 2026-08-17 platform survey, now rejected: `document.startViewTransition()` from a content script snapshots the **entire host document**, not just injected UI, and only one can run per document. Effectively unusable for an overlay.
- **A remote hotfix/kill-switch channel as the default**, MV3 forbids remote *code* outright, Greasy Fork forbids loading bulk logic externally, and Dark Reader disabled its remote config for all users on CDN-abuse and reviewer-suspicion grounds. Build the parser; feed it a bundled file. (Refined GitHub's `yolo` repo.)
- **`chrome.debugger`-based capture**, strictly more capable, unavailable to the userscript lane, and a large permission escalation.
- **Redirecting to an alternate front-end**, Nitter is architecturally dead (guest tokens removed 2024-01-31) and the twitter.com escape hatch closed 2026-08-17. Only link *rewriting on copy* is viable (F149).
- **Mass block/mute and chain-blocking**, the loudest unserved demand in the ecosystem, but every implementation originates authenticated writes, and X's 2026-05-16 caps (400 follows/day) now punish it directly. Ship the reversible log/undo model for *local* hide-and-remember instead.
- **Web-of-trust or follow-graph scoring**, requires crawling a graph Aviary must never fetch. A passive "familiarity score" from the local seen store is the honest substitute.
- **Estimate-based substitutes for revoked host data**, Return YouTube Dislike's post-API estimates were documented as off by ~20× in one case. Degrade to "unavailable", never to a confident wrong number.
- **ONNX/transformer embeddings, and the ONNX export of a model2vec model**, 13.8 MB runtime plus a 23 MB model plus `wasm-unsafe-eval`, for 45× the query latency of a lookup table. The model2vec ONNX export is the same 30.2 MB of weights that then *needs* the runtime to do a table lookup.
- **sqlite-vec in WASM**, cannot be dynamically loaded, so it needs a custom static build; 5.9 MB unoptimized; brute-force only with no ANN index.
- **Chrome's built-in AI (Gemini Nano) for search**, no embeddings endpoint, and a 4.27 GB model.
- **Firefox `browser.trial.ml`**, experimental, Firefox-only, documented as "virtually guaranteed to change", and its models come from a remote hub.
- **Auto-fetching assets the user never scrolled to** (browsertrix `autofetch`), originates requests X did not make.
- **Planning against Musk's "entire codebase" pledge**, no repo, no date, no reviewers as of 2026-08-18.
- **Vendoring wabac.js**, AGPLv3; link to replayweb.page instead (still correct, per F147).

## Sources

Prior passes not restated: vault `Research/X Enhancer Ecosystem 2026-08-14.md`, `Research/Browser Enhancer Platform Baselines 2026-08-17.md`, `Research/Old Reddit Ecosystem 2026-08-18.md`.

X platform and policy:
- https://github.com/xai-org/x-algorithm
- https://techcrunch.com/2026/08/13/x-open-sources-its-ranking-algorithm-letting-users-see-if-theyve-been-shadowbanned/
- https://docs.x.com/changelog
- https://www.socialmediatoday.com/news/x-implements-new-posting-restrictions-on-non-paying-users/820671/
- https://techcrunch.com/2026/04/23/x-is-shutting-down-communities-because-of-low-usage-and-lots-of-spam/
- https://www.pcgamer.com/software/we-dont-have-the-capacity-to-support-more-than-two-colors-right-now-is-the-bizarre-excuse-x-is-using-to-explain-why-its-dimmed-theme-was-just-thrown-in-the-bin/
- https://developer.chrome.com/blog/cws-policy-updates-2026
- https://greasyfork.org/en/scripts/591463

Competitors and demand:
- https://github.com/mkubicek/xTap
- https://github.com/xaitax/x-account-location-device
- https://github.com/asmyshlyaev177/x-profile-location
- https://github.com/dimdenGD/OldTwitter/issues/1332
- https://github.com/dimdenGD/OldTwitter/issues/1222
- https://github.com/insin/control-panel-for-twitter/releases
- https://github.com/insin/control-panel-for-twitter/issues/916
- https://github.com/insin/control-panel-for-twitter/issues/598
- https://github.com/insin/control-panel-for-twitter/issues/522
- https://github.com/prinsss/twitter-web-exporter/issues/146
- https://greasyfork.org/en/scripts/542403
- https://greasyfork.org/en/scripts/404587

Survival patterns and failure modes:
- https://github.com/refined-github/yolo
- https://deepwiki.com/Vendicated/Vencord/3.2.2-code-patching-mechanism
- https://github.com/AprilSylph/XKit-Rewritten
- https://code.visualstudio.com/blogs/2021/02/16/extension-bisect
- https://monxresearch-sec.github.io/shotbird-extension-malware-report/
- https://www.ghacks.net/2020/10/16/time-to-remove-nano-adblocker-and-defender-from-your-browsers-except-firefox/
- https://github.com/Tampermonkey/tampermonkey/issues/2285
- https://greasyfork.org/en/help/code-rules

Reading UX and local search:
- https://github.com/cheeaun/phanpy/blob/main/src/pages/catchup.jsx
- https://github.com/cheeaun/phanpy/blob/main/src/utils/group-notifications.js
- https://docs.joinmastodon.org/entities/Filter/
- https://docs.joinmastodon.org/methods/markers/
- https://github.com/bluesky-social/social-app/blob/main/src/lib/moderation/useModerationCauseDescription.ts
- https://bart.degoe.de/semantic-search-in-your-browser/
- https://huggingface.co/minishlab/potion-base-8M

## Open Questions

1. **Is Aviary published or private?** Unchanged from 2026-08-17 and now more urgent: the CWS policy enforced 2026-08-01 requires the AI provider runner to be framed within a disclosed single purpose, and a public repo still requires purging `_decoded/` real-user captures from history first (F184). Blocks F125.
2. **Does batch media download still work after X's Photos/Videos split?** No fixture can answer it, the captures predate the redesign. Determines whether F201 is a bug fix or a no-op.
3. **Does the Tampermonkey update-size ceiling actually bite at 1.9 MB?** One issue report, unreproduced. If it does, F138 stops being a performance item and becomes "installed copies silently never update."
4. **Should the Firefox floor move from 128 to ~147?** Unchanged from 2026-08-17; free today at zero installs, not free after F125 resolves.
