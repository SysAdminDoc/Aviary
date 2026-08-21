# Aviary Privacy Manifest

Updated: 2026-08-20 · release 1.37.0

## Defaults and network boundaries

Aviary is local-first. The default build sends no telemetry, loads no remote code, exports no
cookies or authentication headers, and makes no provider request. Default-on ad protection answers
X's exact `/i/api/1.1/promoted_content/log.json` event locally in the userscript and blocks it with
a host-scoped dynamic request rule in the extension before a network connection; it does
not block HomeTimeline, media, login, or unrelated analytics traffic. Native sponsored records are
delivered inside the same first-party timeline response as ordinary posts, so Aviary suppresses
their rendering but cannot truthfully claim those bytes were absent. Optional page-world capture
only observes bounded first-party GraphQL responses across X's `fetch` and `XMLHttpRequest`
transports after you enable the relevant capture setting.

These are the only Aviary-triggered network paths:

| Feature | When it leaves the browser | Destination and data |
|---|---|---|
| Media Save / Thumb / captured Library batch | After you click a media button or the Library download action | The selected X media URL or URLs already stored in local capture records. A browser/userscript downloader handles each file. Optional text or JSON sidecars are built locally after a completed save. |
| Export media-byte capture | Only when **Capture media bytes in export** is enabled and you click export | The selected X media URLs; successful response bytes, length, and checksum are placed in that local package, while failures remain local retryable metadata. |
| Aria2 handoff | When enabled, configured, and the media meets the threshold | Your configured JSON-RPC endpoint; the media URL, filename, and optional RPC secret are sent. |
| Bluesky / Mastodon | After you click the corresponding crosspost action | Your configured service; composer text, thread metadata, and optionally the last downloaded media when attachment is enabled. |
| AI provider | When AI runs is enabled, you review the disclosure, and you send a provider-backed command | Your configured endpoint; the prompt built from the selected post and configured system text. The review shows fields, character/token estimate, retention notice, network status, and byte budget. |
| Semantic search | When you rebuild the index, explicitly add semantic ranking to a query, or enable auto-embedding | Your configured embeddings endpoint; the model and record text sent for each embedding request. The Control Center shows the destination, fields, retention notice, and byte budget before auto-indexing. |
| Analytics refusal | When beacon blocking is enabled | No new destination; matching analytics beacons are intercepted before they leave the page. |

Every integration is disabled by default and requires an explicit setting, endpoint/credential,
and (for actions) a user gesture. Local prompt building works without an AI key. The options page
grant/revoke controls are local extension UI and do not send data.

Library text ranking, including exact-handle and quoted-phrase matching, never makes a request.
Local-only mode returns those text results before the semantic query path can contact a provider.
Downloading media from a Library search contacts only the stored X media URLs selected by that
local query. It does not request a timeline or GraphQL response.

The extension's required permissions are `storage` and
`declarativeNetRequestWithHostAccess`. The latter is bounded by the existing X/Twitter host list
and owns only the exact promoted logger rule; shipped builds omit diagnostic feedback, broad
`webRequest`, and `<all_urls>` access. Optional permissions are `downloads` and direct media-host access for
`pbs.twimg.com` and `video.twimg.com`. They are requested only from the options page and can be
revoked there; the userscript declares the equivalent `GM_download`/`@connect` surfaces in its
metadata.

## Data stored locally

The logical keys below are stored in the active profile. The durable-storage backend uses the
browser's IndexedDB database `aviary.durable.v1` when available and falls back to the extension or
userscript storage backend when it cannot open. Profile-scoped copies may be prefixed with
`aviary.profile.<profileId>.`; the Control Center's Trust section reports the active backend,
schema, migration, usage, and quota status.

| Key | Data | Purpose and user control |
|---|---|---|
| `aviary.profiles.v1` / `aviary.profile.active.v1` | Profile registry and active-profile id | Keep explicit settings/library boundaries. Profiles are created and switched in Trust. |
| `aviary.settings.v1` | Preferences, portable filter rules, and any integration credentials you enter | Configure Aviary. Plain-text rule exports contain only the rules you wrote. **Export settings** is a settings envelope, not a full-library backup. |
| `aviary.integration.usage.v1` | Profile-scoped AI/embedding request, record, and UTF-8 byte counters for the local 31-day history | Enforce configurable per-request/daily budgets and show usage; **Clear AI and embedding usage** removes counters. No API keys or raw prompts are stored here. |
| `aviary.hiddenPosts.v1` | Hidden status ids or handle/text signatures | Hide posts across visits; **Clear hidden posts** removes them. |
| `aviary.seenPosts.v1` | Post ids and the time each first scrolled past, no text, handle, or URL | Fade a post the second time you pass it; capped at 4,000 entries and 30 days; **Forget seen posts** removes them. |
| `aviary.adObservations.v1` | Which ad markers were present on a route, as counts, no post content | Notice when X changes its ad markup; bounded to 64 entries and 30 days. |
| `aviary.diagnostics.v1` | Aviary's own warning and error text, the time, and the *names* of a message's detail fields, never their values | Let a failure from an earlier page load still be reportable; bounded to 50 entries and 7 days; clearable from Trust. |
| `aviary.firstRun.v1` | A single flag recording that the first-run notice was dismissed | Stop showing the notice again on this profile. |
| `aviary.media.history.v1` | Bounded media dedup records and short-lived hashed in-flight claims | Avoid duplicate downloads across tabs; failed claims expire or are removed, and **Clear download history** removes all of them. |
| `aviary.media.queue.v1` | Queued, paused, failed, and completed media jobs. A job can include X media URLs, fallback URLs, a filename, media kind/id, and an opted-in sidecar request with bounded post text, account, post id, permalink, and save time. | Resume/retry media work and create the sidecar only after a confirmed save; completed history is separately clearable. |
| `aviary.media.last-download.v1` | Metadata for the last successful download | Make an explicitly enabled crosspost-media attachment possible. |
| `aviary.audit.v1` | Capped local action log | Review activity; **Clear audit log** removes it. |
| `aviary.export.checkpoints.v1` | Export jobs, captured records, and checkpoints | Resume capture/export and local search; retention limits can remove old jobs. |
| `aviary.retention.maxJobs`, `aviary.retention.maxRecordsPerJob`, `aviary.retention.maxAgeDays` | Export retention limits | Bound checkpoint storage; zero disables the corresponding limit. |
| `aviary.queryIds.v1` | GraphQL operation ids discovered in loaded X scripts | Keep export parsing resilient as X changes. |
| `aviary.aria2.history.v1` | Queued/completed Aria2 gids and media metadata | Avoid requeueing the same media URL. |
| `aviary.snapshots.v1` | Captured follower/following snapshots | Compare snapshots over time; **Clear all snapshots** removes them. |
| `aviary.library.bookmarks.v1` | Local bookmarks, tags, folders, reminders, and notes | Search/edit the local library; individual bookmarks or **Clear local bookmarks** remove them. |
| `aviary.userNotes.v1` | Private account notes | Decorate matching posts; **Clear all account notes** removes them. |
| `aviary.cleanupQueue.v1` | Review candidates from cleanup previews | Review-only queue; **Clear cleanup queue** removes it. Aviary does not delete X data. |
| `aviary.semanticIndex.v1` | Embedding vectors and record metadata | Local semantic search; **Clear semantic index** removes it. |
| `aviary.archive.imports.v1` | Official X archive import jobs and checkpoints | Pause/resume/retry imports and preserve progress. |
| `aviary.archive.library.v1` | Imported archive collections, including typed account/media/list data | Keep archive data separate from public-post search. |

The extension background also uses `aviary.downloadFallbacks.v1` as short-lived runtime state. It
contains only the browser download id, requested filename, and remaining X media candidate URLs
for an active original-image download. The entry is removed when the download completes, when an
interruption advances to the next candidate, or when no candidate remains; it is not included in
profiles or library backups.

Selector health and other transient DOM diagnostics are in memory unless an action is explicitly
written to the audit log. Imported media bytes are not retained after a completed archive import;
resumable import state may retain the local source while the job is unfinished.

## Data not stored

Aviary does not store X `auth_token` or `ct0` cookies, bearer tokens, raw request headers, or your
X password. When **Preserve raw payloads** is enabled, captured GraphQL bodies are scrubbed for
`ct0`, `auth_token`, `guest_id`, `csrf_token`, and `Bearer …` values before persistence. This does
not make the remaining captured post data anonymous: treat it as account data.

## Credentials and exports

Aria2 secrets, Bluesky app passwords, Mastodon tokens, and AI/embedding keys are stored locally in
the active profile in the form the browser needs. They are sent only to the service you configured
when that integration runs. Use scoped, revocable credentials. **Export settings** replaces these
secrets with placeholders; importing the file keeps credentials already saved on the destination
browser instead of overwriting them.

AI and embedding usage history stores counters only: it does not retain provider URLs, API keys,
prompts, record text, or vectors. A request is reserved in the local ledger before provider work;
if the per-request or daily UTF-8 byte budget is exhausted, no provider request is made. Local-only
mode also blocks every provider call.

Aviary does not encrypt local storage. Use the browser profile's normal protections and full-disk
encryption. Anyone with access to that browser profile may be able to read the stored credentials
and local library.

WARC and WACZ preservation downloads contain the captured post text, original URLs, timestamps,
and any media bytes already present in the selected records. Treat them as account data. Aviary
builds both files locally and does not upload them. The replayweb.page action only opens the viewer;
you decide which archive to load there.

## Clearing and uninstalling

Use the Control Center clear actions listed above before sharing or retiring a profile. Removing an
extension or userscript does not reliably erase browser storage, IndexedDB, downloaded files, or
userscript-manager values; use the browser's extension/site-data controls and the manager's own
storage controls for a complete wipe. Revoking optional `downloads` and media-host permissions is
available from the extension's dedicated options page.

Every feature is reversible: disabling it removes the DOM nodes, styles, observers, timers, and
listeners it created. Aviary never auto-likes, auto-follows, posts, deletes, or syncs account data.
