# Aviary blocked roadmap

## F032 — Hide blocked accounts again

Blocked pending an authenticated `_decoded/` home/status capture containing the current blocked-account markup. The existing public fixtures do not expose the required `[data-testid="userActions"]` blocked state, so shipping a predicate now would be speculative.

Re-entry condition: add the authenticated capture, verify the live selector, then implement and fixture-test the predicate while preserving the handle whitelist.

## F033 — Hide self-quotes and self-reposts

Blocked pending an authenticated `_decoded/` quote/thread capture containing the current repost attribution row. The existing fixtures do not expose the `Reposted by @<handle>` relationship needed for a reliable author-equality check.

Re-entry condition: add the authenticated capture, verify the social-context selector, then implement and fixture-test self-repost detection without broad text heuristics.

## settings.privacy.encryptVault — encrypt local data at rest

Blocked on a key-custody decision, which is a product call rather than an implementation detail.
WebCrypto can encrypt the CheckpointStore, snapshots and audit log easily enough; the question is
where the key lives. Deriving it from a user passphrase means an unlock step on every page load
and permanent data loss if the passphrase is forgotten — a real UX and support commitment.
Storing the key in the same `chrome.storage.local` / `localStorage` the ciphertext sits in
protects nothing: any script that can read one can read the other, and so can anyone with the
browser profile on disk.

Shipping the second option would be worse than shipping nothing, because the toggle would claim a
protection the product does not have. The setting stays schema-only and unexposed until the
custody model is chosen.

Re-entry condition: decide passphrase-derived (with the unlock UX and an explicit "forgotten
passphrase means unrecoverable data" warning) versus dropping the key from the schema. Then
implement against that decision — and state the threat model it does and does not cover.

## Hide promoted posts and ad units

Blocked pending a capture that actually contains a promoted post. The obvious anchor,
`[data-testid="placementTracking"]`, is **not** a promoted marker: both instances in
`_decoded/home.html` wrap organic content — one a quote-tweet video player, the other the
`news_sidebar` module — and the string "Promoted" appears zero times in either fixture. Shipping
a predicate on that selector would hide the news module and a quote tweet.

Re-entry condition: add a `_decoded/` capture containing a real promoted unit, confirm what
distinguishes it (a label node, an `aria-label`, or a wrapper attribute) against that evidence,
then implement it in the filter engine as a `filter.promotedRule` FilterAction alongside
`premiumRule`, and fixture-test that organic `placementTracking` content is untouched.

Note: two preset descriptions claimed "no promoted" while nothing implemented it. That copy has
been corrected rather than left promising a feature the build does not have.

## Block analytics beacons

Split out of the P1 performance item; the offscreen-video half of that item shipped in v1.9.0.

Blocked on an architecture and permission decision, not on effort. Aviary's content script has no
`"world": "MAIN"` entry in either manifest, so it runs in the isolated world: patching `fetch`,
`XMLHttpRequest` or `navigator.sendBeacon` there rewrites the *extension's* copies of those APIs
and leaves the page's untouched. The userscript is in the same position -- it is granted `GM_*`,
which puts it in the sandboxed scope rather than page scope.

That leaves two routes, and they are not equivalent:

1. `declarativeNetRequest` with dynamic rules from the service worker. Real blocking, but it adds
   a network-blocking permission to a manifest that currently asks only for `storage`, and it
   changes how the extension is reviewed. The userscript build cannot use it at all, so the two
   artifacts would stop behaving the same way.
2. A second `world: "MAIN"` content script carrying only the beacon patch, messaging back for the
   setting. No new permission, but it is a new entrypoint and bundle in `tools/build.mjs`, and it
   still has no userscript equivalent without dropping to `@grant none`.

Re-entry condition: decide whether the extension may diverge from the userscript on this, and
whether the permission expansion in route 1 is acceptable. Then implement against that decision,
scoped to telemetry endpoints only (`/i/api/1.1/jot/*` and friends) with a fixture proving a
timeline request is never matched.

## Force highest-quality video playback

Blocked by the same root cause as beacon blocking, and it will unblock with it.

X plays timeline video through Media Source Extensions. The captured `<video>` in
`_decoded/home.html` carries `<source type="video/mp4" src="blob:https://x.com/d83b1aef-...">`,
which is a `URL.createObjectURL(mediaSource)` handle, not a file. Variant selection happens inside
the player's adaptive-bitrate logic over segments it fetches itself, so there is no `src` to
rewrite and no `<source>` list to re-rank -- `video-extract.ts` finds exactly one variant on a
live player, which is why it serves the downloader through the network capture instead.

Reaching that decision means intercepting the page's own manifest fetch, and the content script
runs in the isolated world where the page's `fetch` is not visible. See the beacon-blocking entry
above: the same `world: "MAIN"` decision governs both.

Re-entry condition: whichever route is chosen for beacon blocking. Then rewrite or re-rank the
HLS/DASH manifest so the player's own ABR starts at the top rendition, and prove it with a
capture where the selected rendition changes.

## Hide all reposts

Blocked on a fixture that contains a repost -- the roadmap entry that proposed this asserted the
public capture exposes the social-context row, and that is wrong. Measured: `socialContext`
appears 0 times in `_decoded/home.html` and `_decoded/status.html`, and so do the strings
"reposted" and "retweeted" (case-insensitive). Neither capture contains a single repost, so there
is nothing to build a predicate against and nothing to fixture-test it with.

This is the same blocker as F033 (self-reposts) and hide-promoted-posts: one capture of a real
logged-in timeline would unblock all three at once.

Re-entry condition: add a `_decoded/` capture containing a repost, confirm the marker against it,
then implement as a `filter.repostRule` FilterAction alongside `premiumRule`, and fixture-test
that an original post carrying a quote-tweet is untouched.

## Settings that normalize but nothing reads

An unread-settings sweep (probe self-checked against a key known to be read, so a broken regex
could not report everything as dead) found five. `timelineWidth` and `restoreChirp` were wired in
v1.9.0. Three remain, each blocked rather than merely unbuilt:

- `filter.selfRepost` -- F033. Needs a capture containing a self-repost.
- `filter.blockedAccounts` -- defaults to `"hide"`, so it is an active claim the build does not
  keep. Needs a capture containing X's blocked-account placeholder row to anchor a predicate.
- `privacy.encryptVault` -- see above; a key-custody decision, not an implementation gap.

Re-entry condition for the first two: the same authenticated `_decoded/` capture that unblocks
hide-promoted-posts and hide-all-reposts. One capture settles four items.
