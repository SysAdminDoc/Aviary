# Changelog

## Unreleased

### Security
- **Seeded parser fuzzing.** Custom CSS and regex boundaries now run deterministic 10,000-case
  mutation corpora. CSS output is checked for network hooks and selector escape in the fallback
  scoper, while accepted regexes run a long sentinel corpus in a time-bounded worker. Reduced cases
  remain permanent fixtures so later parser changes cannot reopen a bypass.
- **Accessibility coverage now follows the shipped surfaces.** A canonical 14-section manifest
  drives the Control Center axe sweep across dark, light, narrow, and forced-colors fixtures. The
  extension options page, media download terminal states, and standalone archive viewer are in the
  same serious-violation gate.
- Diagnostic persistence now keeps only stable authored message ids, severity, ISO timestamps, and
  detail-key names. Legacy message and reason values migrate out, AI provider failures no longer
  attach provider text, and the Options page can copy a merged redacted report with the bounded
  background-worker ring.
- Storage locks now carry a commit fence. The extension background rejects stale owner generations
  at the mutation boundary, and userscript managers retain immutable fenced operations so a paused
  callback cannot overwrite a newer accepted value after expiry or restart.
- Legacy database migration now takes a final snapshot after sealing and verifies that snapshot in
  the background before deleting the source database. A late write is copied on the same pass, and a
  blocked or failed seal leaves the source available for retry.
- Fallback writes now carry durable operation receipts and per-key ordering. A retry after a value
  commit, cleanup failure, or restart consumes its marker without replaying an older set or remove
  over a newer value, and removals retain a tombstone for the same proof. Tombstones are visible to
  reads, legacy journal entries cannot outrank a real receipt, and direct backend writes always carry
  a receipt.
- Extension settings, queues, notes, archives, and signing identity now live in one
  background-owned IndexedDB database. X pages can no longer enumerate Aviary's active database,
  and the options page reads the same active profile as the feed.
- Updates copy the database left by older content scripts, compare SHA-256 receipts for every
  value, and discover inactive-profile records instead of relying on a fixed key list. If an old
  tab blocks cleanup, a version seal retains its later writes for one final verified copy rather
  than blocking Aviary startup or deleting them.

### Fixed
- Adaptive video saves now keep the direct progressive MP4 as the default and expose an optional,
  authenticated loopback yt-dlp handoff when Aviary has already observed a higher-quality X
  manifest. The helper accepts only the manifest, filename, and fixed `bv*+ba/b` policy, reports
  missing/refused/running/completed/failed states, and never receives X cookies or bearer tokens.
- Packaged Chrome and Firefox smoke now exercise the built extension's real storage across a
  background restart. Chrome also freezes a page holder past lease expiry and proves a newer
  fenced write survives the stale owner's resume; missing browsers or lifecycle controls fail the
  lane instead of falling back to a simulated store.
- The smoke suite now installs provenance-checked Tampermonkey 5.5.0 and Violentmonkey 2.47.0
  packages into disposable profiles, saves the built userscript through each manager's editor,
  and drives real GM storage from two synthetic X origins. It verifies value-change callbacks,
  lock contention, interrupted restore recovery, stale fences, and durable values after restart.
  The older browser lanes are named model adapters so their Map-backed coverage is not mistaken for
  manager installation coverage.
- Persisted storage status now survives the extension background bridge. The Advanced readout can
  distinguish an eviction exemption, best-effort storage, and a browser that did not answer instead
  of showing an unknown state after a content reload or worker restart.
- Trust now attributes serialized mutation apply work to each feature with bounded local timing
  samples, full or incremental pass counts, and maximum duration. Long Animation Frame timing is
  correlated when the browser exposes it, and unsupported browsers say so. The reset action clears
  the aggregate immediately; copied diagnostics include only safe feature ids and durations.
- Export records now keep canonical BCP 47 post language from DOM, GraphQL, and archive inputs.
  JSON and CSV carry the value, Markdown writes it in frontmatter, and HTML, replay pages, and the
  offline viewer isolate each post with its own language and automatic direction. Invalid tags and
  legacy records become null instead of reaching markup, including in offline search metadata.
- Share-oriented builders now apply the same fail-closed audience default even when called directly.
  Viewer, WARC, WACZ, and external Markdown targets cannot emit protected or unknown rows without
  an explicit selection. Staged archive reads also stop at the pause callback, and seen-post dwell
  accepts 200 visible CSS pixels for any post rather than only posts taller than the viewport.
- AI command hints now use unique hidden DOM descriptions referenced with `aria-describedby`. The
  menu keeps its compact visible labels, exposes the hint to assistive technology, and removes every
  description with the menu during light-dismiss and teardown.
- Local search now uses feature-detected `Intl.Segmenter` word boundaries for Thai, Lao, Khmer, and
  Myanmar. The deterministic bigram tokenizer remains the fallback, and the versioned index builder
  can resume a current build after interruption while restarting safely for an older schema.
- Large X archive imports now stage a File in fixed 3 MiB base64 chunks. Extension chunks stay in
  the background-owned durable store, userscript values stay under manager limits, and the ZIP
  reader consumes bounded source ranges instead of decoding a second full archive. Paused,
  cancelled, failed, resumed, and completed jobs retain or release their chunks deliberately.
- Export records now carry an audience state from GraphQL when X provides one. DOM-only, imported,
  and legacy rows remain `unknown`; share-oriented HTML, Markdown, WARC, WACZ, viewer, and external
  exports exclude protected and unknown rows until their explicit controls are enabled, while JSON
  and CSV retain every row with the audience field for archival use.
- Seen-post dimming now waits for a visible, one-second dwell before recording a timeline post. It
  accepts half a post or 200 visible CSS pixels, cancels work when a node leaves the
  viewport or the tab is hidden, keeps candidates independent, and treats a direct Status route's
  focal post as immediately seen.
- Passive request boundaries are now exercised directly: page-world capture stays idle until X
  makes the request, reports only bounded response fields, and keeps account-risk language clear
  about X-triggered navigation and the limits of any safety claim.
- OpenAI-compatible AI requests now negotiate `max_completion_tokens` and `max_tokens` once per
  endpoint, reserve bytes for the longer request shape, retry a supported parameter without
  double-charging the local usage budget, and show a bounded provider reason when neither parameter
  is accepted.
- Historical local releases now use the strongest verification script available at the target commit
  instead of assuming newer `verify:release` exists. Their phase state is read before rebuilding, so a
  network retry reuses verified artifacts and resumes tagging or upload without repacking.
- The large-library release corpus now includes deterministic unknown media kinds and asserts that the
  normalization matrix reports them.
- Refreshed the reviewed desktop visual baselines for the current media and material-state
  renders. The publication gate now measures the same seven screenshots produced by the shipped
  renderer instead of rejecting a stale capture set.
- Native media context-menu messages now carry and validate the X document URL, exact message
  fields, and the extension sender before the page starts a download. The background refuses to
  forward a non-X page, and Trusted Types policy and fallback behavior are covered explicitly.
- Selector health now reports required surface breaks beside the page. A missing post action bar
  marks the launcher without blocking X, opens Trust to the affected surface and owning feature,
  clears when the surface returns or its owning feature is turned off, and offers a content-free
  build and route report for issues. Turning selector diagnostics off also removes the live warning
  and refreshes Trust immediately.
- The local library is no longer treated as disposable browser cache. Both extension packages
  declare `unlimitedStorage`, and the background asks the browser once per session not to evict
  Aviary's database. Trust now says whether the library is kept or best effort, beside the usage
  and quota figures it already showed, and says plainly that best-effort storage can be cleared.
  For the userscript, retention belongs to the manager, so Trust reports it as unknown rather than
  implying a guarantee.
- Shared storage writes no longer contend for the exclusive restore fence, so opening the Control
  Center while another tab is saving cannot reject an archive import. Local-only mode also stays
  live for integrations loaded from the separate panel chunk.
- Minimal now has an independent **Hide For You tab** control. On Home it selects Following and
  collapses only the first tab by position, leaves other route tablists alone, reports a short Home
  strip to Trust, and restores the original tab styles immediately when disabled.
- Lock polling now reads a background-owned per-lock roster key instead of deserializing the whole
  extension storage area. The manager path uses the same bounded roster shape, and concurrent roster
  updates retain every contender. Browser timing fixtures label the shared-map model separately from
  extension and manager lanes.

### Added
- **Dated selector evidence.** Aviary now keeps a checked-in comparison of its selector registry
  against browsertrix-behaviors 0.13.1 and twitter-web-exporter 1.4.3-beta.1. The comparison records
  disagreements and licenses, while structural fallbacks for plain tweets and profile photo media
  are proved by fixtures rather than copied from upstream code.
- **Atomic local releases.** `npm run release:local -- --plan` reports missing release versions
  against their exact package commits. The explicit `--publish` path requires a clean tree, runs
  the full release gate, rebuilds ZIP assets, signs and verifies a secondary CRX3, writes checksums
  and a release manifest, checks package-lock, manifests, and public version markers for alignment,
  pushes one tag, and resumes from a machine-local phase file after a network failure. Historical
  versions are rebuilt and verified in temporary worktrees before publication.
- **Artifact-matched release gate.** `npm run verify:fast` gives quick local feedback, while
  `npm run verify:release` adds visual, reflow, and every browser smoke lane before publication.
  Builds carry source fingerprints and per-file digests, stale or modified bundles are rejected, and
  failed release runs remove `dist/` instead of leaving an installable partial build behind.
- **Stable compiler split.** Typechecking now runs the stable TypeScript 7.0.2 `tsc` package, while
  typescript-eslint keeps the published `@typescript/typescript6` 6.0.2 API alias. The nightly
  native preview compiler is no longer installed.
- **WACZ proof interop is explicit.** The preservation panel now calls its signature an
  **Aviary-only WACZ proof**, records the proof format, scope, and ECDSA-P384-SHA256 algorithm, and
  explains that it is not Webrecorder `wacz-auth` and cannot be verified by third-party WACZ tools.
- **Lazy extension delivery.** Chromium and Firefox now ship a roughly 0.60 MB document-start
  bundle containing protection, media controls, selector health, and the launcher. The Control
  Center, archive tools, viewer, and catalog load from a named, retryable panel chunk only after
  the launcher is clicked. The panel reads live first-chunk counters across the bundle boundary,
  and the userscript keeps its readable single-file build.
- **Deterministic reviewer source archive.** Every build writes a sorted STORE ZIP with fixed
  timestamps at `dist/aviary-source-v<version>.zip`. `.node-version` pins Node 24.18.1 for a
  reproducible Linux ARM64 build inside the declared package engine range.
- **Validator-clean preservation packages.** WACZ exports now carry CDXJ entries with exact WARC
  offsets and three-digit HTTP statuses, truthful response or resource records for captured media,
  package metadata for direct replay, and separate authored and capture times. The archive is
  cross-checked with py-wacz and a headless ReplayWeb load before release.
- **Suppress hover previews** in Reading, on by default in the Minimal preset. X stops opening a profile card or tooltip when the pointer rests on a name, avatar or control, and native tooltip bubbles are removed and given back exactly when the setting is turned off. Menus you click, visible labels, and screen-reader names are untouched, and nothing listens for the pointer, so a touch-only session costs nothing.
- **Early media replay** keeps a bounded, metadata-only set of direct image and video candidates seen
  while Aviary is opening. The media controls consume it once after storage is ready, so a blob-backed
  X player can still download the already-observed best file without another timeline request.
- **Richer repeated media observations** now merge by exact signed URL. Dimensions, bitrate, codec,
  MIME, and provenance are retained before the best direct video is selected, so a later 1080p
  observation can upgrade an earlier sparse record.
- Media batches now refresh queued video targets after pacing, so a late higher-quality direct URL is
  persisted before its transfer starts. Extracted rendition arrays use stable URL ordering as well.
- **Library backup creation** now counts the complete UTF-8 envelope, including profile metadata,
  checksums, punctuation, and multibyte text, before handing the file to the download layer. A
  multi-profile backup that would exceed the shared 100 MiB parser limit is refused with a clear
  size error.
- **Profile-aware library backups** now use schema 3 for a checksum that covers the profile roster
  and active-profile pointer. Schema 1 and 2 files keep their historical checksum formulas, while
  redacted multi-profile restores preserve destination credentials and profile selection through a
  failed write.
- **Media quality receipts and safe retries.** Completed downloads now record an original, fallback,
  best-direct, or unknown label with bounded dimensions, bitrate, and MIME, never the source URL.
  Transient original-image failures retry `orig` before the fallback ladder, cancellation never
  falls through, and a completed fallback exposes **Retry original** without changing history until
  the replacement file finishes. Legacy history entries migrate to unknown quality, and source-format
  PNG, JPEG, and WebP URLs stay intact when X omits a format query.
- **Localized extension surfaces.** Chrome and Firefox now use browser-native `__MSG_*` manifest
  copy, generated nine-locale `_locales` bundles, and a localized native media context menu. The
  Options page reads shared locale direction metadata, and packaging rejects missing or stale
  message files before a browser smoke run.
- **Large-library release matrix.** A deterministic 50,000-row corpus now covers tombstones,
  malformed rows, duplicate ids, unknown media, and missing bytes through search, backup/restore,
  ZIP, WARC/WACZ, media selection, and both checkpoint restart paths. Chromium measures the fixture
  under a documented 128 MiB heap budget, and WACZ estimates account for retained byte metadata so
  an oversized export refuses before worker allocation.

### Fixed
- Conversation pages no longer show the vertical connector line down a reply's avatar column while an Aviary theme is active. The previous fix removed a line Aviary itself drew; the one readers were seeing is X's own element, found now by its shape and position rather than by a class name X regenerates.
- A full library backup now covers the whole install rather than whichever profile happened to be
  open. It carries every profile's collections, the profile list, and the active-profile pointer,
  so restoring on a new browser no longer silently loses every profile but one. Backups written by
  earlier versions still restore, into the profile being restored into.
- The WACZ signing identity can travel with a backup when credentials are included, and a restore
  that would replace a different saved identity now reports both fingerprints and stops instead of
  swapping it silently. Routine backups still withhold the private key.
- A separate credentialed backup action now makes the sensitive export choice explicit. It states
  that API keys and the WACZ signing identity are included, and the audit record distinguishes that
  export from a redacted backup.

### Changed
- The accessibility suite now covers the three WCAG 2.2 criteria axe cannot check. Every control on
  every destination is focused at two viewport heights and must not end up entirely behind the
  sticky Save row or the destination rail; every interactive target is measured at its activating
  region and must reach 24 by 24 CSS pixels or name the exception that lets it be smaller; and
  nothing in the panel may be operable by dragging alone. No control needed resizing: the small
  checkboxes all sit inside labels that are comfortably larger.
- The six authored themes now survive Windows High Contrast. Every state that spoke only through a
  tint, a shadow or a glow gains a border or an outline in a system colour: the hovered row, the
  selected timeline tab, the active navigation item, the focused search field, the media action
  button, and the cards that separated themselves with a drop shadow. The themes had never been
  checked under forced colours before.
- Video quality, codec evidence and proven playback are now three separate records. The rendition
  ranking reads resolution first and treats a missing bitrate as missing rather than zero, so a
  1080p file no longer loses to a 480p one that happened to declare a bitrate. A codec name is
  stored with the source that declared it and never influences which file is chosen, and the
  optional yt-dlp handoff is recorded as `adaptive-remux` rather than as the file X served, which
  stays available. Media history entries written before this carry no codec claim.
- Selector evidence is now a recorded schema instead of two saved pages. `_decoded/dom-schema.json`
  holds the test ids, roles, aria attributes, nesting, counts and column geometry Aviary depends on,
  with the date they were observed, and the Home and conversation fixtures are generated from it on
  every run. The saved authenticated captures, which carried a real account's handle, display name
  and post bodies, are gone from the working tree, and the freshness gate now ages the observation
  rather than the markup, so regenerating fixtures cannot make stale evidence look current.
- Preflight now fails on an exported name in `src/` that nothing in `src/`, `tests/`, or `tools/`
  refers to. Sixteen abandoned entry points were deleted, the shared restore-lock name moved to the
  module that actually uses it, and the check reports the export count it scanned so a broken walk
  cannot pass by finding nothing.
- Browser support now starts at Chromium 102 and Firefox 140.0. The floor matches the APIs Aviary
  actually declares, keeps Firefox 140.15 covered after its September security fixes, and leaves
  feature detection in place for newer browser APIs.
- Extension ad protection now installs one host-scoped session rule per enabled X tab, conditioned
  by that tab's id. Opposing profile choices no longer race, and navigation, tab close, startup,
  and upgrades remove stale rules. The userscript remains document-local.
- Browser download handoffs now retain terminal results for every waiting consumer. Fast completions
  are reconciled before the response returns, and Resume checks the browser's retained download id
  before retrying, so an in-progress or completed file is never downloaded twice. A quality fallback
  also keeps a bounded terminal receipt under the original report id, even when it finishes before
  the worker answers the query.
- Settings, profiles, media queue, export checkpoints and diagnostics now persist the change made
  inside the storage transaction. Two open X tabs keep non-conflicting additions and updates, and
  a clear cannot be undone by a stale snapshot.
- The userscript now keeps durable records in its manager store and reports an explicit capacity
  error before a single stored value exceeds 16 MiB.
- Writes made during a temporary storage outage now share one locked journal. The background stages
  each latest value or removal, then commits it and clears its marker in one IndexedDB transaction.
  Interrupted work retries after restart without losing another key or reviving an older value.
- Full-library restore and rollback now hold one exclusive storage gate. Ordinary saves wait behind
  it, then continue against the completed result, so an in-progress restore cannot erase a change
  from another open X tab.
- Extension and userscript locks now use manager-owned storage registers shared by x.com,
  twitter.com, and pro.x.com. Restore and fallback-journal coordination no longer splits by page
  origin.
- Media batches now wait for their durable queue checkpoint before reporting a browser transfer as
  running, so restart recovery retains the browser download ID.
- Legacy profile adoption now keeps a per-store hash journal under an install-wide migration lock.
  The destination and source are rechecked while the per-key lock is held before deletion; if a
  source delete is interrupted, the next attempt verifies the matching destination and finishes it.
  Different values are reported as conflicts and are never overwritten. The Control Center
  separates moved, retry-completed, skipped, conflicted, and failed stores.
- Both extension packages now declare `incognito: not_allowed`, so private windows do not receive
  Aviary's content scripts or write its local records. Userscript private-mode persistence still
  follows the manager because browsers expose no standard userscript signal for that mode.
- A userscript manager that grants only part of Aviary's storage API is now refused by name at
  startup instead of quietly falling back to page storage. Aviary lists its own keys to coordinate
  writes across x.com, twitter.com and pro.x.com, so a manager without `GM_listValues` cannot keep
  two tabs consistent.

## 1.47.2 (2026-09-05)

### Fixed
- Conversation replies no longer have a decorative vertical connector beside their avatars.

## 1.47.1 (2026-09-05)

### Fixed
- Wide now fills all space beside X's navigation after removing the discovery rail. It no longer
  stops at a retained wrapper width or a 1440px cap on larger windows.
- Aviary controls no longer attach native hover tooltips. Visible labels and accessible names still
  report each action and changing download state without opening a bubble under the pointer.

## 1.47.0 (2026-08-22)

### Changed
- The Control Center now follows X's light or dark surface when Aviary's theme is off. Its type,
  spacing, navigation and controls use one flatter visual system across all fourteen destinations.
- The permissions page now leads with download access, explains the best-quality path in three
  short steps and includes a direct route back to X. Noir's Wide layout gives media and replies
  more room, and Download is a filled primary action instead of an easy-to-miss outline.
- On narrow feeds, Download now becomes a labeled full-width row below X's post actions. The
  per-asset button stays compact in the media corner, so both save paths remain easy to reach.
- The rest of Aviary received the same cleanup. Catch-up and archive reading now use clearer type
  and flatter surfaces. Focus mode, pagination, reading markers, and composer tools no longer look
  like a separate design system.

## 1.46.0 (2026-08-22)

### Security
- A crafted account archive can no longer break out of an exported note. The Obsidian export
  escaped every frontmatter value except the one inside the tag line, so a handle carrying newlines
  ended the block from within it and turned the rest of the note into real Markdown. A permalink
  carrying a bracket and a parenthesis could also add a second link the author never wrote.

- The save-folder hint can no longer put a `..` path segment into an export ZIP. It stripped only
  the characters Windows forbids, so a traversal survived, and the export side rewrites a backslash
  to a forward slash, which turned a Windows-shaped one into a working POSIX one. The hint travels
  verbatim in a shared settings file and in a library restore, so it was not only self-typed.


- Custom CSS can no longer reach the network or paint outside the surface it was written for.
  The old blocklist looked for the literal text `url(`, but `image-set()` and `cross-fade()` take
  a bare string as a URL, an identifier escape spells `url` without a regex ever seeing it, and
  `src:` and `paint()` load their own resources. An escape anywhere it could build an identifier is
  now refused, the blocklist covers the other four routes, and a newline inside a quoted string
  ends that string the way the CSS parser does, so a payload can no longer hide a real closing
  brace inside one and escape its generated scope block. Escapes inside a quoted string still work,
  because they can only ever produce a character: `content: "92"` and the like keep running.
  If a stored rule is refused after an upgrade, Aviary now says so instead of dropping it in
  silence.

### Fixed
- Opening a profile in an older Aviary no longer deletes what a newer one wrote. The build already
  knew the settings came from a newer schema and only logged it, then wrote its own narrower shape
  on the next save, so changing any single setting after a downgrade discarded everything the newer
  version had added. The stored payload is kept and this build's values are merged onto it.

- A failed WACZ export no longer shows a raw exception beside a success indicator. The status tone
  is chosen from the English message, so a reason like "Quota exceeded" matched none of the words
  that mean failure and rendered green; the export now says what to do and the reason goes to
  diagnostics.
- Counts read properly. "1 error(s)" and "Renewed 1 rules." are gone, and the bisect result no
  longer uses a parenthetical plural that no target language can render.
- The composer snippet palette opens next to its trigger instead of at the top of the screen.

- Themes now reach every colour they should. Six token names were read by a stylesheet and set by
  no palette, so their hard-coded value painted whatever theme was chosen, and the catch-up digest
  ignored the theme entirely, opening as a foreign teal panel over a themed page.
- The account-note badge is readable on X's light mode. It painted a translucent accent wash over
  whatever the page had behind it, which on a light page put near-white text on near-white ground.
- The first-run notice's button no longer puts white on X blue at 3.00:1. It uses the same dark ink
  every other primary button in the panel does.

- Turning Aviary off now takes the catch-up digest and the shared toast with it. The digest's
  stylesheet was never removed, and two features raised the toast without being able to take it
  down, so both could outlive the teardown that was meant to return the page to what X rendered.

- An archive import records when Aviary imported it, not when the post was written. The authored
  time was being written into the capture field, which is what the WARC and WACZ exports publish as
  the capture instant, so a signed archive asserted a moment that never happened. The authored time
  is kept separately and normalized, instead of X's own format leaking into exported columns.
- Cancelling or pausing an archive import says so. A well-formed archive reports no errors, so the
  panel rendered the ordinary completion sentence with zeros in it, which reads as "the archive was
  empty" rather than "your cancel took effect".
- Two settings values are now bounded: the media-type map no longer copies unknown keys through
  without limit, and an endpoint URL is capped in length.

- Typing a space into the settings search no longer builds every section at once. The gate ran on
  the untrimmed query while the match ran on the trimmed one, so a blank query matched every row,
  rebuilt the whole panel on each keystroke, and cleared the rail's current destination.
- The panel's navigation rail and its text areas carry Aviary's own focus ring in ordinary
  rendering. They were listed only in the high-contrast block, so they fell back to the browser's
  ring while every control beside them did not.
- Three settings that state a range now enforce it. Maximum remembered posts, Records per ZIP and
  the Aria2 hand-off threshold accepted any number, confirmed it, and let the next reload quietly
  substitute a different one. An Aria2 threshold of zero meant every download was handed off.
- The Hide navigation items help text names `messages`, which the field has always accepted and
  silently discarded from anyone who guessed a different spelling.
- A failed library search says so. The unified search cleared its results and then awaited a
  provider with nothing catching a rejection, so a failure left an empty pane and no message.

- Every panel action that can fail now says what failed and what to do next, in the reader's own
  language. Pausing an import, cancelling an export, resuming queued downloads and eleven other
  controls all reported the same three words, "Action failed.", while the real reason went only to
  diagnostics.

- A refused filter rule now names which editor its line number belongs to. The panel renders one
  list fed from two textareas, each numbered from its own line 1, so a rejected regex could point
  the reader at an innocent line of the rule box.

- Filtering the catch-up digest no longer throws focus away. Changing the window, the sort, the
  grouping or a category rebuilt the whole dialog, which removed the control being operated, so
  keyboard users were sent back to the top of the modal on every change. The controls stay put now
  and only the list repaints, and the post count is announced when it changes.
- The catch-up digest is translated. It was the last surface still rendering English next to a
  fully translated Control Center, in all eight non-English locales.

- A dimmed post no longer says it was hidden. The reason line always read "Hidden by your rule",
  including on posts that were only dimmed, and the default setting shows a reason on dimmed posts
  only, so out of the box the only posts explaining themselves were the ones being described
  wrongly. Translated into all nine locales.

- A media download's outcome is visible again under an Aviary theme. The theme styled every
  download button and the feature styled its own success, failure, duplicate and opened states at
  exactly the same weight, so which one painted came down to stylesheet order: with any theme
  selected, a finished download and a failed one both looked like a button nobody had touched.
- Secondary text in the Control Center is readable in the default configuration. Twenty-four places
  still fell back to X's own grey, which measures 4.07:1 on the panel and had already been replaced
  in the theme tokens for that reason. They now use the corrected value, which clears 5.4:1.

- A timeline response larger than the capture cap is now reported as what it is. Aviary's own size
  limit used to surface as "Page bridge rejected an untrusted message", a security-shaped warning
  kept for a week, while the capture feature never saw the response at all and the panel went on
  reporting a clean run with that response's posts missing from the export.

- A regex filter rule can no longer freeze the tab. Filter patterns run against every post in
  every batch of new ones, and JavaScript gives no way to abort a match that has started, so a
  pattern that backtracks badly does not fail slowly. It stops the page. The budget used to refuse
  a repeated group that already repeats, like `(a+)+b`, and nothing else. It now refuses any
  repeated group whose length can vary, which is the same problem written several ways: `(a+)+b`,
  `(a{1,200})+b` and `(a?){200}b` all make the engine choose where each repetition ends, and it
  tries every choice. Measured on the way in, `(.?){20}spam` took 1.2 seconds against an ordinary
  29-character post and `(a?){200}b` never finished against five characters.

  Ordinary filters are unaffected and several that used to be refused now work. A repeated group
  is judged on how many times it can actually run, counting the quantifiers on the groups around
  it, so `(cat|dog){2}`, `(\w+\s){3}` and the usual `(\d{1,3}\.){3}\d{1,3}` address pattern are
  all fine while `(a|a){20}` is not.

- Turning a feature off and on again, which the "which feature is breaking this page?" search does
  on every round, no longer leaves its page-bridge subscription behind. Each round used to add
  another live handler, so a single response from X was processed once per round: capture budgets
  ran out early, the capture count read high, and the Trust page's blocked-request counters
  multiplied.

- A boot failure now always says so. Storage initialization, the profile load, the settings read
  and the audit log all ran before the failure guard opened, so a throw in any of them left the page
  claiming it was still booting, showed no notice, and left the page bridge patching the page's
  network calls for the life of the tab. A corrupted pending-writes value, which is what made that
  reachable, is now discarded instead of thrown.

- A settings edit staged in the Control Center now survives a row action that repaints the
  section. Typing a value and then clicking something else in the same section used to discard the
  edit while the Save button stayed lit, and pressing it reported "Saved locally" having written
  nothing. The typed value is carried onto the rebuilt row, and a save that can no longer find what
  it was asked to write says so instead of claiming success.

- Keyword and regex filters no longer read a post's author, timestamp or engagement counts. A
  media-only post carries no caption node, and the text reader used to fall back to the whole
  article, so a keyword hid a photo because of the account's display name and a numeric pattern
  matched the like count until the count changed. A post with no words now matches no word rule.

- Importing a settings backup taken before the schema-2 bump now upgrades it instead of inverting
  it. A provider budget of `0` meant "no ceiling" under schema 1 and means "block everything" under
  schema 2, and the import path skipped the migration that carries that across, so restoring an old
  backup silently blocked every AI and embedding request. Imports now climb the same ladder a boot
  does and say so, and a file from a newer Aviary is reported instead of passing unnoticed.


- The Control Center no longer covers the page on load. Since the move to native popovers the
  panel's own `display: flex` outranked the browser rule that hides a closed popover, so it was
  laid out full-screen on every visit while `inert` kept it dead to input: a settings window over
  X that could not be dismissed. The panel, the AI command menu and the composer snippet palette
  now each state their closed appearance, and both menus are measured after they are shown so the
  flip-above-the-trigger decision still reads a real height.

- Two captures of a followers list are no longer compared as though both were complete. A capture
  reads the rows the browser has rendered, and X renders those a screenful at a time. Scroll to 400
  rows one week and 150 the next and the downloadable report named 250 specific accounts as
  removed. Nobody had unfollowed. They were off screen. A capture now records whether the list had
  finished loading, the capture button says which kind of capture it just made, and a comparison
  that cannot support the claim says so instead of making it.

- The panel's status line speaks with one voice. Messages from a save ended without a full stop
  and messages from an action ended with one, so the same line alternated between the two styles
  depending on which button was pressed last. All of them are sentences now, in all nine languages.

- No em or en dashes anywhere a person reads. That covers panel copy, error text, the options page,
  the standalone archive viewer and the documents an export writes into a file you open. The
  translations were swept too, using each language's own punctuation.

- A media-only post no longer matches a rule looking for links. With no caption to read, the whole
  post was searched, so the author's own profile link satisfied `link is true` and a photo was
  hidden by a rule written for link spam.

- The settings search finds accented labels from unaccented queries. In Spanish, "interaccion" now
  finds the row labelled "Ocultar contadores de interacción", which is how people actually type.

- A cleanup preview reads what a post is instead of guessing from how its text starts. A post that
  merely opened with a handle was reported as a reply, and a real reply that opened with a word was
  reported as an original post. Where an archive predates the field that states it, the preview
  still guesses, and now says it is guessing.

- An archive import can store what it promises. The bytes were written somewhere with a 10 MB
  ceiling while the panel offered 256 MiB, so a large import would have failed with a quota error.
  It now uses the durable store, and refuses an oversized file with the limit your browser profile
  can actually hold rather than a number it cannot honour.

- Two tabs no longer overwrite each other's snapshots, cleanup queue or archive library. Each of
  the three wrote its whole in-memory list, so whichever wrote second erased the other. They merge
  now, clearing still clears, and re-importing the same archive settles instead of quietly rotating
  what it kept.

- A failed delete is reported. Every other storage write already reached diagnostics; deletes threw
  and vanished.

- Local-only mode says what it blocks. It described itself as blocking every outbound request,
  while saving a photo still fetched it from X's servers, which is where the page loaded it from
  and is the one thing the media features exist to do.

- The Saving row is translated again in all eight languages, and the "Monitoring active" line no
  longer shows in English regardless of the chosen language.

### Performance

- The delivered script is 420 kB smaller. The translation catalog stored each English source string
  beside every translation, so every string shipped nine times over. It is stored by position now,
  and 207 strings no longer used by anything were retired from it.

- The first paint no longer waits on 28 storage reads. Starting up checked all 28 keys an older
  version might have left behind, one after another, before a single feature ran, and the answer
  only decides whether one optional row appears in a panel most sessions never open.

## 1.45.0 (2026-08-22)

### Changed

- One name per action. Anything that writes a media file is now called Download, everywhere: the
  per-asset button said Save while the post-level one said Download, the busy state said "Saving…"
  on both, and the permissions page and the Media section sent readers looking for a Save button
  that no longer existed. Save locally stays the bookmark action, which is the only thing it means.
- Eight panel strings still said "tweets" while the rest of the product said "posts", including two
  in the same section as status messages that already said posts. The translations were already
  correct in every locale; only the English had been left behind.


- **Tests now execute the TypeScript sources directly.** Node's native type stripping imports the
  modules under test without creating a temporary esbuild bundle. The production build still
  bundles the userscript and extension artifacts.

### Verification

- Added a shared direct-source loader, explicit .ts specifiers, and fresh entrypoint imports for
  service-worker tests that need isolated browser stubs.
- Re-ran typecheck, lint, the full test suite, and the production build.

## 1.44.1 (2026-08-22)

### Fixed

- **Captured thread rebuilding preserves the best local record.** Duplicate payloads no longer let
  empty fields erase richer text, author, or metadata values. Records without conversation metadata
  stay independent, long threads render continuously, and the reader's sort order applies to whole
  thread groups while preserving parent-first order.

### Verification

- Added duplicate-merge, metadata-less grouping, long-thread, and thread-sort regression coverage.

## 1.44.0 (2026-08-22)

### Added

- **Captured threads can be rebuilt locally.** GraphQL captures now retain each post's conversation
  root, parent, author, and creation time. A bounded graph pass merges overlapping contexts, orders
  parents before replies, identifies conversations with more than one author, and inserts explicit
  gaps for parents that were not captured.
- **The archive viewer now has a real thread reader.** Thread view uses the reconstructed order,
  marks author changes, and collapses consecutive posts by one author into an expandable run. The
  JSON export carries the thread index, and Data has a one-click local reader export for all captured
  posts.

### Verification

- Added parser, graph reconstruction, missing-parent, author-run, export-order, and no-network tests.
- Re-ran the responsive standalone viewer, locale coverage, typecheck, and lint suites.
- Raised the content delivery ceiling to 2.62 MB for the bounded local thread reader and its
  localized viewer copy. The built user script is 2.59 MB.

## 1.43.0 (2026-08-22)

### Added

- **Reading keeps a local position per feed surface.** A "New since you last looked" separator
  appears at the boundary, with an explicit Mark above as read action. Scrolling a post out of the
  viewport upward can advance the marker, while rendering alone never does. The marker store is
  included in library backups and has no unread badge.
- **Seen-post hiding is now per surface.** Keep the existing local dimming behavior on Home, a
  profile, search, notifications, messages, or status pages independently.

### Verification

- Added bounded marker-store tests, directional Snowflake comparisons, explicit mark-above behavior,
  no-write-on-render coverage, upward viewport-exit coverage, and layout-preserving separator checks.

## 1.42.0 (2026-08-22)

### Added

- **Library can read X Under the Hood reports locally.** Choose the JSON export from X to see its
  reporting period, aggregate post and account labels, generated time, and a month-over-month
  comparison. Reports stay in the local library, travel with the full library backup, and can be
  exported again as normalized JSON. The panel identifies them as X's own summaries and does not
  present published ranking code or weights as proof of production ranking behavior.

### Verification

- Added bounded parser, wrapper compatibility, month comparison, store deduplication, backup
  registration, and Control Center file-import/export coverage.

## 1.41.0 (2026-08-22)

### Changed

- **Aviary's own surfaces now use the browser's Popover API.** The Control Center, AI and composer
  menus, external-request review, and feature toast render in the top layer without a competing
  z-index. Native light dismiss owns outside clicks and Escape, while Aviary keeps its modal inert
  boundary and focus return.

### Verification

- Regenerated and reviewed all 60 settings visual baselines across dark and light X fixtures at
  1440px and 1920px widths.
- Added behavioural assertions for native popover state, live focus return, outside dismissal, and
  the accessibility tree. Full verification remains green.

## 1.40.0 (2026-08-22)

### Added

- **Power users can tune Aviary's surfaces with local CSS.** Appearance now has separate overrides
  for posts, media actions, navigation, the sidebar, and the composer. Each editor is wrapped in a
  stable `@scope` boundary when the browser supports it, with a selector fallback for Aviary's
  Firefox floor. Rules are capped at 12,000 characters and refuse imports, remote URLs, and malformed
  input before saving. Trust explains that these overrides are local and unsupported for visual
  reproduction.

### Verification

- Added settings normalization and browser coverage for scoped markers, persistence boundaries,
  unsafe CSS rejection, and cleanup when the feature is turned off.
- Feature-bisect now waits for the serialized apply pass before reading the page, preventing a
  delayed media teardown from naming an unrelated feature. Delivery budgets are 2.50 MB for the
  content bundles to account for the localized controls.

## 1.39.0 (2026-08-22)

### Changed

- **Type checking now uses the native compiler.** `npm run typecheck` runs the pinned TypeScript
  native preview while ESLint keeps TypeScript 6.0.3 for its parser. A deliberate broken fixture
  produces matching diagnostics in both compilers. On this machine, the typecheck measured about
  0.32 seconds with the native compiler and 1.58 seconds with TypeScript 6.

### Verification

- Added a regression test that makes the compiler split and diagnostic parity observable. The native
  package is pinned in both manifests so a fresh install resolves the same toolchain.

## 1.38.0 (2026-08-22)

### Added

- **Media follow-ons stay local and useful.** Captured audio tracks and caption files now get their
  own download controls and can be included in export records. Download filenames accept an
  `{account}` folder token, while the Media page exports JSON and CSV download history for an
  inclusive date range without source media URLs.

- **Bookmarks can be mirrored and exported locally.** With **Preserve raw payloads** enabled, Aviary
  reads bookmark timeline responses already delivered to the page and stores the posts it can see,
  including their capture timestamp. User tags, folders, reminders, and notes survive refreshes.
  Library can download the local set as JSON and CSV, and the panel says plainly that the mirror
  only contains posts X sent while you scrolled past them.

- **Catch-up keeps a local reading copy of rendered posts.** Filtering can retain up to 4,000
  rendered rows for 30 days. The digest covers recent and older windows, categories, author groups,
  top links, media previews, filter reasons, and direct links back to the original post. It reads
  only the local seen store and never requests more from X; a media preview loads only after a click.

- **Preservation exports now open in standard replay tools.** Export can download a raw WARC or a
  WACZ 1.1.1 package with a byte-sorted CDXJ index, replayable synthetic post pages, checksummed
  resources, and an exact page list. The panel shows the estimated uncompressed storage cost and
  links directly to replayweb.page.

- **WACZ packages can carry a local proof of continuity.** The opt-in Aviary-only WACZ proof action creates an
  anonymous ECDSA P-384 identity on first use, signs the exact SHA-256 datapackage hash, and embeds
  the public key, signature, creation time, and Aviary version in `datapackage-digest.json`. The
  keypair can be exported separately, while ordinary unsigned WACZ downloads remain unchanged.

- **Filter rules now travel as plain text.** Filtering can export a documented one-rule-per-line
  file, preview a paste with separate add and replace counts, and report every malformed source
  line before either action writes. Titles, comments, and expiry windows round-trip unchanged.

- **Completed media is easy to recognize and archive with context.** A quiet marker appears only
  after a confirmed save. Optional text and JSON sidecars keep the filename, post details, and a
  bounded copy of the post text beside the downloaded file.

- **Library searches can download their captured media.** The action uses the visible local query,
  checkpoints every queue item before the first handoff, and contacts only stored media URLs. It
  does not request another X timeline or GraphQL response.

- **Download history now recognizes the media, not the delivery URL.** Image saves store a stable
  X asset hash plus SHA-256 when the bytes can be read. A different size URL or a second URL with
  identical bytes is skipped without adding another history entry.

- **Visual duplicate matching is available as an opt-in.** It compares a 256-bit image signature
  and reports visual matches separately. The setting warns that similar compositions can produce
  a false match and remains off by default.

- **Official archive imports repair what they can prove locally.** t.co links expand from metadata
  in the archive or stored GraphQL captures. Numeric participant IDs gain known handles, while
  unknown IDs remain visible and are labelled unresolved.

### Changed

- **Interrupted media batches keep enough detail to resume correctly.** Queue entries retain image
  fallbacks, media identity, and opted-in sidecar data. Recovery writes history and sidecars only
  after the browser confirms completion.

- **The Media page explains every duplicate decision.** It shows counts for exact-byte, same-asset,
  and visual matches, plus the most recent match type. Clearing history resets the hashes and those
  counters together.

- **The delivery-size ceiling now includes the deeper local media, filtering, preservation,
  catch-up, and bookmark workflows.** The main bundle allowance is 2.50 MB after adding the scoped
  custom CSS controls in v1.40.0, media fingerprints,
  resumable captured-media batches, portable rules in eight languages, offline archive repair,
  hybrid search, the WARC/WACZ writer plus its dedicated worker, the bounded local digest, and the
  bookmark mirror/parser plus bulk export formats. The worker keeps archive assembly off X's reading
  thread and rejects an export estimate above 256 MiB before allocating it.

- **Snapshots & Archive reports every repair source.** The panel separates links found in the ZIP
  from links found in local captures, counts resolved and unresolved participant IDs, and confirms
  that the repair made no requests.

- **Library search now blends exact text and meaning.** Local BM25-style ranking puts exact handles,
  quoted phrases, and rare terms first. Optional semantic hits are fused into that list, deduplicated
  by post ID, and labelled as text, semantic, or combined. Local-only mode returns before any
  embedding-provider request.

### Fixed

- **Media handoffs no longer masquerade as completed downloads.** Cross-origin fallback now reports
  Opened and releases its duplicate claim. Extension transfers stay Started until a terminal
  browser event, persist the download id for reconciliation, and write history, markers, and
  sidecars only after completion. Queue checkpoint failures stop a batch before its first handoff.

- **Portable rule imports use the latest stored settings.** The read, preview, and write now share a
  storage lock, so two tabs preserve each other's changes and a failed write leaves live settings
  untouched.

- **Preservation records remain truthful and replay-safe.** WARC ids include a deterministic
  occurrence number, declared media types are not promoted to payload facts, and WACZ uses its
  standard media type. Archive assembly runs in an inlined worker with progress, cancellation, and
  a 256 MiB estimate guard.

- **A duplicate check can no longer hold the Download action behind repeated network waits.** Image
  fingerprinting gets one short deadline across every quality candidate, including response-body
  reading, SHA-256 work, and optional image decoding. Video saves continue directly from their
  stable X media identity.

- **Two X tabs can no longer start the same media transfer together.** A short-lived hashed claim is
  written before the handoff. Successful transfers commit it to history, while refused, failed, and
  interrupted transfers release it so Retry remains available.

- **Archive repair now rejects bad or unrelated local evidence.** Malformed checkpoint records and
  records outside captured GraphQL traffic are ignored. A broken GraphQL body cannot contribute
  forged metadata from its outer checkpoint record. Reimporting an archive also lets its newer
  participant details replace a stale saved copy.

- **Quoted search stays inside one field.** A phrase can match a post, tag, folder, handle, or other
  indexed value, but can no longer be invented across the boundary between two unrelated values.

- **Firefox release smoke now uses Mozilla's current WebDriver path and proves process exit.** Every
  browser command has a deadline, a forced cleanup is verified, and Windows profile removal waits
  until the Firefox process tree has actually closed.

## 1.37.0 (2026-08-20)

### Changed

- **The X theme now uses the whole desktop reading canvas.** Comfortable grows to 920px while
  keeping the discovery rail. Wide centers a 1120px column and removes the rail so media and posts
  get the space instead of an empty right gutter.

- **Posts read as one continuous stream.** Authored themes replace stacked post cards with flat
  surfaces, restrained hover feedback, quiet separators, readable text measures, and 10px media
  corners. Wide action rows spread across the post, keeping Download easy to spot.

- **Conversation pages have a clear focal post and denser replies.** Aviary marks the outer post
  cells on status routes, enlarges the main post text, shortens the reply composer, and connects
  replies with a subtle thread line. Turning the theme off removes every marker.

### Verification

- Added deterministic Home and conversation captures at 1440 by 900 and 1920 by 1080, plus a
  focused test for route-aware focal and reply roles.
- Compared the implementation with three generated design directions, reviewed the selected Quiet
  Stream result in the in-app browser, and recorded the parity pass in `design-qa.md`.

## 1.36.0 (2026-08-20)

### Changed

- **The Control Center now reads as one piece of software instead of a stack of cards.** Rows share
  a flat surface with quiet dividers, labels are larger, page headers are shorter, and the rail uses
  one accent. Helper copy is clamped so the setting name and control stay in charge.

- **Media keeps the important actions in view.** Batch behavior is grouped across two columns on
  wide screens, and Download all visible media is the one filled action in the section. The two
  defaults that affect feed downloads, visible controls and original quality, remain first.

- **Optional permissions are easier to understand.** The extension page drops the boxed cards and
  status pills. Download access is a clear primary button, while media-host access remains visibly
  secondary and optional.

### Fixed

- **A late-loading video no longer leaves a dead gray Download button.** The action stays clickable,
  waits briefly for X's direct variants, chooses the highest-quality saveable file, and offers Retry
  if the metadata still is not ready.

- **The first-run notice no longer sits over the open Control Center.** Opening settings hides it and
  closing settings restores it when it still applies.

## 1.35.0 (2026-08-19)

### Added

- **The timeline can stop.** Set a number of posts and the feed stops extending there, with a
  control to continue that releases another page of the same size. Off by default; zero leaves X's
  endless scroll exactly as it was. It applies to feeds that extend, home, profile, search, and
  never to a conversation, which is finite already. The property the implementation is built around
  is that nothing already on screen moves: the control is inserted *after* the last post shown
  rather than above the cut, so continuing extends downward into space that was below the fold, and
  a post the reader was looking at stays exactly where it was. A release granted on one feed does
  not carry to the next.

- **A filtered post can say what caught it.** A filter that hides silently is hard to tell from a
  bug, so a suppressed post now names the rule, keyword, pattern, engagement floor or media type
  responsible, by the rule's title where it has one. The reason comes out of the same evaluation
  that made the decision rather than being worked out afterwards, because a reason computed
  separately is a second implementation of the filter and the two would eventually disagree about a
  post the reader is looking at. Nothing is stored: the sentence lives on the article as an
  attribute the stylesheet reads with `attr()`, and structural reasons are written into the
  stylesheet itself, so no post costs anything extra. The default names reasons on dimmed posts,
  which changes no layout; the third setting also turns a hidden post into a one-line strip that
  opens on hover or when tabbed into, the post stays clipped rather than having its children
  removed, so it remains reachable by keyboard.

- **A filter rule can carry a name and a lifetime.** Start a line with `[a title]` to name a rule,
  and give it `for 7d from <instant>` to have it apply only for a while. An expired rule stops
  filtering on the next pass with no settings change and no reload, and is never deleted: the
  panel lists what expired and offers one control that restarts each rule's own window from now.
  The window is stored as its duration plus its start rather than as a deadline, which is what
  makes renewing possible without asking the user again what they originally chose. Rules written
  before any of this keep parsing exactly as they did.

### Fixed

- **A feature module that nothing registers is now a test failure.** The boot test checked a
  hand-written list of ten feature ids, so a new module could be written, wired to a setting, tested
  against directly, and never loaded by the app, which is how the timeline-stop feature first
  landed. The check now reads every `FeatureModule` id out of `src/features` and requires the booted
  registry to hold all thirty-four.

- **Eleven sentences in the Control Center were shipping in English in all eight locales while
  translation coverage reported 100%.** The extractor draws the panel to harvest its copy, so a row
  that only appears under a condition, an expired rule, a callback the harness cannot supply, is
  reached only by the source scan, and that scan read one string per row: the label. Every such
  row's explanatory sentence was invisible to it. The scan now reads the description too, for each
  helper whose second argument is one, and a test drives the harvester over a conditional row so
  the gap cannot reopen.

- **Filter on the shape of a post, not only its words.** Two predicates, both off by default.
  *Quote posts* hides or dims a post that quotes another, structural, so it is a `:has()` rule
  costing nothing per post, and it tells a quoted post from a link preview by the quoted author's
  name rather than by the `role="link"` the two share. *Low-engagement posts* hides or dims a post
  under a minimum number of replies, reposts or likes; the count is read from the action button's
  own accessible name, which carries the exact figure where the visible text is rounded to "11K",
  and which reads zero as zero where the visible text is simply empty. A post whose count cannot be
  read is never filtered on it, and a minimum of zero reads no counts at all.

### Changed

- **The media and verified filters are stylesheet rules now, not work done per post.** Both were
  questions about the shape of a post's own subtree, does it contain a photo, a video player, a
  GIF, the verified badge, and the engine answered them with five `querySelector` calls against
  every article on every mutation batch. They are emitted as `:has()` rules instead, from one table
  that the remaining JS reader shares, so a timeline scroll no longer pays for them at all. Two
  consequences beyond the saved work: media that renders *after* a post was judged is now caught,
  where the JS pass had stamped that post done and would never look at it again; and a post the
  engine has not judged yet is left alone, so nothing flashes hidden before the allowlist is
  consulted. Precedence is unchanged, an allowlisted author still outranks everything, a rule that
  dims still beats a media rule that would hide, and hiding video still hides GIFs.

## 1.34.0 (2026-08-19)

### Changed

- **The unpacked extension bundles are no longer carried in git.** `dist/extension-chrome/` and
  `dist/extension-firefox/` are build output that `npm run verify` regenerates on every commit
  touching `src/`, 1.9 MB of incompressible `content.js` per target, per commit, that nothing read:
  the load-unpacked instructions and the release artifacts both come from a build. They are ignored
  and built on demand; `dist/aviary.user.js` and `dist/aviary.meta.js` stay tracked because a
  userscript manager polls them by raw URL. `docs/INSTALL.md` now says to build first, for both
  browsers.

- **Every release named in this file now has a tag on the commit that bumped its version.** Nine
  releases were tagged and thirty-one were documented, so most of the project's history could not be
  checked out, diffed, or bisected by reference, which is the wrong gap for a project whose most
  frequent question is "when did this selector break". Twenty-four tags were added, located by the
  commit that changed `package.json` rather than by commit subject, since not every release commit
  said "release". The two releases with no entry at all, **1.7.0** and **1.15.0**, are written below
  from their own commit ranges and labelled as reconstructed.

### Added

- **Copy a post's link for an alternate front-end.** Library gains a **Copy post links as** choice
  (X, fxtwitter, vxtwitter, fixupx, xcancel); pick anything but X and each post grows a **Copy
  link** control that writes that post's address on the chosen host. Deliberately copy-time
  rewriting rather than redirection: redirecting `x.com` navigation is the shape everyone else
  shipped and has since removed, because logging in through the alternate host now sets an `x.com`
  cookie and the front-ends people redirected to have been architecturally dead since X removed
  guest tokens. Nothing X rendered is modified, no navigation is redirected, and no request is
  originated, only what you copy changes. Off by default, and the host list is closed so a typo
  cannot produce a link to somewhere you did not mean.

## 1.33.0 (2026-08-18)

### Fixed

- **Two X tabs no longer erase each other's work.** Every whole-state store loaded once into memory
  and persisted that snapshot wholesale, so a hide in one tab and a hide in the other kept only
  whichever wrote second -- silently, with nothing to see afterwards but a missing entry. Hidden
  posts, seen posts, the media dedup index, the audit log and the bookmark library now merge on
  write under a cross-tab Web Lock: each save folds *the change it just made* into what is actually
  stored, never the whole in-memory list, so a deletion or a "clear" in one tab is not undone by
  the other's next save either. Aria2 history, the semantic index and archive import jobs are
  written under the same lock but deliberately not merged, each is derived, reconciled, or owned
  by the tab running it, and the reasoning is recorded where the write happens.
- **A daily provider budget can no longer be spent once per open tab.** The usage ledger checked
  the counter and then wrote it back, which across two tabs is a time-of-check-to-time-of-use race:
  both read the same "bytes used today", both concluded there was room. The whole check-and-spend
  now runs inside one lock and re-reads the stored ledger first, combined with what the tab already
  knows by taking the higher of the two counters, a daily total only goes up, so that can refuse a
  request that would have been allowed but can never allow one that should have been refused.
- **A library restore holds one lock across snapshot, write, and rollback.** The window between
  reading a key's current value (kept for the rollback) and overwriting it was where an ordinary
  save from a second tab used to land, leaving the rollback holding a value that was no longer
  current.
- Bookmark ids were `Date.now()` plus a counter that restarts at zero in every tab, so two tabs
  saving in the same millisecond produced the same id. Found by the cross-tab merge, which keys on
  id and would have kept one of the two bookmarks.

## 1.32.0 (2026-08-18)

### Added

- **Trust -> Find the feature breaking this page.** A binary search over the features that are
  actually running: it turns them all off, then back on in halves, asking after each round whether
  the page is still wrong, and names the one responsible in about five rounds instead of a linear
  hunt through thirty-odd settings. Turning a feature off runs its own `destroy` rather than
  writing a setting, so reloading restores everything however you stop -- including abandoning
  mid-round. The first round turns everything off, so "this is not Aviary" is a result the search
  can reach rather than a feature named at random. The Control Center and its locale stay on
  throughout and can never be named. The outcome travels in **Copy diagnostics** as one
  content-free line, and the bug report template has a field for it.

### Fixed

- **"Aviary's page script did not load" no longer stands in for "something else answered it".**
  A script that wins the very first handshake owns the page agent -- the transferred control port
  stops a *later* one from displacing it, but nothing can stop the first. The real bridge then sat
  out a three-second timeout and reported `agent-absent`, which reads as a browser compatibility
  problem when what actually happened is that Aviary's default-on network ad guard is answering to
  somebody else. The agent now refuses a late handshake audibly, and Trust says so. The design note
  on `installPageAgent` states plainly what the boundary defends and what it does not: it is not
  cryptographic, the refusal itself is forgeable by the page, and it downgrades a diagnostic rather
  than a decision.

- **A browser download is only Saved once the browser says it finished.**
  `chrome.downloads.download()` resolves when the browser accepts the request, so an interrupted
  transfer had already been reported as Saved, marked completed in the queue, and written into the
  duplicate index -- which then refused the retry the user wanted. The extension now reports each
  download's terminal state back to the tab that asked. **Started** and **Saved** are distinct
  states on the button; an interrupted transfer reads **Retry**, marks its queue entry failed, and
  is never recorded as a duplicate; and a transfer still running when the wait gives up stays
  **Started** rather than claiming either outcome. The tracking is persisted, so the answer still
  arrives after the service worker has been suspended and restarted, and a quality-fallback retry
  reports under the id the page is waiting on. Userscript saves are unchanged: `GM_download`'s own
  callback already is the terminal state.

- **Media inside a quoted post is the quoted account's, not the account that quoted them.** The
  extractor walked the whole `article` subtree and filed every photo and player it found under the
  outer post's handle and id, so saving a photo out of a quote wrote it as if the quoting account
  had published it. Each asset now carries its owner. A quoted post's media is saved under the
  quoted account's handle, its own text, and its own post id where the DOM or a captured record
  supplies one; the post-level **Download** saves only the post's own media and says so, and every
  excluded asset still has its own Save control. Export records mark quoted and card media with
  whose it is instead of listing it among the account's own.
- A post with no permalink of its own -- a reply shell still building, or a quote-only post -- no
  longer adopts the quoted post's id, handle, or text. The article's identity is read from outside
  the quote it carries.
- The exporter's "this is a quoted post" test and the media extractor's are now one definition.
  They disagreed: the exporter looked only for two named test ids while X's current Home renders a
  quote as a focusable `div` with no test id, so a record could carry a quoted photo with no note
  that a quote existed at all.

### Changed

- **The browser floors are declared once, with their reason.** They lived in three places that did
  not know about each other -- a number in each manifest and a sentence in `docs/INSTALL.md` -- and
  the floor is what decides whether a platform feature can be used directly or needs a detection
  branch. `src/extension/browser-floors.ts` now declares both, records per-feature which of the two
  is true, and preflight fails the build if either manifest disagrees. The decision itself: Firefox
  stays at **128**. It is an ESR line, Aviary is sideloaded rather than distributed through a store,
  and raising the floor to pick up `URLPattern`, `@scope` or the Navigation API without a branch
  would exclude the users most likely to be running ESR.

- `FeatureRegistry` gained `suspend`/`resume`, and now runs `apply` in registration order rather
  than initialization order -- the two differ only once a feature has been suspended and resumed,
  and ad protection is registered first precisely so it runs before anything that reads the
  timeline.

## 1.31.0 (2026-08-18)

### Fixed

- A Control Center section that fails to build no longer takes the whole panel with it. The rail
  item appeared to do nothing: the destination had already changed, the previous section stayed on
  screen, and the status line still read "Saved locally". A failed section now renders a row
  carrying the reason and reports to diagnostics, and the rest of the panel keeps working.
- Media layout classes are removed by prefix rather than from a hardcoded list of three names. The
  class is built from the setting, so a fourth layout would have been applied and then left behind
  on teardown.

### Changed

- The test suite no longer contains a single behavioural claim written as a regex over the source
  that implements it. Roughly 350 such assertions have become tests that boot the app, mount the
  panel, apply a feature to a fixture, or read an exported value -- and several found defects the
  regex form was hiding. `tests/source-contracts.test.mjs` holds what is left and says in its own
  docstring what belongs there: bans, of the form "this pattern must not appear anywhere".
  Everything else that still reads a file reads structured data -- the MV3 manifests, the README,
  the shipped options assets, the i18n manifest.
- `FeatureRegistry` gained `ids()` and `isActive()`, and `SETTINGS_MIGRATIONS` is exported, so the
  running app can be asked what it registered and which upgrade steps it carries.

## 1.30.0 (2026-08-18)

### Fixed

- Saving a setting no longer throws you back to the top of the section. The panel measured and
  restored the scroll offset of the grid that wraps the rail and the content pane -- a container
  that is `overflow: hidden` and has never scrolled -- while the two panes that do scroll were
  rebuilt from zero on every render. Both are now measured and put back.

### Changed

- About a third of the test suite's assertions stopped reading `src/*.ts` as text. Roughly 350
  behavioural claims were written as regexes over the source that implements them, so a rename
  failed a working feature while a real regression that preserved the literal string passed. 118
  of those assertions now drive the built module, the rendered DOM, or the booted app; the panel
  scroll bug above is one of the defects that form was hiding. `tests/source-contracts.test.mjs`
  is now bans only -- "this pattern must not appear anywhere" -- and says so.
- `FeatureRegistry` gained `ids()` and `isActive()`. `statuses()` reported how each feature was
  doing but never which feature it was, so nothing could ask the running app what it had actually
  registered.

## 1.29.0 (2026-08-18)

### Security

- A page script can no longer switch ad protection off or uninstall Aviary's page-world observer.
  The handshake still starts on the window, because that is the only way to reach a page-world
  script, but it now hands over a private `MessagePort` and everything after it travels there. A
  port cannot be read from the page or posted to without the reference, so catching an envelope no
  longer reveals anything replayable. A second handshake cannot displace a standing channel either.

### Added

- An automated accessibility sweep runs against Aviary's own injected UI across all 13 Control
  Center destinations, catching invalid ARIA, missing accessible names and insufficient contrast.
  It is scoped to Aviary's shadow root, X's DOM is not ours to assert on, and its blind spots are
  written down beside it: roughly half of accessibility issues by volume, and no coverage at all of
  forced-colors breakage, which has its own lane.

### Changed

- The translation catalog is no longer built as a live object on every page load. It ships as a
  JSON string that is parsed once, on the first request for a translation, which for most sessions
  never happens, because the settings panel is never opened. Retained memory per tab drops from
  about 2.8 MB to 1.1 MB, and the shipped bundle is roughly 60 kB smaller. Nothing on the
  document-start path touches it.
- The Control Center's accessibility contract is now verified by driving the panel instead of
  matching strings in its source. Focus entry and return, `inert` on the page behind an open modal,
  Escape, focus containment, modal semantics, and an accessible name on every control are read from
  the rendered result, the previous assertions matched literal source text, which fails on a rename
  and passes through a real regression.

### Fixed

- Hiding a post no longer drives a feedback loop. The collapse dispatched a synthetic `resize` on
  every pass so X's virtualizer could close the row, but the virtualizer answers that resize with
  mutations that drive the next pass, so it fed itself for as long as a hidden post was on screen.
  The nudge now fires only when a row actually changes state.
- A recycled timeline row can no longer inherit the previous post's identity. X reuses article
  elements for different posts, and both the cached post key and the processed stamp were trusted
  from the element rather than checked against what it now holds, so an unrelated post could
  silently disappear into a collapse meant for another one.

## 1.28.0 (2026-08-18)

### Added

- The build emits `dist/aviary.meta.js`, a metadata-only companion carrying the same metablock byte
  for byte. `@updateURL` now points at it, so a userscript manager's scheduled poll transfers under
  a kilobyte instead of the whole ~1.9 MB script; `@downloadURL` still resolves to the full file and
  is fetched only when a newer version is seen. Preflight fails if the two metablocks diverge.
- Preflight reports the size of every shipped artifact and fails past a declared budget. Nothing
  measured delivery size before, and it is the one axis the update path is most sensitive to.

### Changed

- The `engines` range names supported Node lines explicitly instead of an open `>=22.23.2`, which
  also admitted Node 25.x, end of life and unpatched since 2026-06-01.
- README no longer claims `--ignore-scripts` covers every 2026 npm compromise. It blocks the
  install-hook class, and would have blocked ChainDrop on this exact dependency chain, but several
  2026 attacks ran from the module body where no install flag reaches.
- A provider budget of `0` now means zero. It previously meant "no bound", so the one value a
  cautious user is most likely to type on a spending control was the value that removed the
  ceiling. Settings written before this are migrated: a stored `0` becomes the schema's maximum, so
  anyone who chose "unlimited" keeps it and nobody's spend is newly blocked.

### Fixed

- The Control Center is usable in Windows High Contrast and other forced-colors modes. Settings
  toggles carried their entire on/off state in author colours the browser overrides, over a real
  checkbox hidden with `opacity: 0` and `appearance: none`, so the browser's own guaranteed-contrast
  rendering was suppressed as well and on looked like off. The native control is handed back in that
  mode, and rows, buttons, the selected destination and the Save/Revert footer keep explicit edges
  where tints and shadows used to carry them. The extension options page gets the same treatment;
  MV3 removed `options_ui.browser_style`, so none of it comes for free.
- Feature passes no longer interleave. Boot, the mutation observer, route changes and settings saves
  all requested one without coordinating, so two could run at once and the guard markers features
  use to skip redundant work would make one pass skip the rescan the other had been started for,
  surfacing as a feature that quietly failed to re-apply after a settings change. Passes now run one
  at a time, and redundant whole-document passes collapse.
- A filter pattern can no longer freeze the page. Patterns run against every post in every batch and
  JavaScript cannot abort a running match, so a shape like `/(a+)+b/`, reachable by accident while
  writing a rule, hung the tab. Repeated groups that already repeat, oversized repetition counts,
  and very long patterns are now refused before they compile: the keyword list drops them, and the
  rule DSL names the offending line in the errors it already reports.
- Filtering a post now collapses the timeline row that owns it, not only the post itself. The cell
  marker was written as a bare presence flag while the stylesheet selected on its value, so every
  hidden post left a full-height blank gap where the next post should have moved up.
- A saving Control Center page now reports `aria-busy="true"` to assistive technology. It was
  written as an empty value, which ARIA reads as the default, so screen readers were never told a
  save was in progress.
- `toggleAttribute` is now restricted by lint to attributes whose presence alone means true. Both
  defects above were the same mistake, and neither could be caught by the source-text assertions
  that were supposed to cover them.
- Offscreen video pausing now releases videos X has removed from the page. Every `<video>` ever
  scanned was held for the whole session, so a long scroll retained detached media elements, their
  decoders, and a listener each.
- Turning on **Dim already-seen posts** now takes effect immediately. The store was built only at
  boot, so enabling the setting later left the feature reporting itself healthy while marking
  nothing until the page was reloaded.
- The extension options page now shows the locale you chose. It read a storage key nothing has ever
  written, so it fell back to English regardless of the setting.
- An AI or embedding endpoint carrying an API key must now be `https:`. A mistyped `http://` would
  have sent the key in the clear. Loopback addresses stay allowed, so a self-hosted provider on
  `127.0.0.1` still works.
- The ad-protection rule and its persisted record can no longer disagree. The rule was committed
  before the record, so a failed write left the rule applied while the record kept the old value,
  and the next restore after a restart reverted a rule the user had enabled.
- Tearing down seen-post dimming now waits for its pending write. The flush was queued rather than
  awaited, so up to 1.5 seconds of what you had just scrolled past could be lost.

## 1.27.1 (2026-08-16)

### Fixed

- Direct video and GIF downloads now resolve from X's current `XMLHttpRequest`-delivered timeline
  responses as well as its earlier `fetch` transport. Capture remains one-shot, bounded, and
  non-consuming, so the native page receives the exact response object it requested.
- X's current `/i/api/1.1/graphql/viewer_context.json` detection probe is covered by the explicit
  request-pass-through contract and can never be mistaken for timeline GraphQL or ad logging.

## 1.27.0 (2026-08-16)

### Added

- Every media post now has one persistent **Download** action in X's native action row. One click
  saves all primary photos and direct videos/GIFs while excluding video thumbnails; per-asset
  overlays remain available for selective saves. The action exposes resolving, busy, success,
  duplicate, permission, partial-failure, and retry states, survives virtualized row replacement,
  and is translated across all eight non-English locales.
- Original-image downloads now carry a bounded quality fallback: source-format `name=orig` first,
  then `4096x4096` only after the preferred transfer fails. Userscript retries follow transfer
  callbacks; extension retries are persisted across service-worker suspension and resume from a
  `chrome.downloads.onChanged` interruption.

### Changed

- Video selection now ranks complete progressive MP4 files before streaming manifests, then uses
  bitrate and pixel count. Blob handles, HLS/DASH manifests, and media segments are never presented
  as completed video downloads.
- Media controls have a clearer action-row hierarchy, explicit focus and status treatments, and a
  44-pixel narrow-screen target. A deterministic feed capture documents the shipped layout.
- Build, test, and smoke verification now run locally only; the legacy hosted build workflow was
  removed while the same `npm run smoke` browser matrix remains available for release checks.

### Fixed

- Mixed photo/video posts wait for the direct video target instead of silently downloading only
  the already-resolved photos. A same-control retry skips assets that completed before a partial
  failure.

## 1.26.0 (2026-08-16)

### Changed

- Extension download setup now makes the browser-download grant the primary action, announces
  permission checks and results, reports download readiness in the health summary, and remains
  usable in narrow browser windows. Media layout now stays with the on-post controls it affects
  instead of appearing under batch behavior.

### Fixed

- Direct video downloads now capture MP4 variants from the first timeline response. Media controls
  are enabled by default, but the document-start page agent previously kept metadata capture off
  until durable settings finished loading. X had already replaced those variants with `blob:`
  MediaSource handles by then, leaving visible videos with no downloadable target and no Video
  control. The boot configuration now mirrors the default-on media setting; a persisted opt-out
  still disables capture as soon as settings load.
- Media buttons no longer become one-use controls. A successful browser or aria2 handoff left the
  button disabled for the lifetime of X's recycled post shell, so saving the same file again was
  impossible even with duplicate history switched off. Buttons now show explicit busy, success,
  duplicate, permission, and retry states; announce progress to assistive technology; return to
  their original action after feedback; and remain reusable after a completed handoff.

## 1.25.0 (2026-08-15)

### Fixed

- An archive entry that is plain JSON rather than X's `window.YTD.… =` form is no longer mangled.
  The prefix stripper matched everything up to the first `=` anywhere in the file, so an entry
  containing base64 padding or a link with a query string had its opening cut off and was then
  reported as malformed. It is anchored to the actual prefix shape now.
- Seen-post marks are no longer lost when the feature is switched off. Writes are coalesced on a
  1.5-second timer, and teardown cleared that timer without running it.
- The hidden-posts pass stops appending and immediately removing a stylesheet on every mutation
  batch while the feature is off.
- New profile ids come from `crypto.randomUUID()` instead of a timestamp plus a count, the same
  collision shape already fixed once in bookmarks.

- Turning the page agent off no longer removes somebody else's work. Teardown restored `fetch` and
  the XHR methods by assignment, so if X's own instrumentation, or another extension, had wrapped
  them *after* Aviary did, that layer was deleted along with Aviary's. It now restores only while
  the current value is still the wrapper Aviary installed, and otherwise leaves the chain intact
  and reports which path it took.
- The capture-age gate reads every capture, not just the newest. One fresh capture used to mask an
  arbitrarily stale sibling, and a selector proved against the stale one is exactly as speculative
  as one proved against nothing. Preflight now names each stale capture with its own age. The
  stale-capture waiver also covers the whole of its stated day in the reader's own timezone; it had
  been compared against a UTC day-end, so it expired early evening of that day in the Americas.

- Importing an X archive no longer rewrites the whole archive on every progress tick. The job
  record carried the file's bytes inline, a 250 MiB import becomes roughly 333 MiB of base64,
  and the record is re-serialised each time progress moves, along with every other retained job's
  copy. Measured on a 2 MiB fixture, a single tick wrote 2.8 MB; the payload now lives under its
  own key and a tick writes only progress. Failed and cancelled imports deliberately keep their
  archive, because **Retry** replays from exactly those bytes; completing or evicting a job
  releases it.

- A refused ad-logging request sent over XHR now completes as a network error instead of never
  finishing at all. Aviary's other two refusal paths deliberately fake benign completion, the
  fetch path answers 204, the beacon path returns true, specifically so X's client does not sit
  waiting or retry. The XHR path did neither: it returned, leaving the request stuck at OPENED, so
  anything gating a retry queue on completion would have waited indefinitely. It now reaches DONE
  with status 0 and fires `readystatechange`, `error`, and `loadend`, exactly as an offline request
  does, and one throwing listener no longer stops the rest.
- Continuous integration now runs on changes to `_decoded/`, `docs/`, and the README. Its gates
  already read all three, the fixture tests, the capture-age ceiling, the selector-evidence check,
  the FAQ settings reference, and the privacy data map, but the paths filter listed only source,
  tests, tools, and configs, so refreshing a capture skipped the workflow that checks it.

- A transient storage failure no longer costs you the session. When an IndexedDB transaction fails,
  Aviary drops to the older storage path for the rest of that session, but migration had already
  emptied it, and the next healthy start preferred the durable copy and skipped any key it already
  held. Everything written during the outage was therefore shadowed by the pre-failure values,
  permanently, with no error anywhere. Writes and deletions made while the backend is down are now
  recorded in a small ledger, folded back in on the next healthy start, and reported in Trust as
  "N changes waiting for the next reload" while they wait.

- Four local stores were invisible to the machinery that is supposed to know about every store.
  Seen posts, ad-contract observations, persisted diagnostics, and the first-run flag were each
  missing from the durable-storage migration list and the profile-adoption list, and seen posts
  was additionally missing from the library backup, so **Backup claimed completeness over a store
  it did not carry**. All four are registered now, and the privacy data map documents what each
  one holds.
- A new test enumerates every `aviary.*.v1` key declared in the source and fails when one is
  absent from a registry it belongs in. Each deliberate exclusion is listed with the reason it is
  excluded from that specific registry, the extension's DNR-rule mirror lives in a different
  storage realm, and diagnostics, ad observations and the first-run flag are not user data. This
  is the only check that connects a store's declaration to the registries; nothing else did, which
  is why four accumulated.

- The capture decoder no longer mangles non-ASCII text. Quoted-printable carries bytes, not
  characters, and the first version mapped each octet through `String.fromCharCode` before writing
  UTF-8 back out, so `=E2=80=94` became mojibake instead of an em-dash, and every display name,
  non-English post, and localized ad label in a refreshed capture would have been wrong. It decodes
  to bytes now and decodes those once as UTF-8, including across the soft line breaks that split an
  escape sequence mid-character.
- A `ct0=` cookie value could pass both the capture scrub and the leak guard that exists to catch
  it: `ct0` was listed only in its JSON form. Both the scrub and the guard are now generated from
  one list of secret names, so a name cannot be scrubbed-but-unchecked or the reverse, and the
  guard names which credential it found.

## 1.24.0 (2026-08-15)

### Added

- The DOM captures every selector is proved against now carry a date and an expiry.
  `_decoded/captures.json` records when each capture was taken, from which route, and what it does
  and does not contain; preflight warns as it ages and fails past the declared ceiling. Without
  that, a blocked item's "measured: 0 hits" silently meant "0 hits as X was on the capture date"
  rather than "this does not exist", which is how the evidence here reached three months old with
  every gate still green. A waiver can defer the failure but carries its own expiry, so it cannot
  become permanent.
- `npm run capture:decode -- "<saved.mhtml>" <name>` turns a browser-saved capture into a scrubbed
  fixture in one step, stripping `ct0`, Bearer and `auth_token`-shaped values in both cookie and
  JSON form and refusing to write a file that still trips its own leak guard. Refreshing the
  evidence was previously an undocumented manual chore, which is why it never happened.

### Changed

- Selector drift is watched across the surfaces features actually use, not just the ten
  foundational ones. Aviary referenced 56 distinct X test ids while monitoring 10, so a rename in
  any of the rest silently disabled its owning feature with no diagnostic, the exact failure the
  fixture discipline exists to prevent, happening outside the fixture's reach. Timeline cells, the
  post action bar, engagement counts, author names, the video container, trends, the news rail,
  follow suggestions, the Home tab link, the search box and the promoted-placement marker are all
  registered now, each naming the feature that stops working without it. Every registered test id
  must appear in a capture, so the registry cannot grow a selector nobody can point at.
- Export archives are compressed now. The ZIP writer emitted STORE, no compression at all, while
  the ZIP *reader* had been inflating `deflate-raw` since archive import shipped, so the two halves
  disagreed for no reason: text-heavy exports (JSON, CSV, HTML, WARC, Markdown) left the browser
  several times larger than they needed to be. `CompressionStream` is built into every supported
  browser, so this costs no dependency. Each entry keeps whichever form is smaller, so captured
  photos and video, which grow under DEFLATE, are still stored as-is, and an archive still builds
  if compression is unavailable or fails. XLSX still uses the plain writer; it is a few kilobytes
  of XML and making it async would ripple through the synchronous formatter dispatch for no
  meaningful saving.
- The packaged extension ZIPs are no longer tracked in git. `npm run verify` rebuilds them on every
  commit that touches `src/`, so each commit was adding roughly 3.9 MB of incompressible binary
  that nothing can delta-compress, 230 blobs and 277.9 MB of the pack by 2026-08-15, for files
  that are release artifacts. They are still built by the same command and still validated by
  preflight. `dist/aviary.user.js` stays tracked, because `@downloadURL` resolves to it and it is
  therefore the update channel itself.
- Dependencies now install with `npm ci --ignore-scripts`, in CI and in the documented setup.
  Aviary has zero runtime dependencies, so nothing it ships needs an install script, and every
  major npm compromise of 2026 executed through one. Verified rather than assumed: esbuild's
  postinstall is a validation step, and a clean `--ignore-scripts` install still builds and passes
  the suite. `engines.node` now names 22.23.2, the first line clear of the June and July 2026 Node
  security releases, instead of any 22.
- Trust now states the ad shield's boundary in both directions. **Refuse X's ad logging call** says
  that Aviary refuses exactly one request and nothing else, including the checks X uses to notice
  an ad blocker. Reports of X's ad-blocker notice point at a *failed probe* rather than a rendered
  ad as the trigger, and the symptom is often not the banner at all but an error, a blank feed, or
  empty search. Tests now assert that neither the request rule nor the page-world stub matches
  those probes, so "Aviary is not what tripped it" is proved rather than assumed.
- Aviary no longer asks for `mobile.twitter.com` or `tweetdeck.twitter.com`. X retired both in
  2023, and measuring them confirms neither serves a document, `mobile.twitter.com` redirects to
  `twitter.com`, and `tweetdeck.twitter.com` redirects to `pro.twitter.com`, a host Aviary never
  matched at all. They only widened the permission prompt, which is the thing that makes people
  decline an extension. `twitter.com` stays despite also redirecting: it is the canonical legacy
  origin, and a reversal there would silently disable Aviary everywhere.

### Fixed

- The documentation gate now checks what the panel actually offers, not just version strings.
  README and docs/FAQ.md had reached v1.23.0 without mentioning a single feature added in v1.22.0
  or v1.23.0, focus mode, seen-post dimming, account colours, the tab icon, because the only
  assertion was that two files carried the current version number. The FAQ now ends with a
  generated reference to all 71 controls across the Control Center's 12 pages, and the suite fails
  when a control is added or renamed without regenerating it (`npm run docs:settings`).
- README's Roadmap section no longer restates what the latest release added. That summary had been
  describing the v1.18 batch for three releases while claiming to be current; it now points at the
  changelog, which cannot drift from itself. `PROJECT_STATE.md` is gone for the same reason, 320
  lines stamped "Updated: 2026-05-19", enumerating completed work the changelog already owns.
- The userscript's update URLs now name the repository this project actually lives in. It was
  renamed to `SysAdminDoc/Aviary`, and `package.json` still declared the old path that
  `@updateURL`/`@downloadURL` are derived from. `github.com` follows a rename;
  `raw.githubusercontent.com`, where those URLs point, does not, so every installed copy would
  have polled a path that could never answer. Preflight now compares the declared repository
  against the `origin` remote and fails on a mismatch, because the previous check validated the
  URL's shape, which a rename passes cleanly.

## 1.23.0 (2026-08-15)

### Changed

- The video-quality setting no longer promises an outcome it cannot guarantee. It is now **Pin
  video playlists to their best rendition** and reports how many playlists were actually rewritten
  this session. Aviary can only act on a playlist it sees, and a player fetching one inside a
  worker never reaches it, so the setting states what it does instead of claiming a result.

### Fixed

- Account notes now recognise absolute profile links as well as relative ones. Like the filter
  engine before it, the notes reader accepted only relative hrefs, so every author read as unknown
  against the saved captures.

### Added

- Trust now states when X's interface language has no ad labels. Aviary matches sponsored posts by
  an exact localized label, so in an uncovered language native ads are simply not suppressed, a
  gap users previously had no way to notice.
- **Focus mode** covers the reading column outside a daily window you set, with a five-minute
  override one click away. Navigation stays usable, so the rest of X remains reachable, it is a
  reading gate, not a site block. Entirely local: nothing is blocked at the network layer and
  nothing leaves the device. A window whose end precedes its start wraps midnight, and an
  unreadable time falls back to the default rather than locking anyone out.
- **Account colours** tag a handle with one of six colours, shown as a badge beside that account's
  posts. A colour works with or without a note, travels with the existing library backup, and the
  badge keeps visible text and names the colour in its accessible label, colour is never the only
  thing carrying the meaning.
- **Keep video playing when the tab loses focus** resumes a video X stopped because you switched
  tabs, and leaves a video you paused yourself alone. **Loop videos** restarts one at the end. Both
  off by default, and both separate from the offscreen-pause setting, which is about scrolling.
- **Dim posts you have already seen** (Filtering, off by default) fades a post the second time it
  scrolls past, so a return trip down the timeline shows what is new. A post is never faded while
  you are first reading it, hovering one brings it back, and **Forget seen posts** clears the
  record. The store holds post IDs and timestamps only, no text, handle, or URL, capped at 4,000
  entries and 30 days.
- **Use Aviary's tab icon** (Appearance, off by default) swaps X's favicon for Aviary's own mark so
  its tabs are easy to pick out, and restores X's exact icon when turned off. The mark is inlined,
  so it needs no network request and works in the userscript build too. Only Aviary's mark is
  offered: X's bird is their trademark, and a lookalike would be no better.
- Empty library surfaces now say how to fill them. Snapshots, account notes, and export jobs each
  show one guiding sentence when they hold nothing, and an empty bookmark library is distinguished
  from a search that simply found no match, different problems that had shown identical copy.

## 1.22.0 (2026-08-14)

### Added

- Engagement counts can now be hidden per metric, replies, reposts, likes and views each have
  their own switch under the existing master toggle, which keeps hiding all four for anyone who had
  it on. Bookmarks are deliberately absent: no capture shows a bookmark count element to scope a
  rule to.
- **Hide the tab title badge** removes X's unread count from the browser tab title, so a
  notification badge hidden everywhere on the page is not handed back by the tab. It is a title
  pattern transform, not a DOM contract: if X stops emitting a count, nothing happens.
- The standalone export viewer no longer carries its own nine-locale translation table. Its copy
  now comes from the same catalog as everything else, resolved at generation time and inlined into
  the exported file, and the extractor harvests it so the sync step cannot drop it. Tests fail if a
  viewer string is missing from the catalog or a second table reappears.
- A fresh install now says what it already changed. A one-time dismissible notice names the two
  default-on behaviours, hidden ads and the click-only media controls, and points at the Aviary
  row in X's left navigation. It appears only for a profile that has never stored settings, so an
  upgrade never sees it, and it respects the reduced-motion preference.
- **Refuse X's ad logging call** is a new sub-toggle of Ad-free mode (on by default, so nothing
  changes for existing installs). It owns the observable half of ad protection, the page-world
  logger stub and the extension's dynamic request rule, while structural suppression stays on
  Ad-free mode alone. X began testing an ad-blocker warning in July 2026 that appears to key on
  refused requests; turning this off keeps sponsored posts hidden while Aviary stops refusing any
  request at all.
- Persisted settings now carry an explicit `schemaVersion` and run through an upgrade ladder.
  `aviary.settings.v1` was a storage slot, not a schema: a renamed key would have been read as
  absent and quietly reset to its default. Settings written by a newer Aviary are detected and
  reported rather than silently rewritten into this build's narrower shape, and a test fails the
  build if the version is bumped without the migration step that performs it.
- Warnings and errors now survive a reload. A bounded 50-entry, 7-day, profile-scoped ring keeps
  Aviary's own message text, the time, and the *names* of a message's detail fields, never their
  values, so no post text, handle, or URL is retained. Trust reports the count and can clear it,
  and **Copy diagnostics** now includes the entries from earlier page loads.
- A boot failure is now visible instead of silent. Where Aviary previously only set
  `data-av-ready="error"` on `<html>`, it now shows a dismissible notice naming the reason and
  stating that X itself is unaffected. It mounts even when the failure precedes `<body>`.
- **Hide thread recommendations** (Layout, off by default) ends a conversation at its last real
  reply by collapsing X's "Discover more" boundary and every suggested post below it. The boundary
  is matched by an exact heading label inside a timeline cell on a conversation route, never by a
  generated class or a loose text fragment, and replies are left untouched.
- Aviary now ships an original cyan-and-violet bird/A logo across Chrome and Firefox toolbar,
  extension-management, permissions-tab, and store icon sizes.
- Chrome and Firefox now expose **Download media with Aviary** in X's native right-click menu.
  The command resolves the clicked image or player through the content script, requests the
  optional download permission from that explicit gesture, and saves the captured direct variant.

### Changed

- Build toolchain moved to ESLint 10.8.1 (ESLint 9 reached end of life on 2026-08-06), esbuild
  0.28.2, and TypeScript 6.0.3. No source, lint-config, or compiler-option changes were required;
  all 357 tests, the release matrix, the build, and preflight pass on the new pins.
- Image, thumbnail, Video, and GIF controls now stay visible over their media with a download arrow,
  solid high-contrast surface, descriptive tooltip, and non-overlapping vertical placement.
- Fresh installs now enable on-post media downloads by default, exposing image, thumbnail, and
  direct Video/GIF controls while keeping every transfer user-initiated and fully reversible.
- Aviary settings now opens from a native-sized row in X's primary left navigation instead of a
  standalone corner button. The row follows expanded and compact rails and remounts after X's SPA
  navigation swaps, with the old launcher retained only as a no-navigation fallback.

### Fixed

- **Absolute timestamps** (Appearance, off by default) replaces X's relative post times with the
  exact date and time, formatted in the panel's locale. The value already exists in each post's
  `datetime` attribute, and Off restores the original text X wrote rather than a relative string
  Aviary invented.
- SPA route changes now come from the Navigation API where the browser has one, instead of
  patching `history.pushState`. The History patch stays as the fallback for engines below the
  January 2026 baseline, and a `navigation` global that cannot be listened to is not mistaken for
  the real API.
- `FeatureModule.defaultEnabled` is gone. Every one of the 27 modules declared it `true`, so the
  registry branch that skipped a disabled module was unreachable and the flag described nothing:
  enablement is decided at runtime by each feature reading its own setting.
- Author matching now reads absolute profile links as well as relative ones. The filter engine's
  handle reader accepted only relative hrefs, so every author read as unknown against the saved
  captures, the reason handle-based filtering had never been exercised against real markup.
- The five right-click media download messages added in this cycle were rendering in English in
  every locale; they are now translated across all nine shipped locales (821/821 per locale).
- README no longer describes the AI command menu as an always-present per-tweet button with no
  network calls. It is off by default, and its optional provider runner does POST once configured.
  The store-archive line no longer implies a store presence Aviary does not have while the Firefox
  manifest still ships a placeholder add-on id. `tests/readme-claims.test.mjs` now fails the build
  when a documented default drifts from `DEFAULT_SETTINGS`.
- The userscript's `@updateURL`, `@downloadURL`, `@namespace`, and `@author` are now derived from
  `package.json`'s declared repository instead of a placeholder organization that never hosted the
  project, so installed copies poll the real location. Preflight fails the build whenever the
  built metablock and the declared repository disagree.
- Download controls now reattach when X recycles a processed post shell with a new media subtree,
  while ignoring ordinary action/count churn that previously made broad reconciliation too costly.
- Nested `videoPlayer` / `videoComponent` wrappers now resolve to one canonical player, preventing
  duplicate overlapping Video or GIF buttons on current X posts.
- Noir now paints its ambient gradient on one fixed root canvas instead of X's viewport-height
  body, eliminating the horizontal background split that appeared after scrolling on any route.

## 1.21.0 (2026-08-14)

### Added

- Chrome and Firefox packages now install one host-scoped dynamic request rule for X's exact
  promoted-content logger. It follows the active `Block ads` setting, survives browser/background
  restarts, and is verified against real browser-owned match and loopback-network behavior without
  intercepting HomeTimeline, media, authentication-shaped, or unrelated requests.
- A dated, privacy-safe ad regression corpus preserves only the current structural contracts and
  synthetic copy for native ads, paid partnerships, promoted trends, Grok/Premium promos, pre-roll,
  and organic negative controls. Browser tests cover cold paint, delayed insertion, virtualized
  cell collapse, disable/re-enable, marker recovery, and SPA reinsertion.
- Selector health now retains a profile-local 64-entry/30-day ring containing only route, time,
  and four ad-marker counts. Trust reports when a formerly observed contract disappears and can
  reset the observations without retaining post text, handles, URLs, or response bodies.
- A committed 60-image desktop settings contract now covers every Control Center destination and
  extension permissions at 1440×900 and 1920×1080 on dark/light hosts, plus keyboard focus,
  invalid, saved, reduced-motion, and disabled states behind a reviewed 1% pixel threshold.

### Changed

- Every Control Center destination now stages settings in an isolated page draft and exposes one
  persistent Save/Revert bar. A save validates the whole page and persists once; failed writes keep
  the draft available for retry, while section/search navigation stays guarded until save or revert.
  Profile switching, profile creation, imports, and other explicit actions remain immediate.
- Hiding the discovery rail now centers the comfortable reading column on full desktop layouts,
  turning the released space into balanced gutters instead of a stranded right-side void.

### Fixed

- Firefox now runs the shared MV3 background bundle as a supported event page, restoring lifecycle,
  options, downloads, and ad-rule message handling. An enabled empty static ruleset preserves
  dynamic-rule behavior on Firefox 128 to 132 without broadening what Aviary blocks.

## 1.20.0 (2026-08-13)

### Added

- Layout controls can independently hide Home's quick composer and Who to follow cards without
  removing the rest of the timeline or discovery rail.
- A Playwright theme matrix exercises Dim, Lights out, Graphite, Plum, Midnight, and Noir against
  both dark and light X host styles at 1440×900 and 1920×1080. It enforces text contrast, complete
  shell paint, single-theme state, overflow safety, and exact Off restoration.
- `npm run capture:theme` now accepts any authored theme id so every palette can use the same
  deterministic desktop capture lane.

### Changed

- Minimal now applies Noir, a comfortable-width timeline, current Follow/Grok/History/Studio/Premium
  navigation cleanup, and the new Home composer/recommendation controls alongside its existing
  count, border, sidebar, filter, and reduced-motion choices.
- Every authored dark palette now repaints semantic navigation, engagement actions, timeline text,
  composer, search, sidebar, and drawer surfaces, so selecting one remains legible even when X's
  host theme is light.
- All six new Control Center strings are translated across Spanish, Portuguese, French, German,
  Japanese, Korean, Arabic, and Hebrew; shipped locale coverage remains 100%.

### Fixed

- Hide trends now collapses current X's complete news and trend module boundaries instead of only
  hiding the zero-height `news_sidebar` marker and individual trend rows.
- Hide Grok now removes the current sidebar promotion, and navigation cleanup recognizes X's newer
  Follow, Chat, Grok, History, and Creator Studio destinations while preserving older saved
  `messages` settings.
- Hide engagement counts now removes the current view metric as well as reply, repost, and like
  numbers while preserving every control and its accessible total.

## 1.19.0 (2026-08-13)

### Added

- **Noir** is a new opt-in premium desktop theme with a near-black blue foundation, restrained
  cyan/violet lighting, a continuous navigation rail, elevated timeline and sidebar cards,
  refined composer/search surfaces, and luminous primary actions.
- A deterministic Playwright theme contract and `npm run capture:theme` lane mount the real theme
  module on a sanitized current-X fixture at desktop sizes, reject generated-class dependencies,
  compositor blur, horizontal overflow, incomplete paint, and irreversible Off behavior.

### Changed

- Theme coverage now spans seven modes across the 2,268-combination release matrix. Noir is
  exposed in Appearance and translated across all nine supported locales; the default remains
  **Off (X's own theme)** so ordinary X styling is unchanged unless selected.
- Noir targets current semantic shell anchors for navigation, primary timeline, composer, media,
  search, news, recommendations, and Grok surfaces while keeping long-feed paints opaque and
  motion restrained.
- The navigation rail now derives a reversible active marker from the current route because live
  X no longer exposes `aria-current` on its active AppTabBar link.

### Fixed

- The live search field now paints its rounded search shell instead of the rectangular inner
  input, and current-X's tiny news marker is no longer mistaken for the full sidebar card.
- Settings captures now refuse to run when the packaged extension manifest is older than the
  current source release, preventing stale versioned screenshots from passing the geometry gate.

## 1.18.0 (2026-08-13)

### Added

- Default-on desktop ad protection now starts at document start. It prevents the separable
  `promoted_content/log.json` request across page `fetch`, XHR, and `sendBeacon`, then removes
  native sponsored posts, paid-partnership cards, promoted trends, X/Grok/Premium house promos,
  and visible video-ad containers without leaving virtualized timeline gaps.
- A deterministic settings-capture lane renders all 13 Control Center destinations plus the MV3
  permissions page at 1440×900 or 1920×1080 and fails on clipped controls, horizontal overflow,
  or panels extending outside the desktop viewport.

### Changed

- Every settings destination now uses one desktop operations-cockpit system: a stable 220 px rail,
  grouped navigation, flatter control rows, page accents, clearer dependency states, restrained
  density, and a permission-health summary on the extension options page.
- Settings edits now expose explicit unsaved state, preserve independent drafts while navigating
  related controls, and block search or section changes until the current edit is saved or
  discarded. Reset copy now states that ad protection remains enabled.
- The i18n extractor follows split Control Center section modules recursively; all 791 catalog
  strings are present in Spanish, Portuguese, French, German, Japanese, Korean, Arabic, and Hebrew.

### Fixed

- Current X route detection recognizes `/i/chat`, profile collection tabs, and settings pages that
  intentionally omit `primaryColumn`, preventing false degraded-state reports on live 2026 routes.
- Ad detection no longer treats `placementTracking` as proof of sponsorship; current organic media
  uses that attribute too. Detection instead requires bounded label, policy-link, tracking-link,
  trend, house-promo, or video-ad evidence and remains SPA-idempotent and reversible.
- Saving one Control Center row no longer clears an unrelated row's draft indicator.

## 1.17.0 (2026-08-12)

### Added

- AI and embedding integrations now disclose their provider, endpoint, fields, retention, and
  request size before external work; configurable per-request and daily UTF-8 byte budgets stop
  further calls, while profile-scoped usage history stores counters only and remains backup-safe.
- Release verification now includes pinned ESLint static analysis across source, tests, and tooling;
  generated bundles and captured fixtures stay outside the lint target.
- Control Center section builders now live under `src/ui/control-center/sections/` behind a typed
  `PanelContext`; focused architecture coverage keeps translation, persistence, action, and
  accessibility helpers on the shared contract while the mount module remains orchestration-only.
- Release verification now includes a deterministic route, locale, theme, input, provider, ZIP,
  and lifecycle matrix plus fixture smoke coverage for profile subroutes, Notifications, Messages,
  Search, status, and the media viewer; externally gated smoke requests now approve the explicit
  AI review dialog before exercising provider success and failure paths.

### Fixed

- Backup & Audit now exports a versioned, profile-scoped full-library JSON with per-collection
  counts and checksums, redacts integration credentials by default, previews conflicts, supports
  dry-run/cancellation, and rolls back a partial restore when a local write fails. Legacy settings
  import remains unchanged.
- Export packages now include a versioned checksum manifest and explicit per-media
  `captured-bytes`, `remote-reference`, or `missing` status. Opt-in media-byte capture records
  successful bodies in the ZIP/WARC and preserves failed items as retryable references; HTML,
  Markdown, CSV, XLSX, JSON, external targets, and WARC output no longer imply that a live URL is
  an offline asset.
- Export ZIPs now include a standalone `viewer.html` with embedded local data, virtualized large-list
  rendering, search/sort/thread/media-status views, safe captured-media links, and built-in locale/
  RTL labels without remote script execution.
- Modal action focus now survives shadow-DOM re-renders reliably, including asynchronous snapshot
  capture and clear operations.
- Library search now uses one bounded offline query model for posts, likes, bookmarks, notes,
  snapshots, archive metadata, and semantic-index records, with Unicode-safe ranking and
  deterministic source/account/date/tag/folder/media filters. The Library section exposes the
  unified search surface and an optional semantic-ranking path.
- Privacy, installation, and FAQ documentation now match v1.16.0 permissions, opt-in network
  integrations, local storage keys, export formats, options-page grants, and uninstall limits;
  a consistency test guards those claims against future release drift.
- AI and composer-snippet popovers now expose controlled menu state, focus their first option,
  support arrow/Home/End/Escape navigation, and restore trigger focus on dismissal.
- Injected Hide, media, bookmark, AI, and snippet controls now receive 44px coarse-pointer hit
  targets with AI/snippet affordances visible without hover; injected toasts and Hide spacing use
  logical RTL-aware placement and direction.
- Secondary file, search, semantic-search, and crosspost-thread controls now expose localized
  visible labels through explicit `aria-labelledby` associations.
- Secondary Control Center rows now translate dynamic archive, bookmark, export, and media-job
  labels and values across all supported locales, including data that only appears when optional
  integrations are present.
- The Control Center now behaves as a real modal: its backdrop consumes pointer input, the page
  is inert while it is open, focus stays inside with Tab/Shift+Tab wrapping, Escape closes it, and
  the localized launcher regains focus on close.
- Versioned local stores now migrate into a browser-native IndexedDB repository when available,
  retain the legacy copy until the transaction commits, fall back visibly when IndexedDB cannot
  open, and expose schema, usage, quota, and migration status in Trust.
- Profile subroutes, filter cleanup/cell reflow, page-bridge session authentication, UTF-8 capture
  limits, bounded archive inflation, durable hidden-post mutations, and serialized raw-capture
  persistence now handle the audited edge cases without false success or stale page state.
- Archive imports preserve the actual tweet author, reports carry the build version, semantic
  embeddings are validated and quota-bounded, and crosspost media downloads enforce streamed size
  limits before upload.
- Page-world subscriptions now rebind to a replacement bridge after teardown, so privacy-hook
  diagnostics and network-capture events continue working across a reboot.
- Aria2, AI, semantic-search, cross-post, attachment, and media-probe requests now share bounded
  abort deadlines, including response-body work, so stalled endpoints settle with a useful error.
- AI command-menu provider failures, including local-only policy refusals, now surface a toast,
  clear the pending state, and close without an unhandled rejection.
- Aria2’s dynamically rendered Cancel action now catches RPC and policy failures, reports status,
  and always restores its enabled state.
- Semantic search now sequences debounced requests, clears empty queries, and ignores stale
  responses or errors from older input.
- Bookmark loading now drops invalid timestamps and repairs partial records before Library sorting,
  so malformed persisted entries cannot crash search.
- Export checkpoints and media download jobs now persist lifecycle state, reclassify interrupted
  work as resumable, and expose pause, resume, cancel, recovery, and retry controls in the Control
  Center.
- Official archive imports now persist their local ZIP source while running, checkpoint records
  before completion, recover interrupted work as paused, and expose pause, resume, cancel, and retry
  actions without retaining completed archive bytes.
- Local settings, credentials, libraries, jobs, captures, and search stores now sit behind an
  explicit profile boundary; switching profiles reloads into an isolated namespace, and legacy
  unassigned data requires a visible one-time assignment instead of route-based account guessing.
- Official X archive imports now classify and preview recognized, skipped, and malformed files;
  typed profiles, account references, direct messages, media references, lists, and follower data
  persist in a separate local collection store while authored posts and likes retain searchable
  checkpoint storage without exposing private messages to public-post search.
- Page-world GraphQL capture now treats page messages as hostile input: same-origin route and
  operation checks, status/byte/timestamp/body validation, UTF-8 and size limits, session budgets,
  and bounded backpressure reject forged, replay-shaped, oversized, or flooding events before
  they reach local persistence.

## 1.16.0 (2026-08-09)

### Added

- Four ImageGen design boards now cover Presets, Reading, Data, and Advanced, providing a durable
  visual reference for every Control Center page under `docs/mockups/`.

### Changed

- Reimagined all 13 Control Center pages around a compact integrated header, slimmer grouped rail,
  page-specific line icon and accent, editorial page heading, two-column control cards, and a
  three-column preset gallery with real override previews. Every existing setting and action
  remains available.
- Toggle rows now use clear switch controls, card and focus states follow each page accent, and the
  local-save state stays visible in a compact footer.
- The responsive shell collapses to a single card column with a horizontally scrollable section
  rail on narrow screens while preserving touch targets, focus behaviour, and zero horizontal
  content overflow.
- The isolated MV3 smoke lane now fulfills a sanitized current-X DOM fixture and exercises
  width tiers, Grok anchors, MSE metadata, RTL direction, reversible toggles, rejected actions,
  store readouts, and selector-health transitions without an authenticated profile.
- The smoke command now also runs a side-effect-free external-action lane in Chromium's new
  headless mode: the real MV3 options page, archive import, clipboard, optional-permission refusal,
  Aria2, AI, embeddings, threaded Bluesky/Mastodon uploads, exports, and cleanup all run against
  local stubs and temporary profiles.

### Fixed

- Runtime feature changes now reconcile already-rendered X content in both directions. Disabling
  media, AI, snippets, link cleanup, original-quality images, offscreen video pausing, or hidden
  posts removes Aviary's markers, listeners, styles, buttons, URL rewrites, and collapsed rows
  without a reload; note edits and snippet edits repaint mounted controls immediately.
- Current X MediaSource players now get a real poster Thumb anchor and a Video/GIF control when
  the page-world GraphQL response exposes a direct variant. Blob-only players remain unavailable
  instead of reporting a false save, with metadata retained in a bounded local cache.
- Hide Grok now covers the current navigation link and per-post “Grok actions” buttons as well as
  the drawer and image-generation entry points, while leaving unrelated navigation and actions alone.
- Comfortable and Wide timeline widths now pin their flex basis as well as width, so current X's
  growing layout keeps the tiers distinct when the sidebar is hidden.
- Arabic and Hebrew now set direction on the Control Center host itself, mirroring the panel rail
  and switches without changing X's document direction.
- Control Center action rows now catch rejected or synchronously thrown callbacks, report failures
  to diagnostics, restore their buttons, and show localized failure status for Aria2 and crosspost
  refusals.
- Snapshot, archive, cleanup, semantic-index, and export mutations now refresh store-derived rows
  immediately while preserving the focused action and scroll position.
- Export query discovery and scroll-capture sessions now reconcile live setting changes: enabling
  discovery runs it once, disabling capture finishes the current job, and re-enabling starts a
  distinct session without duplicate work from concurrent applies.
- Trust now reports route-aware selector health with required and optional counts, stable or
  fallback matches, missing surfaces, affected features, and live healthy/degraded transitions;
  Grok coverage is visible without treating unrelated routes as failures.
- Control Center now exposes bounded editors for navigation declutter, concurrent media downloads,
  download pacing, and selector-health monitoring; changing pacing reconciles the live token
  bucket immediately while blocked-account and self-repost placeholders remain disabled.
- The local bookmark library is now a shipped product surface: rendered posts get a reversible
  Save locally control, and Library search can edit tags, folders, reminders, notes, or remove entries.
- MV3 smoke now exercises every page-hook combination across fresh Home, Following, profile,
  search, and status fixture navigations, with controlled HLS responses and a degraded-selector route.
- Original-quality image mutation now upgrades only `pbs.twimg.com/media` tweet photos; avatars,
  emoji, cards, and stale non-media markers are left untouched or restored during reconciliation.
- Release metadata now stays synchronized across the package, manifests, README, roadmap, changelog,
  and build-stamped Control Center; the panel and README describe shipped snippet insertion and
  current MediaSource limitations accurately.

## 1.15.0 (2026-08-08)

Written from its release commit (`89dc1e1`) on 2026-08-19; the entry was missed when the release
shipped, and the range is `83f4f04..89dc1e1`.

### Changed

- The Control Center was redesigned.

## 1.14.1 (2026-08-08)

### Fixed

- Store-ready Chrome and Firefox ZIP archives are now byte-reproducible. Packaging uses a stable
  DOS timestamp and sorted filesystem entries, so repeated verification builds no longer dirty
  tracked release artifacts when the source has not changed.

## 1.14.0 (2026-08-07)

### Fixed

- **The Save button made photos disappear.** Switching it on removed every image from the
  timeline; switching it off brought them straight back. Aviary's stylesheet forced
  `position: relative` onto `[data-testid="tweetPhoto"]` so the button had something to anchor to.
  X keeps that box at **height 0**, it is a flex container whose two children, the background-image
  div that actually draws the photo and the `<img>` beside it, are both `position: absolute;
  inset: 0`, with the real height carried by an ancestor. Making the zero-height box their
  containing block collapsed both to nothing: loaded, present in the DOM, and invisible.
  Aviary no longer restyles any of X's containers. The button measures its offsets against
  whichever ancestor X has already positioned, the same box the photo itself resolves against,
  and an absolutely positioned child is out of flow, so inserting it cannot disturb the layout
  either. Reproduced and pinned in `tests/media-button-layout.test.mjs`, which fails with
  "the stylesheet changed the photo from 317px to 0px" if the rule ever returns.
- **Turning "Hide posts" on gave you no Hide button.** v1.13.0 made both `hidden.enabled` and
  `hidden.buttons` default to off, so the feature needed two switches and nothing said so. The
  button now follows the feature, still gated by it, nothing is injected while the feature is off.


## 1.13.1 (2026-08-07)

### Fixed

- **Two stylesheets restyled X no matter what your settings said.** `media-buttons` injected its
  sheet from `init()` *before* checking `media.buttons`, so every install, including one with
  every option switched off, got `position: relative` forced onto every `tweetPhoto`,
  `videoPlayer` and `videoComponent`. X anchors the photo itself with `position: absolute` and
  `inset: 0`, so on any layout where the photo box takes its height from a sibling spacer, making
  that box the containing block collapses the image to zero height: loaded, present, invisible.
  The sheet is now injected only while the feature is on, removed when it is switched off, and
  the rule itself is scoped to `html.av-media-buttons-enabled`.
- `i18n-feature` likewise rewrote X's text wrapping (`overflow-wrap: anywhere; word-break:
  break-word` on every tweet and timeline cell) and enlarged its reply/repost/like/bookmark tap
  targets for everyone, with nothing to switch either off. The wrapping override is gone; the tap
  targets now require the `av-touch` class that the mobile feature already manages.
- A test now fails any rule Aviary injects into the page whose selector carries no `av-` class,
  `data-av` attribute or `:host`, the property that both defects violated.


## 1.13.0 (2026-08-07)

### Changed

- **Installing Aviary now changes nothing about X.** A fresh install used to hide the right
  sidebar, hide trends, hide Grok, repaint the page with the "dim" theme, force `color-scheme:
  dark` over X's own setting, add a Hide button and two media buttons to every post, rewrite share
  buttons, and pause video that scrolled offscreen, none of it asked for. Everything that alters
  what X looks like or how it behaves now starts off, and only what you switch on applies. The
  launcher button is the sole exception, because without it nothing can be switched on.
  Invisible local bookkeeping (the action log, selector health, the local-only network guard)
  stays on, because it changes nothing on the page.
- The theme picker gained **Off (X's own theme)**, which is the new default. Choosing it removes
  every hook Aviary paints through, rather than painting a dark theme that happens to resemble X's.
- **Trust → Reset everything to plain X** puts every preference back to that state in one action.
  Saved posts, notes, bookmarks and download history are untouched, it resets preferences only.
  Flipping the defaults alone would have done nothing for anyone who already had settings stored.

### Removed

- **The sensitive-content modes are gone.** They could not tell sensitive media from any other
  media, every rule matched every photo and video, so "blur" smeared the whole timeline and read
  as images failing to load. Scoping them needs a capture containing sensitive media, and neither
  capture holds one. Aviary now leaves sensitive content entirely to X, whose own filter is the
  only thing here that knows which posts are sensitive.

### Fixed

- **The AI button and the snippet trigger injected themselves regardless of any setting.** Neither
  was gated on anything, so a "vanilla" install still put a button on every post, caught by
  counting real elements in a real timeline, not by reading the schema. The AI button now has its
  own toggle (Library → Show the AI button on posts, off by default), and the snippet trigger
  appears once there is a snippet to insert.
- **The launcher became unreadable on X in light mode.** It painted a translucent accent wash
  straight over the page, which only worked while Aviary forced X dark, measured at 1.12:1
  against its own near-white label on a white page. The gradient now mixes into an opaque
  surface, so what is behind it stops mattering.
- **Aviary was clearing X's own `color-scheme`.** X sets `color-scheme: dark` inline on `<html>`;
  resetting the theme wrote an empty string over it, taking X's value with it and flipping the
  page to `normal`. It now clears only the value it set itself.


## 1.12.1 (2026-08-07)

### Fixed

- **"Sensitive content" blurred or hid every photo and video, not just sensitive ones.** The rules
  behind the blur and hide modes match every `tweetPhoto` and video in the timeline; nothing in
  them tests whether X marked the media sensitive. Picking "Blur until hovered" therefore smeared
  the entire timeline at 18px, which reads as images failing to load rather than as a setting.
  Measured against the captured timeline: all three photos affected, none of them sensitive.
  Scoping the rules properly needs a capture containing sensitive media, neither `home.html` nor
  `status.html` contains a single instance, and the one `contentDisclosureButton` in either file
  belongs to the composer toolbar, not a post. Until then the control says what it does: it is
  now **Photos and videos**, offering "Blur every photo and video" and "Hide every photo and
  video".
- **The Media Archivist preset blurred your whole timeline.** It set that mode and described it as
  "sensitive blur", a claim the build cannot keep, since it cannot tell sensitive media apart. An
  archivist preset has no reason to change how media is displayed; it no longer does.
- **Quiet Reader hid engagement counts without saying so.** Its description listed trends, borders,
  premium dimming and t.co cleanup, but not the like and reply counts it also removes. A test now
  fails any preset that hides counts without mentioning them, or that claims to act on sensitive
  media at all.


## 1.12.0 (2026-08-07)

### Added

- **Aviary can now see the page's own network layer**, which three features were designed around
  and none of them could reach. Both manifests gained a second content script declared
  `"world": "MAIN"`, and the userscript reaches the same place through `unsafeWindow`. A bridge
  carries settings in and observations back, and every hook stays off until a setting turns it on.
- **Refuse X's analytics beacons** (off by default, under Trust & privacy). Blocks the tracking
  pings X sends as you scroll, click and pause, across `fetch`, `XMLHttpRequest` and
  `sendBeacon`. A refused beacon is answered with `204` rather than rejected, because a thrown
  request surfaces in X's own error reporting, which is itself another beacon. Only the analytics
  endpoints are matched; the panel reports the running count, so a hook that never fires is
  visibly distinct from one that does not work.
- **Always play video at the highest quality** (off by default, under Performance). X streams
  timeline video through Media Source Extensions, so there is no `src` to rewrite and no
  `<source>` list to re-rank, the rendition is chosen by the player's own adaptive-bitrate logic.
  Aviary now trims the master playlist to its best rendition before the player sees it, so that
  logic has only one thing to choose. Sustained bandwidth decides, not peak.

### Removed

- **`privacy.encryptVault` is gone from the schema rather than implemented.** It had been parked
  on a key-custody decision: a key stored beside its own ciphertext protects nothing, and a
  passphrase-derived key means an unlock step and permanent data loss if the passphrase is
  forgotten. What settles it is scope, Aviary's vault sits in the same browser profile as X's
  own session cookie, auth token and cached media, none of which Aviary can encrypt and all of
  which are more sensitive than its copy. A toggle that encrypted the lesser half would invite
  the belief that the profile was protected. Full-disk encryption covers all of it. Settings
  files from older builds still carrying the key import cleanly.

### Fixed

- **Passive GraphQL capture never saw a single GraphQL response.** It wrapped `globalThis.fetch`,
  which is Aviary's own copy, the content script runs in the isolated world, so X's requests were
  never going to pass through it, and the feature's status line had been reduced to admitting it
  saw nothing but Aviary's own traffic. Payloads now arrive from the page world, where those
  requests are actually visible.
- Captured payloads were recorded in the action log as `export.start`. Captures are not exports;
  they have their own kind now.
- **Every install carried a blocked-account filter that was never applied.**
  `filter.blockedAccounts` defaulted to `hide` while no predicate consulted it, so the setting
  claimed an active filter and every settings export published that claim. It defaults to `off`
  until the filter exists, and a test now fails any filter action that defaults to something
  active while nothing reads it.
- **Four sentences shipped in English in every locale while coverage reported 100%**, the
  empty-search state ("Nothing matches that search.") and both preset confirmations. The string
  extractor learns a panel's copy by rendering it twice and keeping what appears in both, so copy
  behind a condition no render reaches is copy it cannot see. It now also harvests every literal
  passed to `t()` straight from the panel source, which needs no maintenance as rows are added.
  Nine locales, 470 → 488 strings.

## 1.11.0 (2026-08-07)

### Added

- **The Control Center header now shows the running version.** Reloading an unpacked extension
  gave no signal about which build actually took effect without opening `chrome://extensions`;
  the panel you already have open on x.com now says. Stamped in at build time from
  `package.json`, so the userscript and both extension builds report the same number, and a test
  fails if either manifest drifts from it.

## 1.10.0 (2026-08-07)

Drains the 2026-08-07 audit: 25 findings, all closed. Several were features that reported
success while doing nothing.

### Fixed

- **The video Save button was lying.** X streams timeline video through MediaSource, so the only
  variant is a `blob:` handle that no downloader can resolve, and because `blob:` counts as
  same-origin, the anchor fallback returned success with no degraded flag, so the button showed
  "Saved" while nothing reached disk. A blob now loses to any real URL in ranking, a blob-only
  video refuses to resolve, and no button is offered where nothing can be saved. The poster keeps
  its Thumb button. GIFs, which are served as real files, are unaffected.
- **That button was also invisible.** Every hover-reveal rule named `tweetPhoto`, but a video's
  container is the player, so the control sat at `opacity: 0` with no rule that could show it,
  anchored to whatever ancestor X happened to have positioned.
- **Importing an X archive could not read an X archive.** The reader accepted STORE entries only;
  official archives are DEFLATE like every standard zip. It now inflates through the platform's
  own `DecompressionStream`, and verifies the CRC against the inflated bytes.
- **A disabled aria2 integration still called your aria2 on every boot** (the check looked at the
  endpoint string, not the enabled flag), and with local-only mode on, that reconcile threw
  through init, which the registry treats as a dead feature: every Save button disappeared.
- **One boot with a mistyped aria2 secret erased the queued-download ledger.** Any RPC fault
  mapped to "removed", and reconcile deletes those. Only an unknown GID means removed now.
- **"Test connection" queued a junk download every click**, it called `addUri` with a bogus URL,
  which aria2 accepts. It calls `getVersion` now.
- **Crossposts silently lost text.** Bluesky segments were cut at 300 UTF-16 units and the
  remainder posted nowhere; Mastodon was never chunked at all. Both are chunked to their real
  limits now, counted in graphemes and split at word boundaries. A thread that fails partway
  reports how much was already posted instead of inviting a retry that double-posts.
- **Thread mode was almost unreachable**: the composer read used `textContent`, which joins
  Draft.js paragraph blocks with no separator, so the blank-line split never fired.
- **Ten controls rendered in the browser default font.** `font: 700 13px/1.1 inherit` is invalid.
  the shorthand cannot take a CSS-wide keyword as its family, so the whole declaration is dropped.
  The Control Center launcher and every nav item measured Arial 13.33px/400.
- **Saved-post search could not match Japanese, Korean, Arabic, Hebrew or Cyrillic**, the very
  languages the panel is translated into. The tokenizer was ASCII-only.
- **The action log described the wrong events**: a failed crosspost was recorded as
  "export.start", an aria2 cancel as "export.complete". Six event kinds now exist and are used.
- Failed storage *reads* were silent, so a corrupted value read as unset and the next save
  overwrote it for good; aria2 handoff failures fell through to a browser download with no trace;
  the semantic index grew without bound; exports embedded unusable `blob:` URLs; Obsidian
  frontmatter broke on any display name containing a colon or quote.
- The filter engine re-extracted and re-decided every visible post on every mutation batch, its
  processed-stamp check could never hit, because the stamp was invalidated on every apply.
- `aria2.minBytes` could never take effect (no caller measured a size) and had no control in the
  panel; the export "capture as you scroll" path was unreachable; the settings nav rail clipped
  its last item with nothing to say it scrolled.

### Added

- **Aviary now speaks your language everywhere it appears.** The Control Center has been
  localized since v1.8.0, but every control injected into the timeline stayed English, the Hide
  button, media buttons, the AI menu, snippets, account-note badges, and the panel's own preset
  cards. All of it now translates, along with the extension options page, across nine locales
  (452 → 470 strings). The string extractor harvests these call sites from source, since a
  timeline control never renders inside the panel.
- **Visible outcomes for the AI menu and snippets.** Every path used to end in silence, success,
  provider failure and a blocked clipboard all looked identical, because the menu simply closed.
  A shared status toast now names the cause and the fix.
- **Settings that finally do something**: an aria2 size threshold that routes by measured size,
  with its missing panel control.

## 1.9.0 (2026-08-07)

Adds a performance module, three capabilities researched from the high-install X userscripts, and
drains the deferred code review.

### Added

- **Pause video that scrolls out of view.** An IntersectionObserver pauses timeline `<video>` once
  it leaves the screen and resumes it on the way back. A video you paused yourself stays paused:
  pause events are counted rather than flagged, because `HTMLMediaElement.pause()` dispatches its
  event on a later task and a synchronous "am I pausing right now" flag is already false by the
  time the handler runs. On by default, fully reversible.
- **Open Following instead of For you** (off by default). Selects the second home tab on arrival
  at `/home`, identified by position rather than label -- X localises the tab text, so matching
  the word "Following" would only work for English readers. Asserted once per URL, so a deliberate
  switch back to For you survives for the rest of that visit and the preference reasserts when you
  return to the timeline.
- **Show images at original quality** (off by default, because a full-size photo is several times
  the bytes X serves for the slot). Points the downloader's existing `name=orig` normalisation at
  the displayed `src`. If the original-quality URL fails to load -- X does not hold an `orig`
  rendition for every media item -- that image reverts to the URL X served, so the worst case is a
  softer photo rather than a broken one.
- **Timeline width** and **Restore the Chirp font**, in Appearance. Both settings already existed
  in the schema and had round-tripped through the normalizer for two releases while no code read
  them and no control exposed them -- the same defect class as the four found in the v1.8.0 audit.
- A **Performance** section in the Control Center, and a settings sweep that finds this class of
  dead setting. Three remain, each blocked on evidence rather than effort; see Roadmap_Blocked.md.

### Fixed

- **51 status messages had never been translated in any locale.** The string extractor anchored
  its status harvest on the literal immediately after `save(`, which misses
  `save(checked ? "X on" : "X off")` -- the form nearly every toggle uses. The catalog is now
  401 strings across 8 locales.
- **The string extractor had been silently degraded by the v1.8.0 nav rail.** The panel draws one
  section at a time and the coverage tally resets per render, so a single render reported only the
  default section: 26 strings where there had been 254. It now visits every section and unions the
  results, and fails loudly if the nav is missing.
- **Passive GraphQL capture no longer claims to be capturing X's traffic.** Neither manifest
  declares `world: "MAIN"`, so the content script runs in the isolated world and X's own requests
  never pass through its `fetch` wrapper. The status said "Capturing GraphQL"; it now says what is
  actually observable. The same constraint blocks two roadmap items, recorded in Roadmap_Blocked.md.
- **Query-ID discovery no longer serialises the whole DOM at boot.** It scanned
  `documentElement.outerHTML` -- megabytes of string allocation -- for a pattern that matches zero
  times in either captured page, because X's query IDs live inside bundled JS that is referenced by
  URL and never inlined.
- **Bookmark ids could collide, and `remove()` deletes by id** -- so removing one saved bookmark
  could take a second with it. The id ended in `entries.length`, which is pinned to the limit once
  the store is trimming, making two bookmarks saved in the same millisecond identical. The cleanup
  queue had the same id defect, where it sent a review to the wrong item.
- **`CleanupQueue.destructiveAllowed()` was a recorded intention, not a gate** -- it returned false
  and nothing consulted it, so the no-destructive-actions guarantee held only by the accident that
  no such code had been written. There is now an `assertDestructiveAllowed()` that fails closed.
- Clearing the cleanup queue before its stored state was read reset the destructive-execution
  record; a stored item with an unrecognised status is now rejected instead of being carried
  forever against the limit.

## 1.8.0 (2026-08-06)

Drains the audit findings left open by the v1.7.0 pass.

### Added

- **The Control Center is actually localized.** All nine locales are complete: every one of the
  310 panel strings, labels, descriptions, select options, buttons, toasts and error copy, is
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
  `focusin`/`focusout` only, no key handlers, and hovering a faded row brings it back.
  Quiet Reader and Minimal turn borders off again; Creator turns writer mode on.
- **Extension options page.** A dark, self-contained page (toolbar icon, or Extensions → Aviary →
  Options) reports the live grant state of the optional `downloads` permission and the
  `pbs.twimg.com` / `video.twimg.com` media hosts, and grants or revokes either. This is the
  surface `chrome.permissions.request` needs, it only resolves from a user gesture on an
  extension page, which a content script is not. Preflight fails the build if the page is missing,
  declares inline script, or is dropped from a manifest.

- **Every failed write is reported, not just three stores'.** The storage gateway now notifies a
  diagnostics sink before rethrowing, so the nine call sites that deliberately wrap `set()` in an
  empty `catch` keep working while their failures stop being invisible, `CheckpointStore`,
  bookmarks, the cleanup queue, the semantic index, the Aria2 history and query discovery
  included. Any store added later gets this without plumbing a sink through its constructor.
- **Failed writes are no longer silent.** `MediaHistory`, `AuditLog` and the hidden-post store
  swallowed every persistence error, so a full browser store degraded to "changes stop sticking".
  It looked like an ordinary bug. All three now take a persistence-error sink wired to diagnostics,
  and the Trust section carries a **Saving** row that reads "Working, every change has been
  written." or names the failure and its count. Writes stay best-effort: a failed write still
  resolves rather than throwing into the caller.

- **`jobs.rateLimitMode` now paces a batch instead of only resizing a bucket.** `ctx.limiter` was
  built in `main.ts` and handed to every feature, and no feature ever drew from it. The media
  batch, the one path that fires hundreds of requests at X's media hosts back to back, now
  takes a token per download. The mode sets both the burst and the sustained rate (conservative
  4/1s, standard 8/4s); the old fixed 0.5/s refill would have made a 200-item batch look hung.
- **`waitForToken` no longer hangs on an impossible request.** Asking for more tokens than the
  bucket's capacity could never be satisfied, because refill clamps at capacity, it spun
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
  stripped on X hosts, they are ordinary parameter names elsewhere, and removing them would
  break real links. `t.co` URLs are left alone because their path *is* the identifier. Verified
  in Chromium: late-arriving rows are cleaned too, and destroy restores every original href.

- **`privacy.localOnly` is a real switch.** It defaulted to `true` while every integration made
  network requests, so the setting and the behaviour disagreed about what the product promised.
  It now gates the outbound path of Aria2, Bluesky, Mastodon, the AI provider and embeddings, and
  Trust carries a **Local-only mode** toggle. The guard sits at each integration's entry point
  rather than at each `fetch`, so a blocked call fails once, before any credential is attached.
  Upgrading with a configured integration clears the flag, enabling an integration was already
  the opt-in, and silently breaking a working setup would be worse than the inconsistency.

- **Non-ASCII paths survive extraction.** The ZIP writer emitted UTF-8 filename bytes without
  setting general-purpose bit 11, so a conforming extractor had to read them as CP437: a save
  folder named `Recherché-アーカイブ` unzipped as `Recherch├⌐-πéóπâ╝πé½πéñπâû`. Reproduced with
  Python's `zipfile` and fixed by flagging the encoding in both the local and central headers;
  the same extractor now round-trips the name exactly, with CRCs intact. (.NET and Explorer
  always guessed UTF-8, which is why this was invisible on Windows.)
- **The ZIP writer fails loudly at its 32-bit ceilings.** Entry counts, entry sizes, name lengths
  and the central-directory offset are written with `setUint16`/`setUint32`, which truncate
  silently, past those limits the archive was still produced and simply unzipped to the wrong
  thing. Each now throws a `RangeError` naming the limit rather than emitting a corrupt file.

- **A CRLF in a scraped value can no longer corrupt a WARC.** `WARC-Target-URI` and
  `Content-Type` were interpolated unsanitised, and WARC headers are CRLF-delimited, so a
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
  section being viewed, the same panel opens at **one screen** instead of nineteen, and the
  panel widened to 780px so descriptions stop wrapping to four lines.
- **Settings search.** Specified in the original F002 and never built. Typing filters rows across
  every section at once, grouped under the section each match came from, with an empty state that
  points back at the rail. Matching runs against the rendered row text, so a row added later is
  searchable the moment it exists and a label edit cannot drift from a keyword list. The field
  sits in the panel chrome rather than the re-rendered body, so typing keeps its caret.
- **Below 760px the rail becomes a horizontal chip strip**, keeping every section one tap away
  instead of behind a menu, with 44px targets.
- **The panel chrome now follows the locale.** The search placeholder and the status line were
  built once at mount and never repainted, so they stayed English in every other language, and
  because `render()` resets the coverage tally, mount-only strings never reached the catalog at
  all. Both now repaint per render and are translated in all nine locales.

- **Preset descriptions no longer promise ad-hiding.** Quiet Reader and Minimal both advertised
  "no promoted" while nothing implemented it. Detection turns out to need a capture Aviary does
  not have: `[data-testid="placementTracking"]` is not an ad marker, in `_decoded/home.html`
  both instances wrap organic content (a quote-tweet video and the news sidebar), and "Promoted"
  appears nowhere in either fixture. The copy is corrected and the feature is parked with its
  re-entry condition rather than shipped on a selector that would hide real posts.

### Decided

- **No Escape-to-close handler.** The open question was whether standard dialog dismissal should
  be an exception to the no-keyboard-handlers rule. It should not: the panel is non-modal, and
  the keyboard path is already complete without one, the launcher is reachable in two Tabs,
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
  navigated, while the button said "Saved". The background now distinguishes a missing permission
  from a real failure, the downloader throws instead of falling through, the button reads "Allow"
  and opens the grant page once per session, and a batch stops at the first permission error rather
  than repeating it hundreds of times. A cross-origin anchor fallback now reports "Opened".

Full engineering, security, UX, accessibility and theming audit. Findings left open are
listed at the end of ROADMAP.md.

### Fixed, correctness

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

### Fixed, security and data safety

- CSV export escapes leading `=`, `+`, `-` and `@` so attacker-controlled post text cannot
  execute as a formula when the export is opened in a spreadsheet.
- Settings export redacts the Aria2 secret, Bluesky app password, Mastodon token and both API
  keys; importing a redacted file keeps the values already stored locally. A full export is
  available behind an explicit opt-in.
- Credential fields render masked with an explicit Show/Hide toggle instead of plain text.
- HTML export drops non-http(s) hrefs rather than writing them into a file opened from disk.
- Captured GraphQL payloads also scrub `auth_token`, `guest_id` and `csrf_token`.

### Fixed, accessibility

- The closed panel is inert; all 137 of its controls were previously focusable inside an
  `aria-hidden` container, so keyboard users tabbed into an invisible settings panel.
- The default dim theme rendered every row description, section title and the status line at
  3.96:1. Its muted token now measures 5.26:1, clearing the 4.5:1 AA floor.
- Touch targets in the panel meet 44px. The touch and viewport rules were being written into
  `document.head`, where they could not reach the panel's shadow root at all.
- "Reduced motion" gained a control, the setting previously had no UI, and now reaches the
  panel and toast, which a page-level class cannot style across a shadow boundary.
- The per-post Hide control rests at a legible opacity instead of 1.56:1, and is fully opaque
  on devices with no hover.
- Engagement counts can be hidden without hiding the buttons; their aria-labels still carry
  the totals.

### Fixed, UX and visual

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

## 1.7.0 (2026-08-06)

Written from its release commits (`b7adb59..2952c0a`) on 2026-08-19; the entry was missed when the
release shipped.

### Fixed

- Settings export no longer leaked the credentials it carried: `docs/PRIVACY.md` had claimed no
  passwords were stored while Aviary kept a Bluesky app password, a Mastodon token, an Aria2 secret
  and two API keys in settings. The data map was rewritten to list all fifteen storage keys, to
  separate X credentials (never touched) from integration credentials the user supplies, and to
  explain the redaction behaviour and its limits.
- The closed panel was kept out of the tab order, and preset descriptions were corrected to match
  what the presets actually do.
- The settings panel became usable on touch, in every theme, and with secrets hidden.
- Page churn no longer broke the settings panel or an export in progress.

### Changed

- README corrections: the extension download path does not request the optional `downloads`
  permission, so the anchor fallback is what runs and cross-origin media opens in a tab instead of
  saving; XLSX was described as deferred when it ships; settings export was described without
  mentioning it contained credentials; the privacy section was pinned to a stale v0.3.0 claim.

## 1.6.0 (2026-08-06)

- Added a per-post Hide control that remembers the post locally and keeps it collapsed on every later visit, so the next post is promoted instead of leaving a gap.
- Added the `aviary.hiddenPosts.v1` store with status-id keys, a handle+text signature fallback for posts without a `/status/` link, oldest-first eviction at a configurable cap, and a 20-deep session undo stack.
- Added an undo toast after each hide, plus Control Center "Undo last hide", per-post Restore for the eight most recent hides, and "Clear hidden posts".
- Added the Control Center "Hidden posts" section: master switch, per-post button toggle, per-route activation chips, and the remembered-post cap.
- Added `post.hide`, `post.unhide`, and `post.hide.cleared` audit actions.

## 1.5.0 (2026-08-03)

- Added opt-in CheckpointStore retention controls for maximum jobs, records per job, and job age, with boot-time and new-job sweeps.
- Added persisted Aria2 gid history and cross-session duplicate suppression, including completion/error reconciliation through `aria2.tellStatus`.
- Added explicit Bluesky image upload and Mastodon media upload for the last successful Aviary download, including first-post-only thread attachment.
- Added the default-off “Attach last download” Control Center toggle.
- Added pinned Playwright 1.62.1 smoke CI with cached browser binaries and isolated Xvfb execution; local smoke profiles are temporary and cleaned up.
- Kept F032/F033 blocked pending authenticated `_decoded/` fixtures.

## Roadmap archive, 2026-08-10, ROADMAP.md

<details>
<summary>Original roadmap snapshot</summary>

````markdown
# Aviary ROADMAP

Version: `1.16.0`
Research date: 2026-05-19
Target repo: `<repo root>`
Target sites: `x.com`, `twitter.com`, `mobile.twitter.com`, `pro.x.com`, `tweetdeck.twitter.com`
Implementation status: **v1.16.0 is implemented.** The current release includes the redesigned 13-page Control Center, current-X MV3 compatibility coverage, route-aware selector health, live-toggle reconciliation, local bookmarks, scoped original-quality image rewriting, and side-effect-free externally gated-action coverage. F032/F033 remain blocked behind authenticated fixtures. Earlier baseline summary:

> **v1.5.0 was implemented.** The release adds opt-in CheckpointStore retention (`aviary.retention.maxJobs`, `maxRecordsPerJob`, `maxAgeDays`), persisted Aria2 gid history with completion/error reconciliation, Bluesky image and Mastodon media uploads for explicit crossposts, the default-off "Attach last download" toggle, and a pinned Playwright 1.62.1 smoke workflow with cached browsers and isolated execution. F032/F033 still need authenticated `_decoded/` fixtures. Earlier baseline summary:

> **v1.3.0 was implemented:** A new `settings.integrations` envelope holds Aria2 / Bluesky / Mastodon / AI / semantic-search configuration; every integration defaults to disabled and only acts when the user provides credentials. `features/integrations/aria2.ts` adds a JSON-RPC client + `shouldHandoffToAria2` threshold check; `Downloader` now picks Aria2 first when enabled and the request exceeds `integrations.aria2.minBytes` (F056). `features/integrations/crosspost.ts` provides Bluesky AT-protocol `createSession` + `createRecord` and Mastodon `POST /api/v1/statuses` clients, surfaced as two Control Center actions that send the current composer text (F077). `features/integrations/ai-provider.ts` adds `runAiPrompt` with adapters for Anthropic Messages and OpenAI-compatible chat completions; the local AI command menu (`features/ai/command-menu.ts`) now routes prompts through the provider when the integration is enabled and copies the response to the clipboard, when it isn't, the prompt itself is copied (F083). `features/integrations/semantic-search.ts` adds `SemanticIndex` with on-demand embedding fetch + cosine ranking, persisted under `aviary.semanticIndex.v1` (F067). The Control Center "Integrations" section surfaces every endpoint / token field plus a "Test Aria2 connection", "Rebuild semantic index", semantic search input, and clear-index action. F099 Playwright live smoke still requires `playwright` + browser binaries and remains queued for v1.4+. Earlier baseline summary:

> **v1.2.0 was implemented:** Batch profile-media downloader walks every visible tweet and pipes photos / videos / GIFs / thumbnails through the existing queue with per-mode concurrency, history dedup, and audit logging (F048 + F049). `export/warc.ts` writes ISO-28500 WARC/1.1 records that wrap captured `ExportRecord` payloads + media URLs for archival tooling (F071). `export/external-targets.ts` renders the same records as clipboard Markdown / Obsidian frontmatter Markdown / Notion-friendly Markdown / raw JSON, surfaced as Control Center actions (F069). `ai/command-menu.ts` adds a tweet-toolbar AI button that opens a four-command menu (Translate / Summarize / Explain / Fact-check prompt) and copies the assembled prompt to the clipboard, no network calls, no API keys required (F082 baseline). F099 Playwright live smoke, F067 semantic search, F056 native companion + Aria2 handoff, and F077 crosspost still need third-party binaries / accounts / tokens; they remain queued for v1.3+. Earlier baseline summary:

> **v1.1.0 was implemented:** XLSX format ships via a tiny SpreadsheetML writer that reuses the STORE-only ZIP encoder (F058 finishing). `library/bookmarks.ts` adds a persisted bookmark library with tags / folders / reminders / due-time queries (F068). `export/network-capture.ts` ships a guarded passive `fetch` interceptor that records GraphQL response bodies into the CheckpointStore as a `capture-<operation>` job when `export.preserveRawPayloads` is `true`, caps payloads at 1.5 MB, scrubs `ct0` cookies and bearer tokens, and uninstalls cleanly on toggle (F091 stage 2). `composer/composer-snippets.ts` adds a Snippets button next to `[data-testid="toolBar"]` that opens a popover and inserts via `document.execCommand("insertText")`, no keyboard simulation (F075 insertion). F048/F049 batch media and F099 Playwright smoke remain queued for v1.2+. Blocked-account (F032) and self-repost (F033) filters stay deferred until authenticated fixtures land.

Earlier baseline summary:

> **v1.0.0** shipped competitor parity: Competitor-baseline parity lands as: 6 preset packs (Quiet Reader, Media Archivist, Creator, Researcher, Classic, Minimal) with a Control Center applier + delta describer (F104); 9-locale i18n bundle with translate / fallback / RTL direction reporting wired through an `av-rtl` / `av-ltr` HTML class + lang-aware tweet text direction CSS (F095 + F096); mobile + touch ergonomics module with `pointer:coarse` and `(max-width: 760px)` media-query classes, larger action targets, and a wider Control Center panel below 760px (F097); read-only Cleanup Review Queue with explicit `destructiveAllowed()` returning `false` by policy in v1.0.0, persisted through the storage gateway, never deleting account data (F079 / F080 safe slice). Media batch downloader (F048/F049) stays parked for v1.1+ since it requires walking long profile-media routes and live network capture. XLSX, F068 bookmark tags, F091 stage 2 (active GraphQL capture), composer insertion, and F099 Playwright also carry forward to v1.1+. Blocked-account (F032) and self-repost (F033) filters remain parked behind missing authenticated fixtures.

## Project Overview

Project name: `Aviary`

One-line pitch: a local-first, premium dark-mode X/Twitter enhancer that unifies the best control-panel, old-layout, media-download, export/archive, filtering, analytics, accessibility, and safety features into one reversible userscript-first product with an optional MV3 extension build.

Chosen vehicle:

| Vehicle | Role | Rationale |
|---|---|---|
| Userscript | Primary v1 delivery | Single-file portability, fast iteration, readable source, Greasy Fork/OpenUserJS distribution, direct SPA decoration, `unsafeWindow` hooks where available, and lower setup friction. |
| MV3 extension | Secondary build target | Required for Chrome/Firefox/Edge stores, `chrome.downloads`, optional permissions, `declarativeNetRequest`, side panel, context menus, background queues, and polished non-technical installation. |
| Native companion | Later optional add-on | Only justified for heavy media muxing, Aria2/gallery-dl/yt-dlp handoff, WARC/WACZ conversion, very large archive search, or local model workflows. Keep v1 valuable without it. |

Product philosophy to preserve:

| Principle | Roadmap implication |
|---|---|
| Dark premium UI only | Ship deep dark/OLED/dim palettes, glass-style panels where technically safe, dense mode, branded accent, and custom scrollbar. Do not add a light theme. |
| No keyboard shortcuts | Every command is visible as a button, menu item, toggle, or toast action. Competitor hotkey features are rejected or converted to pointer/touch affordances. |
| No confirmation dialogs | Use immediate action, progress, cancel, undo where possible, protected lists, and toasts. Destructive batch actions use a review queue, not modal confirmations. |
| Everything is reversible | Every feature exposes `init()` and `destroy()` and cleans DOM nodes, CSS classes, observers, timers, monkey patches, network hooks, and event listeners. |
| Stable selectors first | Prefer `data-testid`, `role`, `aria-*`, routes, and structural anchors. Hashed classes are health checks and fallbacks only. |
| Local-first privacy | No account tokens leave the browser. No telemetry by default. Imports, archives, settings, and logs stay local unless the user explicitly exports them. |
| Userscript readability | Single-file build must remain auditable, with source sections, version metadata, update URL, and no minified-only distribution. |
| TrustedTypes ready | All HTML injection goes through one policy wrapper. Prefer `createElement`/text nodes for host-page DOM. |

## State Of The Repo

Internal memo from Phase 0:

| Area | Current state |
|---|---|
| Git state | Git repository with the `origin` remote on GitHub; work lands as conventional commits on `main`. |
| Source code | TypeScript scaffold exists under `src/` with shared userscript/MV3 entry points, platform primitives, feature registry, and selector diagnostics. |
| Build system | npm with TypeScript and esbuild dev dependencies. `npm run verify` type-checks, runs tests, and builds userscript plus MV3 extension folders. |
| Top-level docs | `README.md`, `ROADMAP.md`, `PROJECT_STATE.md`, and `LICENSE` exist. |
| Runtime target | Browser-hosted JavaScript: readable userscript first, MV3 extension second. |
| Ground-truth fixtures | Two MHTML captures plus decoded HTML/CSS in `_decoded/`. These are the only local evidence for the current X DOM. |
| Current deliverable | v0.1.0 through **v1.16.0** are complete. v1.6.0 added per-post hide-and-remember with virtualizer-aware collapse, and v1.16.0 adds current-X compatibility coverage plus the latest UI, media, settings, reliability hardening, and local external-action smoke coverage. F032/F033 stay parked behind missing authenticated fixtures. |

Roadmap progress:

| Version | Status | Notes |
|---|---|---|
| v0.1.0 | Complete | License, README stub, TypeScript/esbuild scaffold, userscript/MV3 entries, feature registry, settings schema, TrustedTypes helper, selector-health feature, fixture tests, CI, and dependency policy are implemented. |
| v0.2.0 | Complete | Shadow DOM Control Center, persisted settings updates, theme foundation, document-start dark theme state, dim/OLED-compatible tokens, reduced motion, and focus/ARIA contract checks are implemented. |
| v0.3.0 | Complete | Layout declutter classes, sidebar/trends/Grok hiding, selected nav hiding, privacy manifest, and optional permission shell are implemented. |
| v0.4.0 | Complete | Filter engine (`src/features/filtering/`): per-tweet keyword/regex predicates, premium/verified action, photo/video/GIF media-type filter, route-scoped (`filter.surfaces`) timeline-position gating, whitelist, master toggle, hide/dim CSS states. Processes added tweet articles only, never scans the full document on each mutation, and reverses cleanly when filters are disabled or the feature is destroyed. F032 (blocked accounts) and F033 (self-reposts) are parked behind authenticated fixtures and surfaced as a Control Center readonly row. |
| v0.5.0 | Complete | One-click media (`src/features/media/`): per-tweet Save/Thumb buttons that normalize image URLs to `name=orig` (F041 + F043 baseline), templated filenames via `renderFilename` with `{handle}/{tweetId}/{mediaId}/{index}/{total}/{date}/{text}/{ext}` (F045), persisted dedup history with eviction (F046), in-memory job queue with status counts (F050), and video poster thumbnail download (F044). Userscript path uses `GM_download`; extension path messages the background service worker which dispatches `chrome.downloads` with `conflictAction: uniquify`; anchor fallback handles everything else. Buttons live only inside the tweet photo container and respect the master toggle. |
| v0.6.0 | Complete | Video / GIF download + media presentation: `video-extract.ts` picks the highest-bitrate variant from available media metadata, detects GIF-style players (loop+muted or `tweet_video/` URLs), and feeds the existing downloader/queue/history pipeline (F042). `media-presentation.ts` applies reversible media-layout (default/stacked/grid) classes from settings (F022); sensitive-content modes were removed in v1.13.0 because Aviary cannot identify sensitive posts reliably. ZIP chunking (F047) and save-location memory (F051) are intentionally rolled into v0.7.0 with the export-core work where batch scale starts to matter. |
| v0.7.0 | Complete | Export core (`src/features/export/`): DOM-based passive collector for visible tweets, persisted CheckpointStore with record dedup (F057, F059), JSON/CSV/HTML/Markdown formatters (F058, XLSX deferred to v0.8.0), from-scratch STORE-only ZIP encoder with IEEE-802.3 CRC32 (F047), passive GraphQL query-ID discovery over loaded scripts (F061), and Control Center actions for "Export visible tweets" and "Copy diagnostics" (F102). Save-folder hint (`media.lastSaveFolder`) is wired through into the ZIP filename and entry prefix (F051). Active fetch/XHR interception for full GraphQL response capture (F091) is intentionally deferred to v0.8.0 so the trust contract stays untouched in this release. |
| v0.8.0 | Complete | Archive completeness: collector extensions for image alt-text, polls, quote-tweet wrappers, embedded article cards, and Birdwatch context (F054 + F064). `collectProfileAbout` scrapes `/handle` route metadata (F063). `AuditLog` ring buffer records media downloads, exports, settings roundtrips, and diagnostic copies (F092). Settings import/export via JSON envelopes with normalization + version warnings (F009). XLSX and F091 stage 2 are explicitly rolled into v0.9.0+ since they need binary spreadsheet tooling and a network-interception trust review respectively. |
| v0.9.0 | Complete | Library + power UX (focused slice): `library/user-notes.ts` persists per-handle notes with reversible Note badges + Control Center editor (F027); `library/link-unshorten.ts` rewrites visible `t.co` redirects to their destinations and restores original text on destroy (F074); Control Center "Library" section adds a `composer.snippets` textarea editor (F075 editor). XLSX, F066 local search, F068 bookmark tags/folders/reminders, F091 stage 2, and the snippet-insertion path are explicitly deferred to v0.10.0+. |
| v0.10.0 | Complete | MV3 store hardening: `tools/build.mjs` produces STORE-only `dist/extension-{chrome,firefox}-v<version>.zip` archives (F100); `tools/preflight.mjs` enforces manifest version sync, no `<all_urls>`, no `unsafe-eval`/`wasm-eval`, no `eval()`/`new Function()` in compiled bundles, pinned devDependencies, and the source-policy contract (F089 + F090); `docs/INSTALL.md` + `docs/FAQ.md` document every install path and the privacy contract (F101). `npm run verify` chains `typecheck → test → build → preflight`. F099 Playwright smoke needs a separate dev dep and carries forward. |
| v0.11.0 | Complete | Advanced data + cleanup preview: `library/snapshots.ts` + feature module persist follower / following snapshots (F065); `export/zip-reader.ts` + `library/archive-import.ts` ingest official X archive ZIPs into the CheckpointStore (F070); `library/cleanup-preview.ts` reads-only classifies records by bucket and respects the whitelist (F079); `library/reports.ts` emits Markdown audit + snapshot diff + cleanup bundles (F072); `library/local-search.ts` indexes the CheckpointStore and is wired into the Control Center "Snapshots & Archive" section (F066). Carry-overs (XLSX, F068, F091 stage 2, composer insertion, F099 Playwright) roll to v1.0.0. |
| v1.0.0 | Complete | Beats every competitor baseline: 6-preset pack (Quiet Reader / Media Archivist / Creator / Researcher / Classic / Minimal) with delta describer (F104); 9-locale i18n bundle with translate + fallback + RTL/CJK direction (F095 + F096); mobile + touch ergonomics media queries with bigger action buttons and panel sizing (F097); read-only cleanup review queue with `destructiveAllowed() === false` by policy (F079 / F080 safe slice). F048 / F049 media batch downloader carries forward to v1.1+. |
| v1.1.0 | Complete | XLSX format via SpreadsheetML over the existing STORE-only ZIP encoder (F058 finishing); `library/bookmarks.ts` persisted library with tags / folders / reminders + due-time queries (F068); `export/network-capture.ts` guarded passive GraphQL interceptor (F091 stage 2) capped at 1.5 MB and auth-scrubbed; `composer/composer-snippets.ts` Snippets button + popover with `execCommand("insertText")` insertion into `[data-testid="tweetTextarea_0"]` (F075 insertion). F048/F049 media batch + F099 Playwright smoke remain queued. |
| v1.2.0 | Complete | Batch profile-media downloader F048/F049 (queue + concurrency + history dedup + audit), WARC export F071 (ISO-28500/1.1), external export targets F069 (clipboard Markdown / Obsidian frontmatter / Notion / raw JSON), AI command menu scaffold F082 (local prompt builder, clipboard-only, no API calls). |
| v1.3.0 | Complete | Integration scaffolds, all opt-in: Aria2 JSON-RPC handoff (F056), Bluesky AT-protocol + Mastodon crosspost (F077), provider-backed AI runner, Anthropic Messages / OpenAI / OpenAI-compatible (F083), semantic search with on-demand embedding fetch + cosine ranking (F067). Settings hold endpoint / API key fields per integration; URLs are validated and only `http://`/`https://` allowed. |
| v1.4.0 | Complete | Aria2 sweep + cancel (`aria2.tellActive`/`aria2.remove`), thread mode for Bluesky + Mastodon crosspost (`splitForThread`, `reply.root/parent` + `in_reply_to_id` chaining), `recentIntegrationErrors` audit-log readout, auto-embedding on every export (`integrations.semanticSearch.autoIndex`), Playwright smoke spec scaffold + `npm run smoke`. |
| v1.5.0 | Complete | CheckpointStore retention, persisted Aria2 gid history, explicit Bluesky/Mastodon media uploads, default-off crosspost attachment, and cached isolated smoke CI. |
| v1.6.0 | Complete | Per-post hide-and-remember with virtualizer-aware row collapse, undo, persisted `aviary.hiddenPosts.v1`, and a Control Center management section. |
| v1.8.0 to v1.16.0 | Complete | Incremental hardening and current-X delivery: reproducible archives, runtime reconciliation, current MediaSource controls, Grok coverage, width/RTL fixes, action failure reporting, live export sessions, advanced settings, route-aware selector health, local bookmarks, hidden fixture smoke coverage, scoped original-quality image mutation, and externally gated-action coverage. See `CHANGELOG.md` for each release entry. |

Original capture tree from research baseline:

```text
<repo root>
|-- Home _ X.mhtml
|-- ROADMAP.md
|-- Status _ X.mhtml
`-- _decoded
    |-- home.00.cid_css-537e3a48-e7aa-423d-966a-081f8cfdf0f1_mhtml.blink.css
    |-- home.01.cid_css-8d327502-3c64-409c-b19b-61f18adcad45_mhtml.blink.css
    |-- home.02.cid_css-dec10014-71b1-421d-8685-9aa9b1234e8e_mhtml.blink.css
    |-- home.03.cid_css-c4da9c98-eadd-47df-8209-9755e36440f1_mhtml.blink.css
    |-- home.04.cid_css-18e730c4-c219-424c-b9cc-4a6bcd8be4ae_mhtml.blink.css
    |-- home.05.cid_css-e801a260-b105-4888-a877-47c31958ffd7_mhtml.blink.css
    |-- home.06.cid_css-4f2ad719-26e0-41f1-8153-4d62fe2c7ca4_mhtml.blink.css
    |-- home.07.cid_css-4a8d4aee-5d3f-4eff-9b0d-437403b38acf_mhtml.blink.css
    |-- home.08.cid_css-3879a3a4-39f9-4b83-a977-cec60aea6b33_mhtml.blink.css
    |-- home.09.cid_css-244fac10-3497-45d9-83a5-fa8bc275c0cb_mhtml.blink.css
    |-- home.10.cid_css-2c58579f-e602-4052-97bd-1c76624c1edc_mhtml.blink.css
    |-- home.html
    |-- status.00.cid_css-57ead825-c1f4-4fdf-9dda-7a14c89b9157_mhtml.blink.css
    |-- status.01.cid_css-31a3c85f-06a5-437b-8f65-46c7df105c0b_mhtml.blink.css
    |-- status.02.cid_css-fa80ef7c-29ac-4dab-abaa-0a6f6ec459b6_mhtml.blink.css
    |-- status.03.cid_css-5fa0a2a1-223f-4f33-9430-8ee4041200af_mhtml.blink.css
    |-- status.04.cid_css-76c640e3-5284-44fc-be52-6a6e265cc4d3_mhtml.blink.css
    |-- status.05.cid_css-d93bfd3e-6cb6-45ce-bf94-7b11ad905db6_mhtml.blink.css
    |-- status.06.cid_css-1c266179-0b24-4a7e-a39f-dd0ff1c9c183_mhtml.blink.css
    |-- status.07.cid_css-4d8473c4-30f3-419d-aa62-69ef11002ffc_mhtml.blink.css
    |-- status.08.cid_css-1fabc71c-971a-468a-ae35-b54a166c354a_mhtml.blink.css
    |-- status.09.cid_css-4cc12d5e-c247-4f52-9569-5787f15f2adf_mhtml.blink.css
    `-- status.html
```

Manifest/dependency fingerprint:

| Fingerprint | Result | Constraint |
|---|---|---|
| JavaScript/TypeScript source | None yet | The roadmap must define a future toolchain rather than refactor an existing one. |
| Package manager | None yet | Start with dependency-minimal userscript; add a locked Node toolchain only when moving to dual builds. |
| License | None present | Phase 0.1 must choose a license before publishing any code. MIT is compatible with many sources, but GPL-derived code must not be copied into MIT code. |
| Tests | None yet | First implementation phase must add fixture tests using local MHTML/decoded HTML. |
| CI | None yet | CI belongs in the first scaffold phase, but not this planning run. |
| Commit history | Unavailable | No recurring local pain points can be inferred from commits. Use competitor issues/community signals instead. |

TODO/FIXME scan:

| Scope | Result |
|---|---|
| Repo source/docs | No meaningful source TODOs exist because there is no source. |
| MHTML/decoded HTML/CSS | Raw text contains unrelated words like `placeholder` and base64 fragments; no repo-authored TODO/FIXME/HACK/XXX items were found. |

Hard technical constraints:

| Constraint | Impact |
|---|---|
| X DOM churn | Feature code must use selector lists, route-aware reapplication, fixture tests, and selector health reporting. |
| X API volatility | Internal GraphQL query IDs are volatile. Learn live from network responses and JS bundles; cache with expiry and fallback to passive capture. |
| Browser store policies | MV3 package cannot fetch or execute remote code. Userscript distribution must be readable and avoid obfuscated supply-chain risk. |
| X developer guidelines | Avoid auto-like, auto-follow, engagement farming, credential export, rate-limit abuse, or API-limit bypass claims. |
| Privacy expectations | Extension/userscript can see highly sensitive account state. Permissions must be narrow, local-only behavior must be explicit, and exports must be user-initiated. |
| Accessibility | No keyboard shortcuts does not remove keyboard accessibility. Controls still need focus management, ARIA, and touch targets. |

## Local DOM And API Reconnaissance

MHTML parse results:

| Capture | URL | HTML | CSS | Media parts | Embedded JS bodies |
|---|---:|---:|---:|---:|---:|
| `Home _ X.mhtml` | `https://x.com/home` | 315,084 bytes | 11 parts, 104,393 bytes | 27 | 0 |
| `Status _ X.mhtml` | `https://x.com/<account>/status/<id>` | 263,371 bytes | 10 parts, 104,319 bytes | 17 | 0 |

DOM inventory:

| Capture | Forms | Articles | Main | Aside | Nav | `data-testid` instances |
|---|---:|---:|---:|---:|---:|---:|
| Home | 1 | 9 | 1 | 2 | 4 | 231 across 78 unique ids |
| Status/conversation | 1 | 9 | 1 | 1 | 2 | 208 across 61 unique ids |

Key stable selectors observed:

```text
AppTabBar_Home_Link, AppTabBar_Explore_Link, AppTabBar_Notifications_Link,
AppTabBar_Follow_Link, AppTabBar_DirectMessage_Link, AppTabBar_Profile_Link,
AppTabBar_More_Menu, SideNav_NewTweet_Button, SideNav_AccountSwitcher_Button,
primaryColumn, sidebarColumn, tweet, tweetText, Tweet-User-Avatar, User-Name,
tweetPhoto, videoPlayer, videoComponent, reply, retweet, like, bookmark,
caret, icon-verified, trend, news_sidebar, UserCell, SearchBox_Search_Input,
GrokDrawer, GrokDrawerHeader, chat-drawer-root, chat-drawer-main, BottomBar,
tweetTextarea_0, tweetTextarea_0RichTextInputContainer, tweetButtonInline,
toolBar, fileInput, gifSearchButton, grokImgGen, createPollButton,
scheduleOption, geoButton, contentDisclosureButton, app-bar-back,
inline_reply_offscreen, birdwatch-pivot, icon-birdwatch-fill
```

Selector map:

| Surface | Stable selector | Fragile fallback observed | Churn risk | Implementation note |
|---|---|---|---|---|
| App root | `#react-root` | `body > div:first-child` | Medium | Root for readiness only; do not use as scan scope after boot. |
| Overlay/layers | `#layers` | `.r-1p0dtai.r-1d2f490` | High | Mount Control Center shadow host as sibling where possible, not inside X modals. |
| Primary column | `[data-testid="primaryColumn"]` | `.r-150rngu.r-16y2uox` | Medium | Main observer scope for timeline pages. |
| Sidebar | `[data-testid="sidebarColumn"]` | `.r-1ifxtd0.r-1udh08x` | High | Optional because sidebar collapses by viewport. |
| Feed tweets | `article[data-testid="tweet"]` | `article .css-175oi2r` | High | Process added articles only; add `data-av-processed`. |
| Tweet text | `[data-testid="tweetText"]` | `div[lang] span` under article | Medium | Extract text with fallback to article textContent. |
| Avatar/user | `[data-testid="Tweet-User-Avatar"]`, `[data-testid="User-Name"]` | link to `/{handle}` inside article | Medium | Needed for user filters, labels, exports. |
| Reply/repost/like/bookmark | `[data-testid="reply"]`, `[data-testid="retweet"]`, `[data-testid="like"]`, `[data-testid="bookmark"]` | button groups after tweet text | High | Add action buttons adjacent to stable action group. |
| More/caret | `[data-testid="caret"]` | `button[aria-label="More"]` | Medium | Menu augmentation target. |
| Composer | `[data-testid="tweetTextarea_0"]` | `div[role="textbox"][aria-label]` | High | Draft/thread features need Draft.js-aware insertion. |
| Composer toolbar | `[data-testid="toolBar"]` | button row below textbox | High | Attach visible controls without affecting X buttons. |
| Inline post button | `[data-testid="tweetButtonInline"]` | button with role and Post text | High | State-read only; avoid automation unless user clicks. |
| Media photo | `[data-testid="tweetPhoto"] img[src*="pbs.twimg.com/media"]` | `img[src*="format="]` | Medium | Prefer URL normalization to `name=orig`. |
| Video | `[data-testid="videoPlayer"]`, `[data-testid="videoComponent"]` | `video[src], div[aria-label*="Video"]` | High | Use network capture for variants; DOM alone is incomplete. |
| Search | `[data-testid="SearchBox_Search_Input"]` | `input[placeholder="Search"]` | Medium | Optional search helper source. |
| Trends/news | `[data-testid="trend"]`, `[data-testid="news_sidebar"]` | `aside section` | Medium | Hide/tune features should watch sidebar additions. |
| Nav | `[data-testid^="AppTabBar_"]`, `[data-testid="SideNav_NewTweet_Button"]` | `nav[aria-label] a[role="link"]` | High | Left-nav customization must support compact/mobile nav. |
| Notifications | `[data-testid="AppTabBar_Notifications_Link"]` | nav link href `/notifications` | Medium | Capture missing; route needs live fixture. |
| Messages | `[data-testid="AppTabBar_DirectMessage_Link"]` | nav link href `/messages` | High | Full-screen DM capture missing. |
| Grok | `[data-testid="GrokDrawer"]`, `[data-testid="grokImgGen"]` | `div[id*="grok"]` or text labels | High | Multiple competitors break here; isolate Grok tweaks. |
| Birdwatch/Community Notes | `[data-testid="birdwatch-pivot"]`, `[data-testid="icon-birdwatch-fill"]` | note text structure | Medium | Export and filter as contextual metadata. |

Design tokens and CSS signals:

| Token/signal | Observed value | Use |
|---|---|---|
| Brand blue | `rgb(29, 155, 240)` | Default accent. |
| OLED background | `rgb(0, 0, 0)` | Base for lights-out/OLED. |
| Dim/dark surfaces | `rgb(15, 20, 25)`, `rgb(22, 24, 28)` | Dim restoration and panel backgrounds. |
| Primary text | `rgb(231, 233, 234)`, `rgb(239, 243, 244)` | Contrast tokens. |
| Secondary text | `rgb(113, 118, 123)`, `rgb(83, 100, 113)` | Muted labels. |
| Borders | `rgb(47, 51, 54)` | Dense dividers. |
| Radius | Captured clip paths use `rx="16"` but repo rule caps text-bearing UI at 12px | Use 4/6/8/10/12 for Aviary panels; avoid pill/capsule chips. |
| Fonts | `TwitterChirp`, `TwitterChirpExtendedHeavy`, `Vazirmatn`, `Geist`, system fallback | Theme/font restoration. |
| z-index | X uses very high values up to `999999999` | Aviary overlay must use a controlled high z-index layer and avoid host z-index wars. |
| Custom properties | Mostly Sonner toast variables plus `--border-radius: 8px` | X is largely atomic/inline CSS; theme by variables where present and scoped overrides otherwise. |

SPA and API signals:

| Signal | Evidence | Roadmap implication |
|---|---|---|
| Framework | `#react-root`, React-style generated DOM, Draft.js composer classes | Treat X as React SPA. Never assume full page loads. |
| Routing | Links/routes under `/home`, `/status`, `/notifications`, `/messages`, `/settings`, `/i/grok` | Hook history push/replace/popstate and re-run route feature registry. |
| State globals | Referenced bundles include `__INITIAL_STATE__`, `__FEATURE_SWITCH_MANIFEST__`, `__META_DATA__`, `__UG__`, `__SCRIPTS_LOADED__` | Use read-only diagnostics only; do not depend on private global shapes for core features. |
| GraphQL | Bundle scan found `/i/api/graphql/<queryId>/<operationName>` and many operation names | Build a passive endpoint/queryId learner with expiry and user-visible diagnostics. |
| Auth headers | Bundle references include `Authorization`, `x-csrf-token`, `x-twitter-auth-type`, `x-twitter-active-user`, `auth_token`, `ct0` | Never export secrets. Internal API calls must be user-initiated, rate-limited, and same-origin where possible. |
| Useful operations | `HomeTimeline`, `HomeLatestTimeline`, `TweetDetail`, `TweetResultByRestId`, `SearchTimeline`, `Bookmarks`, `BookmarkSearchTimeline`, `UserTweets`, `UserMedia`, `Likes`, `Followers`, `Following`, `MutedAccounts`, `BlockedAccountsAll`, `CreateBookmark`, `DeleteBookmark`, `CreateTweet`, `DeleteTweet`, repost/favorite ops, Birdwatch ops | Use for export, filtering, and user-requested actions only after live query discovery. |
| CSP/TrustedTypes | Captures do not expose a TrustedTypes-enforcing CSP, but Google/YouTube-like enforcement and modern X changes are possible | All HTML injection must route through a policy wrapper. Prefer DOM construction. |

## Research Coverage

Phase 1 source saturation covered:

| Required class | Coverage |
|---|---|
| Direct OSS competitors | 25+ GitHub repos and issue trackers, including control-panel, old layout, minimal theme, exporters, media downloaders, automation toolkits, bookmark archivers, and link rewriters. |
| Commercial/closed competitors | Cleanup tools, bookmark/search managers, media archivers, analytics/growth products, dim/theme products, multi-column dashboards. |
| Adjacent-domain projects | Web archiving, browser traffic capture, local-first archives, social media research collectors, FxTwitter/alternate embeds, userscript build tooling. |
| Awesome lists | Awesome userscripts, awesome Twitter tools, GitHub topics, undocumented API lists. |
| Community signal | Reddit, Stack Overflow, extension support threads, data hoarding threads, userscript requests, Chrome extension builder complaints. |
| Standards/specs/APIs | MV3, userScripts, DNR, content scripts, Trusted Types, MutationObserver, IndexedDB, OPFS, WebCrypto, X API docs and limits. |
| Academic/engineering/security | MV3 research, malicious extension research, social media archiving work, browser extension security papers/blogs, dependency security signals. |
| Dependency changelogs | No current repo deps. Candidate future deps reviewed: TypeScript, Dexie, JSZip; conclusion is "add only when needed, pin, audit, and avoid runtime dependency bloat in userscript." |
| Security advisories/CVEs | Browser extension XSS, malicious extension campaigns, remote JS inclusion risks, npm supply-chain incidents, Chrome extension-related CVEs. |

## Competitive Landscape

Ranked by a blended score of popularity, recency, direct fit, and roadmap relevance. Counts are point-in-time research values from 2026-05-19 where available.

| Rank | Tool | Source | Type | Popularity/activity | Best implementation to beat |
|---:|---|---|---|---|---|
| 1 | Control Panel for Twitter | GH01, GF04, STORE04, STORE06 | Extension + userscript | 2,521 GitHub stars; 14,394 Greasy Fork installs; active 2026-05 | Broad UI control surface, feature density, mobile/desktop support, active response to X churn. |
| 2 | OldTwitter | GH02 | Extension | 2,555 stars; pushed 2026-05-11; 263 open issues | Full replacement old client; fastest "classic Twitter" direction; deep custom client architecture. |
| 3 | Twitter Web Exporter | GH04 | Userscript | 2,409 stars; pushed 2026-05-12 | GraphQL interception and export breadth for tweets/bookmarks/lists/followers/DMs. |
| 4 | Media Harvest | GH05, STORE02, STORE07 | Extension | 985 stars; 90,000 Chrome users; active 2026-05 | One-click media download, custom filenames, sensitive reveal, thumbnail support, store polish. |
| 5 | Minimal Theme for X/Twitter | GH03, STORE01, STORE03 | Extension | 980 stars; 40,000 Chrome users; 7,222 Firefox users | Decluttering, timeline width, writer mode, navigation customization, cross-browser stores. |
| 6 | X/Twitter Content Backup Tool | STORE05 | Extension | 10,000 Chrome users | Batch media backup, original quality, XLSX export, custom filenames, Aria2 integration. |
| 7 | Twitter Media Downloader | GF05 | Userscript | 150,820 Greasy Fork installs; stale since 2024 | Legacy popularity for one-click media save. |
| 8 | X Cleaner | COM01 | Commercial extension | Paid tiers; updated site in 2026 | Account cleanup productization: scans, deletes, exports, archive import, protected items, scheduler, audit report. |
| 9 | X Dim Mode | STORE08 | Extension | 2,000+ installs; changelog v1.3.0 | CSS-variable theme restoration, custom hue picker, OS sync, X Pro/DM/settings coverage. |
| 10 | SuperX | COM11 | Commercial extension | 10,000+ users reported in store/search snippets | Analytics, scheduler, AI writing, interaction matrix, creator workflow. |
| 11 | Twitter/X media downloader by limbopro | GF08, OU03 | Userscript | 18,101 Greasy Fork installs; updated 2026-05 | Original images/videos/GIFs, per-user naming. |
| 12 | Twitter/X Media Downloader | GF09 | Userscript | 9,098 installs; updated 2026-04 | One-click downloads and ZIP packaging. |
| 13 | Twitter/X Media Batch Downloader | GH09, GF10 | Desktop/userscript/extension | 413 stars; Greasy Fork updated 2026-05 | Account media batch download, original quality, GUI, withheld media claims. |
| 14 | CleanX | GH11 | Userscript + extension | 87 stars; active 2025-11 | Country/region/language filtering, IndexedDB stats, profile About fetch. |
| 15 | Twitter Click'n'Save | GH06 | Userscript | 149 stars; active issues | One-click media buttons, direct links, visited links, duplicate history, hide sign-up/trends. |
| 16 | GoodTwitter2 | GH07 | Userscript | 520 stars | Legacy UI reshaping and old-look demand signal. |
| 17 | TwitterHD | GH08 | Userscript + extension | 97 stars | Force full-resolution image/video loads. |
| 18 | XActions | GH10 | Toolkit | 268 stars; active 2026 | Automation/CLI/MCP concept, analytics and local browser control; also a caution zone for spam risk. |
| 19 | xarchive | GH12 | MV3 extension | 10 stars; active 2026 | Zero-dependency unlimited bookmark export with folder assignments. |
| 20 | tweetxvault | GH14 | CLI archive | Active 2026 | Local LanceDB archive, query ID discovery, raw response preservation, semantic search. |
| 21 | Twibird | COM06 | Commercial/local extension | 2026 product site | Searchable likes/bookmarks, tags/folders, reminders, offline local data. |
| 22 | XSaved | COM07 | Extension | 2026 alpha/product site | Bookmark library, auto-clustering, export, local storage. |
| 23 | Tweet Media Archive | COM04 | Commercial extension | 2026 product site | Save X/Instagram media to Drive, Dropbox, or downloads. |
| 24 | X Media Downloader | COM02 | Commercial extension | 2026 product site | Pro batch limits, media scraping, original quality. |
| 25 | X Filter Pro | COM03 | Commercial extension | 2026 product site | AI feed summaries/filtering direction. |
| 26 | Hypefury/Typefully/Tweet Hunter class | COM10, COM11 | Commercial SaaS | Paid creator tools | Scheduling, thread drafts, analytics, AI writing, cross-posting. |
| 27 | ReDeck / OldTweetDeck class | STORE09, STORE10, R04 | Extension/dashboard | Recent 2026 community signal | TweetDeck-style multi-column power-user workflow. |
| 28 | Twitter-to-Bsky | OU02 | Userscript | OpenUserJS source | Crossposting to Bluesky/Mastodon from browser composer. |
| 29 | FxTwitter/FixupX | GH15 | Web service | Active OSS | Better share/embed URLs, polls/translations/videos in off-platform embeds. |
| 30 | Awesome userscript/tool lists | GH17, GH18, GH16 | Curated lists | High discovery value | Build/distribution patterns and undocumented API discovery references. |

Issue and complaint signals that should shape the roadmap:

| Signal | Sources | Product response |
|---|---|---|
| X DOM changes break selectors and features repeatedly | GH01 issues 857/884/885/886, GH03 issues 247/250/254, R09, R19 | Build selector health checks, MHTML fixtures, route smoke tests, and per-feature kill switches. |
| Users want dim back after X removed or changed display options | GH03 issue 254, STORE08, R10, R11 | Restore dim early with CSS variables and settings integration. |
| Media downloads fail due to filename, ZIP size, browser differences, DM videos, and missing audio | GH04 issue 137, GH05 issues 311/315/317, GH06 issues 37/53/56/57/59/60 | Build queue, chunked ZIPs, file templates, browser test matrix, DM support later, and clear failure diagnostics. |
| Bookmark/export tools need deleted-item handling, profile About data, quote/poll/space completeness, import/export across browsers | GH04 issues 128/130/133/135/136 | Make data model broader than visible tweets; preserve raw payloads and tombstones. |
| Users want follow/follower diffs and account intelligence | R02, COM01, GH13 | Add local snapshots and diffing after core export. |
| Bulk account cleanup is paywalled commercially | COM01, COM08, COM13, R15, R25 | Offer local, rate-limited, user-initiated cleanup with protected items. |
| API pricing/rate limits push developers to browser-local tools | P11, P12, R03, R07, R13, R19 | Avoid official API dependency for core product; rate-limit same-origin internal calls and use passive capture when possible. |
| Extension trust is fragile | A03, A04, A12, S09, R28 | Narrow permissions, no remote code, source maps, privacy manifest, local-only audit log. |

## Master Feature Catalog

Every item below is traceable to sources in the Appendix. "Prevalence" uses: `table-stakes`, `common`, `emerging`, `rare`, `leapfrog`, or `rejected`.

| ID | Feature | Category | Description | Sources | Seen in / best signal | Prevalence |
|---|---|---|---|---|---|---|
| F001 | Feature registry lifecycle | Dev-experience | Every feature has `init`, `apply`, `destroy`, settings dependency list, observer scope, and diagnostics. | L01-L04, P04-P06 | Required by local philosophy and SPA churn | table-stakes |
| F002 | Control Center settings panel | UX | Shadow-DOM settings overlay with categories, toggles, immediate apply, search, import/export, and toasts. | GH01, GH03, COM01, L04 | Control Panel breadth plus commercial UX | table-stakes |
| F003 | Document-start anti-FOUC | UX/performance | Apply early body/html classes and theme CSS before X paints where userscript manager supports it. | P03, P04, STORE08, L04 | X Dim Mode and userscript best practice | common |
| F004 | Selector health dashboard | Observability/testing | Surface which stable selectors are live, which fallbacks are active, and which features are degraded. | GH01 issues, GH03 issues, L01-L03 | Repeated X churn complaints | emerging |
| F005 | TrustedTypes-safe DOM | Security | Central policy wrapper and DOM creation helpers for all injection sinks. | P05, P01, A03 | Platform hardening | table-stakes |
| F006 | MutationObserver router | Performance | Observe primary column/sidebar/layers, process added nodes only, and route features by page type. | P06, R20, L01-L03 | Stack Overflow x.com DOM guidance | table-stakes |
| F007 | Internal API rate limiter | Reliability | Per-operation token buckets, 429 backoff, and visible queue state. | P11, P12, P13, GH11 issue 3, COM01 | X rate limits and cleanup products | table-stakes |
| F008 | Versioned local storage schema | Data/migration | One schema for settings, labels, export jobs, history, snapshots, and migrations. | P07, D01, COM06, GH14 | Dexie/IndexedDB direction | table-stakes |
| F009 | Settings import/export | Migration | Export/import JSON settings with version migration and conflict report. | GH04 issue 130, GH03, COM01 | Cross-browser import requests | common |
| F010 | Privacy manifest | Security/docs | Plain-language local-only data map: what is read, stored, exported, and never transmitted. | STORE01, STORE02, S09, A12 | Store privacy disclosures and extension trust issues | table-stakes |
| F011 | Restore Dim theme | UX/accessibility | Recreate X's removed dim/dark-blue mode and expose native-like display setting. | STORE08, GH03 issue 254, R10, R11 | X Dim Mode | table-stakes |
| F012 | Custom dark palettes | UX/accessibility | OLED, dim, graphite, plum, midnight, and custom dark hue presets only. | STORE08, GH01, GF01 | X Dim Mode custom hue | common |
| F013 | Dense mode | UX | Tighten vertical spacing, action rows, sidebars, and composer chrome for power users. | GH01, GH03, L04 | Control Panel/Minimal Theme | common |
| F014 | Timeline width and border controls | UX | Adjustable primary column width, border removal, media-safe max widths. | STORE01, GH03 | Minimal Theme | table-stakes |
| F015 | Nav/sidebar item hiding | UX | Hide or reorder Premium, Grok, Jobs, Creator Studio, Communities, Business, Ads, footer, search, post button. | GH01, GH03, GF01, STORE01 | Control Panel and Minimal Theme | table-stakes |
| F016 | Trends/news/sidebar hiding | UX/filtering | Hide or collapse trends, news, "who to follow", subscriptions, footers, and promoted side modules. | GH01, GH03, GF01, GH06 | Control Panel/Minimal Theme/Click'n'Save | table-stakes |
| F017 | Promoted/suggested content hiding | Filtering/privacy | Remove promoted posts, suggested posts, topics, "Discover more", and algorithmic insertions. | GH01, GH03, GH19, STORE01 | Tweak New Twitter / Control Panel | table-stakes |
| F018 | Count hiding | UX/privacy | Hide view counts, vanity counts, likes/repost/reply counts, or show only on hover. | GH03, STORE01, GH01 | Minimal Theme | common |
| F019 | Writer mode | UX | Composer-focused mode that hides the rest of the app while drafting posts/threads. | STORE01, GH03, COM10 | Minimal Theme and creator tools | common |
| F020 | Classic/old layout skin | UX | Optional old Twitter-inspired layout layer without replacing the full client. | GH02, GH07, R16, R20 | OldTwitter/GoodTwitter2 | common |
| F021 | Multi-column dashboard | UX/power | TweetDeck-style columns for home, lists, search, profile, notifications, bookmarks. | STORE09, STORE10, R04 | ReDeck/OldTweetDeck | emerging |
| F022 | Media layout toggle | UX/media | Toggle between X media grid and sideways scroll/stacked media per tweet. | GH01 issue 687 | Direct feature request | emerging |
| F023 | Chat/DM layout guard | UX/reliability | Prevent control panels or compact CSS from covering DM actions and composer buttons. | GH03 issues 250/257 | Minimal Theme issues | common |
| F024 | Grok hiding and control | UX/privacy | Hide Grok nav/drawer/buttons, or replace Grok button with safe local command menu. | GH01, GH03 issue 249, GF13, GF14, GH23 | Un-Grok/Grok Commander | common |
| F025 | Font and visual restoration | UX | Restore Chirp/system font choices, icon tinting, compose icon color, and dim display tokens. | GH01 issue 883/884, STORE08 | Competitor breakage issues | emerging |
| F026 | Keyword and regex filters | Filtering/moderation | Hide/highlight posts by keyword, regex, phrase list, language, and source route. | GF01, R18, GH01 | Enhanced post hiders | table-stakes |
| F027 | User notes, tags, aliases | Data/UX | Attach private notes/tags to accounts; search/filter by them; optional WebDAV later. | GF01, COM06 | "Add notes to user" and bookmark managers | emerging |
| F028 | Country/region/language filters | Filtering | Filter or highlight posts by profile About country/region/language/script. | GH11 | CleanX | rare |
| F029 | Verified/Premium filters | Filtering | Hide, dim, badge, or threshold posts by Premium/verified state. | GH01, R20, GH23 | Control Panel/Good Old Bird/Un-Grok class | common |
| F030 | Engagement threshold filters | Filtering | Hide or highlight replies/posts below engagement or above viral thresholds. | COM01, R20, R23 | Good Old Bird/reply sort tools | emerging |
| F031 | Reply sorting and quality tools | UX/filtering | Auto-select best reply sort where X exposes it; annotate reply quality locally. | R14, R23 | Community reply-management complaint | emerging |
| F032 | Hide blocked accounts again | Filtering | Restore hiding posts from blocked accounts when X regresses behavior. | GH01 issue 886 | Control Panel request | emerging |
| F033 | Hide self-quotes/self-reposts | Filtering | Hide author self-quotes, self-replies, or repetitive repost chains. | GH01 issues, GF01 | Control Panel requests | emerging |
| F034 | Anti-spam/porn block assist | Moderation | One-click block/mute spam/scam/porn accounts in replies with batch queue. | GF19, GF18, COM01 | Twitter Block Porn/With Love | common |
| F035 | Block/mute likers/reposters | Moderation | User-initiated queue to block or mute accounts who liked/reposted a target post. | GF18, COM01 | Twitter Block With Love | common |
| F036 | Whitelist/protected accounts/items | Safety | Never hide/delete/download-overwrite protected accounts, tweets, or bookmarks. | COM01, GH11 issue 2 | X Cleaner protected items; CleanX whitelist | table-stakes |
| F037 | X-owned sensitive-content handling | UX/media | Leave sensitive-media decisions to X because Aviary cannot identify sensitive posts reliably from its available surfaces. | GH05, GF17, STORE02 | Media Harvest and media scripts | out of scope |
| F038 | GIF/media-type filter | Filtering/media | Hide GIF/video/photo posts on media tabs or feeds by media type. | R18, GF01 | Userscript request | emerging |
| F039 | Timeline read position sync | UX/offline | Track last-read tweet IDs per route/list/profile and restore position. | GF11 | Timeline Sync | rare |
| F040 | Timeline source/sort enforcement | UX/reliability | Prefer Following/latest/chronological route choices and detect X changing defaults. | GH01 issue 857, GH03 issues 247/251 | Control Panel and Minimal Theme issues | common |
| F041 | Original image download | Media | Add visible buttons to save `pbs.twimg.com/media` images in original quality. | GF06, GH06, GF08, GF09 | Download Original Picture | table-stakes |
| F042 | Video/GIF download | Media | Download tweet videos/GIFs from discovered variants; expose errors clearly. | GH05, GH06, GF05, GF08, GF09 | Media Harvest and media scripts | table-stakes |
| F043 | Force HD media playback | Media | Prefer highest-quality images/videos for viewing, not only downloads. | GF07, GH08 | Video Quality Fixer/TwitterHD | common |
| F044 | Thumbnail download | Media | Download video thumbnails separately. | STORE02, STORE05 | Media Harvest / Content Backup | common |
| F045 | Filename and folder templates | Media/data | Template fields for handle, display name, tweet id, media index, date, text hash, extension, and subdirectories. | GH05 issues 225/315/317, GF17, STORE05 | Media Harvest and Content Backup | table-stakes |
| F046 | Duplicate history/download log | Media/data | Local history to avoid duplicate downloads and sync/clear history. | GH06, GF17, STORE05 | Click'n'Save and Japanese media downloader | common |
| F047 | ZIP packaging and chunking | Media/reliability | Package multi-media posts and batch jobs into chunks; avoid >500 item ZIP failures. | GH04 issue 137, GF09, STORE05, D02 | Exporter ZIP issue and JSZip limits | table-stakes |
| F048 | Batch profile media download | Media | Download profile/media-tab images and videos with filters and queue. | GH09, GF10, STORE05, COM02, R16 | Content Backup and Batch Downloader | common |
| F049 | Media filters and limits | Media | Batch filters for date, likes, reposts, views, media type, withheld state, and max count. | STORE05, COM02, COM01 | Commercial media/export tools | common |
| F050 | Queue, concurrency, cancel, retry | Reliability/media | Visible job queue with pause/cancel/retry/backoff and per-item errors. | COM01, STORE05, GH05 issues | Commercial polish and failure issues | table-stakes |
| F051 | Save location memory | UX/media | Remember last selected folder/path label where browser APIs allow it. | GH05 issue 317 | Media Harvest request | common |
| F052 | Mobile ZIP support | Mobile/media | Mobile-friendly media bundling and share/download flow. | GF17 | Japanese media downloader | rare |
| F053 | DM media support | Media/privacy | Download DM videos/images only after dedicated DM fixture and privacy review. | GH06 issue 56, COM01 | Click'n'Save issue and cleanup tools | later |
| F054 | Alt text/poll/space metadata export | Accessibility/data | Preserve alt text, poll choices, spaces/audio metadata where X payload exposes them. | GH04 issue 133, GH15, GH14 | Exporter request and FxTwitter | emerging |
| F055 | Tweet/thread screenshot capture | Media/export | Capture tweets/threads to image/PDF locally with copy/download buttons. | R17, A08 | Screenshot userscript and social capture docs | common |
| F056 | Native companion and Aria2 handoff | Integrations/media | Optional handoff for very large jobs, HLS muxing, resumable downloads. | STORE05, GH09, R07 | Content Backup Aria2; HAR archiver | later |
| F057 | Broad data export | Data/export | Export tweets, bookmarks, lists, likes, followers/following, muted/blocked, DMs where safe. | GH04, GH12, COM01, COM06 | Twitter Web Exporter and X Cleaner | table-stakes |
| F058 | Export formats | Data/export | JSON, CSV, HTML, Markdown, XLSX, and self-contained viewer where appropriate. | GH04, STORE05, GH12, COM01, COM06 | Exporter, Content Backup, xarchive | table-stakes |
| F059 | Incremental sync and resume | Data/reliability | Crash-safe checkpointed sync and resumable backfills. | GH14, COM06, GH04 issues | tweetxvault and Twibird | common |
| F060 | Raw GraphQL response preservation | Data/reliability | Store raw response pages beside parsed records for future parser recovery. | GH14, GH04, R07 | tweetxvault/HAR archiver | leapfrog |
| F061 | Query ID auto-discovery | Data/reliability | Scrape referenced bundles/passive network to refresh operation query IDs. | GH14, L01-L03 | tweetxvault and local bundle scan | leapfrog |
| F062 | Deleted/tombstone handling | Data/export | Preserve bookmark/tweet references even after deletion, suspension, or unavailable payload. | GH04 issue 135, R28, COM12 | Exporter deleted bookmark issue | emerging |
| F063 | Profile About export | Data | Export location, website, join date, birth date, business/category, username changes where visible. | GH04 issue 128, GH11, GH02 issue 1268 | Exporter/CleanX/OldTwitter issues | common |
| F064 | Quotes, polls, spaces, articles | Data | Capture attached quote/repost wrappers, polls, spaces, articles, notes, and community context. | GH04 issues 133/136, GH15 | Exporter and FxTwitter | common |
| F065 | Follower/following snapshots and diff | Data/analytics | Snapshot lists and compare unfollows, disappeared accounts, new followers/following. | GH13, R02, COM01 | twitter-web-exporter-diff | emerging |
| F066 | Local full-text search | Data/offline | Search exported/bookmarked/liked content locally. | COM06, COM07, GH14 | Twibird/XSaved/tweetxvault | common |
| F067 | Optional semantic search | Data/AI | Local or user-key vector search over archives; disabled by default. | GH14, COM06, A07 | tweetxvault hybrid search; TwiXplorer | later |
| F068 | Tags, folders, reminders | Data/UX | Organize bookmarks/saved posts with tags, folders, notes, saved filters, reminders. | COM06, COM07, GH12, R12 | Twibird/XSaved/xarchive | common |
| F069 | External export targets | Integrations | Export to Notion/Obsidian/Drive/Dropbox/Downloads by explicit action. | COM04, COM06, COM08 | Tweet Media Archive/Twibird/Social Archiver | later |
| F070 | Official X archive import | Migration/data | Import official X archive ZIP to merge old tweets/media with local archive and cleanup jobs. | COM01, GH14, COM12 | X Cleaner/tweetxvault | common |
| F071 | WARC/WACZ/HAR preservation mode | Data/research | Optional evidence-grade archive export for researchers and data hoarders. | R07, A05, A08, A06 | HAR archiver/Tidal Tales/Zeeschuimer/NARA | later |
| F072 | Checksums/provenance/PDF reports | Data/observability | Checksums, source URL, capture time, run report, and PDF cleanup/export reports. | COM01, A08, GH14 | X Cleaner PDF report and archiving practice | emerging |
| F073 | Clean share links | UX/privacy | Copy x.com/twitter.com/fxtwitter/vxtwitter/fixupx URLs and strip tracking params. | GH15, GH21, GH22, GF15, OU02 | FxTwitter, auto-fxtwitter, Alternative Share URL | common |
| F074 | Direct link unshortening | UX/privacy | Replace `t.co` and redirect wrappers with direct destination display/copy where visible. | GH06, GF03 | Click'n'Save and Direct links out | common |
| F075 | Composer drafts/templates | UX/power | Local snippets, draft labels, reusable templates, and composer-safe insertion. | COM10, STORE01 | Creator tools and Writer Mode | common |
| F076 | Thread composer support | UX/power | Improve thread drafting and creation flow without background auto-posting. | GH02 issue 1269, COM10 | OldTwitter request and creator tools | emerging |
| F077 | Crosspost to Bluesky/Mastodon | Integrations | User-initiated crosspost from composer to user-configured accounts. | OU02, R13, COM10 | twitter-to-bsky | later |
| F078 | User-initiated schedule/publish queue | Automation | Local scheduled reminders or extension-assisted publish queue with explicit user action. | COM10, COM01, R13, P12 | Hypefury/Typefully class; X guidelines caution | under consideration |
| F079 | Account cleanup scan/delete | Data/safety | Scan tweets, retweets, likes, bookmarks, DMs, lists; queue user-requested deletions. | COM01, COM08, COM13, R15 | X Cleaner/TweetManager/TweetXDelete | later |
| F080 | Mass unfollow/block/mute | Moderation/safety | Review-first, rate-limited queues for unfollow/block/mute with protected accounts. | COM01, R25, GF18 | X Cleaner and community unfollow tools | later |
| F081 | Account audit | Analytics/privacy | Identify non-reciprocal follows, fans, inactive/ghost followers, sensitive posts. | COM01, R02 | X Cleaner/twe diff requests | later |
| F082 | Local AI/Grok command menu | UX/AI | Replace or augment Grok buttons with fact-check, translate, explain, and custom prompts. | GF13, GF14, GH23, COM03 | Grok Commander and X Filter Pro direction | under consideration |
| F083 | Translate and summarize | Accessibility/AI | User-triggered local/browser or user-key summaries/translations of posts/threads. | GF14, GH15, COM03, A07 | Grok Commander, FxTwitter, TwiXplorer | under consideration |
| F084 | Account metadata badges | Data/UX | Show join year, location, device/source hints, account notes, username-change counts. | GH11, GF01, GF03 | CleanX/Xbout class | emerging |
| F085 | Notification/digest tools | UX/data | Local digest of notifications, mentions, saved searches, and account changes. | COM10, COM01, R14 | Creator/dashboard products | later |
| F086 | Optional permissions per feature | Security/distribution | MV3 asks for extra permissions only when a user enables a feature that needs them. | P01, P03, R28, A02 | MV3 best practice and community concern | table-stakes |
| F087 | Local-only no telemetry | Privacy | Default product sends nothing to third parties; any external integrations are opt-in and documented. | STORE01, STORE02, COM01, S09 | Store privacy disclosures and security research | table-stakes |
| F088 | Encrypted local vault | Security/data | Optional WebCrypto encryption for archives/notes/settings exports. | P09, P07, R27 | WebCrypto/IndexedDB storage concerns | under consideration |
| F089 | Permission/dependency audit | Security/dev-experience | CI and release checklist for permissions, remote code, dependencies, lockfile, licenses. | A03, A04, A12, D02, D03 | Extension and npm supply-chain research | table-stakes |
| F090 | CSP/MV3 review hardening | Security/distribution | No remote code, no inline eval, store-compliant CSP, explicit host permissions. | P01-P04, A01, A02 | Chrome docs and MV3 research | table-stakes |
| F091 | Least-privilege network capture | Security/privacy | Passive same-origin capture of X responses; never persist cookies/auth headers. | GH04, GH14, P12, S09 | Exporter/tweetxvault with guidelines caution | table-stakes |
| F092 | Local action audit log | Observability/privacy | User-visible local log of downloads, hides, exports, deletions, API calls, failures. | COM01, A12, S09 | Cleanup reports and extension trust issues | common |
| F093 | Reduced motion | Accessibility | Respect `prefers-reduced-motion`; disable shimmer/spring/stagger animations. | P04, STORE08, L04 | Accessibility baseline | table-stakes |
| F094 | Contrast and ARIA tests | Accessibility/testing | Token contrast checks, labelled icon buttons, focus trap for active overlay, no hidden overlay pointer capture. | P05, P06, STORE01 | Platform and product quality | table-stakes |
| F095 | Localization framework | i18n | Extract strings, support initial English plus future community translations. | GH02 locales, STORE08 10-language note | OldTwitter/X Dim Mode | common |
| F096 | RTL/CJK wrapping | i18n/accessibility | Avoid overflow in CJK/RTL and Grok/chat long text; use logical properties. | GH03 issue 248, L01-L03 | Minimal Theme issue | common |
| F097 | Mobile/touch accessibility | Mobile/accessibility | Touch-friendly panels, responsive nav hooks, mobile userscript/browser support. | GH01, GF17, OU01 | Control Panel mobile and mobile ZIP scripts | common |
| F098 | MHTML fixture tests | Testing | Parse local captures in tests and assert selectors/actions remain valid. | L01-L03, P06 | Local repo ground truth | table-stakes |
| F099 | Playwright/live smoke tests | Testing | Optional live checks for home/status/profile/settings under test account; screenshots for regressions. | P04, R20, GH01 issues | Browser extension regression pattern | common |
| F100 | Dual packaging | Distribution | Produce readable userscript and MV3 extension ZIP from shared source. | P01-P04, GH03, GH05, GH12, GH17 | Cross-store competitors | table-stakes |
| F101 | README/install/FAQ | Docs/distribution | GitHub README with install paths, privacy model, feature matrix, troubleshooting, and source links. | GH01, GH03, GH05, OU01 | Competitor docs | table-stakes |
| F102 | Support diagnostics | Dev-experience/docs | Copy diagnostics: version, enabled features, selectors, route, browser, user manager, recent errors. | GH01 support flow, GH05 issues | Competitor support burden | common |
| F103 | Dependency update policy | Security/dev-experience | Pin exact deps, use lockfile, changelog review, Snyk/npm audit, avoid stale libs in runtime. | D01-D03, A12 | JSZip/Dexie/TypeScript and npm incidents | table-stakes |
| F104 | Feature preset packs | UX | Presets: "Quiet Reader", "Media Archivist", "Creator", "Researcher", "Classic", "Minimal". | GH01, GH03, COM06, COM10 | Control-panel breadth made approachable | emerging |
| R001 | Auto-like/follow/impression farming | Rejected | Automation to inflate engagement or auto-interact with accounts. | GH10, P12, R13 | Contradicts X guidelines and trust model | rejected |
| R002 | CAPTCHA/solver bypass | Rejected | Solver or account-lock bypass. | GH02 issues 1231/1097/1253, P12 | High account and policy risk | rejected |
| R003 | Cloud sync by default | Rejected | Upload archives/settings/tokens to Aviary servers by default. | S09, A12, COM06 | Contradicts local-first philosophy | rejected |
| R004 | Light theme | Rejected | Light palette or system light-mode support. | L04, STORE08 | Contradicts house style | rejected |
| R005 | Keyboard shortcuts | Rejected | Hotkeys for download, copy, navigation, or commands. | STORE02, STORE05, GH02 | Contradicts repo rule; use visible controls | rejected |
| R006 | Raw hashed selectors as primary | Rejected | Build features primarily around X obfuscated class names. | L01-L03, GH01 issues | Too fragile | rejected |
| R007 | Unbounded scraping | Rejected | Infinite background crawling without user action, rate limits, or stop controls. | P11-P13, R03, R07 | Account and platform risk | rejected |
| R008 | Credential/session export | Rejected | Export auth cookies, `ct0`, bearer tokens, or headers. | P12, S09, A12 | Severe privacy/security risk | rejected |

## Gap Analysis And Prioritization

Scoring: impact and effort are 1 low to 5 high. Tier meanings: `Now` is v0.1-v0.3 foundation and early usable product; `Next` is v0.4-v0.7 parity expansion; `Later` is v0.8+ or extension-specific; `Under Consideration` needs live-site/legal/security validation; `Rejected` is intentionally excluded.

| ID | Fit | Impact | Effort | Risk | Dependencies | Novelty | Tier | Placement rationale |
|---|---:|---:|---:|---|---|---|---|---|
| F001 | 5 | 5 | 3 | Low | None | Parity | Now | Without lifecycle discipline, the feature-dense scope becomes unmaintainable. |
| F002 | 5 | 5 | 4 | Medium | F001, F008 | Parity | Now | Settings is the product surface and must land before many toggles. |
| F003 | 5 | 4 | 2 | Low | F011 | Parity | Now | Theme changes must avoid paint flash from the first release. |
| F004 | 5 | 4 | 3 | Low | F006, F098 | Leapfrog | Now | Competitor failures show selector diagnostics are a durable advantage. |
| F005 | 5 | 5 | 2 | Low | F001 | Parity | Now | Cheap early security foundation that prevents future unsafe patterns. |
| F006 | 5 | 5 | 3 | Medium | F001 | Parity | Now | Core SPA handling gates nearly every DOM feature. |
| F007 | 5 | 5 | 3 | Medium | F008 | Parity | Now | Any export or cleanup work needs a safe operation queue. |
| F008 | 5 | 5 | 3 | Medium | None | Parity | Now | Settings, downloads, labels, snapshots, migrations, and logs need one schema. |
| F009 | 5 | 3 | 2 | Low | F008 | Parity | Next | Useful after real settings exist. |
| F010 | 5 | 4 | 2 | Low | F086, F087 | Leapfrog | Now | Trust is a differentiator in this extension category. |
| F011 | 5 | 5 | 2 | Low | F003 | Parity | Now | High-demand, low-risk first visible win. |
| F012 | 5 | 4 | 3 | Low | F011 | Parity | Now | Builds on dim restoration and house style. |
| F013 | 5 | 4 | 3 | Medium | F002, F006 | Parity | Next | Useful, but needs selector and settings foundation first. |
| F014 | 5 | 4 | 2 | Low | F002 | Parity | Now | Table-stakes Minimal Theme parity and simple CSS scope. |
| F015 | 5 | 5 | 3 | Medium | F006 | Parity | Now | One of the clearest competitor baseline features. |
| F016 | 5 | 5 | 2 | Low | F006 | Parity | Now | High-impact declutter feature with stable selectors. |
| F017 | 5 | 5 | 4 | Medium | F006, F026 | Parity | Next | Needs filtering engine and regression coverage. |
| F018 | 5 | 3 | 2 | Low | F006 | Parity | Next | Common declutter option after basic hide controls. |
| F019 | 5 | 4 | 3 | Medium | F002, F075 | Parity | Next | Valuable after composer-safe insertion is understood. |
| F020 | 4 | 4 | 5 | High | F013, F014, F100 | Parity | Later | Full old-client replacement is too expensive; skin only after core parity. |
| F021 | 4 | 5 | 5 | High | F057, F066, F100 | Leapfrog | Later | Strong power-user value but needs extension architecture and data model. |
| F022 | 5 | 3 | 3 | Medium | F006, F041 | Parity | Next | Direct competitor issue and bounded media UI work. |
| F023 | 5 | 3 | 3 | Medium | Missing DM capture | Parity | Next | Needs DM capture before shipping broadly. |
| F024 | 5 | 4 | 3 | Medium | F006, F082 optional | Parity | Now | Grok clutter appears in captures and competitors. |
| F025 | 5 | 3 | 3 | Medium | F011 | Parity | Next | Fixes frequent visual regressions after theme base is in place. |
| F026 | 5 | 5 | 3 | Medium | F006, F008 | Parity | Now | Core moderation engine unlocks multiple categories. |
| F027 | 5 | 4 | 4 | Medium | F008, F066 | Leapfrog | Next | Private notes/tags are under-served and align with local-first. |
| F028 | 4 | 3 | 4 | Medium | F063, F007 | Parity | Later | Useful but network-heavy and region inference is brittle. |
| F029 | 5 | 4 | 3 | Low | F026 | Parity | Next | Common request and straightforward once filter predicates exist. |
| F030 | 4 | 3 | 4 | Medium | F057, F007 | Leapfrog | Later | Reply quality requires payload counts and careful UX. |
| F031 | 4 | 4 | 4 | Medium | F057, live reply sort | Leapfrog | Later | Valuable, but current X reply sorting must be validated live. |
| F032 | 5 | 4 | 3 | Medium | F026 | Parity | Next | Direct current feature request. |
| F033 | 5 | 3 | 3 | Medium | F026 | Parity | Next | Useful noise reduction once tweet relation parsing exists. |
| F034 | 5 | 4 | 4 | High | F007, F036 | Parity | Later | Bulk moderation needs safeguards and rate limiting. |
| F035 | 4 | 4 | 4 | High | F007, F036 | Parity | Later | High risk if too automated; keep user-initiated. |
| F036 | 5 | 5 | 2 | Low | F008 | Parity | Now | Safety rail needed before any destructive or hiding feature. |
| F037 | 5 | 3 | 3 | Medium | F006, F041 | Parity | Next | Common media option, but sensitive content handling needs care. |
| F038 | 4 | 3 | 3 | Low | F026, F041 | Parity | Next | Direct userscript request; simple predicate after media detection. |
| F039 | 5 | 4 | 3 | Medium | F008, F006 | Parity | Next | Distinct QoL feature with clear source. |
| F040 | 5 | 5 | 4 | Medium | F006, live route tests | Parity | Next | High user value, but X sort controls change often. |
| F041 | 5 | 5 | 2 | Low | F006 | Parity | Now | Media download is one of the largest demand clusters. |
| F042 | 5 | 5 | 4 | Medium | F061, F050 | Parity | Next | Video/GIF needs network discovery and robust queueing. |
| F043 | 5 | 4 | 3 | Medium | F006 | Parity | Next | Common and bounded, but video variants are brittle. |
| F044 | 5 | 3 | 2 | Low | F042 | Parity | Next | Natural add-on once video metadata exists. |
| F045 | 5 | 5 | 3 | Medium | F008, F041 | Parity | Now | Competitor issues show naming is essential, not polish. |
| F046 | 5 | 4 | 3 | Low | F008, F041 | Parity | Now | Prevents duplicates and supports download trust. |
| F047 | 5 | 5 | 4 | Medium | F050, F058 | Parity | Next | Required for robust batch export and media jobs. |
| F048 | 5 | 5 | 5 | High | F042, F050, F061 | Parity | Later | High-value but large; ship after one-click media is stable. |
| F049 | 5 | 4 | 3 | Medium | F048 | Parity | Later | Batch filters depend on batch engine. |
| F050 | 5 | 5 | 4 | Medium | F007, F008 | Parity | Now | Queue is shared by media, export, and cleanup. |
| F051 | 4 | 3 | 3 | Medium | F050, browser APIs | Parity | Next | Direct issue but browser support differs. |
| F052 | 4 | 3 | 4 | Medium | F047 | Parity | Later | Mobile media support is useful but not foundational. |
| F053 | 3 | 3 | 5 | High | Missing DM capture, F087 | Parity | Under Consideration | DM media is sensitive and capture coverage is missing. |
| F054 | 5 | 4 | 4 | Medium | F057, F061 | Parity | Next | Important for accessibility and complete exports. |
| F055 | 5 | 4 | 4 | Medium | F006, F057 | Parity | Later | Popular but rendering fidelity takes testing. |
| F056 | 4 | 4 | 5 | Medium | F050, F100 | Leapfrog | Later | Keep optional; userscript must remain useful without it. |
| F057 | 5 | 5 | 5 | Medium | F007, F008, F061 | Parity | Next | Major product pillar; after core engine and queue. |
| F058 | 5 | 5 | 3 | Low | F057 | Parity | Next | Export formats are table-stakes once data exists. |
| F059 | 5 | 5 | 4 | Medium | F008, F057 | Parity | Next | Required for large exports and reliability. |
| F060 | 5 | 4 | 4 | Medium | F057, F088 optional | Leapfrog | Later | Strong recovery value but storage-heavy. |
| F061 | 5 | 5 | 5 | High | F006, F007 | Leapfrog | Next | Volatile X query IDs make this a strategic differentiator. |
| F062 | 5 | 4 | 4 | Medium | F057, F060 | Leapfrog | Later | Useful for archive integrity after broad export exists. |
| F063 | 5 | 4 | 3 | Medium | F057, F061 | Parity | Next | Direct issue and useful for filtering/labels. |
| F064 | 5 | 4 | 4 | Medium | F057, F061 | Parity | Later | Completeness upgrade after base exporter. |
| F065 | 5 | 4 | 4 | Medium | F057, F008 | Parity | Later | Clear demand, but snapshot scale and privacy need care. |
| F066 | 5 | 5 | 4 | Medium | F057, F008 | Parity | Later | Search becomes valuable after archive volume exists. |
| F067 | 4 | 3 | 5 | High | F066, local model/user key | Leapfrog | Under Consideration | Powerful but dependency/privacy costs are high. |
| F068 | 5 | 5 | 4 | Medium | F066, F027 | Parity | Later | Bookmark/library value after export/search foundations. |
| F069 | 4 | 3 | 4 | Medium | F057, F087 | Parity | Later | Integrations are opt-in and not v1 core. |
| F070 | 5 | 4 | 4 | Medium | F057, F008 | Parity | Later | Strong cleanup/archive bridge, but archive schema varies. |
| F071 | 4 | 4 | 5 | Medium | F060, F056 optional | Leapfrog | Later | Research-grade value, not needed for mainstream v1. |
| F072 | 4 | 3 | 3 | Low | F050, F057 | Parity | Later | Useful for reports once batch jobs exist. |
| F073 | 5 | 4 | 2 | Low | F002 | Parity | Now | Easy, useful, privacy-aligned, and widely sourced. |
| F074 | 5 | 3 | 3 | Low | F006 | Parity | Next | Common link hygiene after share controls. |
| F075 | 5 | 4 | 4 | Medium | F002, composer fixture | Parity | Next | Fits creator workflow but needs composer safety. |
| F076 | 5 | 4 | 4 | Medium | F075 | Parity | Later | Direct request; thread UI is more complex than snippets. |
| F077 | 4 | 3 | 4 | Medium | External tokens, F087 | Parity | Later | Useful for creators, but integrations are not core. |
| F078 | 3 | 4 | 5 | High | P12 review, F007 | Parity | Under Consideration | Scheduling can violate policy if implemented as automation. |
| F079 | 4 | 5 | 5 | High | F007, F036, F057 | Parity | Later | Commercially valuable, but destructive and rate-limited. |
| F080 | 4 | 4 | 5 | High | F036, F079 | Parity | Later | Keep review-first and rate-limited. |
| F081 | 4 | 4 | 5 | Medium | F065, F057 | Parity | Later | Good value once relationship snapshots exist. |
| F082 | 4 | 3 | 4 | Medium | F024, F087 | Parity | Under Consideration | Useful but AI/Grok integrations need privacy and policy review. |
| F083 | 4 | 3 | 5 | Medium | F082 or local model | Parity | Under Consideration | Avoid cloud defaults; local/user-key only. |
| F084 | 5 | 3 | 3 | Medium | F063 | Parity | Next | Account context enriches filters and labels. |
| F085 | 4 | 3 | 4 | Medium | F057, F066 | Leapfrog | Later | Useful after archive/search foundations. |
| F086 | 5 | 5 | 3 | Low | F100 | Parity | Now | Required for store trust and least privilege. |
| F087 | 5 | 5 | 2 | Low | F010 | Parity | Now | Foundational promise and store/privacy differentiator. |
| F088 | 4 | 3 | 5 | Medium | F008, F057 | Leapfrog | Under Consideration | Useful for sensitive archives, but key UX is hard. |
| F089 | 5 | 5 | 3 | Low | F100 | Parity | Now | Dependency and extension supply-chain risk is high. |
| F090 | 5 | 5 | 3 | Low | F100 | Parity | Now | Must be designed in before store builds. |
| F091 | 5 | 5 | 4 | Medium | F057, F061 | Leapfrog | Next | Enables exports while protecting secrets. |
| F092 | 5 | 4 | 3 | Low | F008 | Parity | Next | Builds trust and improves support. |
| F093 | 5 | 4 | 2 | Low | F002 | Parity | Now | Cheap accessibility baseline for premium motion. |
| F094 | 5 | 5 | 3 | Low | F002 | Parity | Now | Prevents visually polished but inaccessible UI. |
| F095 | 5 | 3 | 3 | Low | F002 | Parity | Next | X is global; extract strings early before UI grows. |
| F096 | 5 | 3 | 2 | Low | F002 | Parity | Now | Direct bug signal and low implementation cost. |
| F097 | 5 | 4 | 4 | Medium | F002, mobile fixture | Parity | Next | Supports mobile userscript and responsive extension users. |
| F098 | 5 | 5 | 3 | Low | None | Leapfrog | Now | Local captures are the repo's strongest asset. |
| F099 | 5 | 4 | 4 | Medium | F100, test account | Parity | Later | Important before store release, but not first scaffold. |
| F100 | 5 | 5 | 5 | Medium | F001, F089, F090 | Parity | Now | Dual packaging is a core product decision. |
| F101 | 5 | 4 | 3 | Low | F100 | Parity | Next | Required before distribution. |
| F102 | 5 | 3 | 3 | Low | F004, F092 | Parity | Next | Reduces support drag from X churn. |
| F103 | 5 | 5 | 2 | Low | F100 | Parity | Now | Current repo has no deps; set policy before adding them. |
| F104 | 5 | 3 | 3 | Low | F002 | Leapfrog | Later | Helps users navigate feature density after categories mature. |
| R001 | 1 | 1 | 3 | High | None | Misfit | Rejected | Violates guidelines and invites suspension. |
| R002 | 1 | 1 | 5 | High | None | Misfit | Rejected | Account/security bypass is not a product feature. |
| R003 | 1 | 2 | 4 | High | None | Misfit | Rejected | Contradicts local-first trust promise. |
| R004 | 1 | 1 | 2 | Low | None | Misfit | Rejected | Contradicts explicit dark-only style. |
| R005 | 1 | 1 | 2 | Low | None | Misfit | Rejected | Contradicts explicit no-keyboard-shortcuts rule. |
| R006 | 1 | 1 | 2 | High | None | Misfit | Rejected | Breaks under X class churn. |
| R007 | 1 | 2 | 4 | High | None | Misfit | Rejected | Conflicts with rate limits and user control. |
| R008 | 1 | 1 | 2 | Critical | None | Misfit | Rejected | Credential export is unacceptable. |

## Architecture

Recommended future repository layout:

```text
Twitter_Userscript/
|-- README.md
|-- ROADMAP.md
|-- LICENSE
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- vite.config.ts
|-- src/
|   |-- userscript.meta.ts
|   |-- main.ts
|   |-- platform/
|   |   |-- dom.ts
|   |   |-- selectors.ts
|   |   |-- trusted-types.ts
|   |   |-- route.ts
|   |   |-- observer.ts
|   |   |-- storage.ts
|   |   |-- rate-limit.ts
|   |   |-- network-capture.ts
|   |   `-- diagnostics.ts
|   |-- ui/
|   |   |-- control-center.ts
|   |   |-- toast.ts
|   |   |-- components.ts
|   |   `-- styles.ts
|   |-- features/
|   |   |-- appearance/
|   |   |-- filtering/
|   |   |-- media/
|   |   |-- export/
|   |   |-- composer/
|   |   |-- privacy/
|   |   `-- accessibility/
|   |-- data/
|   |   |-- schema.ts
|   |   |-- migrations.ts
|   |   |-- archive-model.ts
|   |   `-- serializers.ts
|   `-- extension/
|       |-- manifest.chrome.json
|       |-- manifest.firefox.json
|       |-- background.ts
|       |-- content.ts
|       `-- sidepanel.ts
|-- fixtures/
|   |-- home.mhtml
|   |-- status.mhtml
|   |-- decoded/
|   `-- selector-baselines.json
|-- tests/
|   |-- selectors.test.ts
|   |-- features-smoke.test.ts
|   |-- storage-migrations.test.ts
|   |-- media-url.test.ts
|   `-- security.test.ts
`-- dist/
    |-- aviary.user.js
    |-- aviary.chrome.zip
    `-- aviary.firefox.zip
```

Core contracts:

```ts
type FeatureContext = {
  route: RouteState;
  settings: Settings;
  selectors: SelectorRegistry;
  storage: StorageGateway;
  limiter: RateLimiter;
  diagnostics: Diagnostics;
  toast: ToastBus;
};

type FeatureModule = {
  id: string;
  title: string;
  category: FeatureCategory;
  defaultEnabled: boolean;
  init(ctx: FeatureContext): void | Promise<void>;
  apply?(ctx: FeatureContext, root: ParentNode, addedNodes?: Node[]): void;
  destroy(ctx: FeatureContext): void | Promise<void>;
  getStatus?(): FeatureStatus;
};
```

Observer strategy:

| Scope | Features | Rule |
|---|---|---|
| `document.documentElement` | document-start classes, theme, global variables | Write once, update on settings changes. |
| `[data-testid="primaryColumn"]` | feed, tweet, media, filtering, export buttons | Observe childList/subtree; process added nodes only. |
| `[data-testid="sidebarColumn"]` | trends, recommendations, search sidebar | Observe only when sidebar exists. |
| `#layers` | modals, media viewer, menus, Grok drawer | Observe lightly; disconnect when route lacks overlays. |
| Composer container | drafts, writer mode, thread support | Dedicated observer because Draft.js changes frequently. |

Network/API strategy:

| Layer | Use | Rule |
|---|---|---|
| Passive capture | Export/archive parsing, query ID discovery | Wrap `fetch`/XHR in page context where userscript manager allows; never persist auth headers. |
| Same-origin GraphQL calls | User-requested export, metadata fetch, cleanup queue | Use discovered operation/query ID, `x-csrf-token` from page context only in memory, token-bucket limiter, exponential backoff. |
| Official X API | Optional future user-provided key workflows | Do not require for core product because costs/rate limits are volatile. |
| Extension background | Downloads, optional permissions, DNR, side panel | MV3 only; no remote code; keep service worker stateless and checkpoint jobs in storage. |

Settings root key: `aviary.settings.v1`

Settings schema outline:

| Key | Default | Category | Feature IDs |
|---|---:|---|---|
| `appearance.theme` | `dim` | Appearance | F011, F012 |
| `appearance.denseMode` | `false` | Appearance | F013 |
| `appearance.timelineWidth` | `default` | Appearance | F014 |
| `appearance.hideBorders` | `false` | Appearance | F014 |
| `appearance.hideCounts` | `false` | Appearance | F018 |
| `appearance.restoreChirp` | `false` | Appearance | F025 |
| `layout.hideNavItems` | `[]` | Layout | F015 |
| `layout.hideRightSidebar` | `true` | Layout | F016 |
| `layout.hideTrends` | `true` | Layout | F016 |
| `layout.hideGrok` | `true` | Layout/privacy | F024 |
| `layout.writerMode` | `false` | Composer | F019 |
| `filter.enabled` | `false` | Filtering | F026 |
| `filter.keywordRules` | `[]` | Filtering | F026 |
| `filter.regexRules` | `[]` | Filtering | F026 |
| `filter.premiumRule` | `off` | Filtering | F029 |
| `filter.blockedAccounts` | `hide` | Filtering | F032 |
| `filter.whitelist` | `[]` | Filtering/safety | F036 |
| `filter.mediaTypes` | `{}` | Filtering/media | F038 |
| `media.buttons` | `true` | Media | F041, F042 |
| `media.preferOriginalImages` | `true` | Media | F041, F043 |
| `media.filenameTemplate` | `{handle}_{tweetId}_{index}` | Media | F045 |
| `media.downloadHistory` | `true` | Media | F046 |
| `media.zipChunkSize` | `250` | Media | F047 |
| `jobs.concurrentDownloads` | `3` | Jobs | F050 |
| `jobs.rateLimitMode` | `conservative` | Jobs | F007, F050 |
| `export.enabled` | `false` | Export | F057 |
| `export.formats` | `["json","csv","html"]` | Export | F058 |
| `export.preserveRawPayloads` | `false` | Export | F060 |
| `export.autoDiscoverQueryIds` | `true` | Export | F061 |
| `links.cleanShareButtons` | `true` | Privacy/links | F073 |
| `links.expandTco` | `false` | Privacy/links | F074 |
| `composer.snippets` | `[]` | Composer | F075 |
| `privacy.localOnly` | `true` | Privacy | F087 |
| `privacy.telemetry` | `false` | Privacy | F087 |
| `privacy.auditLog` | `true` | Observability | F092 |
| `accessibility.reduceMotion` | `system` | Accessibility | F093 |
| `accessibility.highContrast` | `false` | Accessibility | F094 |
| `i18n.locale` | `en` | i18n | F095 |
| `diagnostics.selectorHealth` | `true` | Observability | F004 |

Settings panel spec:

| Group | Controls |
|---|---|
| Appearance | Theme selector, accent swatch, dense mode toggle, width slider, border/count toggles, font restoration. |
| Layout | Nav item checklist, right sidebar/trends/news/Grok toggles, media layout toggle, writer mode. |
| Filtering | Enable switch, keyword/regex table, premium/verified rule, blocked-account rule, media-type filters, whitelist editor. |
| Media | Media buttons, original quality, filename template builder, duplicate history, ZIP chunk size, queue concurrency. |
| Export | Export targets, formats, raw payload option, query discovery status, archive import. |
| Links | Clean link buttons, fxtwitter/vxtwitter/fixupx options, t.co display. |
| Composer | Snippets, thread mode, templates. |
| Privacy & Security | Local-only status, optional permissions, audit log, encrypted vault, privacy manifest. |
| Accessibility & Language | Reduced motion, contrast mode, locale, text wrapping. |
| Diagnostics | Selector health, route state, enabled features, recent errors, copy support bundle. |

## Phased Build Plan

| Status | Version | Phase | Features | Dependencies | Acceptance criteria |
|---|---|---|---|---|---|
| Complete | v0.1.0 | Repo scaffold and safety rails | License, README stub, userscript/MV3 shared TypeScript scaffold, feature registry F001, settings schema F008, TrustedTypes F005, dependency policy F103, fixture tests F098 | None | `npm run verify` passes; build produces readable `aviary.user.js`; tests parse both local captures; no remote code; no runtime dependencies. |
| Complete | v0.2.0 | Control Center and theme foundation | Settings panel F002, anti-FOUC F003, dim F011, dark palettes F012, width/border controls F014, reduced motion F093, ARIA/contrast F094 | v0.1.0 | Userscript bundle applies a dark theme state at document-start, mounts a Shadow DOM panel, persists toggles, and destroys cleanly. |
| Complete | v0.3.0 | Layout declutter | Nav/sidebar hiding F015/F016, Grok hiding F024, protected list F036, selector health F004, optional permissions shell F086, privacy manifest F010/F087 | v0.2.0 | Home/status fixture contracts pass; layout hiding is class-scoped and reversible; diagnostics reports selector state; optional permissions stay narrow. |
| Complete | v0.4.0 | Filter engine | Keyword/regex F026, premium/verified F029, media-type filter F038, timeline-position scope F039 (blocked/self-repost filters F032/F033 deferred until authenticated fixtures) | v0.3.0 | Added tweet articles only are processed, the master toggle disables all CSS effects without reload, and rule generation re-evaluation never scans the full document per mutation. |
| Complete | v0.5.0 | One-click media | Original image F041, filename templates F045, duplicate history F046, queue F050, HD viewing baseline F043, thumbnail F044 | v0.4.0 | Image downloads use original quality, filenames are deterministic, duplicate history works, queue exposes failures, and the BG service worker bridges `chrome.downloads`. |
| Complete | v0.6.0 | Video / GIF + media presentation | Video/GIF F042, sensitive controls F037, media layout F022 (F047 ZIP chunking + F051 save location deferred to v0.7.0 with batch/export work) | v0.5.0 | Video downloads work on captured/live tweets where variants are discoverable; presentation toggles reverse cleanly via destroy and a master class swap. |
| Complete | v0.7.0 | Export core | Broad export F057, JSON/CSV/HTML/Markdown F058, incremental resume F059, query discovery F061, support diagnostics F102, ZIP chunking F047, save location F051 (XLSX + F091 deferred) | v0.6.0 | Visible tweets are collected, persisted to a CheckpointStore, formatted as JSON/CSV/HTML/MD, and bundled into a STORE-only ZIP under the configured folder hint; query IDs are scraped from loaded scripts; diagnostics copy to clipboard. |
| Complete | v0.8.0 | Archive completeness | Alt text/polls F054, profile About F063, quote/article wrappers F064, action audit log F092, settings import/export F009 (XLSX + F091 stage 2 carry forward to v0.9.0) | v0.7.0 | Export records preserve contextual metadata and produce migration-safe settings. |
| Complete | v0.9.0 | Library + power UX (focused) | Notes/tags F027, direct link unshortening F074, composer snippet editor F075 (insertion deferred). F066 local search, F068 bookmark tags/folders/reminders, XLSX, F091 stage 2 carry forward to v0.10.0+. | v0.8.0 | User can label accounts/posts and clean visible `t.co` redirects without network side effects. |
| Complete | v0.10.0 | MV3 store hardening | Dual packaging F100, install/FAQ docs F101, CSP/MV3 hardening F090, permission + dependency audit F089 (F099 Playwright smoke + XLSX/F066/F068/F091 stage 2/composer insertion deferred) | v0.9.0 | Chrome and Firefox ZIP builds pass the store-preflight checklist. |
| Complete | v0.11.0 | Advanced data + cleanup preview | Follower diffs F065, official archive import F070, cleanup scan preview F079 (read-only), reports F072, F066 local search (XLSX, F068, F091 stage 2, composer insertion, F099 Playwright carry forward) | v0.10.0 | Account data can be scanned and previewed with protected items; destructive actions remain disabled by default. |
| Complete | v1.0.0 | Beats every competitor baseline | Cleanup queue F079/F080 (read-only by policy), presets F104, mobile/touch F097, i18n F095/F096 (F048/F049 media batch + XLSX + F068 + F091 stage 2 + composer insertion + F099 Playwright carry forward) | v0.11.0 | Aviary matches or exceeds direct competitor table-stakes features while preserving the privacy / accessibility / fixture / preflight gates. |
| Complete | v1.1.0 | Carry-over closeout | XLSX F058, bookmark library F068, F091 stage 2 passive GraphQL capture, F075 composer snippet insertion (F048/F049 media batch + F099 Playwright queued for v1.2+) | v1.0.0 | Optional features ship behind explicit opt-in toggles; passive capture scrubs `ct0`/Bearer; composer never simulates keystrokes. |
| Complete | v1.2.0 | Batch media + WARC + external targets + AI scaffold | F048/F049 batch downloader, F071 WARC, F069 external targets, F082 AI command menu (local prompt builder) | v1.1.0 | All actions are explicit, opt-in, and either copy-to-clipboard or write a local file; no network calls without a user-configured key. |
| Complete | v1.3.0 | Integration scaffolds | F056 Aria2 handoff, F077 Bluesky + Mastodon crosspost, F083 AI provider runner, F067 semantic search scaffold | v1.2.0 | Each defaults disabled and only acts when the user supplies credentials. All URLs go through the same `urlValue` validator that rejects non-`http(s)` schemes. |
| Complete | v1.4.0 | Live smoke scaffold + polish | F099 Playwright spec scaffold (no auto-install), Aria2 sweep/cancel, threaded crosspost, integration error readout, auto-embedding on export | v1.3.0 | Every action stays explicit and opt-in; the smoke spec no-ops without the optional `playwright` dep. |

## Risks And Open Questions

| Risk/question | Impact | Mitigation |
|---|---|---|
| Missing local fixtures for profile, settings, notifications, DMs, search, lists, communities, media modal, Grok open state | Selector/API plan incomplete for those surfaces | First implementation work should add captures before building those features. |
| X internal GraphQL query IDs churn | Export/media features break | Passive query discovery, expiry, diagnostics, and graceful degradation. |
| X may detect extension/userscript interference | Account risk | Avoid automation, avoid credential export, minimize API calls, use user-initiated operations, keep rate limits conservative. |
| MV3 service workers are non-persistent | Background queues can lose memory state | Persist all queue state/checkpoints in IndexedDB/chrome.storage; workers are stateless executors. |
| ZIP/media memory pressure | Browser crashes on large batches | Chunk ZIPs, stream where possible, cap concurrency, support native companion later. |
| Store review rejects broad permissions | Distribution delay | Optional permissions, feature-gated prompts, privacy manifest, source maps, no remote code. |
| GPL competitor code contamination | Licensing risk | Use sources for behavior ideas only; do not copy GPL code into MIT-compatible implementation. |
| AI/Grok features blur privacy line | Trust risk | Keep under consideration until local/user-key-only design and disclosure are ready. |
| Destructive cleanup can harm users | Trust and safety risk | Review queues, protected items, undo where possible, audit log, no confirmation dialogs but clear progress/cancel. |
| Accessibility conflict with "no shortcuts" | Keyboard users still need operability | No custom shortcuts, but maintain natural tab/focus/activation semantics. |

## Definition Of Done

`v1.0.0` is done when:

| Area | Required outcome |
|---|---|
| Competitor parity | Aviary covers the safe union of Control Panel, Minimal Theme, Media Harvest, Twitter Web Exporter, major Greasy Fork media scripts, CleanX, link rewriters, dim restorers, and bookmark/export tools. |
| Clear leapfrogs | Selector health, local privacy manifest, reversible lifecycle, query ID discovery, fixture tests, support diagnostics, and local audit log are shipped. |
| Privacy | No telemetry, no remote code, no credential export, no default cloud sync, no hidden third-party calls. |
| Safety | Every feature has `destroy()`, every batch job is rate-limited and cancellable, and destructive operations protect whitelisted items. |
| Accessibility | Control Center passes contrast/ARIA/reduced-motion checks, supports CJK/RTL wrapping, and remains operable without custom shortcuts. |
| Reliability | MHTML fixture tests, storage migration tests, media URL tests, and live smoke tests pass for Chrome, Edge, Firefox, and at least one userscript manager. |
| Distribution | Readable userscript, Chrome MV3 ZIP, Firefox MV3 ZIP, README, privacy notes, support diagnostics, and versioned release notes are produced. |
| Documentation | README explains install paths, feature categories, local-first design, permissions, troubleshooting, and known X churn risks. |

## Appendix A: Source Index

Local sources:

| ID | URL/path | Use |
|---|---|---|
| L01 | `<repo root>\Home _ X.mhtml` | Home DOM, CSS, route, selectors. |
| L02 | `<repo root>\Status _ X.mhtml` | Status/conversation DOM, CSS, media, selectors. |
| L03 | `<repo root>\_decoded\home.html`, `status.html`, CSS files | Decoded ground-truth HTML/CSS fixtures. |
| L04 | Prior `ROADMAP.md` in this repo before v0.0.2 rewrite | Preserved project philosophy and initial selector/API findings. |

Direct OSS competitors and lists:

| ID | URL | Use |
|---|---|---|
| GH01 | https://github.com/insin/control-panel-for-twitter | Direct competitor, features, issues, stars/activity. |
| GH02 | https://github.com/dimdenGD/OldTwitter | Old-layout competitor, issues, full-client architecture. |
| GH03 | https://github.com/typefully/minimal-twitter | Minimal/de-clutter competitor, issues, store support. |
| GH04 | https://github.com/prinsss/twitter-web-exporter | Export/userscript competitor, issues, GraphQL export model. |
| GH05 | https://github.com/EltonChou/TwitterMediaHarvest | Media downloader competitor, issues, changelog/store links. |
| GH06 | https://github.com/AlttiRi/twitter-click-and-save | Userscript media/link/history competitor, issues. |
| GH07 | https://github.com/Bl4Cc4t/GoodTwitter2 | Legacy UI userscript competitor. |
| GH08 | https://github.com/DavidBuchanan314/TwitterHD | HD media userscript/extension competitor. |
| GH09 | https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader | Batch media downloader competitor. |
| GH10 | https://github.com/nirholas/XActions | Automation toolkit competitor/cautionary source. |
| GH11 | https://github.com/theesfeld/CleanX | Country/region/language filter competitor. |
| GH12 | https://github.com/sytelus/xarchive | Bookmark export MV3 competitor. |
| GH13 | https://github.com/uybixd/twitter-web-exporter-diff | Follower/following diff fork. |
| GH14 | https://github.com/lhl/tweetxvault | Local archive/query discovery/semantic search adjacent tool. |
| GH15 | https://github.com/allnodes/FxTwitter | Alternate embed/share URL adjacent project. |
| GH16 | https://github.com/fa0311/AwesomeTwitterUndocumentedAPI | Undocumented API/source discovery list. |
| GH17 | https://github.com/awesome-scripts/awesome-userscripts | Userscript ecosystem/build/distribution list. |
| GH18 | https://github.com/hridaydutta123/awesome-twitter-tools | Twitter tools awesome list. |
| GH19 | https://github.com/mcpower/tweak-new-twitter | Historical de-clutter/filter competitor. |
| GH20 | https://github.com/maxox/xMediaDownloader | x.com media downloader fork and breakage source. |
| GH21 | https://github.com/ItsRqtl/auto-fxtwitter | Copy-link rewriting competitor. |
| GH22 | https://github.com/thevenuz/xify | fxtwitter/vxtwitter link rewriting competitor. |
| GH23 | https://github.com/hotheadhacker/un-grok | Grok-removal competitor. |

Userscript directories:

| ID | URL | Use |
|---|---|---|
| GF01 | https://greasyfork.org/en/scripts/by-site/x.com?sort=total_installs | Popular x.com userscripts and install counts. |
| GF02 | https://greasyfork.org/en/scripts/by-site/x.com?sort=updated | Recently updated x.com userscripts. |
| GF03 | https://greasyfork.org/en/scripts/by-site/twitter.com?sort=total_installs | Popular twitter.com legacy userscripts. |
| GF04 | https://greasyfork.org/scripts/387773-control-panel-for-twitter | Control Panel userscript details. |
| GF05 | https://greasyfork.org/scripts/423001-twitter-media-downloader | Legacy media downloader details. |
| GF06 | https://greasyfork.org/scripts/396746-download-original-picture | Original image download details. |
| GF07 | https://greasyfork.org/scripts/399827-video-quality-fixer-for-x-twitter | Video quality fixer details. |
| GF08 | https://greasyfork.org/scripts/478651 | limbopro media userscript details. |
| GF09 | https://greasyfork.org/scripts/529453-twitter-x-media-downloader | Media downloader with ZIP packaging. |
| GF10 | https://greasyfork.org/scripts/523157-twitter-x-media-batch-downloader | Batch media userscript. |
| GF11 | https://greasyfork.org/scripts/517767-twitter-x-timeline-sync | Timeline read-position sync. |
| GF12 | https://greasyfork.org/scripts/558276-x-com-enhanced-gallery | Enhanced gallery/media viewer. |
| GF13 | https://greasyfork.org/scripts/569963-grok-fact-checker | Grok fact-check command concept. |
| GF14 | https://greasyfork.org/scripts/569964-x-twitter-grok-commander | Grok command menu/prompt templates. |
| GF15 | https://greasyfork.org/scripts/491145-x-twitter-alternative-share-url | Alternate share URL button. |
| GF16 | https://greasyfork.org/scripts/569424-twitter-x-media-copy-download | Media copy/download buttons. |
| GF17 | https://greasyfork.org/scripts/528890 | Mobile-aware media batch/download history. |
| GF18 | https://greasyfork.org/scripts/398540-twitter-block-with-love | Block/mute users who like/repost target post. |
| GF19 | https://greasyfork.org/scripts/470359-twitter-block-porn | Spam/porn reply blocking. |
| OU01 | https://openuserjs.org/group/twitter | OpenUserJS Twitter group. |
| OU02 | https://openuserjs.org/scripts/59de44955ebd/twitter-to-bsky | Crosspost userscript. |
| OU03 | https://openuserjs.org/scripts/pparker1930/Twitter%28X%29%E1%B4%BE%CB%A1%E1%B5%98%CB%A2%2B%2B%2B_Youtube%E1%B4%BE%CB%A1%E1%B5%98%CB%A2%2B%2B%2B | Twitter Plus userscript features. |
| OU04 | https://openuserjs.org/scripts/decayed/Universal_Media_Downloader_-_Local_Server_%28YouTube%2C_TikTok%2C_Instagram_%2B_All_Sites%29 | Local-server media downloader pattern. |

Stores, commercial products, and closed competitors:

| ID | URL | Use |
|---|---|---|
| STORE01 | https://chromewebstore.google.com/detail/minimal-theme-for-twitter/pobhoodpcipjmedfenaigbeloiidbflp | Minimal Theme Chrome listing, users/features/version. |
| STORE02 | https://chromewebstore.google.com/detail/media-harvest-x-twitter-m/hpcgabhdlnapolkkjpejieegfpehfdok | Media Harvest Chrome listing. |
| STORE03 | https://addons.mozilla.org/en-US/firefox/addon/minimaltwitter/ | Minimal Theme Firefox listing. |
| STORE04 | https://addons.mozilla.org/en-US/firefox/addon/control-panel-for-twitter/ | Control Panel Firefox listing. |
| STORE05 | https://chromewebstore.google.com/detail/x-content-backup-tool-x-m/dcpelmafllhhdcbiegigphjnbgnolkgm | X/Twitter Content Backup Tool listing. |
| STORE06 | https://chrome-stats.com/d/kpmjjdhbcfebfjgdnpjagcndoelnidfj/download | Control Panel version/update signal. |
| STORE07 | https://chrome-stats.com/d/hpcgabhdlnapolkkjpejieegfpehfdok | Media Harvest version/review signal. |
| STORE08 | https://xdim.app/ | X Dim Mode features/changelog. |
| STORE09 | https://oldtweetdeck.org/ | OldTweetDeck multi-column demand. |
| STORE10 | https://chromewebstore.google.com/detail/redeck-%E2%80%93-x-twitter-pro-mu/kbipcnjpdpicihheehhcmjmgdlaffbfi | ReDeck multi-column extension signal. |
| COM01 | https://x-cleaner.app/ | Commercial cleanup/account audit/paywall feature map. |
| COM02 | https://xmediadownloader.com/ | Commercial media downloader and Pro limits. |
| COM03 | https://xfilterpro.com/ | AI filtering/summary competitor. |
| COM04 | https://tweetmediaarchive.com/ | Drive/Dropbox media archive product. |
| COM05 | https://xtract.media/ | Advanced downloader/AI workflow competitor. |
| COM06 | https://twibird.com/ | Bookmark/likes search and organization product. |
| COM07 | https://www.xsaved.com/ | Bookmark library/export competitor. |
| COM08 | https://social-archive.org/ | Local social archive adjacent product. |
| COM09 | https://tweetmanager.app/en | Bulk delete/rate-limit/pricing competitor. |
| COM10 | https://hypefury.com/features-pricing/ | Creator scheduling/analytics feature set. |
| COM11 | https://use-xlab.com/compare | Commercial creator-tool comparison/pricing. |
| COM12 | https://contextbolt.com/blog/export-twitter-bookmarks/ | Bookmark export methods and API cap discussion. |
| COM13 | https://tweetxdelete.com/ | Bulk deletion competitor. |

Community and support signal:

| ID | URL | Use |
|---|---|---|
| R01 | https://www.reddit.com/r/Twitter/comments/1rwvife/error_some_privacy_related_extensions_may_cause/ | Extension breakage/privacy warning around Media Harvest. |
| R02 | https://www.reddit.com/r/Twitter/comments/1rmluwe/i_made_a_userscript_that_tracks/ | Follower/following snapshot diff demand. |
| R03 | https://www.reddit.com/r/automation/comments/1tc9x0q/looking_for_a_reliable_twitterx_scraping_api_for/ | X scraping/rate-limit frustration. |
| R04 | https://www.reddit.com/r/chrome_extensions/comments/1tf7wcx/i_built_a_tweetdeckstyle_multicolumn_extension/ | ReDeck multi-column extension demand. |
| R05 | https://www.reddit.com/r/Twitter/comments/1sei1rn/the_x_algorithm_is_genuinely_fucked_and_im_tired/ | Algorithm/feed quality complaint. |
| R06 | https://www.reddit.com/r/DataHoarder/comments/1jx1iea/xtwitter_scraping_options_2025/ | Data hoarding/export options and network parsing. |
| R07 | https://www.reddit.com/r/DataHoarder/comments/1prqgoa/archive_twitterx_media_without_the_api_harbased/ | HAR-based archiving approach. |
| R08 | https://www.reddit.com/r/Twitter/comments/1tc69ik/isnt_there_a_project_going_on_that_gives_you_x/ | Demand for premium/customization alternative. |
| R09 | https://www.reddit.com/r/Twitter/comments/1pnoncx/control_panel_not_working/ | Control Panel breakage after X changes. |
| R10 | https://www.reddit.com/r/Twitter/comments/1r2af6j/did_they_just_get_rid_of_dim/ | Dim removal complaint and workaround discussion. |
| R11 | https://www.reddit.com/r/uBlockOrigin/comments/1r2ev6n/x_just_got_rid_of_the_dark_blue_color_scheme/ | Userstyle/extension dim restoration signal. |
| R12 | https://www.reddit.com/r/u_AlbatrossDependent93/comments/1tecnia/i_built_a_free_chrome_extension_to_organize/ | Bookmark organization product signal. |
| R13 | https://www.reddit.com/r/chrome_extensions/comments/1rchs9f/i_built_a_zeroaccess_extension_for_x_twitter/ | Local browser extension vs API cost/security signal. |
| R14 | https://www.reddit.com/r/socialmedia/comments/1sql9ux/i_compared_xtwitter_management_tools_honest/ | Reply management comparison. |
| R15 | https://www.reddit.com/r/chrome_extensions/comments/1n9p784/i_made_a_chrome_extension_to_mass_delete_tweets/ | Mass deletion pain point. |
| R16 | https://www.reddit.com/r/DataHoarder/comments/1fdovxq/looking_for_a_twitterx_media_downloader_bulkbatch/ | Bulk media downloader demand. |
| R17 | https://www.reddit.com/r/Twitter/comments/1jz94ir/i_created_a_tampermonkey_script_to_easily_screenshot_twitterx_posts_and_capture_entire_threads/ | Screenshot/thread capture userscript. |
| R18 | https://www.reddit.com/r/userscripts/comments/1sua7we/request_gif_posts_blocker_for_xtwitter_at_least/ | GIF/media filter request. |
| R19 | https://www.reddit.com/r/Twitter/comments/1ct5utd/url_change_to_xcom_broke_a_bunch_of_my_extensions/ | x.com migration breakage. |
| R20 | https://stackoverflow.com/questions/78661948/chrome-extension-update-dom-on-x-com-twitter | MutationObserver/content-script approach for x.com. |
| R21 | https://stackoverflow.com/questions/77023902/how-to-access-modify-dom-elements-in-chrome-extension-manifest-v3-content-scri | MV3 content script DOM access reference. |
| R22 | https://www.reddit.com/r/chrome_extensions/comments/1sa93sz/i_got_tired_of_paid_x_unfollow_extensions_so_i/ | Review-first unfollow workflow signal. |
| R23 | https://www.reddit.com/r/chrome_extensions/comments/1njlxyx/i_made_a_simple_chrome_extension_that_sorts_twitterx_replies_by_likes/ | Reply sorting by likes signal. |
| R24 | https://www.reddit.com/r/chrome_extensions/comments/1t9vuxw/i_built_a_chrome_extension_to_save_xtwitter_posts/ | Local swipe-file/save-post workflow signal. |
| R25 | https://www.reddit.com/r/techsupport/comments/1cj1kt7/question_is_there_anything_to_mass_remove_retweets/ | Retweet cleanup demand. |
| R26 | https://www.reddit.com/r/webdev/comments/1rn206u/is_indexeddb_actually_viable_in_2026_or_am_i/ | IndexedDB/Dexie storage tradeoff signal. |
| R27 | https://www.reddit.com/r/webdev/comments/ywt3fj/security_difference_between_localstorage_and_indexeddb/ | Browser storage security discussion. |
| R28 | https://www.reddit.com/r/chrome_extensions/comments/1s69b2s/minimizing_permissions_for_chrome_extension/ | Optional permissions and trust UX. |

Platform, standards, and API docs:

| ID | URL | Use |
|---|---|---|
| P01 | https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3 | MV3 background/service worker/remote code constraints. |
| P02 | https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest | DNR constraints and extension network strategy. |
| P03 | https://developer.chrome.com/docs/extensions/reference/api/userScripts | Chrome userScripts API. |
| P04 | https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts | Content script worlds and injection model. |
| P05 | https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API | TrustedTypes and injection sink rules. |
| P06 | https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe | MutationObserver behavior. |
| P07 | https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API | IndexedDB storage model. |
| P08 | https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system | OPFS for large local data. |
| P09 | https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto | WebCrypto encryption primitives. |
| P10 | https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/userScripts | Firefox MV3 userScripts API. |
| P11 | https://docs.x.com/x-api/fundamentals/rate-limits | Official X API rate limits. |
| P12 | https://docs.x.com/developer-guidelines | X developer guidelines and prohibited automation. |
| P13 | https://help.x.com/en/rules-and-policies/x-limits | X platform account/action limits. |

Academic, engineering, dependency, and security sources:

| ID | URL | Use |
|---|---|---|
| A01 | https://arxiv.org/abs/2404.08310 | Manifest V3 ecosystem analysis. |
| A02 | https://arxiv.org/abs/2507.13926 | Developer insight on MV3 privacy/security. |
| A03 | https://arxiv.org/abs/2505.19456 | JavaScript inclusion risks in browser extensions. |
| A04 | https://arxiv.org/abs/2512.10029 | Malicious GenAI Chrome extension behavior. |
| A05 | https://arxiv.org/abs/2409.01880 | Browser extension archiving for ephemeral social media. |
| A06 | https://medialab.sciencespo.fr/en/tools/zeeschuimer/ | Browser traffic capture for social media research. |
| A07 | https://www.pure.ed.ac.uk/ws/portalfiles/portal/483223108/AlHaririEtalCSCW2024TwiXplorer.pdf | Twitter/X narrative exploration and analysis UI. |
| A08 | https://www.archives.gov/records-mgmt/resources/socialmediacapture.pdf | Social media capture/archive practices. |
| A09 | https://security.snyk.io/package/npm/jszip | JSZip maintenance/security signal. |
| A10 | https://github.com/dexie/Dexie.js/releases | Dexie release/changelog signal. |
| A11 | https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html | TypeScript 5.9 release notes. |
| A12 | https://cybernews.com/security/chrome-extensions-flagged-for-stealing-user-data/ | 2026 malicious Chrome extension campaign. |
| A13 | https://www.island.io/browser-extension-security/browser-extension-security-defending-against-network-request-manipulation | Extension network manipulation risk. |
| A14 | https://nvd.nist.gov/vuln/detail/CVE-2026-40451 | Chrome extension XSS vulnerability example. |
| A15 | https://arxiv.org/abs/2604.17668 | JavaScript/npm dependency vulnerability propagation. |

## Appendix B: Self-Audit

Mandatory Phase 5 checks:

| Check | Result |
|---|---|
| Full roadmap re-read | Passed after rewrite. Sections align from repo state to sources to features to tiers to phases. |
| Every item traceable to Appendix | Passed. Feature rows include source IDs, and every source ID maps to a URL/path. |
| Every tier placement justified | Passed. Gap table includes fit, impact, effort, risk, dependencies, novelty, tier, and one-sentence rationale for each item. |
| Required categories covered | Passed: security, accessibility, i18n/l10n, observability/telemetry, testing, docs, packaging, plugin/preset ecosystem, mobile, offline/resilience, multi-user/collab-adjacent sharing, migration, upgrade strategy. |
| Thin categories consciously handled | Multi-user/collab is intentionally limited to export/share targets and not live collaboration because local-first privacy is the core philosophy. Plugin ecosystem is expressed as feature registry/presets, not third-party arbitrary code for v1. |
| Duplicate items removed | Passed. Feature IDs are unique; rejects are not repeated in Now/Next/Later. |
| Hostile-review concerns addressed | Passed. The roadmap calls out missing fixtures, API volatility, store review, account risk, dependency supply chain, and destructive-operation safety. |
| Disk write confirmed | This file is `<repo root>\ROADMAP.md`. |

## Competitor Gaps, 2026-08-07 research pass

Sourced from the userscript indexes (Greasy Fork itself edge-blocks automated clients, so the
listing was read through userscript.zone plus targeted search). Ranked by how often the capability
shows up in high-install scripts against how much of it Aviary already has.

## Audit Findings, 2026-08-06 (not fixed in this pass)

Raised during the full engineering/UX/security audit of v1.6.0. Items fixed in that pass are
in CHANGELOG.md; these are the ones left open, with the reason each was not taken.


## Audit Findings, 2026-08-07 (audit-only pass; not fixed)

Baseline at `409f846`: `tsc` clean, 188/188 tests pass, build+preflight green. Findings are
ordered P1 → P3; each was verified as described in its Evidence line. Verification harnesses ran
read-only (Playwright against `_decoded/home.html` and scratch pages); no source was changed.

## Audit Findings, 2026-08-08 (live Chrome audit; not fixed)

Baseline at `89dc1e1`: `npm run typecheck`, all 257 tests, `npm run build`, and
`npm run preflight` pass. The audit exercised all 13 Control Center pages in a dedicated signed-in
Chrome tab on current `x.com`, restored the original settings and audited store entries/counts, and made no
source changes. Items below are deduplicated against the feature catalog, prior audit sections, and
`Roadmap_Blocked.md`; they are ordered P1 → P3.

## Audit Findings, 2026-08-10

- [ ] P2, Secondary Control Center sections bypass the localization choke point
  Category: ux
  Where: `src/ui/control-center.ts:273,918-1069,1156-1261,1365-1402,1554-1637,2136-2155`; `src/platform/i18n.ts:2828-2839`
  Problem: The panel’s `t()` helper is exact-string keyed, but many stable labels, descriptions, empty states, action statuses, and the dialog ARIA label in the snapshots/archive, integrations, semantic-search, external-export, and crosspost sections are passed directly to `el()`/`setStatus()` as English strings. The extractor/catalog may contain those strings, but runtime never calls `t()` for them, so a user who selects es/fr/ja/ar sees translated chrome and English secondary workflows.
  Evidence: For example, “Import official X archive”, “Search captured records”, “Aria2 active downloads”, “Crosspost as thread”, and “Semantic search” are raw `el()` text at the cited lines; `setStatus()` translates only an exact catalog key, so interpolated statuses such as `Captured ${count} followers...` also fall back to English. The existing i18n tests validate catalog coverage, not rendered secondary-section language.
  Fix: Route every stable secondary label, description, status template, empty/error state, tooltip, and ARIA name through stable catalog keys/formatters with explicit interpolation values; keep runtime data (counts, handles, URLs) separate from translated copy. Extend locale tests to mount and exercise every section/action.
  Acceptance: In each of the nine locales, every secondary section and its success/error/empty states render translated stable copy, the dialog accessibility name is localized, and no raw English source label from the cited sections remains in the rendered accessibility/text tree except intentional data/brand names.
  Confidence: Verified
  Effort: M

- [ ] P2, Privacy and installation documentation describes a pre-integration release
  Category: docs
  Where: `docs/PRIVACY.md:63-65`; `docs/INSTALL.md:23-26`; `docs/FAQ.md:5-11,31-37,49-52`; current integration/permission paths in `src/features/integrations/` and `src/features/media/downloader.ts:74-116`
  Problem: The shipped docs still say optional permissions are future and unused by v0.3.0, say the first Save prompts for permission even though the current extension opens a dedicated options page, describe every feature as v0.9.0, claim Aviary’s only outbound traffic is selected media, list XLSX as future, and omit newer stored keys/features from uninstall/privacy guidance. Users can make incorrect trust, permission, and data-retention decisions from these statements.
  Evidence: The live source includes Aria2, Bluesky/Mastodon, AI, semantic-search, optional `downloads`/media-host permission handling, XLSX, snapshots, bookmarks, and multiple persisted stores; the cited docs contain the stale claims. The recent `b9fec4f` documentation fix updated README claims but did not update these three docs, so this is a current release drift rather than a duplicate of that change.
  Fix: Rewrite the three docs for v1.16 behavior: enumerate opt-in outbound integrations and local-only gating, describe the options-page grant/revoke flow, list current formats and all persisted keys/clear paths, and state which integrations/permissions are user-triggered. Add a docs consistency check for versioned feature/permission claims.
  Acceptance: A fresh-doc review finds no v0.3/v0.9/XLSX-future/“only media outbound” claims, permissions and integration behavior match the source and README, and the uninstall/privacy tables include current snapshots, bookmarks, semantic, Aria2, query, and cleanup state.
  Confidence: Verified
  Effort: M

- [ ] P2, Control Center overlay is visually open but not an actual modal
  Category: a11y
  Where: `src/ui/control-center.ts:265-342,3389-3422`
  Problem: The open overlay has `pointer-events: none`, while only `.av-panel` has `pointer-events: auto`; clicks outside the panel therefore pass through to X. The dialog has no `aria-modal="true"`, no focus trap, no Escape close path, and no background inerting beyond the overlay’s own closed state. Keyboard and screen-reader users can move into the page behind an open settings dialog, and pointer users can activate X controls through its backdrop.
  Evidence: `setOpen(true)` focuses the panel but does not constrain subsequent focus; the CSS explicitly repeats `pointer-events: none` for `.av-overlay.is-open`. The only close listeners are launcher and close-button clicks at lines 2770-2771. Existing `tests/audit-a11y.test.mjs` verifies only the closed panel’s inert/visibility behavior, not active modal isolation; this also falls short of the roadmap’s F094 active-overlay contract.
  Fix: Implement a real modal pattern: set `aria-modal`, use a localized dialog label, consume/backdrop-handle pointer events while open, trap focus with a policy-approved focus-sentinel/focusin or native-dialog approach, close on Escape, and restore launcher focus on close. Update the preflight keyboard-event policy deliberately if the chosen Escape implementation requires it.
  Acceptance: Headless keyboard/pointer automation cannot focus or click X controls while the panel is open; Tab and Shift+Tab wrap within the panel, Escape closes it, focus returns to the launcher, the accessibility tree exposes one modal dialog, and the backdrop behaves consistently in every supported theme.
  Confidence: Verified
  Effort: M

- [ ] P2, Injected touch controls remain below the 44 px target or disappear on coarse pointers
  Category: a11y
  Where: `src/features/core/mobile-touch.ts:50-64`; `src/features/filtering/hidden-posts-feature.ts:479-508`; `src/features/library/bookmarks-feature.ts:266-286`; `src/features/ai/command-menu.ts:282-303`; `src/features/composer/composer-snippets.ts:229-271`
  Problem: The page-level touch rules give Hide and media buttons only `min-height: 40px`; hidden-post and bookmark buttons are authored at 24px; AI uses `opacity: 0` except hover/focus; and snippet/AI controls have compact padding with no coarse-pointer override. On touch there is no hover to reveal the AI trigger and several controls are materially smaller than the 44px product/accessibility target.
  Evidence: The Control Center correctly has a shadow-root `@media (pointer: coarse)` rule with 44px controls, but the page-injected controls use the cited independent styles. The existing touch contract test checks only Control Center sizing and hidden-button legibility, not the full injected-control set.
  Fix: Add a shared coarse-pointer contract for all injected action buttons/menu triggers and options: minimum 44×44 hit boxes, adequate spacing, and a visible AI/snippet affordance on touch. Keep labels visually compact inside the larger target rather than scaling the page layout.
  Acceptance: With `matchMedia('(pointer: coarse)')` true, computed bounding boxes for Hide, Save/Thumb/Video, local bookmark, AI trigger, Snippets, and their menu options are at least 44px in both dimensions or have an equivalent 44px hit wrapper; AI is discoverable without hover.
  Confidence: Verified
  Effort: M

- [ ] P2, AI and snippet popovers expose menu roles without keyboard menu behavior
  Category: a11y
  Where: `src/features/ai/command-menu.ts:129-171,236-243`; `src/features/composer/composer-snippets.ts:109-150,168-191`
  Problem: Both features create `role="menu"`/`role="menuitem"` popovers, but triggers do not expose `aria-expanded`/`aria-controls`, opening does not move focus into the menu, and dismissal has no Escape/focus-restoration path. A keyboard user can remain on the trigger or tab into the page behind the menu, while screen readers receive incomplete disclosure state.
  Evidence: The only dismissal listeners are deferred document click handlers; there is no focus assignment or keyboard dismissal in either cited `openMenu`/`openPalette` function. The buttons are appended to `document.body`, outside the trigger’s local DOM context.
  Fix: Give each trigger a stable controlled-menu id and expanded state, focus the first menu item on open, support Escape and outside dismissal, restore the trigger focus, and implement the chosen WAI-ARIA menu keyboard model (or use a semantically simpler listbox/popover pattern that matches the actual interaction).
  Acceptance: Keyboard automation opens each popover, exposes the correct accessible relationship/state, reaches every option without entering the page behind it, closes with Escape/outside click, and restores focus to the originating trigger after selection/dismissal.
  Confidence: Verified
  Effort: M

- [ ] P2, Secondary file/search controls and the thread checkbox have no programmatic labels
  Category: a11y
  Where: `src/ui/control-center.ts:1003-1010,1041-1047,1365-1374,1554-1564`
  Problem: The archive file input, archive search input, semantic search input, and “Crosspost as thread” checkbox are placed beside visual copy in `div` rows without an associated `<label>`, `id/for`, or `aria-label`. Placeholder text and adjacent spans are not a reliable accessible name, so these secondary controls are unnamed or ambiguously named in the accessibility tree.
  Evidence: The cited inputs are created directly and appended with `row.append(copy, input)`/`threadRow.append(copy, checkbox)`, unlike the shared `textInputRow`/`textareaRow` helpers that explicitly set `aria-label`. The external smoke test locates them by visual row text, which does not validate screen-reader naming.
  Fix: Give each control a localized stable label and explicit association (`label`/`for` or `aria-labelledby`), including a localized name for the thread checkbox; preserve the existing visual copy and focus behavior.
  Acceptance: Accessibility-tree assertions report localized names “Import official X archive”, “Search captured records”, “Semantic search”, and “Crosspost as thread” for the corresponding controls in all nine locales, with no unnamed form control in those rows.
  Confidence: Verified
  Effort: S

- [ ] P2, RTL toasts and injected action spacing use physical left/right properties
  Category: visual
  Where: `src/features/core/feature-toast.ts:97-126`; `src/features/filtering/hidden-posts-feature.ts:479-484,531-550`
  Problem: In Arabic/Hebrew, both toast components stay at physical `right: 16px` instead of the inline-end side, and the feature-error accent remains a physical `border-left`; the Hide button also uses physical `margin-right`. This makes toast placement, accent direction, and action spacing disagree with the RTL Control Center/page direction, even though the i18n feature sets RTL correctly elsewhere.
  Evidence: `tests/smoke/aviary.smoke.mjs:520-530` verifies only document/primary-column direction and never opens either toast. The cited shadow styles hard-code the physical properties, and shadow hosts do not rewrite them through page-level direction CSS.
  Fix: Replace physical placement/borders/margins with logical properties (`inset-inline-end`, `border-inline-start`, `margin-inline-end`) and ensure the shadow host inherits/receives the active direction. Recheck both toast stacks and undo-button ordering in RTL and LTR.
  Acceptance: Headless RTL computed-style/layout assertions place both toasts at inline-end, put the error accent on inline-start, and keep Hide/Undo spacing and reading order correct; LTR remains unchanged across all themes.
  Confidence: Verified
  Effort: S

- [ ] P3, The Control Center is a 4,000+ line god module with duplicated section wiring
  Category: maintainability
  Where: `src/ui/control-center.ts:241-2781,488-2602,2960-3318`
  Problem: Mounting, modal state, search/focus restoration, localization accounting, all 13 section renderers, every async action, status/error handling, and shared form helpers live in one closure/file. This boundary makes it easy for new secondary rows to bypass `t()`, the action rejection wrapper, or the accessibility contract,as the current findings demonstrate,and makes independent review/testing of a section unnecessarily risky.
  Evidence: The file contains the single `mountControlCenter()` orchestration plus section builders from Appearance through Trust and all helper implementations; it is roughly 4,275 lines. The raw secondary strings and custom Aria2 handler are in the same module but bypass the shared helpers that already solve those problems elsewhere.
  Fix: Keep one small mount/orchestration layer and extract section builders/actions into `src/ui/control-center/sections/` with a typed `PanelContext` exposing translator, status, error, focus, and save helpers. Centralize modal/a11y and async-action contracts, and add section-level tests before moving code.
  Acceptance: `control-center.ts` contains only orchestration/shared contracts, each section compiles and has focused tests, `npm run verify` remains green, and a static review can prove every new row uses the shared translation/error/accessibility helpers without behavior changes.
  Confidence: Verified
  Effort: L

- [ ] P3, Release verification has no lint/static-analysis stage
  Category: testing
  Where: `package.json:11-17`; `.github/workflows/smoke.yml:20-47`
  Problem: The repository has no `lint` script or linter configuration, and `npm run verify` runs only TypeScript checking, tests, build, and preflight regex contracts. Type errors and source-policy violations are covered, but unused/dead code, unsafe complexity, accessibility anti-patterns, and maintainability regressions can pass the release gate.
  Evidence: `package.json` lists `build`, `preflight`, `test`, `typecheck`, `smoke`, and `verify` only; the workflow runs build/smoke but no lint/static analysis. The current baseline is green (`npm run verify` and `npm run smoke`), so this is a coverage gap rather than a pre-existing failure.
  Fix: Adopt a pinned, repository-appropriate linter/static-analysis configuration, add a deterministic `npm run lint`, include it in `verify` and CI, and tune rules for the browser/userscript/shadow-DOM constraints instead of relying on broad regex checks.
  Acceptance: `npm run lint` exists, runs without modifying files, reports actionable diagnostics, is part of `npm run verify` and CI, and the current source passes it.
  Confidence: Verified
  Effort: M

- [ ] P3, Expand the release test matrix to cover unaudited live and secondary environments
  Category: testing
  Where: `tests/smoke/aviary.smoke.mjs:161-166,222-249`; `tests/smoke/externally-gated.smoke.mjs:528-755`; `tests/audit-ui.test.mjs`; `tests/audit-a11y.test.mjs`; `package.json:14-17`
  Problem: The green smoke suite covers Home, Home/Following query state, one profile root, Search, one status route, page-hook combinations, current-X fixture controls, and local provider stubs. It does not exercise profile followers/following/verified-followers subroutes, Notifications, Messages, the media viewer, real composer insertion/crosspost attachment, the options grant/revoke flow with a granted permission, malicious/oversized archives, bridge spoofing, boot/destroy/boot, all secondary locales, all nested surfaces in every theme, or real authenticated X markup/browser variants. The audit therefore cannot claim release coverage for those areas.
  Evidence: The route list and external flow are explicit in the cited smoke files; the UI tests mostly inspect source/tokens and the closed dialog, and `npm run verify`/`npm run smoke` currently pass with no baseline failures. Real authenticated X, Firefox/Safari, screen-reader, Tampermonkey/Violentmonkey, and successful permission-grant environments were not available for this pass and remain unaudited.
  Fix: Add headless fixture routes and focused tests for every listed state: route/surface transitions, all nine locales and six theme modes with nested toasts/popovers/dialogs, coarse-pointer geometry, modal/menu keyboard behavior, malformed storage/provider responses, Unicode caps, ZIP expansion limits, subscription lifecycle, and options permission success/revoke. Keep a separate externally gated matrix for authenticated/browser-manager/provider differences and document any credential-gated blockers.
  Acceptance: CI publishes a deterministic matrix covering each listed route, state, locale/theme, keyboard/coarse-pointer mode, malformed input, and lifecycle scenario; the missing real-auth/browser-manager lanes are explicitly marked blocked with a reproducible manual/headless procedure rather than silently omitted.
  Confidence: Verified
  Effort: L

## Research-Driven Additions

- [ ] P2, Unify archive, bookmark, notes, and semantic search behind one offline query model
  Why: Users must search different surfaces separately even though Aviary presents one local library; lexical search indexes only checkpoint `ExportRecord` values while bookmarks and semantic vectors have separate stores and substring/query behavior.
  Evidence: Verified in `src/features/library/local-search.ts:14-85`, `src/features/core/control-center.ts:650-664`, `src/features/library/bookmarks-feature.ts`, and `src/features/integrations/semantic-search.ts:48-147`. [xf](https://github.com/Dicklesworthstone/xf) demonstrates hybrid lexical/vector filtering, while [Raindrop’s filters](https://help.raindrop.io/filters) and [Dewey](https://getdewey.co/) demonstrate tags, folders, notes, and collection filters.
  Touches: shared indexed domain/search types; bookmark/archive/snapshot adapters; semantic provider adapter; Control Center search UI and saved queries; locale/accessibility strings; Unicode and ranking tests.
  Acceptance: One search surface can query posts, likes, bookmarks, notes, tags, folders, and snapshot metadata with documented date/type/media/account filters; lexical results work with no network or API key; semantic ranking is optional and clearly marked; every result identifies its source collection and account; empty, Unicode, long-query, and malformed-filter cases are deterministic.
  Complexity: L

- [ ] P2, Make exported archives truthful about captured assets and provide a self-contained package
  Why: Current HTML and WARC outputs can look archival while media entries remain live URLs or explanatory metadata rather than captured bytes, so offline use and evidentiary completeness are ambiguous.
  Evidence: Verified in `src/features/export/formatters.ts` (media/permalink links remain HTTP(S)) and `src/features/export/warc.ts:26-40` (media bodies say they were not re-downloaded); compare the [WARC specification](https://iipc.github.io/warc-specifications/) and [archival capture guidance](https://www.archives.gov/records-mgmt/resources/socialmediacapture.pdf).
  Touches: `src/features/export/types.ts`; HTML/JSON/WARC formatters; media downloader integration; package manifest/checksum generation; export UI copy; offline/network-blocked tests.
  Acceptance: Every record/media entry declares `captured-bytes`, `remote-reference`, or `missing` status, source URL, capture time, and byte length/checksum when available; WARC response/resource records contain actual bytes or are explicitly metadata-only; no generated “offline” package silently fetches X at open time; interrupted media capture leaves a truthful manifest and retryable items.
  Complexity: L

- [ ] P2, Ship a responsive standalone archive viewer for exported packages
  Why: The current Control Center is tied to an X page and the export formats do not provide a usable large-library viewer, leaving users without an offline/mobile recovery path when X is unavailable.
  Evidence: Verified in `src/features/export/export-feature.ts:141-191` and the current formatter/ZIP path: exports are data files, not a bundled viewer. [xarchive](https://github.com/sytelus/xarchive) provides a local viewer with IndexedDB/large-list behavior, while [ArchiveBox](https://github.com/archivebox/archivebox) demonstrates replay/status-oriented archives.
  Touches: export package builder; new viewer assets/modules; archive manifest and search API; responsive CSS/touch semantics; viewer security policy; package/opening tests.
  Acceptance: An exported package opens from a local file or extension page without X access or remote script execution, renders at a 320 px viewport, supports search/filter/sort/thread/media-status views, handles a large fixture without rendering every row at once, preserves RTL/localized labels, and clearly marks missing or remote-only media.
  Complexity: L

- [ ] P2, Add a versioned full-library backup/restore flow with dry-run and rollback
  Why: Settings import/export is not a backup of bookmarks, snapshots, jobs, records, indexes, or notes; raw JSON external targets are one-way record exports and do not preserve the installation’s local library.
  Evidence: Verified in `src/features/core/settings-migration.ts` (settings envelope only), the independent store keys cited above, and `src/features/export/external-targets.ts` (record-oriented targets). User demand for ownership and bookmark recovery is visible in [DataHoarder’s export discussion](https://www.reddit.com/r/DataHoarder/comments/1iga2wd/how_do_i_download_all_my_twitter_bookmarks/) and [HN’s local archive discussion](https://news.ycombinator.com/item?id=46529797).
  Touches: repository serializer/importer; profile and schema manifest; Control Center backup/restore UI; secret redaction; transaction/rollback layer; migration and corruption tests.
  Acceptance: One user-selected backup contains versioned manifests and all selected local collections, excludes credentials by default, previews versions/counts/conflicts before mutation, supports dry-run and cancellation, validates checksums, and restores transactionally with rollback on any collection failure; legacy settings import remains compatible.
  Complexity: L

- [ ] P2, Give AI and embedding integrations an explicit data-disclosure and usage budget
  Why: Opt-in network policy prevents accidental calls, but users are not shown exactly what text leaves the browser or given a durable cost/volume boundary when auto-indexing runs on every export.
  Evidence: Verified in `src/features/integrations/ai-provider.ts` (full system/user prompt sent to the configured endpoint) and `src/features/integrations/semantic-search.ts:78-127,178-209` (one embedding request per record); the README’s local-first promise makes destination transparency part of the trust contract. [BrowserOS](https://github.com/browseros-ai/BrowserOS) and commercial bookmark tools show the ecosystem’s movement toward explicit local/provider choices.
  Touches: integration settings and network policy; AI/semantic request builders; Control Center consent/preview/usage UI; audit-log redaction; provider, timeout, and budget tests.
  Acceptance: Before the first external request and before enabling auto-index, the UI shows provider/endpoint, fields and character/token count, retained data, and network status; configurable per-request/daily record-byte limits stop further calls with a recoverable status; usage history never stores API keys or raw prompts by default; disabled/local-only modes make zero provider requests.
  Complexity: M
````

</details>
