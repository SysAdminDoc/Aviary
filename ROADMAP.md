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

- [ ] P3 — F267, `readHasLink` still reads the whole article for a post with no caption
  Category: correctness
  Where: `src/features/filtering/predicates.ts` (`readHasLink`), the `(textNode ?? article)` fallback.
  Problem: its own comment says "Only links inside the post's own text; the action bar and quoted chrome are not the author's", and that is true only while a `tweetText` node exists. For a media-only post there is none, so the whole article is searched and the author's own profile link can satisfy a `link is true` rule. This is the same fallback that F246 removed from `readText` two functions above, left in place here.
  Evidence: read at the cited line after F246 landed. A reviewer could reproduce it on a capture-shaped DOM where profile hrefs are absolute, and could not on a live-X-shaped DOM where they are root-relative, so the reach depends on X's markup rather than on Aviary.
  Fix: return `false` when there is no `tweetText` node, matching `readText`. If link detection should cover card and quote chrome, that belongs in its own predicate with its own name.
  Acceptance: a test builds a media-only post whose only anchor is the author's profile link and asserts a `link is true` rule does not match it, with a captioned control that still does.
  Confidence: Likely
  Effort: S

- [ ] P3 — F268, Three comments claim a Popover API fallback that does not exist
  Category: maintainability
  Where: `src/ui/control-center.ts` (the `showPopover`/`hidePopover` try/catch), `src/features/ai/command-menu.ts`, `src/features/composer/composer-snippets.ts`.
  Problem: each `try { showPopover?.() } catch {}` carries a comment saying the surface "remains usable in a test host that exposes the attribute but not the methods". Since the closed state is now hidden by `:not(:popover-open)`, a host with the selector but no methods gets an invisible surface instead — and for the Control Center that is the bad end state: `document.body` is made `inert`, the panel takes focus, nothing is visible, and `handlePanelKeyDown` handles only Tab, so UA light-dismiss is the only exit and it cannot fire. No shipping engine has the selector without the methods, so this is unreachable; it is logged because the code asserts the opposite in three places.
  Evidence: reproduced by deleting `HTMLElement.prototype.showPopover` in a page that still supports the selector — the AI menu and the panel both computed `display: none` with a zero box.
  Fix: either drop the fallback comments and let the call throw into the caller's own error path, or make the catch fall back to an explicit visible state rather than leaving the surface hidden and the body inert.
  Acceptance: the comments describe what the code does, or a host without `showPopover` leaves the page usable.
  Confidence: Verified
  Effort: S

- [ ] P2 — F232, Panel status messages are split down the middle on terminal punctuation
  Category: ux
  Where: every `ctx.save(...)` and `ctx.setStatus(...)` call across `src/ui/control-center/sections/data.ts`, `advanced.ts` and `reading.ts`. Both land in the same element through `src/ui/control-center.ts:893-899`.
  Problem: `ctx.setStatus` messages end with a period and `ctx.save` messages do not, so the same status line alternates between the two styles depending on which helper the last action used. The clash is visible inside a single section: `data.ts:92` "Snapshots cleared" against `data.ts:758` "Bookmarks cleared."; `data.ts:1715` "History cleared" against `data.ts:1718` "Could not clear history."
  Evidence: read at the cited lines. Roughly 76 `ctx.setStatus` strings across the three section files end in a period and roughly 122 `ctx.save` strings do not; both reach `status.textContent` through the same `setStatus` in `control-center.ts:895`.
  Fix: settle on the sentence form, which is the majority of the user-visible text, and add the period to every `ctx.save(...)` message. Re-run `node tools/i18n-extract.mjs --write` because the English strings are the catalog keys.
  Acceptance: a source-contract test asserts every string literal passed to `ctx.save(` and `ctx.setStatus(` in `src/ui/control-center/sections/` ends in `.`, `…`, `%` or a digit.
  Confidence: Verified
  Effort: S

- [ ] P2 — F233, Em dashes in 61 authored user-facing strings, against the project's own rule
  Category: docs
  Where: `src/ui/control-center/sections/advanced.ts` (7: lines 21, 213, 234, 507, 896, 1007, 1164); `src/ui/control-center.ts` (5 user-facing: 1556, 1558, 1571, 1576, 1656); `src/features/export/external-targets.ts` (5: 35, 39, 68, 69, 113); `src/features/library/reports.ts` (5: 29, 37, 45, 46, 69); `src/features/ai/command-menu.ts` (4: 206, 227, 269, 277); `src/features/export/formatters.ts` (4: 131, 192, 200, 209); `src/extension/options.html` (3: 6, 80, 82); `src/ui/control-center/sections/data.ts` (3: 217, 289, 826); `src/ui/control-center/sections/reading.ts` (3 on 2 lines: 221 twice, 1026); `src/features/media/media-buttons.ts` (2: 887, 973); `src/features/export/viewer.ts` (2: 24, 284); `src/features/filtering/hidden-posts-feature.ts` (2: 366, 409); `src/features/filtering/rules.ts` (2: 450, 453); and one each in `src/entrypoints/extension-options.ts:165`, `src/features/integrations/crosspost.ts:215`, `src/features/library/archive-import.ts:97`, `src/features/library/cleanup-preview.ts:90`, `src/features/media/downloader.ts:272`, `src/ui/control-center/sections/presets.ts:73`. `src/features/layout/focus-mode.ts:151` carries the repository's only en dash.
  Problem: the project rule is that no em dash or en dash appears in prose a human reads outside this machine, and these are panel copy, toasts, error text, the options page, and text written into exported documents the user opens. Code comments and log lines are exempt and are excluded from the counts above.
  Evidence: a scan of every `.ts`, `.html` and `.css` file under `src/` for U+2014 and U+2013, excluding lines whose trimmed form starts with `//`, `/*` or `*`, returns 357 occurrences, of which 296 are in the generated `src/platform/i18n-catalog.ts`. The remaining 61 are the authored strings listed above. `README.md`, `docs/FAQ.md`, `docs/INSTALL.md`, `docs/PRIVACY.md`, `LOGO_PROMPTS.md` and `design-qa.md` are already clean, with zero of either character, so no documentation retrofit is needed.
  Fix: rewrite each with a period, a comma, parentheses, or the interpunct this panel already uses as a separator (`data.ts:289`, `advanced.ts:426`). Two need care: `options.html:80` is a `data-i18n` key and `:82` is the text it looks up, so both must change together or the lookup misses; and `src/platform/i18n-catalog.ts` must be regenerated with `node tools/i18n-extract.mjs --write` in the same commit, because the English strings are the catalog keys and every edited string otherwise falls back to English in all eight locales.
  Acceptance: the scan above returns 0 for authored source; a source-contract test fails on U+2014 or U+2013 in any string literal outside comments and outside `i18n-catalog.ts`.
  Confidence: Verified
  Effort: M

### P3, small measured defects

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

- [ ] P3 — F267, `readHasLink` still reads the whole article for a post with no caption
  Category: correctness
  Where: `src/features/filtering/predicates.ts` (`readHasLink`), the `(textNode ?? article)` fallback.
  Problem: its own comment says "Only links inside the post's own text; the action bar and quoted chrome are not the author's", and that is true only while a `tweetText` node exists. For a media-only post there is none, so the whole article is searched and the author's own profile link can satisfy a `link is true` rule. This is the same fallback that F246 removed from `readText` two functions above, left in place here.
  Evidence: read at the cited line after F246 landed. A reviewer could reproduce it on a capture-shaped DOM where profile hrefs are absolute, and could not on a live-X-shaped DOM where they are root-relative, so the reach depends on X's markup rather than on Aviary.
  Fix: return `false` when there is no `tweetText` node, matching `readText`. If link detection should cover card and quote chrome, that belongs in its own predicate with its own name.
  Acceptance: a test builds a media-only post whose only anchor is the author's profile link and asserts a `link is true` rule does not match it, with a captioned control that still does.
  Confidence: Likely
  Effort: S

- [ ] P3 — F268, Three comments claim a Popover API fallback that does not exist
  Category: maintainability
  Where: `src/ui/control-center.ts` (the `showPopover`/`hidePopover` try/catch), `src/features/ai/command-menu.ts`, `src/features/composer/composer-snippets.ts`.
  Problem: each `try { showPopover?.() } catch {}` carries a comment saying the surface "remains usable in a test host that exposes the attribute but not the methods". Since the closed state is now hidden by `:not(:popover-open)`, a host with the selector but no methods gets an invisible surface instead — and for the Control Center that is the bad end state: `document.body` is made `inert`, the panel takes focus, nothing is visible, and `handlePanelKeyDown` handles only Tab, so UA light-dismiss is the only exit and it cannot fire. No shipping engine has the selector without the methods, so this is unreachable; it is logged because the code asserts the opposite in three places.
  Evidence: reproduced by deleting `HTMLElement.prototype.showPopover` in a page that still supports the selector — the AI menu and the panel both computed `display: none` with a zero box.
  Fix: either drop the fallback comments and let the call throw into the caller's own error path, or make the catch fall back to an explicit visible state rather than leaving the surface hidden and the body inert.
  Acceptance: the comments describe what the code does, or a host without `showPopover` leaves the page usable.
  Confidence: Verified
  Effort: S

- [ ] P2 — F232, Panel status messages are split down the middle on terminal punctuation
  Category: ux
  Where: every `ctx.save(...)` and `ctx.setStatus(...)` call across `src/ui/control-center/sections/data.ts`, `advanced.ts` and `reading.ts`. Both land in the same element through `src/ui/control-center.ts:893-899`.
  Problem: `ctx.setStatus` messages end with a period and `ctx.save` messages do not, so the same status line alternates between the two styles depending on which helper the last action used. The clash is visible inside a single section: `data.ts:92` "Snapshots cleared" against `data.ts:758` "Bookmarks cleared."; `data.ts:1715` "History cleared" against `data.ts:1718` "Could not clear history."
  Evidence: read at the cited lines. Roughly 76 `ctx.setStatus` strings across the three section files end in a period and roughly 122 `ctx.save` strings do not; both reach `status.textContent` through the same `setStatus` in `control-center.ts:895`.
  Fix: settle on the sentence form, which is the majority of the user-visible text, and add the period to every `ctx.save(...)` message. Re-run `node tools/i18n-extract.mjs --write` because the English strings are the catalog keys.
  Acceptance: a source-contract test asserts every string literal passed to `ctx.save(` and `ctx.setStatus(` in `src/ui/control-center/sections/` ends in `.`, `…`, `%` or a digit.
  Confidence: Verified
  Effort: S

- [ ] P2 — F233, Em dashes in 61 authored user-facing strings, against the project's own rule
  Category: docs
  Where: `src/ui/control-center/sections/advanced.ts` (7: lines 21, 213, 234, 507, 896, 1007, 1164); `src/ui/control-center.ts` (5 user-facing: 1556, 1558, 1571, 1576, 1656); `src/features/export/external-targets.ts` (5: 35, 39, 68, 69, 113); `src/features/library/reports.ts` (5: 29, 37, 45, 46, 69); `src/features/ai/command-menu.ts` (4: 206, 227, 269, 277); `src/features/export/formatters.ts` (4: 131, 192, 200, 209); `src/extension/options.html` (3: 6, 80, 82); `src/ui/control-center/sections/data.ts` (3: 217, 289, 826); `src/ui/control-center/sections/reading.ts` (3 on 2 lines: 221 twice, 1026); `src/features/media/media-buttons.ts` (2: 887, 973); `src/features/export/viewer.ts` (2: 24, 284); `src/features/filtering/hidden-posts-feature.ts` (2: 366, 409); `src/features/filtering/rules.ts` (2: 450, 453); and one each in `src/entrypoints/extension-options.ts:165`, `src/features/integrations/crosspost.ts:215`, `src/features/library/archive-import.ts:97`, `src/features/library/cleanup-preview.ts:90`, `src/features/media/downloader.ts:272`, `src/ui/control-center/sections/presets.ts:73`. `src/features/layout/focus-mode.ts:151` carries the repository's only en dash.
  Problem: the project rule is that no em dash or en dash appears in prose a human reads outside this machine, and these are panel copy, toasts, error text, the options page, and text written into exported documents the user opens. Code comments and log lines are exempt and are excluded from the counts above.
  Evidence: a scan of every `.ts`, `.html` and `.css` file under `src/` for U+2014 and U+2013, excluding lines whose trimmed form starts with `//`, `/*` or `*`, returns 357 occurrences, of which 296 are in the generated `src/platform/i18n-catalog.ts`. The remaining 61 are the authored strings listed above. `README.md`, `docs/FAQ.md`, `docs/INSTALL.md`, `docs/PRIVACY.md`, `LOGO_PROMPTS.md` and `design-qa.md` are already clean, with zero of either character, so no documentation retrofit is needed.
  Fix: rewrite each with a period, a comma, parentheses, or the interpunct this panel already uses as a separator (`data.ts:289`, `advanced.ts:426`). Two need care: `options.html:80` is a `data-i18n` key and `:82` is the text it looks up, so both must change together or the lookup misses; and `src/platform/i18n-catalog.ts` must be regenerated with `node tools/i18n-extract.mjs --write` in the same commit, because the English strings are the catalog keys and every edited string otherwise falls back to English in all eight locales.
  Acceptance: the scan above returns 0 for authored source; a source-contract test fails on U+2014 or U+2013 in any string literal outside comments and outside `i18n-catalog.ts`.
  Confidence: Verified
  Effort: M

- [ ] P2 — F256, The snapshot diff presents a scroll-depth artifact as a follow and unfollow list
  Category: correctness
  Where: `src/features/library/snapshots-feature.ts:45` (`collectAccountsFromDom`), `src/features/library/snapshots.ts:8-14` (`SnapshotEntry`) and `:100-121` (`diffSnapshots`), rendered at `src/features/library/reports.ts:45-47`.
  Problem: a snapshot captures only the account rows the browser had rendered at that moment, which the capture button's own copy is honest about. But `SnapshotEntry` records no coverage marker beyond `source: "dom"`, `diffSnapshots` compares two partial sets as though both were complete, and the downloadable report prints the result as fact under "Added" and "Removed". Capture a followers list after scrolling to 400 rows, capture again next week after scrolling to 150, and the report names 250 specific accounts as Removed. Nobody unfollowed; they were off screen. `src/features/core/control-center.ts:1209` selects the diff for the report automatically with no comparability check.
  Evidence: read at the cited lines. `snapshots.ts:8-14` has no field describing how much of the list was seen, so `diffSnapshots` has nothing it could check even if it wanted to.
  Fix: record the rendered row count and whether the list reached its end on each entry. Refuse to diff, or label the whole diff as partial, when the two entries' coverage differs materially. Rename the buckets to "present only in the earlier capture" and "present only in the later capture", which is what the data supports.
  Acceptance: a test diffs a 400-row snapshot against a 150-row snapshot of the same list and asserts the report is labelled partial rather than naming 250 removals.
  Confidence: Verified
  Effort: M

### P3

- [ ] P3 — F237, Two `_decoded/` captures are past their staleness ceiling and the waiver expires 2026-09-30 (pre-existing baseline)
  Category: docs
  Where: `_decoded/captures.json`; the gate is `tools/preflight.mjs`.
  Problem: `npm run preflight` passes with the warning "stale DOM captures: home.html 95d (captured 2026-05-19), status.html 95d (captured 2026-05-19), past the 90-day ceiling; waived until 2026-09-30, after which preflight fails". The captures are the only ground truth for every selector in the project, so after 2026-09-30 the build gate fails and no selector claim can be re-measured until they are refreshed. This is baseline state, not something this audit introduced.
  Evidence: `npm run preflight` output, verbatim above, exit code 0.
  Fix: follow the "Refreshing the capture set" procedure in CLAUDE.md — the capture half needs a signed-in operator, so schedule it before the waiver expires rather than discovering it at a release. Re-run every "measured: N hits" claim in `Roadmap_Blocked.md` against the new captures and record the new date, including the ones that stay blocked.
  Acceptance: `npm run preflight` reports no stale-capture warning; `_decoded/captures.json` carries a `capturedOn` within the ceiling for both routes.
  Confidence: Verified
  Effort: M
  Blocked: needs a signed-in operator to save the two MHTML captures. Nothing in the repo logs in or fetches.

- [ ] P3 — F238, `createStorageGateway.remove()` is the one write path the error sink cannot see
  Category: maintainability
  Where: `src/platform/storage.ts:105-125` (`remove`), against `:56-82` (`get`) and `:84-103` (`set`).
  Problem: `get` reports through `reportStorageError` and returns its fallback; `set` reports and rethrows. `remove` does neither — no try, no report — so a failed delete throws raw at the caller and never reaches diagnostics. That contradicts the module's own comment at `:29-36`, which says reporting here "catches every one of them, and every store added later, without each having to remember to plumb a sink through its constructor". Callers such as `ProfileManager.adoptLegacyIntoActive` (`src/platform/profile.ts:150`) call `this.#base.remove(key)` bare, so a quota or backend error there propagates as an unreported rejection.
  Evidence: read at the cited lines; `remove` is four `if` blocks and a `throw`, with no `try` and no `reportStorageError` call anywhere in its body.
  Fix: wrap `remove`'s body the way `set` is wrapped, reporting through `reportStorageError(storageKey, error, "write")` and rethrowing.
  Acceptance: a test that makes the backing store's delete throw and asserts the sink registered by `setStorageErrorSink` was called with the key and `"write"`.
  Confidence: Verified
  Effort: S

- [ ] P3 — F239, About 110 lines of a superseded translation system are still in the platform layer
  Category: maintainability
  Where: `src/platform/i18n.ts:24-146` — the `StringKey` union, the `FALLBACK` map, `PARTIAL_BUNDLES`, and `translate(locale, key)`.
  Problem: nothing in `src/` calls `translate` or references `StringKey`. The panel and every feature use the gettext-style catalog through `translateText` and `ft` instead. The dead code is actively misleading: it presents a second, visibly incomplete translation system (Spanish has 12 of 36 keys, Japanese 7, Arabic and Hebrew 6, and Portuguese and Korean have no bundle at all) beside one the tests hold at 100% coverage, and it preserves stale product language — `"ui.exportVisible": "Export visible tweets"` — that F227 is removing from the live UI.
  Evidence: `grep -rn "\btranslate(" src/ --include=*.ts` excluding `translateText` and `i18n.ts` itself returns only `src/entrypoints/extension-options.ts`, which defines and calls its own local `translate` over a build-time catalog. `grep -rn "StringKey" src/` returns nothing outside `i18n.ts`. Only `tests/v1.0.0.test.mjs` keeps it referenced. It does not reach users: `grep -c "PARTIAL_BUNDLES" dist/aviary.user.js` returns 0, so esbuild already tree-shakes it out of the bundle.
  Fix: delete the four exports and update `tests/v1.0.0.test.mjs`, which is the only thing keeping them alive.
  Acceptance: `grep -rn "PARTIAL_BUNDLES\|StringKey" src/ tests/` returns nothing; `npm test` and `npm run typecheck` stay green.
  Confidence: Verified
  Effort: S

- [ ] P3 — F240, Boot performs 28 serial storage round-trips to compute a boolean that only drives a UI hint
  Category: perf
  Where: `src/platform/profile.ts:107` (`this.#legacyDataAvailable = await this.hasLegacyData()`), called from `load()`, which `src/main.ts:130` awaits before any feature initializes. The loop is `profile.ts:158-163` over the 28 entries of `PROFILE_MIGRATION_KEYS` (`:7-33`).
  Problem: `hasLegacyData` awaits one `#base.get` per key and returns on the first hit. Twenty-five of those keys match `#isDurable`, so each is a separate IndexedDB read transaction through `DurableStorageGateway`. On a fresh install none of them hit, so the full 28 run to completion, in series, on the boot critical path — and the only consumer of the result is `legacyDataAvailable` in `ProfileStatus`, which the panel uses to decide whether to offer the "Assign legacy data here" row. `DurableStorageGateway.initialize` (`durable-storage.ts:127-141`) has already walked a 27-key list serially just before this.
  Evidence: read at the cited lines; `PROFILE_MIGRATION_KEYS` has 28 entries and `hasLegacyData` is a bare `for … await` with no batching and no caching between boots.
  Fix: compute it lazily — the panel is the only reader, so have `status()` resolve it on demand and cache the answer, or persist a one-time "legacy swept" marker after the first negative sweep so later boots skip the walk entirely. If it must stay eager, run the reads with `Promise.all` and let the gateway coalesce.
  Acceptance: a boot with no legacy data performs at most a small constant number of storage reads before `registry.initAll`, asserted with a counting stub gateway in `tests/profile.test.mjs`.
  Confidence: Verified
  Effort: S

- [ ] P3 — F241, Two blob download helpers leak their object URL on the error path
  Category: reliability
  Where: `src/features/media/sidecar.ts:121-134` and `src/features/core/control-center.ts:1538-1552` (`downloadBlob`).
  Problem: both create the object URL, build an anchor, append it, click it, and only then schedule `setTimeout(() => URL.revokeObjectURL(url), 4000)`. In `sidecar.ts` the URL is block-scoped inside the `try`, so anything that throws between creation and the timeout — a null `document.body`, a `click()` the page blocks — strands the blob for the document's lifetime and returns `false` as if nothing had been allocated. `downloadBlob` has no `try` at all, so the same throw both leaks the URL and propagates to the caller. The window is narrow and this is unlikely on a live X page; it is logged because the error path is the one place neither helper covers.
  Evidence: read at the cited lines. `sidecar.ts:122-123` is `const blob = new Blob(...); const url = URL.createObjectURL(blob);` inside the `try` whose `catch { return false; }` is at `:132-134`.
  Fix: hoist `url` above the `try` and revoke it in a `finally` when the timeout was never armed, or wrap the anchor work in its own inner try that revokes immediately on failure.
  Acceptance: a test that makes `anchor.click()` throw and asserts `URL.revokeObjectURL` was called with the created URL.
  Confidence: Likely
  Effort: S


- [ ] P3 — F258, The exported viewer still carries a hand-maintained locale table
  Category: maintainability
  Where: `src/features/export/viewer.ts:142-143`, inside the generated script.
  Problem: the file's own header comment condemns exactly this pattern — a second, hand-maintained nine-locale table living outside the catalog, which nothing can keep honest. `buildViewerLabels()` was moved onto `supportedLocales()`, but `const LOCALES = ["en", "es", "pt", "fr", "de", "ja", "ko", "ar", "he"];` and `const RTL = new Set(["ar", "he"]);` were left as literals. Add a locale to the registry and every test still passes while the exported viewer's picker omits it and `localeFromBrowser()` falls back to English; add an RTL locale and it renders left to right; remove one and `LABELS[code].name` at `viewer.ts:217` throws inside `applyLabels()`, which is the generated IIFE's last statement, so the whole viewer renders blank.
  Evidence: read at `viewer.ts:142-143`. The two literals currently agree with the registry — `supportedLocales()` returns `en,es,pt,fr,de,ja,ko,ar,he` with `ar,he` right-to-left — so this is latent drift rather than a live defect. `tests/viewer-i18n.test.mjs:53` checks the derived `LOCALE_ORDER` and `:120-140` checks the inlined `LABELS` names; neither can see these two lines.
  Fix: interpolate both from the registry the way `labels` already is — `const LOCALES = ${JSON.stringify(LOCALE_ORDER)};` and `const RTL = new Set(${JSON.stringify(rtlCodes)});`.
  Acceptance: `tests/viewer-i18n.test.mjs` asserts the generated HTML contains no locale code the registry does not list, and that its RTL set matches the registry's right-to-left entries.
  Confidence: Verified
  Effort: S

- [ ] P3 — F259, Cleanup preview guesses reply and repost from post text while the authoritative field is on the record
  Category: correctness
  Where: `src/features/library/cleanup-preview.ts:82-83` and the reason string at `:92`.
  Problem: the classifier tests `record.text.startsWith("RT @")`, `startsWith("Reposted ")` and `startsWith("@")` and then states the guess as fact — "Reply to another account". `src/features/library/archive-import.ts:374` already populates `record.parentId` from `in_reply_to_status_id_str` and `:380` populates `conversationId`, and the classifier ignores both. A standalone post that opens with `@handle` is bucketed and explained as a reply; a genuine reply whose text begins with a word is reported as an original post; a post that quotes the string `RT @foo` becomes a repost. These counts drive `byBucket` in the downloadable report.
  Evidence: read at the cited lines. `tests/v0.11.0.test.mjs:82-124` pins the three happy-path shapes and never supplies a record carrying `parentId`.
  Fix: prefer `record.parentId != null` for the `replies` bucket and fall back to the text heuristic only when the field is absent, labelling that case as inferred rather than asserted.
  Acceptance: a test classifies a record with `parentId` set and text that does not start with `@` as a reply, and a record with no `parentId` whose text starts with `@` as inferred rather than asserted.
  Confidence: Verified
  Effort: S

- [ ] P3 — F260, `filter.selfRepost` is dead schema with no note saying why
  Category: maintainability
  Where: `src/platform/settings.ts:289-290` (declaration), `:443-444` (default), `:727-732` (normalizer).
  Problem: `filter.selfRepost` and `filter.blockedAccounts` are declared, defaulted and normalized, and neither is read by any feature nor rendered by any panel row. `blockedAccounts` carries an explicit note at `settings.ts:440-442` pointing at the blocked F032 item; `selfRepost` carries none, so the next reader has to rediscover that it is parked rather than broken. Both are already tracked in `Roadmap_Blocked.md` under "Settings that normalize but nothing reads" — this item is only about the missing comment, not about implementing either filter.
  Evidence: `grep -rn "selfRepost" src/` returns only the three settings.ts sites. `tests/filter-engine-work.test.mjs:274` covers the narrower property that an unread filter action must default to `"off"`, which both satisfy.
  Fix: add a one-line comment on `selfRepost` matching the one on `blockedAccounts`, naming the blocked item it waits on.
  Acceptance: both dead keys carry a comment naming their re-entry condition.
  Confidence: Verified
  Effort: S

- [ ] P3 — F261, The archive import source key is routed away from IndexedDB, so the advertised 256 MiB ceiling may be unreachable
  Category: reliability
  Where: `src/features/library/archive-import-jobs.ts:13-15` (`archiveSourceKey` and `MAX_SOURCE_BYTES`), against `src/platform/durable-storage.ts:284-287` (`#isDurable`).
  Problem: the key is deliberately unversioned so it stays out of migration and backup, but `#isDurable` routes on a trailing `.vN`, so unversioning also routes it away from IndexedDB and into `chrome.storage.local`, whose quota is 10 MB without `unlimitedStorage`. `src/extension/manifest.chrome.json:26-30` requests only `"storage"`. Base64 inflates the payload roughly a third further, so the write would fail somewhere near a 7 MB ZIP while `archive-import.ts:52` and the panel copy both promise 256 MiB.
  Evidence: read at the cited lines; the routing rule and the manifest permission list are as quoted. Marked Needs-repro because the userscript build reaches `GM_setValue` first, where the ceiling is different, and the actual Chrome failure threshold was not measured.
  Fix: rename the key to `aviary.archive.import.source.<jobId>.v1` so it lands in IndexedDB — the three key registries are explicit allow-lists, so it still cannot be swept into migration or backup — and cross-check `MAX_SOURCE_BYTES` against `storage.getStatus().quotaBytes` before accepting a file, rejecting with a sentence that names the real limit.
  Acceptance: importing a 50 MB archive in the extension build succeeds, or fails with a message naming the actual ceiling rather than throwing a quota error.
  Confidence: Needs-repro
  Effort: S

- [ ] P3 — F262, Two more stores write their whole in-memory state without the storage lock
  Category: reliability
  Where: `src/features/library/snapshots.ts:91-97`, `src/features/library/cleanup-queue.ts:143-146`, `src/features/library/archive-library.ts:96` and `:103`.
  Problem: these three persist by writing their entire in-memory collection rather than merging the change they just made, and none takes `withStorageLock` / `mutateStored`. That is the pattern CLAUDE.md records as fixed elsewhere and that `tests/cross-tab-stores.test.mjs` drives for six other stores. The trigger here is weaker than for the export checkpoint store — these are written on explicit user action rather than automatically as the feed scrolls — so two tabs have to be used deliberately rather than merely left open. Logged so the sweep is complete rather than because a common path hits it.
  Evidence: read at the cited lines; none of the three call sites references `withStorageLock` or `mutateStored`, while `src/features/library/bookmarks.ts` in the same directory does.
  Fix: route each `#persist` through `mutateStored` and merge per-entry, following `bookmarks.ts`. Add all three to `tests/cross-tab-stores.test.mjs`.
  Acceptance: the cross-tab test covers snapshots, the cleanup queue and the archive library, and a second gateway's write no longer erases the first's entries.
  Confidence: Likely
  Effort: M

- [ ] P3 — F263, The settings search does not fold diacritics, so accented labels need accented queries
  Category: ux
  Where: `src/ui/control-center.ts:1392` (`searchQuery.trim().toLowerCase()`) and the row-text comparison below it.
  Problem: matching is `String.includes` over the translated row text after `toLowerCase()`, with no Unicode normalization. In `es`, `pt` and `fr` a query typed without accents does not match an accented label, which is how most people type. Searching the translated text rather than the English source is the right call and should not change; the missing piece is only the folding. There is a second, smaller consequence worth naming in the same fix: because an untranslated row falls back to English, a partially translated locale leaves the user guessing which of two languages a given row is in.
  Evidence: read at the cited line. Verified in `es`: the query `theme` returns the no-results state while `tema` returns 2 sections and 4 rows. No Turkish locale ships, so the dotted-I `toLowerCase` hazard does not apply.
  Fix: normalize both sides with `.normalize("NFD").replace(/\p{Diacritic}/gu, "")` before comparing.
  Acceptance: a test in `es` asserts the query `busqueda` matches a row labelled with `búsqueda`.
  Confidence: Verified
  Effort: S

### Unaudited — needs a pass

- [ ] P3 — F264, Areas this pass did not reach
  Category: docs
  Where: repository-wide.
  Problem: recorded so the next pass starts from what is known rather than re-deriving it. Not audited in this pass: `src/features/integrations/` beyond the panel wiring — `crosspost.ts`, `ai-provider.ts`, `semantic-search.ts`, `aria2.ts` and `usage.ts` were read only where a finding led into them, so the outbound-request paths, the local-only guard's coverage of each, and the provider error handling have had no dedicated review. `tools/build.mjs` and `tools/preflight.mjs` were run but not read, so the delivery gate itself is unaudited. `npm run smoke` was run and passed, including its Firefox 153.0.3 DNR lane, but no finding here was reproduced against Gecko: the browser reproductions in F212, F242, F246 and F265 were all Chromium, which matters for the `@scope` fallback in F242 and for the native-popover cascade in F265. The visual regression baselines under `tests/visual/baselines/settings` were regenerated and compared but not inspected for whether they cover the secondary surfaces. The mobile and coarse-pointer path (`src/features/core/mobile-touch.ts`) was checked only through the existing contract test. No performance profiling was done beyond the specific measurements cited in F240, F244 and F253.
  Evidence: this pass's own tool history.
  Fix: run each of these as a scoped follow-up, starting with the integrations outbound paths since they are the only code in the product that originates a network request.
  Acceptance: each area named above has either a finding or an explicit note that it was reviewed and is clean.
  Confidence: Verified
  Effort: L

