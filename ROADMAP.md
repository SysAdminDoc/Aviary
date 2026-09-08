# Aviary ROADMAP

Version: `1.49.2`

Date: 2026-09-08

Actionable incomplete work only. `Roadmap_Blocked.md` remains the source for tasks that require a fresh authenticated X capture, distribution identity, or another external environment.

## Research-Driven Additions

### P1, Next

### P2, Later

- **P2. `tests/rtl-control-center.test.mjs` fails under full-suite load and passes alone.**
  Observed 2026-09-08 on v1.49.2: `the Control Center mirrors RTL direction and returns to LTR
  immediately` failed once in a full `npm test` run, then passed in isolation and passed on the
  next full run. It drives a real browser, so the likely shape is the one
  `tests/reading-marker-ui.test.mjs` already hit: a fixed wait standing in for a state change.
  WHEN the full suite runs on a loaded machine, the RTL Control Center test SHALL either pass or
  fail for a reason the failure message names, and SHALL NOT depend on a fixed delay. Find the
  wait, replace it with a poll for the direction actually applied, and prove it by running the
  file in a loop while the rest of the suite runs.

### P3, Under Consideration

## Research-Driven Additions (2026-09-05)

### P2, Later

### P1, Next

## Research-Driven Additions (2026-09-06)

### P1, Next

### P2, Later
