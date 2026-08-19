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

## What can I actually change? (every control, by page)

<!-- settings-reference:start -->

<!-- Generated by tools/settings-reference.mjs from the Control Center source.
     Run `npm run docs:settings` after adding or renaming a control. -->

Every control Aviary offers, by Control Center page. 76 controls across 12 pages.

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
| Refuse X's ad logging call | Only applies while Ad-free mode is on. Aviary refuses exactly one request — X's separate promoted-content logging call — and nothing else, including the checks X uses to notice an ad blocker. Turn this off if X complains anyway: sponsored posts stay hidden and Aviary stops refusing any request at all. |
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
| Dim posts you have already seen | Fade a post the second time it scrolls past, so a return trip down the timeline shows what is new. Hovering a faded post brings it back. Only post IDs are stored. |
| Filter rules | One rule per line: field, optional not, operator, value. Fields are text, handle, media, verified, link; operators are contains, is, starts, ends, matches. Join with and / or, and prefix dim: to fade instead of hide. Name a rule by starting the line with [a title], and give it a limited life with for 7d from <date>. Example: [Weekend sales] dim for 7d from 2026-08-19T10:00:00.000Z: text contains sale and media is photo |
| Keyword rules | One keyword or phrase per line. Case-insensitive substring match. |
| Regex rules | One pattern per line. Use /pattern/flags or a bare pattern (case-insensitive). |
| Whitelist handles | Handles (one per line, no @) that are never filtered. |
| Premium / verified posts | A choice control. |
| Quote posts | A choice control. |
| Say why a post was filtered | A choice control. |
| Low-engagement posts | A choice control. |
| Engagement measured in | A choice control. |

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

#### Media

| Control | What it does |
| --- | --- |
| Show download buttons | Add one Download action to each media post, plus per-asset controls. |
| Prefer original quality | Try source-format name=orig first, then 4096x4096 if it fails. |
| Show images at original quality | Loads timeline photos at full size instead of the version X picks for the slot. Sharper, and several times the bytes. |
| Media layout | A choice control. |
| Duplicate history | Skip downloads of media you have already saved from this browser. |
| Download pacing | Choose one: Conservative, Balanced. |

#### Trust

| Control | What it does |
| --- | --- |
| Local-only mode | Blocks every outbound request, including the integrations you configured. On by default; turning an integration on is what turns this off. |
| Refuse X's analytics beacons | Stops the tracking pings X sends as you scroll, click and pause. Only the analytics endpoints are refused — timeline, media and login traffic is untouched. |
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
