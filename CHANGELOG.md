# Changelog

## Unreleased

### Fixed

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

## 1.16.0 - 2026-08-09

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

## 1.14.1 - 2026-08-08

### Fixed

- Store-ready Chrome and Firefox ZIP archives are now byte-reproducible. Packaging uses a stable
  DOS timestamp and sorted filesystem entries, so repeated verification builds no longer dirty
  tracked release artifacts when the source has not changed.

## 1.14.0 - 2026-08-07

### Fixed

- **The Save button made photos disappear.** Switching it on removed every image from the
  timeline; switching it off brought them straight back. Aviary's stylesheet forced
  `position: relative` onto `[data-testid="tweetPhoto"]` so the button had something to anchor to.
  X keeps that box at **height 0** — it is a flex container whose two children, the background-image
  div that actually draws the photo and the `<img>` beside it, are both `position: absolute;
  inset: 0`, with the real height carried by an ancestor. Making the zero-height box their
  containing block collapsed both to nothing: loaded, present in the DOM, and invisible.
  Aviary no longer restyles any of X's containers. The button measures its offsets against
  whichever ancestor X has already positioned — the same box the photo itself resolves against —
  and an absolutely positioned child is out of flow, so inserting it cannot disturb the layout
  either. Reproduced and pinned in `tests/media-button-layout.test.mjs`, which fails with
  "the stylesheet changed the photo from 317px to 0px" if the rule ever returns.
- **Turning "Hide posts" on gave you no Hide button.** v1.13.0 made both `hidden.enabled` and
  `hidden.buttons` default to off, so the feature needed two switches and nothing said so. The
  button now follows the feature, still gated by it — nothing is injected while the feature is off.


## 1.13.1 - 2026-08-07

### Fixed

- **Two stylesheets restyled X no matter what your settings said.** `media-buttons` injected its
  sheet from `init()` *before* checking `media.buttons`, so every install — including one with
  every option switched off — got `position: relative` forced onto every `tweetPhoto`,
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
  `data-av` attribute or `:host` — the property that both defects violated.


## 1.13.0 - 2026-08-07

### Changed

- **Installing Aviary now changes nothing about X.** A fresh install used to hide the right
  sidebar, hide trends, hide Grok, repaint the page with the "dim" theme, force `color-scheme:
  dark` over X's own setting, add a Hide button and two media buttons to every post, rewrite share
  buttons, and pause video that scrolled offscreen — none of it asked for. Everything that alters
  what X looks like or how it behaves now starts off, and only what you switch on applies. The
  launcher button is the sole exception, because without it nothing can be switched on.
  Invisible local bookkeeping (the action log, selector health, the local-only network guard)
  stays on, because it changes nothing on the page.
- The theme picker gained **Off (X's own theme)**, which is the new default. Choosing it removes
  every hook Aviary paints through, rather than painting a dark theme that happens to resemble X's.
- **Trust → Reset everything to plain X** puts every preference back to that state in one action.
  Saved posts, notes, bookmarks and download history are untouched — it resets preferences only.
  Flipping the defaults alone would have done nothing for anyone who already had settings stored.

### Removed

- **The sensitive-content modes are gone.** They could not tell sensitive media from any other
  media — every rule matched every photo and video — so "blur" smeared the whole timeline and read
  as images failing to load. Scoping them needs a capture containing sensitive media, and neither
  capture holds one. Aviary now leaves sensitive content entirely to X, whose own filter is the
  only thing here that knows which posts are sensitive.

### Fixed

- **The AI button and the snippet trigger injected themselves regardless of any setting.** Neither
  was gated on anything, so a "vanilla" install still put a button on every post — caught by
  counting real elements in a real timeline, not by reading the schema. The AI button now has its
  own toggle (Library → Show the AI button on posts, off by default), and the snippet trigger
  appears once there is a snippet to insert.
- **The launcher became unreadable on X in light mode.** It painted a translucent accent wash
  straight over the page, which only worked while Aviary forced X dark — measured at 1.12:1
  against its own near-white label on a white page. The gradient now mixes into an opaque
  surface, so what is behind it stops mattering.
- **Aviary was clearing X's own `color-scheme`.** X sets `color-scheme: dark` inline on `<html>`;
  resetting the theme wrote an empty string over it, taking X's value with it and flipping the
  page to `normal`. It now clears only the value it set itself.


## 1.12.1 - 2026-08-07

### Fixed

- **"Sensitive content" blurred or hid every photo and video, not just sensitive ones.** The rules
  behind the blur and hide modes match every `tweetPhoto` and video in the timeline; nothing in
  them tests whether X marked the media sensitive. Picking "Blur until hovered" therefore smeared
  the entire timeline at 18px, which reads as images failing to load rather than as a setting.
  Measured against the captured timeline: all three photos affected, none of them sensitive.
  Scoping the rules properly needs a capture containing sensitive media — neither `home.html` nor
  `status.html` contains a single instance, and the one `contentDisclosureButton` in either file
  belongs to the composer toolbar, not a post. Until then the control says what it does: it is
  now **Photos and videos**, offering "Blur every photo and video" and "Hide every photo and
  video".
- **The Media Archivist preset blurred your whole timeline.** It set that mode and described it as
  "sensitive blur" — a claim the build cannot keep, since it cannot tell sensitive media apart. An
  archivist preset has no reason to change how media is displayed; it no longer does.
- **Quiet Reader hid engagement counts without saying so.** Its description listed trends, borders,
  premium dimming and t.co cleanup, but not the like and reply counts it also removes. A test now
  fails any preset that hides counts without mentioning them, or that claims to act on sensitive
  media at all.


## 1.12.0 - 2026-08-07

### Added

- **Aviary can now see the page's own network layer**, which three features were designed around
  and none of them could reach. Both manifests gained a second content script declared
  `"world": "MAIN"`, and the userscript reaches the same place through `unsafeWindow`. A bridge
  carries settings in and observations back, and every hook stays off until a setting turns it on.
- **Refuse X's analytics beacons** (off by default, under Trust & privacy). Blocks the tracking
  pings X sends as you scroll, click and pause, across `fetch`, `XMLHttpRequest` and
  `sendBeacon`. A refused beacon is answered with `204` rather than rejected, because a thrown
  request surfaces in X's own error reporting — which is itself another beacon. Only the analytics
  endpoints are matched; the panel reports the running count, so a hook that never fires is
  visibly distinct from one that does not work.
- **Always play video at the highest quality** (off by default, under Performance). X streams
  timeline video through Media Source Extensions, so there is no `src` to rewrite and no
  `<source>` list to re-rank — the rendition is chosen by the player's own adaptive-bitrate logic.
  Aviary now trims the master playlist to its best rendition before the player sees it, so that
  logic has only one thing to choose. Sustained bandwidth decides, not peak.

### Removed

- **`privacy.encryptVault` is gone from the schema rather than implemented.** It had been parked
  on a key-custody decision: a key stored beside its own ciphertext protects nothing, and a
  passphrase-derived key means an unlock step and permanent data loss if the passphrase is
  forgotten. What settles it is scope — Aviary's vault sits in the same browser profile as X's
  own session cookie, auth token and cached media, none of which Aviary can encrypt and all of
  which are more sensitive than its copy. A toggle that encrypted the lesser half would invite
  the belief that the profile was protected. Full-disk encryption covers all of it. Settings
  files from older builds still carrying the key import cleanly.

### Fixed

- **Passive GraphQL capture never saw a single GraphQL response.** It wrapped `globalThis.fetch`,
  which is Aviary's own copy — the content script runs in the isolated world, so X's requests were
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
- **Four sentences shipped in English in every locale while coverage reported 100%** — the
  empty-search state ("Nothing matches that search.") and both preset confirmations. The string
  extractor learns a panel's copy by rendering it twice and keeping what appears in both, so copy
  behind a condition no render reaches is copy it cannot see. It now also harvests every literal
  passed to `t()` straight from the panel source, which needs no maintenance as rows are added.
  Nine locales, 470 → 488 strings.

## 1.11.0 - 2026-08-07

### Added

- **The Control Center header now shows the running version.** Reloading an unpacked extension
  gave no signal about which build actually took effect without opening `chrome://extensions`;
  the panel you already have open on x.com now says. Stamped in at build time from
  `package.json`, so the userscript and both extension builds report the same number, and a test
  fails if either manifest drifts from it.

## 1.10.0 - 2026-08-07

Drains the 2026-08-07 audit: 25 findings, all closed. Several were features that reported
success while doing nothing.

### Fixed

- **The video Save button was lying.** X streams timeline video through MediaSource, so the only
  variant is a `blob:` handle that no downloader can resolve — and because `blob:` counts as
  same-origin, the anchor fallback returned success with no degraded flag, so the button showed
  "Saved" while nothing reached disk. A blob now loses to any real URL in ranking, a blob-only
  video refuses to resolve, and no button is offered where nothing can be saved. The poster keeps
  its Thumb button. GIFs, which are served as real files, are unaffected.
- **That button was also invisible.** Every hover-reveal rule named `tweetPhoto`, but a video's
  container is the player — so the control sat at `opacity: 0` with no rule that could show it,
  anchored to whatever ancestor X happened to have positioned.
- **Importing an X archive could not read an X archive.** The reader accepted STORE entries only;
  official archives are DEFLATE like every standard zip. It now inflates through the platform's
  own `DecompressionStream`, and verifies the CRC against the inflated bytes.
- **A disabled aria2 integration still called your aria2 on every boot** (the check looked at the
  endpoint string, not the enabled flag) — and with local-only mode on, that reconcile threw
  through init, which the registry treats as a dead feature: every Save button disappeared.
- **One boot with a mistyped aria2 secret erased the queued-download ledger.** Any RPC fault
  mapped to "removed", and reconcile deletes those. Only an unknown GID means removed now.
- **"Test connection" queued a junk download every click** — it called `addUri` with a bogus URL,
  which aria2 accepts. It calls `getVersion` now.
- **Crossposts silently lost text.** Bluesky segments were cut at 300 UTF-16 units and the
  remainder posted nowhere; Mastodon was never chunked at all. Both are chunked to their real
  limits now, counted in graphemes and split at word boundaries. A thread that fails partway
  reports how much was already posted instead of inviting a retry that double-posts.
- **Thread mode was almost unreachable**: the composer read used `textContent`, which joins
  Draft.js paragraph blocks with no separator, so the blank-line split never fired.
- **Ten controls rendered in the browser default font.** `font: 700 13px/1.1 inherit` is invalid —
  the shorthand cannot take a CSS-wide keyword as its family, so the whole declaration is dropped.
  The Control Center launcher and every nav item measured Arial 13.33px/400.
- **Saved-post search could not match Japanese, Korean, Arabic, Hebrew or Cyrillic** — the very
  languages the panel is translated into. The tokenizer was ASCII-only.
- **The action log described the wrong events**: a failed crosspost was recorded as
  "export.start", an aria2 cancel as "export.complete". Six event kinds now exist and are used.
- Failed storage *reads* were silent, so a corrupted value read as unset and the next save
  overwrote it for good; aria2 handoff failures fell through to a browser download with no trace;
  the semantic index grew without bound; exports embedded unusable `blob:` URLs; Obsidian
  frontmatter broke on any display name containing a colon or quote.
- The filter engine re-extracted and re-decided every visible post on every mutation batch — its
  processed-stamp check could never hit, because the stamp was invalidated on every apply.
- `aria2.minBytes` could never take effect (no caller measured a size) and had no control in the
  panel; the export "capture as you scroll" path was unreachable; the settings nav rail clipped
  its last item with nothing to say it scrolled.

### Added

- **Aviary now speaks your language everywhere it appears.** The Control Center has been
  localized since v1.8.0, but every control injected into the timeline stayed English — the Hide
  button, media buttons, the AI menu, snippets, account-note badges, and the panel's own preset
  cards. All of it now translates, along with the extension options page, across nine locales
  (452 → 470 strings). The string extractor harvests these call sites from source, since a
  timeline control never renders inside the panel.
- **Visible outcomes for the AI menu and snippets.** Every path used to end in silence — success,
  provider failure and a blocked clipboard all looked identical, because the menu simply closed.
  A shared status toast now names the cause and the fix.
- **Settings that finally do something**: an aria2 size threshold that routes by measured size,
  with its missing panel control.

## 1.9.0 - 2026-08-07

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

- **Preset descriptions no longer promise ad-hiding.** Quiet Reader and Minimal both advertised
  "no promoted" while nothing implemented it. Detection turns out to need a capture Aviary does
  not have: `[data-testid="placementTracking"]` is not an ad marker — in `_decoded/home.html`
  both instances wrap organic content (a quote-tweet video and the news sidebar), and "Promoted"
  appears nowhere in either fixture. The copy is corrected and the feature is parked with its
  re-entry condition rather than shipped on a selector that would hide real posts.

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
