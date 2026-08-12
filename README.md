# Aviary

![Version](https://img.shields.io/badge/version-1.16.0-2f81f7)

Aviary is a local-first X/Twitter enhancer delivered as a readable userscript first and a Manifest V3 extension second. The project is at v1.16.0: a redesigned 13-page Control Center, foundation primitives, fixture-backed selector checks, theme + layout controls, reversible filtering, per-post hide-and-remember, one-click media, checkpointed export/archive tools, local library features, opt-in integrations, persisted Aria2 history, configurable checkpoint retention, explicit crosspost media uploads, MV3 store-ready ZIP archives, and isolated Playwright smoke CI.

## Vanilla by default

Installing Aviary changes nothing about X. Every setting that alters what X looks like or how it
behaves — themes, hiding the sidebar or trends, the Hide and media buttons, filtering, pausing
offscreen video, refusing analytics beacons — starts off. Only what you switch on applies. The
one thing Aviary adds unasked is its own launcher button, because without it there is nothing to
switch anything on with.

`tests/vanilla-by-default.test.mjs` measures this rather than asserting it: with default settings
it mounts the real theme code against the captured timeline and requires the computed styles to
come back byte-identical.

Already configured it and want to start over? **Trust → Reset everything to plain X**. That resets
preferences only; saved posts, notes, bookmarks and download history are kept.

Aviary does not touch sensitive media. It has no setting for it, because it cannot tell sensitive
posts from any other post — X's own filter is the only thing here that knows, and it is left to do
its job.

## Current Status

- Userscript entry: `src/entrypoints/userscript.ts`
- MV3 content entry: `src/entrypoints/extension-content.ts`
- MV3 background entry: `src/entrypoints/extension-background.ts`
- MV3 page-world entry: `src/entrypoints/extension-page.ts` (declared `"world": "MAIN"`; the userscript reaches the same place through `unsafeWindow`)
- Page bridge and agent: `src/platform/page-bridge.ts`, `src/page/page-agent.ts`
- Stable selector registry: `src/platform/selectors.ts`
- Settings/storage foundations: `src/platform/settings.ts`, `src/platform/storage.ts`
- Layout declutter and theme foundations: `src/features/layout/declutter.ts`, `src/features/appearance/theme.ts`
- Filter engine and predicates: `src/features/filtering/filter-engine.ts`, `src/features/filtering/predicates.ts`
- Hidden posts: `src/features/filtering/hidden-posts.ts` (store), `src/features/filtering/hidden-posts-feature.ts` (Hide button + collapse)
- Media downloads: `src/features/media/` (`media-buttons.ts`, `urls.ts`, `template.ts`, `history.ts`, `queue.ts`, `downloader.ts`, `extract.ts`, `video-extract.ts`, `media-presentation.ts`, `batch-downloader.ts`)
- Export core: `src/features/export/` (`export-feature.ts`, `collector.ts`, `formatters.ts`, `assets.ts`, `zip-store.ts`, `zip-reader.ts`, `jobs.ts`, `query-discovery.ts`, `network-capture.ts`, `xlsx.ts`, `warc.ts`, `external-targets.ts`, `types.ts`)
- AI: `src/features/ai/command-menu.ts` (local prompt builder; optionally runs through `features/integrations/ai-provider.ts` when the user supplies an API key)
- Integrations: `src/features/integrations/` (`aria2.ts`, `crosspost.ts`, `ai-provider.ts`, `semantic-search.ts`)
- Library: `src/features/library/` (`user-notes.ts`, `link-unshorten.ts`, `snapshots.ts`, `snapshots-feature.ts`, `archive-import.ts`, `cleanup-preview.ts`, `cleanup-queue.ts`, `reports.ts`, `local-search.ts`, `bookmarks.ts`, `bookmarks-feature.ts`)
- Composer: `src/features/composer/composer-snippets.ts`
- i18n: `src/platform/i18n.ts` + `src/features/core/i18n-feature.ts`
- Presets: `src/features/core/presets.ts`
- Mobile/touch: `src/features/core/mobile-touch.ts`
- Core utilities: `src/features/core/` (`control-center.ts`, `selector-health.ts`, `audit-log.ts`, `settings-migration.ts`)
- Fixture tests: `tests/*.test.mjs`

## Development

```powershell
npm install
npm run verify
```

`npm run verify` type-checks the TypeScript source, runs fixture/source contract tests, and builds:

- `dist/aviary.user.js`
- `dist/extension-chrome/`
- `dist/extension-firefox/`

## Privacy Model

Aviary is designed to keep account data local. It sends no telemetry, never reads or exports cookies or auth headers, and loads no remote code. Credentials you enter for optional integrations are stored locally and are redacted when you export settings.

Aviary can also refuse X's own analytics beacons — the tracking pings sent as you scroll, click and pause. It is off by default, because refusing them changes how the site behaves and that is your call rather than a default. Only the analytics endpoints are matched; timeline, media and login traffic is untouched, and the panel reports how many have actually been refused so an idle hook is visibly different from a broken one.

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

- Master toggle for tweet Save / Thumb buttons.
- Original-quality preference (image URLs are rewritten to `name=orig`).
- Filename template with `{handle}`, `{tweetId}`, `{mediaId}`, `{index}`, `{total}`, `{date}`, `{text}`, `{ext}` fields.
- Duplicate history toggle and a "Clear download history" action.
- Live status readout (running / completed / duplicate / failed) and the size of the dedup index.

Downloads prefer `GM_download` in userscript managers, fall back to the extension service worker (`chrome.downloads` with `conflictAction: uniquify`), and finally use an anchor tag when no privileged downloader is available.

In the MV3 build `downloads` is an optional permission. Until it is granted the service worker answers with `downloads-permission-missing`, the button reads **Allow** instead of claiming a save, and Aviary opens its options page once so the permission can be granted with a real user gesture. The options page (toolbar icon, or Extensions → Aviary → Options) shows the live grant state for `downloads` and for the `pbs.twimg.com` / `video.twimg.com` media hosts, and can revoke either. On the rare path where the anchor fallback still runs for a cross-origin URL, the button reads **Opened**, not Saved. The userscript build is unaffected.

Tweets with embedded video or GIF players expose a Video / GIF button when Aviary's page-world
GraphQL capture finds a direct downloadable variant. X commonly gives timeline players a `blob:`
MediaSource URL, so blob-only players intentionally have no video control; a known poster still
gets its Thumb control. Aviary keeps only bounded media metadata, matches it to the tweet/media,
and picks the highest-bitrate variant it can save. When `tweet_video/` URLs or loop+muted players
are detected, the button labels itself "GIF" and the dedup history scopes by media kind.

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
- "Copy diagnostics" — copies the Aviary diagnostic log (version, route, recent events) to the clipboard.

Tweets are gathered passively from the DOM; no auth headers, cookies, or session tokens are ever read or persisted.

## Backup & audit

The Control Center "Backup & Audit" section exposes:

- **Export settings** — downloads a versioned JSON envelope with every Aviary preference. API keys and passwords are replaced with a placeholder so the file is safe to share; importing it keeps the credentials already saved on this machine.
- **Import settings** — paste an envelope and press Save list. Settings are normalized, unsupported keys are dropped, and version mismatches are reported as warnings (never silent overwrites).
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

`npm run verify` chains TypeScript checking, the full test suite, an esbuild bundle, and `tools/preflight.mjs`. The preflight gate enforces:

- Manifest version equals `package.json` version.
- `manifest_version` is 3 and `host_permissions` is not `<all_urls>`.
- CSP / bundles never include `unsafe-eval`, `wasm-eval`, raw `eval()`, or `new Function()` constructors.
- `permissions` includes `storage`; `optional_permissions` includes `downloads`.
- All devDependencies are exact-pinned.
- No `innerHTML` / `insertAdjacentHTML` / `keydown` / `keyup` / `keypress` / `backdrop-filter` outside the TrustedTypes helper.

The build also produces `dist/extension-chrome-v<version>.zip` and `dist/extension-firefox-v<version>.zip` as store-ready archives.

## Presets, i18n, mobile, cleanup, bookmarks, snippets, capture

- **Presets** — Quiet Reader, Media Archivist, Creator, Researcher, Classic, Minimal. The Control Center "Presets" section applies any preset in one click and reports the exact deltas in the status line.
- **i18n + RTL** — 9-locale translation table with English fallback, `av-rtl`/`av-ltr` HTML classes, and Arabic/Hebrew bidi-safe tweet text.
- **Mobile/touch** — `(pointer: coarse)` and `(max-width: 760px)` media queries expand action targets to 44 px and widen the Control Center panel.
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
- **Local AI command menu** — each tweet's action row gets an AI button. Choose Translate / Summarize / Explain / Fact-check prompt and Aviary builds a prompt and copies it to your clipboard. No network calls; no API keys involved.
- **Passive GraphQL capture (opt-in)** — when "Preserve raw payloads" is on, Aviary records GraphQL response bodies under 1.5 MB into the CheckpointStore as a `capture-<operation>` job, scrubbing `ct0` and Bearer tokens on the way in. Toggle off and the wrapper uninstalls.
- **Checkpoint retention (opt-in)** — cap jobs, records per job, or job age through the Export section. Zero disables each limit; the sweep runs at boot and after new jobs are created.

## Integrations (every one is opt-in)

The Control Center "Integrations" section gates each integration behind a per-feature toggle. Every block defaults disabled; no requests fire until you've enabled it *and* filled in the credentials.

- **Aria2 handoff** — when configured and the request exceeds the minimum-bytes threshold, `Downloader` posts an `aria2.addUri` JSON-RPC call to your self-hosted Aria2 daemon (with optional `token:` secret). Falls through to GM_download / extension SW / anchor otherwise. The Integrations panel also lists in-flight transfers and lets you cancel one with a click.
- **Bluesky / Mastodon crosspost** — sends the current composer text to your Bluesky AT-protocol account or your Mastodon instance. Two explicit Control Center actions; never auto-cross. Toggle "Crosspost as thread" to chunk on blank lines — Bluesky gets `reply.root/parent` refs, Mastodon chains `in_reply_to_id`.
- **Crosspost media (opt-in)** — the "Attach last download" toggle uploads the last successful Aviary media source to Bluesky or Mastodon and attaches it to the first post only. The source URL and filename stay local until that explicit action.
- **AI provider runner** — when enabled, the per-tweet AI command menu POSTs the prompt to your configured provider (Anthropic Messages, OpenAI Chat Completions, or any OpenAI-compatible endpoint) and copies the response to your clipboard. With no key, the menu still works as a local prompt builder.
- **Semantic search** — embeds captured records via your provider's embeddings endpoint, persists them locally, and ranks queries by cosine similarity. Embeddings only fire when you click "Rebuild semantic index" or type into the semantic search box. Flip "Auto-embed every export" if you'd rather have the index stay warm after each export run.

The Integrations panel also surfaces a "Recent integration errors" readout that distills failed audit-log entries — handy when a Bluesky token expires or your Aria2 daemon stops listening. Aria2 history stores completed/queued gids locally and prevents the same media URL from being requeued across browser sessions.

## Roadmap

The working plan is in [ROADMAP.md](ROADMAP.md). v1.16.0 is the current release; the latest batch
adds current-X compatibility coverage, route-aware selector health, live-toggle reconciliation,
local bookmarks, and scoped original-quality image rewriting. F032/F033 remain blocked until
authenticated `_decoded/` captures are available.

`npm run smoke` runs both Playwright lanes: current-X compatibility coverage and a side-effect-free
externally gated-action flow. Chromium's new headless mode keeps the MV3 service worker and real
options page loaded without opening a physical browser window; all provider calls go to local
stubs and all profiles/downloads are temporary. The CI workflow caches Chromium and runs the same
command in its isolated job. For local use, install the pinned runner and browser:

```bash
npm ci
npx playwright install chromium
npm run build
npm run smoke
```

Without the Chromium binary the script exits with Playwright's setup message; it always uses a fresh temporary profile and cleans it up after the run.
