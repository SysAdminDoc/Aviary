# Aviary ROADMAP

Version: `1.20.0`

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

### P2 — Make each Control Center page transactional

Replace per-row commit affordances with one sticky page-level Save/Revert bar while retaining the
existing setting keys and draft model. Validate failed writes, multi-field validation, section/search
navigation guards, focus restoration, and independent drafts across all 13 destinations and nine
locales.

### P2 — Surface ad-contract drift before protection silently fails

Extend the existing selector-health model with local-only ad observations: last route/time, native,
trend, house-promo, and video marker counts, plus a degraded reason when a formerly observed
contract disappears. Never store post text, handles, URLs with tracking parameters, or response
bodies; cover bounded retention and reset behavior.

### P2 — Add desktop visual-regression coverage for the settings system

Promote the 1440×900 and 1920×1080 capture lane into a deterministic screenshot contract for all
Control Center destinations and extension options. Cover dark/light host themes, keyboard focus,
disabled/error/saved states, and reduced motion with a reviewed threshold; keep narrow/mobile
layouts outside this desktop-only product scope.
