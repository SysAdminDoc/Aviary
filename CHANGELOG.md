# Changelog

## 1.8.0 - 2026-08-06

Drains the audit findings left open by the v1.7.0 pass.

### Added

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
