# Aviary ROADMAP

Version: `1.21.0`

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
