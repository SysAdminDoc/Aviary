# Research — Aviary for X
Date: 2026-08-10 — replaces all prior research.

## Executive Summary

Aviary is a local-first X/Twitter userscript and Chrome/Firefox MV3 enhancer. Its strongest current shape is a vanilla-by-default feature registry with reversible UI controls, nine locales, privacy gates, local exports/bookmarks, optional integrations, and a green headless release baseline: `npm run typecheck` passed, `npm test` passed with 287 tests, `npm run preflight` passed, both smoke lanes passed, and `npm audit` reported zero vulnerabilities on 2026-08-10. The highest-value direction is to make the local archive genuinely durable and portable before adding more surface area.

Priority opportunities:

1. Move bulk records and embeddings from whole-value browser storage into a quota-aware durable store with real migrations.
2. Make export, capture, media, and archive-import jobs persisted, pausable, resumable, cancellable, and idempotent.
3. Scope sensitive data and credentials to an explicit X profile/account context.
4. Turn official archive import into a typed, previewable import of more than tweets and likes.
5. Treat page-world capture as hostile input and enforce strict schemas, budgets, and backpressure.
6. Unify archive, bookmark, notes, and optional semantic search behind one offline query model.
7. Ship a truthful self-contained archive package and responsive offline viewer that distinguishes captured bytes from live links.
8. Add a visible privacy budget and data-destination preview for AI and embedding integrations.

## Product Map

- Core workflows: boot Aviary on supported X surfaces; use the Control Center to configure filters, layout, privacy, media, export, library, and integrations; run user-initiated capture/download/export; search and annotate local bookmarks and captured records.
- Personas: privacy-conscious readers who want reversible UI changes; researchers and archivists preserving X data; media-heavy users downloading visible content; creators crossposting or using snippets; keyboard, RTL, CJK, and touch users.
- Platforms and distribution: readable userscript first, Chrome MV3 from version 116, Firefox MV3 from version 128, and X/Twitter/pro/mobile/TweetDeck URL matches. The build emits a userscript plus Chrome and Firefox archives; optional `downloads` and media-host permissions are separate from the base extension.
- Data flows: X DOM and page-world request hooks cross the `src/platform/page-bridge.ts` boundary; settings and local stores use `src/platform/storage.ts`; records flow through `src/features/export/`, library stores, formatters, and optional AI/embedding, Aria2, Bluesky, Mastodon, clipboard, and browser-download targets.

## Competitive Landscape

### xarchive

[xarchive](https://github.com/sytelus/xarchive) demonstrates the strongest browser-local archive UX: unlimited bookmark export, folders, rich/deleted/long-form data, conservative pacing, pause/resume, partial results, IndexedDB, and a built-in viewer. Aviary should learn from its durable job model and viewer, while avoiding implicit auth-header capture and keeping its own explicit local-only trust boundary.

### tweetxvault

[tweetxvault](https://github.com/lhl/tweetxvault) combines official-archive import, incremental sync, raw response preservation, secondary-object extraction, crash-safe checkpoints, full-text search, and optional local semantic search. Aviary should adopt the typed data/checkpoint concepts without making a Unix-only companion or a native database prerequisite for ordinary users.

### xf

[xf](https://github.com/Dicklesworthstone/xf) shows the value of hybrid BM25/vector retrieval with phrase, Boolean, wildcard, exclusion, type, and date filters. Aviary should provide an offline lexical baseline and optional semantic layer with the same query clarity, without requiring Python, a hosted index, or a model download for basic use.

### Dewey and Circleboom

[Dewey](https://getdewey.co/) and [Circleboom’s bookmark manager](https://circleboom.com/twitter-management-tool/twitter-bookmarks-manager) make folders, tags, notes, connected accounts, filters, media export, full-thread views, and structured export visible product expectations. Aviary should learn the information architecture and migration affordances, but avoid their cloud/subscription assumptions and keep cross-account data explicitly separated.

### Raindrop.io

[Raindrop filters](https://help.raindrop.io/filters) combine full-text search with type, tag, note, reminder, cache, and collection predicates. This is a useful model for Aviary’s library query language. Aviary should not copy server synchronization as a default because its README promises local-first, no telemetry, and user-selected outbound data.

### ArchiveBox and the Wayback extension

[ArchiveBox](https://github.com/archivebox/archivebox) and the [Wayback Machine WebExtension](https://github.com/internetarchive/wayback-machine-webextension) provide durable capture/replay concepts, scheduled or user-triggered saves, external storage, snapshot status, and archive notices. Aviary should borrow asset-status and provenance language, but avoid turning a browser enhancer into a server crawler or silently sending captures to a third party.

### OldTwitter and TweetdeckX

[OldTwitter](https://github.com/dimdenGD/OldTwitter) and [TweetdeckX](https://github.com/ngalatis/TweetdeckX) show demand for responsive layouts, adjustable density, columns, dark/light behavior, and discoverable settings. Aviary should preserve its vanilla-by-default philosophy and use opt-in presets rather than replacing X’s entire interaction model.

## Security, Privacy, and Reliability

- Existing protections are meaningful: outbound integrations pass through `src/features/integrations/network-policy.ts`; network clients have timeouts; secrets are redacted from settings export; semantic indexing is bounded; raw payloads are scrubbed; page hooks are disabled by default; and there is no telemetry path in the product claims or source.
- The largest reliability risk is storage shape. `src/features/export/jobs.ts`, `src/features/integrations/semantic-search.ts`, `src/features/library/bookmarks.ts`, and `src/features/library/snapshots.ts` serialize whole stores through `StorageGateway`. `CheckpointStore.#persist()` is best effort, while Chrome’s [`storage.local`](https://developer.chrome.com/docs/extensions/reference/api/storage) has a 10 MB limit without `unlimitedStorage`, so a quota failure can leave the user without a durable, inspectable recovery path. There is a settings-envelope migration, but no coordinated migration for these data stores.
- The page-world boundary is not an authenticity boundary. `src/features/export/network-capture.ts:39-107` casts bridge payloads to `CapturedGraphqlPayload` and validates only a URL string before persisting a body. The nonce protects accidental cross-session traffic, but page scripts can observe page-world messages; [MDN documents page scripts as hostile to extension code](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts). Validate every field, constrain URL/operation/status/body, and rate/byte-limit each capture session.
- AI and semantic integrations intentionally send user-selected text to configured endpoints (`src/features/integrations/ai-provider.ts` and `src/features/integrations/semantic-search.ts`), but the UI does not yet show a per-request destination/data preview, usage budget, or cumulative disclosure record. This is a trust gap even though the integrations are opt-in.
- Official archive import currently accepts only tweet/like JavaScript files in `src/features/library/archive-import.ts:42-77`; X’s official archive also contains DMs, media, followers/following, lists, profile data, and other collections ([official archive description](https://help.x.com/en/managing-your-account/how-to-download-your-x-archive)). Ignoring these files without typed counts creates an incomplete migration with weak user feedback.
- HTML export and WARC export currently preserve media URLs rather than media bytes (`src/features/export/formatters.ts` and `src/features/export/warc.ts:26-40`). A WARC or “offline” package must distinguish a captured response from a metadata-only remote reference, consistent with the [WARC specifications](https://iipc.github.io/warc-specifications/) and archival guidance from the [U.S. National Archives](https://www.archives.gov/records-mgmt/resources/socialmediacapture.pdf).
- Recovery should be designed around atomic import previews, persisted job state, idempotent record keys, explicit per-store clear/export controls, migration rollback, and a visible distinction between local data, captured bytes, and remote URLs. These are more valuable than additional integrations until the current local data path is dependable.

## Architecture Assessment

- Storage boundary: retain `StorageGateway` for small settings, but add a versioned repository interface backed by IndexedDB for records, jobs, bookmarks, snapshots, and embeddings; use OPFS only for large binary assets. [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) and [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) fit the browser-only distribution better than a native companion. Migrations must cover legacy `aviary.*.v1` keys and expose quota/usage errors.
- Job boundary: extract a shared durable job coordinator used by export, media, capture, and archive import. MV3 service workers are non-persistent, so in-memory `src/features/media/queue.ts` state cannot be the source of truth. Aria2’s [`tellStatus` and JSON-RPC notifications](https://aria2.github.io/manual/en/html/aria2c.html) provide a useful integration model for observable progress, but Aviary must retain its own state.
- Domain model: separate authored posts, likes, bookmarks, DMs, profile objects, follower snapshots, media assets, raw responses, and provenance instead of forcing every imported object into `ExportRecord`. Add source, account, capture time, byte status, checksum, and relationship fields so thread/quote/media/search behavior is not reconstructed from display text.
- UI boundary: the current `src/ui/control-center.ts` is roughly 4,275 lines and already has open localization, modal, menu, labeling, RTL, and decomposition findings in `ROADMAP.md`. New storage/job/search surfaces should use extracted typed section contracts rather than adding more one-off rows.
- Search boundary: `src/features/library/local-search.ts` indexes only `ExportRecord` values rebuilt from checkpoint jobs; bookmarks and semantic vectors are separate stores and query surfaces. A repository-level query service should keep lexical search available offline and treat remote embeddings as an optional enrichment.
- Testing and release: the baseline is green, but current coverage is fixture-heavy and Chromium-centric. The existing P3 roadmap items for lint/static analysis and broader route/browser/locale/theme testing should land before store-release claims. Add official archive fixtures, quota/fault injection, hostile bridge messages, restart/resume, profile isolation, offline-package network blocking, and provider disclosure tests to those lanes.
- Cross-cutting categories: accessibility/i18n are active open roadmap work and must cover new viewer/job states; mobile is addressed by responsive viewer and touch targets, not merely Control Center media queries; offline/resilience is addressed by durable storage/jobs; migration/upgrade by versioned repositories and full backups; observability by durable job/provenance/provider-usage records; distribution by the existing userscript plus Chrome/Firefox artifacts. Arbitrary third-party plugins and live collaboration are intentionally not required for the local-first core.

## Rejected Ideas

- Hosted cloud sync or live multi-user collaboration — reject for the 2026-08-10 research horizon because it conflicts with the stated local-first/no-telemetry trust model; use a versioned portable backup/share package instead. Commercial bookmark tools show demand, but not a reason to change Aviary’s privacy contract.
- Arbitrary remote plugin execution or a marketplace — reject while MV3 and userscript pages are hostile code environments; retain the typed internal feature registry and signed/pinned preset approach. The [Chrome MV3 model](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) is a stronger constraint than the novelty benefit.
- Default hosted AI, automatic bulk crawling, auto-like/follow/delete, or account-action automation — reject because it expands disclosure, maintenance, and account-risk surfaces contrary to the repository’s explicit user-initiated/privacy-first policy and [X limits](https://help.x.com/en/rules-and-policies/x-limits).
- A native companion as a prerequisite — defer. [tweetxvault](https://github.com/lhl/tweetxvault) proves the value for large archives, but Aviary first needs a browser-native durable store and portable export that work for userscript and MV3 users.
- Blind major dependency upgrades — reject as a feature recommendation. The 2026-08-10 audit was clean and dependencies are intentionally pinned; perform compatibility upgrades only as a tested release-maintenance task, not as product scope.

## Sources

### OSS competitors and adjacent projects

- https://github.com/sytelus/xarchive
- https://github.com/lhl/tweetxvault
- https://github.com/Dicklesworthstone/xf
- https://github.com/insin/control-panel-for-twitter
- https://github.com/typefully/minimal-twitter
- https://github.com/prinsss/twitter-web-exporter
- https://github.com/EltonChou/TwitterMediaHarvest
- https://github.com/AlttiRi/twitter-click-and-save
- https://github.com/afkarxyz/Twitter-X-Media-Batch-Downloader
- https://github.com/theesfeld/CleanX
- https://github.com/archivebox/archivebox
- https://github.com/DocNow/twarc
- https://github.com/zedeus/nitter
- https://github.com/ngalatis/TweetdeckX
- https://github.com/dimdenGD/OldTwitter
- https://github.com/internetarchive/wayback-machine-webextension
- https://github.com/quoid/userscripts
- https://github.com/awesome-scripts/awesome-userscripts
- https://github.com/hridaydutta123/awesome-twitter-tools
- https://github.com/iipc/awesome-web-archiving

### Commercial products and community signal

- https://chromewebstore.google.com/detail/xhancer/hjfmnjpffomealilhjhabimhblmdeblo
- https://getdewey.co/
- https://getdewey.co/pricing/
- https://circleboom.com/twitter-management-tool/twitter-bookmarks-manager
- https://tweetdeleter.com/pricing/
- https://bulkmark.io/
- https://help.raindrop.io/filters
- https://www.reddit.com/r/Twitter/comments/1v7bu44/if_you_download_account_data_does_it_include/
- https://www.reddit.com/r/Twitter/comments/1q45ugw/bookmarks_all_gone/
- https://www.reddit.com/r/DataHoarder/comments/1iga2wd/how_do_i_download_all_my_twitter_bookmarks/
- https://news.ycombinator.com/item?id=47228726
- https://news.ycombinator.com/item?id=46529797

### Platform, standards, and integrations

- https://help.x.com/en/managing-your-account/how-to-download-your-x-archive
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API
- https://docs.joinmastodon.org/methods/statuses/
- https://docs.bsky.app/docs/advanced-guides/api-directory
- https://atproto.com/specs/sync
- https://aria2.github.io/manual/en/html/aria2c.html
- https://iipc.github.io/warc-specifications/
- https://www.archives.gov/records-mgmt/resources/socialmediacapture.pdf
- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/

### Academic, engineering, and dependency/security

- https://arxiv.org/abs/2108.12092
- https://arxiv.org/abs/2406.17097
- https://arxiv.org/abs/2510.25932
- https://arxiv.org/abs/2212.12594
- https://docs.npmjs.com/cli/v11/commands/npm-audit/
- https://docs.npmjs.com/about-audit-reports/
- https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr
- https://github.com/evanw/esbuild/releases
- https://github.com/microsoft/TypeScript/releases

## Open Questions

- Which authenticated X fixtures can be safely maintained for DMs, bookmarks, media, profile identity, and account-switching without storing credentials or personal data in CI?
- Should captured media bytes be opt-in per job, with a user-configured storage budget, or should a portable archive package always contain only metadata and remote references?
- Is profile identity allowed to come from the current X session only, or must the product support explicit offline profile labels for imported archives with no live account?
- Which external permission and browser-manager combinations must be supported at release time beyond the current Chrome/Firefox MV3 and userscript targets?
