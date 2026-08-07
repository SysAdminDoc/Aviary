# Aviary blocked roadmap

Every item below waits on the same thing: evidence from a logged-in timeline that the public
`_decoded/` fixtures do not contain.

Since v1.12.0 there is a second way to produce that evidence, and it is easier than capturing
MHTML. Passive GraphQL capture now genuinely sees X's responses (it patched the wrong `fetch`
before), so turning on "Keep raw payloads" in Export and scrolling a home timeline records the
server's own description of each post -- including the fields that mark a promoted unit, a repost
and a blocked author. That is strictly better evidence than DOM markup for these four items,
because it does not move when X reskins the timeline. What none of them can be built against is
a guess about the response shape.

## F032 — Hide blocked accounts again

Blocked pending an authenticated `_decoded/` home/status capture containing the current blocked-account markup. The existing public fixtures do not expose the required `[data-testid="userActions"]` blocked state, so shipping a predicate now would be speculative.

Re-entry condition: add the authenticated capture, verify the live selector, then implement and fixture-test the predicate while preserving the handle whitelist.

## F033 — Hide self-quotes and self-reposts

Blocked pending an authenticated `_decoded/` quote/thread capture containing the current repost attribution row. The existing fixtures do not expose the `Reposted by @<handle>` relationship needed for a reliable author-equality check.

Re-entry condition: add the authenticated capture, verify the social-context selector, then implement and fixture-test self-repost detection without broad text heuristics.

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

## Scope the media display modes to genuinely sensitive media

`media.sensitive` reads as a sensitive-content control, and its blur and hide rules match every
`[data-testid="tweetPhoto"]`, `videoPlayer` and `videoComponent` in the timeline -- nothing in them
tests whether X marked the media sensitive. In v1.12.1 the control was relabelled to say what it
does ("Blur every photo and video") rather than shipping a scope it does not have.

Blocked on a capture containing sensitive media. Measured across both fixtures: `home.html` holds
3 photos and 2 videos, `status.html` 2 and 2, and neither contains a single sensitive item. The
one `[data-testid="contentDisclosureButton"]` in either file sits in the composer toolbar
(`toolBar` -> `primaryColumn`), not inside any `article[data-testid="tweet"]` -- it is the control
for marking your *own* post sensitive, not a media overlay. So the existing `av-sensitive-reveal`
rule, which hides that testid inside an article, matches nothing that has ever been captured.

Re-entry condition: add a `_decoded/` capture containing sensitive media, confirm what marks it
(an overlay wrapper, an `aria-label`, a disclosure button inside the media container), then stamp
the owning media container with a `data-av-*` attribute from the feature and scope the CSS to that
attribute. Then relabel the control back to naming sensitive media --
`tests/media-scope.test.mjs` fails at that moment, which is what forces the copy to follow.

## Settings that normalize but nothing reads

An unread-settings sweep (probe self-checked against a key known to be read, so a broken regex
could not report everything as dead) found five. `timelineWidth` and `restoreChirp` were wired in
v1.9.0, and `privacy.encryptVault` was removed in v1.12.0 rather than implemented (see
CHANGELOG.md for why). Two remain, both waiting on the same capture:

- `filter.selfRepost` -- F033. Needs a capture containing a self-repost. Already defaults to
  `"off"`, so it claims nothing while it waits.
- `filter.blockedAccounts` -- the *feature* still needs a capture containing X's blocked-account
  placeholder row. The *claim* is fixed: it defaulted to `"hide"`, so every install carried a
  filter the engine never applied and every settings export published that claim. It defaults to
  `"off"` now, and `tests/settings-claims.test.mjs` fails any filter action that defaults to
  something active while nothing reads it.

Re-entry condition for both: the same authenticated `_decoded/` capture that unblocks
hide-promoted-posts and hide-all-reposts. One capture settles four items.
