# Aviary

![Version](https://img.shields.io/badge/version-1.27.0-2f81f7)
![License](https://img.shields.io/badge/license-MIT-3fb950)
![Platform](https://img.shields.io/badge/platform-userscript%20%7C%20Chrome%20%7C%20Firefox-8b5cf6)

<img width="1536" height="1024" alt="exec-86ea8b21-28c3-4eff-bc69-b1d8f9ab3e7c" src="https://github.com/user-attachments/assets/a36c2cdb-2b74-4fde-a934-3c0ada11bbac" />


Aviary is a local-first X/Twitter enhancer delivered as a readable userscript first and a Manifest V3 extension second. The project is at v1.27.0: an opt-in premium Noir desktop skin, focused Home controls for the composer, discovery rail, current navigation and recommendations, default-on desktop ad protection, one-click original-quality image and direct-video downloads, transactional settings, local ad-contract drift diagnostics, a redesigned 13-page Control Center and responsive extension-permissions cockpit, committed desktop visual coverage, fixture-backed selector checks, reversible filtering, per-post hide-and-remember, checkpointed export/archive tools, local library features, opt-in integrations, persisted Aria2 history, configurable checkpoint retention, explicit crosspost media uploads, reproducible MV3 ZIP archives, and isolated Playwright smoke lanes.

## Ad-free with media saves ready by default

Fresh installs remove advertising and enable one clear Download action on every media post, plus
per-asset Save, Thumb, and eligible Video/GIF controls.
The media controls act only after you click them and can be disabled from Media at any time. Every
other elective setting that changes ordinary X content or styling — themes, sidebar/trend declutter,
Hide buttons, filters, offscreen video pausing, and general analytics refusal — still starts off.
Outside those download affordances, Aviary adds only its launcher to X's primary left navigation.

`tests/vanilla-by-default.test.mjs` measures this rather than asserting it: with default settings
it mounts the real theme code against an organic captured timeline and requires non-ad computed
styles to come back byte-identical. Ad-specific fixtures separately verify structural removal.

Already configured it and want to start over? **Trust → Reset everything to plain X**. That resets
preferences to Aviary's minimal ad-free baseline; saved posts, notes, bookmarks and download
history are kept.

Aviary does not touch sensitive media. It has no setting for it, because it cannot tell sensitive
posts from any other post — X's own filter is the only thing here that knows, and it is left to do
its job.

## Current Status

- Userscript entry: `src/entrypoints/userscript.ts`
- MV3 content entry: `src/entrypoints/extension-content.ts`
- MV3 background entry: `src/entrypoints/extension-background.ts`
- MV3 promoted-logger rule: `src/extension/ad-rule.ts` (dynamic, synchronized to
  `privacy.blockAds`; Firefox uses an event-page background plus an empty static compatibility set)
- MV3 page-world entry: `src/entrypoints/extension-page.ts` (declared `"world": "MAIN"`; the userscript reaches the same place through `unsafeWindow`)
- Page bridge and agent: `src/platform/page-bridge.ts`, `src/page/page-agent.ts`
- Document-start ad protection: `src/features/privacy/ad-protection.ts` plus the page-agent's exact
  promoted-content logger guard
- Stable selector registry: `src/platform/selectors.ts`
- Settings/storage foundations: `src/platform/settings.ts`, `src/platform/storage.ts`
- Layout declutter and theme foundations: `src/features/layout/declutter.ts`, `src/features/appearance/theme.ts`
- Filter engine and predicates: `src/features/filtering/filter-engine.ts`, `src/features/filtering/predicates.ts`
- Hidden posts: `src/features/filtering/hidden-posts.ts` (store), `src/features/filtering/hidden-posts-feature.ts` (Hide button + collapse)
- Media downloads: `src/features/media/` (`media-buttons.ts`, `urls.ts`, `template.ts`, `history.ts`, `queue.ts`, `downloader.ts`, `extract.ts`, `video-extract.ts`, `media-presentation.ts`, `batch-downloader.ts`)
- Export core: `src/features/export/` (`export-feature.ts`, `collector.ts`, `formatters.ts`, `assets.ts`, `viewer.ts`, `zip-store.ts`, `zip-reader.ts`, `jobs.ts`, `query-discovery.ts`, `network-capture.ts`, `xlsx.ts`, `warc.ts`, `external-targets.ts`, `types.ts`)
- AI: `src/features/ai/command-menu.ts` (local prompt builder; optionally runs through `features/integrations/ai-provider.ts` when the user supplies an API key)
- Integrations: `src/features/integrations/` (`aria2.ts`, `crosspost.ts`, `ai-provider.ts`, `semantic-search.ts`, `usage.ts`)
- Library: `src/features/library/` (`user-notes.ts`, `link-unshorten.ts`, `snapshots.ts`, `snapshots-feature.ts`, `archive-import.ts`, `cleanup-preview.ts`, `cleanup-queue.ts`, `reports.ts`, `local-search.ts`, `bookmarks.ts`, `bookmarks-feature.ts`)
- Composer: `src/features/composer/composer-snippets.ts`
- i18n: `src/platform/i18n.ts` + `src/features/core/i18n-feature.ts`
- Presets: `src/features/core/presets.ts`
- Core utilities: `src/features/core/` (`control-center.ts`, `selector-health.ts`, `audit-log.ts`, `settings-migration.ts`, `library-backup.ts`)
- Fixture tests: `tests/*.test.mjs`

## Desktop settings

All 13 Control Center destinations and the extension permissions page share one desktop cockpit
system with a fixed rail, grouped navigation, flat control rows, explicit dependencies, keyboard
focus treatment, and reduced-motion support. Settings stay in an isolated page draft until the
sticky Save control commits the whole page once; Revert restores the saved values, and navigation
is guarded while a draft is open. The primary verification viewport is 1440×900, with a 1920×1080
wide check.

![Aviary Control Center presets page](docs/mockups/control-center-presets-implemented.png)

## Premium Noir theme

Choose **Appearance → Theme → Noir** for Aviary's authored dark desktop skin. It gives the full X
shell a near-black blue base, subtle cyan/violet light, elevated timeline cards, a continuous
navigation rail, refined composer/search surfaces, and restrained action highlights. Noir uses
semantic roles and stable X test ids rather than generated classes, avoids page-wide blur on the
infinite timeline, and remains opt-in: choosing **Off (X's own theme)** removes every Aviary paint
hook and restores the site's styling.

All six authored dark palettes now repaint the semantic shell and readable timeline surfaces even
when X itself is set to a light host theme. Automated coverage switches every palette across both
host themes at 1440×900 and 1920×1080, checks text contrast and overflow, and proves that Off
restores the host exactly.

## Focused Home

Layout now offers independent controls to hide Home's quick composer and Who to follow cards.
Hide trends collapses the complete current news/trend cards instead of leaving headings or empty
shells, Hide Grok also catches its sidebar promotion and floating Chat drawer, and navigation
cleanup understands X's current Follow, Chat, Grok, History, Creator Studio and Premium destinations. The Minimal
preset combines those reductions with a comfortable-width Noir timeline while keeping every
choice reversible.

## Development

```powershell
npm ci --ignore-scripts
npm run verify
```

Aviary has zero runtime dependencies, so nothing it ships needs an install script to build or run —
and every major npm compromise of 2026 (axios, keyv/cacheable, the node-gyp worm) executed through
one. `--ignore-scripts` closes that class at no cost here; the build and the full test suite pass on
a clean install without them. Node 22.23.2 or newer is required, the first line clear of the June
and July 2026 Node security releases.

`npm run verify` type-checks the TypeScript source, runs fixture/source contract tests, and builds:

- `dist/aviary.user.js`
- `dist/extension-chrome/`
- `dist/extension-firefox/`

`npm run test:matrix` runs the deterministic release matrix separately: every supported route,
locale, theme, keyboard/coarse-pointer mode, malformed input class, provider response class, and
subscription lifecycle is reported locally before the headed smoke lanes.

`npm run test:visual` rebuilds the extension and compares 60 desktop settings screenshots: all 13
Control Center destinations plus extension permissions at 1440×900 and 1920×1080 on dark and light
X hosts, with focused, invalid, saved, reduced-motion, and disabled-permission states. The reviewed
limit ignores per-channel deltas up to 24 and allows at most 1% changed pixels, enough for glyph-edge
antialiasing without accepting a moved card or missing footer. After intentionally reviewing a UI
change, regenerate the committed baselines with `npm run test:visual:update`.

`npm run capture:theme -- <output.png> <width> <height> <theme>` captures any authored palette;
for example, `npm run capture:theme -- docs/audit/noir.png 1440 900 noir`. Supported theme ids are
`dim`, `lightsOut`, `graphite`, `plum`, `midnight`, and `noir`.
`npm run capture:settings -- <output-directory> <width> <height> <dark|light>` uses the same
deterministic settings harness for ad-hoc captures.

## Privacy Model

Aviary is designed to keep account data local. It sends no telemetry, never reads or exports cookies or auth headers, and loads no remote code. Credentials you enter for optional integrations are stored locally and are redacted when you export settings.

AI and embedding calls are opt-in and show the destination, fields, estimated size, retention
notice, network status, and budget before provider work begins. Per-request and daily UTF-8 byte
limits are configurable in Integrations; profile-scoped usage history stores counters only, never
API keys or raw prompts. Local-only mode and disabled integrations make zero provider requests.

Aviary can also refuse X's general analytics beacons — the tracking pings sent as you scroll,
click and pause. That broader privacy control is off by default. Ad protection is separate: the
userscript answers only X's exact promoted-content logger locally at document start, while the
extension blocks the same URL before a connection through one host-scoped dynamic request rule.
Timeline, media, login, and unrelated analytics traffic stay untouched. Turning off **Block ads**
removes the dynamic rule immediately; turning it back on restores it, including after restart.

## Desktop ad protection

- Starts at document start in both the userscript and MV3 builds and is enabled by default.
- Prevents the separable `/i/api/1.1/promoted_content/log.json` event from reaching the network
  through page `fetch`, XHR, or `sendBeacon`.
- Removes native `Ad` units, paid partnerships, promoted trends, Grok/Premium house promos, and
  visible video-ad containers, then collapses the owning timeline cell so no reserved gap remains.
- Re-runs after client-side navigation and delayed timeline insertion, and reverses cleanly when
  disabled.
- A minimal synthetic corpus in `tests/fixtures/ad-corpus/` locks those structures without storing
  handles, post text, account/tweet ids, media, credentials, response bodies, or remote assets.
- Trust keeps a local, profile-scoped ring of at most 64 ad-marker observations for 30 days. Each
  entry contains only a route category, timestamp, and native/trend/house-promo/video counts. If a
  marker previously seen on that route disappears, selector health reports the contract drift;
  **Reset ad observations** clears the ring and warning.
- Does not block HomeTimeline. X delivers native sponsored records in the same essential
  first-party response as ordinary posts, so those bytes are inseparable and only their rendering
  can be suppressed safely.

Aviary does not encrypt its local data, and deliberately offers no setting that claims to. Its vault sits in the same browser profile as X's own session cookie, auth token and cached media — none of which Aviary can encrypt, all of which are more sensitive than its copy. Use full-disk encryption, which covers all of it.

See [docs/PRIVACY.md](docs/PRIVACY.md) for the local data map and optional permission notes.

## Filtering

The Control Center "Filtering" section exposes:

- Master toggle for all filter rules.
- Keyword and regex rule lists (one per line; `/pattern/flags` or bare patterns, case-insensitive by default).
- Whitelist of handles that are never filtered.
- Premium/verified action selector (off / hide / dim).
- Photo, video, and GIF media-type filters.
- Per-route activation chips (Home, Status, Profile, Search, Notifications, Messages).

Filters process only tweet articles added by MutationObserver and re-evaluate existing tweets when rules change. Disabling the master toggle removes every visible filter effect without a reload.

Blocked-account (F032) and self-repost (F033) filters are deferred until an authenticated fixture capture lands; their settings keys are reserved.

## Hidden Posts

Every post carries a **Hide** control next to its More menu. Clicking it records the post locally and collapses it for good, so the following post is promoted into the slot instead of leaving a gap — you can clear a timeline by tapping Hide rather than scrolling past.

- Posts are keyed by status id. Posts without a `/status/` link (promoted units, some cards) fall back to a handle + text signature so the same unit stays hidden after a refresh.
- Hiding collapses the owning `[data-testid="cellInnerDiv"]` row, not just the article, because X positions timeline rows absolutely inside a measured container. A single coalesced `resize` event lets the virtualizer close the gap without moving scroll position.
- A toast with **Undo** appears after each hide; the Control Center also offers "Undo last hide", per-post Restore for the eight most recent, and "Clear hidden posts".
- Storage key: `aviary.hiddenPosts.v1`. The oldest entries are dropped once the store passes "Maximum remembered posts" (default 5000, range 100-50000).
- The Control Center "Hidden posts" section controls the master switch, the per-post button, per-route activation, and the cap. Turning the master switch off reveals everything again without forgetting anything.

## One-click media

The Control Center "Media" section exposes:

- Default-on master toggle for one persistent post-level Download action plus per-asset Save / Thumb / eligible Video and GIF buttons.
- Original-quality preference (`name=orig` first, then `4096x4096` only if the original transfer fails).
- Filename template with `{handle}`, `{tweetId}`, `{mediaId}`, `{index}`, `{total}`, `{date}`, `{text}`, `{ext}` fields.
- Duplicate history toggle and a "Clear download history" action.
- Live status readout (running / completed / duplicate / failed) and the size of the dedup index.

Downloads prefer `GM_download` in userscript managers, fall back to the extension service worker (`chrome.downloads` with `conflictAction: uniquify`), and finally use an anchor tag when no privileged downloader is available. Image candidates stay in quality order; the extension persists the bounded fallback while a download is active so an interrupted `orig` transfer can resume at `4096x4096` after its service worker wakes again.

The post action sits beside X's native controls and downloads every attached photo and direct
video/GIF in one click, excluding video thumbnails. It remains labeled on desktop and contracts to
a 44-pixel icon action on narrow touch screens. The per-asset overlay remains for selective saves.
Both controls report resolving, Saving, Saved, Queued, Allow, or Retry in place, expose busy state
to assistive technology, preserve completed assets across a partial retry, and return to their
original action after feedback. The MV3 build also adds **Download media with Aviary** to X's native right-click menu. The
page-side handler maps the clicked player back to Aviary's captured direct variant, so X's
MediaSource `blob:` playback handle is never mistaken for a file.

![Aviary post-level media download action](docs/audit/2026-08-16/media-download-action.png)

In the MV3 build `downloads` remains an optional permission. Choosing the native right-click action
requests it from that explicit browser gesture and immediately continues the save when granted.
Until it is granted, an on-post button reads **Allow** instead of claiming a save and opens Aviary's
options page. That page (toolbar icon, or Extensions → Aviary → Options) shows the live grant state
for `downloads` and for the `pbs.twimg.com` / `video.twimg.com` media hosts, makes download access
the recommended first step, and can revoke either. Permission checks and results are announced,
and the setup remains usable in compact extension windows.
On the rare path where the anchor fallback still runs for a cross-origin URL, the button reads
**Opened**, not Saved. The userscript build is unaffected.

Tweets with embedded video or GIF players expose a Video / GIF button when Aviary's page-world
GraphQL capture finds a direct downloadable variant. X commonly gives timeline players a `blob:`
MediaSource URL, so blob-only players intentionally have no video control; a known poster still
gets its Thumb control. Aviary keeps only bounded media metadata, matches it to the tweet/media,
and picks the highest-bitrate complete progressive MP4 it can save. HLS/DASH manifests and media
segments are never offered as if they were standalone videos. Capture starts at document load so the first
visible timeline videos are covered before X replaces their direct variants with tab-local blob
handles. When `tweet_video/` URLs or loop+muted players are detected, the button labels itself
"GIF" and the dedup history scopes by media kind.

## Media layout

The Media section also exposes:

- **Media layout** — Default, Stacked (full-width images, one per row), or Strict grid (`auto-fit` columns).

## Export core

The Control Center "Export" section exposes:

- Master capture toggle (accumulates tweets visible on each route into the live job).
- Format list (JSON, CSV, HTML, Markdown, XLSX).
- Preserve-raw-payloads and auto-discover-query-ID toggles.
- Optional media-byte capture during an export; successful assets are packaged with byte length and
  SHA-256, while failed assets remain explicit retryable references.
- Save folder hint that becomes both the ZIP filename prefix and the root path inside the archive.
- "Export visible tweets" — bundles the configured formats into a STORE-only ZIP, adds a
  `manifest.json` with per-file checksums and media capture status, and triggers a download.
- Extract the ZIP and open `viewer.html` for a responsive local viewer with virtualized scrolling,
  search, sort, thread grouping, media-status filters, and built-in locale/RTL labels. It loads no
  remote script and only activates a remote media URL after an explicit link click.
- "Copy diagnostics" — copies the Aviary diagnostic log (version, route, recent events) to the clipboard.

Tweets are gathered passively from the DOM; no auth headers, cookies, or session tokens are ever read or persisted.

## Backup & audit

The Control Center "Backup & Audit" section exposes:

- **Export settings** — downloads a versioned JSON envelope with every Aviary preference. API keys and passwords are replaced with a placeholder so the file is safe to share; importing it keeps the credentials already saved on this machine.
- **Import settings** — paste an envelope and choose Import. Settings are normalized, unsupported keys are dropped, and version mismatches are reported as warnings (never silent overwrites).
- **Export full library backup** — downloads one versioned JSON envelope for the active profile's
  local settings, bookmarks, notes, snapshots, archive collections, export jobs/records, media
  queues, indexes, usage counters, retention values, and other durable stores. Integration credentials are excluded
  by default and remain local when a redacted backup is restored.
- **Restore a library backup** — choose a backup file to preview schema versions, collection counts,
  byte totals, conflicts, and checksums. Dry-run validates without mutation; an actual restore can
  be cancelled and rolls back earlier collection writes if a later local write fails. Restoring
  local stores reloads the page so in-memory feature snapshots cannot go stale.
- **Audit entries** — read-only count of logged local actions (downloads, exports, settings round-trips, diagnostic copies).
- **Clear audit log** — drops the persisted ring buffer.

The audit log lives entirely in local storage. It never leaves the browser unless the user explicitly clicks Copy diagnostics or Export settings.

## Library

The Control Center "Library" section exposes:

- **Unshorten t.co links** — replaces visible `t.co` redirects in tweet body / quoted card text with the destination URL pulled from `aria-label` / `data-expanded-url` / `title` / textContent (no network calls). Reversed on destroy.
- **Account notes** — one `handle: note` per line. Aviary stores notes per-handle and decorates the matching tweet's User-Name area with a small Note badge whose tooltip shows the note text.
- **Clear all account notes** — drops every persisted note.
- **Local bookmarks** — use the Save locally control on a rendered post, then search the Library
  and edit tags, folders, reminders, or notes. Removing a bookmark affects only Aviary's local
  library and leaves X's own bookmark action untouched.
- **Composer snippets** — reusable replies / templates edited in Library and inserted into the focused
  composer from the Snippets toolbar button.

## Install & FAQ

Setup paths (userscript, Chromium dev-load, Firefox temporary-load) and uninstall steps live in [docs/INSTALL.md](docs/INSTALL.md). Privacy promises, selector-regression workflow, hotkey policy, and export tips live in [docs/FAQ.md](docs/FAQ.md).

## Build & preflight

`npm run verify` chains TypeScript checking, pinned ESLint static analysis, the full test suite, an esbuild bundle, and `tools/preflight.mjs`. The lint stage covers source, tests, and tooling while ignoring generated bundles and captured fixtures. The preflight gate enforces:

- Manifest version equals `package.json` version.
- `manifest_version` is 3 and `host_permissions` is not `<all_urls>`.
- CSP / bundles never include `unsafe-eval`, `wasm-eval`, raw `eval()`, or `new Function()` constructors.
- `permissions` includes `storage`, host-scoped `declarativeNetRequestWithHostAccess`, and the
  X-scoped native `contextMenus` action; it excludes test-only DNR feedback, while
  `optional_permissions` includes `downloads`.
- All devDependencies are exact-pinned.
- No `innerHTML` / `insertAdjacentHTML` / `keydown` / `keyup` / `keypress` / `backdrop-filter` outside the TrustedTypes helper.

The build also produces `dist/extension-chrome-v<version>.zip` and
`dist/extension-firefox-v<version>.zip` as reproducible STORE-only archives (fixed 1980-01-01
timestamps). They are packaged for upload, but Aviary is not published to any store: the Firefox
manifest still carries a placeholder add-on id, so an AMO submission needs a real one first.

## Presets, i18n, desktop interaction, cleanup, bookmarks, snippets, capture

- **Presets** — Quiet Reader, Media Archivist, Creator, Researcher, Classic, Minimal. The Control Center "Presets" section applies any preset in one click and reports the exact deltas in the status line.
- **i18n + RTL** — 9-locale translation table with English fallback, `av-rtl`/`av-ltr` HTML classes, and Arabic/Hebrew bidi-safe tweet text.
- **Desktop interaction** — visible focus states, modal focus containment, reduced-motion support,
  and mouse/keyboard-friendly controls are verified at the supported desktop widths.
- **Hide row borders** — drops the 1px divider under each timeline post and the primary column's side rules. The rule anchors on `[data-testid="cellInnerDiv"] > div`, not on X's generated `r-*` class names, so a rename does not silently disable it.
- **Writer mode** — while focus is inside the composer, the sidebar and the timeline behind it fade back; everything returns the moment focus leaves, and hovering a faded row restores it. Driven by `focusin`/`focusout` only — Aviary registers no key handlers.
- **Snapshots & Archive** — capture follower / following lists from the active page; import official X archive ZIPs into the CheckpointStore; search captured records; download a Markdown report.
- **Cleanup review queue** — Aviary never deletes account data; the queue is a read-only review surface (`destructiveAllowed()` returns `false` by policy).
- **Bookmark library** — tags, folders, reminders, and due-time queries stored locally.
- **Composer snippets** — a Snippets button next to the post toolbar opens a popover and inserts via `document.execCommand("insertText")`. No keyboard simulation, no hotkeys.
- **XLSX export** — added to the Export format list. The writer reuses the STORE-only ZIP encoder, so there's still no external runtime dependency.
- **WARC export** — emits ISO-28500 WARC/1.1 records for archival research tooling. Captured media
  becomes a response record; uncaptured media is an explicit metadata-only record. One file per run.
- **External export targets** — Copy-as-Markdown, Obsidian (YAML frontmatter), Notion (heading-first), raw JSON. Pure local rendering; the clipboard variant never touches disk.
- **Batch profile-media download** — "Download all visible media" in the Media section walks every rendered tweet and pipes photos / videos / GIFs / thumbnails through the existing queue with the configured concurrency cap and dedup history.
- **Local AI command menu (off by default)** — enable it in Integrations and each tweet's action row gains an AI button offering Translate / Summarize / Explain / Fact-check. On its own it only builds a prompt and copies it to your clipboard, with no network call and no API key. Configuring the separate AI provider runner below is what makes the same menu able to POST a prompt, and only after an explicit per-request disclosure.
- **Passive GraphQL capture (opt-in)** — when "Preserve raw payloads" is on, Aviary records GraphQL response bodies under 1.5 MB into the CheckpointStore as a `capture-<operation>` job, scrubbing `ct0` and Bearer tokens on the way in. Toggle off and the wrapper uninstalls.
- **Checkpoint retention (opt-in)** — cap jobs, records per job, or job age through the Export section. Zero disables each limit; the sweep runs at boot and after new jobs are created.

## Integrations (every one is opt-in)

The Control Center "Integrations" section gates each integration behind a per-feature toggle. Every block defaults disabled; no requests fire until you've enabled it *and* filled in the credentials.

- **Aria2 handoff** — when configured and the request exceeds the minimum-bytes threshold, `Downloader` posts an `aria2.addUri` JSON-RPC call to your self-hosted Aria2 daemon (with optional `token:` secret). Falls through to GM_download / extension SW / anchor otherwise. The Integrations panel also lists in-flight transfers and lets you cancel one with a click.
- **Bluesky / Mastodon crosspost** — sends the current composer text to your Bluesky AT-protocol account or your Mastodon instance. Two explicit Control Center actions; never auto-cross. Toggle "Crosspost as thread" to chunk on blank lines — Bluesky gets `reply.root/parent` refs, Mastodon chains `in_reply_to_id`.
- **Crosspost media (opt-in)** — the "Attach last download" toggle uploads the last successful Aviary media source to Bluesky or Mastodon and attaches it to the first post only. The source URL and filename stay local until that explicit action.
- **AI provider runner** — when enabled, the per-tweet AI command menu shows the provider, endpoint, fields, character/token estimate, retention notice, network status, and budget before POSTing a prompt to Anthropic, OpenAI, or an OpenAI-compatible endpoint. Per-request and daily UTF-8 byte limits stop calls before they leave the browser; the response is copied to your clipboard. With no key, the menu remains a local prompt builder.
- **Semantic search** — embeds captured records via your provider's embeddings endpoint, persists vectors and bounded text locally, and ranks queries by cosine similarity. The panel shows the endpoint, fields, retention notice, and byte budget before you enable auto-indexing. Per-record and daily UTF-8 byte limits stop rebuilds or background indexing with a recoverable status. Embeddings only fire when you click "Rebuild semantic index", type into the semantic search box, or enable "Auto-embed every export".

The Integrations panel also surfaces a "Recent integration errors" readout that distills failed audit-log entries — handy when a Bluesky token expires or your Aria2 daemon stops listening. Aria2 history stores completed/queued gids locally and prevents the same media URL from being requeued across browser sessions.

## Roadmap

The working plan is in [ROADMAP.md](ROADMAP.md), and what each release actually changed is in
[CHANGELOG.md](CHANGELOG.md) — this section deliberately does not restate it, because a
hand-maintained summary of "the latest batch" is exactly what went three releases stale.
Work that needs a capture or an operator decision before it can be built is tracked in
Roadmap_Blocked.md, including F032/F033, which wait on privacy-safe authenticated fixtures
containing those exact states.

`npm run smoke` runs the current-X compatibility and side-effect-free externally gated-action
lanes, plus packaged-extension request-rule probes in Chromium and Mozilla Firefox. The DNR probes
temporarily add the feedback permission only to disposable build copies, exercise the real Chrome
service worker and Firefox event page, and prove the exact logger is blocked before a loopback
request while HomeTimeline, media, authentication-shaped, and unrelated requests remain eligible.
All provider calls go to local stubs and all profiles/downloads are temporary. Verification and
release builds run locally; install Mozilla Firefox plus the pinned Chromium runner:

```bash
npm ci
npx playwright install chromium
npm run build
npm run smoke
```

Without Chromium or a regular Mozilla Firefox installation, the corresponding script exits with a
setup message. Set `AVIARY_FIREFOX_BINARY` when Firefox is installed in a nonstandard location.
Every lane uses a fresh temporary profile and cleans it up after the run.
