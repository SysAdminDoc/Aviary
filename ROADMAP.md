# Aviary ROADMAP

Version: `1.49.2`

Date: 2026-09-08

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

- **P1. The committed visual baselines are stale and `npm run test:visual` fails 10 of 15.**
  Measured 2026-09-08 on v1.49.2 with a clean tree: `dark X`, `desktop settings screenshots stay
  within the reviewed visual threshold`, `injected timeline surfaces stay within the reviewed
  visual threshold` and others fail against the PNGs in the tree. This is not new work breaking
  them; it reproduces with every uncommitted change reverted, so the baselines have drifted behind
  the UI over several releases. While it stays red the lane cannot report a real regression, and
  `npm run verify:release` cannot pass. WHEN the tree is clean, `npm run test:visual` SHALL pass.
  Review each diff before regenerating: the point of the lane is that a screenshot changed for a
  reason someone agreed to, so `npm run test:visual:update` is the last step, not the first. Note
  which release each drift belongs to in the update commit.

### P2, Later


### P3, Under Consideration

## Research-Driven Additions (2026-09-05)

### P2, Later

### P1, Next

## Research-Driven Additions (2026-09-06)

### P1, Next

### P2, Later
