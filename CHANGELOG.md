# Changelog

## 1.8.0 - 2026-08-06

Drains the audit findings left open by the v1.7.0 pass.

### Added

- **The Control Center is actually localized.** All nine locales are complete: every one of the
  310 panel strings — labels, descriptions, select options, buttons, toasts and error copy — is
  translated for Spanish, Portuguese, French, German, Japanese, Korean, Arabic and Hebrew, with
  English as the source. The catalog is gettext-style, keyed on the English string itself, so
  editing a label can never leave a stale translation attached to it: the edited string simply
  misses the catalog and falls back to English, which is visible rather than silently wrong.
  Arabic and Hebrew also flip the panel to right-to-left.
- **An honest coverage readout.** The Trust section reports the translation coverage measured
  from the render that just happened, not from a hand-kept list, so a row added tomorrow without
  a catalog entry lowers the number immediately. Runtime data (counts, timestamps, endpoint
  summaries) and locale endonyms no longer pass through the translator, so they cannot make a
  finished locale look incomplete.
- **`tools/i18n-extract.mjs`** regenerates the string manifest by mounting the panel in a real
  browser and recording what it renders. It renders twice with different stub data and drops
  anything that changes, which separates copy from interpolated values without a hand-maintained
  exclusion list. `tests/i18n.test.mjs` fails the build if any locale falls behind the manifest,
  if a locale echoes English back, or if the row helpers stop routing copy through the translator.
- **Hide row borders** (`appearance.hideBorders`) now does something. The divider is drawn on the
  first child of X's virtualizer cell by a generated atomic class, so the rule anchors on
  `[data-testid="cellInnerDiv"] > div` instead of the class name, and also drops the primary
  column's side rules. Verified against `_decoded/home.html` with its captured stylesheets:
  10/10 rows go 1px → 0px and back on destroy.
- **Writer mode** (`layout.writerMode`) now does something. While focus is inside the composer the
  sidebar and the timeline behind it fade back; everything returns on blur. Driven by
  `focusin`/`focusout` only — no key handlers, and hovering a faded row brings it back.
  Quiet Reader and Minimal turn borders off again; Creator turns writer mode on.
- **Extension options page.** A dark, self-contained page (toolbar icon, or Extensions → Aviary →
  Options) reports the live grant state of the optional `downloads` permission and the
  `pbs.twimg.com` / `video.twimg.com` media hosts, and grants or revokes either. This is the
  surface `chrome.permissions.request` needs — it only resolves from a user gesture on an
  extension page, which a content script is not. Preflight fails the build if the page is missing,
  declares inline script, or is dropped from a manifest.

- **Every failed write is reported, not just three stores'.** The storage gateway now notifies a
  diagnostics sink before rethrowing, so the nine call sites that deliberately wrap `set()` in an
  empty `catch` keep working while their failures stop being invisible — `CheckpointStore`,
  bookmarks, the cleanup queue, the semantic index, the Aria2 history and query discovery
  included. Any store added later gets this without plumbing a sink through its constructor.
- **Failed writes are no longer silent.** `MediaHistory`, `AuditLog` and the hidden-post store
  swallowed every persistence error, so a full browser store degraded to "changes stop sticking" —
  indistinguishable from a bug. All three now take a persistence-error sink wired to diagnostics,
  and the Trust section carries a **Saving** row that reads "Working — every change has been
  written." or names the failure and its count. Writes stay best-effort: a failed write still
  resolves rather than throwing into the caller.

- **`jobs.rateLimitMode` now paces a batch instead of only resizing a bucket.** `ctx.limiter` was
  built in `main.ts` and handed to every feature, and no feature ever drew from it. The media
  batch — the one path that fires hundreds of requests at X's media hosts back to back — now
  takes a token per download. The mode sets both the burst and the sustained rate (conservative
  4/1s, standard 8/4s); the old fixed 0.5/s refill would have made a 200-item batch look hung.
- **`waitForToken` no longer hangs on an impossible request.** Asking for more tokens than the
  bucket's capacity could never be satisfied, because refill clamps at capacity — it spun
  silently forever. It now throws `RangeError`.
- **`privacy.auditLog` does something.** The toggle normalized and round-tripped while nothing
  read it, so turning the local action log off left it recording exactly as before. `AuditLog`
  now checks it on every write, and Backup & Audit carries the toggle that was missing.

- **`media.zipChunkSize` splits long exports.** The setting normalized and round-tripped while
  the ZIP writer never split anything, so a long profile scrape produced one archive of whatever
  size it happened to be. An export now yields one ZIP per chunk (`-part1of3` naming), a run that
  fits keeps its plain single-file name, and Export gained the **Records per ZIP** control the
  setting never had. `tools/i18n-sync.mjs` folds new translations into the catalog and refuses to
  write one that is missing strings.

- **`links.cleanShareButtons` strips tracking from links.** Quiet Reader, Researcher and Minimal
  all set it, so applying any of them claimed a change that never happened. A new reversible
  feature removes share tokens and campaign parameters (`utm_*`, `fbclid`, and X's own `t`/`s`)
  from timeline links, with a **Clean tracking from links** toggle in Library. `t`/`s` are only
  stripped on X hosts — they are ordinary parameter names elsewhere, and removing them would
  break real links. `t.co` URLs are left alone because their path *is* the identifier. Verified
  in Chromium: late-arriving rows are cleaned too, and destroy restores every original href.

- **`privacy.localOnly` is a real switch.** It defaulted to `true` while every integration made
  network requests, so the setting and the behaviour disagreed about what the product promised.
  It now gates the outbound path of Aria2, Bluesky, Mastodon, the AI provider and embeddings, and
  Trust carries a **Local-only mode** toggle. The guard sits at each integration's entry point
  rather than at each `fetch`, so a blocked call fails once, before any credential is attached.
  Upgrading with a configured integration clears the flag — enabling an integration was already
  the opt-in, and silently breaking a working setup would be worse than the inconsistency.

- **Non-ASCII paths survive extraction.** The ZIP writer emitted UTF-8 filename bytes without
  setting general-purpose bit 11, so a conforming extractor had to read them as CP437: a save
  folder named `Recherché-アーカイブ` unzipped as `Recherch├⌐-πéóπâ╝πé½πéñπâû`. Reproduced with
  Python's `zipfile` and fixed by flagging the encoding in both the local and central headers;
  the same extractor now round-trips the name exactly, with CRCs intact. (.NET and Explorer
  always guessed UTF-8, which is why this was invisible on Windows.)
- **The ZIP writer fails loudly at its 32-bit ceilings.** Entry counts, entry sizes, name lengths
  and the central-directory offset are written with `setUint16`/`setUint32`, which truncate
  silently — past those limits the archive was still produced and simply unzipped to the wrong
  thing. Each now throws a `RangeError` naming the limit rather than emitting a corrupt file.

- **A CRLF in a scraped value can no longer corrupt a WARC.** `WARC-Target-URI` and
  `Content-Type` were interpolated unsanitised, and WARC headers are CRLF-delimited — so a
  newline in a permalink or media URL injected arbitrary headers (a forged `WARC-Type` among
  them) and, once the injected text was read as a record boundary, `warcio` raised
  `ArchiveLoadFailed` and every later record was lost. Reachable because `library/archive-import.ts`
  feeds records straight from a downloaded X archive, where a field can hold anything. C0
  controls are now stripped from header values, and a record with no target or mime still emits
  both fields. Verified with `warcio`: all records parse, no header is injected, and every
  `Content-Length` matches its body bytes.

- **The Control Center is navigable.** It rendered all twelve sections into a single 386px
  column: 144 controls and roughly **nineteen screens of scrolling**, with no way to jump and no
  search. It now has a grouped nav rail (Start / Reading / Data / Advanced) and builds only the
  section being viewed — the same panel opens at **one screen** instead of nineteen, and the
  panel widened to 780px so descriptions stop wrapping to four lines.
- **Settings search.** Specified in the original F002 and never built. Typing filters rows across
  every section at once, grouped under the section each match came from, with an empty state that
  points back at the rail. Matching runs against the rendered row text, so a row added later is
  searchable the moment it exists and a label edit cannot drift from a keyword list. The field
  sits in the panel chrome rather than the re-rendered body, so typing keeps its caret.
- **Below 760px the rail becomes a horizontal chip strip**, keeping every section one tap away
  instead of behind a menu, with 44px targets.
- **The panel chrome now follows the locale.** The search placeholder and the status line were
  built once at mount and never repainted, so they stayed English in every other language — and
  because `render()` resets the coverage tally, mount-only strings never reached the catalog at
  all. Both now repaint per render and are translated in all nine locales.

### Decided

- **No Escape-to-close handler.** The open question was whether standard dialog dismissal should
  be an exception to the no-keyboard-handlers rule. It should not: the panel is non-modal, and
  the keyboard path is already complete without one — the launcher is reachable in two Tabs,
  Enter opens the panel, Close is the *first* tab stop inside it, and activating it returns focus
  to the launcher. Escape would add a global key listener (which `tools/preflight.mjs` and
  `tests/source-contracts.test.mjs` both reject) to duplicate a control that is already one Tab
  away. Verified in Chromium.

### Fixed

- **Saving a setting no longer throws focus away.** `save()` rebuilds every row, so focus landed
  back on the document each time. Rows now carry an identity derived from their section title and
  label rather than a node reference, and a render restores focus, the text caret and the panel's
  scroll position. Verified in Chromium: before the fix `shadow.activeElement` was `null` after a
  toggle; after it, focus is back on the same (rebuilt) control.
- **Media downloads no longer report success when nothing was saved.** In the MV3 build without
  the `downloads` permission the background returned an error, the downloader fell back to an
  anchor click, and the browser ignored `download` for cross-origin `pbs.twimg.com` URLs and
  navigated — while the button said "Saved". The background now distinguishes a missing permission
  from a real failure, the downloader throws instead of falling through, the button reads "Allow"
  and opens the grant page once per session, and a batch stops at the first permission error rather
  than repeating it hundreds of times. A cross-origin anchor fallback now reports "Opened".

Full engineering, security, UX, accessibility and theming audit. Findings left open are
listed at the end of ROADMAP.md.

### Fixed — correctness

- Mutation batches are coalesced into one delivery per 120ms window. Every feature previously
  re-scanned, and the Control Center re-rendered, on each individual batch; five ordinary page
  mutations produced five full panel rebuilds, destroying half-typed input and moving focus.
- The Control Center defers rebuilds requested while it is closed or while a field is focused,
  and repaints when it is safe.
- The Control Center is registered last so its first paint reads stores that have finished
  loading, instead of reporting zeroes.
- The media batch downloader ignored `jobs.concurrentDownloads` whenever it hit the item cap.
- "Prefer original quality" was wired to nothing; image URLs were always rewritten to
  `name=orig`. It now applies to both download paths.
- Exporting a view with nothing captured no longer builds and downloads an empty ZIP.
- Network capture cloned every response before checking whether it was capturable, teeing
  video segment streams it never read, and restored `fetch` even when another script had
  wrapped it afterwards.
- Link unshortening left its class and rewritten title behind on teardown.
- XLSX export stripped no XML-illegal control characters, producing workbooks Excel rejects.

### Fixed — security and data safety

- CSV export escapes leading `=`, `+`, `-` and `@` so attacker-controlled post text cannot
  execute as a formula when the export is opened in a spreadsheet.
- Settings export redacts the Aria2 secret, Bluesky app password, Mastodon token and both API
  keys; importing a redacted file keeps the values already stored locally. A full export is
  available behind an explicit opt-in.
- Credential fields render masked with an explicit Show/Hide toggle instead of plain text.
- HTML export drops non-http(s) hrefs rather than writing them into a file opened from disk.
- Captured GraphQL payloads also scrub `auth_token`, `guest_id` and `csrf_token`.

### Fixed — accessibility

- The closed panel is inert; all 137 of its controls were previously focusable inside an
  `aria-hidden` container, so keyboard users tabbed into an invisible settings panel.
- The default dim theme rendered every row description, section title and the status line at
  3.96:1. Its muted token now measures 5.26:1, clearing the 4.5:1 AA floor.
- Touch targets in the panel meet 44px. The touch and viewport rules were being written into
  `document.head`, where they could not reach the panel's shadow root at all.
- "Reduced motion" gained a control — the setting previously had no UI — and now reaches the
  panel and toast, which a page-level class cannot style across a shadow boundary.
- The per-post Hide control rests at a legible opacity instead of 1.56:1, and is fully opaque
  on devices with no hover.
- Engagement counts can be hidden without hiding the buttons; their aria-labels still carry
  the totals.

### Fixed — UX and visual

- Settings rows drew a 1.4:1 border, effectively invisible; now 2.3-2.6:1 in every theme.
- The launcher gradient followed X blue in all five themes; it follows the theme accent.
- The toast used hardcoded colours and looked foreign outside the dim theme.
- The panel's browser-default white focus halo is drawn in the theme accent.
- Long operations (export, media batch, WARC, report, semantic index, archive import) announce
  themselves instead of appearing frozen.
- Archive search is debounced and no longer re-tokenizes every captured record on each
  keystroke that matches nothing. Empty and no-match states say something useful.
- Copy corrected where it described shipped features as unavailable ("xlsx is deferred", "off
  until F091 lands"), told users to press a button that does not exist on that row, or
  reported "(1 warning(s))" without showing the warning.
- Presets no longer report changes they cannot deliver: `hideCounts` is implemented, while
  `hideBorders` and `writerMode` are removed from presets and tracked in ROADMAP.md.
- The locale selector states what it currently does, since the panel is not yet localized.
- docs/PRIVACY.md lists every storage key and corrects the claim that no passwords are stored.

## 1.6.0 - 2026-08-06

- Added a per-post Hide control that remembers the post locally and keeps it collapsed on every later visit, so the next post is promoted instead of leaving a gap.
- Added the `aviary.hiddenPosts.v1` store with status-id keys, a handle+text signature fallback for posts without a `/status/` link, oldest-first eviction at a configurable cap, and a 20-deep session undo stack.
- Added an undo toast after each hide, plus Control Center "Undo last hide", per-post Restore for the eight most recent hides, and "Clear hidden posts".
- Added the Control Center "Hidden posts" section: master switch, per-post button toggle, per-route activation chips, and the remembered-post cap.
- Added `post.hide`, `post.unhide`, and `post.hide.cleared` audit actions.

## 1.5.0 - 2026-08-03

- Added opt-in CheckpointStore retention controls for maximum jobs, records per job, and job age, with boot-time and new-job sweeps.
- Added persisted Aria2 gid history and cross-session duplicate suppression, including completion/error reconciliation through `aria2.tellStatus`.
- Added explicit Bluesky image upload and Mastodon media upload for the last successful Aviary download, including first-post-only thread attachment.
- Added the default-off “Attach last download” Control Center toggle.
- Added pinned Playwright 1.62.1 smoke CI with cached browser binaries and isolated Xvfb execution; local smoke profiles are temporary and cleaned up.
- Kept F032/F033 blocked pending authenticated `_decoded/` fixtures.
