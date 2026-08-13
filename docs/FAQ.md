# Frequently asked questions

## Does Aviary talk to any server?

By default, no. Aviary has no telemetry or remote-code loader, and local settings, exports,
snapshots, bookmarks, notes, archive imports, and indexes stay in the browser. X still makes its
ordinary site requests while you use it, except that default-on ad protection answers the exact
promoted-content logger locally before it reaches the network.

An explicit opt-in or user action can make Aviary contact a destination you configured:

- **Media Save / Thumb** fetches the selected X media URL.
- **Aria2** sends a JSON-RPC handoff to your own configured daemon when enabled and eligible.
- **Bluesky / Mastodon** sends composer text after you click a crosspost action; media attachment
  is separately opt-in.
- **AI provider** sends the selected-post prompt only when provider runs are enabled and invoked.
- **Semantic search** sends record text to your configured embeddings endpoint when indexing or
  semantic queries run.

These integrations are disabled by default. The Control Center shows their configuration and
recent errors; [PRIVACY.md](PRIVACY.md) lists the data sent by each path.

## How does ad protection work?

Aviary starts its narrow ad guard at document start. It prevents X's separable
`/i/api/1.1/promoted_content/log.json` event, then removes evidenced native sponsored posts,
paid-partnership cards, promoted trends, house promos, and visible video-ad containers without
leaving an empty virtualized row. It does not block HomeTimeline: X includes native sponsored
records in the same essential first-party response as organic posts, so blocking that request
would remove the feed. The ad bytes in that shared response are therefore an unavoidable transport
limitation even though the unit is not rendered.

## What permissions does the extension need?

The required extension permission is `storage`. `downloads` and direct access to
`pbs.twimg.com`/`video.twimg.com` are optional. Open the dedicated extension **Options** page to
grant or revoke each one. A grant is requested only after its button is clicked there; declining
does not disable the rest of Aviary.

The userscript uses its manager's local-value and download grants plus the two media `@connect`
hosts. Review the generated userscript metadata before installing it.

## A button stopped working after an X update — what should I do?

1. Open the Control Center and check **Selector health**.
2. If App root or Primary column is degraded, X may have changed a surface selector. Aviary uses
   stable test ids first and fallbacks second, so most regressions are visual rather than fatal.
3. Use **Copy diagnostics** and attach the JSON to a bug report. It contains route/version and
   recent diagnostic events, not cookies, auth headers, or API keys.

## Why are there no keyboard shortcuts?

Aviary intentionally has no global hotkeys. Every command is reachable through a visible button,
menu item, or toggle. Normal keyboard navigation, menu arrows, localized labels, focus trapping,
Escape dismissal, and coarse-pointer hit targets are still supported.

## Why is there no light theme?

The shipped palettes are Dim, Lights out, Graphite, Plum, Midnight, and Noir. Noir is Aviary's
premium cyan-violet desktop skin; choose **Off (X's own theme)** whenever you want the site left
untouched. The Control Center keeps its dark surface even if the host page or operating system is
light so contrast stays predictable.

## How do I hide and restore a post?

Use **Hide** beside a rendered post's More menu. Aviary stores the status id (or a bounded
handle/text signature), collapses the owning timeline row, and shows an **Undo** toast. The Hidden
posts section also has **Undo last hide**, per-post restore for recent entries, and **Clear hidden
posts**. It never changes the post on X.

## How do I save media, and why did it open instead?

The Media section enables **Save**, **Thumb**, and eligible **Video/GIF** controls. In an extension,
grant `downloads` from the options page for deterministic browser-managed saves. Without it, the
cross-origin anchor fallback can open the media in a tab; Aviary labels that path **Opened** rather
than falsely claiming **Saved**. In a userscript, a manager with `GM_download` provides the
privileged path. Aria2 handoff is optional and falls back to the browser when it is unavailable.
When a save completes through a privileged downloader, **Aviary downloaded an image** (or other
media) through that user-initiated path; an opened cross-origin tab is not reported as a download.

## How do I export what I am seeing?

1. Open **Export** and enable capture.
2. Select any combination of JSON, CSV, HTML, Markdown, or XLSX.
3. Scroll the home/profile/search/status surface or thread so its rendered posts are collected.
4. Press **Export visible tweets**.

A local STORE-only ZIP is produced. The export also exposes WARC output for archival tooling and
local external targets such as Markdown, Obsidian, Notion, and raw JSON. Media entries can still be
remote references; the output should not be treated as a byte-complete offline replay unless the
entry says it was captured. Enable **Capture media bytes in export** when you want the export action
to fetch bounded media bodies into the package; failures remain retryable references in
`manifest.json`. Extract the ZIP and open `viewer.html` for local search, sorting, thread grouping,
and media-status filtering. Aviary does not silently fetch X when an exported file is opened.

## What is XLSX, and is it still future work?

No. XLSX is a supported Export format in 1.16.0. It is generated locally with the same bundled
STORE-only ZIP machinery and has no runtime dependency on a remote spreadsheet service.

## What does archive import do?

The Snapshots section imports an official X archive ZIP locally, classifies recognized/skipped/
malformed files, persists resumable jobs, and exposes pause/resume/cancel/retry actions. Imported
collections such as account data, lists, followers, media references, authored posts, and likes
remain in separate local stores; direct messages are kept out of public-post search. No archive
file is uploaded.

## I want to back up my settings. Is that a full backup?

**Export settings** alone is not a full backup: it creates a versioned preferences envelope,
redacts API keys/passwords, and preserves credentials already stored on the destination browser.
Use **Backup & Audit → Export full library backup** for the active profile's local collections,
jobs, notes, indexes, and settings. Restore first offers a checksum/conflict preview and dry run,
then rolls earlier writes back if a later collection fails. Captured media bytes remain included
only when they exist in a selected durable store/export package; live remote URLs are not silently
converted into offline assets.

## What is stored locally?

The active profile can contain settings, credentials, hidden posts, media history and queue,
last-download metadata, audit entries, export checkpoints, retention limits, GraphQL query ids,
Aria2 history, snapshots, bookmarks, notes, cleanup candidates, semantic vectors, archive-import
jobs, and archive-library data. See the complete key table and clearing guidance in
[PRIVACY.md](PRIVACY.md).

## What's the audit log?

It is a capped local ring buffer of actions such as downloads, exports, settings round-trips, and
diagnostic copies. It never leaves the browser unless you explicitly choose **Copy diagnostics**.
Use **Clear audit log** whenever you want to remove it.

## What about blocked accounts and self-reposts?

Those filter predicates remain reserved until an authenticated fixture capture provides reliable
markup for them. The current build does not pretend that those surfaces are supported.

## Will Aviary post, follow, like, or delete for me?

No. Aviary never auto-likes, auto-follows, posts, deletes, or engages on your behalf. Crossposting
is an explicit Control Center action to a configured Bluesky or Mastodon account, and cleanup is a
read-only review queue.
