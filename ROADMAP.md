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

- [ ] P1 — F212, Media Download button shows no success or failure state under any Aviary theme
  Category: visual
  Where: `src/features/appearance/theme.ts:359-368` (`html[data-av-theme] [data-av-media-action]`) versus `src/features/media/media-buttons.ts:1480-1494` (`[data-av-media-action].is-success` / `.is-opened` / `.is-duplicate` / `.is-error`)
  Problem: the theme rule's selector is `html[data-av-theme] [data-av-media-action]`, specificity (0,2,1). The four state rules in the media stylesheet are `[data-av-media-action].is-success` and friends, specificity (0,2,0). The theme rule therefore wins on both `background` and `color` no matter the source order, so with any theme other than "off" selected a completed download, a duplicate, an opened-in-tab fallback and a failed download all render exactly like the untouched resting button. A download that failed is indistinguishable from one that was never clicked.
  Evidence: measured in headless Chromium by mounting the real `MEDIA_CSS` (through `mediaButtonsFeature.init`) plus the real exported `THEME_CSS`, then reading `getComputedStyle` on a fresh `<button data-av-media-action>` per state. With `data-av-theme` absent: resting `rgb(29, 155, 240)`, is-success `rgb(120, 200, 130)`, is-error `rgb(220, 110, 110)`, is-opened `color(srgb 0.443 0.463 0.482 / 0.46)` — all distinct. With `data-av-theme="dim"` (and again with `"noir"`): resting, is-success, is-error and is-opened all return `background rgba(0, 0, 0, 0)` and `color rgb(29, 155, 240)` (noir: `rgb(92, 211, 255)`) — identical. Use a fresh element per measurement; re-reading `getComputedStyle` on the same element after a `className` write returns the first value and hides the defect.
  Fix: raise the four state rules above the theme rule rather than lowering the theme rule. In `src/features/media/media-buttons.ts` change `[${ACTION_ATTR}].is-success`, `.is-opened`, `.is-duplicate`, `.is-error` and `:disabled` to `html [${ACTION_ATTR}].is-success` (specificity (0,2,1) with the class breaking the tie), or alternatively scope the theme rule to `html[data-av-theme] [data-av-media-action]:not(.is-success):not(.is-error):not(.is-opened):not(.is-duplicate)`. Prefer the first: it keeps the state colours owned by the feature that raises them. Note the `[data-av-downloaded]::after` dot at `media-buttons.ts:1450-1459` survives either way because the theme rule does not target the pseudo-element, but it is keyed on `data-av-downloaded` and not on `.is-error`, so failure still needs the background fix.
  Acceptance: a browser test in the style of `tests/injected-ui-contract.test.mjs` mounts `MEDIA_CSS` and `THEME_CSS` together, sets `data-av-theme` to each of the six themes plus absent, and asserts `getComputedStyle(button).backgroundColor` differs between `""`, `is-success` and `is-error` in every case.
  Confidence: Verified
  Effort: S

- [ ] P1 — F213, 24 stale `--av-muted` fallbacks put Control Center secondary text at 4.07:1 in the shipped default configuration
  Category: a11y
  Where: `src/features/appearance/theme.ts:196-199` defines the corrected token. The stale fallback `rgb(113, 118, 123)` appears at `src/ui/control-center.ts:2736, 2780, 2802, 2823, 2861, 2873, 2881, 2901, 2960, 3005, 3094, 3212, 3324, 3491, 3542, 3588`; `src/features/ai/command-menu.ts:490, 493, 570, 583`; `src/features/composer/composer-snippets.ts:354`; `src/features/library/bookmarks-feature.ts:287`; `src/features/media/media-buttons.ts:1488, 1569`.
  Problem: `theme.ts:196-198` records that X's own secondary grey `rgb(113, 118, 123)` measures 3.96:1 on the panel row and was lifted to `rgb(132, 139, 145)` for exactly that reason. The token was fixed; 24 of its 31 `var(--av-muted, …)` fallbacks were not. This is not a cosmetic inconsistency, because `theme.ts:186-188` states that theme `"off"` emits no class and therefore defines no custom property at all — and `src/platform/settings.ts:405` makes `"off"` the default. In the shipped default configuration the fallback is the value that paints. Every 12px helper line, description and status string in the panel renders at 4.07:1.
  Evidence: `grep -c -- "rgb(113, 118, 123)" src/` returns 24; `grep -c -- "var(--av-muted, rgb(132, 139, 145))" src/` returns 7, and `control-center.ts:2717` (`.av-version`, corrected) sits nineteen lines above `control-center.ts:2736` (`.av-subtitle`, stale) with the same surface behind both. Contrast arithmetic, WCAG 2.x relative luminance: `.av-content` at `control-center.ts:2943` is `color-mix(in srgb, var(--av-surface, rgb(15, 20, 25)) 94%, black)`, which with the property undefined resolves to `#0E1318`, L = 0.00625. Text `#71767B` has L = 0.17902. Ratio = (0.17902 + 0.05) / (0.00625 + 0.05) = **4.07:1**, below the 4.5:1 required for 12.5px text. With `rgb(132, 139, 145)` (L = 0.25417) the same pair gives **5.41:1**. `.av-panel-header` (`:2697`) and `.av-transaction-bar` (`:3578`) carry the same pair.
  Fix: replace every `rgb(113, 118, 123)` fallback with `rgb(132, 139, 145)`. Do not change the token definitions, which are already correct. Add the literal to the forbidden-string list in `tests/source-contracts.test.mjs` so it cannot be reintroduced, in the same way that file already pins the `font:` shorthand rule.
  Acceptance: `grep -r -- "rgb(113, 118, 123)" src/` returns nothing; a `tests/source-contracts.test.mjs` case fails if it reappears; the panel contrast assertions in `tests/a11y-axe.test.mjs` run with `appearance.theme = "off"` and report no new `color-contrast` violations.
  Confidence: Verified
  Effort: S

- [ ] P1 — F214, Boot's failure guard starts after storage initialization, so the most likely boot failures show no notice and leave the page bridge installed
  Category: reliability
  Where: `src/main.ts:95-236`. The `try` opens at `src/main.ts:243` (`await registry.initAll(context)`). Everything before it runs unguarded: `createPageBridge` (`:106`), `durableStorage.initialize` (`:123`), `profileManager.load` (`:130`), `diagnosticsStore.load` (`:136`), `integrationUsage.load` (`:139`), `storage.get(SETTINGS_KEY, …)` (`:143`), `auditLog.load` (`:195`). The throw itself is at `src/platform/durable-storage.ts:311` (`for (const key of pending)` inside `#reconcilePendingWrites`), which `initialize()` awaits at `:120` *outside* its own `try` at `:122`.
  Problem: `#reconcilePendingWrites` reads `aviary.durable.pending` through a guarded `get` that falls back to `[]` on a read or parse error, then does `if (pending.length === 0) return` followed by `for (const key of pending)`. A stored value that is a non-array object or a number has `length === undefined`, fails the early return, and is not iterable. The resulting `TypeError` escapes `initialize()`, escapes `bootInternal` unguarded, and rejects `boot()` — which both entrypoints call as `void boot({...})` (`src/entrypoints/userscript.ts:3`, `extension-content.ts:3`). The user gets `data-av-ready="booting"` forever, no `showBootFailureNotice`, and a page bridge that was created at `:106` and is never destroyed, so `fetch`, `XMLHttpRequest.prototype.open/send` and `sendBeacon` stay patched in the page world with the boot-default configuration. This is precisely the silent-failure mode `src/platform/boot-notice.ts:4-8` was written to eliminate, and the notice cannot fire for it.
  Evidence: reproduced in Node against the real module. Constructing `new DurableStorageGateway(legacy, backend, "aviary")` with `legacy` holding `PENDING_WRITES_KEY` and awaiting `initialize(["aviary.settings.v1"])` gives: value `"oops"` (a string) → resolves, `backend=indexeddb pendingWrites=0`; value `{ a: 1 }` → **throws `TypeError: pending is not iterable`**; value `7` → **throws `TypeError: pending is not iterable`**. The same probe confirmed the neighbouring loaders are safe and should not be changed: `readSettingsEnvelope` returned usable settings for all 13 pathological inputs tried (null, string, number, array, `schemaVersion` of NaN / -1 / Infinity / 1e308 / 0, every group replaced by a string, null and an array, and a `__proto__` payload, which did not pollute `Object.prototype`), and `ProfileManager.load` survived a registry that was a string, a number, `{profiles:"x"}` and `{profiles:[null,1,"x",{}]}`.
  Fix: two independent changes, both needed. First, make `#reconcilePendingWrites` defensive like every other reader in the file: `const pending = Array.isArray(raw) ? raw.filter((key) => typeof key === "string") : []`, and move the `await this.#reconcilePendingWrites()` call inside `initialize`'s existing `try` so any future throw there lands on `#fallback(error)` rather than escaping. Second, move `bootInternal`'s `try` up to just after `installEarlyAdShield()` so it covers storage, profile, diagnostics, settings and audit-log loading, and add `pageBridge.destroy()` to the catch path it already has — the catch at `:281-291` already calls `pageBridge.destroy()`, so only the `try` boundary needs to move.
  Acceptance: a new case in `tests/durable-storage.test.mjs` stores `{a:1}` at `PENDING_WRITES_KEY` and asserts `initialize()` resolves with `pendingWrites: 0` instead of throwing; a new case in `tests/boot-notice.test.mjs` (or `runtime-hardening.test.mjs`) makes a pre-`initAll` step reject and asserts `document.getElementById("av-boot-notice")` exists and `documentElement.dataset.avReady === "error"`.
  Confidence: Verified
  Effort: M

- [ ] P1 — F215, `PageBridge` has no unsubscribe, so bisect multiplies every page event N times
  Category: correctness
  Where: `src/platform/page-bridge.ts:48-54` (the `PageBridge` interface), `:300-304` (`on`), `:321` (`handlers.clear()`, reachable only from `destroy()`). Subscribers: `src/features/export/network-capture.ts:55`, `src/features/privacy/page-hooks.ts:44` and `:60`, `src/features/media/media-buttons.ts:257`.
  Problem: the bridge exposes `on` and no `off`. Each of the three subscribing features guards with a module-level `subscribedBridge` variable and, in `destroy`, sets that variable to `undefined` without removing the handler — `network-capture.ts:83-85`, `page-hooks.ts:88-90`, `media-buttons.ts` in the same shape. `registry.resume` (`src/features/registry.ts:141`) re-runs `init`, the guard now compares unequal, and a second handler joins the `Set`. `src/features/core/feature-bisect.ts:51` protects only `core.controlCenter` and `core.i18n`, so all three of these are bisect candidates. The epoch guard cannot reject the stale handlers: the closure at `network-capture.ts:55-60` reads the module-level `captureEpoch` at call time rather than capturing it, and `enqueueCaptured` (`:143`) only rejects on `epoch !== captureEpoch || activeContext !== ctx`, both of which every accumulated handler satisfies. One GraphQL response is therefore sanitized and processed once per accumulated handler. Export records themselves do **not** duplicate, because `recordKey` in `src/features/export/jobs.ts` omits `capturedAt` and the `append` dedupe set absorbs the copies — that half of an earlier reading of this defect is wrong and should not be chased. What does multiply is everything counted per event: `sessionPayloads` and `sessionBytes` burn the 500-payload and 50 MB session budgets N times faster, so capture stops early with "session payload limit reached" for no visible reason; `networkCaptureFeature.getStatus()` reports an inflated capture count; `mirrorBookmarks` and `auditLog.record` fire N times per response; and `page-hooks` inflates the `blockedBeacons` and `blockedAdRequests` privacy counters the Trust page shows, N times per blocked request. `media-buttons` fires one `ctx.requestApply()` per duplicate.
  Evidence: `grep -n "off\b" src/platform/page-bridge.ts` finds no unsubscribe on the interface; `handlers.clear()` appears once, at `:321` inside `destroy()`, which `src/main.ts:305` calls only after all feature teardown. `src/features/core/feature-bisect.ts:51` reads `export const BISECT_PROTECTED_FEATURES: readonly string[] = ["core.controlCenter", "core.i18n"];` and `bisectCandidates` (`:54-57`) returns every other active id. `tests/feature-bisect.test.mjs` and `tests/feature-lifecycle.test.mjs` contain no assertion on bridge handler counts. A fresh-context pass reproduced the accumulation against the real `createPageBridge` in extension mode (real `MessageChannel`, real handshake, `status() === "connected"`), the real `FeatureRegistry` and the real `networkCaptureFeature`: one GraphQL envelope produced 1 capture call at baseline, 2 after one suspend/resume cycle, 3 after two, 4 after three. The same pass verified the dedupe that spares the export records, appending two records differing only in `capturedAt` and getting 1 stored, not 2.
  Fix: give `PageBridge` an `off(kind, handler)` that deletes from the `Set`, and have each of the three features keep its handler in a module-level variable so `destroy` can pass the same reference. Alternatively have `on` return a disposer and store that. Either way the fix is in `page-bridge.ts` plus the three `destroy` bodies.
  Acceptance: a test that inits a feature against a stub bridge, destroys it, inits again, emits one `graphql` payload and asserts the handler ran exactly once; and an assertion that after three `suspend`/`resume` cycles of `export.networkCapture` a single payload advances `sessionPayloads` by exactly one.
  Confidence: Verified
  Effort: M

- [ ] P1 — F216, A GraphQL response over 1.5 MB is reported to the user as an untrusted message and dropped with no rejection count
  Category: reliability
  Where: `src/page/page-agent.ts:808-818` (`emitCapturedGraphql`), `src/page/page-agent.ts:126-131` (the `bytes` check in `sanitizeCapturedGraphqlPayload`), `src/platform/page-bridge.ts:141-147` (`rejectMessage`) and `:186-193` (the `graphql` branch of `dispatch`).
  Problem: when a captured body exceeds `MAX_GRAPHQL_PAYLOAD_BYTES` the page agent emits `body: undefined` but still sets `bytes` to the real, over-limit size. The isolated-world validator rejects on `bytes > MAX_GRAPHQL_PAYLOAD_BYTES` before it ever looks at `body`, returns `null`, and `dispatch` calls `rejectMessage("invalid GraphQL payload")`, which writes `diagnostics.warn("Page bridge rejected an untrusted message", { reason })`. That warning is persisted for seven days by `DiagnosticsStore` and surfaced in the panel. So Aviary's own size cap is reported to the user as a security event on a page where nothing hostile happened. Worse, because `dispatch` returns before invoking handlers, `network-capture.ts` never sees the message, `rejectedPayloads` stays at zero, and `networkCaptureFeature.getStatus()` (`:104-110`) still reports "N payloads captured" with no rejection suffix. The user is told the boundary refused something untrusted and simultaneously told capture is healthy, while the response's posts are silently missing from the export.
  Evidence: `page-agent.ts:815` reads `body: bytes <= MAX_GRAPHQL_PAYLOAD_BYTES ? body : undefined` while `:812` computes `bytes` from the full body unconditionally. `page-agent.ts:126-131` rejects on the `bytes` bound first: `if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_GRAPHQL_PAYLOAD_BYTES) { return null; }`. `page-bridge.ts:187-192` then takes the `if (!sanitized) { rejectMessage("invalid GraphQL payload"); return; }` branch, so the `handlers.get(envelope.kind)` loop below it never runs. `MAX_GRAPHQL_PAYLOAD_BYTES` is 1_500_000 (`page-agent.ts:74`), which a long conversation's TweetDetail response can exceed.
  Fix: distinguish "too large" from "not trustworthy" at the source. Have `emitCapturedGraphql` clamp the reported `bytes` and add an explicit `truncated: true` (or emit a separate `oversize` kind), let the sanitizer accept that shape, and have `network-capture.ts` count it through the existing `rejectCapture(ctx, "payload exceeded the size cap")` path so `getStatus()` reports it. Keep `rejectMessage`'s wording for genuinely malformed envelopes only.
  Acceptance: a test emits a payload whose `bytes` exceeds the cap and asserts the diagnostics entry does not contain "untrusted", that `networkCaptureFeature.getStatus().message` includes a rejection count, and that a well-formed under-cap payload is still captured.
  Confidence: Verified
  Effort: M

- [ ] P1 — F217, Every Catch-up filter, sort and grouping change destroys the control the user is operating
  Category: a11y
  Where: `src/features/filtering/catch-up-ui.ts:170` (`dialog.replaceChildren(header, controls, filters, scroller)`), reached from the handlers at `:95-98` (Window select), `:108-112` (Sort select), `:120-123` (Group authors checkbox) and `:137-142` (each category chip).
  Problem: every one of those handlers calls `rerender()`, which is `() => renderDialog(dialog, entries, state, render)` (`:48`), and `renderDialog` ends by replacing all four of the dialog's children. The `<select>`, checkbox or chip the user just operated is removed from the DOM while it holds focus, so focus falls back to the dialog root and the next Tab restarts from the top of the modal. Filtering the digest with a keyboard means re-tabbing to your place after every single change. The summary paragraph at `:81` is rewritten with the new count and carries no `aria-live`, so a screen reader is told nothing about the result set changing either.
  Evidence: read at the cited lines; `renderDialog` builds `header`, `controls`, `filters` and `scroller` from scratch on every call and line 170 is `dialog.replaceChildren(header, controls, filters, scroller);`. `tests/catch-up-ui.test.mjs` has a single case, "exposes local records and filters without a page request", with no focus or ARIA assertion. Note `aria-pressed` on the chips (`:136`) is correct precisely because of the rebuild, so that attribute is not the defect.
  Fix: split `renderDialog` so the controls and filter rows are built once and only `scroller`'s content is replaced on a state change. Keep `header`, `controls` and `filters` mounted and update the chip `aria-pressed` and label counts in place. Give the summary paragraph at `:81` `role="status"` so the new count is announced. If a full rebuild has to stay, record `document.activeElement`'s stable identity before `replaceChildren` and restore focus after.
  Acceptance: a browser test opens the digest, focuses the Sort select, changes it, and asserts `document.activeElement` is still the Sort select; and asserts the summary element carries `role="status"`.
  Confidence: Verified
  Effort: M

- [ ] P1 — F218, The Catch-up dialog is the only injected surface with no translation, and ships English in all eight non-English locales
  Category: ux
  Where: `src/features/filtering/catch-up-ui.ts` throughout — `:30-38` (the seven window options), `:78` ("Catch-up"), `:81-83` (the summary and empty-window sentences), `:86-87` ("Close", "Close catch-up"), `:93` and `:104` ("Window", "Sort"), `:99-103` (the four sort labels), `:124` ("Group authors"), `:127` ("Catch-up categories"), `:155-160` (the empty state) and `:162` ("That's all."). Reached from `src/ui/control-center/sections/reading.ts:900-910` via `src/features/core/control-center.ts:586-588`.
  Problem: the file imports no translation helper and assigns every string to `textContent` directly. `translateText` (`src/platform/i18n.ts:151-156`) returns the English source for anything it cannot find, so nothing fails loudly — the dialog simply renders in English next to a fully translated Control Center. This is the exact regression `tests/injected-ui-contract.test.mjs:588-590` was written to prevent for the other injected controls.
  Evidence: `catch-up-ui.ts` is the only file returned by "has a `textContent = "` literal and imports neither `feature-i18n` nor `translateText"` across `src/features/` and `src/page/`; the other fourteen files with injected copy all import `ft` or `translateText`. Checking eight of its strings against the catalog — "Group authors", "A quiet window. Nothing new to review.", "Nothing in this window.", "That's all.", "Close catch-up", "Newest first", "Last hour", "Least dense first" — every one is absent from `src/platform/i18n-catalog.ts`. The locale contract test at `tests/injected-ui-contract.test.mjs:522-593` covers only `hiddenPostsFeature`, `mediaButtonsFeature` and `aiCommandMenuFeature`.
  Fix: import `ft` from `src/features/core/feature-i18n.ts` and thread the `FeatureContext` into `openCatchUpDigest` (it is called from `control-center.ts:587`, which has `ctx` in scope), then wrap every user-visible literal. Run `node tools/i18n-extract.mjs --write` afterwards so the new strings enter the manifest and catalog. Add the digest to the locale contract test alongside the three features already there.
  Acceptance: `tests/injected-ui-contract.test.mjs` gains a case that opens the digest with `i18n.locale` set to `ja` and `ar` and asserts the title, the Close label and the category chips all differ from their English rendering; `npm test` still reports 100% panel coverage for every locale.
  Confidence: Verified
  Effort: M

- [ ] P1 — F219, A dimmed post says it was hidden, in the shipped default configuration
  Category: ux
  Where: `src/features/filtering/filter-engine.ts:261-273` (`describeCause`), applied at `:251-253` for both verdict actions. Default set at `src/platform/settings.ts:446` (`showReason: "dimmed"`). Option labels at `src/ui/control-center/constants.ts:28-31`.
  Problem: `describeCause` returns "Hidden by your rule", "Hidden by your keyword" or "Hidden by your pattern" regardless of what the filter actually did. `processArticle` sets `REASON_ATTR` whenever `describe && verdict.cause` (`:251`), and `verdict.action` can be `"dim"` as well as `"hide"` — `:243-244` writes the action into `RESULT_ATTR` and the stylesheet at `:387` and `:418` renders the reason above dimmed posts specifically. The default `showReason` value is `"dimmed"`, whose option label is literally "On dimmed posts" (`constants.ts:30`), so out of the box the only posts that display a reason are the ones the sentence describes incorrectly. The user reads "Hidden by your rule" on a post that is plainly still on screen. The fourth branch, `"Under your engagement floor"` (`:266-270`), is action-neutral and is already correct.
  Evidence: read at the cited lines. `filter-engine.ts:243` is `if (verdict.action !== "show") { article.setAttribute(RESULT_ATTR, verdict.action); }` and `:418` is `html.${EXPLAIN_CLASS} ${ARTICLE_SELECTOR}[${RESULT_ATTR}="dim"][${REASON_ATTR}]::before`, which is the rule that paints the sentence on a dimmed post. `settings.ts:446` reads `showReason: "dimmed",`.
  Fix: pass `verdict.action` into `describeCause` and branch the three sentences: "Dimmed by your rule" / "Hidden by your rule", and the same pair for keyword and pattern. Add the three new English strings and re-run `node tools/i18n-extract.mjs --write`.
  Acceptance: a test drives the engine with a rule whose action is `dim` and asserts the `data-av-reason` attribute starts with "Dimmed", and with a `hide` rule asserts it starts with "Hidden".
  Confidence: Verified
  Effort: S

- [ ] P1 — F220, 50 of the panel's 54 action rows report every failure as "Action failed."
  Category: ux
  Where: `src/ui/control-center.ts:1008-1031` (`actionRow`, `failureMessage = "Action failed."`). Call sites across `src/ui/control-center/sections/data.ts`, `advanced.ts` and `reading.ts`.
  Problem: `actionRow` takes an optional fourth argument and defaults it to the string "Action failed."; on rejection it reports the real error to `options.onError` (diagnostics only) and calls `setStatus(failureMessage)`. Only 4 of the 54 `ctx.actionRow(...)` call sites pass that fourth argument, so 50 user-visible failures collapse to three words with no cause and no next step. Several handlers already throw a perfectly good sentence that the user never sees — "Archive import could not be paused" (`data.ts:156`), "Export job could not be cancelled" (`data.ts:1084`), and so on — and others have no `catch` at all, so pausing an import, cancelling an export, retrying media, assigning legacy profile data and opening the catch-up digest all fail identically.
  Evidence: `grep -c "ctx.actionRow(" src/ui/control-center/sections/*.ts` returns 54. A brace-aware argument count over those same call sites returns 4 with a fourth argument and 50 without. `control-center.ts:1027-1031` is `if (failureMessage === "Action failed.") { setStatus("Action failed."); } else { setStatus(failureMessage); }` — note both branches are identical in effect, so the conditional is also dead and should collapse to `setStatus(failureMessage)`.
  Fix: pass a specific `failureMessage` at every call site, phrased as cause plus next step (for example `data.ts:1062` → "The export job could not be paused. It may have already finished. Reopen this section to see its current state."). Collapse the dead conditional at `:1027-1031`. Consider making the fourth argument required so a new action row cannot be added without one.
  Acceptance: a test asserts every `ctx.actionRow` call in `src/ui/control-center/sections/` passes four arguments, in the same style as the existing source-contract tests; and `grep -c '"Action failed."' src/` returns 1 (the constant itself).
  Confidence: Verified
  Effort: M


- [ ] P1 — F243, A settings value puts `..` path segments into every export ZIP entry name
  Category: security
  Where: `src/platform/settings.ts:1219-1225` (`folderHintValue`), `src/features/export/export-feature.ts:353-356` (`sanitizeFolder`) and `:358-360` (`packagePath`). The value is `media.lastSaveFolder`, edited at `src/ui/control-center/sections/data.ts:1019-1027`.
  Problem: both sanitizers strip `< > : " | ? *` and control characters and neither strips `..`. `sanitizeFolder` additionally rewrites `\` to `/`, which converts a Windows-style traversal into a working POSIX one. The cleaned string is then concatenated straight into the ZIP entry name, so `tweets.json`, `viewer.html`, `manifest.json` and every `media/*` member escape the extraction directory on any tool that honours `..`. `zipFilename()` collapses `/` for the download name, so nothing looks wrong to the user.
  Evidence: reproduced by calling the real `normalizeSettings` and `buildExportZip` and reading local-file-header names straight out of the ZIP bytes. Input `"../../../../AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"` persists unchanged through `normalizeSettings` and yields entry names `"../../../../AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/tweets.json"` and two more. Input `"..\\..\\..\\Startup"` yields `"../../../Startup/tweets.json"` — the backslash replace normalises it into the traversal. The control `"normal-folder"` yields `"normal-folder/tweets.json"`. `tests/video-and-presentation.test.mjs:58-62` asserts only that `<` and `?` are removed.
  Fix: in `folderHintValue`, split on `/`, drop any segment that is empty, `.`, `..`, a Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`), or ends in a dot or space, then rejoin. Have `sanitizeFolder` re-apply the same reduction rather than trusting the stored value, since it is also reachable from a restored library backup. Consider rejecting `..` in `writeZip` as a last line of defence.
  Acceptance: a test asserts no entry name produced by `buildExportZip` contains a `..` segment for any of the inputs above, and that a normal folder name still round-trips.
  Confidence: Verified
  Effort: S

- [ ] P1 — F244, A regex filter rule can freeze the tab, and the budget check does not catch the pattern that does it
  Category: reliability
  Where: `src/features/filtering/regex-budget.ts:70-90` (`checkRegexBudget`, and `UNBOUNDED_QUANTIFIER` at `:77`); matching runs at `src/features/filtering/predicates.ts` inside `judge`, called per article from `src/features/filtering/filter-engine.ts:210`.
  Problem: the budget is compile-time only and bounds three things — pattern length (400), literal repetition counts (200), and a quantified group whose body text already contains `*` or `+`. There is no per-match, per-post or per-pass time budget anywhere in the pipeline, so matching is synchronous on the main thread with no abort. The whole exponential-alternation family slips through, because the repeated group's body carries no quantifier of its own. The module's own comment at `regex-budget.ts:14` already concedes that "two alternation branches that overlap can still backtrack badly"; what is missing is any second line of defence.
  Evidence: `checkRegexBudget` returns no reason for `(a|a)+$`, `(a|ab)+$`, `(?:a|a)+$`, `(x|x|x)+y` and `^(a|a)*$`, while correctly refusing `(a+)+b`, `(a*)*b` and `([a-z]+)+$` with "a repeated group that already repeats can backtrack badly enough to freeze the page". Timed end to end through the real `compileFilters({keywords:[],regex:["/(a|a)+$/"],whitelist:[],premium:"off",media:{},generation:1})` and `judge` against a signal whose text is `"a".repeat(n) + "!"`: n=20 → 104 ms, n=24 → 220 ms, n=26 → 599 ms, n=28 → 2335 ms, n=30 → **9795 ms**. That is per article per mutation batch. A post with forty repeated characters is an unrecoverable tab.
  Fix: two changes, either of which closes the family, and both are cheap. Extend the compile-time check to refuse a repeated group whose body contains a top-level `|` (this costs a handful of legitimate patterns and is the smaller change). And add a runtime budget: time the first N matches of each compiled pattern against a bounded sample, disable a pattern that exceeds, say, 5 ms on a 2 KB string, and surface it through the refused-rules path added by F253 so the user is told which rule was switched off and why.
  Acceptance: `checkRegexBudget("(a|a)+$")` returns a reason; a test asserts a pattern that exceeds the runtime budget is disabled and named in the panel rather than left running.
  Confidence: Verified
  Effort: M

- [ ] P1 — F247, Clicking a row button while an edit is staged discards the edit, then Save reports success
  Category: correctness
  Where: `src/ui/control-center.ts:1050-1054` (`render`'s dirty guard) and `:1462-1500` (`commitDraft`). Reachable from the row handlers that call `ctx.render()` without `ctx.guardDraft()`: `src/ui/control-center/sections/reading.ts:1037`, `src/ui/control-center/sections/data.ts:220`, `:417`, `:694`, `:710`, `src/ui/control-center/sections/advanced.ts:1128`.
  Problem: `render()` guards only `replaceSettings` behind `if (!transactionDirty())`; the DOM rebuild below it runs unconditionally. Draft-registered text, integer and textarea controls hold the typed value only in the DOM node — `drafts.register(input, label, () => onChange(input.value.trim()))` defers reading it until commit — so the rebuild throws the edit away while `dirtyControls` still points at the now-detached node. `transactionDirty()` is still true, so the Save button stays lit. `commitDraft` then filters to `control.isConnected` at `:1465`, finds nothing, runs the empty commit loop, writes the unchanged draft, and finishes with `setStatus(lastDraftMessage)` — "Saved locally". The user types a value, clicks an unrelated button in the same section, watches the field revert, presses a Save button that is still lit, and is told the save succeeded while nothing was written.
  Evidence: read at the cited lines and confirmed by driving the panel: staging a value produced status "Unsaved changes" with Save enabled; clicking the section's Restore button reverted the field while Save stayed enabled; pressing Save reported "Saved locally" with the setting still holding its pre-edit value and `onChange` firing once for a no-op write. `actionRow` and the preset and rule-import buttons do call the guard; these six do not.
  Fix: cheapest correct version — in `commitDraft`, when `dirtyControls.size > 0` but `controls.length === 0`, treat it as a failed save and say so rather than reporting success. Better: make `ctx.render()` defer while `transactionDirty()`, the way `refresh()` already does, or re-key `dirtyControls` and `draftCommits` onto the rebuilt nodes by row label.
  Acceptance: a test stages a text edit, triggers a section rebuild, presses Save, and asserts either the edit is committed or the status reports a failure — never "Saved locally" with the old value still in settings.
  Confidence: Verified
  Effort: M

### P2

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

- [ ] P2 — F228, The Hide-navigation help text omits an id the code accepts
  Category: docs
  Where: `src/ui/control-center/sections/reading.ts:352`; the accepted set is `HIDE_NAV_ITEM_IDS` at `src/ui/control-center/constants.ts:49-62`.
  Problem: the helper text lists eleven ids — home, explore, notifications, follow, chat, grok, history, studio, premium, profile, more — and the set contains twelve. `messages` is accepted by the filter at `reading.ts:358` and named nowhere in the UI, so a user who wants to hide the Messages row has no way to learn the id, and the filter silently drops anything not in the set, giving no feedback that a guess was wrong.
  Evidence: `constants.ts:49-62` lists `"premium", "home", "explore", "notifications", "follow", "chat", "messages", "grok", "history", "studio", "profile", "more"`. The description at `reading.ts:352` omits `messages`.
  Fix: add `messages` to the sentence, keeping the code's order so the two stay comparable. Better still, derive the list from `HIDE_NAV_ITEM_IDS` so it cannot drift again, and surface the ids the textarea rejected instead of dropping them silently. Re-run the i18n extractor after any wording change.
  Acceptance: a test asserts every member of `HIDE_NAV_ITEM_IDS` appears in the row's description string.
  Confidence: Verified
  Effort: S

- [ ] P2 — F229, The panel's navigation buttons and textareas have no Aviary focus ring outside forced-colors mode
  Category: a11y
  Where: `src/ui/control-center.ts:2648-2654` (the base `:focus-visible` rule) versus `:3740-3749` (the same rule inside `@media (forced-colors: active)`).
  Problem: the base rule covers `.av-launcher`, `.av-button`, `.av-select` and `input`. The forced-colors rule covers those four plus `.av-nav-item` and `textarea`. `.av-nav-item` is a real `<button>` (`control-center.ts:1325`) and is the panel's primary navigation, so in ordinary rendering the most-used control in the panel falls back to the UA ring while everything beside it shows Aviary's 2px accent ring at 3px offset. The forced-colors list containing both names is direct evidence the omission upstream is an oversight rather than a decision.
  Evidence: `:2648-2651` reads `.av-launcher:focus-visible, .av-button:focus-visible, .av-select:focus-visible, input:focus-visible {`; `:3744-3746` reads `.av-nav-item:focus-visible, input:focus-visible, textarea:focus-visible {`. `grep -n "av-nav-item" src/ui/control-center.ts` shows its only other `:focus-visible` mention is that forced-colors block.
  Fix: add `.av-nav-item:focus-visible` and `textarea:focus-visible` to the selector list at `:2648`. The ring colour `var(--av-accent, rgb(29, 155, 240))` measures about 6:1 against the panel surface `#0E1318`, so it is visible with the default theme as well as every named one.
  Acceptance: `tests/a11y-behaviour.test.mjs` gains an assertion that every focusable control in the panel shadow root has a non-`none` computed `outline-style` when focus-visible, not just an accessible name.
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

- [ ] P2 — F251, A refused regex rule is dropped silently and the panel says it was saved
  Category: ux
  Where: `src/features/filtering/predicates.ts:447-469` (`tryCompileRegex` returning `null` for both the budget refusal and a constructor throw), `src/features/filtering/filter-engine.ts:39` (`filterRuleErrors`, which covers only the rule DSL), `src/ui/control-center/sections/reading.ts:573-582` (the save message).
  Problem: a regex rule that the budget refuses and one that will not compile are both discarded with no record of what was refused, and the panel then reports `Saved ${settings.filter.regexRules.length} regex rules` counting the raw input lines. Type `(a+)+b` or `[unclosed` and the status line says "Saved 1 regex rules" while zero patterns are active. This is the failure mode the codebase rejects in its own words at `filter-engine.ts:151` — "A rule that cannot be parsed must be visible, not a filter that silently never matches" — applied to the DSL but never to `filter.regexRules`.
  Evidence: read at the cited lines. `checkRegexBudget("(a+)+b")` returns the reason "a repeated group that already repeats can backtrack badly enough to freeze the page", and `tryCompileRegex` maps that to `null` with no side channel. `compileFilters` (`predicates.ts:156-164`) pushes only successful compiles into `patterns` and `patternSources`.
  Fix: have `compileFilters` return the refused sources with their reasons alongside `patterns`, fold them into `filterRuleErrors()`, and render them the way DSL parse errors already are at `reading.ts:517-519`. This is also where F244's runtime-disabled patterns should surface.
  Acceptance: a test saves `["(a+)+b", "[unclosed", "/valid/"]` and asserts the panel reports one active rule and names the two refused sources with reasons.
  Confidence: Verified
  Effort: S

- [ ] P2 — F252, Three settings rows accept values the normalizer silently replaces on the next reload
  Category: correctness
  Where: `src/ui/control-center/sections/reading.ts:975` ("Maximum remembered posts"), `src/ui/control-center/sections/data.ts:1203` ("Records per ZIP"), `src/ui/control-center/sections/advanced.ts:377` ("Hand off files larger than (MB)"). The helper is `src/ui/control-center.ts:2239-2282` (`integerInputRow`).
  Problem: `integerInputRow` takes an optional `bounds` argument and writes it to `input.min` / `input.max`, and `commitDraft` gates on `checkValidity()`. These three call sites omit it, so the input carries `min="0"` and no maximum while the normalizer clamps a real range. Two of them state that range in their own helper text and then do not enforce it. The panel confirms the value with a success message, the features read it live for the rest of the session, and a reload substitutes a different number with no notice. `aria2.minBytes` is the worst of the three: `src/features/integrations/aria2.ts:91` compares `estimatedBytes >= integration.minBytes`, so a typed `0` hands every download to Aria2 for the session, and the value does not come back as the 50 MB default afterwards — it comes back as 1 MB, the clamp floor.
  Evidence: measured by calling the real `normalizeSettings`: `hidden.maxEntries` 0 → 100, `media.zipChunkSize` 100000 → 1000, `integrations.aria2.minBytes` 0 → 1000000. The three call sites pass four arguments where the working examples pass five: `src/ui/control-center/sections/advanced.ts:698` passes `{ max: INTEGRATION_BUDGET_CEILINGS.ai.maxRequestBytes }`, `data.ts:1620` passes `{ min: 1, max: 6 }`, and `reading.ts:669` passes `{ min: 0, max: 1_000_000 }`. The MB-to-bytes conversion at `advanced.ts:380-382` is correct and is not part of this finding.
  Fix: pass `bounds` matching the normalizer's clamp on all three, reading the same constants the normalizer reads so the two cannot drift.
  Acceptance: a test asserts that for every `integerInputRow` whose setting the normalizer clamps, the rendered input's `min` and `max` equal the clamp bounds.
  Confidence: Verified
  Effort: S

- [ ] P2 — F253, A single space in the settings search builds every section at once
  Category: perf
  Where: `src/ui/control-center.ts:1374-1383` (`buildContent`) and `:1391-1392` (`searchResults`).
  Problem: `buildContent` gates on `if (searchQuery.length > 0)` using the untrimmed value, while `searchResults` computes `needle = searchQuery.trim().toLowerCase()`. For a query of `"   "` the gate passes with an empty needle, `includes("")` is true for every row, and all fourteen sections are built at once — the exact full-panel render the section registry exists to avoid, as its own comment at `:1386-1389` says. It also runs every section's option callbacks (`getSelectorHealth`, `getMediaStatus`, `getBookmarkStatus`, `searchBookmarks` and the rest) and clears the rail's `aria-current`, so the panel looks like it lost its place. There is no debounce on the search input, so this happens per keystroke.
  Evidence: read at the cited lines; the raw-versus-trimmed mismatch is on adjacent code paths. Driven in the panel: with no query, 1 section and 1 row rendered with the rail's `aria-current` set; with the query `"   "`, 12 sections and 124 rows rendered and no `aria-current`.
  Fix: compute `needle` once at the top and gate `buildContent` on `needle.length > 0`. Add a short debounce to the search input while there.
  Acceptance: a test sets the search query to `"   "` and asserts the panel renders one section, and that `aria-current` is still set on the rail.
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

- [ ] P2 — F257, The unified library search is the one panel handler with an unguarded await
  Category: reliability
  Where: `src/ui/control-center/sections/data.ts:557-566` (`renderUnified`) and its two call sites, both `void renderUnified()`.
  Problem: `renderUnified` calls `results.replaceChildren()` and then awaits either `ctx.options.offlineSemanticSearch(query)` or `ctx.options.offlineSearch(query)` with no try/catch, and both callers discard the promise. `offlineSemanticSearch` reaches `semanticIndex.search(..., { allowProviderRequest: true })` at `src/features/core/control-center.ts:701`, a live provider request. A provider failure therefore becomes an unhandled promise rejection, and because the results area has already been cleared the user is left looking at an empty pane with no message, no status line and no diagnostics entry. The sibling Semantic search row at `src/ui/control-center/sections/advanced.ts:902` wraps the same class of call in a `.catch` that routes to `ctx.options.onError`, so the pattern is established.
  Evidence: read at the cited lines. A sweep of the other 27 `addEventListener` handlers in `src/ui/control-center/sections/` found every one either goes through `actionRow`'s shared rejection boundary at `src/ui/control-center.ts:1013-1045` or carries its own `.catch` plus a `.finally` that re-enables its button. This is the only one that does neither.
  Fix: wrap the body in try/catch and route to `ctx.options.onError` and `ctx.setStatus`, matching `advanced.ts:902`.
  Acceptance: a test makes `offlineSemanticSearch` reject and asserts the status line reports the failure and no unhandled rejection is raised.
  Confidence: Verified
  Effort: S

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

