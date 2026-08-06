# Aviary

![Version](https://img.shields.io/badge/version-1.5.0-2f81f7)

Aviary is a local-first X/Twitter enhancer delivered as a readable userscript first and a Manifest V3 extension second. The project is at v1.5.0: foundation primitives, fixture-backed selector checks, theme + control-center, layout declutter, reversible filtering, one-click media, checkpointed export/archive tools, local library features, opt-in integrations, persisted Aria2 history, configurable checkpoint retention, explicit crosspost media uploads, MV3 store-ready ZIP archives, and isolated Playwright smoke CI.

## Current Status

- Userscript entry: `src/entrypoints/userscript.ts`
- MV3 content entry: `src/entrypoints/extension-content.ts`
- MV3 background entry: `src/entrypoints/extension-background.ts`
- Stable selector registry: `src/platform/selectors.ts`
- Settings/storage foundations: `src/platform/settings.ts`, `src/platform/storage.ts`
- Layout declutter and theme foundations: `src/features/layout/declutter.ts`, `src/features/appearance/theme.ts`
- Filter engine and predicates: `src/features/filtering/filter-engine.ts`, `src/features/filtering/predicates.ts`
- Media downloads: `src/features/media/` (`media-buttons.ts`, `urls.ts`, `template.ts`, `history.ts`, `queue.ts`, `downloader.ts`, `extract.ts`, `video-extract.ts`, `media-presentation.ts`, `batch-downloader.ts`)
- Export core: `src/features/export/` (`export-feature.ts`, `collector.ts`, `formatters.ts`, `zip-store.ts`, `zip-reader.ts`, `jobs.ts`, `query-discovery.ts`, `network-capture.ts`, `xlsx.ts`, `warc.ts`, `external-targets.ts`, `types.ts`)
- AI: `src/features/ai/command-menu.ts` (local prompt builder; optionally runs through `features/integrations/ai-provider.ts` when the user supplies an API key)
- Integrations: `src/features/integrations/` (`aria2.ts`, `crosspost.ts`, `ai-provider.ts`, `semantic-search.ts`)
- Library: `src/features/library/` (`user-notes.ts`, `link-unshorten.ts`, `snapshots.ts`, `snapshots-feature.ts`, `archive-import.ts`, `cleanup-preview.ts`, `cleanup-queue.ts`, `reports.ts`, `local-search.ts`, `bookmarks.ts`)
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

Aviary is designed to keep account data local. The v0.3.0 runtime does not send telemetry, does not export cookies or auth headers, and does not load remote code.

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

## One-click media

The Control Center "Media" section exposes:

- Master toggle for tweet Save / Thumb buttons.
- Original-quality preference (image URLs are rewritten to `name=orig`).
- Filename template with `{handle}`, `{tweetId}`, `{mediaId}`, `{index}`, `{total}`, `{date}`, `{text}`, `{ext}` fields.
- Duplicate history toggle and a "Clear download history" action.
- Live status readout (running / completed / duplicate / failed) and the size of the dedup index.

Downloads prefer `GM_download` in userscript managers, fall back to the extension service worker (`chrome.downloads` with `conflictAction: uniquify`), and finally use an anchor tag when no privileged downloader is available. The extension's `downloads` permission stays optional — the browser will prompt the first time a download is requested.

Tweets with embedded video or GIF players now also expose a Video / GIF button. Aviary scans `<video>` and `<source>` elements inside `[data-testid="videoPlayer"]` / `videoComponent` containers and picks the highest-bitrate variant available in the DOM. When `tweet_video/` URLs or loop+muted players are detected, the button labels itself "GIF" and the dedup history scopes by media kind.

## Sensitive content and layout

The Media section also exposes:

- **Sensitive content** — Default (X choice), Always reveal, Blur until hovered, or Always hide. Applied via `av-sensitive-*` classes on `<html>`; toggling reverses cleanly.
- **Media layout** — Default, Stacked (full-width images, one per row), or Strict grid (`auto-fit` columns).

## Export core

The Control Center "Export" section exposes:

- Master capture toggle (accumulates tweets visible on each route into the live job).
- Format list (JSON, CSV, HTML, Markdown — XLSX intentionally deferred).
- Preserve-raw-payloads and auto-discover-query-ID toggles.
- Save folder hint that becomes both the ZIP filename prefix and the root path inside the archive.
- "Export visible tweets" — bundles the configured formats into a STORE-only ZIP and triggers a download.
- "Copy diagnostics" — copies the Aviary diagnostic log (version, route, recent events) to the clipboard.

Tweets are gathered passively from the DOM; no auth headers, cookies, or session tokens are ever read or persisted.

## Backup & audit

The Control Center "Backup & Audit" section exposes:

- **Export settings** — downloads a versioned JSON envelope with every Aviary preference.
- **Import settings** — paste an envelope and press Save list. Settings are normalized, unsupported keys are dropped, and version mismatches are reported as warnings (never silent overwrites).
- **Audit entries** — read-only count of logged local actions (downloads, exports, settings round-trips, diagnostic copies).
- **Clear audit log** — drops the persisted ring buffer.

The audit log lives entirely in local storage. It never leaves the browser unless the user explicitly clicks Copy diagnostics or Export settings.

## Library

The Control Center "Library" section exposes:

- **Unshorten t.co links** — replaces visible `t.co` redirects in tweet body / quoted card text with the destination URL pulled from `aria-label` / `data-expanded-url` / `title` / textContent (no network calls). Reversed on destroy.
- **Account notes** — one `handle: note` per line. Aviary stores notes per-handle and decorates the matching tweet's User-Name area with a small Note badge whose tooltip shows the note text.
- **Clear all account notes** — drops every persisted note.
- **Composer snippets** — reusable templates / replies (insertion into `[data-testid="tweetTextarea_0"]` lands in a later release; the editor and storage ship now).

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
- **Snapshots & Archive** — capture follower / following lists from the active page; import official X archive ZIPs into the CheckpointStore; search captured records; download a Markdown report.
- **Cleanup review queue** — Aviary never deletes account data; the queue is a read-only review surface (`destructiveAllowed()` returns `false` by policy).
- **Bookmark library** — tags, folders, reminders, and due-time queries stored locally.
- **Composer snippets** — a Snippets button next to the post toolbar opens a popover and inserts via `document.execCommand("insertText")`. No keyboard simulation, no hotkeys.
- **XLSX export** — added to the Export format list. The writer reuses the STORE-only ZIP encoder, so there's still no external runtime dependency.
- **WARC export** — emits ISO-28500 WARC/1.1 records for archival research tooling. One file per export run.
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

The working plan is in [ROADMAP.md](ROADMAP.md). v1.5.0 closes the local retention/history, crosspost-upload, and CI-smoke batch. F032/F033 remain in [Roadmap_Blocked.md](Roadmap_Blocked.md) until authenticated `_decoded/` captures are available.

`npm run smoke` runs the Playwright spec at `tests/smoke/aviary.smoke.mjs`. The CI workflow caches Chromium and runs it inside an isolated Xvfb display. For local use, install the pinned runner and browser:

```bash
npm ci
npx playwright install chromium
npm run build
npm run smoke
```

Without the Chromium binary the script exits with Playwright's setup message; it always uses a fresh temporary profile and cleans it up after the run.
