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

- [ ] P2 — F269, `hidden-posts-reconcile` counts reflow nudges on a clock and is flaky under load
  Category: testing
  Where: `tests/hidden-posts-reconcile.test.mjs:108` ("re-applying over an already-collapsed post does not keep firing resize"), asserting at `:133`.
  Problem: the test counts `resize` events dispatched by `nudgeReflow` in `src/features/filtering/hidden-posts-feature.ts` and requires at most one. The nudge is scheduled through `requestAnimationFrame`, so the count depends on how many frames elapse while the test waits. It passes in isolation and fails intermittently in a full `npm test` run, where several browser-backed suites compete for the machine.
  Evidence: observed failing once in a full run ("the collapse should nudge at most once, saw 2") with a reported duration of 2439ms, then passing three times out of three when run alone at about 500ms each, and passing on the next full run. The feature code involved was not touched by the change that surfaced it.
  Fix: stop counting within a wall-clock window. Either drive the frames deterministically by stubbing `requestAnimationFrame` for the duration of the assertion, or assert the invariant the test actually means — that a second apply over an already-collapsed post schedules no *new* nudge — by checking the module's own pending-handle state rather than the number of events observed.
  Acceptance: the test passes 20 consecutive full-suite runs, and still fails when `nudgeReflow`'s "already scheduled" guard is removed.
  Confidence: Verified
  Effort: S

- [ ] P2 — F266, The composer snippet palette opens at the top of the viewport, not next to its trigger
  Category: visual
  Where: `src/features/composer/composer-snippets.ts:288` (`positionPopover`) and the `.av-snippet-popover` rule in the same file.
  Problem: the palette sets an inline `bottom` while the UA's `[popover]` rule supplies `inset: 0`. With `height: fit-content` the box is over-constrained, the browser drops `bottom`, and the palette pins to `top: 0` — so it opens at the top of the screen however far down the composer is. Measured with a trigger at viewport top 607: the palette rendered at top 0.
  Evidence: reproduced in headless Chromium at both `989cfd2` and `288733f`, so this predates the popover-position work in this session and is not caused by it. `positionPopover` never reads the palette's own height, unlike the AI menu's `positionMenu`, so the flip logic is not involved.
  Fix: set `top: auto` alongside the inline `bottom` (or in the `.av-snippet-popover` rule) so the box is no longer over-constrained, and confirm against a trigger near the bottom of the viewport.
  Acceptance: a browser test places the composer toolbar near the bottom of the viewport, opens the palette, and asserts its bounding box sits within a few pixels of the trigger rather than at `top: 0`.
  Confidence: Verified
  Effort: S

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

- [ ] P2 — F221, Five design tokens are referenced by name and defined nowhere
  Category: visual
  Where: `--av-danger` at `src/ui/control-center.ts:3218`; `--av-media-success` at `src/features/media/media-buttons.ts:1457, 1458, 1482`; `--av-media-error` at `:1493`; `--av-media-success-text` at `:1564`; `--av-media-error-text` at `:1573`.
  Problem: none of these five properties is defined in any of the six `themeVars` entries (`src/features/appearance/theme.ts:190-247`), in `src/extension/options.css:1-11`, or anywhere else, so their `var(…, fallback)` fallback paints in every theme including the ones that mean to restyle it. A theme therefore cannot change a danger colour or a media success colour at all, and the five reds that exist in the codebase cannot be unified without a token to unify them on: `rgb(244, 33, 46)` at `control-center.ts:3218` and `hidden-posts-feature.ts:579-580`, `rgb(255, 120, 128)` at `control-center.ts:3628`, `rgb(255, 95, 109)` at `:3632`, `rgb(255, 151, 151)` at `options.css:381`, `rgb(220, 110, 110)` at `bookmarks-feature.ts:306` and `feature-toast.ts:158`. The success green `rgb(72, 211, 147)` at `control-center.ts:3609` is a hand-copy of `options.css:9`'s `--av-ok`, and the warning amber `rgb(247, 183, 73)` at `:3614` and `:3618` has no token at all.
  Evidence: `grep -rn -- "--av-danger" src/` returns exactly one line, the consumer at `control-center.ts:3218`. `grep -rn -- "--av-media-success\|--av-media-error" src/` returns six lines, all consumers in `media-buttons.ts`. `theme.ts:190-247` is the complete set of theme variable blocks and defines only `--av-bg`, `--av-surface`, `--av-surface-raised`, `--av-border`, `--av-text`, `--av-muted`, `--av-accent`, plus `--av-accent-secondary` in `noir` alone.
  Fix: add `--av-danger`, `--av-warn`, `--av-ok`, `--av-on-accent` and `--av-on-danger` to all six `themeVars` entries and to `options.css`'s `:root`, then replace the literals listed above with the tokens. Pick the `--av-danger` value for contrast rather than fidelity to X's `#F4212E` — see F231 for the measurement.
  Acceptance: `grep -rn -- "var(--av-" src/ | grep -o -- "--av-[a-z-]*" | sort -u` produces no name that is absent from `theme.ts`'s `themeVars` and `options.css`; a test asserts that set relationship so a future undefined token fails the build.
  Confidence: Verified
  Effort: M

- [ ] P2 — F222, The account-note badge is invisible on X's light mode in the default configuration
  Category: a11y
  Where: `src/features/library/user-notes.ts:285-299` (`.av-note-badge`).
  Problem: the badge paints `background: color-mix(in srgb, var(--av-accent, rgb(29, 155, 240)) 18%, transparent)` with `color: var(--av-text, rgb(239, 243, 244))` at `font-size: 10px`. Both properties fall back, because theme `"off"` is the default and defines no custom properties, and the background is 82% transparent over whatever X is showing. On X's light mode the label is near-white text on near-white ground. The repo already fixed this exact failure once for the launcher — `control-center.ts:2620-2624` explains that a translucent accent wash measured 1.12:1 on X light mode and was made opaque for that reason — and the fix was never carried to the injected in-timeline controls.
  Evidence: measured in headless Chromium by running `userNotesFeature.init` and `apply`, mounting a `<span class="av-note-badge">` and reading `getComputedStyle` with `document.body.style.background = "#ffffff"`: `background: color(srgb 0.113725 0.607843 0.941177 / 0.18)`, `color: rgb(239, 243, 244)`, `fontSize: 10px`. Compositing 18% `rgb(29, 155, 240)` over white gives `#D6EDFC`, L = 0.81902; `#EFF3F4` has L = 0.88993; ratio = 0.93993 / 0.86902 = **1.08:1**. The coloured variants are no better: `slate` at `user-notes.ts:276` is `rgba(148, 163, 184, 0.22)`, which composites to `#E8EBEF` for roughly 1.05:1.
  Fix: give the badge an opaque background of its own chrome, as the launcher does — `background: var(--av-surface-raised, rgb(22, 24, 28))` with `color: var(--av-text, rgb(239, 243, 244))` — rather than a wash over the page. Apply the same treatment to the six coloured variants at `user-notes.ts:270-284`, keeping the colour as a border or a left rule instead of the fill.
  Acceptance: extend the canvas-compositing check already used by `tests/injected-ui-contract.test.mjs:609` ("the launcher stays legible on a light page") to the note badge and assert at least 4.5:1 against both a white and a black page.
  Confidence: Verified
  Effort: S

- [ ] P2 — F223, The first-run notice's only button is white on X blue at 3.00:1
  Category: a11y
  Where: `src/features/core/first-run.ts:94-107`.
  Problem: `button { background: #1d9bf0; color: #fff; font-size: 13px; font-weight: 700; }`. 13px at weight 700 is not WCAG "large text" (which needs 18.66px bold or 24px), so this must clear 4.5:1 and does not. It is the only control on the first thing a new user ever sees from Aviary, and every other primary button in the codebase already avoids the problem: `src/extension/options.css:319` and `src/ui/control-center.ts:2768` both put `rgb(5, 10, 15)` on the accent fill.
  Evidence: L(`#FFFFFF`) = 1.0; L(`#1D9BF0`) = 0.29989 (channel luminances 0.01228, 0.32770, 0.87130 weighted 0.2126 / 0.7152 / 0.0722). Ratio = 1.05 / 0.34989 = **3.00:1**. With `rgb(5, 10, 15)` the same fill gives roughly 8.6:1.
  Fix: `color: rgb(5, 10, 15)` to match the other two primary buttons. While in the file, change the focus ring at `first-run.ts:108` from `#e7e9ea` to the accent used everywhere else, and reconsider `card.setAttribute("role", "status")` at `:112` — a polite live region containing the notice's only interactive control is announced as a status message rather than presented as something to act on.
  Acceptance: a contrast assertion in `tests/first-run.test.mjs` (or the a11y suite) measuring the dismiss button's foreground against its background at 4.5:1 or better.
  Confidence: Verified
  Effort: S

- [ ] P2 — F224, The Catch-up dialog injects a document stylesheet that no teardown ever removes
  Category: reliability
  Where: `src/features/filtering/catch-up-ui.ts:9` (`const STYLE_ID = "av-catch-up-style"`), `:346-350` (`ensureStyle`), `:408` (the append).
  Problem: CLAUDE.md states the contract as "Every feature must fully reverse itself in `destroy`", and `<style id="av-catch-up-style">` violates it. `ensureStyle` appends to `document.head` and nothing anywhere removes it. The digest is opened from the Control Center, but `controlCenterFeature.destroy` (`src/features/core/control-center.ts:1230-1244`) does not sweep it, and the feature that owns the digest data, `filtering.seenPosts`, removes only its own `av-seen-posts` style and markers. After `registry.destroyAll` the page has not returned to what X rendered. If teardown happens while the digest is still open, the dialog node and all nine of its listeners survive too — the self-removal at `:52-55` is bound to the `close` event with `{ once: true }`, which teardown never fires.
  Evidence: `grep -rl "av-catch-up" src/` returns `src/features/filtering/catch-up-ui.ts` and nothing else, so no other module can be removing it. `catch-up-ui.ts:346-347` is `function ensureStyle(): void { if (document.getElementById(STYLE_ID)) return;` with no matching remover in the file.
  Fix: export a `closeCatchUpDigest()` from `catch-up-ui.ts` that removes both `#av-catch-up-dialog` and `#av-catch-up-style`, and call it from `controlCenterFeature.destroy` in `src/features/core/control-center.ts` next to the existing `controlCenter?.destroy()`.
  Acceptance: a test opens the digest, runs `controlCenterFeature.destroy(ctx)`, and asserts `document.getElementById("av-catch-up-style")` and `document.getElementById("av-catch-up-dialog")` are both null.
  Confidence: Verified
  Effort: S

- [ ] P2 — F225, Two features show a toast and never remove it, leaving a live host and timer after teardown
  Category: reliability
  Where: `src/features/library/copy-post-link.ts:149` and `:160`; `src/features/media/media-buttons.ts:301, 316, 368, 393`. The helper is `src/features/core/feature-toast.ts:25` (`showFeatureToast`) and `:73` (`removeFeatureToast`).
  Problem: `feature-toast.ts:72` states the expectation directly — "Removes the host entirely. Features call this from `destroy` so nothing survives teardown." Only `src/features/ai/command-menu.ts:96` and `src/features/composer/composer-snippets.ts:66` actually do. `copy-post-link`'s `clearDecorations` and `mediaButtonsFeature.destroy` clean up their own nodes and stop, so suspending either feature inside the toast's dismissal window leaves `#av-feature-toast` — a div on `<html>` with a shadow root, a popover card and a pending `setTimeout` — alive indefinitely. On a full `destroyAll` the host does get removed, but only incidentally: reverse registration order happens to run `aiCommandMenuFeature.destroy` (registered at `src/main.ts:232`) before `mediaButtonsFeature` (`:214`) and `copyPostLinkFeature` (`:221`), and that call's cleanup includes `removeFeatureToast()`. That is an undocumented ordering dependency, not a guarantee.
  Evidence: `grep -rn "removeFeatureToast\|showFeatureToast" src/` shows six `showFeatureToast` call sites across `copy-post-link.ts` and `media-buttons.ts` against zero `removeFeatureToast` calls in either file, and two `removeFeatureToast` calls in the two files that do it correctly.
  Fix: call `removeFeatureToast()` from `copyPostLinkFeature.destroy` and `mediaButtonsFeature.destroy`. A source-contract test is the durable fix: assert that any file importing `showFeatureToast` also imports and calls `removeFeatureToast`.
  Acceptance: the new source-contract case passes; a lifecycle test shows a toast, destroys `media.buttons`, and asserts `document.getElementById("av-feature-toast")` is null.
  Confidence: Verified
  Effort: S

- [ ] P2 — F226, The Catch-up dialog ignores the user's theme entirely
  Category: visual
  Where: `src/features/filtering/catch-up-ui.ts:351-400` (the whole injected stylesheet).
  Problem: the dialog is a first-class Aviary surface — appended to `document.body` at `:56` with a document-level stylesheet at `:408` — and it is the only one that uses no design token at all. Twenty-eight colour literals, none of them `var(--av-*)`: `:358 color: #f2f5f7`, `:359 background: #11161c`, `:367 background: #18212b`, `:375 border-color: #54d5c5; color: #8ef1e4`, `:389 color: #71e2d2` and the rest. Under `plum` or `noir` it is a foreign teal-on-slate panel sitting on top of a themed page, and under any theme its accents are a colour that appears nowhere else in the product. Separately, `.av-catch-up-end` at `:400` is `color: #65727f` on the `#11161c` ground, which is 3.69:1 at 12px — the sibling greys in the same block are fine (`#8693A0` at `:382` is 5.79:1, `#9AA6B2` at `:370` is 7.33:1), so that one value is an outlier rather than a systematic choice.
  Evidence: read at the cited lines; the block from `:351` to `:400` contains no `var(--av-` occurrence. Contrast for `.av-catch-up-end`: L(`#65727F`) = 0.16337, L(`#11161C`) = 0.00776, ratio = 0.21337 / 0.05776 = 3.69:1.
  Fix: map the literals onto `--av-surface`, `--av-surface-raised`, `--av-border`, `--av-text`, `--av-muted` and `--av-accent`, keeping the current values only as fallbacks so the default theme "off" still paints. Replace the `#65727f` end-of-list colour with `var(--av-muted, #8693a0)`. Add the same `:focus-visible` block the rest of the codebase uses (see F229).
  Acceptance: the dialog's computed background and text colours change when `data-av-theme` moves from absent to `plum`; a contrast assertion covers `.av-catch-up-end`.
  Confidence: Verified
  Effort: M

- [ ] P2 — F227, "Tweets" survives in eight user-facing strings while the rest of the product says "posts"
  Category: ux
  Where: `src/ui/control-center/sections/data.ts:957` ("Capture visible tweets"), `:958` ("Accumulate tweets visible on the active page for the next export run."), `:1095` ("Export visible tweets" and "Collect the currently rendered tweets and download a ZIP."); `src/ui/control-center.ts:500` and `:503` (the two `SECTION_GROUP_BREAKS` anchors that key off those labels), `:1254` ("…over tweet photos and video thumbnails."), `:1263`; `src/features/core/presets.ts:97` (the Researcher preset highlight, rendered at `src/ui/control-center/sections/presets.ts:24`).
  Problem: X renamed tweets to posts, the product followed everywhere else, and these eight did not. The inconsistency is visible inside a single section: `data.ts:1095`'s button says "Export visible tweets" while its own status messages three lines later say "Collecting visible posts…" (`:1096`), "No posts found on this view." (`:1102`) and "No captured posts have thread metadata yet." (`:1138`).
  Evidence: `grep -n "tweets\|tweet photos" src/ui/control-center/sections/data.ts src/ui/control-center.ts src/features/core/presets.ts` excluding `tweetId`, `testid` and `extractTweet` returns exactly the eight lines above; `grep -ho "\bposts\b" src/ui/control-center/sections/*.ts src/ui/control-center.ts | wc -l` returns 68.
  Fix: rename all eight to "posts". Two of them are load-bearing beyond their own text: `control-center.ts:500` and `:503` match on the label string to place a group heading, so those anchors must change in the same edit. `{tweetId}` in the filename-template field list (`data.ts:1571`) is a stored data key and must not change. Re-run `node tools/i18n-extract.mjs --write` afterwards, because changing the English text orphans the existing translations of these strings.
  Acceptance: `grep -rn "tweets" src/ui/ src/features/core/presets.ts` returns nothing; the panel still renders the Capture and Jobs group headings in the Export section; `npm test` reports 100% locale coverage.
  Confidence: Verified
  Effort: S

- [ ] P2 — F230, The i18n extractor hard-codes a stale copy of the preset data it claims is real
  Category: maintainability
  Where: `tools/i18n-extract.mjs:104-106`; the real data is `src/features/core/presets.ts:40-43`.
  Problem: the extractor mounts the panel against a stub options object, and the stub's `listPresets` returns a hand-written duplicate of the Quiet Reader preset. The comment two lines above says "Real preset copy: a stub phrase here would enter the manifest and give translators a string the product never shows" — and that is exactly what has happened. The stub still carries "Hide trends and row borders, dim premium posts, strip t.co, dense + dim theme." while `presets.ts:43` now reads "Hide trends, row borders and engagement counts, dim premium posts, strip t.co, dense + dim theme." The dead string is in `PANEL_STRINGS` and has been translated into all eight locales. It does no runtime harm today only because a second, source-scanning harvest path (`tools/i18n-extract.mjs:21`) picks the real string up as well — so the safety net that hides this is incidental, and a future preset string reaching the catalog only through the render path would ship untranslated with every test still green.
  Evidence: `grep -rn "Hide trends and row borders" src/ tools/` returns `tools/i18n-extract.mjs:106`, `tools/i18n-manifest.json:31` and two lines in `src/platform/i18n-catalog.ts`, and no hit in `src/features/core/presets.ts`. A script comparing every catalog key against `PANEL_STRINGS` reports 0 orphans across 1176 strings and 8 locales, confirming both the stale and the live string are in the manifest. `tests/i18n.test.mjs:15` compares the catalog against `PANEL_STRINGS`, and both sides derive from the extractor, so the test cannot see this drift.
  Fix: have the stub import `PRESETS` from `src/features/core/presets.ts` instead of restating it, so the extractor and the product cannot disagree. Then regenerate with `node tools/i18n-extract.mjs --write` and drop the orphaned key. Check `src/platform/i18n-catalog.ts:1188` for the same problem: it holds a "Reset all preferences" description that no longer matches `src/ui/control-center/sections/advanced.ts:1017`.
  Acceptance: `grep -c "Hide trends and row borders" tools/ src/` returns 0; a test asserts every string in `PRESETS` appears in `PANEL_STRINGS`.
  Confidence: Verified
  Effort: S

- [ ] P2 — F231, A failed WACZ export shows a raw exception next to a green success indicator
  Category: ux
  Where: `src/ui/control-center/sections/data.ts:1346`; the tone logic is `src/ui/control-center.ts:910-915` (`statusState`); the styling is `src/ui/control-center.ts:3604-3634`.
  Problem: `statusState` derives the status tone by regex over the English source string: `if (/could not|failed|error|invalid/i.test(source)) return "error";` with a fallthrough of `return "saved";`. `.av-status::before` has no `[data-state="saved"]` rule — green (`rgb(72, 211, 147)`, `:3609`) is the base — so anything that fails the regex renders with the success dot. `data.ts:1346` passes a raw `error.message` straight in, so a WACZ export that dies with "Quota exceeded", "The operation is insecure." or "Cannot read properties of undefined (…)" shows that text beside a green dot. Four further sites pre-translate before calling `setStatus` — `data.ts:408, 423, 1343, 1468` are `ctx.setStatus(ctx.t("…"))` — which breaks the same contract in the eight non-English locales, since `statusState` then regex-tests translated text. `data.ts:423` ("Under the Hood report could not be read.") is the one that matters: correct tone in English, success-green in every other locale.
  Evidence: `control-center.ts:911-914` is the four-line `statusState` body quoted above; `control-center.ts:3604-3612` defines the base `.av-status::before { … background: rgb(72, 211, 147); }` with `[data-state="error"]` rules only at `:3627-3634`. `grep -rn "setStatus(.*error.message" src/ui/` returns exactly one line, `data.ts:1346`. `grep -c "setStatus(ctx\.t(" src/ui/control-center/sections/*.ts` returns 4.
  Fix: at `data.ts:1346` use an authored sentence and keep the raw message in diagnostics, matching what the sibling signed-WACZ path at `data.ts:1471` already does — for example "WACZ export failed. Free some disk space or export fewer records, then try again." Remove the `ctx.t(...)` wrapper from the four pre-translated calls so `setStatus` receives the English source it is documented to take. Optionally make the tone explicit rather than inferred by giving `setStatus` an optional tone argument.
  Acceptance: a test calls the panel's `setStatus` with "Quota exceeded" and asserts `data-state` is not `"saved"`; `grep -rn "setStatus(ctx\.t(" src/ui/` returns nothing.
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

- [ ] P2 — F234, The Catch-up dialog's non-modal fallback has no modal semantics and no focus management
  Category: a11y
  Where: `src/features/filtering/catch-up-ui.ts:57-62`.
  Problem: `if (typeof dialog.showModal === "function") { dialog.showModal(); } else { dialog.setAttribute("open", "true"); }`. On the fallback path the element is a plain non-modal `<dialog>`: nothing moves focus into it, nothing contains focus, Escape does not close it, and the page behind stays fully tabbable. The dialog never sets `role` or `aria-modal` itself, relying entirely on `showModal()` for them, so the fallback exposes no modal semantics at all. The `aria-labelledby="av-catch-up-title"` at `:46` does resolve correctly to the `title.id` at `:79`, so that half is fine.
  Evidence: read at the cited lines; `grep -n "aria-modal\|role=" src/features/filtering/catch-up-ui.ts` finds `role` only on the filters group at `:126`.
  Fix: in the fallback branch set `role="dialog"` and `aria-modal="true"`, move focus to the close button, add an Escape handler, and mark the rest of the document inert — the same treatment `src/ui/control-center.ts:589` and `:830-831` already apply to the panel. Alternatively drop the fallback: both manifests floor at Chrome 116 and Firefox 128, which have `showModal`.
  Acceptance: a test that deletes `HTMLDialogElement.prototype.showModal` before opening the digest and asserts the dialog carries `aria-modal="true"`, that focus lands inside it, and that Escape closes it.
  Confidence: Verified
  Effort: S

- [ ] P2 — F235, Pluralization is wrong or unlocalizable in eight status strings
  Category: ux
  Where: parenthetical plurals at `src/ui/control-center/sections/advanced.ts:63` ("{n} error(s)") and `:234` ("found in {rounds} round(s)"); always-plural at `src/ui/control-center/sections/reading.ts:549` ("Renewed {count} rules."), `:810` ("({count} lines)"), `:860` ("Added {count} rules."), `:862` ("Replaced the rule set with {count} rules.").
  Problem: "1 error(s)" and "Renewed 1 rules." are both wrong in English, and the parenthetical form cannot be localized at all — no target language pluralizes that way, so the eight locales inherit an English typographic convention that means nothing in them. The codebase already branches correctly in the same files: `data.ts:1109-1118`, `reading.ts:709` and `:896` all select on `count === 1`.
  Evidence: read at the cited lines. `advanced.ts:63` is `` `${saved.total} kept · ${saved.errors} error(s) · newest ${saved.newestAt ?? "unknown"}` ``.
  Fix: branch on the count the way the neighbouring code does, and re-run the i18n extractor so both forms enter the catalog as separate keys.
  Acceptance: a test renders each of these rows with a count of 1 and of 2 and asserts no output contains "(s)" or "1 rules".
  Confidence: Verified
  Effort: S

- [ ] P2 — F236, "Save" and "Download" name the same action interchangeably, including a button name that no longer exists
  Category: ux
  Where: `src/features/media/media-buttons.ts:585` (post-level label "Download"), `:799` (per-asset label "Save"), `:589` (a tooltip using both), `:650, 837, 917` (busy label "Saving..."); `src/ui/control-center.ts:1254` ("Inject Save and Thumb buttons…"); `src/extension/options.html:59-60` ("Lets the Save and Thumb buttons write files…"); `src/features/core/first-run.ts:125` ("a save control"); `src/ui/control-center/sections/data.ts:1518-1519` ("Show download buttons", "Add one Download action…"), `:1594` (both words in one sentence).
  Problem: the post-level control is labelled "Download" but its busy state says "Saving...", the per-asset control beside it says "Save", and two surfaces the user is sent to for help — the section summary and the permissions page — describe "the Save and Thumb buttons", a name that is no longer on the page. A user following `options.html:59` looks for a Save button and finds one labelled Download. The bookmark action at `src/features/library/bookmarks-feature.ts:241` genuinely is "Save locally", so "save" is not free to mean both things.
  Evidence: read at the cited lines; `grep -n '"Download"\|"Save"\|"Saving' src/features/media/media-buttons.ts` returns the five labels above. The `"Saving..."` literal also uses an ASCII ellipsis where the panel's own convention is `…` (`data.ts:217, 312, 1096, 1655`; `advanced.ts:822, 1121, 1188, 1430`), and `src/ui/control-center.ts:911` matches on the exact string `"Saving..."`, so any change to it must update that comparison too.
  Fix: reserve "Download" for anything that writes a media file and "Save locally" for the bookmark action. Rename `media-buttons.ts:799` to "Download", change the three busy labels to "Downloading…", update `control-center.ts:1254` and `options.html:59-60` to name the Download and Thumb buttons, and change `first-run.ts:125` to "a download control". Update the `"Saving..."` comparison at `control-center.ts:911` in the same edit, and re-run the i18n extractor.
  Acceptance: `grep -rn '"Save"' src/features/media/` returns nothing; the options page and the Media section summary both name the same button the page actually shows; the panel's saving tone still resolves for the transaction bar.
  Confidence: Verified
  Effort: S


- [ ] P2 — F248, An older build silently destroys settings written by a newer one
  Category: correctness
  Where: `src/platform/settings.ts:562-573` (`readSettingsEnvelope`'s `fromFuture` branch and its docstring), `src/main.ts:156-164` (the only consumer), `src/main.ts:253-259` (`saveSettings`).
  Problem: the docstring promises that on a future payload "unknown keys are left in the record and `fromFuture` is set so the caller can avoid writing this build's narrower shape back". Neither half holds. The branch returns `normalizeSettings(raw)`, which builds a fresh object literal, so the unknown keys are gone from `envelope.settings` and `schemaVersion` is restamped to this build's value. And `fromFuture` is referenced in exactly one place in `src/`, a `diagnostics.warn` in `main.ts` — `saveSettings` writes unconditionally. Downgrade the extension, or open the same profile in an older build, toggle any single setting, and every key the newer schema added is gone from storage. No prompt, no backup, and the only trace is a warning the user never sees.
  Evidence: reproduced against the real module with `{schemaVersion: 99, someBrandNewGroup: {keep: "me"}, appearance: {theme: "noir"}}`: `fromFuture` is `true`, `fromVersion` is `99`, `someBrandNewGroup` is **not** present on `envelope.settings`, and `settings.schemaVersion` is stamped `2`. Passing that result back through `normalizeSettings`, which is what `saveSettings` does, also drops it. `grep -rn "fromFuture" src/` returns the definition and `main.ts:158` only. `tests/settings-schema-version.test.mjs:51` asserts `fromFuture === true` and that runtime values are usable, and never asserts anything about what is written back.
  Fix: carry the raw future payload on the envelope and have `saveSettings` merge this build's known keys over it rather than replacing it, so unknown groups survive a round trip. If that is too invasive, set a read-only flag on `fromFuture`, block `saveSettings`, and have the panel say plainly that these settings were written by a newer Aviary and will not be modified. Either way, correct the docstring so it describes what the function does.
  Acceptance: a test reads a future payload with an unknown group, calls the save choke point, and asserts the unknown group is still in storage afterwards.
  Confidence: Verified
  Effort: M

- [ ] P2 — F249, The Obsidian export's tag line breaks out of its own frontmatter, and one Markdown link is built unescaped
  Category: security
  Where: `src/features/export/external-targets.ts:50` and `:59` (the `tags` line), and `:35` (the clipboard permalink). `yamlScalar` is at `:88-94` and `markdownUrl` is used correctly at `:69`.
  Problem: every frontmatter value except one goes through `yamlScalar`, which escapes quotes and collapses newlines. The exception is the handle inside `tags`, which is interpolated raw: `` const tags = ["#aviary", `#x/${handle}`] `` and then `` `tags: [${tags.join(", ")}]` ``. A handle containing newlines therefore terminates the YAML block from inside it. Separately, `toPlainMarkdown` at `:35` builds `` ` — [link](${record.permalink})` `` from the raw permalink while `markdownUrl()` exists two functions away and is used for media, so a permalink containing `)` closes the link early and anything after it becomes document text — including a second, attacker-controlled link. Both fields are attacker-influenced: `src/features/library/archive-import.ts:428` takes `user.screen_name` as an arbitrary string with no character class, and `:360` takes `id_str` the same way, and both flow through untouched.
  Evidence: reproduced against the real `renderForExternalTarget`. With `handle` set to `"bob\n\n## FAKE SECTION\n\nreal"` the output is `handle: "bob ## FAKE SECTION real"` (correctly escaped) but `tags: [#aviary, #x/bob` followed by a blank line, a real `## FAKE SECTION` heading, `real]`, and only then the closing `---`. With `permalink` set to `"https://x.com/i/web/status/1) [PHISH](https://evil.example"` the clipboard export renders `### Bob (@bob) — [link](https://x.com/i/web/status/1) [PHISH](https://evil.example)`. The control record produced `tags: [#aviary, #x/bob]` and a single well-formed link. `tests/search-and-export-data.test.mjs:186-206` pins that "a display name with YAML metacharacters cannot break or extend the frontmatter" — the guarantee simply does not cover the handle.
  Fix: pass the handle through `yamlScalar` (or a tag-specific sanitizer that strips whitespace and `]`) before building the tag, and use `markdownUrl()` at `:35`. While there, add one `markdownText()` helper — collapse `[\r\n]+`, escape `[`, `]`, `<` and backticks — and apply it to every interpolated identity field in this file and in `src/features/export/formatters.ts:192` and `src/features/library/reports.ts:37, 45-46, 69`.
  Acceptance: extend the existing frontmatter test to cover the handle and the permalink, asserting the emitted note has exactly two `---` lines and exactly one Markdown link per record.
  Confidence: Verified
  Effort: S

- [ ] P2 — F250, An imported archive makes the WARC assert a capture time that never happened
  Category: correctness
  Where: `src/features/library/archive-import.ts:362-368`; the contract it breaks is stated at `src/features/export/types.ts:22`; the consumers are `src/features/export/warc.ts:104` and `src/features/export/wacz.ts:164-167`.
  Problem: `types.ts:22` says plainly `/** Original post creation time. `capturedAt` remains the local capture time. */`. `archive-import.ts:368` sets `capturedAt: createdAt` — the post's authored time from the archive's `created_at` field, in X's raw format rather than ISO. `warc.ts:104` then uses `validDate(record.capturedAt)` for `WARC-Date`, and the CDXJ timestamp is derived from the same value. Per the WARC specification `WARC-Date` is when data capture for the record began, so a WACZ built from an archive import asserts a capture instant that never occurred — in the one format whose entire purpose is provenance, on a package `wacz-signing.ts` will then sign. The same value also reaches `formatters.ts:154` and `warc.ts:317` as `<time datetime="…">`, which is not a valid HTML datetime, and mixes formats in the `capturedAt` column of JSON, CSV and XLSX.
  Evidence: read at the cited lines. `archive-import.ts:362` is `const createdAt = stringField(tweet, "created_at") ?? now;` and `:368` is `capturedAt: createdAt,` with `createdAt` assigned to the separate `record.createdAt` field only at `:383`, and only when it differs from `now`. `warc.ts:219-223` shows `validDate` accepts anything `new Date(value)` parses, and `new Date("Tue Jan 16 12:00:00 +0000 2026").toISOString()` returns `"2026-01-16T12:00:00.000Z"`, so the authored time does become the `WARC-Date` rather than falling back. `tests/archive-deflate.test.mjs` asserts `text` and `tweetId` on imported records and never `capturedAt`.
  Fix: set `capturedAt` to the import time as an ISO string, and put the parsed `created_at` in `createdAt` only, which is what the type comment already specifies. If the authored time should drive replay ordering, express that in the CDXJ and pages layer as a deliberate choice rather than by overloading `capturedAt`.
  Acceptance: a test imports a fixture archive and asserts every record's `capturedAt` parses as ISO-8601 and is within a second of the import, while `createdAt` carries the archive's value; a WARC built from those records carries a `WARC-Date` in the import window.
  Confidence: Verified
  Effort: S

- [ ] P2 — F254, Two settings collections have no size bound
  Category: reliability
  Where: `src/platform/settings.ts:1108-1120` (`mediaTypeRecord`) and `:1158` (`urlValue`) / `:1192` (`credentialedUrlValue`).
  Problem: every other collection in the schema is capped — `stringArray` takes a `maxItems`, `secretValue` slices to 4096, `stringValue` to 120 or 500 — but `mediaTypeRecord` copies every key outside `FILTER_MEDIA_KEYS` straight through with no count limit, and the URL validators have no length cap. A hand-edited or imported settings file can therefore inflate the settings blob without limit, which matters because the settings blob is read at boot before anything else and because the panel's own Trust page exists to report "the browser store may be full".
  Evidence: measured against the real `normalizeSettings`: a `filter.mediaTypes` object with 5000 unknown keys comes back with 5003 keys and survives a second normalization pass unchanged; a 500 KB `integrations.ai.endpoint` and a 500 KB `integrations.aria2.endpoint` both persist at their full length.
  Fix: drop the passthrough loop in `mediaTypeRecord` — nothing reads a key outside `FILTER_MEDIA_KEYS` — or cap it at a small constant. Add a `maxLength` to `urlValue` and `credentialedUrlValue` in line with the other string validators.
  Acceptance: a test asserts `normalizeSettings` returns at most `FILTER_MEDIA_KEYS.length` media-type keys and truncates an over-long endpoint.
  Confidence: Verified
  Effort: S

- [ ] P2 — F255, A cancelled archive import is reported with the success template
  Category: ux
  Where: `src/features/core/control-center.ts:1287-1305` (the cancel/pause branch of `processArchiveImport`), `:1398-1401` (`processArchiveImportAction`), and the status line at `src/ui/control-center/sections/data.ts:222-235`.
  Problem: when the user cancels or pauses mid-import the branch returns `{ records: 0, warnings, errors: result.errors.length, recognizedFiles, … }`. For a well-formed archive `errors.length` is `0`, so the panel renders the ordinary completion sentence with zeros in it — "Imported 0 records. Warnings: 0; errors: 0. Files: 9 recognized, 1 skipped, 0 malformed." A user reading that concludes the archive was empty, not that their cancel took effect, and the recognized/skipped counts describe files that were parsed and then deliberately discarded, presented in the same breath as the committed record count. `processArchiveImportAction` compounds it: its `errors > 0 && records === 0` test is false, so resume and retry both return `{ ok: true }` for a run that committed nothing.
  Evidence: read at the cited lines. The in-code comment at `:1288-1289` is accurate about commits and silent about reporting.
  Fix: return an explicit `cancelled: true` (or a `status` field) from `processArchiveImport`, have `processArchiveImportAction` treat it as not-ok, and give the panel its own sentence — "Import cancelled. No records were saved." — rather than reusing the completion template with zeros.
  Acceptance: a test cancels an import mid-run and asserts the status string contains "cancelled" and does not contain "Imported 0 records".
  Confidence: Verified
  Effort: S

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

