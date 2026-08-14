# Aviary ROADMAP

Version: `1.21.0`

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

## Research-Driven Additions (2026-08-14)

### P0 — broken today

- [ ] F107 — P0 — Replace EOL toolchain pins
  Why: ESLint 9 hit end-of-life 2026-08-06 — the pinned 9.27.0 is unmaintained; esbuild 0.28.2 and TypeScript 6.0 are low-risk companion bumps (@typescript-eslint 8.67.0 already supports ESLint 10; Playwright/globals already latest).
  Evidence: https://endoflife.date/eslint; https://eslint.org/blog/2026/02/eslint-v10.0.0-released/; RESEARCH.md Security.
  Touches: package.json, package-lock.json, eslint.config.mjs, tools/preflight.mjs (exact-pin list).
  Acceptance: `npm run verify` green on eslint 10.8.1 + esbuild 0.28.2 + typescript 6.0.x with pins updated everywhere preflight checks.
  Complexity: M

### P1 — trust, reliability, structural gaps

- [ ] F108 — P1 — Anti-adblock exposure mitigation (DOM-only mode)
  Why: X is testing an "ad blocker is preventing Personalized Timelines" warning (2026-07) that plausibly keys on blocked telemetry — Aviary's DNR logger rule and page-world logger stub are its visible surface; structural DOM hiding is detection-quiet.
  Evidence: https://piunikaweb.com/2026/07/10/x-ad-blocker-warning-browser-users/; r/uBlockOrigin corroboration; RESEARCH.md Security.
  Touches: src/features/privacy/ad-protection.ts, src/features/privacy/page-hooks.ts, extension background (DNR rule toggle), Trust section copy, selector-health (detect the warning surface as a contract).
  Acceptance: a `privacy.networkShield` sub-toggle disables the DNR rule + logger stub while keeping structural suppression; the warning surface, if present, is detected and reported in Trust with the tradeoff explained.
  Complexity: M

- [ ] F109 — P1 — First-run onboarding surface
  Why: a fresh install silently blocks ads and adds media buttons with no explanation and no pointer to the settings entry; zero onboarding exists (no first-run/welcome/hasSeen anywhere in src/).
  Evidence: repo recon (grep verified); RESEARCH.md Architecture; HN Tweeks thread trust-reflex (users demand to know what an enhancer does).
  Touches: new src/features/core/first-run.ts, storage key, Control Center, i18n catalog.
  Acceptance: first boot on a profile shows a dismissible, reduced-motion-safe notice naming the two default-on behaviors and linking the nav settings entry; never reappears after dismissal; fixture-tested.
  Complexity: M

- [ ] F110 — P1 — Rule-based filter DSL with importable rule packs
  Why: field+operator+value filtering (author, handle pattern, keyword/regex, media type, age, engagement) is table stakes in CPFT/RES/rxliuli and the sibling x-feed-cleaner — it is Aviary's only structural feature gap; importable/exportable rule packs are the differentiator.
  Evidence: RES filteReddit; https://rxliuli.com/project/twitter-filter/; x-feed-cleaner v2.7.0 (same operator); RESEARCH.md Competitive.
  Touches: src/features/filtering/filter-engine.ts, predicates.ts, settings schema + normalizer, Control Center Filtering section, settings export envelope.
  Acceptance: rules combine (AND/OR), apply per-surface, round-trip through export/import, and are fixture-tested against `_decoded/` captures; no rule can originate a network request.
  Complexity: L

- [ ] F111 — P1 — Settings version envelope + upgrade ladder
  Why: `aviary.settings.v1` is a key name, not a versioned payload — a future breaking schema change has only silent-fallback-to-default; durable storage already has schema versioning, settings should match.
  Evidence: src/platform/settings.ts (no version field); src/platform/durable-storage.ts:1 (schema v1 precedent); RESEARCH.md Security.
  Touches: src/platform/settings.ts, settings-migration.ts, tests.
  Acceptance: persisted payload carries a schema version; an old payload upgrades through explicit steps with a test per step; unknown-future version is preserved untouched with a Trust notice.
  Complexity: M

- [ ] F112 — P1 — Persist diagnostics + surface boot failure
  Why: the 200-event diagnostics ring is memory-only and a boot failure writes `data-av-ready="error"` with nothing user-visible — failures on real pages evaporate before anyone can copy them.
  Evidence: src/platform/diagnostics.ts (41 lines, in-memory); src/main.ts boot path; RESEARCH.md Security.
  Touches: src/platform/diagnostics.ts, durable-storage keys, Trust section (view/copy/clear), boot error toast.
  Acceptance: last N diagnostic events survive reload per profile (bounded, content-free); a boot failure shows a visible one-line notice with a copyable reason.
  Complexity: M

- [ ] F113 — P1 — Fold viewer.ts inline locale table into the i18n pipeline
  Why: src/features/export/viewer.ts carries a second hand-maintained 9-locale table outside the extractor/catalog — the repo has hit five separate i18n-extraction blind spots already; this one is guaranteed drift.
  Evidence: viewer.ts lines ~7-250; CLAUDE.md Learned (i18n incidents 2026-08-06/07); RESEARCH.md Architecture.
  Touches: src/features/export/viewer.ts, tools/i18n-extract.mjs (or a dedicated sync gate test).
  Acceptance: viewer strings come from the catalog (or a generator), and a test fails when viewer copy and catalog diverge.
  Complexity: M

- [ ] F114 — P1 — Close the CI validation gap
  Why: smoke.yml runs lint/matrix/build/visual/smoke but never `npm test` (unit suite) or `npm run preflight` — the primary gate is local-only, so a bad push can be green in CI.
  Evidence: .github/workflows/smoke.yml; RESEARCH.md Security. (Validation CI is allowed; no release binaries.)
  Touches: .github/workflows/smoke.yml.
  Acceptance: CI runs the full `verify` chain (typecheck, lint, unit tests, build, preflight) before the smoke lanes.
  Complexity: S

- [ ] F115 — P1 — "Restore old X" feature-flag reversion pack
  Why: users hand-write uBO filters monthly to rewrite `__INITIAL_STATE__.featureSwitch` (restore media grid vs Videos/Photos split, disable image carousel, disable profile redesign) — recurring demand no extension productizes; Aviary's document-start page agent is the right layer and no API calls are involved.
  Evidence: r/uBlockOrigin 1vob8nh (2026-08-14, `responsive_web_profile_redesign_enabled`), 1v2gxir comments (`rweb_media_carousel_enabled`); CPFT #917/#918; RESEARCH.md Executive Summary.
  Touches: src/page/page-agent.ts (bootstrap-state hook), new feature module + settings group, selector-health (flag-name drift detection), Roadmap_Blocked-style evidence gate per flag.
  Acceptance: each toggle flips one named flag before first paint, is individually reversible, reports drift when the flag name vanishes, and defaults off; verified on live X per flag before enabling in a release.
  Complexity: L

- [ ] F116 — P1 — Hide "More From This Author" thread module
  Why: X injects recommendation modules between replies (July 2026); CPFT shipped the toggle in v4.23.0 and r/uBlockOrigin threads hand-roll filters for it — direct fast-follow with existing declutter machinery.
  Evidence: CPFT v4.23.0 changelog; r/uBlockOrigin 1v2gxir (2026-07-21).
  Touches: src/features/layout/declutter.ts, selectors.ts, `_decoded/` capture of the module (evidence gate), i18n.
  Acceptance: the module collapses with its owning cell on status pages; organic replies untouched; fixture-tested.
  Complexity: S

- [ ] F117 — P1 — Tab-title badge strip + per-metric count granularity
  Why: notification counts leaking into the tab title defeat every declutter mode (Minimal Twitter's top requests #242/#243); Aviary's `hideCounts` is all-or-nothing while CPFT offers per-metric control (replies/reposts/likes/views/bookmarks/followers).
  Evidence: minimal-twitter #242/#243; CPFT option catalog; RESEARCH.md Competitive.
  Touches: src/features/appearance/theme.ts (counts CSS), new title-observer in a core module, settings schema (per-metric enum), Control Center Appearance.
  Acceptance: title shows no "(n)" badge when enabled; each metric class hides independently; accessible totals preserved (existing `/analytics` pattern).
  Complexity: M

### P2 — high-value features

- [ ] F118 — P2 — Media download depth: downloaded badges, text sidecar, batch-from-library
  Why: the install-weighted greasyfork market is media-first; TMH's backlog names exactly these (downloaded-media highlighting #126, tweet-text sidecar #283, batch #137) — and Aviary already has downloadHistory, filename templates, and captured records to build on without new API calls.
  Evidence: TwitterMediaHarvest issues; RESEARCH.md Competitive (ban-risk line: batch consumes captured/library records only).
  Touches: src/features/media/* (badge pass keyed on downloadHistory), export/collector records, library UI (batch action), settings.
  Acceptance: previously saved media shows a subtle marker; optional .json/.txt sidecar per save; "download all captured media for this collection" works checkpointed with zero originated GraphQL calls.
  Complexity: L

- [ ] F119 — P2 — Absolute timestamps option
  Why: relative timestamps hide when things happened; XKit/OldTwitter both ship it; cheap and fixture-testable against existing captures.
  Evidence: XKit Rewritten; OldTwitter feature list.
  Touches: new small feature module, selectors (time elements), settings + i18n.
  Acceptance: timeline/status timestamps render absolute (locale-aware) with exact time on hover; reversible.
  Complexity: S

- [ ] F120 — P2 — Focus mode (time-boxed access)
  Why: antiprocrastination is table stakes across Sink It / X Filter Pro / feed-blocker class; fits Aviary's declutter identity as a scheduled, reversible gate.
  Evidence: https://gosinkit.com/; xfilterpro.com Focus Mode; r/Twitter Unhook-for-X demand (1t5gnh5).
  Touches: new feature module (schedule + soft-block overlay), settings, Control Center.
  Acceptance: outside allowed windows the timeline is replaced by a calm local screen with an explicit override; no data leaves the machine; off by default.
  Complexity: M

- [ ] F121 — P2 — Articles / longform engagement-bait filter
  Why: X "Articles" AI-slop fatigue is a named community demand with no server; fits the filter engine as a surface-scoped action.
  Evidence: r/Twitter 1s37w8z (2026-03); RESEARCH.md Competitive.
  Touches: filter-engine predicates, `_decoded/` capture of an article card (evidence gate), settings.
  Acceptance: article-card units hide/collapse per the filter action; organic posts with links unaffected; fixture-tested.
  Complexity: M

- [ ] F122 — P2 — Video QoL: auto-pause fix + loop; resolve forceVideoQuality
  Why: X pauses video on scroll/blur — active greasyfork/Reddit demand (Aug 2026); meanwhile `performance.forceVideoQuality` is wired but unprovable against MSE playback — prove an effect or remove the claim-shaped setting (settings-claims policy).
  Evidence: r/userscripts 1vgl7ix (2026-08-05); CLAUDE.md 2026-08-07 (MSE, no variant list); tests/settings-claims.test.mjs precedent.
  Touches: src/features/performance/*, page-agent (only if evidence shows a separable quality signal), settings.
  Acceptance: opt-in keeps videos playing on blur/scroll-return and can loop; forceVideoQuality either demonstrably changes delivered quality in a headed test or is removed with migration.
  Complexity: M

- [ ] F123 — P2 — Seen-post dimming (local read tracking)
  Why: XKit's most distinctive reading aid; pairs naturally with Aviary's local stores and virtualizer-safe cell handling.
  Evidence: XKit Rewritten seen-posts module.
  Touches: new feature module + bounded durable store (id-only ring), filtering CSS, settings.
  Acceptance: previously seen post ids dim on revisit; store is bounded and content-free; reversible; off by default.
  Complexity: M

- [ ] F124 — P2 — Per-user color tags on accounts
  Why: RES-style user tagging is proven in the adjacent domain; Aviary's user-notes already stores per-handle data — color labels are the missing visible layer.
  Evidence: RES tagging; XKit relationship badges; src/features/library/user-notes.ts.
  Touches: user-notes.ts (schema + badge render), library backup coverage, settings.
  Acceptance: a handle can carry a colored label visible on posts; included in backup/restore; reversible.
  Complexity: M

- [ ] F125 — P2 — Distribution decision + real Firefox id + update story
  Why: Firefox manifest ships placeholder `aviary@example.local` (AMO-unpublishable); no update_url, no store presence, INSTALL's update story is "reopen the newer file"; community trust analysis says open distribution (AMO especially) is where this category earns users. Blocked on the operator's publish/stay-private decision (RESEARCH.md Open Questions #1).
  Evidence: src/extension/manifest.firefox.json; docs/INSTALL.md; RESEARCH.md Product Map + Open Questions.
  Touches: manifest.firefox.json, tools/build.mjs, docs/INSTALL.md, (if public) AMO/greasyfork listing assets.
  Acceptance: a real stable extension id ships; userscript update URLs serve from the decided channel; INSTALL documents the real update path for both artifacts.
  Complexity: M

- [ ] F126 — P2 — Navigation API route detection (with fallback)
  Why: history monkey-patching is the legacy path; the Navigation API is Baseline (Chrome, Firefox 147+, Jan 2026) and gives cleaner SPA route events on x.com.
  Evidence: https://web.dev/blog/baseline-navigation-api; src/platform/route.ts.
  Touches: src/platform/route.ts (feature-detect, keep patch fallback), tests.
  Acceptance: route changes fire from `navigation` events when available, patch fallback otherwise; matrix lanes unchanged.
  Complexity: S

- [ ] F127 — P2 — Remove the dead `defaultEnabled` gate
  Why: all 24 modules ship `defaultEnabled: true`, the registry skip branch is unreachable, and `statuses()` reports 24 "registered" regardless of user state — a vestigial switch that misdescribes reality.
  Evidence: src/features/registry.ts:62; repo recon grep (0 modules false).
  Touches: registry.ts, all module literals, any status display.
  Acceptance: the contract expresses only what exists (runtime settings gating); statuses reflect actual enablement; tests updated.
  Complexity: S

- [ ] F128 — P2 — Empty states for library surfaces
  Why: only 4 empty states exist (snippets, viewer, hidden posts, options); bookmarks, notes, snapshots, export jobs, integration errors, and settings search show nothing when empty — weak first-use UX for the library pillar.
  Evidence: repo recon grep; RESEARCH.md Architecture.
  Touches: Control Center sections (library/snapshots/export), i18n catalog.
  Acceptance: each empty collection shows one guiding sentence (translated, extractor-reachable per the two-render rule); no layout shift.
  Complexity: S

### P3 — polish and larger bets

- [ ] F129 — P3 — Per-module custom CSS escape hatch
  Why: table stakes in OldTwitter/TUIC/GT2 lineage for power users; bounded per-module scoping keeps it reversible and off the support path.
  Evidence: TUIC CSS packs; OldTwitter custom CSS; RESEARCH.md Competitive.
  Touches: settings (per-module css string), theme/feature style injection, Trust copy (unsupported-styles disclaimer).
  Acceptance: user CSS applies within a module's scope attribute, survives reload, and is excluded from bug-report expectations; off by default.
  Complexity: M

- [ ] F130 — P3 — Relationship badges (follows you / mutual)
  Why: XKit's mutual badges are a proven reading aid; only viable if the relationship bit is already present in captured timeline payloads or DOM — no originated calls.
  Evidence: XKit Rewritten; ban-risk line (RESEARCH.md Security).
  Touches: predicates on existing payload/DOM evidence, media/library badge machinery.
  Acceptance: badge renders only from passively available data; feature ships only after a `_decoded/` capture proves the marker; otherwise stays blocked-style gated.
  Complexity: M

- [ ] F131 — P3 — Logo/favicon replacement option
  Why: TUIC/CPFT both ship it; pairs with Aviary's new brand mark and Noir; trivially reversible.
  Evidence: TUIC feature list; CPFT option catalog.
  Touches: small appearance module (favicon link swap + header logo CSS), settings.
  Acceptance: X's logo/favicon can show the classic bird or Aviary mark; exact restore on Off.
  Complexity: S

- [ ] F132 — P3 — Ad-label locale audit beyond the 9 panel locales
  Why: uBO filters break exactly on ad-label localization; Aviary's bounded label list should be audited against X's full UI-locale set (X ships ~30+ UI languages), not just Aviary's 9 panel locales — a user browsing X in Italian still deserves ad suppression.
  Evidence: uBO breakage history (mrod.space analysis); src ad-label locale list; RESEARCH.md Competitive.
  Touches: ad-protection label table, ad-corpus fixtures (one per added locale), tests.
  Acceptance: label table covers X's supported UI locales with a fixture-backed test per label shape; drift diagnostics count unchanged.
  Complexity: M

- [ ] F133 — P3 — Repo hygiene: relocate root captures, refresh stale mockups
  Why: two ~700KB .mhtml reference fixtures sit at repo root instead of beside `_decoded/`; 5 undated mockups depict the dead 4-section IA; `.github/` lacks issue/PR templates.
  Evidence: repo root listing; docs/mockups/ root files; RESEARCH.md Architecture.
  Touches: repo root, docs/mockups/, .github/.
  Acceptance: captures live under `_decoded/` (paths updated where referenced), stale mockups moved to a dated archive folder or deleted, templates added.
  Complexity: S
