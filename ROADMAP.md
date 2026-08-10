# Aviary ROADMAP

Version: `1.16.0`

Actionable work only. Historical and completed roadmap material is archived in CHANGELOG.md; blocked work is kept in Roadmap_Blocked.md.

## Actionable Items

- [ ] P2 — Secondary Control Center sections bypass the localization choke point
  Category: ux
  Where: `src/ui/control-center.ts:273,918-1069,1156-1261,1365-1402,1554-1637,2136-2155`; `src/platform/i18n.ts:2828-2839`
  Problem: The panel’s `t()` helper is exact-string keyed, but many stable labels, descriptions, empty states, action statuses, and the dialog ARIA label in the snapshots/archive, integrations, semantic-search, external-export, and crosspost sections are passed directly to `el()`/`setStatus()` as English strings. The extractor/catalog may contain those strings, but runtime never calls `t()` for them, so a user who selects es/fr/ja/ar sees translated chrome and English secondary workflows.
  Evidence: For example, “Import official X archive”, “Search captured records”, “Aria2 active downloads”, “Crosspost as thread”, and “Semantic search” are raw `el()` text at the cited lines; `setStatus()` translates only an exact catalog key, so interpolated statuses such as `Captured ${count} followers...` also fall back to English. The existing i18n tests validate catalog coverage, not rendered secondary-section language.
  Fix: Route every stable secondary label, description, status template, empty/error state, tooltip, and ARIA name through stable catalog keys/formatters with explicit interpolation values; keep runtime data (counts, handles, URLs) separate from translated copy. Extend locale tests to mount and exercise every section/action.
  Acceptance: In each of the nine locales, every secondary section and its success/error/empty states render translated stable copy, the dialog accessibility name is localized, and no raw English source label from the cited sections remains in the rendered accessibility/text tree except intentional data/brand names.
  Confidence: Verified
  Effort: M

- [ ] P2 — Privacy and installation documentation describes a pre-integration release
  Category: docs
  Where: `docs/PRIVACY.md:63-65`; `docs/INSTALL.md:23-26`; `docs/FAQ.md:5-11,31-37,49-52`; current integration/permission paths in `src/features/integrations/` and `src/features/media/downloader.ts:74-116`
  Problem: The shipped docs still say optional permissions are future and unused by v0.3.0, say the first Save prompts for permission even though the current extension opens a dedicated options page, describe every feature as v0.9.0, claim Aviary’s only outbound traffic is selected media, list XLSX as future, and omit newer stored keys/features from uninstall/privacy guidance. Users can make incorrect trust, permission, and data-retention decisions from these statements.
  Evidence: The live source includes Aria2, Bluesky/Mastodon, AI, semantic-search, optional `downloads`/media-host permission handling, XLSX, snapshots, bookmarks, and multiple persisted stores; the cited docs contain the stale claims. The recent `b9fec4f` documentation fix updated README claims but did not update these three docs, so this is a current release drift rather than a duplicate of that change.
  Fix: Rewrite the three docs for v1.16 behavior: enumerate opt-in outbound integrations and local-only gating, describe the options-page grant/revoke flow, list current formats and all persisted keys/clear paths, and state which integrations/permissions are user-triggered. Add a docs consistency check for versioned feature/permission claims.
  Acceptance: A fresh-doc review finds no v0.3/v0.9/XLSX-future/“only media outbound” claims, permissions and integration behavior match the source and README, and the uninstall/privacy tables include current snapshots, bookmarks, semantic, Aria2, query, and cleanup state.
  Confidence: Verified
  Effort: M

- [ ] P2 — Control Center overlay is visually open but not an actual modal
  Category: a11y
  Where: `src/ui/control-center.ts:265-342,3389-3422`
  Problem: The open overlay has `pointer-events: none`, while only `.av-panel` has `pointer-events: auto`; clicks outside the panel therefore pass through to X. The dialog has no `aria-modal="true"`, no focus trap, no Escape close path, and no background inerting beyond the overlay’s own closed state. Keyboard and screen-reader users can move into the page behind an open settings dialog, and pointer users can activate X controls through its backdrop.
  Evidence: `setOpen(true)` focuses the panel but does not constrain subsequent focus; the CSS explicitly repeats `pointer-events: none` for `.av-overlay.is-open`. The only close listeners are launcher and close-button clicks at lines 2770-2771. Existing `tests/audit-a11y.test.mjs` verifies only the closed panel’s inert/visibility behavior, not active modal isolation; this also falls short of the roadmap’s F094 active-overlay contract.
  Fix: Implement a real modal pattern: set `aria-modal`, use a localized dialog label, consume/backdrop-handle pointer events while open, trap focus with a policy-approved focus-sentinel/focusin or native-dialog approach, close on Escape, and restore launcher focus on close. Update the preflight keyboard-event policy deliberately if the chosen Escape implementation requires it.
  Acceptance: Headless keyboard/pointer automation cannot focus or click X controls while the panel is open; Tab and Shift+Tab wrap within the panel, Escape closes it, focus returns to the launcher, the accessibility tree exposes one modal dialog, and the backdrop behaves consistently in every supported theme.
  Confidence: Verified
  Effort: M

- [ ] P2 — Injected touch controls remain below the 44 px target or disappear on coarse pointers
  Category: a11y
  Where: `src/features/core/mobile-touch.ts:50-64`; `src/features/filtering/hidden-posts-feature.ts:479-508`; `src/features/library/bookmarks-feature.ts:266-286`; `src/features/ai/command-menu.ts:282-303`; `src/features/composer/composer-snippets.ts:229-271`
  Problem: The page-level touch rules give Hide and media buttons only `min-height: 40px`; hidden-post and bookmark buttons are authored at 24px; AI uses `opacity: 0` except hover/focus; and snippet/AI controls have compact padding with no coarse-pointer override. On touch there is no hover to reveal the AI trigger and several controls are materially smaller than the 44px product/accessibility target.
  Evidence: The Control Center correctly has a shadow-root `@media (pointer: coarse)` rule with 44px controls, but the page-injected controls use the cited independent styles. The existing touch contract test checks only Control Center sizing and hidden-button legibility, not the full injected-control set.
  Fix: Add a shared coarse-pointer contract for all injected action buttons/menu triggers and options: minimum 44×44 hit boxes, adequate spacing, and a visible AI/snippet affordance on touch. Keep labels visually compact inside the larger target rather than scaling the page layout.
  Acceptance: With `matchMedia('(pointer: coarse)')` true, computed bounding boxes for Hide, Save/Thumb/Video, local bookmark, AI trigger, Snippets, and their menu options are at least 44px in both dimensions or have an equivalent 44px hit wrapper; AI is discoverable without hover.
  Confidence: Verified
  Effort: M

- [ ] P2 — AI and snippet popovers expose menu roles without keyboard menu behavior
  Category: a11y
  Where: `src/features/ai/command-menu.ts:129-171,236-243`; `src/features/composer/composer-snippets.ts:109-150,168-191`
  Problem: Both features create `role="menu"`/`role="menuitem"` popovers, but triggers do not expose `aria-expanded`/`aria-controls`, opening does not move focus into the menu, and dismissal has no Escape/focus-restoration path. A keyboard user can remain on the trigger or tab into the page behind the menu, while screen readers receive incomplete disclosure state.
  Evidence: The only dismissal listeners are deferred document click handlers; there is no focus assignment or keyboard dismissal in either cited `openMenu`/`openPalette` function. The buttons are appended to `document.body`, outside the trigger’s local DOM context.
  Fix: Give each trigger a stable controlled-menu id and expanded state, focus the first menu item on open, support Escape and outside dismissal, restore the trigger focus, and implement the chosen WAI-ARIA menu keyboard model (or use a semantically simpler listbox/popover pattern that matches the actual interaction).
  Acceptance: Keyboard automation opens each popover, exposes the correct accessible relationship/state, reaches every option without entering the page behind it, closes with Escape/outside click, and restores focus to the originating trigger after selection/dismissal.
  Confidence: Verified
  Effort: M

- [ ] P2 — Secondary file/search controls and the thread checkbox have no programmatic labels
  Category: a11y
  Where: `src/ui/control-center.ts:1003-1010,1041-1047,1365-1374,1554-1564`
  Problem: The archive file input, archive search input, semantic search input, and “Crosspost as thread” checkbox are placed beside visual copy in `div` rows without an associated `<label>`, `id/for`, or `aria-label`. Placeholder text and adjacent spans are not a reliable accessible name, so these secondary controls are unnamed or ambiguously named in the accessibility tree.
  Evidence: The cited inputs are created directly and appended with `row.append(copy, input)`/`threadRow.append(copy, checkbox)`, unlike the shared `textInputRow`/`textareaRow` helpers that explicitly set `aria-label`. The external smoke test locates them by visual row text, which does not validate screen-reader naming.
  Fix: Give each control a localized stable label and explicit association (`label`/`for` or `aria-labelledby`), including a localized name for the thread checkbox; preserve the existing visual copy and focus behavior.
  Acceptance: Accessibility-tree assertions report localized names “Import official X archive”, “Search captured records”, “Semantic search”, and “Crosspost as thread” for the corresponding controls in all nine locales, with no unnamed form control in those rows.
  Confidence: Verified
  Effort: S

- [ ] P2 — RTL toasts and injected action spacing use physical left/right properties
  Category: visual
  Where: `src/features/core/feature-toast.ts:97-126`; `src/features/filtering/hidden-posts-feature.ts:479-484,531-550`
  Problem: In Arabic/Hebrew, both toast components stay at physical `right: 16px` instead of the inline-end side, and the feature-error accent remains a physical `border-left`; the Hide button also uses physical `margin-right`. This makes toast placement, accent direction, and action spacing disagree with the RTL Control Center/page direction, even though the i18n feature sets RTL correctly elsewhere.
  Evidence: `tests/smoke/aviary.smoke.mjs:520-530` verifies only document/primary-column direction and never opens either toast. The cited shadow styles hard-code the physical properties, and shadow hosts do not rewrite them through page-level direction CSS.
  Fix: Replace physical placement/borders/margins with logical properties (`inset-inline-end`, `border-inline-start`, `margin-inline-end`) and ensure the shadow host inherits/receives the active direction. Recheck both toast stacks and undo-button ordering in RTL and LTR.
  Acceptance: Headless RTL computed-style/layout assertions place both toasts at inline-end, put the error accent on inline-start, and keep Hide/Undo spacing and reading order correct; LTR remains unchanged across all themes.
  Confidence: Verified
  Effort: S

- [ ] P3 — The Control Center is a 4,000+ line god module with duplicated section wiring
  Category: maintainability
  Where: `src/ui/control-center.ts:241-2781,488-2602,2960-3318`
  Problem: Mounting, modal state, search/focus restoration, localization accounting, all 13 section renderers, every async action, status/error handling, and shared form helpers live in one closure/file. This boundary makes it easy for new secondary rows to bypass `t()`, the action rejection wrapper, or the accessibility contract—as the current findings demonstrate—and makes independent review/testing of a section unnecessarily risky.
  Evidence: The file contains the single `mountControlCenter()` orchestration plus section builders from Appearance through Trust and all helper implementations; it is roughly 4,275 lines. The raw secondary strings and custom Aria2 handler are in the same module but bypass the shared helpers that already solve those problems elsewhere.
  Fix: Keep one small mount/orchestration layer and extract section builders/actions into `src/ui/control-center/sections/` with a typed `PanelContext` exposing translator, status, error, focus, and save helpers. Centralize modal/a11y and async-action contracts, and add section-level tests before moving code.
  Acceptance: `control-center.ts` contains only orchestration/shared contracts, each section compiles and has focused tests, `npm run verify` remains green, and a static review can prove every new row uses the shared translation/error/accessibility helpers without behavior changes.
  Confidence: Verified
  Effort: L

- [ ] P3 — Release verification has no lint/static-analysis stage
  Category: testing
  Where: `package.json:11-17`; `.github/workflows/smoke.yml:20-47`
  Problem: The repository has no `lint` script or linter configuration, and `npm run verify` runs only TypeScript checking, tests, build, and preflight regex contracts. Type errors and source-policy violations are covered, but unused/dead code, unsafe complexity, accessibility anti-patterns, and maintainability regressions can pass the release gate.
  Evidence: `package.json` lists `build`, `preflight`, `test`, `typecheck`, `smoke`, and `verify` only; the workflow runs build/smoke but no lint/static analysis. The current baseline is green (`npm run verify` and `npm run smoke`), so this is a coverage gap rather than a pre-existing failure.
  Fix: Adopt a pinned, repository-appropriate linter/static-analysis configuration, add a deterministic `npm run lint`, include it in `verify` and CI, and tune rules for the browser/userscript/shadow-DOM constraints instead of relying on broad regex checks.
  Acceptance: `npm run lint` exists, runs without modifying files, reports actionable diagnostics, is part of `npm run verify` and CI, and the current source passes it.
  Confidence: Verified
  Effort: M

- [ ] P3 — Expand the release test matrix to cover unaudited live and secondary environments
  Category: testing
  Where: `tests/smoke/aviary.smoke.mjs:161-166,222-249`; `tests/smoke/externally-gated.smoke.mjs:528-755`; `tests/audit-ui.test.mjs`; `tests/audit-a11y.test.mjs`; `package.json:14-17`
  Problem: The green smoke suite covers Home, Home/Following query state, one profile root, Search, one status route, page-hook combinations, current-X fixture controls, and local provider stubs. It does not exercise profile followers/following/verified-followers subroutes, Notifications, Messages, the media viewer, real composer insertion/crosspost attachment, the options grant/revoke flow with a granted permission, malicious/oversized archives, bridge spoofing, boot/destroy/boot, all secondary locales, all nested surfaces in every theme, or real authenticated X markup/browser variants. The audit therefore cannot claim release coverage for those areas.
  Evidence: The route list and external flow are explicit in the cited smoke files; the UI tests mostly inspect source/tokens and the closed dialog, and `npm run verify`/`npm run smoke` currently pass with no baseline failures. Real authenticated X, Firefox/Safari, screen-reader, Tampermonkey/Violentmonkey, and successful permission-grant environments were not available for this pass and remain unaudited.
  Fix: Add headless fixture routes and focused tests for every listed state: route/surface transitions, all nine locales and six theme modes with nested toasts/popovers/dialogs, coarse-pointer geometry, modal/menu keyboard behavior, malformed storage/provider responses, Unicode caps, ZIP expansion limits, subscription lifecycle, and options permission success/revoke. Keep a separate externally gated matrix for authenticated/browser-manager/provider differences and document any credential-gated blockers.
  Acceptance: CI publishes a deterministic matrix covering each listed route, state, locale/theme, keyboard/coarse-pointer mode, malformed input, and lifecycle scenario; the missing real-auth/browser-manager lanes are explicitly marked blocked with a reproducible manual/headless procedure rather than silently omitted.
  Confidence: Verified
  Effort: L

- [ ] P2 — Unify archive, bookmark, notes, and semantic search behind one offline query model
  Why: Users must search different surfaces separately even though Aviary presents one local library; lexical search indexes only checkpoint `ExportRecord` values while bookmarks and semantic vectors have separate stores and substring/query behavior.
  Evidence: Verified in `src/features/library/local-search.ts:14-85`, `src/features/core/control-center.ts:650-664`, `src/features/library/bookmarks-feature.ts`, and `src/features/integrations/semantic-search.ts:48-147`. [xf](https://github.com/Dicklesworthstone/xf) demonstrates hybrid lexical/vector filtering, while [Raindrop’s filters](https://help.raindrop.io/filters) and [Dewey](https://getdewey.co/) demonstrate tags, folders, notes, and collection filters.
  Touches: shared indexed domain/search types; bookmark/archive/snapshot adapters; semantic provider adapter; Control Center search UI and saved queries; locale/accessibility strings; Unicode and ranking tests.
  Acceptance: One search surface can query posts, likes, bookmarks, notes, tags, folders, and snapshot metadata with documented date/type/media/account filters; lexical results work with no network or API key; semantic ranking is optional and clearly marked; every result identifies its source collection and account; empty, Unicode, long-query, and malformed-filter cases are deterministic.
  Complexity: L

- [ ] P2 — Make exported archives truthful about captured assets and provide a self-contained package
  Why: Current HTML and WARC outputs can look archival while media entries remain live URLs or explanatory metadata rather than captured bytes, so offline use and evidentiary completeness are ambiguous.
  Evidence: Verified in `src/features/export/formatters.ts` (media/permalink links remain HTTP(S)) and `src/features/export/warc.ts:26-40` (media bodies say they were not re-downloaded); compare the [WARC specification](https://iipc.github.io/warc-specifications/) and [archival capture guidance](https://www.archives.gov/records-mgmt/resources/socialmediacapture.pdf).
  Touches: `src/features/export/types.ts`; HTML/JSON/WARC formatters; media downloader integration; package manifest/checksum generation; export UI copy; offline/network-blocked tests.
  Acceptance: Every record/media entry declares `captured-bytes`, `remote-reference`, or `missing` status, source URL, capture time, and byte length/checksum when available; WARC response/resource records contain actual bytes or are explicitly metadata-only; no generated “offline” package silently fetches X at open time; interrupted media capture leaves a truthful manifest and retryable items.
  Complexity: L

- [ ] P2 — Ship a responsive standalone archive viewer for exported packages
  Why: The current Control Center is tied to an X page and the export formats do not provide a usable large-library viewer, leaving users without an offline/mobile recovery path when X is unavailable.
  Evidence: Verified in `src/features/export/export-feature.ts:141-191` and the current formatter/ZIP path: exports are data files, not a bundled viewer. [xarchive](https://github.com/sytelus/xarchive) provides a local viewer with IndexedDB/large-list behavior, while [ArchiveBox](https://github.com/archivebox/archivebox) demonstrates replay/status-oriented archives.
  Touches: export package builder; new viewer assets/modules; archive manifest and search API; responsive CSS/touch semantics; viewer security policy; package/opening tests.
  Acceptance: An exported package opens from a local file or extension page without X access or remote script execution, renders at a 320 px viewport, supports search/filter/sort/thread/media-status views, handles a large fixture without rendering every row at once, preserves RTL/localized labels, and clearly marks missing or remote-only media.
  Complexity: L

- [ ] P2 — Add a versioned full-library backup/restore flow with dry-run and rollback
  Why: Settings import/export is not a backup of bookmarks, snapshots, jobs, records, indexes, or notes; raw JSON external targets are one-way record exports and do not preserve the installation’s local library.
  Evidence: Verified in `src/features/core/settings-migration.ts` (settings envelope only), the independent store keys cited above, and `src/features/export/external-targets.ts` (record-oriented targets). User demand for ownership and bookmark recovery is visible in [DataHoarder’s export discussion](https://www.reddit.com/r/DataHoarder/comments/1iga2wd/how_do_i_download_all_my_twitter_bookmarks/) and [HN’s local archive discussion](https://news.ycombinator.com/item?id=46529797).
  Touches: repository serializer/importer; profile and schema manifest; Control Center backup/restore UI; secret redaction; transaction/rollback layer; migration and corruption tests.
  Acceptance: One user-selected backup contains versioned manifests and all selected local collections, excludes credentials by default, previews versions/counts/conflicts before mutation, supports dry-run and cancellation, validates checksums, and restores transactionally with rollback on any collection failure; legacy settings import remains compatible.
  Complexity: L

- [ ] P2 — Give AI and embedding integrations an explicit data-disclosure and usage budget
  Why: Opt-in network policy prevents accidental calls, but users are not shown exactly what text leaves the browser or given a durable cost/volume boundary when auto-indexing runs on every export.
  Evidence: Verified in `src/features/integrations/ai-provider.ts` (full system/user prompt sent to the configured endpoint) and `src/features/integrations/semantic-search.ts:78-127,178-209` (one embedding request per record); the README’s local-first promise makes destination transparency part of the trust contract. [BrowserOS](https://github.com/browseros-ai/BrowserOS) and commercial bookmark tools show the ecosystem’s movement toward explicit local/provider choices.
  Touches: integration settings and network policy; AI/semantic request builders; Control Center consent/preview/usage UI; audit-log redaction; provider, timeout, and budget tests.
  Acceptance: Before the first external request and before enabling auto-index, the UI shows provider/endpoint, fields and character/token count, retained data, and network status; configurable per-request/daily record-byte limits stop further calls with a recoverable status; usage history never stores API keys or raw prompts by default; disabled/local-only modes make zero provider requests.
  Complexity: M
