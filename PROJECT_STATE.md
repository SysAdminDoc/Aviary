# Project State

Updated: 2026-05-19

## Current Batch

**v1.4.0** (Aria2 sweep/cancel, threaded crosspost, integration error readout, auto-embedding on export, Playwright smoke scaffold) ships on top of v1.3.0 integration scaffolds.

Completed:

- MIT license.
- README development stub.
- npm + TypeScript + esbuild build scaffold.
- Shared userscript/MV3 source entries.
- Feature registry lifecycle contract.
- Settings schema and storage gateway (extended for `filter.surfaces`, `filter.selfRepost`, and seeded `filter.mediaTypes` for photo/video/gif).
- TrustedTypes-safe HTML helper.
- Selector registry and selector-health feature.
- Route, observer, diagnostics, and rate-limiter primitives.
- MHTML/decoded fixture tests and source contract tests.
- Chrome/Firefox MV3 manifest templates.
- GitHub Actions CI workflow.
- Shadow DOM Control Center with persisted toggles (Filtering section now exposes keyword/regex/whitelist textareas, premium action select, photo/video/GIF media filters, and per-surface chip group).
- Document-start dark theme foundation and reduced-motion handling.
- Layout declutter feature for right sidebar, trends, Grok surfaces, and selected nav items.
- Privacy manifest and optional permission shell for future media downloads.
- Filter engine (`src/features/filtering/`): keyword/regex/premium/media-type predicates, route-scoped activation, whitelist, generation-based re-evaluation, hide/dim CSS states with hover/focus reveal, full destroy + master-toggle reversal.
- Filter engine fixture tests (predicate compilation, decide logic, surface normalization, fixture marker presence).
- One-click media (`src/features/media/`):
  - `urls.ts` — `normalizeImageUrl` forces `name=orig`, preserves declared format, returns mediaId.
  - `template.ts` — `renderFilename` substitutes `{handle}/{tweetId}/{mediaId}/{index}/{total}/{date}/{text}/{ext}` and sanitizes filesystem-unsafe characters.
  - `history.ts` — `MediaHistory` persists a capped, eviction-aware dedup index through the storage gateway.
  - `queue.ts` — `DownloadQueue` tracks per-job status (queued/running/completed/failed/duplicate) with subscriber snapshots.
  - `downloader.ts` — picks `GM_download` first, falls back to `chrome.runtime.sendMessage` → BG `chrome.downloads`, then an anchor download.
  - `media-buttons.ts` — feature module injects Save/Thumb buttons inside `[data-testid="tweetPhoto"]` containers, processes added articles only, wires history/queue/diagnostics, and fully reverses on destroy.
  - Background SW (`src/entrypoints/extension-background.ts`) handles `AVIARY_DOWNLOAD` messages with `chrome.downloads` (conflict action `uniquify`).
  - Userscript banner now grants `GM_download` plus `@connect pbs.twimg.com` / `video.twimg.com`.
- Control Center additions: Filtering section (keyword/regex/whitelist textareas, premium select, photo/video/GIF toggles, route chips, parked F032/F033 row) and Media section (button toggle, original-quality preference, filename template input, history toggle + clear action, live download status readout).
- Media tests (`tests/media.test.mjs`): URL normalization, tweet id parsing, filename template sanitization, history record/dedupe/evict/persist, and queue status transitions.

## v0.6.0 deliverables

- `src/features/media/video-extract.ts` — picks the highest-bitrate `<video>`/`<source>` variant; GIF heuristics (loop+muted, `tweet_video/` URL, aria-label hint).
- `media-buttons.ts` now adds Video / GIF buttons through `resolveTarget`; dedup key includes media kind so the same poster + video don't collide.
- `src/features/media/media-presentation.ts` — separate reversible feature: sensitive (default / reveal / blur / hide) and media-layout (default / stacked / grid) classes applied to `<html>`, removed on destroy.
- Settings additions: `media.sensitive`, `media.layout`, `media.lastSaveFolder` (folder hint, sanitized but not yet acted on — wired in v0.7.0).
- Control Center: Sensitive content + Media layout selectors in the Media section.
- Tests: video extractor preference, GIF heuristic, settings normalization of new media fields, presentation source contract.

## v0.7.0 deliverables

- `src/features/export/types.ts` — ExportRecord / ExportMedia / ExportArtifact / ExportCheckpoint contracts.
- `src/features/export/formatters.ts` — JSON / CSV / HTML / Markdown artifacts with HTML escaping and CSV quoting.
- `src/features/export/zip-store.ts` — STORE-only ZIP encoder with IEEE-802.3 CRC32 (no compression, no dependencies).
- `src/features/export/collector.ts` — DOM-based passive collector over `article[data-testid="tweet"]`, captures media payloads via the existing `extractTweet` pipeline.
- `src/features/export/jobs.ts` — `CheckpointStore` persists jobs + records through the storage gateway, dedups by tweet identity.
- `src/features/export/query-discovery.ts` — passively scrapes loaded `<script>` URLs for `/i/api/graphql/<id>/<op>` patterns and caches them locally.
- `src/features/export/export-feature.ts` — feature module: hydrates query registry on boot, walks added tweets into the active job, runs end-to-end exports that ZIP all formats and trigger a Blob-based anchor download.
- Control Center "Export" section: capture toggle, format CSV (with xlsx still rejected), preserve-raw-payloads + auto-discover toggles, save-folder hint, "Export visible tweets" and "Copy diagnostics" actions, plus a live status readout.
- Tests: formatter snapshots (JSON / CSV / HTML / MD), CRC32 vector, ZIP EOCD round-trip, CheckpointStore persistence and dedup, supported-format filtering.

## v0.8.0 deliverables

- `src/features/core/audit-log.ts` — capped, persisted append-only AuditLog (F092). Records media downloads (`media.download` / `.duplicate` / `.failed`), export start/complete, settings import/export, and diagnostic copies.
- `src/features/core/settings-migration.ts` — `buildSettingsExport` + `parseSettingsImport` envelopes with normalization and version-mismatch warnings (F009).
- Collector extensions (`src/features/export/collector.ts`):
  - Photo `altText` capture per media entry.
  - `readPoll` / `readQuote` / `readArticle` / `readBirdwatch` (F054 + F064).
  - `collectProfileAbout` helper for `/handle` profile metadata (F063 baseline).
- `FeatureContext.auditLog` wired through registry; media-buttons and export-feature now record audit entries automatically.
- Control Center: new "Backup & Audit" section with Export-settings, Import-settings (textarea), audit-entry readout, and clear-audit-log actions.
- Tests: settings export/import round-trip + version warning, AuditLog persistence + capping, query-discovery key contract.

## v0.9.0 deliverables

- `src/features/library/user-notes.ts` — persisted per-handle notes (F027). Adds a `Note` badge next to `[data-testid="User-Name"]` for any tweet whose handle has a saved note. Hover/title surfaces the note text; fully removed on destroy.
- `src/features/library/link-unshorten.ts` — DOM scanner that rewrites visible `t.co` redirects to the destination pulled from `aria-label` / `data-expanded-url` / `title` / textContent (F074). Original text is stashed in `dataset.avOriginalText` so destroy can restore it.
- Control Center: new "Library" section with Unshorten toggle, Account notes textarea (`handle: note` per line, empty notes drop entries), Clear-all-notes action, and Composer snippets editor (F075 editor; insertion path itself rolls into v0.10.0).
- Audit-log entries continue to flow through the existing pipeline.
- Tests: source contracts for user-notes + link-unshorten reversibility.

## v1.4.0 deliverables

- `src/features/integrations/aria2.ts` — `tellActiveAria2` returns parsed `{ gid, status, totalLength, completedLength, files }` rows from `aria2.tellActive`; `removeAria2Download` posts `aria2.remove` and reports the cancelled gid. Both share the new `callAria2<T>` helper that prefixes `params` with `token:<secret>` when set and returns `null` on transport / structural failures.
- `src/features/integrations/crosspost.ts` — `splitForThread` chunks the composer text on blank lines (drops empties; collapses runs); `postToBluesky` now walks segments, carries `reply.root` + `reply.parent` cid/uri refs from the second post forward, and surfaces the first post's URL plus a `posts` count; `postToMastodon` chains `in_reply_to_id` and returns the first status URL.
- `src/features/core/integration-errors.ts` — `recentIntegrationErrors` walks the audit log newest-first, keeps only entries with `ok === false` / `error` payloads, and classifies them as `crosspost:<target>`, `<kind>`, or the bare action.
- `src/platform/settings.ts` — `integrations.semanticSearch.autoIndex` (default `false`). Wired through `normalizeSettings` like the rest of the booleans.
- `src/features/export/export-feature.ts` — when `integrations.semanticSearch.autoIndex` is true, `runExportOfVisibleTweets` kicks `autoIndexExport` after writing the ZIP. The helper instantiates a fresh `SemanticIndex`, calls `embedAndIndex`, and logs the result.
- Control Center: thread-mode checkbox above the Bluesky/Mastodon crosspost actions; Refresh + Cancel rows under Aria2; "Auto-embed every export" toggle above the rebuild action; "Recent integration errors" readout at the bottom of the Integrations section.
- `tests/smoke/aviary.smoke.mjs` — F099 Playwright scaffold. Dynamic-imports `playwright` so it exits cleanly with a setup message when the dep isn't installed. Boots the unpacked Chromium extension, navigates `x.com`, asserts the Control Center launcher mounts, opening it does not throw, the `av-filter-enabled` class probe runs, and the Integrations section renders.
- `package.json` — new `smoke` script (`node tests/smoke/aviary.smoke.mjs`).
- Tests (9 new): Aria2 active/remove RPC shape, `splitForThread` chunking, threaded Bluesky reply refs, Mastodon `in_reply_to_id` chain, `recentIntegrationErrors` ordering, `autoIndex` settings round-trip, `autoIndexExport` wiring source contract, smoke scaffold source contract.

## v1.3.0 deliverables

- `src/platform/settings.ts` — new `integrations` envelope with `aria2` / `bluesky` / `mastodon` / `ai` / `semanticSearch` blocks. All disabled by default. URLs validated as `http://`/`https://`; secrets capped at 4096 chars and stripped of control characters; Bluesky handle accepted in DNS-name form. AI provider enum: `anthropic | openai | openai-compatible`; Mastodon visibility enum: `public | unlisted | private | direct`.
- `src/features/integrations/aria2.ts` — `addUriToAria2` posts an `aria2.addUri` JSON-RPC call with optional `token:<secret>` prefix; `shouldHandoffToAria2` enforces enabled + endpoint + `minBytes` threshold (F056).
- `src/features/media/downloader.ts` — `createDownloader({ integrations })` now tries Aria2 first when the request exceeds the threshold; falls through to GM_download / extension SW / anchor. `media-buttons.ts` and `batch-downloader.ts` both wire the integrations envelope in.
- `src/features/integrations/crosspost.ts` — Bluesky `com.atproto.server.createSession` + `com.atproto.repo.createRecord` and Mastodon `POST /api/v1/statuses`. `readComposerText` reads the current `[data-testid="tweetTextarea_0"]`. Defaults `visibility=public`; refuses to send when integration is disabled or credentials missing (F077).
- `src/features/integrations/ai-provider.ts` — `runAiPrompt` picks between Anthropic Messages (`x-api-key` header, `anthropic-version: 2023-06-01`) and OpenAI-compatible Chat Completions (`Bearer` header). Endpoint override optional; default endpoints are the canonical ones. Errors return `{ ok: false, error }` — never throws (F083).
- `src/features/ai/command-menu.ts` — when AI integration is enabled + an API key is set, the per-tweet AI menu options label themselves "(Run with provider)" and POST the prompt; the response is copied to the clipboard. Without a key, the existing prompt-only flow still works.
- `src/features/integrations/semantic-search.ts` — `SemanticIndex` persists `{ id, tweetId, handle, text, vector, embeddedAt }` rows under `aviary.semanticIndex.v1`. `embedAndIndex` re-uses cached entries by id; switching models drops the cache. `search` embeds the query and returns top-k by cosine similarity. `cosineSimilarity` is exported as a pure helper (F067).
- Control Center: new "Integrations" section between Snapshots & Archive and Backup & Audit. Endpoints, API keys, app passwords, and provider/model selectors. Aria2 ping, Bluesky/Mastodon crosspost actions, embedding rebuild, semantic search input, clear-index, and a one-line integration status readout.
- Tests (7 new): integrations envelope defaults + URL validation, `shouldHandoffToAria2` threshold logic, `addUriToAria2` JSON-RPC shape with token prefix, crosspost session flow + disabled-state graceful error, `runAiPrompt` provider routing for both Anthropic and OpenAI shapes, `SemanticIndex` cache + cosine ranking + `cosineSimilarity` pure helper, AI command-menu source contract that wires `runAiPrompt`.

## v1.2.0 deliverables

- `src/features/media/batch-downloader.ts` — `runMediaBatch` walks visible `article[data-testid="tweet"]` rows, resolves each photo / video / GIF / thumbnail target, dedups against `MediaHistory`, drives the existing `Downloader` with `concurrentDownloads` workers (1–6 per `jobs.rateLimitMode`), and reports `{ total, enqueued, downloaded, duplicate, failed, jobIds }`. Wired as the Control Center "Download all visible media" action (F048 + F049).
- `src/features/export/warc.ts` — `buildWarcArchive` emits ISO-28500 WARC/1.1 records: one metadata record header for the archive, one `resource` record per `ExportRecord` body, one `metadata` record per media URL (no remote fetch — the archive references the URL only). `formatRecord` is exported for use by future capture pipelines (F071).
- `src/features/export/external-targets.ts` — `renderForExternalTarget` produces clipboard Markdown / Obsidian frontmatter (`tweet_id`, `handle`, `tags`) / Notion-friendly Markdown / raw JSON. Wired as four Control Center actions in the Export section (F069 baseline).
- `src/features/ai/command-menu.ts` — adds a per-tweet AI button inside `[role="group"][aria-label]` action rows. Opening it surfaces four local prompt templates (Translate / Summarize / Explain / Fact-check prompt); selecting one copies the templated prompt + tweet text to the clipboard. No network calls, no API keys involved. Fully reversible on destroy (F082 baseline).
- Control Center: "Download all visible media", "Download as WARC", "Copy as Markdown", "Save Obsidian Markdown", "Save Notion Markdown", "Save records JSON" actions all log to the audit ring buffer.
- Tests (5 new): WARC header round-trip, external-target Markdown variants, AI command prompt templates, AI command-menu source contract (no `fetch`/`XHR`), batch-downloader source contract (concurrency + audit + dedup + queue marking).

## v1.1.0 deliverables

- `src/features/export/xlsx.ts` — SpreadsheetML writer that produces `[Content_Types].xml`, `_rels/.rels`, `xl/_rels/workbook.xml.rels`, `xl/workbook.xml`, `xl/worksheets/sheet1.xml` and packages them with the existing STORE-only ZIP encoder. `inlineStr` cells with XML escaping (no shared-strings table). Wired through `formatExport` and `selectSupportedFormats` (F058 finishing).
- `src/features/library/bookmarks.ts` — `BookmarkStore` with tweetId-keyed upserts, lowercase tag dedup, folder rollups, due-time reminder queries. Persisted under `aviary.library.bookmarks.v1` (F068).
- `src/features/export/network-capture.ts` — installs a passive `fetch` wrapper only when `export.preserveRawPayloads === true`; routes `/i/api/graphql/<id>/<op>` responses ≤1.5 MB into a per-operation CheckpointStore job (`capture-<op>`), scrubs `ct0` cookies and Bearer tokens, uninstalls cleanly on toggle off and `destroy` (F091 stage 2).
- `src/features/composer/composer-snippets.ts` — decorates `[data-testid="toolBar"]` with a Snippets button that opens a fixed-position popover. Selecting an item focuses `[data-testid="tweetTextarea_0"]` and inserts via `document.execCommand("insertText")` plus a synthetic `input` event so Draft.js commits the change. No keyboard events are simulated (F075 insertion).
- Type widening: `ExportFormat` and the supported-formats filter now include `"xlsx"`.
- Tests: XLSX OPC layout + XML escaping, BookmarkStore round-trip + tag dedup + folder summary + reminder cutoff, network-capture source contract, composer-snippets source contract (no key simulation).

## v0.11.0 deliverables

- `src/features/library/snapshots.ts` — `SnapshotStore` records and persists follower/following lists per profile handle, returns gain/loss diffs vs the previous snapshot of the same kind, caps history to 24 entries (F065).
- `src/features/library/snapshots-feature.ts` — feature module that loads the store at boot and exports `captureSnapshotFromDom` to scrape `UserCell` rows on the active page.
- `src/features/export/zip-reader.ts` — STORE-only ZIP reader with CRC32 verification; throws `UnsupportedZipMethodError` on compressed entries (a deliberate hard boundary; documented in FAQ).
- `src/features/library/archive-import.ts` — parses official X archive `tweets.js` / `tweet.js` / `tweets-part*` / `like.js` entries (strips the `window.YTD.* = ` prefix), produces `ExportRecord`s, and merges them into the CheckpointStore as an `archive-*` job (F070).
- `src/features/library/cleanup-preview.ts` — read-only classification into tweet/retweet/reply/like/bookmark buckets, respects the existing `filter.whitelist`, marks protected items but never deletes (F079).
- `src/features/library/reports.ts` — Markdown report builder (audit log + snapshot diff + cleanup preview) reused by the Control Center download action (F072).
- `src/features/library/local-search.ts` — `LocalSearchIndex` with a tiny inverted-index posting map; rebuilt on demand from `CheckpointStore.list()` (F066).
- Control Center: new "Snapshots & Archive" section with capture-followers / capture-following / clear-snapshots actions, ZIP file picker for archive import, live search input over indexed records, and a "Download Markdown report" action.
- Tests: snapshot record/diff/clear, STORE ZIP round-trip with the writer, archive import end-to-end, cleanup preview classification + whitelist, local search tokenization + ranking, Markdown report sections.

## v0.10.0 deliverables

- `tools/build.mjs` now bundles each extension target into a STORE-only ZIP archive (`dist/extension-chrome-v<version>.zip` + `dist/extension-firefox-v<version>.zip`) using an inline CRC32 + STORE-only ZIP encoder identical to `src/features/export/zip-store.ts` (F100).
- `tools/preflight.mjs` is the new gate: manifest version sync, no `<all_urls>`, no `unsafe-eval`/`wasm-eval`, no `eval()` / `new Function()` in compiled bundles, required `storage` permission, optional `downloads`, exact-pinned devDependencies, and a re-run of the source-policy contract that the test suite already enforces (F089 + F090).
- `npm run verify` is now `typecheck && test && build && preflight`.
- `docs/INSTALL.md` covers userscript / Chromium dev-load / Firefox temporary-load install paths and the local storage keys uninstall touches (F101).
- `docs/FAQ.md` documents the privacy contract, selector regression workflow, no-hotkeys policy, no-light-theme policy, export flow, and the deferral of F032/F033.
- New tests verify the docs ship and the preflight wiring is intact.

## Continuation Brief (v1.5.0+ — picks up cleanly from here)

**Current state.** v0.1.0 → v1.4.0 are complete. `npm run verify` (typecheck → test → build → preflight) is green; **74 tests pass**. `npm run smoke` is the new optional gate; it requires `playwright` + `npx playwright install chromium` to be useful, otherwise it exits with a setup message.

**Done since the v1.3.0 baseline.**

- **v1.4.0** — Aria2 sweep + cancel, threaded Bluesky/Mastodon crosspost, recent-integration-errors readout, auto-embedding on every export, Playwright smoke spec scaffold + `npm run smoke`.

**Next up — v1.5.0+ (authenticated fixtures + CI smoke + uploads).**

- **F032 / F033 pickup once `_decoded/` lands.** When the next authenticated capture arrives, lift the readonly "Blocked accounts / self-reposts" row and add predicates: blocked-account detection via `[data-testid="userActions"] [aria-label*="blocked" i]` plus the existing handle whitelist; self-repost detection via `[data-testid="socialContext"]` text matching `Reposted by @<handle>` + an author-equality check against the tweet's User-Name link.
- **Playwright in CI.** Move `smoke` into a separate GitHub Actions workflow (`.github/workflows/smoke.yml`). Cache the browser binaries between runs. The current `npm run verify` should remain pure-Node.
- **Bluesky / Mastodon media uploads.** Both protocols accept media: Bluesky via `com.atproto.repo.uploadBlob` then attach the `embed.images` block; Mastodon via `POST /api/v1/media` then reference `media_ids` in the status call. Add a "Attach last download to crosspost" toggle.
- **CheckpointStore retention policies.** Today the store grows without bound. Add `aviary.retention.{maxJobs,maxRecordsPerJob,maxAgeDays}` and run a sweep at boot.
- **Aria2 download history.** Persist completed gids so a single tweet's media doesn't requeue across browser sessions.

**Constraints / blockers.**

- F032 (blocked accounts) and F033 (self-reposts) still need authenticated `_decoded/` captures before they can ship.
- F088 encrypted local vault, F079/F080 actual destructive cleanup, and any feature that mutates account state on the user's behalf stay disabled by policy.
- The folder is still not a Git repo — no commits land until a remote is configured.

**Gotchas learned this session.**

- AT-protocol thread replies require *both* `root` and `parent` refs on every reply after the first. Aviary stores only `parentRef` (= last post) and `rootRef` (= first post); never recompute the chain from disk.
- Mastodon's status object exposes `payload.url` (browser URL) and `payload.uri` (ActivityPub URI). Aviary surfaces `url` to humans.
- `aria2.tellActive` returns `totalLength`/`completedLength` as **strings** in JSON-RPC; the parser coerces with `Number(...)`.
- The Playwright `chromium.launchPersistentContext` is the right path for MV3 extensions; `chromium.launch` cannot load unpacked extensions in headless mode without `--load-extension` flags piped through the launch args.
- Failed integration audit entries live across multiple action types (`media.download.failed` is its own action; `export.start` with `{ ok: false }` covers crosspost failures). The recent-errors helper has to walk all of them.

## Continuation Brief (v1.4.0+ — picks up cleanly from here)

**Current state.** v0.1.0 → v1.3.0 are complete. `npm run verify` (typecheck → test → build → preflight) is green; **66 tests pass**. `dist/aviary.user.js`, `dist/extension-{chrome,firefox}/`, and store-ready ZIPs are all up to date for the active version.

**Done since the v1.2.0 baseline.**

- **v1.3.0** — Integration scaffolds: Aria2 JSON-RPC handoff (F056), Bluesky AT-protocol + Mastodon crosspost (F077), Anthropic/OpenAI provider runner wired into the AI command menu (F083), semantic search with on-demand embedding fetch + cosine ranking (F067). New Control Center "Integrations" section. Every integration defaults disabled.

**Next up — v1.4.0+ (live smoke + fixture pickups + polish).**

- **F099 Playwright live smoke.** Add `playwright@1.49.x` (exact pin) to devDependencies. Add `npm run smoke` that boots the unpacked extension under `chromium.launchPersistentContext`, navigates `x.com`, and asserts: (a) Control Center launcher mounts, (b) opening it does not throw, (c) toggling the filter master adds `html.av-filter-enabled`, (d) the integrations panel renders. CI machines need `npx playwright install` (skip the verify gate if the browser binaries aren't present).
- **F032 / F033 pickup.** When an authenticated `_decoded/` capture lands, lift the readonly "Blocked accounts / self-reposts" row in the filter section and add predicates: blocked-account detection via `data-testid="userActions" aria-label*="blocked"` (still TBD live), self-repost detection via `[data-testid="socialContext"]` text matching `Reposted by @<handle>` and an author-equality check.
- **Deeper integration error surfacing.** Today `pingAria2` shows the structured error, but Bluesky / Mastodon / AI errors are short strings. Add a "Recent integration errors" readout in the Integrations section that walks the audit log.
- **Auto-embedding on every export.** Behind a new `integrations.semanticSearch.autoIndex` toggle, kick the `embedAndIndex` call from `runExportOfVisibleTweets` so the semantic index stays warm.
- **Aria2 sweep / cancel.** Add `aria2.tellActive` + `aria2.remove` calls so the Control Center can show in-flight downloads and cancel a queue.
- **Bluesky / Mastodon thread support.** Today crosspost sends one note. v1.4 should detect newline-separated chunks and post them as a thread (Bluesky `reply` field + Mastodon `in_reply_to_id`).

**Constraints / blockers.**

- F032 (blocked accounts) and F033 (self-reposts) still need authenticated `_decoded/` captures before they can ship.
- F088 encrypted local vault, F079/F080 actual destructive cleanup, and any feature that mutates account state on the user's behalf stay disabled by policy.
- The folder is still not a Git repo — no commits land until a remote is configured.

**Gotchas learned this session.**

- `exactOptionalPropertyTypes: true` keeps biting any object literal that returns optional fields conditionally — build the object first and attach optional fields with `if (value) result.x = value;`.
- AT-protocol session calls live at `<service>/xrpc/<nsid>`; `createRecord` requires `Bearer <accessJwt>`, not the app password. The Bluesky helper threads the JWT through on the second call only.
- Mastodon's `POST /api/v1/statuses` returns a structured status object; the post URL is at `payload.url` (different from `payload.uri`). Aviary surfaces `url`.
- The Anthropic Messages API expects `system` to be a top-level string (not a `messages[0]` entry like OpenAI). Provider routing is split for that reason.
- Aria2 health-check via `aria2.addUri` to an invalid URL is the cheapest "is the daemon alive?" probe; a structured RPC error means the daemon answered. A transport failure means it didn't.

## Continuation Brief (v1.3.0+ — picks up cleanly from here)

**Current state.** v0.1.0 → v1.2.0 are complete. `npm run verify` (typecheck → test → build → preflight) is green; **59 tests pass**. `dist/aviary.user.js`, `dist/extension-{chrome,firefox}/`, and store-ready ZIPs are all up to date for the active version.

**Done since the v1.1.0 baseline.**

- **v1.2.0** — Batch media downloader (F048/F049), WARC export (F071), external export targets clipboard + Obsidian + Notion + raw JSON (F069), local AI command menu (F082) that copies prompt templates to clipboard.

**Next up — v1.3.0+ (research-grade integrations gated behind external dependencies).**

- **F099 Playwright live smoke.** Add `playwright@1.49.x` to devDependencies (exact pin); add `tests/smoke/aviary.spec.ts` that boots the unpacked Chromium extension via `chromium.launchPersistentContext`, navigates `x.com`, and asserts: (1) Control Center launcher appears, (2) opening it does not throw, (3) toggling the filter master toggle adds `html.av-filter-enabled`. Run as a separate npm script (`npm run smoke`) since CI machines need `npx playwright install`.
- **F067 semantic search.** Add a Control Center input under Library for a user-supplied embedding endpoint URL + API key. Default disabled. On enable, embed each new `CheckpointStore` record and persist vectors under `aviary.semanticIndex.v1`. Use plain cosine similarity in memory; surface results alongside the existing inverted-index search.
- **F056 native companion + Aria2 handoff.** Add a Control Center URL field for an Aria2 JSON-RPC endpoint and a "Use Aria2 for batches > N MB" threshold. The existing `Downloader` falls through to Aria2 only when the URL is set and reachable; no zero-config behavior.
- **F077 crosspost.** New `features/integrations/crosspost.ts` with two adapters: Bluesky AT-protocol (PDS endpoint + app-password) and Mastodon (instance URL + access token). Both behind a single Control Center "Crosspost composer text" action that posts the current `[data-testid="tweetTextarea_0"]` content. No background posting, no auto-cross.
- **F083 translate / summarize via user provider.** The AI command menu already builds prompts locally. v1.3 wires an optional "Run with provider X" mode that POSTs the assembled prompt to the user's configured endpoint (Anthropic / OpenAI / local Ollama). Each call must be explicit; never auto-run.

**Constraints / blockers.**

- F032 (blocked accounts) and F033 (self-reposts) still need authenticated `_decoded/` captures before they can ship.
- F088 encrypted local vault, F079/F080 actual destructive cleanup, and any feature that mutates account state on the user's behalf stay disabled by policy.
- The folder is still not a Git repo — no commits land until a remote is configured.

**Gotchas learned this session.**

- The Aria2 JSON-RPC client must POST to `/jsonrpc`, not call `aria2.addUri` over a websocket, since the extension service worker can't keep websockets warm in MV3.
- WARC tooling consumes the file even when bodies are placeholder strings — the metadata header is what matters for archival catalogers.
- `chrome.scripting.executeScript` is the right path for any future "run a query on a specific tab" feature; never re-mount the content script.
- For AI integrations, *building the prompt locally* and only handing it to a user-configured provider keeps the trust contract intact. Never pre-send tweet content anywhere.

## Continuation Brief (v1.2.0+ — picks up cleanly from here)

**Current state.** v0.1.0 → v1.1.0 are complete. `npm run verify` chains typecheck → test → build → preflight; **54/54 tests pass**. Build emits `dist/aviary.user.js` + `dist/extension-{chrome,firefox}/` + store-ready `.zip` archives. Preflight enforces manifest version sync, no `<all_urls>`, no `unsafe-eval`/`wasm-eval`, no `eval()`/`new Function()`, exact-pinned devDependencies, and the same source policy the test suite enforces.

**Done since the v1.0.0 baseline.**

- **v1.1.0** — XLSX format via SpreadsheetML (F058 finishing), `library/bookmarks.ts` persisted bookmark library with tags / folders / reminders (F068), `export/network-capture.ts` guarded passive GraphQL capture (F091 stage 2), `composer/composer-snippets.ts` Snippets button that inserts via `execCommand("insertText")` (F075 insertion).

**Next up — v1.2.0+ (research-grade + remaining carry-overs).**

- **F048 / F049 batch profile-media downloader.** Walk the `/handle/media` route, collect every `tweetPhoto` and `videoComponent` entry, feed through the existing `DownloadQueue` with `concurrentDownloads` capped at 3 / 6 per `jobs.rateLimitMode`. Honor `media.history` for dedup. New Control Center action "Download visible media" inside the Media section.
- **F099 Playwright live smoke.** Add `playwright@1.49.x` to devDependencies (exact pin), spec file under `tests/smoke/` that boots the unpacked extension via `chromium.launchPersistentContext`, navigates `x.com`, and asserts the Control Center launcher appears + the filter engine flips a `data-av-filter-result` attribute when keyword rules are set.
- **F071 WARC/WACZ/HAR preservation.** Add `library/warc.ts` that consumes the same network-capture stream (when enabled) and emits an ISO-28500-compliant `.warc` file. Surface as a new Export format.
- **F067 semantic search (optional).** Behind an explicit user toggle, embed each record via a user-configured API key (Anthropic / OpenAI / local Ollama). Default off; never call out without explicit credentials.
- **F069 external export targets.** Behind explicit user actions: copy-as-Markdown to clipboard (already feasible via the Markdown formatter), Notion / Obsidian deep-link launch, Drive / Dropbox / Downloads (already covered by the anchor / `chrome.downloads` fallback).
- **F056 native companion + Aria2 handoff.** Add an `aria2` JSON-RPC client behind a Control Center URL. Used for media batches whose total size exceeds a configurable threshold (default 1 GB).
- **F077 crosspost.** Bluesky AT-protocol / Mastodon ActivityPub clients behind user-configured access tokens.
- **F082 / F083 AI/Grok tools.** Replace Grok button with a local command menu (translate / summarize / fact-check) routed through the user's chosen provider; off by default, scoped to a single tweet selection.

**Constraints / blockers.**

- F032 (blocked accounts) and F033 (self-reposts) still need authenticated `_decoded/` captures before they can ship.
- F088 encrypted local vault, F079/F080 actual destructive cleanup, and any feature that mutates account state on the user's behalf stay disabled by policy in this product line.
- The folder is still not a Git repo — no commits land until a remote is configured.

**Gotchas learned this session.**

- The composer is Draft.js — only `document.execCommand("insertText")` + a synthetic `input` event causes Draft to commit. Never dispatch synthetic `KeyboardEvent`s.
- The passive GraphQL interceptor must wrap `globalThis.fetch` *before* X's app loads any GraphQL requests. The feature runs `init` during boot (`run_at: "document_start"`), so the interceptor catches everything.
- XLSX inline-strings (`t="inlineStr"`) keep the writer dependency-free; a shared-strings table is unnecessary for export use cases under tens of thousands of rows.
- ZIP STORE encoder rejects nothing — XLSX clients (Excel, Numbers, LibreOffice) accept STORE-only OOXML archives.

## Continuation Brief (v0.11.0+ — picks up cleanly from here)

**Current state.** v0.1.0 → v0.10.0 are complete. `npm run verify` is green (38 tests; chains typecheck → test → build → preflight). The runtime now covers foundation primitives, Shadow DOM Control Center, dark themes, layout declutter, the filter engine, one-click media (image / video / GIF / thumbnail), sensitive + layout controls, the export core with checkpointed jobs and a STORE-only ZIP, an audit log, settings import/export, per-handle user notes, `t.co` unshortening, a composer snippet editor (insertion deferred), and MV3 store packaging (`dist/extension-{chrome,firefox}-v0.10.0.zip`) gated by `tools/preflight.mjs`.

**Done this session.** Versions v0.4.0 (filter engine), v0.5.0 (one-click media), v0.6.0 (video/GIF + sensitive + layout), v0.7.0 (export core), v0.8.0 (archive completeness + audit log + settings round-trip), v0.9.0 (user notes + t.co unshorten + composer snippet editor), v0.10.0 (MV3 store hardening + preflight + INSTALL/FAQ).

**Next up — v0.11.0 (Advanced data + cleanup preview + carry-overs).**

- F065 follower / following snapshots and diff — new `features/library/follower-diff.ts`. Walks the DOM-rendered `aside section` follower lists on the profile route or imports an official archive, persists snapshots through the storage gateway under `aviary.snapshots.v1`, and surfaces gain/loss diffs in a new "Snapshots" Control Center section.
- F070 official X archive import — new `features/library/archive-import.ts`. Parse the official X archive ZIP (server-rendered JS bundles), merge with the CheckpointStore, and emit a conflict report.
- F079 cleanup scan preview (no destructive action) — read-only pass over likes / bookmarks / retweets that lists what *would* be cleaned and respects the existing protected list; no buttons that delete in v0.11.0.
- F072 reports — PDF / Markdown audit report generated from the AuditLog + cleanup preview (reuse `formatters.ts` + `zip-store.ts`).
- Carry-overs (each ~half-day):
  - **XLSX** (~250 lines): reuse `zip-store.ts` + SpreadsheetML templates (`xl/workbook.xml`, `xl/worksheets/sheet1.xml`, `_rels/`, `[Content_Types].xml`).
  - **F066 local search**: index `CheckpointStore.records()` into a `Map<token, number[]>`; surface a search input under the Export section.
  - **F068 bookmark tags / folders / reminders**: new `features/library/bookmarks.ts`; reminders behind the optional `alarms` permission (request only on toggle).
  - **F091 stage 2**: guarded `fetch`/`XMLHttpRequest` interceptor that records GraphQL response bodies into CheckpointStore raw payloads when `export.preserveRawPayloads === true`. Strip auth headers before persisting; behind an explicit Control Center confirmation toggle.
  - **Composer insertion**: hook `[data-testid="tweetTextarea_0"]` with `document.execCommand("insertText", false, snippet)` after focusing; dispatch a synthetic `input` event so Draft.js picks up the change.
  - **F099 Playwright smoke**: add `playwright` to devDependencies (exact pin), boot the unpacked extension via `chromium.launchPersistentContext`, navigate `x.com`, and assert the Control Center launcher appears.

**Constraints / blockers.**

- F032 (blocked accounts) and F033 (self-reposts) still need authenticated `_decoded/` captures before they can ship.
- F069 external export targets, F077 crosspost, F082/F083 AI/Grok tools, and F088 encrypted vault remain under-consideration per the roadmap.
- The folder isn't a Git repo — no commits land until a remote is configured.

**Gotchas discovered.**

- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are both on. Match-groups need `?.[1]` access plus an explicit guard; optional fields can't be assigned `undefined` directly — build the object then attach optional keys conditionally.
- `MediaHistory` constructor enforces a minimum limit of 50 — tests must use ≥ 50 for eviction assertions.
- `Blob` constructors typed against `BlobPart` reject raw `Uint8Array<ArrayBufferLike>`; wrap with `new Uint8Array(data)` to coerce to an `ArrayBuffer`-backed view.
- All HTML injection must route through `createElement` calls. The runtime-hardening test scans every `.ts` file under `src/` for `innerHTML` / `insertAdjacentHTML` / `keydown` / `keyup` / `keypress` / `backdrop-filter` and fails the build if any appears outside `trusted-types.ts`.

## Deferred Until Authenticated Fixtures

- F032 (Hide blocked accounts again): the home/status MHTML captures contain no blocked-account markup. Settings reserve `filter.blockedAccounts` and the UI surfaces the parked state through a readonly row.
- F033 (Hide self-quotes/self-reposts): captures do not include the "X reposted" or self-quote attribution rows needed to detect this reliably. Settings reserve `filter.selfRepost` and the same readonly row covers it.

When a new authenticated home / blocked / quote-thread capture lands in `_decoded/`, drop the readonly row, add predicates, and tick these items off in the roadmap.

## Repository Notes

This folder is not currently a Git repository, so commit/push steps are skipped until a Git remote exists.
