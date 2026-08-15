# Aviary ROADMAP

Version: `1.22.0`

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

- [ ] F130 — P3 — Relationship badges (follows you / mutual)
  Why: XKit's mutual badges are a proven reading aid; only viable if the relationship bit is already present in captured timeline payloads or DOM — no originated calls.
  Evidence: XKit Rewritten; ban-risk line (RESEARCH.md Security).
  Touches: predicates on existing payload/DOM evidence, media/library badge machinery.
  Acceptance: badge renders only from passively available data; feature ships only after a `_decoded/` capture proves the marker; otherwise stays blocked-style gated.
  Complexity: M

- [ ] F132 — P3 — Ad-label locale audit beyond the 9 panel locales
  Why: uBO filters break exactly on ad-label localization; Aviary's bounded label list should be audited against X's full UI-locale set (X ships ~30+ UI languages), not just Aviary's 9 panel locales — a user browsing X in Italian still deserves ad suppression.
  Evidence: uBO breakage history (mrod.space analysis); src ad-label locale list; RESEARCH.md Competitive.
  Touches: ad-protection label table, ad-corpus fixtures (one per added locale), tests.
  Acceptance: label table covers X's supported UI locales with a fixture-backed test per label shape; drift diagnostics count unchanged.
  Complexity: M
