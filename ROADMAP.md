# Aviary ROADMAP

Version: `1.49.2`

Date: 2026-09-08

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

### P2, Later

- **P2. `prefers-reduced-motion: reduce` leaves most of the Control Center still animating.**
  Found 2026-09-08 while fixing the RTL test's fixed waits. `src/ui/control-center.ts` declares
  around a dozen 140ms and 150ms transitions -- the toggle knob's `transform`, section buttons,
  inputs, the nav pill -- and the two `@media (prefers-reduced-motion: reduce)` blocks cover only
  `.av-launcher`, `.av-panel` and `.av-nav-launcher-pill`. The `:host([data-av-motion="reduce"])`
  rules, which the in-app reduce-motion setting drives, cover the same three. So a reader who has
  asked their system for less motion still gets an animated toggle knob every time they change a
  setting. WHEN `prefers-reduced-motion: reduce` is set, or the host carries
  `data-av-motion="reduce"`, every transition in the Control Center's shadow tree SHALL be none.
  Prefer one rule that disables transitions across the tree over extending the selector list a
  fourth time, and assert it in a test that reads a computed transition from more than one control,
  since a rule naming three selectors is exactly how this was missed.

### P3, Under Consideration

## Research-Driven Additions (2026-09-05)

### P2, Later

### P1, Next

## Research-Driven Additions (2026-09-06)

### P1, Next

### P2, Later
