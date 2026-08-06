# Aviary Privacy Manifest

Updated: 2026-05-19

## Defaults

Aviary is local-first.

- No telemetry.
- No remote code.
- No analytics endpoint.
- No credential export.
- No default cloud sync.
- No hidden third-party requests.

## Data Stored Locally

Everything below lives in userscript storage, `chrome.storage.local`, or the `localStorage`
fallback — on this device only. Nothing is uploaded.

| Key | Data | Purpose |
|---|---|---|
| `aviary.settings.v1` | Every preference, plus any integration credentials you enter | Persist your configuration. |
| `aviary.hiddenPosts.v1` | Status ids (or a handle+text signature) of posts you hid, with a short text snippet | Keep hidden posts hidden across visits. |
| `aviary.media.history.v1` | Hashes of media you downloaded | Skip re-downloading the same file. |
| `aviary.audit.v1` | Local action log (last 500 entries) | Show what Aviary did on your behalf. |
| `aviary.export.checkpoints.v1` | Export jobs and the records they captured | Resume exports and power local search. |
| `aviary.retention.*` | Export retention limits | Bound how long checkpoints are kept. |
| `aviary.snapshots.v1` | Follower/following snapshots you captured | Diff them over time. |
| `aviary.library.bookmarks.v1` | Your local bookmark library | Tags, folders, reminders. |
| `aviary.userNotes.v1` | Private notes you wrote about accounts | Show a note badge on their posts. |
| `aviary.cleanupQueue.v1` | Cleanup review candidates | Review list only; Aviary never deletes account data. |
| `aviary.semanticIndex.v1` | Embeddings for records you indexed | Local semantic search. |
| `aviary.aria2.history.v1` | Aria2 download ids you queued | Avoid requeueing the same download. |
| `aviary.queryIds.v1` | X GraphQL operation ids seen in loaded scripts | Keep export parsing working as X changes. |
| Selector diagnostics | in memory only, never written to storage | Diagnose X DOM churn. |

Clearing these is possible from the Control Center: media history, audit log, snapshots,
cleanup queue, semantic index, account notes, and hidden posts each have a clear action.

## Data Never Stored

- X auth cookies, including `auth_token`.
- `ct0` CSRF token.
- X bearer tokens and raw request headers.
- Your X account password.

If "Preserve raw payloads" is on, captured GraphQL bodies are scrubbed of `ct0`,
`auth_token`, `guest_id`, `csrf_token`, and `Bearer …` values before anything is written.

## Credentials You Provide

Integration credentials — the Aria2 RPC secret, Bluesky app password, Mastodon access token,
and AI/embedding API keys — are stored in `aviary.settings.v1` in plain text, because the
browser needs them to make the calls you asked for. They are never sent anywhere except the
service they belong to. Two consequences worth knowing:

- Exporting settings replaces them with a placeholder, so the exported file is safe to share.
  Importing that file back keeps whatever is already saved on this machine.
- Anything with access to this browser profile can read them. Use scoped app passwords and
  revocable API keys rather than primary credentials.

## Optional Permissions

The MV3 manifest declares optional permissions for future media-download work. Those permissions are not requested or used by the v0.3.0 runtime.

## User Control

Every feature must be reversible. Disabling a feature must remove classes, style nodes, observers, timers, DOM nodes, and event listeners it created.
