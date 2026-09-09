# Aviary ROADMAP

Version: `1.49.2`

Date: 2026-09-08

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

- **P1. `npm run test:visual` fails a different reflow viewport on each run; the lane passes alone.**
  Measured 2026-09-08 on v1.49.2 after the baselines were regenerated: `node --test
  tests/visual/reflow-visual-regression.test.mjs` passes 7/7 on its own in about 258s, while
  `npm run test:visual` fails one to three sub-tests, a different viewport each time (768x900,
  then 1280x900 at 100% and 400%, then 1280x900 at 200%). The failure is
  `page.waitForFunction: Timeout ... exceeded`, not a pixel diff, so it is contention: three
  browser-driving lanes share one machine in that script. Raising the panel waits from 10s to 30s
  reduced it but did not remove it. WHEN the three visual lanes run together on a loaded machine,
  each SHALL either pass or fail on a pixel comparison, never on a wait for the panel to open.
  Look at running the lanes serially in separate processes, or at what makes the panel take tens of
  seconds to mount under load, before raising a timeout again.

### P2, Later


### P3, Under Consideration

## Research-Driven Additions (2026-09-05)

### P2, Later

### P1, Next

## Research-Driven Additions (2026-09-06)

### P1, Next

### P2, Later
