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
  when you explicitly add semantic ranking to a query.

These integrations are disabled by default. The Control Center shows their configuration and
recent errors; [PRIVACY.md](PRIVACY.md) lists the data sent by each path.

## How does Library search rank results?

Text search is local and always available. It gives extra weight to exact handles, quoted phrases,
and rare terms, then applies source, account, tag, folder, date, and media filters. If you enable
semantic ranking and have built an embedding index, Aviary blends both result lists and labels each
hit as text, semantic, or combined. Local-only mode returns the text results without contacting the
embedding provider. Quoted words must occur together inside one field, so the end of a post cannot
form a phrase with the account name or another unrelated value.

## How does ad protection work?

Aviary starts its narrow ad guard at document start. The userscript answers X's separable
`/i/api/1.1/promoted_content/log.json` event locally, and the extension blocks that same exact URL
through a host-scoped dynamic request rule before a connection. It then removes evidenced native sponsored posts,
paid-partnership cards, promoted trends, house promos, and visible video-ad containers without
leaving an empty virtualized row. It does not block HomeTimeline: X includes native sponsored
records in the same essential first-party response as organic posts, so blocking that request
would remove the feed. The ad bytes in that shared response are therefore an unavoidable transport
limitation even though the unit is not rendered.

## What permissions does the extension need?

The required extension permissions are `storage` and `declarativeNetRequestWithHostAccess`. The
second permission can act only on Aviary's declared X/Twitter hosts and powers the exact
promoted-logger rule; Aviary does not request `<all_urls>`, `webRequest`, or the diagnostic feedback
permission in a shipped package. `downloads` and direct access to
`pbs.twimg.com`/`video.twimg.com` are optional. Open the dedicated extension **Options** page to
grant or revoke each one. A grant is requested only after its button is clicked there; declining
does not disable the rest of Aviary.

The userscript uses its manager's local-value and download grants plus the two media `@connect`
hosts. Review the generated userscript metadata before installing it.

## A button stopped working after an X update, what should I do?

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

## What is the Catch-up digest?

Turn on **Filtering → Dim posts you have already seen** to keep a local copy of each rendered post.
Open **Catch-up** from the Reading section to review the last 1, 2, 4, 6, 8, or 12 hours, or the
older-than-12-hours window. You can filter by original posts, replies, quotes, reposts, or filtered
rows, group by author, sort by time or density, inspect top links, and open an original post.

Catch-up does not mark posts read and does not fetch a timeline or GraphQL response. It only knows
what Aviary has already rendered in this browser profile. Filtered rows stay available in their own
view with the reason supplied by the active rule. The store keeps at most 4,000 rows for 30 days,
and **Forget seen posts** clears both the id ledger and its rendered copies. Media previews load only
after you click them.

## How do I save media, and why did it open instead?

The Media section adds one **Download** action to every media post, plus **Save**, **Thumb**, and
eligible **Video/GIF** controls for individual assets. The post action saves all attached photos
and direct videos/GIFs, never the video thumbnail. Images request their source format at
`name=orig` first and fall back to `4096x4096` only when that transfer fails. Videos use the
highest-bitrate complete progressive MP4 Aviary captured; a `blob:` handle or streaming manifest
is not presented as a video file. In an extension,
grant `downloads` from the options page for deterministic browser-managed saves. Without it, the
cross-origin anchor fallback can open the media in a tab; Aviary labels that path **Opened** rather
than falsely claiming **Saved**. In a userscript, a manager with `GM_download` provides the
privileged path. Aria2 handoff is optional and falls back to the browser when it is unavailable.
When a save completes through a privileged downloader, **Aviary downloaded an image** (or other
media) through that user-initiated path; an opened cross-origin tab is not reported as a download.

Duplicate history stores hashes rather than media URLs. It recognizes another `name=` size of the
same X image and exact SHA-256 byte matches. **Match visually similar images** is separate and off
by default. It uses a 256-bit visual signature for re-encoded images, but two images with similar
flat compositions can be mistaken for a match. The Media page shows which match type fired.
A short-lived hashed claim also stops two open X tabs from starting the same file together. A
failed or interrupted save releases the claim so Retry works immediately.

A small marker identifies media that already has a completed history entry. It never treats a
queued or interrupted transfer as saved, and clearing download history removes the visible marker.
**Metadata sidecar** can add a local `.txt` or `.json` file after each completed save. It contains
the saved filename, media kind, post id, account, permalink, time, and up to 10,000 characters of
post text. Duplicate, refused, and interrupted transfers do not create one.

Library search has a **Download media** action. With an empty search it uses every captured record;
with a query it uses only those local matches, including `account:`, `source:`, date, and
`has:media` filters. The queue is written before the first file handoff, survives a restart, and
keeps the browser download id when the extension owns the transfer. A file is counted as saved only
after the browser reports completion, and it never starts a GraphQL request. It can only save media
references Aviary has already captured.

## How do I export what I am seeing?

1. Open **Export** and enable capture.
2. Select any combination of JSON, CSV, HTML, Markdown, or XLSX.
3. Scroll the home/profile/search/status surface or thread so its rendered posts are collected.
4. Press **Export visible tweets**.

A local ZIP is produced, with each member compressed only when that makes it smaller. The export
also exposes preservation downloads and local targets such as Markdown, Obsidian, Notion, and raw
JSON. Media entries can still be
remote references; the output should not be treated as a byte-complete offline replay unless the
entry says it was captured. Enable **Capture media bytes in export** when you want the export action
to fetch bounded media bodies into the package; failures remain retryable references in
`manifest.json`. Extract the ZIP and open `viewer.html` for local search, sorting, thread grouping,
and media-status filtering. Aviary does not silently fetch X when an exported file is opened.

## What's the difference between WARC and WACZ?

**WARC** is the plain archival record stream. **WACZ** wraps that WARC with a CDXJ index, a page
list, and checksums so a replay tool can find individual captures without scanning the whole file.
Open **Export → Preservation archive** to download either one. The WACZ action shows an estimated
size before it runs, then **Open replayweb.page** takes you to the compatible browser viewer.

Aviary writes captured media as real HTTP responses and gives each derived post page a synthetic
archive URL. Missing media remains honest metadata rather than a fake response. WACZ keeps the WARC
and index members uncompressed because replay depends on their exact byte offsets, so it can be
larger than a normal export ZIP. The archive is assembled in a local worker, with a 256 MiB estimate
guard and a cancel action, then downloaded locally.

The optional **Signed WACZ** action creates an anonymous ECDSA P-384 identity on first use and signs
the exact SHA-256 hash of `datapackage.json`. The public key and signature travel inside
`datapackage-digest.json`; the private key stays in this browser profile. **Export keypair** is a
separate action for keeping a copy. Signing proves that two packages came from the same local key,
not that X itself endorsed the archive or that the captured content was complete.

## How do I share or restore filter rules?

Open **Filtering**, then use **Portable rule set**. **Export .txt** downloads the current rules in a
documented one-rule-per-line form. Paste that file into another profile and choose **Preview**.
Aviary shows what **Add rules** and **Replace rules** would do, including duplicates and line-specific
parse errors, before either action becomes available. Rule titles, comments, and expiry windows stay
inside the text. The same rule list is also included in settings exports and full library backups.

## What is XLSX, and is it still future work?

No. XLSX is a supported Export format in 1.16.0. It is generated locally with the same bundled
STORE-only ZIP machinery and has no runtime dependency on a remote spreadsheet service.

## What does archive import do?

The Snapshots section imports an official X archive ZIP locally, classifies recognized/skipped/
malformed files, persists resumable jobs, and exposes pause/resume/cancel/retry actions. Imported
collections such as account data, lists, followers, media references, authored posts, and likes
remain in separate local stores; direct messages are kept out of public-post search. No archive
file is uploaded.

During import, Aviary expands t.co links only when the ZIP or a previously stored GraphQL capture
contains the destination. It also pairs numeric participant IDs with handles already present in
that local data. Unknown IDs stay numeric and are labelled unresolved. The panel reports each count,
and this repair path makes no request.

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
jobs, archive-library data, and an optional WACZ signing identity. See the complete key table and clearing guidance in
[PRIVACY.md](PRIVACY.md).

## Can Aviary save my X bookmarks locally?

Yes. Turn on **Export → Preserve raw payloads**, then open or scroll through the X bookmark feed.
Aviary reads the bookmark GraphQL responses X has already sent to this page and mirrors the visible
tweet text, handle, permalink, and capture timestamp into the local Library. It does not request
the bookmark feed, replay missing pages, or fetch media to fill gaps. The mirror only contains what
X sent while you scrolled past it, so it is not a complete account backup unless you have visited
the full feed. **Library → Export local bookmarks** downloads the stored set as JSON and CSV.

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

## What can I actually change? (every control, by page)

<!-- settings-reference:start -->

<!-- Generated by tools/settings-reference.mjs from the Control Center source.
     Run `npm run docs:settings` after adding or renaming a control. -->

Every control Aviary offers, by Control Center page. 81 controls across 12 pages.

#### Appearance

| Control | What it does |
| --- | --- |
| Theme | Choose one: Off (X's own theme), Dim, Lights out, Graphite, Plum, Midnight, Noir. |
| Dense mode | Tighten timeline spacing for scanning. |
| Timeline width | Choose one: Default, Comfortable, Wide. |
| Restore the Chirp font | Force X's own Chirp typeface where the site has fallen back to a system font. |
| Hide engagement counts | Master switch for the four numbers below. The controls still work and screen readers still announce the totals. |
| Hide reply counts | Applies while Hide engagement counts is on. |
| Hide repost counts | Applies while Hide engagement counts is on. |
| Hide like counts | Applies while Hide engagement counts is on. |
| Hide view counts | Applies while Hide engagement counts is on. The view total lives in an analytics link, not an action button. |
| Hide the tab title badge | Remove X's unread count from the browser tab title, so a hidden notification badge is not restored by the tab. |
| Absolute timestamps | Show the exact date and time on every post instead of X's relative text. |
| Use Aviary's tab icon | Replace X's favicon with Aviary's mark so its tabs are easy to pick out. Restores X's own icon when off. |
| Hide row borders | Remove the 1px divider under each timeline post and the primary column's side rules. |
| High contrast | Use stronger borders and text contrast. |
| Reduced motion | Choose one: Follow system setting, Always reduce, Never reduce. |

#### Layout

| Control | What it does |
| --- | --- |
| Ad-free mode | Collapse sponsored posts, paid partnerships, promoted trends, house promos, and visible pre-rolls. Aviary also refuses X's separate promoted-content logging call without blocking timeline delivery. |
| Refuse X's ad logging call | Only applies while Ad-free mode is on. Aviary refuses exactly one request, X's separate promoted-content logging call, and nothing else, including the checks X uses to notice an ad blocker. Turn this off if X complains anyway: sponsored posts stay hidden and Aviary stops refusing any request at all. |
| Hide right sidebar | Reduce trends, recommendations, and footer noise. |
| Hide trends | Remove trending topics and news modules. |
| Hide follow suggestions | Remove Who to follow cards without hiding the rest of the sidebar. |
| Hide home composer | Remove the quick-post composer from Home. The Post button still opens it when needed. |
| Hide thread recommendations | Stop a conversation at its last real reply by collapsing the Discover more block and the suggested posts below it. |
| Hide Grok surfaces | Remove the Grok drawer, navigation link, image-generation entries, and per-post actions where detected. |
| Focus mode | Outside the hours below, cover the reading column with a calm local panel. Navigation stays usable and a five-minute override is one click away. Nothing is blocked and nothing leaves this device. |
| Writer mode | While focus is in the composer, fade the sidebar and the timeline behind it. Everything returns the moment you click away. |
| Open Following instead of For you | Selects the second home tab each time you arrive at the timeline. Switch back to For you and it stays there until you navigate away. |
| Hide navigation items | One stable X navigation id per line: home, explore, notifications, follow, chat, grok, history, studio, premium, profile, or more. |

#### Performance

| Control | What it does |
| --- | --- |
| Pause video that scrolls out of view | Stops decoding timeline video once it leaves the screen, and resumes it when it comes back. A video you paused yourself stays paused. |
| Keep video playing when the tab loses focus | X stops a playing video when you switch tabs. This resumes it when you come back. A video you paused yourself stays paused. |
| Loop videos | Restart a video when it reaches the end instead of stopping. |
| Pin video playlists to their best rendition | When X hands Aviary a playlist listing several qualities, keep only the highest. X often settles below the best available on a fast connection. This uses more data, and it can only act on playlists Aviary sees. |

#### Filtering

| Control | What it does |
| --- | --- |
| Enable filters | Master switch for keyword, regex, premium, and media filters. |
| Dim posts you have already seen | Fade a post the second time it scrolls past, and keep a local catch-up copy of posts Aviary has rendered. Hovering a faded post brings it back. |
| Filter rules | One rule per line: field, optional not, operator, value. Fields are text, handle, media, verified, link; operators are contains, is, starts, ends, matches. Join with and / or, and prefix dim: to fade instead of hide. Name a rule by starting the line with [a title], and give it a limited life with for 7d from <date>. Example: [Weekend sales] dim for 7d from 2026-08-19T10:00:00.000Z: text contains sale and media is photo |
| Keyword rules | One keyword or phrase per line. Case-insensitive substring match. |
| Regex rules | One pattern per line. Use /pattern/flags or a bare pattern (case-insensitive). |
| Whitelist handles | Handles (one per line, no @) that are never filtered. |
| Premium / verified posts | A choice control. |
| Quote posts | A choice control. |
| Say why a post was filtered | A choice control. |
| Low-engagement posts | A choice control. |
| Engagement measured in | A choice control. |
| Portable rule set | Export plain text, or paste a set to preview before adding or replacing rules. |

#### Hidden posts

| Control | What it does |
| --- | --- |
| Hide dismissed posts | Keep posts you hid collapsed so the next post rises to the top. |
| Show hide buttons | Adds a Hide control to every post next to the More menu. |

#### Library

| Control | What it does |
| --- | --- |
| Show the AI button on posts | Adds a button to every post that builds a Translate, Summarize, Explain or Fact-check prompt. Without an AI provider configured it copies the prompt to your clipboard; nothing is sent anywhere. |
| Unshorten t.co links | Replace short `t.co` redirects with the destination from aria-labels and titles. |
| Clean tracking from links | Strips share tokens and campaign parameters (utm_*, fbclid, and X's own t/s) from links in the timeline, so what you copy is the plain address. |
| Copy post links as | Choose one: X (x.com), fxtwitter.com, vxtwitter.com, fixupx.com, xcancel.com. |
| Account colours | Format: handle: colour. One per line. Colours are amber, rose, violet, sky, green, or slate. An empty line removes the tag. |
| Account notes | Format: handle: note. One per line. Empty notes remove the entry. |
| Composer snippets | One snippet per line. Reusable replies / templates insert from the composer toolbar. |

#### Export

| Control | What it does |
| --- | --- |
| Capture visible tweets | Accumulate tweets visible on the active page for the next export run. |
| Preserve raw payloads | Also store the raw GraphQL responses X sends this tab, so records can be re-parsed later. Session tokens are stripped before anything is written. |
| Capture media bytes in export | Fetch media during the export action and include successful bytes with length and checksum; failed items remain retryable references. |
| Auto-discover query IDs | Scan loaded scripts for X GraphQL operation IDs and cache them locally. |
| Preservation archive | Download a raw WARC or a replay-ready WACZ. WACZ keeps archive and index members uncompressed. |
| Signed WACZ | WACZ signing actions |

#### Media

| Control | What it does |
| --- | --- |
| Show download buttons | Add one Download action to each media post, plus per-asset controls. |
| Prefer original quality | Try source-format name=orig first, then 4096x4096 if it fails. |
| Show images at original quality | Loads timeline photos at full size instead of the version X picks for the slot. Sharper, and several times the bytes. |
| Media layout | A choice control. |
| Metadata sidecar | Choose one: Off, Text, JSON. |
| Match visually similar images | Compare a 256-bit visual signature too. Similar flat compositions can be mistaken for a match, so this stays off by default. |
| Duplicate history | Skip the same X asset or exact image bytes without storing its source URL. |
| Download pacing | Choose one: Conservative, Balanced. |

#### Trust

| Control | What it does |
| --- | --- |
| Local-only mode | Blocks every outbound request, including the integrations you configured. On by default; turning an integration on is what turns this off. |
| Refuse X's analytics beacons | Stops the tracking pings X sends as you scroll, click and pause. Only the analytics endpoints are refused, timeline, media and login traffic is untouched. |
| Monitor selector health | Check the current X surface for required and fallback anchors. Turn this off when you do not want selector diagnostics. |
| Switch profile | A choice control. |

#### Integrations

| Control | What it does |
| --- | --- |
| Aria2 handoff | Send large media downloads to a self-hosted Aria2 JSON-RPC endpoint. |
| Bluesky crosspost | Post composer text to your Bluesky account on demand. |
| Mastodon crosspost | Post composer text to your Mastodon account on demand. |
| Attach last download | Upload the last successful Aviary media download with the first post in an explicit crosspost. |
| AI provider runs | Let the AI command menu POST prompts to your configured provider. |
| AI provider | Choose one: Anthropic Messages API, OpenAI Chat Completions, OpenAI-compatible (LocalAI, Ollama proxy, …). |
| Semantic search | Send captured record text to the configured embedding endpoint for similarity search. The destination, fields, retention, and byte budget are shown here. |
| Auto-embed every export | Before enabling, review the endpoint, captured-record fields, local retention, and daily byte budget above. After each export, embed in the background. Off by default. |

#### Backup

| Control | What it does |
| --- | --- |
| Import settings (JSON) | Paste a settings file exported from Aviary, then choose Import. Redacted credentials keep the values already saved here. |
| Keep a local action log | Records downloads, exports and settings changes on this device so you can review what Aviary did. Nothing is sent anywhere. Turning this off stops new entries immediately; existing ones stay until you clear them. |

#### Presets

| Control | What it does |
| --- | --- |
| Locale | A choice control. |

<!-- settings-reference:end -->
