# Aviary ROADMAP

Version: `1.45.0`

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

## Research-Driven Additions (2026-08-14)

### P2, high-value features

## Research-Driven Additions (2026-08-15)

### P1, trust, reliability, and measured defects

### P2, features

## Research-Driven Additions (2026-08-15, second pass)

Internal audit of the subsystems no prior pass had examined, plus the code added earlier on 2026-08-15. Findings verified against source before listing; file:line cited on each.

### P2, reliability

### P3, small measured defects

- [ ] P3 — F271, The visual baselines cover the panel and nothing Aviary injects into the timeline
  Category: testing
  Where: `tests/visual/baselines/settings/` and the suite that drives it.
  Problem: 66 baselines, and every one of them is the Control Center or the extension options page — 15 sections in dark and light at two viewports, plus four state variants. Nothing Aviary puts on X itself has a baseline: the media buttons, the injected toasts, the hide affordance, the catch-up digest, the AI command menu and the snippet palette all render into the page, all carry their own stylesheet, and all are invisible to this suite. Those are the surfaces most exposed to X changing its markup underneath them, and the ones where a cascade regression like F265 actually shows.
  Evidence: `ls tests/visual/baselines/settings/` returns 66 files, all prefixed `control-center-` or `extension-options-`. `grep -rn "av-media-action\|av-catch-up\|av-ai-menu\|av-snippet" tests/visual/` returns nothing.
  Fix: add a baseline per injected surface against the saved `_decoded/` captures rather than live X, in dark and light. The capture set is the only stable ground truth available, and it is the same fixture the selector tests already use.
  Acceptance: the visual suite fails when an injected surface's rendering changes, not only when the panel's does.
  Confidence: Verified
  Effort: M

- [ ] P3 — F272, The mobile and coarse-pointer path has no behavioural test of its own
  Category: testing
  Where: `src/features/core/mobile-touch.ts` (96 lines), reached from the registry like any feature.
  Problem: two tests touch it and neither exercises what it does. `tests/source-contracts.test.mjs:178` reads the file as text to check its selectors are scoped, and `tests/injected-ui-contract.test.mjs` asserts hit-target sizes on a coarse-pointer emulation. Nothing drives the feature's own `apply`/`destroy` against a touch-shaped DOM, so a regression in what it actually changes would be caught only by the size assertion happening to move.
  Evidence: `grep -rn "mobileTouchFeature" tests/` returns the two sites above and no behavioural case.
  Fix: a feature-lifecycle test in the shape the other features already have: apply against a coarse-pointer page, assert what changed, destroy, assert the page is back to what X rendered.
  Acceptance: `mobileTouchFeature` has a lifecycle test that fails if `destroy` stops reversing `apply`.
  Confidence: Verified
  Effort: S

## Research-Driven Additions (2026-08-16)

Focused comparison of 46 primary sources for feed image/video download behavior. See RESEARCH.md.

## Research-Driven Additions (2026-08-17)

General pass over the subsystems no prior research examined (the 2026-08-16 pass was media-only).
Every defect below was read at the cited line; the five marked (re-checked) were independently
confirmed a second time. See RESEARCH.md.

### P1, measured defects, root cause first

### P1, trust and verification

### P2, platform primitives that delete hand-rolled code

## Research-Driven Additions (2026-08-18)

Completes the 2026-08-17 pass, which lost most of its external streams to an API limit. Defects
below were read at the cited line. See RESEARCH.md.

### P1, accessibility

### P1, delivery integrity

### P2, leapfrog

- [x] F202, P2, Read X's "Under the Hood" export locally
  Why: on 2026-08-13 X began letting eligible users download a JSON of aggregate stats showing whether
  visibility-limiting labels were applied to their account or posts in the past month. It is a file the
  user already has, so reading it originates nothing and crosses no line Aviary draws, and nobody has
  built a reader. Aviary already owns the surfaces this needs: a local library, an import path, and a
  panel to render it in.
  Evidence: https://techcrunch.com/2026/08/13/x-open-sources-its-ranking-algorithm-letting-users-see-if-theyve-been-shadowbanned/ ;
  https://github.com/xai-org/x-algorithm (Apache-2.0).
  Touches: `src/features/library/archive-import.ts` (same import shape), a new Trust or Library surface,
  export formats.
  Acceptance: the user picks the JSON X gave them and sees which labels were applied and when, held
  locally and included in library backup; month-over-month comparison works from stored reports; the
  panel states plainly that this is X's own summary of itself and that the published ranking weights are
  not proof of what runs in production, the export is the user's data, the weights are not.
  Complexity: M

### P2, local reading, all zero-network

- [x] F203, P2, A read marker, a "new since you last looked" line, and hide-seen
  Why: `seen-posts.ts` already records what has gone past, and the highest-value thing to build on it is
  the oldest idea in feed reading: a position marker. Mastodon's markers API is the reference schema
  (`last_read_id` per surface) and X's snowflake ids are ordinal, so "newer than" needs no timestamps.
  NetNewsWire's per-feed read filter is the interaction, and its stated rationale for making unread
  counts optional, that badges are "distracting, less meaningful, or even stressful", is the right
  default for a project that already ships a focus mode.
  Evidence: https://docs.joinmastodon.org/methods/markers/ ;
  https://netnewswire.com/help/ios/6.0/en/filters.html ; `src/features/filtering/seen-posts.ts` (no
  `lastRead`/marker concept today, checked 2026-08-18).
  Touches: `src/features/filtering/seen-posts.ts`, a new reading feature, Layout/Reading settings,
  library backup registration.
  Acceptance: a per-surface marker persists locally; a separator marks the first post newer than it, with
  an explicit "mark above as read" control; "hide posts I have already seen" is a per-surface toggle; no
  unread badge unless opted in; the marker advances only on explicit action or on a post leaving the
  viewport upward, never on mere render; injecting the separator never moves the reading position.
  Complexity: M

- [x] F207, P2, Rebuild threads from what has already been captured
  Why: "archive a thread including all the replies" is a standing unmet request, and Aviary is unusually
  well placed: it already persists GraphQL payloads and `viewer.ts` already groups exported records by
  `conversationId`, but nothing reconstructs a chain for reading. The algorithm is published, merge
  overlapping reply contexts found in the same batch, order replies after parents, flag participants who
  differ from the author to separate a self-thread from a conversation.
  Evidence: https://github.com/cheeaun/phanpy/blob/main/src/utils/timeline-utils.js (`groupContext`);
  r/DataHoarder 2026-08-14; `src/features/export/viewer.ts:206` already keys on `conversationId`;
  no reconstruction exists in `src/features/`.
  Touches: `src/features/export/network-capture.ts` (persist parent/root/author per post),
  `src/features/library/`, a reading surface, export formats.
  Acceptance: a captured thread renders as a continuous ordered read from local records only, with posts
  that were never captured shown as explicit gaps rather than silently omitted; consecutive same-author
  runs collapse in the timeline to a single expandable summary; export carries the reconstructed order;
  zero originated requests.
  Complexity: L

### P1, toolchain and claims (added 2026-08-18, second pass)

- [x] F211, P2, Import the sources under test instead of bundling them first
  Why: 82 of 91 test files bundle through esbuild and import the result, which puts a build step between
  every assertion and the code it describes, and is part of why so many tests fell back to regexing
  source text (F182). Node's type stripping is stable and available on the repo's existing floor, and the
  sources are already erasable-syntax-only (no enums, namespaces, parameter properties, or decorators), so
  `node --test` can import `src/**/*.ts` directly.
  Evidence: https://nodejs.org/api/typescript.html (unflagged since 22.18.0, stable 24.12.0; repo floor is
  22.23.2); verified 2026-08-18 by importing `src/platform/observer.ts` and `network.ts` directly under
  Node with no build step. Cost is mechanical: 351 relative specifiers are extensionless and type
  stripping requires explicit `.ts`, needing `allowImportingTsExtensions` and a `verbatimModuleSyntax`
  pass over 212 value-import sites.
  Touches: `tests/*.test.mjs` (the `importBundledModule` helper), `tsconfig.json`, import specifiers
  across `src/`.
  Acceptance: tests import the modules they describe with no bundling step; the esbuild harness is deleted
  rather than left beside the new path; the build itself still bundles as before; suite runtime does not
  regress. Do this for directness, not speed, the suite is already ~4.5s.
  Note (2026-08-18): F182 landed first, so this no longer blocks it. The 13 driven test files it
  added all bundle through esbuild, which is more surface for this to convert but also a clearer one:
  every new file uses the same helper shape.
  Complexity: L

## Audit Findings — 2026-08-22

Full-repository audit pass. Baseline before this pass was green: `npm run typecheck` exit 0,
`npm run lint` exit 0, `npm test` 799/799 pass, `npm run build` exit 0, `npm run preflight` pass,
`npm run test:visual` 5/5 pass, and `npm run smoke` passed all four lanes (Chromium DNR, Firefox
153.0.3 DNR, the current-X compatibility lane, and the externally-gated lane). The only baseline
warning is recorded as F237 below. `SysAdminDoc/Aviary` has no open or closed GitHub issues, no
pull requests and discussions disabled, so the tracker contributed nothing; the single reported
defect in this pass, F265, came from the repository owner directly while the audit was running and
carries a `Reported:` line. Every item was read at the cited line; the ones marked Verified were
additionally reproduced in a browser, in Node, or by arithmetic shown in the Evidence line.

Note what the green baseline did **not** catch: F265 makes the extension unusable on install, and
the full suite, the visual regression lane and all four smoke lanes pass with it shipping.

Numbering continues the existing `F<n>` scheme from F211. Every P0 and P1 item was additionally put to a fresh-context pass instructed to refute it; all survived except F215, whose mechanism stands while its originally-stated consequence did not, and whose entry now records the correction.

### P0

### P1

### P2

### Unaudited — needs a pass

